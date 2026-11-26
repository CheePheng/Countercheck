import { defineConfig } from "vitest/config";

// Each workspace with a vitest config is a test project.
export default defineConfig({
  test: {
    projects: ["packages/*"],
  },
});
