/**
 * One extraction: the prompt, a model call through an injected runner (the Worker's AI binding,
 * or a test double), and at most one retry when the reply doesn't match the schema.
 */
import { retryMessage, SYSTEM_PROMPT, userMessage } from "./prompt.js";
import { type Extraction, parseExtraction } from "./schema.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelInput {
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
}

export interface ModelReply {
  text: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; neurons?: number };
}

export type ModelRunner = (model: WorkersAiModel, input: ModelInput) => Promise<ModelReply>;

export interface WorkersAiModel {
  key: string;
  id: string;
  label: string;
  /** Neurons per million tokens (Workers AI pricing, checked 2026-11-26). */
  neuronsPerMTok: { input: number; output: number };
  /** Template options, e.g. thinking off for Gemma. */
  templateKwargs?: Record<string, unknown>;
}

export const WORKERS_AI_MODELS: readonly WorkersAiModel[] = [
  {
    key: "gemma-4",
    id: "@cf/google/gemma-4-26b-a4b-it",
    label: "Gemma 4 26B",
    neuronsPerMTok: { input: 9091, output: 27273 },
    templateKwargs: { enable_thinking: false },
  },
  {
    key: "mistral-small-3.1",
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    label: "Mistral Small 3.1 24B",
    neuronsPerMTok: { input: 31876, output: 50488 },
  },
];

export const findModel = (key: string) => WORKERS_AI_MODELS.find((m) => m.key === key);

/** Neurons for a call: what Workers AI reported, or the price table applied to the token counts. */
export function neuronsOf(model: WorkersAiModel, usage: ModelReply["usage"]): number {
  if (usage?.neurons !== undefined) return usage.neurons;
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;
  return (input * model.neuronsPerMTok.input + output * model.neuronsPerMTok.output) / 1e6;
}

export interface ExtractResult {
  extraction: Extraction | null;
  /** Why the last reply was refused, when no extraction came out. */
  error: string | null;
  attempts: number;
  neurons: number;
  inputTokens: number;
  outputTokens: number;
  /** The raw replies, for the trace and for debugging evals. */
  replies: string[];
}

export async function extractInvoice(
  pageText: string,
  model: WorkersAiModel,
  run: ModelRunner,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<ExtractResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage(pageText) },
  ];
  const result: ExtractResult = {
    extraction: null,
    error: null,
    attempts: 0,
    neurons: 0,
    inputTokens: 0,
    outputTokens: 0,
    replies: [],
  };
  while (result.attempts < 2) {
    result.attempts++;
    const reply = await run(model, {
      messages,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0,
    });
    result.replies.push(reply.text);
    result.neurons += neuronsOf(model, reply.usage);
    result.inputTokens += reply.usage?.prompt_tokens ?? 0;
    result.outputTokens += reply.usage?.completion_tokens ?? 0;
    const parsed = parseExtraction(reply.text);
    if (parsed.ok) {
      result.extraction = parsed.value;
      result.error = null;
      return result;
    }
    result.error = parsed.error;
    messages.push({ role: "assistant", content: reply.text });
    messages.push({ role: "user", content: retryMessage(parsed.error) });
  }
  return result;
}
