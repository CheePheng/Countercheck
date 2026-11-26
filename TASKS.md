# Countercheck: tasks

Last updated: 2026-11-26 (planned in another session; nothing built yet, start at step 0).

## What to build

An accounts-payable assistant that a finance team could actually trust:

1. **Read** each supplier invoice (PDF or scan) with one model call. Every extracted value carries
   a quote from the document, and code checks that the quote is really there.
2. **Check** it with plain code against the purchase order, the goods receipt, the vendor record
   and the payment history: prices, quantities, tax and totals, duplicates, changed bank details.
3. **Stop** anything doubtful for a person, with the reason in plain words. Only invoices with no
   open questions are proposed for approval, and a person still clicks approve.
4. **Post** approved invoices to a ledger exactly once, with retries, even when the ledger API
   times out, fails or receives the same request twice.
5. **Measure** all of it with evals against known answers.

The common path is a fixed workflow: one extraction call, then code. A small agent with read-only
tools runs only when the workflow can't continue (no PO number, unknown vendor, ambiguous match)
and proposes a resolution for a person to accept. Explain this choice in the docs: a workflow is
cheaper and more predictable where the steps are known.

What matters most, in order: honest, visible evals (the headline number is **false approvals**,
invoices that should have been stopped but would have been paid); checked evidence; the human
approval step; exactly-once posting; a page that a first-time visitor understands in seconds; a
clean Python pipeline.

Countercheck is a working name. If the user wants another, rename before the first deploy.

## User decisions (2026-11-26)

- Build it, with the same terms as IncidentLens:
  - **Models:** free Workers AI models through the AI binding, no paid keys. Default Gemma 4 26B
    (`@cf/google/gemma-4-26b-a4b-it`), alternative Mistral Small 3.1
    (`@cf/mistralai/mistral-small-3.1-24b-instruct`). Scans may need a vision-capable model;
    check which are available.
  - **Hosting:** the user's Cloudflare account on the free plan. Verify the current free-plan
    limits first and design around them. If something genuinely needs Workers Paid (US$5/month),
    stop and ask.
  - **Embedding:** the demo must work inside an iframe on
    https://portfolio.doctorwilddoctorwild.workers.dev (no `X-Frame-Options`; CSP
    `frame-ancestors` must allow that origin) and stay usable at 390 px wide.
  - **Git:** commit locally as you go. GitHub only after the user confirms (see step 10).
- Synthetic documents only in v1. Visitor uploads are a stretch goal that needs the user's yes.

## Budget (Workers AI)

The account's free allowance is 10,000 neurons a day (reset 00:00 UTC), shared with other apps
on the same account. So:

- Give Countercheck its own daily cap of 1,500 neurons (configurable) and per-visitor limits.
- Recorded runs (real and unedited) are the default view; a live run is an option.
- When the allowance is used up (Workers AI error 4006), say so in plain words and show the
  recording instead of failing.
- Measure neurons per document on three documents before building further. Iterate on small
  subsets, and spread full eval runs over days.


## Design

- One obvious first action: open an invoice and watch it get checked. Plain words on screen;
  reason codes, model names, neurons and timings one click away.
- Distinctive, not templated. The document is the hero, on a paper-and-desk feel: evidence shows
  as highlighter marks on the page, and the decision lands as a stamp (Approved / On hold) when
  the visitor acts. The stamp is the one bold motion. No purple or blue gradients, glassmorphism,
  or reflex fonts (Inter, Space Grotesk, Instrument Serif, Fraunces).
- Screenshot it as a first-time visitor at 1440 and 390 widths and cut what they don't need.
  Respect reduced motion.

## Steps

0. **Verify the platform** and write the facts here with dates and sources: Workers free-plan
   limits (CPU time per request, subrequests, Durable Objects and D1 quotas, rate-limit
   bindings), current Workers AI models and neuron prices for the candidates (text and vision),
   and whether `env.AI.toMarkdown` costs neurons for PDFs.
1. **Scaffold:** npm workspaces (for example `apps/web`, `packages/core`, `packages/extract`), a
   uv project in `pipeline/` for the Python side, Biome, Vitest, pytest, `git init`. Check that
   dependency licences suit Apache 2.0 (avoid AGPL ones such as PyMuPDF).
2. **Synthetic data (Python, deterministic from a seed):** fictional vendors in Malaysia and
   Singapore (MYR and SGD), a vendor master with bank details, purchase orders, goods receipts,
   payment history, and invoices rendered to PDF in at least four layouts, plus a few scan-like
   images (skew, noise, a stamp, a handwritten note). Cases to cover: clean match; price above
   tolerance; short delivery; partial delivery across two invoices; duplicate (same number sent
   again, and the same amount under a new number); wrong tax or totals; missing or wrong PO
   number; unit-of-measure mismatch; wrong currency; changed bank details (a payment-fraud
   pattern); goods never ordered. Ground truth (expected fields, decision and reason codes) is
   kept apart from anything sent to the model. Extract the text layer with word positions at
   build time, for highlighting. Start with about 12 cases covering every situation, split into a
   dev set and a held-out set, and grow them once the cost per document is known. pytest for the
   generator.
