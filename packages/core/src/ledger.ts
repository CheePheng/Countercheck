/**
 * Posting approved invoices to a ledger exactly once, over an API that fails the way real ones do:
 * it is down, it posts but the answer never arrives, or the same request arrives twice.
 *
 * - Every posting carries an idempotency key (vendor + invoice number), and the ledger keeps the
 *   first posting per key: a retry or a duplicate delivery gets "already posted", never a second
 *   entry.
 * - The outbox retries with exponential backoff and jitter, and after the last attempt parks the
 *   posting as dead for a person to look at.
 * - Reconciliation compares what was approved with what the ledger holds.
 *
 * Pure and deterministic given the clock and the random source, so property tests can run
 * thousands of failure schedules.
 */
import { normalizeId } from "./normalize.js";

export interface PostingRequest {
  key: string;
  vendorId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
}

export interface LedgerEntryPosted extends PostingRequest {
  entryNo: number;
  postedAt: number;
}

export type LedgerResponse =
  | { kind: "posted"; entry: LedgerEntryPosted }
  | { kind: "already_posted"; entry: LedgerEntryPosted }
  | { kind: "unavailable" }
  /** The ledger may or may not have posted it: the answer never arrived. */
  | { kind: "no_answer" };

/** One way the ledger misbehaves on the next calls. */
export type Fault = "unavailable" | "no_answer";

export function idempotencyKey(vendorId: string, invoiceNumber: string): string {
  return `${vendorId}:${normalizeId(invoiceNumber)}`;
}

/** A ledger API that keeps the first posting per idempotency key. Faults are queued per call. */
export class FakeLedger {
  private readonly byKey = new Map<string, LedgerEntryPosted>();
  private nextEntry: number;
  readonly faults: Fault[] = [];

  constructor(firstEntryNo = 1001) {
    this.nextEntry = firstEntryNo;
  }

  get entries(): LedgerEntryPosted[] {
    return [...this.byKey.values()].sort((a, b) => a.entryNo - b.entryNo);
  }

  post(req: PostingRequest, now: number): LedgerResponse {
    const fault = this.faults.shift();
    if (fault === "unavailable") return { kind: "unavailable" };
    const existing = this.byKey.get(req.key);
    let response: LedgerResponse;
    if (existing) {
      response = { kind: "already_posted", entry: existing };
    } else {
      const entry: LedgerEntryPosted = { ...req, entryNo: this.nextEntry++, postedAt: now };
      this.byKey.set(req.key, entry);
      response = { kind: "posted", entry };
    }
    // Posted (or found), but the answer is lost on the way back.
    return fault === "no_answer" ? { kind: "no_answer" } : response;
  }
}

export interface Attempt {
  at: number;
  response: LedgerResponse["kind"];
  entryNo?: number;
}

export interface OutboxItem {
  request: PostingRequest;
  state: "pending" | "posted" | "dead";
  attempts: Attempt[];
  /** When the next attempt is due (epoch ms); null once posted or dead. */
  nextAt: number | null;
  entryNo: number | null;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: Readonly<RetryPolicy> = Object.freeze({
  maxAttempts: 6,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
});

/** Exponential backoff with "equal jitter": half fixed, half random. */
export function backoff(attempt: number, policy: RetryPolicy, random: () => number): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export class Outbox {
  readonly items: OutboxItem[] = [];

  constructor(readonly policy: RetryPolicy = DEFAULT_RETRY) {}

  /** Adds a posting; the same key twice is the same posting. */
  enqueue(request: PostingRequest, now: number): OutboxItem {
    const existing = this.items.find((i) => i.request.key === request.key);
    if (existing) return existing;
    const item: OutboxItem = {
      request,
      state: "pending",
      attempts: [],
      nextAt: now,
      entryNo: null,
    };
    this.items.push(item);
    return item;
  }

  /** Sends every posting that is due once, and schedules what didn't get through. */
  deliver(ledger: FakeLedger, now: number, random: () => number): Attempt[] {
    const sent: Attempt[] = [];
    for (const item of this.items) {
      if (item.state !== "pending" || item.nextAt === null || item.nextAt > now) continue;
      const response = ledger.post(item.request, now);
      const attempt: Attempt = { at: now, response: response.kind };
      if (response.kind === "posted" || response.kind === "already_posted") {
        attempt.entryNo = response.entry.entryNo;
        item.state = "posted";
        item.entryNo = response.entry.entryNo;
        item.nextAt = null;
      } else if (item.attempts.length + 1 >= this.policy.maxAttempts) {
        item.state = "dead";
        item.nextAt = null;
      } else {
        item.nextAt = now + backoff(item.attempts.length + 1, this.policy, random);
      }
      item.attempts.push(attempt);
      sent.push(attempt);
    }
    return sent;
  }

  /** When the next posting is due, or null when nothing is waiting. */
  nextDue(): number | null {
    const due = this.items.flatMap((i) =>
      i.state === "pending" && i.nextAt !== null ? [i.nextAt] : [],
    );
    return due.length ? Math.min(...due) : null;
  }
}

export interface Reconciliation {
  /** Approved, but not in the ledger. */
  missing: string[];
  /** In the ledger, but never approved. */
  unexpected: string[];
  /** Keys with more than one entry (a ledger without idempotency would show these). */
  duplicates: string[];
  /** In the ledger with a different amount than approved. */
  amountMismatches: string[];
}

export function reconcile(
  approved: readonly PostingRequest[],
  ledger: readonly LedgerEntryPosted[],
): Reconciliation {
  const want = new Map(approved.map((r) => [r.key, r]));
  const counts = new Map<string, number>();
  for (const e of ledger) counts.set(e.key, (counts.get(e.key) ?? 0) + 1);
  return {
    missing: [...want.keys()].filter((k) => !counts.has(k)),
    unexpected: [...counts.keys()].filter((k) => !want.has(k)),
    duplicates: [...counts].filter(([, n]) => n > 1).map(([k]) => k),
    amountMismatches: ledger
      .filter((e) => want.has(e.key) && Math.abs(want.get(e.key)!.amount - e.amount) > 0.005)
      .map((e) => e.key),
  };
}
