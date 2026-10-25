import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "virtual:pwa-register/react": fileURLToPath(new URL("./test/stubs/pwa-register-react.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    testTimeout: 60_000,
  },
});
