import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  withUser: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T,>(fn: T) => fn, // sem memoização nos testes
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: mocks.getClaims },
  }),
}));
vi.mock("@/server/db/with-user", () => ({ withUser: mocks.withUser }));

import {
  getSessionState,
  requirePageAccess,
  requireRole,
  requireUser,
} from "./session";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const claimsOk = (aal = "aal2") => ({
  data: { claims: { sub: USER_ID, aal } },
  error: null,
});
const profile = (role: string) =>
  mocks.withUser.mockImplementation(async () => [
    { role, fullName: "Pessoa Fictícia" },
  ]);
const redirectedTo = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.to;
    throw error;
  }
  return null;
};

beforeEach(() => {
  mocks.getClaims.mockReset();
  mocks.withUser.mockReset();
});

describe("getSessionState", () => {
  it("sem claims: anônimo (e não consulta o banco)", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    expect(await getSessionState()).toEqual({ status: "anonymous" });
    expect(mocks.withUser).not.toHaveBeenCalled();
  });

  it("erro ao verificar o token: anônimo", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("falha") });
    expect(await getSessionState()).toEqual({ status: "anonymous" });
  });

  it("aal1 (2FA pendente) nunca é sessão válida", async () => {
    mocks.getClaims.mockResolvedValue(claimsOk("aal1"));
    expect(await getSessionState()).toEqual({ status: "anonymous" });
    expect(mocks.withUser).not.toHaveBeenCalled();
  });

  it("aal2 sem `sub` é anônimo", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { aal: "aal2" } }, error: null });
    expect(await getSessionState()).toEqual({ status: "anonymous" });
  });

  it("aal2 com perfil: devolve o usuário, consultando o banco COMO esse usuário", async () => {
    mocks.getClaims.mockResolvedValue(claimsOk());
    profile("reception");
    expect(await getSessionState()).toEqual({
      status: "ok",
      user: { userId: USER_ID, role: "reception", fullName: "Pessoa Fictícia" },
    });
    expect(mocks.withUser).toHaveBeenCalledWith({ userId: USER_ID }, expect.any(Function));
  });

  it("aal2 sem perfil (inexistente, inativo ou removido): sem acesso, não anônimo", async () => {
    mocks.getClaims.mockResolvedValue(claimsOk());
    mocks.withUser.mockResolvedValue([]);
    expect(await getSessionState()).toEqual({ status: "no-profile" });
  });
});

describe("requireUser", () => {
  it("anônimo vai para /login", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    expect(await redirectedTo(requireUser())).toBe("/login");
  });

  it("sem perfil vai para /sem-acesso (nunca /login: evita laço com o proxy)", async () => {
    mocks.getClaims.mockResolvedValue(claimsOk());
    mocks.withUser.mockResolvedValue([]);
    expect(await redirectedTo(requireUser())).toBe("/sem-acesso");
  });

  it("com perfil devolve o usuário", async () => {
    mocks.getClaims.mockResolvedValue(claimsOk());
    profile("admin");
    expect(await requireUser()).toMatchObject({ userId: USER_ID, role: "admin" });
  });
});

describe("requireRole", () => {
  it("permite o papel listado", async () => {
    mocks.getClaims.mockResolvedValue(claimsOk());
    profile("admin");
    expect(await requireRole("admin")).toMatchObject({ role: "admin" });
  });

  it("nega papel não listado, voltando ao dashboard com aviso", async () => {
    mocks.getClaims.mockResolvedValue(claimsOk());
    profile("professional");
    expect(await redirectedTo(requireRole("admin", "reception"))).toBe(
      "/dashboard?acesso=negado",
    );
  });
});

describe("requirePageAccess", () => {
  it("segue a matriz de acesso por tela", async () => {
    mocks.getClaims.mockResolvedValue(claimsOk());
    profile("reception");
    expect(await requirePageAccess("/financeiro")).toMatchObject({ role: "reception" });
    expect(await redirectedTo(requirePageAccess("/profissionais"))).toBe(
      "/dashboard?acesso=negado",
    );
    expect(await redirectedTo(requirePageAccess("/configuracoes"))).toBe(
      "/dashboard?acesso=negado",
    );
  });

  it("anônimo vai para /login antes de qualquer checagem de papel", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    expect(await redirectedTo(requirePageAccess("/dashboard"))).toBe("/login");
  });
});
