# AI Call Processing

A backend service that turns a patient call transcript into a structured,
**actionable** clinical decision. An LLM extracts the facts; a **deterministic
engine — not the LLM — decides** the recommended next action.

```
POST /process-call  { "transcript": "..." }  →  structured JSON + meta
```

**Minimal, production-shaped, provider-agnostic** — one LLM provider active at a
time, chosen by config.

---

## How to run

**Prerequisites:** Node.js ≥ 20 (tested on 22) and [pnpm](https://pnpm.io).

```bash
pnpm install
cp .env.example .env        # default provider is Gemini (free tier); set GEMINI_API_KEY
                            # — or set LLM_PROVIDER=fake to run with NO key at all
pnpm dev                    # → http://localhost:3000   (pnpm build && pnpm start for prod)
```

Provider keys (OpenAI / Anthropic), free-vs-paid, and troubleshooting →
**[docs/SETUP.md](docs/SETUP.md)**.

### Try it

```bash
curl -s http://localhost:3000/process-call \
  -H 'content-type: application/json' \
  -d '{"transcript":"Hi, I'\''ve had a really bad cough for 5 days and I'\''d like to see a doctor. My name is John Smith and my date of birth is 2nd Jan 1990."}' | jq
```

### Scripts

| command | what it does |
|---|---|
| `pnpm dev` | run with hot reload |
| `pnpm test` | unit + e2e — **no API key needed** (fake provider) |
| `pnpm test:live` | the same scenarios against the **real** provider in `.env` (opt-in, needs a key, never in CI) |
| `pnpm typecheck` · `pnpm check` | strict TS check · Biome lint+format |
| `pnpm build` · `pnpm ci` | compile to `dist/` · full pipeline (check → typecheck → build → test) |

---

## API

### `POST /process-call`

**Request:** `{ "transcript": "..." }`

**Response `200`:**

```jsonc
{
  "data": {
    "patient":  { "name": "John Smith", "date_of_birth": "1990-01-02" },
    "clinical": { "symptoms": ["cough"], "duration": "5 days", "urgency": "routine" },
    "intent": "book_appointment",
    "confidence": 0.9,
    "recommended_action": { "type": "book_appointment", "mode": "gp_consultation" }
  },
  "meta": {
    "request_id": "…",            // also returned as the x-request-id header
    "data_quality": "complete",   // complete | partial | insufficient
    "warnings": [],               // human-readable gaps / assumptions / overrides
    "processing_ms": 812,
    "model": { "provider": "gemini", "name": "gemini-2.5-flash-lite" },
    "prompt_version": "2026-06-02.2"
  }
}
```

`data` carries the structured result; `meta` carries traceability fields.

`GET /health` → `{ "status": "ok" }` (cheap liveness probe, no LLM call).

### HTTP status policy

Status encodes **contract validity**; `meta.data_quality` encodes **content
sufficiency**. These are two orthogonal axes.

| status | when |
|---|---|
| `200` | processed — **always** for valid input, including vague/insufficient content (gaps in `meta`) |
| `400` | request contract violation (missing / blank / non-string transcript, malformed JSON) |
| `413` | transcript exceeds `MAX_TRANSCRIPT_CHARS` |
| `502` / `504` | LLM provider failed-or-unreachable / timed out |
| `500` | unexpected error (no internal detail leaked) |

Every error uses one envelope: `{ "error": { "code", "message" }, "meta": { "request_id" } }`.

---

## How it works

```
transcript ──▶ [LLM]  extraction (probabilistic)  ──▶  [decision engine]  action (deterministic)
                      patient · symptoms · intent          1. safety override (red flags → emergency)
                      urgency · confidence                 2. sufficiency gate (low signal → ask more)
                                                           3. matrix: intent × urgency → action + mode
```

**The LLM extracts; code decides.** The model converts a transcript into structured
data — it **never** chooses the action. A pure, deterministic engine maps that
extraction to the recommended action. The action is therefore **auditable, testable,
and safe**: a model hallucinating "routine appointment" for someone describing chest
pain cannot reach the patient, because the red-flag safety override runs *first* and
overrides the LLM's intent and confidence entirely.

The code is **layered, with dependencies pointing inward** (`api → services →
domain`). Everything outside `api/` is framework-agnostic, so the core is testable
without a server and the provider is swappable.

```
src/
├── config/      env (Zod-validated, fail-fast)
├── domain/      closed-set enums + action-matrix (policy as data + red-flag list)
├── schemas/     Zod schemas — single source of truth (request / extraction / response)
├── llm/         provider interface · versioned prompt · factory · adapters
│   └── providers/   gemini · openai · anthropic · fake · http-provider (base)
├── services/    extraction (LLM orchestration) · decision.engine (pure core) · normalise
├── api/         routes · controllers · middleware (request-id, logging, errors)
├── lib/         logger · errors
├── types/       ambient Express Request augmentation (req.requestId / req.log)
├── app.ts       buildApp() — fully wired, no listen (testable via supertest)
└── index.ts     entrypoint: load env → build app → listen → graceful shutdown
```

Full diagrams, request flow, validation boundaries, domain model, observability/PII →
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Testing

93 tests, all green; `pnpm test` needs **no API key** (deterministic fake provider).

- **Unit** — the decision engine exhaustively (full action matrix, every red-flag,
  sufficiency gate, confidence thresholds), the extraction service's retry/latency
  policy, plus normalisation, schema boundaries, and provider-factory selection.
- **E2E** (`supertest`, fake provider) — happy path, emergency escalation, vague
  input, trivial-skip, `400`/`413`/`502`/`504`, request-id propagation. Every response
  is asserted against the response schema.
- **Live** (`pnpm test:live`, opt-in) — the same scenarios against the real provider
  in `.env`, asserting behaviour/contract not exact values. Never in CI.

Default suite uses `fake` so it's deterministic, free, and key-free in CI; a real LLM
drifts run-to-run, so live behaviour is checked separately and opt-in.

---

## Configuration

All configuration is environment variables (12-factor), validated at boot by
[`src/config/env.ts`](src/config/env.ts) (Zod, fail-fast). Exactly **one** provider is
active per deployment — set `LLM_PROVIDER`, the matching key, and (optionally) a model.

| Environment | How config is supplied |
|---|---|
| **Local dev** | `.env` (copy from `.env.example`; gitignored) |
| **Test / CI** | `.env.test` (committed, no secrets) forces `LLM_PROVIDER=fake` |
| **Sandbox / staging / prod** | platform secret store — **no** committed `.env`; a guard rejects `fake` in production |

See [`.env.example`](.env.example) for the full annotated list, and
[docs/SETUP.md](docs/SETUP.md) for per-provider setup.

---

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — component & layer diagrams,
  request flow, Zod validation boundaries, domain model, observability & PII.
- **[docs/DESIGN-DECISIONS.md](docs/DESIGN-DECISIONS.md)** — extract/decide split,
  prompt design, model selection, cost/token strategy, latency & timeouts, graceful
  degradation, scope boundaries, and assumptions.
- **[docs/SETUP.md](docs/SETUP.md)** — provider keys, free-vs-paid, troubleshooting.
