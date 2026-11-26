/**
 *   GET  /api/status   today's allowance and the models a visitor can use
 *   POST /api/read     { case, model }: one model reads one sample invoice; the quotes are
 *                      checked and the invoice is checked, all on the server. Model
 *                      "baseline" runs the template parser instead: no model, no neurons.
 *
 * The request names a sample invoice, never a document or a prompt, so this is no use as a
 * general model proxy. Every call is metered against the app's daily cap.
 */
import { checkInvoice, type World } from "@countercheck/core";
import {
  baselineExtract,
  type Extraction,
  type ExtractResult,
  extractInvoice,
  findModel,
  type ModelReply,
  type ModelRunner,
  type Page,
  PROMPT_VERSION,
  verifyExtraction,
} from "@countercheck/extract";
import type { MeterStatus, Reading, ReadResponse, StatusResponse } from "../src/api-types.js";
import { apiError, isAllowanceError, json, TimeoutError, withTimeout } from "./http.js";
import type { ReserveResult } from "./meter-store.js";

export interface MeterApi {
  status(network: string): Promise<MeterStatus>;
  reserve(opts: { network: string; recorder: boolean }): Promise<ReserveResult>;
  settle(opts: { id: string; neurons: number; network: string }): Promise<MeterStatus>;
}

export interface ApiDeps {
  meter: MeterApi;
  ai: (model: string, input: unknown) => Promise<unknown>;
  /** The text layer of a sample invoice, or null when there is no such case. */
  page: (caseId: string) => Promise<Page | null>;
  world: World;
  network: string;
  liveModels: string[];
  recorderKey?: string | undefined;
  rateLimit: () => Promise<boolean>;
  aiTimeoutMs: number;
}

const CASE_ID = /^inv-\d{2}$/;

function liveModels(deps: ApiDeps) {
  return deps.liveModels
    .map((k) => findModel(k.trim()))
    .filter((m) => m !== undefined)
    .map(({ key, id, label }) => ({ key, id, label }));
}

export async function handleApi(
  request: Request,
  path: string[],
  deps: ApiDeps,
): Promise<Response> {
  if (path.length === 1 && path[0] === "status" && request.method === "GET") {
    const body: StatusResponse = {
      live: await deps.meter.status(deps.network),
      models: liveModels(deps),
    };
    return json(body);
  }
  if (path.length === 1 && path[0] === "read" && request.method === "POST") {
    return read(request, deps);
  }
  return apiError(404, "not_found", "Not found.");
}

/** Workers AI chat replies come as OpenAI-style choices or, for some models, a `response` field. */
export function toReply(raw: unknown): ModelReply {
  const r = (raw ?? {}) as {
    choices?: { message?: { content?: string | null } }[];
    response?: unknown;
    usage?: ModelReply["usage"];
  };
  const content =
    r.choices?.[0]?.message?.content ??
    (typeof r.response === "string" ? r.response : r.response ? JSON.stringify(r.response) : "");
  const text = (content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return r.usage ? { text, usage: r.usage } : { text };
}

async function read(request: Request, deps: ApiDeps): Promise<Response> {
  let body: { case?: unknown; model?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError(400, "invalid_request", "Send a JSON body: { case, model }.");
  }
  if (typeof body.case !== "string" || !CASE_ID.test(body.case)) {
    return apiError(400, "invalid_request", "case must be a sample invoice id such as inv-01.");
  }
  const recorder =
    !!deps.recorderKey && request.headers.get("x-countercheck-recorder") === deps.recorderKey;
  const page = await deps.page(body.case);
  if (!page) return apiError(404, "unknown_case", "There is no sample invoice with that id.");
  if (!recorder && !(await deps.rateLimit())) {
    return apiError(429, "rate_limited", "Too many readings at once. Try again in a minute.");
  }
  if (body.model === "baseline") return json(baselineReading(body.case, page, deps));

  const model = findModel(typeof body.model === "string" ? body.model : "gemma-4");
  if (!model || !liveModels(deps).some((m) => m.key === model.key)) {
    return apiError(400, "unknown_model", "That model isn't available for live readings.");
  }
  const reservation = await deps.meter.reserve({ network: deps.network, recorder });
  if (!reservation.ok) {
    return apiError(
      reservation.code === "live_off" ? 503 : 429,
      reservation.code,
      reservation.message,
    );
  }

  const started = Date.now();
  let timedOut = false;
  const run: ModelRunner = async (m, input) => {
    try {
      const raw = await withTimeout(
        deps.ai(m.id, {
          messages: input.messages,
          max_completion_tokens: input.max_tokens,
          temperature: input.temperature,
          ...(m.templateKwargs ? { chat_template_kwargs: m.templateKwargs } : {}),
        }),
        deps.aiTimeoutMs,
      );
      return toReply(raw);
    } catch (err) {
      if (err instanceof TimeoutError) timedOut = true;
      throw err;
    }
  };

  let result: ExtractResult;
  try {
    result = await extractInvoice(page.text, model, run);
  } catch (err) {
    // A timed-out call may still run and be billed, so it counts at the estimate.
    await deps.meter.settle({
      id: reservation.id,
      neurons: timedOut ? reservation.estimate : 0,
      network: deps.network,
    });
    if (timedOut) return apiError(504, "model_timeout", "The model didn't answer in time.");
    if (isAllowanceError(err)) {
      return apiError(
        503,
        "allowance_used",
        "The account's free AI allowance is used up for today.",
      );
    }
    console.error("workers ai call failed", model.id, String(err));
    return apiError(502, "model_error", "The model call failed.");
  }

  const meter = await deps.meter.settle({
    id: reservation.id,
    neurons: result.neurons,
    network: deps.network,
  });
  const response: ReadResponse = {
    ...finish(body.case, page, deps, result.extraction),
    model: { key: model.key, id: model.id, label: model.label },
    readAt: new Date(started).toISOString(),
    error: result.error,
    attempts: result.attempts,
    neurons: Math.round(result.neurons * 1000) / 1000,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: Date.now() - started,
    replies: result.replies,
    meter,
  };
  return json(response);
}

/** Checks the quotes, then the invoice: the same for a model's reading and the baseline's. */
function finish(caseId: string, page: Page, deps: ApiDeps, extraction: Extraction | null) {
  const verified = extraction ? verifyExtraction(extraction, page) : null;
  const checked = verified
    ? checkInvoice({
        invoice: verified.invoice,
        world: deps.world,
        unverified: verified.unverified,
      })
    : null;
  return {
    case: caseId,
    promptVersion: PROMPT_VERSION,
    extraction,
    verification: verified ? { checks: verified.checks, unverified: verified.unverified } : null,
    result: checked
      ? { decision: checked.decision, findings: checked.findings, lines: checked.lines }
      : null,
  };
}

/** The template parser through the same checks: no model, no neurons. */
function baselineReading(caseId: string, page: Page, deps: ApiDeps): Reading {
  const started = Date.now();
  const b = baselineExtract(page.text);
  return {
    ...finish(caseId, page, deps, b.extraction),
    model: { key: "baseline", id: "baseline", label: "Template parser (no AI)" },
    readAt: new Date(started).toISOString(),
    error: b.extraction ? null : `Couldn't find: ${b.missing.join(", ")}.`,
    attempts: 1,
    neurons: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: Date.now() - started,
    replies: [],
  };
}
