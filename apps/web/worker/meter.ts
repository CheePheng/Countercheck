import { DurableObject } from "cloudflare:workers";
import { type MeterConfig, MeterStore, type SqlLike } from "./meter-store.js";

export function meterConfig(env: Env): MeterConfig {
  const n = (v: string | undefined, fallback: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : fallback;
  };
  return {
    dailyCap: n(env.DAILY_NEURON_CAP, 1500),
    callReserve: n(env.CALL_RESERVE_NEURONS, 100),
    visitorCallsPerDay: n(env.VISITOR_CALLS_PER_DAY, 5),
    reservationTtlMs: 5 * 60_000,
    live: String(env.LIVE) !== "off",
  };
}

/** One instance keeps the whole app's daily count (a single writer keeps the cap exact). */
export class Meter extends DurableObject<Env> {
  private readonly store: MeterStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new MeterStore(ctx.storage.sql as unknown as SqlLike);
  }

  async status(network: string) {
    const now = Date.now();
    return this.store.status(await this.store.visitor(network, now), now, meterConfig(this.env));
  }

  async reserve(opts: { network: string; recorder: boolean }) {
    const now = Date.now();
    const visitor = await this.store.visitor(opts.network, now);
    return this.store.reserve({ visitor, recorder: opts.recorder }, now, meterConfig(this.env));
  }

  async settle(opts: { id: string; neurons: number; network: string }) {
    const now = Date.now();
    this.store.settle(opts, now);
    return this.store.status(
      await this.store.visitor(opts.network, now),
      now,
      meterConfig(this.env),
    );
  }
}
