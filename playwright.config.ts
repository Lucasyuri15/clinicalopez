import { defineConfig, devices } from "@playwright/test";

import { HAS_SUPABASE } from "./e2e/support/env"; // carrega .env.local (Supabase dev)

const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2, // poucos workers: o servidor dev compila sob demanda e o Auth tem limite por IP
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    // Cria usuários fictícios no Supabase dev e uma sessão (com 2FA) por papel e projeto.
    { name: "setup", testMatch: /auth\.setup\.ts/, teardown: "cleanup" },
    { name: "cleanup", testMatch: /auth\.teardown\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      dependencies: ["setup"],
    },
  ],
  // Sem .env.local do Supabase todos os testes são pulados e o servidor nem precisa subir
  // (o proxy exige as variáveis; sem elas toda rota daria erro).
  webServer: HAS_SUPABASE
    ? {
        command: "pnpm dev",
        url: `http://localhost:${PORT}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
