/**
 * Countercheck on Cloudflare Workers. Static assets (the app and the sample invoices) are served
 * without running this script; only /api/* reaches it (`run_worker_first`). On the Free plan a
 * request gets about 10 ms of CPU, which covers parsing one reply and running the checks.
 */
import type { World } from "@countercheck/core";
import type { Page } from "@countercheck/extract";
import cases from "../../../data/cases.json";
import world from "../../../data/world.json";
import { type ApiDeps, handleApi } from "./api.js";
import { apiError, visitorNetwork } from "./http.js";

export { Meter } from "./meter.js";

type RunAi = (model: string, input: unknown) => Promise<unknown>;
const CASE_IDS = new Set(cases.map((c) => c.id));

async function rateKey(network: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`rate:${network}`));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.split("/").filter(Boolean);
    if (path[0] !== "api") return env.ASSETS.fetch(request);

    const network = visitorNetwork(request.headers.get("cf-connecting-ip"));
    let key: string | undefined;
    const deps: ApiDeps = {
      meter: env.METER.get(env.METER.idFromName("global")),
      ai: (model, input) => (env.AI.run as unknown as RunAi)(model, input),
      async page(id) {
        if (!CASE_IDS.has(id)) return null;
        const res = await env.ASSETS.fetch(new URL(`/data/cases/${id}.page.json`, url));
        if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
        return (await res.json()) as Page;
      },
      world: world as unknown as World,
      network,
      liveModels: (env.LIVE_MODELS ?? "gemma-4").split(","),
      recorderKey: env.RECORDER_KEY,
      async rateLimit() {
        key ??= await rateKey(network);
        return (await env.EXTRACT_LIMIT.limit({ key })).success;
      },
      aiTimeoutMs: 45_000,
    };
    try {
      return await handleApi(request, path.slice(1), deps);
    } catch (err) {
      console.error("api request failed", String(err));
      return apiError(500, "server_error", "Something went wrong. Please try again.");
    }
  },
} satisfies ExportedHandler<Env>;
