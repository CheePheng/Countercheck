/**
 * The ledger side of an approval, simulated in the browser: an outbox that retries with backoff,
 * a ledger API that can be told to fail, idempotency keys so nothing posts twice, and a
 * reconciliation of what was approved against what the ledger holds.
 */
import {
  type Attempt,
  FakeLedger,
  Outbox,
  type OutboxItem,
  type PostingRequest,
  reconcile,
} from "@countercheck/core";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Faults {
  /** The ledger posts the first call but the answer is lost. */
  loseAnswer: boolean;
  /** The ledger is down for the first two calls. */
  down: boolean;
  /** The same posting is delivered a second time. */
  twice: boolean;
}

interface Sim {
  ledger: FakeLedger;
  outbox: Outbox;
  replay: Outbox;
  now: number;
}

export function useLedger() {
  const sim = useRef<Sim>({
    ledger: new FakeLedger(),
    outbox: new Outbox(),
    replay: new Outbox(),
    now: 0,
  });
  const [, setVersion] = useState(0);
  const [faults, setFaults] = useState<Faults>({ loseAnswer: true, down: false, twice: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const tick = useCallback(() => {
    const s = sim.current;
    s.outbox.deliver(s.ledger, s.now, Math.random);
    s.replay.deliver(s.ledger, s.now, Math.random);
    setVersion((v) => v + 1);
    const due = [s.outbox.nextDue(), s.replay.nextDue()].filter((n) => n !== null);
    if (due.length === 0) return;
    const at = Math.min(...due);
    // Simulated time runs about three times faster than real time.
    const wait = Math.max(450, (at - s.now) / 3);
    s.now = Math.max(s.now, at);
    timer.current = setTimeout(tick, wait);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const post = useCallback(
    (request: PostingRequest) => {
      const s = sim.current;
      if (s.outbox.items.some((i) => i.request.key === request.key)) return;
      if (faults.down) s.ledger.faults.push("unavailable", "unavailable");
      if (faults.loseAnswer) s.ledger.faults.push("no_answer");
      s.outbox.enqueue(request, s.now);
      if (faults.twice) s.replay.enqueue(request, s.now + 4000);
      clearTimeout(timer.current);
      timer.current = setTimeout(tick, 500);
    },
    [faults, tick],
  );

  return { sim: sim.current, faults, setFaults, post };
}

export type LedgerApi = ReturnType<typeof useLedger>;

function describe(a: Attempt, item: OutboxItem, index: number, replay: boolean): string {
  const nextWait =
    item.attempts[index + 1] !== undefined
      ? (item.attempts[index + 1]!.at - a.at) / 1000
      : item.nextAt !== null
        ? (item.nextAt - a.at) / 1000
        : null;
  const retry =
    nextWait !== null ? ` Trying again in ${nextWait.toFixed(1)} s with the same key.` : "";
  const who = replay ? "The same posting arrived a second time. " : "";
  switch (a.response) {
    case "posted":
      return `${who}Posted as ledger entry ${a.entryNo}.`;
    case "already_posted":
      return `${who}The ledger already had it (entry ${a.entryNo}), so nothing was posted twice.`;
    case "unavailable":
      return `${who}The ledger was down.${retry}`;
    case "no_answer":
      return `${who}No answer came back; the ledger may have posted it.${retry}`;
  }
}

export function LedgerPanel({ api, keyOf }: { api: LedgerApi; keyOf: string | null }) {
  const { sim, faults, setFaults } = api;
  const item = sim.outbox.items.find((i) => i.request.key === keyOf);
  const replayItem = sim.replay.items.find((i) => i.request.key === keyOf);
  const approved = sim.outbox.items.map((i) => i.request);
  const r = reconcile(approved, sim.ledger.entries);
  const toggle = (k: keyof Faults) => setFaults({ ...faults, [k]: !faults[k] });

  return (
    <div className="mt-4 rounded-[3px] border border-rule-faint p-3">
      <h4 className="font-[700]">Posting to the ledger</h4>
      <p className="text-[0.85rem] text-ink-soft">
        A simulated ledger API, running in your browser.
      </p>
      {item ? (
        <ol className="mt-2 space-y-1 text-[0.9rem]" aria-live="polite">
          {item.attempts.map((a, i) => (
            <li key={`a${a.at}-${a.response}`}>{describe(a, item, i, false)}</li>
          ))}
          {item.state === "pending" && item.attempts.length === 0 && <li>Sending…</li>}
          {item.state === "dead" && (
            <li className="font-[650] text-hold">
              Gave up after {item.attempts.length} attempts. It's parked for a person to post by
              hand.
            </li>
          )}
          {replayItem?.attempts.map((a, i) => (
            <li key={`r${a.at}-${a.response}`}>{describe(a, replayItem, i, true)}</li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[0.9rem]">Nothing posted for this invoice.</p>
      )}
      {approved.length > 0 && (
        <p className="mt-2 text-[0.9rem]">
          {`${approved.length} approved ${approved.length === 1 ? "invoice" : "invoices"}`},{" "}
          {sim.ledger.entries.length}{" "}
          {sim.ledger.entries.length === 1 ? "ledger entry" : "ledger entries"}:{" "}
          {r.duplicates.length === 0 && r.unexpected.length === 0 && r.amountMismatches.length === 0
            ? r.missing.length === 0
              ? "every one posted, none twice."
              : `${r.missing.length} not posted yet, none twice.`
            : `${r.duplicates.length} doubled, ${r.unexpected.length} unexpected, ${r.amountMismatches.length} with a different amount.`}
        </p>
      )}
      <details className="mt-2 text-[0.9rem]">
        <summary className="cursor-pointer text-ink-soft hover:text-ink">
          Make the ledger misbehave on your next approval
        </summary>
        <div className="mt-2 space-y-1">
          {(
            [
              ["loseAnswer", "Post it, but lose the answer"],
              ["down", "Be down for the first two calls"],
              ["twice", "Deliver the same posting twice"],
            ] as [keyof Faults, string][]
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={faults[k]}
                onChange={() => toggle(k)}
                className="accent-approve"
              />
              {label}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