3. **Matching engine (TypeScript, pure, runs in Node and Workers):** line matching across
   invoice, PO and receipt with configurable tolerances, duplicate detection, the bank-detail
   check, tax and total arithmetic. Output: a decision (approve, hold with reason codes, reject)
   and findings that point to evidence. Unit tests, plus property-based tests where they help.
4. **Extraction:** one Workers AI call per document with a JSON schema; quotes checked by code;
   unchecked values flagged for review. Also a rule-based baseline extractor (no model, works on
   one or two layouts) for tests, the e2e run and an honest comparison row in the evals. For
   scans, compare a vision model at run time with OCR at ingest on the dev set, if the allowance
   allows. After three documents, stop and tell the user if quality is poor or the cost doesn't
   fit the cap.
5. **Exception agent:** read-only tools (search POs, receipts, vendor records, payment history),
   a turn and neuron budget, and a proposed resolution with evidence for a person to accept.
6. **Ledger integration:** a posting API with idempotency keys, an outbox with retries
   (exponential backoff with jitter), a dead-letter list, failure toggles (timeouts, 503s,
   duplicate deliveries, slow responses) and a reconciliation check of approved invoices against
   the ledger. Property-based tests show exactly-once posting under random failure schedules.
7. **Evals (Python):** results as JSON with model, date and commit. Metrics: accuracy per field,
   documents with every critical field right, decision accuracy, false approvals, false holds,
   neurons and latency per document. Runs go through the deployed gateway with a recorder key
   (as in IncidentLens), so they count against the cap. Show the date and model next to every
   number, and never publish numbers that weren't run.
8. **Web app** on one Worker with static assets (React and Vite): an inbox of sample invoices →
   the invoice view (the document with highlighted evidence, the extracted fields, a line-by-line
   match against the PO and receipt, the recommendation in plain words) → the visitor reviews
   (approve, hold, correct a field) → the stamp → the ledger entry and an integration log with
   visible retries, with the failure toggles one click away. After a run, compare it with the
   known answer. Corrections can be downloaded as new eval cases (nothing stored on the server).
   An About page covers how it works, eval results and the architecture. Playwright e2e at 1280
   and 390 px: no console errors, CSP violations or horizontal overflow.
9. **Deploy** (ask first) to a workers.dev address on the account, set the recorder key (ask
   first), make recordings over several days within the cap, and calibrate the budgets from real
   runs.
10. **Docs and CI:** README (what it is, a diagram, how the checks and evals work, results with
    dates), ARCHITECTURE.md, LICENSE (Apache 2.0), and CI covering lint, typecheck, TypeScript and
    Python tests, build and e2e. Publish to a public repo after the user confirms.
11. **Review passes** (code review, security review). Then tell the user it's ready to embed.

Stretch goals, each only with the user's yes: visitors' own invoices (processed in memory, never
stored, strict limits); structured e-invoices (Peppol / UBL) read without the model; an MCP
server for the read-only tools.

## Platform facts (step 0, verified 2026-11-26)

