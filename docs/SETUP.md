# Provider setup

The service is **provider-agnostic**: it talks to one LLM at a time, selected by
the `LLM_PROVIDER` env var. Switching providers is a **config change only — no code
changes**. This guide covers getting a key for each provider and what to put in
`.env`.

All configuration lives in `.env` (copy it from [`.env.example`](../.env.example),
which lists every variable for every provider). `.env` is gitignored — your keys
never get committed.

```bash
cp .env.example .env   # then edit the two lines for your chosen provider
```

> **Tests need no key.** `pnpm test` always uses the deterministic `fake` provider
> (via `.env.test`). You only need a real key to run the live server or the opt-in
> `pnpm test:live`. See [Verifying a provider](#verifying-a-provider) below.

---

## At a glance

| Provider | Free tier? | Get a key | Default model |
|---|---|---|---|
| **Gemini** (default) | ✅ Yes — free tier, no card | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | `gemini-2.5-flash-lite` |
| **OpenAI** | ❌ No — needs a paid balance | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `gpt-5.4-mini` |
| **Anthropic** | ❌ No — needs a paid balance | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | `claude-haiku-4-5` |
| **fake** | n/a — no network | — (built in) | `fake-model-1` |

To change provider, you only ever edit **two lines** in `.env`: `LLM_PROVIDER` and
the matching `*_API_KEY`. Everything else has a sensible default.

---

## Gemini (default, free)

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** and
   sign in with any Google account. (This is Google **AI Studio** — the free path,
   not Google Cloud Vertex AI, which requires billing.)
2. Click **Create API key** → *Create API key in new project*. A key (`AIza…`)
   appears — copy it.
3. In `.env`:
   ```ini
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=AIza…your-key…
   ```
4. The free tier is ample for this service (short transcripts, one small call each).

---

## OpenAI (paid)

1. Go to **[platform.openai.com/api-keys](https://platform.openai.com/api-keys)** →
   **Create new secret key**.
2. **Copy the key immediately** — OpenAI shows the full `sk-…` value **only once**,
   at creation. The dashboard then masks it permanently (`sk-…1234`, no way to
   reveal it); a lost key must be re-created.
3. **Add credit.** OpenAI has **no free tier**. Confirm a balance at
   [platform.openai.com → Billing](https://platform.openai.com/settings/organization/billing).
   Without credit, calls return `insufficient_quota` (see [Troubleshooting](#troubleshooting)).
   A few dollars is plenty — the whole live suite costs well under a cent on `gpt-5.4-mini`.
4. In `.env`:
   ```ini
   LLM_PROVIDER=openai
   OPENAI_API_KEY=sk-…your-key…
   ```

> **Cheaper tier — `gpt-5.4-nano`.** OpenAI's Nano tier is ~90% cheaper than mini
> and built for sub-second, simple background tasks. Mini is the **default** because
> extraction produces a *nested* structured object requiring subtle judgment (UK
> day-first dates, urgency from clinical content, null-over-guess), for which Nano's
> reasoning is a poor fit in a clinical pipeline. For high-volume or simpler use, set
> `OPENAI_MODEL=gpt-5.4-nano` — no code change. (Gemini Flash-Lite is already Google's
> cheapest tier; Anthropic has no tier below Haiku.)

---

## Anthropic (paid)

1. Go to **[console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)**
   → **Create Key**. Copy the `sk-ant-…` value (also shown once).
2. **Add credit** at
   [console.anthropic.com → Billing](https://console.anthropic.com/settings/billing) —
   Anthropic also has no standing free tier.
3. In `.env`:
   ```ini
   LLM_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-…your-key…
   ```

---

## Optional overrides

You almost never need these — the defaults work — but they exist for completeness:

| Variable | Purpose |
|---|---|
| `LLM_MODEL` | Force a specific model for **any** provider (wins over the per-provider default). |
| `GEMINI_MODEL` / `OPENAI_MODEL` / `ANTHROPIC_MODEL` | Per-provider model default. |
| `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` | Point at a proxy / Azure OpenAI / gateway, or a mock server. |
| `ANTHROPIC_API_VERSION` | Anthropic API version header (default `2023-06-01`). |
| `LLM_TEMPERATURE` / `LLM_MAX_OUTPUT_TOKENS` / `LLM_TIMEOUT_MS` | Tuning + cost/latency caps. |

---

## Verifying a provider

After setting `.env`, confirm it works end-to-end:

```bash
# Run the live suite against whatever provider .env selects (real API calls):
pnpm test:live

# …or boot the server and curl it:
pnpm dev
curl -s localhost:3000/process-call -H 'content-type: application/json' \
  -d '{"transcript":"I have had a bad cough for 5 days, I want to see a doctor. I am John Smith, born 2nd Jan 1990."}' | jq
```

The response's `meta.model.provider` tells you which provider actually answered.

`pnpm test:live` runs the same edge-case scenarios as the default suite, but against
the real model, asserting on **behaviour and contract** (not exact values, which
vary run-to-run). It is opt-in and never part of CI.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Boot error: `OPENAI_API_KEY is not set` (or GEMINI/ANTHROPIC) | `LLM_PROVIDER` doesn't match the key you set | Set the key for the selected provider, or switch `LLM_PROVIDER`. |
| `502 llm_unavailable` + `insufficient_quota` in logs | Valid key, but the account has **no credit** (OpenAI/Anthropic) | Add a balance in the provider's billing settings. |
| `502 llm_unavailable` + `401`/`invalid_api_key` | Wrong/expired key | Re-create the key and update `.env`. |
| `504 llm_timeout` | Slow network / model | Raise `LLM_TIMEOUT_MS`. |
| Can't copy the OpenAI/Anthropic key from the dashboard | Both reveal the full key **only at creation** | Create a new key and copy it immediately. |

These error codes are the service's **intended behaviour** — a provider problem
maps to a clean `502`/`504`, never a crash. The app boots and serves `/health`
even with no key configured.
