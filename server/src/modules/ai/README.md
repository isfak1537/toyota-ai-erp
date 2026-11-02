# AI module (P4 + P5)

Connects the ERP to the Python AI service and to an LLM. It follows the AI rules in `CLAUDE.md`:
AI never writes business records; only `POST /ai/suggestions/:id/approve`, by a human, creates a DRAFT requisition.

| File | Job |
|---|---|
| `ai.client.js` | HTTP client for the Python service: shared secret, timeouts, one retry for reads, 503 on any failure |
| `replenishment.js` | Pure formulas (safety stock, reorder point, quantity), supplier choice, onOrder split |
| `replenishment.service.js` | A run: read stock/suppliers/open POs, forecast through the AI service, store PENDING suggestions |
| `suggestion.service.js` | Approve (atomic, idempotent) and reject |
| `anomaly.service.js` | Sync flags from the AI service, list (rule hits vs review queue), review |
| `models.service.js` | Model runs, retrain, per-product forecast |
| `llm/` | OpenAI-compatible providers (Groq, Gemini, Ollama), rate caps, audited calls, explanations |
| `assistant/` | Read-only assistant: fixed tool registry and the tool loop |

Failure behaviour: AI service down means 503 on AI routes only. LLM off, failing or over quota means
`explanation: null` / `answer: null`, never an error.

Tests: `tests/unit/{ai-client,replenishment,llm-provider}.test.js` and `tests/integration/{replenishment,
suggestion-decisions,anomalies,ai-models,llm-explanations,assistant,route-access}.test.js`. The integration tests talk to a fake
AI service over real HTTP (`tests/helpers/fake-ai-service.js`) and a scripted LLM (`tests/helpers/fake-llm.js`).
`npm run test:live` runs two real Groq calls when `GROQ_API_KEY` is set.
