import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A DAL de sessão (`getSessionState`/`requireUser`) contra o banco DEV de verdade: só o
 * `getClaims` do Supabase é simulado; o perfil vem pelo caminho REAL do app (`DATABASE_URL`
 * → `app_backend` → `authenticated` sob RLS). `session.test.ts` cobre a DAL com mocks e
 * `rls.test.ts` cobre a RLS isolada; aqui se prova que perfil inativo/removido/inexistente
 * NÃO vira sessão ("no-profile") de ponta a ponta. Dados fictícios.
 *
 * Os fixtures precisam estar COMMITADOS (a DAL usa outra conexão, que não enxerga uma
 * transação aberta do dono); por isso são criados pelo dono (`DIRECT_URL`) e apagados no fim.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);

const mocks = vi.hoisted(() => ({ getClaims: vi.fn() }));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T,>(fn: T) => fn, // sem memoização: cada chamada consulta o banco
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims: mocks.getClaims } }),
}));

import { assertMigrationTarget } from "./migration-guard";

const claimsFor = (userId: string, extra: Record<string, unknown> = {}) =>
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: userId, aal: "aal2", ...extra } },
    error: null,
  });

const redirectedTo = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.to;
    throw error;
  }
  return null;
};

describe.skipIf(!hasDb)("DAL de sessão (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const ids = {
    active: randomUUID(),
    inactive: randomUUID(),
    deleted: randomUUID(),
    noProfile: randomUUID(),
    toggled: randomUUID(),
  };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, id] of Object.entries(ids)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${id}, 'authenticated', 'authenticated', ${`dal-${key}-${id}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role, active, deleted_at) values
        (${ids.active}, 'Ativa Fictícia', 'reception', true, null),
        (${ids.inactive}, 'Inativo Fictício', 'admin', false, null),
        (${ids.deleted}, 'Removido Fictício', 'professional', true, now()),
        (${ids.toggled}, 'Alternada Fictícia', 'reception', true, null)`;
    } catch (error) {
      await cleanup(); // não deixa resíduo se a criação falhar no meio
      throw error;
    }
  });

  async function cleanup() {
    const all = Object.values(ids);
    await owner`delete from public.profiles where id = any(${all})`;
    await owner`delete from auth.users where id = any(${all})`;
  }

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await owner?.end({ timeout: 2 });
    }
  });

  beforeEach(() => {
    mocks.getClaims.mockReset();
  });

  it("perfil ativo: sessão ok, com o papel e o nome do BANCO", async () => {
    const { getSessionState } = await import("@/server/auth/session");
    claimsFor(ids.active);
    expect(await getSessionState()).toEqual({
      status: "ok",
      user: { userId: ids.active, role: "reception", fullName: "Ativa Fictícia" },
    });
  });

  it("o papel vem do banco, não do JWT (um claim 'role: admin' não promove ninguém)", async () => {
    const { getSessionState } = await import("@/server/auth/session");
    claimsFor(ids.active, { role: "admin", user_role: "admin", app_metadata: { role: "admin" } });
    expect(await getSessionState()).toMatchObject({ status: "ok", user: { role: "reception" } });
  });

  it("perfil INATIVO (mesmo sendo admin): sem acesso, e requireUser manda para /sem-acesso", async () => {
    const { getSessionState, requireRole, requireUser } = await import("@/server/auth/session");
    claimsFor(ids.inactive);
    expect(await getSessionState()).toEqual({ status: "no-profile" });
    expect(await redirectedTo(requireUser())).toBe("/sem-acesso");
    expect(await redirectedTo(requireRole("admin"))).toBe("/sem-acesso");
  });

  it("perfil REMOVIDO (deleted_at): sem acesso", async () => {
    const { getSessionState } = await import("@/server/auth/session");
    claimsFor(ids.deleted);
    expect(await getSessionState()).toEqual({ status: "no-profile" });
  });

  it("usuário do Auth SEM perfil: sem acesso", async () => {
    const { getSessionState } = await import("@/server/auth/session");
    claimsFor(ids.noProfile);
    expect(await getSessionState()).toEqual({ status: "no-profile" });
  });

  it("desativar o perfil vale na PRÓXIMA requisição, mesmo com o JWT ainda válido", async () => {
    const { getSessionState } = await import("@/server/auth/session");
    claimsFor(ids.toggled); // o mesmo JWT aal2 o tempo todo
    expect(await getSessionState()).toMatchObject({ status: "ok" });

    await owner`update public.profiles set active = false where id = ${ids.toggled}`;
    expect(await getSessionState()).toEqual({ status: "no-profile" });

    await owner`update public.profiles set active = true where id = ${ids.toggled}`;
    expect(await getSessionState()).toMatchObject({ status: "ok" });
  });
});
