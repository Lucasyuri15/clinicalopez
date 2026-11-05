/**
 * Content Security Policy com nonce (puro: sem I/O, testável). O `proxy` gera um nonce
 * por requisição e o Next o aplica nos scripts e estilos que ele mesmo emite. Funciona
 * porque TODAS as rotas são renderizadas por requisição (ver `connection()` em
 * `src/app/layout.tsx`): um shell estático gerado no build não tem como levar o nonce.
 */

/** base64 sem espaço, `;` ou aspas: o nonce entra dentro da CSP, então não pode injetar diretivas. */
const NONCE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** 128 bits aleatórios, em base64. Único por requisição. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp({
  nonce,
  isDev,
}: {
  nonce: string;
  isDev: boolean;
}): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("nonce inválido: esperado base64 sem espaços ou ';'.");
  }

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        // O React usa eval no dev (reconstrução de erros do servidor); em produção não.
        ...(isDev ? ["'unsafe-eval'"] : []),
      ],
    ],
    // No dev o HMR injeta estilos sem nonce.
    ["style-src", ["'self'", isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`]],
    // O nonce vale para <style>/<link>, não para atributos `style=""`. O next/image emite
    // `style="color:transparent"` (e componentes de UI posicionam popups assim); sem isto a
    // CSP os bloqueia. Atributo de estilo não executa script, então o risco é só visual;
    // <style> e folhas de estilo continuam restritos ao nonce.
    ["style-src-attr", ["'unsafe-inline'"]],
    // `data:` só aqui: o QR Code do 2FA chega como data URI (SVG).
    ["img-src", ["'self'", "blob:", "data:"]],
    ["font-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    // Em http://localhost (dev) não há HTTPS para onde subir.
    ...(isDev ? [] : ([["upgrade-insecure-requests", []]] as [string, string[]][])),
  ];

  return directives
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}
