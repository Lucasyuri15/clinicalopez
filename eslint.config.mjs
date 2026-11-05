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
          patterns: [
            {
              regex: "(^|/)db/client$",
              message:
                "Não importe o cliente cru do banco. Use `withUser` de '@/server/db/with-user'.",
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
