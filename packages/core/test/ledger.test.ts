import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  backoff,
  DEFAULT_RETRY,
  FakeLedger,
  type Fault,
  idempotencyKey,
  Outbox,
  type PostingRequest,
  reconcile,
} from "../src/index.js";

const req = (n: number, amount = 100 + n): PostingRequest => ({
  key: idempotencyKey("V1", `INV-${n}`),
  vendorId: "V1",
  invoiceNumber: `INV-${n}`,
  amount,
  currency: "MYR",
});

/** Runs delivery rounds, jumping the clock to the next due time, until nothing is pending. */
function drain(outbox: Outbox, ledger: FakeLedger, random: () => number, start = 0): number {
  let now = start;
  for (let round = 0; round < 200; round++) {
    outbox.deliver(ledger, now, random);
    const next = outbox.nextDue();
    if (next === null) return now;
    now = next;
  }
  throw new Error("outbox didn't settle");
}

describe("idempotency keys", () => {
  it("ignore how the invoice number is written", () => {
    expect(idempotencyKey("V1", "inv 2291")).toBe(idempotencyKey("V1", "INV-2291"));
    expect(idempotencyKey("V1", "INV-2291")).not.toBe(idempotencyKey("V2", "INV-2291"));
  });
});

describe("FakeLedger", () => {
  it("keeps the first posting per key", () => {
    const ledger = new FakeLedger();
    expect(ledger.post(req(1), 0).kind).toBe("posted");
    const again = ledger.post(req(1), 5);
    expect(again.kind).toBe("already_posted");
    expect(ledger.entries).toHaveLength(1);
  });

  it("can post and still lose the answer", () => {
    const ledger = new FakeLedger();
    ledger.faults.push("no_answer");
    expect(ledger.post(req(1), 0).kind).toBe("no_answer");
    expect(ledger.entries).toHaveLength(1);
  });
});

describe("Outbox", () => {
  it("retries a lost answer and posts once", () => {
    const ledger = new FakeLedger();
    ledger.faults.push("no_answer", "unavailable");
    const outbox = new Outbox();
    const item = outbox.enqueue(req(1), 0);
    drain(outbox, ledger, () => 0.5);
    expect(item.state).toBe("posted");
    expect(item.attempts.map((a) => a.response)).toEqual([
      "no_answer",
      "unavailable",
      "already_posted",
    ]);
    expect(ledger.entries).toHaveLength(1);
  });

  it("backs off exponentially with jitter, up to a ceiling", () => {
    const p = DEFAULT_RETRY;
    expect(backoff(1, p, () => 0)).toBe(500);
    expect(backoff(1, p, () => 1)).toBe(1000);
    expect(backoff(4, p, () => 1)).toBe(8000);
    expect(backoff(20, p, () => 1)).toBe(30_000);
  });

  it("parks a posting as dead after the last attempt", () => {
    const ledger = new FakeLedger();
    ledger.faults.push(...Array<Fault>(10).fill("unavailable"));
    const outbox = new Outbox();
    const item = outbox.enqueue(req(1), 0);
    drain(outbox, ledger, () => 0.5);
    expect(item.state).toBe("dead");
    expect(item.attempts).toHaveLength(DEFAULT_RETRY.maxAttempts);
    expect(reconcile([req(1)], ledger.entries).missing).toEqual([req(1).key]);
  });

  it("treats the same posting enqueued twice as one", () => {
    const outbox = new Outbox();
    expect(outbox.enqueue(req(1), 0)).toBe(outbox.enqueue(req(1), 10));
    expect(outbox.items).toHaveLength(1);
  });

  it("posts every approved invoice exactly once, whatever the ledger does", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.constantFrom<Fault | "ok">("unavailable", "no_answer", "ok"), {
          maxLength: 12,
        }),
        fc.boolean(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (count, schedule, deliverTwice, jitter) => {
          const ledger = new FakeLedger();
          // "ok" leaves a call alone; faults hit the calls in order.
          for (const f of schedule) ledger.faults.push(...(f === "ok" ? [] : [f]));
          const approved = Array.from({ length: count }, (_, i) => req(i + 1));
          const outbox = new Outbox({ ...DEFAULT_RETRY, maxAttempts: 20 });
          for (const r of approved) outbox.enqueue(r, 0);
          // A second outbox replaying the same postings: a duplicate delivery.
          const replay = new Outbox({ ...DEFAULT_RETRY, maxAttempts: 20 });
          if (deliverTwice) for (const r of approved) replay.enqueue(r, 0);
          drain(outbox, ledger, () => jitter);
          drain(replay, ledger, () => jitter);
          const r = reconcile(approved, ledger.entries);
          return (
            ledger.entries.length === count &&
            r.missing.length === 0 &&
            r.duplicates.length === 0 &&
            r.unexpected.length === 0 &&
            outbox.items.every((i) => i.state === "posted")
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("reconcile", () => {
  it("names what is missing, unexpected, doubled or different", () => {
    const entries = [
      { ...req(1), entryNo: 1, postedAt: 0 },
      { ...req(2, 999), entryNo: 2, postedAt: 0 },
      { ...req(2, 999), entryNo: 3, postedAt: 0 },
      { ...req(9), entryNo: 4, postedAt: 0 },
    ];
    expect(reconcile([req(1), req(2), req(3)], entries)).toEqual({
      missing: [req(3).key],
      unexpected: [req(9).key],
      duplicates: [req(2).key],
      amountMismatches: [req(2).key, req(2).key],
    });
  });
});
