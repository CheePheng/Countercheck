/** What /api/* returns. Shared by the Worker and the app; types only. */
import type { CheckResult } from "@countercheck/core";
import type { Extraction, FieldCheck } from "@countercheck/extract";

export interface MeterStatus {
  day: string;
  dailyCap: number;
  spent: number;
  reserved: number;
  available: number;
  visitorCallsLeft: number;
  live: boolean;
  resetsAt: number;
}

export interface ModelInfo {
  key: string;
  id: string;
  label: string;
}

export interface StatusResponse {
  live: MeterStatus;
  models: ModelInfo[];
}

/** One reading of one invoice by a model: what it said, what checked out, what the checks decided. */
export interface Reading {
  case: string;
  model: ModelInfo;
  promptVersion: string;
  /** ISO time the reading was made. */
  readAt: string;
  extraction: Extraction | null;
  /** Why no extraction came out, when none did. */
  error: string | null;
  attempts: number;
  neurons: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** The model's raw replies. */
  replies: string[];
  verification: { checks: FieldCheck[]; unverified: string[] } | null;
  result: Pick<CheckResult, "decision" | "findings" | "lines"> | null;
}

export interface ReadResponse extends Reading {
  meter: MeterStatus;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
