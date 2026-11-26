import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { World } from "@countercheck/core";
import type { Page } from "@countercheck/extract";
import { describe, expect, it } from "vitest";
import type { ReadResponse, StatusResponse } from "../src/api-types.js";
import { type ApiDeps, handleApi, type MeterApi } from "../worker/api.js";
import { type MeterConfig, MeterStore } from "../worker/meter-store.js";
import { memorySql } from "./sqlite.js";

const DATA = join(import.meta.dirname, "..", "..", "..", "data");
const world = JSON.parse(readFileSync(join(DATA, "world.json"), "utf8")) as World;
const page = (id: string) =>
  JSON.parse(readFileSync(join(DATA, "cases", `${id}.page.json`), "utf8")) as Page;
const cfg: MeterConfig = {
  dailyCap: 1500,
  callReserve: 100,
  visitorCallsPerDay: 5,
  reservationTtlMs: 300_000,
  live: true,
};

function meterApi(store = new MeterStore(memorySql())): MeterApi {
  return {
    async status(network) {
      return store.status(await store.visitor(network, Date.now()), Date.now(), cfg);
    },
    async reserve({ network, recorder }) {
      return store.reserve(
        { visitor: await store.visitor(network, Date.now()), recorder },
        Date.now(),
        cfg,
      );
    },
    async settle({ id, neurons, network }) {
      store.settle({ id, neurons }, Date.now());
      return store.status(await store.visitor(network, Date.now()), Date.now(), cfg);
    },
  };
}

/** The baseline's reading of an English-layout invoice, served as if a model had written it. */
function deps(over: Partial<ApiDeps> = {}): ApiDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    meter: meterApi(),
    ai: async (model, input) => {
      calls.push({ model, input });
      return {
        choices: [{ message: { content: "not json" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 600, neurons: 25 },
      };
    },
    page: async (id) => (/^inv-\d{2}$/.test(id) ? page(id) : null),
    world,
    network: "203.0.113",
    liveModels: ["gemma-4"],
    recorderKey: "secret",
    rateLimit: async () => true,
    aiTimeoutMs: 1000,
    ...over,
  };
}

const read = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://x/api/read", { method: "POST", body: JSON.stringify(body), headers });

describe("handleApi", () => {
  it("reports today's allowance and the live models", async () => {
    const res = await handleApi(new Request("https://x/api/status"), ["status"], deps());
    const body = (await res.json()) as StatusResponse;
    expect(body.live).toMatchObject({
      dailyCap: 1500,
      available: 1500,
      visitorCallsLeft: 5,
      live: true,
    });
    expect(body.models.map((m) => m.key)).toEqual(["gemma-4"]);
  });

  it("reads an invoice: model call, quote checks and invoice checks, metered", async () => {
    const ledger = JSON.parse(readFileSync(join(DATA, "cases.json"), "utf8")) as {
      id: string;
      layout: string;
    }[];
    const id = ledger.find((c) => c.layout === "ledger")!.id;
    const d = deps();
    const baseline = (await (
      await handleApi(read({ case: id, model: "baseline" }), ["read"], d)
    ).json()) as ReadResponse;
    expect(baseline.neurons).toBe(0);
    expect(d.calls).toHaveLength(0);
    d.ai = async (model, input) => {
      d.calls.push({ model, input });
      return {
        choices: [{ message: { content: JSON.stringify(baseline.extraction) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 600, neurons: 25 },
      };
    };
    const res = await handleApi(read({ case: id, model: "gemma-4" }), ["read"], d);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReadResponse;
    expect(body.attempts).toBe(1);
    expect(body.neurons).toBe(25);
    expect(body.verification?.unverified).toEqual([]);
    expect(body.result?.decision).toBeDefined();
    expect(body.meter).toMatchObject({ spent: 25, reserved: 0, visitorCallsLeft: 4 });
    const sent = (
      d.calls[0] as { input: { messages: { content: string }[]; chat_template_kwargs?: unknown } }
    ).input;
    expect(sent.messages[1]!.content).toContain(page(id).text);
    expect(sent.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("retries once and returns the error when the model never gives valid JSON", async () => {
    const d = deps();
    const body = (await (
      await handleApi(read({ case: "inv-01" }), ["read"], d)
    ).json()) as ReadResponse;
    expect(body.extraction).toBeNull();
    expect(body.attempts).toBe(2);
    expect(body.neurons).toBe(50);
    expect(body.error).toContain("no JSON");
  });

  it("refuses anything that isn't a known sample invoice and a live model", async () => {
    const d = deps();
    expect((await handleApi(read({ case: "../secrets" }), ["read"], d)).status).toBe(400);
    expect((await handleApi(read({ case: "inv-01", model: "gpt-x" }), ["read"], d)).status).toBe(
      400,
    );
    const missing = deps({ page: async () => null });
    expect((await handleApi(read({ case: "inv-99" }), ["read"], missing)).status).toBe(404);
    expect((await handleApi(new Request("https://x/api/read"), ["read"], d)).status).toBe(404);
    expect(d.calls).toHaveLength(0);
  });

  it("rate-limits visitors but not recorder calls", async () => {
    const d = deps({ rateLimit: async () => false });
    expect((await handleApi(read({ case: "inv-01", model: "baseline" }), ["read"], d)).status).toBe(
      429,
    );
    const res = await handleApi(
      read({ case: "inv-01", model: "baseline" }, { "x-countercheck-recorder": "secret" }),
      ["read"],
      d,
    );
    expect(res.status).toBe(200);
  });

  it("says so when the account's allowance is used up", async () => {
    const d = deps({
      ai: async () => {
        throw new Error(
          "AiError: 4006: you have used up your daily free allocation of 10,000 neurons",
        );
      },
    });
    const res = await handleApi(read({ case: "inv-01" }), ["read"], d);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "allowance_used" } });
  });

  it("counts a timed-out call at its estimate", async () => {
    const store = new MeterStore(memorySql());
    const d = deps({ meter: meterApi(store), ai: () => new Promise(() => {}), aiTimeoutMs: 20 });
    const res = await handleApi(read({ case: "inv-01" }), ["read"], d);
    expect(res.status).toBe(504);
    const visitor = await store.visitor("203.0.113", Date.now());
    expect(store.status(visitor, Date.now(), cfg).spent).toBe(100);
  });
});
