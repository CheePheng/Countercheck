/**
 * Neuron accounting for live readings: a daily cap for the whole app, a few readings per
 * visitor a day, and reservations that hold a call's estimate until its real cost is known.
 * Visitors are a hash of their network with a random key that changes daily; no address is
 * stored. Plain SQL over an interface, so tests run it on node:sqlite.
 */

export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

export interface MeterConfig {
  dailyCap: number;
  callReserve: number;
  visitorCallsPerDay: number;
  /** A reservation not settled within this time counts its estimate as spent. */
  reservationTtlMs: number;
  live: boolean;
}

export interface MeterStatus {
  day: string;
  dailyCap: number;
  spent: number;
  reserved: number;
  available: number;
  visitorCallsLeft: number;
  live: boolean;
  /** Epoch ms of the next 00:00 UTC. */
  resetsAt: number;
}

export type ReserveResult =
  | { ok: true; id: string; estimate: number }
  | { ok: false; code: "live_off" | "cap_reached" | "visitor_limit"; message: string };

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export class MeterStore {
  constructor(private readonly sql: SqlLike) {
    sql.exec(`CREATE TABLE IF NOT EXISTS days (
      day TEXT PRIMARY KEY, spent REAL NOT NULL DEFAULT 0, salt TEXT NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY, day TEXT NOT NULL, estimate REAL NOT NULL, created INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS visitors (
      day TEXT NOT NULL, visitor TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, visitor))`);
  }

  private ensureDay(day: string): { spent: number; salt: string } {
    const row = this.sql.exec("SELECT spent, salt FROM days WHERE day = ?", day).toArray()[0];
    if (row) return { spent: Number(row.spent), salt: String(row.salt) };
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    this.sql.exec("INSERT INTO days (day, spent, salt) VALUES (?, 0, ?)", day, salt);
    return { spent: 0, salt };
  }

  /** Expired reservations count as spent (the call may have run); old days are dropped. */
  private prune(now: number, cfg: MeterConfig): void {
    const expired = this.sql
      .exec(
        "SELECT id, day, estimate FROM reservations WHERE created < ?",
        now - cfg.reservationTtlMs,
      )
      .toArray();
    for (const r of expired) {
      this.ensureDay(String(r.day));
      this.sql.exec("UPDATE days SET spent = spent + ? WHERE day = ?", Number(r.estimate), r.day);
      this.sql.exec("DELETE FROM reservations WHERE id = ?", r.id);
    }
    const oldest = dayOf(now - 3 * 86_400_000);
    this.sql.exec("DELETE FROM days WHERE day < ?", oldest);
    this.sql.exec("DELETE FROM visitors WHERE day < ?", oldest);
  }

  async visitor(network: string, now: number): Promise<string> {
    const { salt } = this.ensureDay(dayOf(now));
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${salt}:${network}`),
    );
    return hex(new Uint8Array(digest)).slice(0, 24);
  }

  status(visitor: string, now: number, cfg: MeterConfig): MeterStatus {
    this.prune(now, cfg);
    const day = dayOf(now);
    const { spent } = this.ensureDay(day);
    const reserved = Number(
      this.sql
        .exec("SELECT COALESCE(SUM(estimate), 0) AS r FROM reservations WHERE day = ?", day)
        .toArray()[0]?.r ?? 0,
    );
    const calls = Number(
      this.sql
        .exec("SELECT calls FROM visitors WHERE day = ? AND visitor = ?", day, visitor)
        .toArray()[0]?.calls ?? 0,
    );
    const next = new Date(`${day}T00:00:00Z`).getTime() + 86_400_000;
    return {
      day,
      dailyCap: cfg.dailyCap,
      spent: Math.round(spent * 10) / 10,
      reserved,
      available: Math.max(0, Math.floor(cfg.dailyCap - spent - reserved)),
      visitorCallsLeft: Math.max(0, cfg.visitorCallsPerDay - calls),
      live: cfg.live,
      resetsAt: next,
    };
  }

  reserve(
    opts: { visitor: string; recorder: boolean },
    now: number,
    cfg: MeterConfig,
  ): ReserveResult {
    const s = this.status(opts.visitor, now, cfg);
    if (!cfg.live) {
      return { ok: false, code: "live_off", message: "Live readings are switched off for now." };
    }
    if (!opts.recorder && s.visitorCallsLeft <= 0) {
      return {
        ok: false,
        code: "visitor_limit",
        message: "You've used today's live readings. The recorded ones still work.",
      };
    }
    if (s.available < cfg.callReserve) {
      return {
        ok: false,
        code: "cap_reached",
        message:
          "Today's free AI allowance for this demo is used up. The recorded readings still work.",
      };
    }
    const id = hex(crypto.getRandomValues(new Uint8Array(12)));
    this.sql.exec(
      "INSERT INTO reservations (id, day, estimate, created) VALUES (?, ?, ?, ?)",
      id,
      s.day,
      cfg.callReserve,
      now,
    );
    if (!opts.recorder) {
      this.sql.exec(
        `INSERT INTO visitors (day, visitor, calls) VALUES (?, ?, 1)
         ON CONFLICT (day, visitor) DO UPDATE SET calls = calls + 1`,
        s.day,
        opts.visitor,
      );
    }
    return { ok: true, id, estimate: cfg.callReserve };
  }

  /** Replaces a reservation with what the call really cost. */
  settle(opts: { id: string; neurons: number }, now: number): void {
    const r = this.sql.exec("SELECT day FROM reservations WHERE id = ?", opts.id).toArray()[0];
    const day = r ? String(r.day) : dayOf(now);
    this.ensureDay(day);
    this.sql.exec("DELETE FROM reservations WHERE id = ?", opts.id);
    this.sql.exec(
      "UPDATE days SET spent = spent + ? WHERE day = ?",
      Math.max(0, opts.neurons),
      day,
    );
  }
}
