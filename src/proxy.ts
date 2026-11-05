import { NextResponse, type NextRequest } from "next/server";

import { decideRoute } from "@/lib/auth/route-guard";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Checagem OTIMISTA de autenticação em todas as rotas (só cookie/JWT, sem banco).
 * NÃO é a defesa principal: páginas, Server Actions e a DAL revalidam a sessão
 * e o papel (src/server/auth). Se faltarem as variáveis do Supabase, falha
 * (erro) em vez de liberar o acesso.
 */
export async function proxy(request: NextRequest) {
  // CSP com nonce por requisição. O Next lê o nonce do cabeçalho `Content-Security-Policy`
  // da REQUISIÇÃO ao renderizar, então ele é gravado aqui, antes de `updateSession` (que
  // monta a resposta com `NextResponse.next({ request })`), e SOBRESCREVE qualquer valor
  // enviado pelo cliente. A mesma CSP também vai no cabeçalho da resposta (o que vale
  // para o navegador). Sem cabeçalho `x-nonce`: o Next extrai o nonce da própria CSP e
  // nenhum código do app precisa lê-lo.
  const csp = buildCsp({
    nonce: generateNonce(),
    isDev: process.env.NODE_ENV === "development",
  });
  request.headers.set("content-security-policy", csp);

  const { response, aal } = await updateSession(request);
  response.headers.set("Content-Security-Policy", csp);
  const decision = decideRoute({ pathname: request.nextUrl.pathname, aal });
  if (decision.action === "next") return response;

  // Destino fixo no mesmo domínio; query descartada (nada de `?next=` aberto).
  const target = request.nextUrl.clone();
  target.pathname = decision.to;
  target.search = "";
  const redirect = NextResponse.redirect(target);
  redirect.headers.set("Content-Security-Policy", csp);

  // Mantém cookies renovados e cabeçalhos anti-cache da resposta do Supabase.
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

export const config = {
  // Exclui só estáticos do Next e assets públicos EXATOS (logo, ícone, robots). Os nomes
  // são ancorados (`$` / `/`): "/robots.txtX" ou "/icon.pngfoo" NÃO escapam do proxy.
  matcher: [
    "/((?!_next/static/|_next/image$|robots\\.txt$|icon\\.png$|favicon\\.ico$|brand/).*)",
  ],
};
