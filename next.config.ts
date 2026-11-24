import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança estáticos aplicados a todas as rotas.
 * A Content-Security-Policy NÃO está aqui: ela leva um nonce por requisição e é montada
 * no `src/proxy.ts` (ver `src/lib/security/csp.ts`).
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
  // NÃO ligar `cacheComponents` nem `partialPrefetching`: eles geram um shell estático no
  // build, sem nonce, e a CSP (src/lib/security/csp.ts) bloquearia os scripts do framework
  // (React não hidrata). Medido no spike da 1A-3; guardado por
  // src/lib/security/dynamic-rendering.test.ts. Dados de paciente/agenda são por usuário
  // (RLS) e não devem ser cacheados de forma compartilhada de qualquer modo.
  poweredByHeader: false,
  experimental: {
    // Anexos clínicos (Fase 4B-1): o arquivo (até 4 MiB) sobe por uma Server Action, em multipart. O
    // padrão do Next é 1 MB. 5 MB deixa folga para o multipart e fica abaixo do teto da Vercel
    // (4,5 MB no corpo de uma função: por isso o limite de 4 MiB por arquivo). A ação confere o
    // tamanho antes de ler o arquivo; o banco e o bucket também o impõem.
    serverActions: { bodySizeLimit: "5mb" },
  },
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
