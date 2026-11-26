/**
 * The sample data the app shows: the invoices, the world they are checked against, the known
 * answers (shown only after a decision), recorded readings and eval results. Readings load on
 * demand; everything else is small enough to bundle.
 */
import type { Decision, Invoice, World } from "@countercheck/core";
import type { Page } from "@countercheck/extract";
import casesJson from "../../../data/cases.json";
import worldJson from "../../../data/world.json";
import type { Reading } from "./api-types";

export interface CaseInfo {
  id: string;
  split: "dev" | "test";
  layout: string;
  pdf: string;
  image: string;
  page: string;
}

export interface Truth {
  id: string;
  situation: string;
  invoice: Invoice;
  decision: Decision;
  reasons: string[];
}

export interface EvalSummary {
  invoices: number;
  read: number;
  fieldAccuracy: number;
  allFieldsRight: number;
  decisionsRight: number;
  reasonsRight: number;
  falseApprovals: number;
  falseHolds: number;
  neurons: number;
  neuronsPerInvoice: number;
  secondsP50: number | null;
  secondsP95: number | null;
}

export interface EvalRow {
  id: string;
  split: "dev" | "test";
  situation: string;
  read: boolean;
  fieldsTotal: number;
  fieldsRight: number;
  wrong: string[];
  unverified: string[];
  decision: Decision;
  knownDecision: Decision;
  reasons: string[];
  knownReasons: string[];
  decisionRight: boolean;
  reasonsRight: boolean;
  falseApproval: boolean;
  falseHold: boolean;
  neurons: number;
  latencyMs: number | null;
}

export interface EvalResult {
  model: { key: string; label: string; id?: string };
  promptVersion: string | null;
  runAt: string;
  invoices: string[];
  summary: { all: EvalSummary; dev?: EvalSummary; test?: EvalSummary };
  /** Calls that failed (timeouts, errors); kept even after a later run read the invoice. */
  failures?: { id: string; status: number; message: string; at: string }[];
  cases: EvalRow[];
}

export const cases = casesJson as CaseInfo[];
export const world = worldJson as unknown as World;

const truthModules = import.meta.glob<Truth>("../../../data/truth/*.json", {
  eager: true,
  import: "default",
});
export const truths = new Map(Object.values(truthModules).map((t) => [t.id, t]));

const evalModules = import.meta.glob<EvalResult>("../../../data/evals/*.json", {
  eager: true,
  import: "default",
});
/** Models first, the no-AI baseline last. */
export const evals = Object.values(evalModules).sort(
  (a, b) => Number(a.model.key === "baseline") - Number(b.model.key === "baseline"),
);

const readingLoaders = import.meta.glob<Reading>("../../../data/readings/*/*.json", {
  import: "default",
});
const readingKey = (model: string, id: string) => `../../../data/readings/${model}/${id}.json`;

export const RECORDED_MODEL = "gemma-4";

export function hasRecording(id: string, model = RECORDED_MODEL): boolean {
  return readingKey(model, id) in readingLoaders;
}

export function loadRecording(id: string, model = RECORDED_MODEL): Promise<Reading> | null {
  const load = readingLoaders[readingKey(model, id)];
  return load ? load() : null;
}

const pages = new Map<string, Promise<Page>>();

export function loadPage(id: string): Promise<Page> {
  let p = pages.get(id);
  if (!p) {
    p = fetch(`/data/cases/${id}.page.json`).then((r) => {
      if (!r.ok) throw new Error(`page ${id}: HTTP ${r.status}`);
      return r.json() as Promise<Page>;
    });
    pages.set(id, p);
  }
  return p;
}

/** What a first-time visitor sees first: an invoice where the check matters. */
export const FIRST_CASE =
  cases.find((c) => c.split === "dev" && truths.get(c.id)?.situation === "bank_changed")?.id ??
  cases[0]!.id;
