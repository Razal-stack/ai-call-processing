# Architecture

How the service is structured, how a request flows through it, and where the trust
boundaries are. For *why* the design choices were made, see
[DESIGN-DECISIONS.md](DESIGN-DECISIONS.md).

---

## Layered, framework-isolated

Dependencies point **inward only** (`api → services → domain`). Everything outside
`api/` is framework-agnostic — it imports zero Express — which is what makes the
core unit-testable without a server and the provider swappable.

```
                        HTTP boundary (Express)
  ┌───────────────────────────────────────────────────────────────┐
  │  api/                                                           │
  │    routes/        wiring only                                   │
  │    controllers/   validate req → call services → assemble resp  │
  │    middleware/     request-id · logging · error-handler         │
  └───────────────┬───────────────────────────────────────────────┘
                  │ (depends inward)
  ┌───────────────▼───────────────────────────────────────────────┐
  │  services/                                                      │
  │    extraction.service   orchestrates the LLM (impure)           │
  │    decision.engine ★     pure, deterministic policy core        │
  │    normalise            DOB/name/symptom/duration tidy-up       │
  └──────┬────────────────────────────────────┬───────────────────-┘
         │                                     │
  ┌──────▼─────────┐                  ┌────────▼──────────────────┐
  │  llm/          │                  │  domain/                  │
  │   provider IF  │                  │   enums (closed sets)     │
  │   prompt (ver) │                  │   action-matrix (policy   │
  │   factory      │                  │     as data + red flags)  │
  │   providers/   │                  └───────────────────────────┘
  │    gemini      │
  │    openai  ┐   │                  ┌───────────────────────────┐
  │    anthropic├─ HttpProvider base  │  schemas/  (Zod = source  │
  │    fake     ┘   (shared fetch)    │   of truth: request /     │
  └────────────────┘                  │   extraction / response)  │
                                      └───────────────────────────┘
        config/ env (Zod, fail-fast)     lib/ logger · errors
```

## Source layout

```
src/
├── config/      env — Zod-validated, fail-fast
├── domain/      enums (closed sets) + action-matrix (policy table + red-flag list)
├── schemas/     Zod schemas — single source of truth (request / extraction / response)
├── llm/         provider interface · versioned prompt · factory · adapters
│   └── providers/   gemini · openai · anthropic · fake · http-provider (base)
├── services/    extraction (LLM orchestration) · decision.engine (pure core) · normalise
├── api/         routes (wiring) · controllers (HTTP) · middleware (request-id, logging, errors)
├── lib/         logger · errors
├── types/       ambient Express Request augmentation (req.requestId / req.log)
├── app.ts       buildApp() — fully wired, no listen (testable via supertest)
└── index.ts     entrypoint: load env → build app → listen → graceful shutdown
test/
├── unit/        decision engine · extraction retry policy · normalise · schemas · factory
├── e2e/         supertest against the app (fake provider)
└── live/        opt-in, real provider (pnpm test:live)
```

---

## Execution flow

A single `POST /process-call` request, end to end:

```
client
  │  POST /process-call { transcript }
  ▼
request-id mw ─ mint/propagate x-request-id, bind a child logger
  ▼
logging mw ─── log "request received" (method, path — never the body)
  ▼
controller
  │  1. validate body (Zod)              ── fail → 400
  │  2. enforce size cap                 ── over → 413
  │  3. log redacted descriptor (len + hash, no PII)
  ▼
extraction.service.run(transcript)
  │  • trivially short?  → SKIP the LLM, return empty extraction  (cost gate)
  │  • else → provider.extract(request)        ── transport fail → 502 / timeout → 504
  │           validate JSON with Zod (never trust the model)
  │           bad shape → retry once → still bad → safe empty extraction (200)
  │           normalise DOB / name / symptoms / duration
  ▼
decision.engine.decide(extraction)   ── PURE, no I/O
  │  1. safety override   red-flag symptom / emergency urgency → direct_to_emergency
  │  2. sufficiency gate   no signal / confidence < 0.4         → request_more_info
  │  3. matrix lookup      intent × urgency → { action, mode }
  ▼
controller assembles { data, meta } → validate via response schema → 200
  ▼
logging mw ─── log "request completed" (status, latency)
  ▼
client  ◀── structured JSON + meta   (+ error-handler wraps any throw in a safe envelope)
```

---

## Validation — Zod at four boundaries

Zod runs at every trust boundary; TypeScript types are **derived** from the schemas
(`z.infer`) so validation and types can't drift.

1. **Env** — validated at boot; the process refuses to start if misconfigured.
2. **Request in** — invalid body → `400` (`.strict()` rejects unknown keys so client
   typos surface loudly).
3. **LLM output** — re-validated; the model's JSON is **never trusted**. Off-list
   intents/urgencies coerce to `unknown`; bad shape → one retry → safe fallback.
4. **Response out** — the payload is parsed through the response schema before
   sending, so a bug can never emit an off-contract response.

Closed sets use `as const` + `z.enum` (not TS `enum` — runtime bloat, poor Zod
ergonomics); `interface` is reserved for behavioural contracts (`LLMProvider`),
`type` for data shapes.

---

## Domain model (closed sets)

- **intent:** `book_appointment` · `request_prescription` · `medical_advice` · `cancel_or_reschedule` · `general_enquiry` · `unknown`
- **urgency:** `emergency` · `urgent` · `routine` · `unknown`
- **action:** `book_appointment` · `direct_to_emergency` · `escalate_to_nurse` · `issue_prescription_request` · `request_more_info` · `escalate_to_staff`
- **mode:** `gp_consultation` · `nurse_consultation` · `telephone_callback` · `in_person` · `none`

The full `intent × urgency → action + mode` policy lives in
[`src/domain/action-matrix.ts`](../src/domain/action-matrix.ts) as a declarative
table a clinician can read top-to-bottom. `request_more_info` is an **action** (with
`mode: none`), not a mode.

---

## Observability & PII

- **Structured JSON logging** (pino) with a **per-request id**, also returned as the
  `x-request-id` header and in `meta.request_id` — one id correlates the header, the
  response, and every log line for that request. An inbound `x-request-id` is honoured
  (for distributed tracing); otherwise a UUID is minted.
- **Transcript content is never logged.** It is patient clinical PII. Handlers log
  only a **length + short SHA-256 hash** (`redactTranscript`), never the body; the
  logging middleware never logs the body either.
- **Never persisted.** The transcript is processed in memory and discarded — no DB,
  no disk, no queue.
