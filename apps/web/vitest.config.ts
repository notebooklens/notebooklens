import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";


const __dirname = path.dirname(fileURLToPath(import.meta.url));


export default defineConfig({
  resolve: {
    alias: {
      "@": __dirname,
    },
  },
  esbuild: {
    // The root tsconfig sets jsx: "preserve" for Next's own SWC/Babel
    // transform; vitest's own esbuild-based transform needs to actually
    // compile JSX itself, so override it for the test run only.
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx"],
  },
});
