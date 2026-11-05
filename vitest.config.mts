import react from "@vitejs/plugin-react";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes de integração usam o Supabase DEV via .env.local (pulados se não existir).
config({ path: ".env.local", quiet: true });

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
