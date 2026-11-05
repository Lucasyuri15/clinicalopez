/**
 * Opções dos cookies de sessão do Supabase. O padrão da biblioteca é `httpOnly: false`,
 * sem `Secure` e com 400 dias de validade. Como o app NÃO usa cliente Supabase no
 * navegador (tudo passa por Server Actions e pelo proxy), o JavaScript nunca precisa ler
 * o token: `HttpOnly` impede que um XSS futuro o roube. Validade de um expediente
 * (8 h) para computadores compartilhados da recepção.
 */
export function sessionCookieOptions(nodeEnv: string | undefined) {
  return {
    httpOnly: true,
    // Secure só com HTTPS (produção/Preview); em http://localhost o navegador o recusaria.
    secure: nodeEnv === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 8 * 60 * 60,
  };
}

/**
 * A biblioteca força `maxAge` de 400 dias ao GRAVAR o cookie e ignora o de `cookieOptions`.
 * Por isso aplicamos as opções finais no `setAll`, onde chega o que será enviado ao
 * navegador. `maxAge: 0` (apagar o cookie, no logout) é preservado.
 */
export function finalizeCookieOptions<T extends { maxAge?: number }>(
  options: T,
  nodeEnv: string | undefined,
): T {
  const session = sessionCookieOptions(nodeEnv);
  return {
    ...options,
    ...session,
    maxAge: options.maxAge === 0 ? 0 : session.maxAge,
  };
}
