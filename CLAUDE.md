# CLAUDE.md

Guidance for Claude Code sessions working on Countercheck.

## Start here

1. Read `TASKS.md`: the plan, the user's decisions, the status and the next step.
2. Keep it up to date as you work, separating what is verified from what isn't. Future sessions
   depend on it. Once the design settles, record decisions and their reasons in `ARCHITECTURE.md`.

## What this project is

Countercheck is an open-source accounts-payable assistant. It reads supplier invoices (PDFs and
scans), checks each one against its purchase order and goods receipt, and stops anything doubtful
(price changes, short deliveries, duplicates, changed bank details) for a person to decide before
money moves. Approved invoices post to a ledger exactly once, even when the ledger API fails. The
public demo runs on synthetic documents for fictional companies.

## Hard rules

- No hardcoded or fabricated extraction results, eval numbers, benchmarks or test results. If
  something has not been run, say so.
- Ground truth for the sample cases never reaches the model (prompt, tools, file names or ids).
- The model never gets a tool that writes. Only app code posts to the ledger, and only after a
  person approves.
- Every value the model extracts carries a quote from the document, and code checks the quote.
  Values that fail the check go to a person.
- All companies, people, addresses and bank details in the data are fictional and must not
  resemble real ones.
- No secrets in the repo. Keys live in `.env` / `.dev.vars` (gitignored) or Worker secrets.
- Docs present Countercheck as an independent open-source tool; keep personal context out of the
  repository.
- Ask the user before: creating paid resources (Workers Paid included), deploying publicly,
  setting secrets, creating or pushing a GitHub repo, accepting uploads from visitors, adding a
  model provider, or making billed API calls.

## Environment (Windows dev machine)

- Node 26, npm 11 (npm workspaces, no pnpm), TypeScript 7. No Docker or WSL.
- Python 3.14 and uv 0.11 for the data and eval pipeline.
- wrangler is logged in to the user's Cloudflare account (free plan). Run it with
  `WRANGLER_SEND_METRICS=false`.
- Git pushes go through Git Credential Manager with `GCM_INTERACTIVE=never`; `gh` is not logged in.

## Commands

Add them here as the project grows.
