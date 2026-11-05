import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Aal } from "@/lib/auth/route-guard";

import { getPublicEnv } from "./env";

/**
 * Renova a sessão do Supabase no `proxy` e lê o nível de autenticação (aal).
 * SÓ o proxy renova o token: refrescar em dois lugares desloga o usuário.
 * Server Components e Server Actions apenas leem a sessão.
 *
 * `getClaims()` verifica a assinatura do JWT (JWKS, ES256), sem chamada de rede
 * quando o token ainda é válido. Erro ao verificar conta como "sem sessão".
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; aal: Aal }> {
  const { url, publishableKey } = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        // Repassa o token novo aos Server Components (request) e ao navegador (response).
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        // Respostas que definem cookies de sessão nunca podem ser cacheadas.
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const claims = error ? null : data?.claims;
  const aal: Aal = claims ? (claims.aal === "aal2" ? "aal2" : "aal1") : null;
  return { response, aal };
}
