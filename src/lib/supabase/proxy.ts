import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { ACTIVITY_COOKIE, decideActivity, parseActivity } from "@/lib/auth/inactivity";
import type { Aal } from "@/lib/auth/route-guard";

import { finalizeCookieOptions, sessionCookieOptions } from "./cookie-options";
import { getPublicEnv } from "./env";

/**
 * Cookies de sessão do NOSSO projeto Supabase: `sb-<ref>-auth-token` (em pedaços `.0`, `.1`)
 * e `-code-verifier`. O `<ref>` sai da URL, igual ao `storageKey` padrão da biblioteca; assim
 * não se apaga o cookie de outro projeto Supabase aberto no mesmo host (ex.: `localhost`).
 */
function supabaseCookiePattern(url: string): RegExp {
  const ref = new URL(url).hostname.split(".")[0] ?? "";
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^sb-${escaped}-auth-token(?:-code-verifier)?(?:\\.\\d+)?$`);
}

/** O `signOut` é uma chamada de rede sem prazo próprio: não pode prender a requisição. */
const SIGN_OUT_TIMEOUT_MS = 3000;

/** Mesma proteção anti-cache que a biblioteca põe nas respostas que mexem na sessão. */
const NO_STORE = {
  "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0",
  pragma: "no-cache",
  expires: "0",
} as const;

/**
 * Sessão encerrada por inatividade: remove da requisição e apaga no navegador os cookies
 * do Supabase E o de atividade. Feito aqui, sem depender do `signOut` (que falha se a rede
 * cair e, então, deixaria o token no navegador): falha fechada.
 */
function endSession(
  request: NextRequest,
  names: string[],
  nodeEnv: string | undefined,
): NextResponse {
  names.forEach((name) => request.cookies.delete(name));
  request.cookies.delete(ACTIVITY_COOKIE);

  const response = NextResponse.next({ request });
  // `Expires` na data zero além de `Max-Age=0`: o Next, ao mesclar os cookies do proxy na
  // resposta de uma Server Action, reparseia o Set-Cookie e descarta o `Max-Age=0`.
  const expired = { ...sessionCookieOptions(nodeEnv), maxAge: 0, expires: new Date(0) };
  [...names, ACTIVITY_COOKIE].forEach((name) => response.cookies.set(name, "", expired));
  Object.entries(NO_STORE).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}

/**
 * Renova a sessão do Supabase no `proxy` e lê o nível de autenticação (aal).
 * SÓ o proxy renova o token: refrescar em dois lugares desloga o usuário.
 * Server Components e Server Actions apenas leem a sessão.
 *
 * `getClaims()` verifica a assinatura do JWT (JWKS, ES256), sem chamada de rede
 * quando o token ainda é válido. Erro ao verificar conta como "sem sessão".
 *
 * Também aplica o timeout de inatividade (cookie `ls_activity`, regras em
 * `@/lib/auth/inactivity`): passou de 30 min sem atividade → encerra a sessão e devolve
 * `aal: null`. A decisão sai SÓ dos cookies e vem ANTES do `getClaims`: assim vale mesmo
 * que o Auth/JWKS esteja fora do ar e não renova o token de uma sessão que vai acabar.
 * (Prefetch NÃO é tratado à parte: o Next remove os cabeçalhos dele antes do `proxy`.)
 */
export async function updateSession(
  request: NextRequest,
  options: { nowMs?: number } = {},
): Promise<{ response: NextResponse; aal: Aal }> {
  const { nowMs = Date.now() } = options;
  const { url, publishableKey } = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: sessionCookieOptions(process.env.NODE_ENV),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        // Repassa o token novo aos Server Components (request) e ao navegador (response).
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, finalizeCookieOptions(options, process.env.NODE_ENV)),
        );
        // Respostas que definem cookies de sessão nunca podem ser cacheadas.
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  const ownCookies = request.cookies
    .getAll()
    .map((cookie) => cookie.name)
    .filter((name) => supabaseCookiePattern(url).test(name));
  const hasTokenCookie = ownCookies.some((name) => !name.includes("code-verifier"));
  const decision = decideActivity({
    hasSession: hasTokenCookie,
    lastActivityMs: parseActivity(request.cookies.get(ACTIVITY_COOKIE)?.value, nowMs),
    nowMs,
  });

  if (decision === "expired") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Revoga o refresh token desta sessão no Supabase (só este aparelho).
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }),
        new Promise((resolve) => {
          timer = setTimeout(resolve, SIGN_OUT_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Segue: `endSession` apaga os cookies de qualquer forma.
    } finally {
      clearTimeout(timer);
    }
    return { response: endSession(request, ownCookies, process.env.NODE_ENV), aal: null };
  }

  const { data, error } = await supabase.auth.getClaims();
  // Sem sessão o Supabase devolve `data: null` (sem erro): normaliza para `null`.
  const claims = (error ? null : data?.claims) ?? null;
  const aal: Aal = claims ? (claims.aal === "aal2" ? "aal2" : "aal1") : null;

  // `response` pode ter sido trocada pelo `setAll` acima: o cookie vai na versão final.
  if (claims) {
    response.cookies.set(ACTIVITY_COOKIE, String(nowMs), sessionCookieOptions(process.env.NODE_ENV));
  } else if (decision === "no-session" && request.cookies.has(ACTIVITY_COOKIE)) {
    // Sem NENHUM cookie de sessão: o contador é resto de uma sessão antiga e, se ficasse,
    // expiraria o PRÓXIMO login. (Com cookie de sessão e `getClaims` falhando, o contador
    // fica: apagá-lo faria a sessão ressuscitar quando o Auth voltasse.)
    response.cookies.set(ACTIVITY_COOKIE, "", {
      ...sessionCookieOptions(process.env.NODE_ENV),
      maxAge: 0,
      expires: new Date(0),
    });
  }
  return { response, aal };
}
