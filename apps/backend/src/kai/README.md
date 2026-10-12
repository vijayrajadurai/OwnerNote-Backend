# KAI — Owner Note's business assistant (backend)

KAI answers a shop owner in Tamil, Tanglish or English from **their own records**, drafts entries they confirm, and
remembers only what they approve. It uses **no paid proprietary LLM API**. It runs fully without any model (the
rule-based engine, labelled as such); a local / self-hosted open-weight model is optional and can only rephrase.
The owner's rulebook is `OwnerNote/docs/KAI_PRINCIPLES.md` (Android repo); this module keeps the same seven principles.

## Pipeline (one entry point for typed and spoken messages)

```
POST /kai/chat ─► engine.chat()
   1. load turn context      memory.loadTurnContext   last person / product, pending choice, open draft, last answer
   2. load the shop          tools.loadDirectory      this business's customers, suppliers, products (ids + names only)
   3. understand (rules)     intent.understand        language → mic Tamil read as Tanglish → intent, person, amount
   4. route                  engine.route             read tools │ calculator │ draft │ memory │ correction │ fallback
   5. reply from facts       replies.*                every number comes from a tool result
   6. optional model         engine.withModel         rephrase (number-checked) │ general answer │ read-only routing
   7. save the turn          KaiMessage + summary     (and the facts used, for "that's wrong")
```

| File | Job |
| --- | --- |
| `language.ts` | Tamil / Tanglish / English detection, mic Tamil keywords → Tanglish (word by word), ₹ formatting |
| `names.ts` | Tamil ⇄ Latin transliteration, sound keys, person / product matching (FOUND / AMBIGUOUS / UNKNOWN) |
| `numbers.ts` | Amount parsing (k, lakh, aayiram), a small safe arithmetic parser — nothing is `eval`'d |
| `intent.ts` | Rule-based understanding; pure, unit-tested, scored by `eval/` |
| `report.ts` | Report topic + period ("கடந்த மாத பண வரவு", "customer pending amount"), and what Kai doesn't write from chat (`HOW_TO`) |
| `tools.ts` | Read-only, businessId-scoped business tools (balances, totals, overdue, today, stock, cash flow, duplicates) |
| `replies.ts` | The words of each answer in three languages |
| `actions.ts` | Typed drafts (zod), confirm in one DB transaction, idempotent, optimistic concurrency, audit log |
| `memory.ts` | Conversation context, rolling summary, approved memory (preference / alias / note), retrieval |
| `model/` | `KaiModel` seam: `RuleBasedOnly`, `OllamaModel`, `OpenAICompatibleModel` (self-hosted only) |
| `prompts.ts` | Model instructions — server-side only, never returned or logged |
| `guard.ts` | Model output checks (same numbers, no rupee figures in general answers, no leaks / links) |
| `retention.ts` | Deletes chat history after `KAI_HISTORY_RETENTION_DAYS` (daily) |
| `eval/` | Golden set + runner (`npm run kai:eval`) |

## API (all need a bearer token; OWNER role unless noted)

| Method & path | What |
| --- | --- |
| `POST /kai/chat` `{message, conversationId?}` | Reply: `reply, lang, intent, engine {mode, label}, facts[], draft?, choices?` |
| `POST /kai/actions/:id/confirm` (+ optional `Idempotency-Key`) | Runs the draft once; `reply` says "saved" only after the commit |
| `POST /kai/actions/:id/cancel` | Cancels a draft (nothing was written) |
| `GET /kai/conversations`, `GET /kai/conversations/:id/messages`, `DELETE /kai/conversations/:id` | History (own only) |
| `GET /kai/memories?status=`, `DELETE /kai/memories/:id` | Approved / pending memory; forget |
| `POST /kai/feedback` `{messageId, rating: 1/-1, comment?, allowTraining?}` | Per-message feedback (opt-in for training) |
| `GET /kai/feedback/export` (**ADMIN**) | Opted-in feedback, phone numbers and the shop's names redacted |
| `GET /kai/status` | Engine mode and label, model name and reachability (never a URL or key) |

Rate limit: `KAI_RATE_LIMIT_PER_MIN` per owner on chat and confirm (plus the global limiter).

## Safety rules the code enforces

- **Tenant isolation**: every query carries the caller's `businessId`; a conversation, draft or memory of another shop
  is 404. Tests: `tests/kai.api.test.ts` ("another shop can't see or confirm…").
- **Facts only from records**; unknown names are said back ("Suresh-nu yaarum illa"), two matches are asked about, a
  claim that differs from the records is shown against them, more than one amount is asked about.
- **Writes**: draft → owner taps Confirm → one transaction (claim the draft, write, store the result). A retry or a
  second concurrent confirm replays the stored result; an entry changed mid-save aborts (no lost update). Payments
  above the pending balance are refused. Typing "sari / ok" never confirms — only the confirm call does.
- **Model**: optional, local / self-hosted only (`env.ts` refuses proprietary API hosts). It never decides a write, never
  produces a number shown as a fact (a rephrasing must contain exactly the draft's numbers), and may route only to
  read-only, no-entity questions. Owner text and records go to it as JSON data, never as instructions.
- **Memory**: preferences, nicknames and notes are saved only after Confirm, kept with their source (`chat:<messageId>`)
  and time; corrections are stored with their status against the records. Replies say plainly that nothing retrains
  a model.
- **Secrets**: prompts, model URL and key stay on the server; requests for "your system prompt / API key / other shop's
  data" are refused.

## Environment

`KAI_MODEL_PROVIDER=none|ollama|openai-compatible`, `KAI_MODEL_URL`, `KAI_MODEL_NAME`, `KAI_MODEL_API_KEY` (own gateway
only), `KAI_MODEL_TIMEOUT_MS`, `KAI_HISTORY_RETENTION_DAYS`, `KAI_RATE_LIMIT_PER_MIN`, `KAI_DRAFT_TTL_MINUTES`.

Development with a local model: install Ollama, `ollama pull qwen2.5:7b-instruct`, then
`KAI_MODEL_PROVIDER=ollama KAI_MODEL_URL=http://localhost:11434 KAI_MODEL_NAME=qwen2.5:7b-instruct`.

## Evaluation and the feedback dataset

- `npm run kai:eval` scores `intent.understand` on `eval/goldenSet.ts` (tests require 100%). Add a line for every new
  rule, and a line Kai must *not* match.
- `npm run kai:dataset -- <file.json> [intents|topics]` scores a whole owner dataset (rows of `{intent, ta, th, en}`):
  typed Tanglish, mic Tamil and English, and whether typed and mic give the same result. Samples of the owner's two
  datasets (12 Oct 2026) are in `tests/fixtures/` and `tests/kai.dataset.test.ts` requires 100% on them:
  - `Kai_Local_Tamil_Thanglish_100000` (labels trusted) — who owes whom is read from how the name is said
    ("Kumar-ku / Kumaruku / குமாருக்கு" = to the person) and the verb (still owed / already paid);
  - `Kai_100000_Dataset` — its labels are not usable (the same sentence carries up to 28 labels), so it is scored by the
    report topic each sentence names (`report.ts`: topic + period).
- Owners can rate any reply and opt in (`allowTraining`); `GET /kai/feedback/export` gives the redacted set an admin
  can use to evaluate a model or prepare a future fine-tune. Nothing is trained automatically.

## Not yet (next phases)

- The Android app calls `/kai/chat` when online and keeps the on-device Kai as the offline fallback.
- More tools (statement PDF data, reminders, stock writes) as typed drafts.
