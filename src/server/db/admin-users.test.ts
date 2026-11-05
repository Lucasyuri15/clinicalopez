import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  linkProfile,
  parseLinkArgs,
  parseResetMfaArgs,
  resetMfa,
} from "./admin-users";
import { assertMigrationTarget } from "./migration-guard";

describe("parseLinkArgs", () => {
  it("aceita e-mail, papel e nome", () => {
    expect(parseLinkArgs(["Maria@Clinica.com", "reception", "Maria Souza"])).toEqual({
      email: "maria@clinica.com",
      role: "reception",
      fullName: "Maria Souza",
      confirmed: false,
    });
  });

  it("--yes confirma (em qualquer posição) e não entra no nome", () => {
    expect(parseLinkArgs(["a@b.co", "admin", "Ana", "Lopez", "--yes"])).toMatchObject({ fullName: "Ana Lopez", confirmed: true });
    expect(parseLinkArgs(["--yes", "a@b.co", "admin", "Ana"])).toMatchObject({ fullName: "Ana", confirmed: true });
  });

  it("junta nome em várias palavras sem aspas e apara espaços", () => {
    expect(parseLinkArgs(["a@b.co", "admin", " Ana ", "Lopez "]).fullName).toBe("Ana Lopez");
  });

  it("recusa papel inválido, e-mail inválido e nome ausente (mensagens em pt-BR)", () => {
    expect(() => parseLinkArgs(["a@b.co", "hacker", "Nome"])).toThrow(/papel/i);
    expect(() => parseLinkArgs(["nao-e-email", "admin", "Nome"])).toThrow(/e-mail/i);
    expect(() => parseLinkArgs(["a@b.co", "admin"])).toThrow(/nome/i);
    expect(() => parseLinkArgs([])).toThrow(/uso/i);
  });
});

describe("parseResetMfaArgs", () => {
  it("lê o e-mail e a confirmação --yes", () => {
    expect(parseResetMfaArgs(["A@B.co"])).toEqual({ email: "a@b.co", confirmed: false });
    expect(parseResetMfaArgs(["a@b.co", "--yes"])).toEqual({ email: "a@b.co", confirmed: true });
  });

  it("recusa e-mail inválido, ausente ou argumentos extras", () => {
    expect(() => parseResetMfaArgs([])).toThrow(/uso/i);
    expect(() => parseResetMfaArgs(["x"])).toThrow(/e-mail/i);
    expect(() => parseResetMfaArgs(["a@b.co", "b@c.co"])).toThrow(/uso/i);
  });
});

// Integração: Supabase DEV, em transação SEMPRE revertida. Pulado sem .env.local.
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);

describe.skipIf(!hasDb)("admin-users (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  class Rollback extends Error {}

  beforeAll(() => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
  });
  afterAll(async () => {
    await owner?.end({ timeout: 2 });
  });

  async function inTx(fn: (tx: postgres.TransactionSql, user: { id: string; email: string }) => Promise<void>) {
    const id = randomUUID();
    const email = `cli-${id}@teste.invalid`;
    try {
      await owner.begin(async (tx) => {
        await tx`insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at,
          confirmation_token, recovery_token, email_change_token_new, email_change)
          values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated', ${email}, now(), now(), '', '', '', '')`;
        await fn(tx, { id, email });
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  it("linkProfile cria o perfil com o papel e o nome informados", async () => {
    await inTx(async (tx, user) => {
      const result = await linkProfile(tx, { email: user.email, role: "reception", fullName: "Recepção Fictícia" });
      expect(result).toEqual({ userId: user.id, created: true, previous: null });
      const [row] = await tx`select role, full_name, active, deleted_at from public.profiles where id = ${user.id}`;
      expect(row).toMatchObject({ role: "reception", full_name: "Recepção Fictícia", active: true, deleted_at: null });
    });
  });

  it("linkProfile é idempotente: atualiza papel/nome e reativa o perfil", async () => {
    await inTx(async (tx, user) => {
      await linkProfile(tx, { email: user.email, role: "reception", fullName: "Antigo" });
      await tx`update public.profiles set active = false, deleted_at = now() where id = ${user.id}`;
      const again = await linkProfile(tx, { email: user.email, role: "professional", fullName: "Novo Nome" });
      // devolve o estado ANTERIOR para o comando poder avisar/pedir confirmação
      expect(again).toEqual({
        userId: user.id,
        created: false,
        previous: { role: "reception", fullName: "Antigo", active: false, deleted: true },
      });
      const [row] = await tx`select role, full_name, active, deleted_at from public.profiles where id = ${user.id}`;
      expect(row).toMatchObject({ role: "professional", full_name: "Novo Nome", active: true, deleted_at: null });
    });
  });

  it("linkProfile reconhece o e-mail sem diferenciar maiúsculas", async () => {
    await inTx(async (tx, user) => {
      const result = await linkProfile(tx, { email: user.email.toUpperCase(), role: "admin", fullName: "Admin Fictício" });
      expect(result.userId).toBe(user.id);
    });
  });

  it("linkProfile explica quando o usuário não existe no Auth", async () => {
    await inTx(async (tx) => {
      await expect(
        linkProfile(tx, { email: "ninguem@teste.invalid", role: "admin", fullName: "X" }),
      ).rejects.toThrow(/Add user/);
    });
  });

  it("resetMfa remove fatores e sessões do usuário (e só dele)", async () => {
    await inTx(async (tx, user) => {
      const otherId = randomUUID();
      await tx`insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at,
          confirmation_token, recovery_token, email_change_token_new, email_change)
          values ('00000000-0000-0000-0000-000000000000', ${otherId}, 'authenticated', 'authenticated', ${`outro-${otherId}@teste.invalid`}, now(), now(), '', '', '', '')`;
      for (const uid of [user.id, otherId]) {
        await tx`insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, friendly_name)
          values (${randomUUID()}, ${uid}, 'totp', 'verified', now(), now(), ${`f-${uid}`})`;
        await tx`insert into auth.sessions (id, user_id, created_at, updated_at) values (${randomUUID()}, ${uid}, now(), now())`;
      }

      const result = await resetMfa(tx, { email: user.email });
      expect(result).toEqual({ userId: user.id, factorsRemoved: 1, sessionsRemoved: 1 });

      const mine = await tx`select (select count(*) from auth.mfa_factors where user_id = ${user.id})::int f, (select count(*) from auth.sessions where user_id = ${user.id})::int s`;
      expect(mine[0]).toEqual({ f: 0, s: 0 });
      const other = await tx`select (select count(*) from auth.mfa_factors where user_id = ${otherId})::int f, (select count(*) from auth.sessions where user_id = ${otherId})::int s`;
      expect(other[0]).toEqual({ f: 1, s: 1 });
    });
  });
});
