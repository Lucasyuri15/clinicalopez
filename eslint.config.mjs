import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // O cliente cru do banco (app_backend, sem usuário) só pode ser usado dentro de
  // src/server/db/. Código de negócio acessa dados SEMPRE via `withUser`, para a RLS valer.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "postgres",
              message:
                "Não crie conexões com o banco fora de src/server/db/. Use `withUser` de '@/server/db/with-user'.",
            },
            {
              name: "drizzle-orm/postgres-js",
              message:
                "Não crie clientes Drizzle fora de src/server/db/. Use `withUser` de '@/server/db/with-user'.",
            },
          ],
          patterns: [
            {
              regex: "(^|/)db/client$",
              message:
                "Não importe o cliente cru do banco. Use `withUser` (e o tipo `Tx`) de '@/server/db/with-user'.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
