import { DatabaseSync } from "node:sqlite";
import type { SqlLike } from "../worker/meter-store.js";

/** node:sqlite in place of Durable Object SQLite: same SQL, one statement per call. */
export function memorySql(): SqlLike {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query: string, ...bindings: unknown[]) {
      const stmt = db.prepare(query);
      const params = bindings as (string | number | null)[];
      if (/^\s*(SELECT|WITH)/i.test(query)) {
        const rows = stmt.all(...params) as Record<string, unknown>[];
        return { toArray: () => rows };
      }
      stmt.run(...params);
      return { toArray: () => [] };
    },
  };
}
