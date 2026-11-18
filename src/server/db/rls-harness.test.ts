import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { attempt, createRlsHarness, hasDb } from "./rls-harness";
import { insurances } from "./schema";

/**
 * O cenário COMPARTILHADO dos testes de RLS (`harness.shared`) só vale se cada teste continuar
 * isolado dos outros: tudo o que um teste faz (gravar, trocar de papel, até errar) tem de ser
 * desfeito antes do próximo. Este arquivo guarda essa garantia; se ela quebrar, os testes de RLS
 * passariam a depender da ordem em que rodam.
 */
describe.skipIf(!hasDb)("harness de RLS: cenário compartilhado isola cada teste (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared(async (tx) => {
    const [row] = await tx.insert(insurances).values({ name: "[teste] Convênio do cenário" }).returning({ id: insurances.id });
    return { insuranceId: row!.id };
  });
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  const nameOf = async (tx: Parameters<Parameters<typeof shared.run>[0]>[0]["tx"], id: string) =>
    (await tx.select({ name: insurances.name }).from(insurances).where(eq(insurances.id, id)))[0]?.name;
  const currentUser = async (tx: Parameters<Parameters<typeof shared.run>[0]>[0]["tx"]) =>
    (await tx.execute<{ u: string }>(sql`select current_user as u`))[0]?.u;

  it("o cenário existe em todo teste", async () => {
    await shared.run(async ({ tx, seed }) => {
      expect(await nameOf(tx, seed.insuranceId)).toBe("[teste] Convênio do cenário");
    });
  });

  it("um teste que ALTERA o cenário não afeta o seguinte (gravação do dono)", async () => {
    await shared.run(async ({ tx, seed }) => {
      await tx.update(insurances).set({ name: "[teste] ALTERADO" }).where(eq(insurances.id, seed.insuranceId));
      await tx.insert(insurances).values({ name: "[teste] Criado só neste teste" });
      expect(await nameOf(tx, seed.insuranceId)).toBe("[teste] ALTERADO");
    });
    await shared.run(async ({ tx, seed }) => {
      expect(await nameOf(tx, seed.insuranceId)).toBe("[teste] Convênio do cenário");
      const created = await tx.select({ id: insurances.id }).from(insurances).where(eq(insurances.name, "[teste] Criado só neste teste"));
      expect(created).toEqual([]);
    });
  });

  it("um teste que TROCA DE PAPEL (usuário e JWT) não vaza o papel para o seguinte: todo teste começa como dono", async () => {
    let owner = "";
    await shared.run(async ({ tx, ids, as }) => {
      owner = (await currentUser(tx)) ?? "";
      await as(ids.admin, "aal1");
      expect(await currentUser(tx)).toBe("authenticated");
    });
    await shared.run(async ({ tx }) => {
      expect(await currentUser(tx)).toBe(owner);
      expect(owner).not.toBe("authenticated");
      const [claims] = await tx.execute<{ c: string | null }>(sql`select nullif(current_setting('request.jwt.claims', true), '') as c`);
      expect(claims?.c).toBeNull(); // nem os claims do JWT do teste anterior
    });
  });

  it("um erro de SQL fora do `attempt` derruba só aquele teste; o seguinte roda normalmente", async () => {
    await expect(
      shared.run(async ({ tx }) => {
        await tx.execute(sql`select 1 from tabela_que_nao_existe`);
      }),
    ).rejects.toThrow();
    await shared.run(async ({ tx, seed }) => {
      expect(await nameOf(tx, seed.insuranceId)).toBe("[teste] Convênio do cenário");
    });
  });

  it("uma asserção que falha dentro do teste PROPAGA (o savepoint não engole falhas)", async () => {
    await expect(
      shared.run(async () => {
        throw new Error("falha do teste");
      }),
    ).rejects.toThrow("falha do teste");
  });

  it("`attempt` (savepoint aninhado) continua funcionando dentro do cenário compartilhado", async () => {
    await shared.run(async ({ tx, seed }) => {
      const code = await attempt(tx, (x) => x.insert(insurances).values({ name: "[teste] Convênio do cenário" }).returning());
      expect(code).toBe("23505"); // nome de convênio é único: o erro é desfeito pelo savepoint e a transação segue usável
      expect(await nameOf(tx, seed.insuranceId)).toBe("[teste] Convênio do cenário");
    });
  });
});
