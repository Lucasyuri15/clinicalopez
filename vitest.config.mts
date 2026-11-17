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
    // Os testes de integração falam com o Supabase dev (rede) e alguns de RLS rodam dezenas de
    // consultas: 5 s (o padrão) ficava a poucos décimos do limite e falhava de vez em quando
    // sem haver bug. Um teste realmente travado ainda falha, só mais tarde.
    testTimeout: 30_000,
  },
});
