/**
 * Contract between the Python pipeline and these checks: read perfectly, every sample invoice
 * gets exactly its known decision and reasons. When this fails after `npm run data`, either the
 * generator planted something it didn't record, or the checks changed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkInvoice,
  type Decision,
  type Invoice,
  REASON_CODES,
  reasonCodes,
  type World,
} from "../src/index.js";

interface Truth {
  id: string;
  situation: string;
  invoice: Invoice;
  decision: Decision;
  reasons: string[];
}

const DATA = join(import.meta.dirname, "..", "..", "..", "data");
const read = <T>(...path: string[]) => JSON.parse(readFileSync(join(DATA, ...path), "utf8")) as T;
const world = read<World>("world.json");
const truths = readdirSync(join(DATA, "truth"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => read<Truth>("truth", f));

describe("the generated sample data", () => {
  it("has a known answer per sample invoice, with known reason codes", () => {
    const cases = read<{ id: string }[]>("cases.json");
    expect(truths.map((t) => t.id).sort()).toEqual(cases.map((c) => c.id).sort());
    for (const t of truths) {
      for (const r of t.reasons) expect(REASON_CODES).toContain(r);
    }
  });

  it.each(truths.map((t) => [t.id, t.situation, t] as const))(
    "%s (%s): read perfectly, the checks give the known answer",
    (_id, _situation, truth) => {
      const result = checkInvoice({ invoice: truth.invoice, world });
      expect({ decision: result.decision, reasons: reasonCodes(result) }).toEqual({
        decision: truth.decision,
        reasons: truth.reasons,
      });
    },
  );
});
