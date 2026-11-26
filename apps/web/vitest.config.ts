import { defineProject } from "vitest/config";

// Node-side tests of the Worker logic (meter, API). node:sqlite stands in for Durable Object
// SQLite, and a fake model stands in for Workers AI.
export default defineProject({
  test: { name: "web", include: ["test/**/*.test.ts"] },
});