- Workers Free: 10 ms CPU per HTTP request, 100,000 requests a day, 50 subrequests per request,
  128 MB memory. Durable Objects on Free: SQLite backend only, 100,000 requests and 13,000 GB-s a
  day, 5 GB storage; alarms count as requests. Over a free limit, operations fail (no charge). The
  Rate Limiting binding works on this account. (From IncidentLens's research notes, same day.)
  So: nothing CPU-heavy on the server. PDF text layers are extracted at build time by the Python
  pipeline; the Worker only forwards model calls and runs the small ledger.
- Workers AI: 10,000 free neurons a day per account (reset 00:00 UTC), $0.011 per 1,000 neurons
  on Paid; calls fail with error 4006 once used. Gemma 4 26B A4B: $0.10 per M input tokens, $0.30
  per M output (9,091 / 27,273 neurons per M), 256k context, function calling, and the model page
  lists Vision: yes, but shows no image example. Mistral Small 3.1: 31,876 / 50,488 neurons per M.
  Images are billed as 1,601–6,404 input tokens each, so a scanned page costs roughly 15–60
  neurons on Gemma 4 before text.
- JSON output: Workers AI's `response_format` (`json_schema`, OpenAI-style) is listed as a Gemma 4
  parameter, but the JSON mode page's supported-model list doesn't include Gemma 4, and JSON mode
  doesn't stream. Plan: ask for JSON, validate with a schema in code, retry once with the error.
  Confirm the image message format (likely OpenAI-style `image_url` with a data URI) and whether
  `response_format` works with one small call before relying on either.
- `env.AI.toMarkdown()` is free for most formats (images use models and cost neurons). Not needed:
  text layers come from the pipeline.

## Status

- Steps 0–3 done 2026-11-26 (local commits 5692b15, c094ab3):
  - `packages/core`: the checks (`checkInvoice`), unit and property-based tests.
  - `pipeline/` (uv): 28 sample invoices from seed 20261126 (14 situations × dev/held-out, four
    layouts, one in Malay) in `data/` (committed, so the web build doesn't need Python). pytest
    covers determinism, sums, that the page shows what the answer says, and that model inputs
    hold no answers. Regenerate with `npm run data`.
  - `packages/core/test/data.test.ts`: every known answer, read perfectly, gets exactly its
    decision and reasons from the TypeScript checks.
- npm: run tools from `node_modules/.bin` (or `npx --no-install`). With nothing installed,
  `npx biome` fetched an unrelated npm package called `biome` and ran it (2026-11-26; it wrote
  nothing here). Vite is pinned to 8.3.8 in `overrides` (rolldown 1.3.4's tarball 404s).
- Step 4 done (`packages/extract`, commit 75efdba): one call per invoice, quotes checked by code,
  one retry on a malformed reply, and the template baseline.
- Calibration 2026-11-26 (local `vite dev` with `COUNTERCHECK_REMOTE_AI=1`, real Workers AI):
  Gemma 4 read three invoices (English, banner and Malay layouts) perfectly, 26–30 neurons and
  12–32 s each. So recorded readings are the default view and a live reading says it takes ~20 s.
- Step 7 done: `uv run countercheck-evals` (pipeline/src/countercheck_pipeline/evals.py) reads
  through `/api/read` with the recorder key, saves every reading unedited to
  `data/readings/<model>/` (the app replays them) and scores to `data/evals/<model>.json`
  (a partial run merges; failed calls stay listed under `failures`). Results, prompt
  2026-11-26.1, all 28 invoices:
  - Gemma 4 26B: 28 read, all fields right, 28/28 decisions and reasons, 0 bad invoices
    approved, 0 good ones held, 817 neurons (29.2 each), median 19.5 s, p95 26.1 s. One call
    timed out (inv-26, 504 after 45 s) and was read again in a second run.
  - Template parser (no model): 7 of 28 read (its one layout), 23% of fields, 21/28 decisions
    (only because unread invoices are held), 0 bad approved, 5 good held.
  - The page says plainly that these are clean PDFs; scans and new layouts aren't tested yet.
- Step 8, first version (not deployed): in-tray, the invoice with highlighter marks from the
  checked quotes (red outline on what caused a hold), a payment voucher (what was read, against
  the PO and deliveries, the recommendation, your decision), the stamp, the known answer after
  you decide, evals and how-it-works pages, live readings through the meter. Worker: `/api/status`
  and `/api/read` (model or `baseline`), a Meter Durable Object (daily cap 1,500, 5 live readings
  per visitor a day, no IP stored), CSP `frame-ancestors` for the portfolio in `public/_headers`.
  Checked at 1440 and 390 px (no horizontal overflow, no console errors). Tests: 101 TypeScript
  (core, data contract, extract, meter, API) and 13 Python.
- Local secrets (gitignored): recorder key in `apps/web/.dev.vars` and as
  `COUNTERCHECK_RECORDER_KEY` in the root `.env`.
- Step 6 done (2026-11-27): `packages/core/src/ledger.ts` (idempotency keys, outbox with
  exponential backoff and jitter, dead letters, `FakeLedger` with queued faults, `reconcile`);
  a property test runs 500 failure schedules and requires exactly one posting per approval. In
  the app, approving posts through a ledger simulated in the browser (by default the first
  answer is lost, so the retry and "already posted" show), with fault switches one click away.
- Step 10 mostly done: README (results with dates and limits, architecture, how to run),
  LICENSE (Apache 2.0), CI (`.github/workflows/ci.yml`: lint, typecheck, tests, build, browser
  smoke test; Python tests and a byte-for-byte regeneration check of the JSON and PDFs, not the
  .webp pictures). `apps/web/scripts/smoke.mjs` passes locally (`PLAYWRIGHT_CHANNEL=msedge`).
  CI has never run (nothing pushed).
- In Git Bash, pass `MSYS_NO_PATHCONV=1` for arguments like `#/inv-01` (it rewrites them as
  Windows paths).
- **Deployed 2026-11-27** (user approved) to https://countercheck.doctorwilddoctorwild.workers.dev
  (version 2ec083ad; redeploy with `npm run deploy -w @countercheck/web`, WRANGLER_SEND_METRICS=false).
  `RECORDER_KEY` secret set (the same key as in the root `.env`). Checked: security headers (CSP
  `frame-ancestors` allows the portfolio), `/api/status`, the smoke test against production, one
  live recorder reading (inv-14: 1 attempt, 29 neurons, 16 s, approve, all quotes verified),
  and it loads inside the portfolio's viewer.
- GitHub: the user approved publishing. The local history was rewritten before any push so it
  never held the local-only notes; `origin` points at https://github.com/CheePheng/Countercheck,
  which doesn't exist yet. Creating it through the API was refused by the permission check, so
  the user creates the empty public repo, then `GCM_INTERACTIVE=never git push -u origin main`.
- Next: the push once the repo exists (then check CI); the exception agent (step 5) for invoices
  without a usable PO; scans (vision vs OCR); review passes (step 11).
