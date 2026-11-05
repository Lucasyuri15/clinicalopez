import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança aplicados a todas as rotas.
 * A CSP completa (com nonces) entra na fase de autenticação.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  // Sistema interno com dados de saúde: nunca deve aparecer em buscadores.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // As telas autenticadas leem sessão (cookies) e banco, então a navegação até elas passa
  // pelo servidor. Validar "navegação instantânea" em TODA página só gera ruído no dev;
  // validamos só o que exporta `instant`. O `next build` continua barrando leitura de
  // cookies fora de <Suspense>. Revisar se um dia cachearmos a sessão (`use cache: private`).
  experimental: {
    instantInsights: { validationLevel: "manual-warning" },
  },
  poweredByHeader: false,
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
