/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // contracts/ and samples/ live one level up and are shared with the engine.
  server: { port: 5173, fs: { allow: [".."] } },
  test: { include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"], fileParallelism: false },
});
