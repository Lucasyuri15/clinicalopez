import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "./env";

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 * Crie UM POR REQUISIÇÃO (nunca compartilhe). Só leia a sessão aqui: a renovação
 * do token é feita pelo `proxy`. Em Server Components não dá para escrever cookies;
 * o try/catch evita erro e o proxy cuida da renovação.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getPublicEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Chamado de um Server Component: ignorar (o proxy renova a sessão).
        }
      },
    },
  });
}
