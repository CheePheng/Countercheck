import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "extract", include: ["test/**/*.test.ts"] },
});
