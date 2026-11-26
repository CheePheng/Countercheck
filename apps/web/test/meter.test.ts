import { describe, expect, it } from "vitest";
import { type MeterConfig, MeterStore } from "../worker/meter-store.js";
import { memorySql } from "./sqlite.js";

const cfg: MeterConfig = {
  dailyCap: 300,
  callReserve: 100,
  visitorCallsPerDay: 2,
  reservationTtlMs: 60_000,
  live: true,
};
const T0 = Date.parse("2026-11-26T10:00:00Z");

describe("MeterStore", () => {
  it("hashes visitors with a key that changes daily, and never stores the network", async () => {
    const m = new MeterStore(memorySql());
    const a = await m.visitor("203.0.113", T0);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(await m.visitor("203.0.113", T0 + 1000)).toBe(a);
    expect(await m.visitor("203.0.113", T0 + 86_400_000)).not.toBe(a);
    expect(await m.visitor("198.51.100", T0)).not.toBe(a);
  });

  it("holds an estimate, then settles what the call really cost", () => {
    const m = new MeterStore(memorySql());
    const r = m.reserve({ visitor: "v", recorder: false }, T0, cfg);
    expect(r.ok).toBe(true);
    expect(m.status("v", T0, cfg)).toMatchObject({
      reserved: 100,
      available: 200,
      visitorCallsLeft: 1,
    });
    if (r.ok) m.settle({ id: r.id, neurons: 27.5 }, T0);
    expect(m.status("v", T0, cfg)).toMatchObject({ spent: 27.5, reserved: 0, available: 272 });
  });

  it("limits each visitor per day, but not recorder runs", () => {
    const m = new MeterStore(memorySql());
    expect(m.reserve({ visitor: "v", recorder: false }, T0, cfg).ok).toBe(true);
    expect(m.reserve({ visitor: "v", recorder: false }, T0, cfg).ok).toBe(true);
    const third = m.reserve({ visitor: "v", recorder: false }, T0, cfg);
    expect(third).toMatchObject({ ok: false, code: "visitor_limit" });
    expect(m.reserve({ visitor: "v", recorder: true }, T0, cfg).ok).toBe(true);
  });

  it("stops at the daily cap, recorder runs included", () => {
    const m = new MeterStore(memorySql());
    for (let i = 0; i < 3; i++)
      expect(m.reserve({ visitor: `v${i}`, recorder: true }, T0, cfg).ok).toBe(true);
    expect(m.reserve({ visitor: "x", recorder: true }, T0, cfg)).toMatchObject({
      ok: false,
      code: "cap_reached",
    });
  });

  it("counts a reservation that was never settled as spent", () => {
    const m = new MeterStore(memorySql());
    m.reserve({ visitor: "v", recorder: false }, T0, cfg);
    expect(m.status("v", T0 + 61_000, cfg)).toMatchObject({ spent: 100, reserved: 0 });
  });

  it("starts each UTC day fresh and can be switched off", () => {
    const m = new MeterStore(memorySql());
    const r = m.reserve({ visitor: "v", recorder: false }, T0, cfg);
    if (r.ok) m.settle({ id: r.id, neurons: 250 }, T0);
    const tomorrow = Date.parse("2026-11-27T00:00:01Z");
    expect(m.status("v", tomorrow, cfg)).toMatchObject({
      day: "2026-11-27",
      spent: 0,
      visitorCallsLeft: 2,
    });
    expect(m.reserve({ visitor: "v", recorder: false }, T0, { ...cfg, live: false })).toMatchObject(
      {
        ok: false,
        code: "live_off",
      },
    );
  });
});
