import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Tx } from "./client";
import { assertMigrationTarget } from "./migration-guard";
import { profiles } from "./schema";
import * as schema from "./schema";
import { applyUserContext } from "./with-user";

/**
 * Testes de RLS da tabela `profiles`, contra o Supabase DEV (só dados fictícios).
 * Cada teste roda numa transação que é SEMPRE revertida: nada fica gravado.
 * Os fixtures são criados como `postgres` (dono) e as consultas rodam como
 * `authenticated` com o usuário em teste, exatamente como o `withUser` faz.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);

class Rollback extends Error {}

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

describe.skipIf(!hasDb)("RLS de profiles (integração, Supabase dev)", () => {
  // Sem efeitos colaterais no corpo do describe (o Vitest o executa mesmo quando a
  // suíte é pulada): a trava e a conexão ficam no beforeAll.
  let owner: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;

  beforeAll(() => {
    assertMigrationTarget(
      process.env.DIRECT_URL ?? "",
      process.env.MIGRATION_PROJECT_REF,
    );
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    db = drizzle(owner, { schema });
  });
  afterAll(async () => {
    await owner?.end({ timeout: 2 });
  });

  type Ids = {
    admin: string;
    reception: string;
    professional: string;
    inactive: string;
    deleted: string;
    inactiveAdmin: string;
    deletedAdmin: string;
    stranger: string; // existe no Auth, mas não tem perfil
    newcomer: string; // existe no Auth, perfil ainda não criado
  };

  async function inTx(
    fn: (ctx: {
      tx: Tx;
      ids: Ids;
      as: (userId: string, aal?: "aal1" | "aal2") => Promise<void>;
      asOwner: () => Promise<void>;
    }) => Promise<void>,
  ) {
    const ids: Ids = {
      admin: randomUUID(),
      reception: randomUUID(),
      professional: randomUUID(),
      inactive: randomUUID(),
      deleted: randomUUID(),
      inactiveAdmin: randomUUID(),
      deletedAdmin: randomUUID(),
      stranger: randomUUID(),
      newcomer: randomUUID(),
    };
    try {
      await db.transaction(async (tx) => {
        for (const [key, id] of Object.entries(ids)) {
          await tx.execute(
            sql`insert into auth.users (id, aud, role, email) values (${id}, 'authenticated', 'authenticated', ${`${key}-${id}@teste.invalid`})`,
          );
        }
        await tx.insert(profiles).values([
          { id: ids.admin, fullName: "Admin Fictício", role: "admin" },
          { id: ids.reception, fullName: "Recepção Fictícia", role: "reception" },
          {
            id: ids.professional,
            fullName: "Profissional Fictício",
            role: "professional",
          },
          {
            id: ids.inactive,
            fullName: "Inativo Fictício",
            role: "reception",
            active: false,
          },
          {
            id: ids.deleted,
            fullName: "Removido Fictício",
            role: "professional",
            deletedAt: new Date(),
          },
          {
            id: ids.inactiveAdmin,
            fullName: "Admin Inativo Fictício",
            role: "admin",
            active: false,
          },
          {
            id: ids.deletedAdmin,
            fullName: "Admin Removido Fictício",
            role: "admin",
            deletedAt: new Date(),
          },
        ]);
        const asOwner = async () => {
          await tx.execute(sql`reset role`);
        };
        const as = async (userId: string, aal?: "aal1" | "aal2") => {
          await asOwner();
          await applyUserContext(tx, userId, aal);
        };
        await fn({ tx, ids, as, asOwner });
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  const visibleIds = async (tx: Tx, ids: Ids) =>
    (
      await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(inArray(profiles.id, Object.values(ids)))
    )
      .map((row) => row.id)
      .sort();

  describe("leitura", () => {
    it("admin lê todos os perfis, inclusive inativos e removidos", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.admin);
        const seen = await visibleIds(tx, ids);
        expect(seen).toEqual(
          [
            ids.admin,
            ids.reception,
            ids.professional,
            ids.inactive,
            ids.deleted,
            ids.inactiveAdmin,
            ids.deletedAdmin,
          ].sort(),
        );
      });
    });

    it("recepção lê só o próprio perfil", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.reception);
        expect(await visibleIds(tx, ids)).toEqual([ids.reception]);
      });
    });

    it("profissional lê só o próprio perfil", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.professional);
        expect(await visibleIds(tx, ids)).toEqual([ids.professional]);
      });
    });

    it("usuário sem perfil não lê nada", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.stranger);
        expect(await visibleIds(tx, ids)).toEqual([]);
      });
    });

    it("usuário inativo não lê nem o próprio perfil", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.inactive);
        expect(await visibleIds(tx, ids)).toEqual([]);
      });
    });

    it("usuário removido (soft delete) não lê nem o próprio perfil", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.deleted);
        expect(await visibleIds(tx, ids)).toEqual([]);
      });
    });
  });

  describe("admin sem acesso ativo perde tudo", () => {
    it("admin inativo não lê nenhum perfil, nem o próprio", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.inactiveAdmin);
        expect(await visibleIds(tx, ids)).toEqual([]);
      });
    });

    it("admin removido (soft delete) não lê nenhum perfil, nem o próprio", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.deletedAdmin);
        expect(await visibleIds(tx, ids)).toEqual([]);
      });
    });

    it("admin inativo não cria perfis", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.inactiveAdmin);
        let code: string | undefined;
        try {
          await tx
            .insert(profiles)
            .values({ id: ids.newcomer, fullName: "Novo", role: "reception" });
        } catch (error) {
          code = pgCode(error);
        }
        expect(code).toBe("42501");
      });
    });
  });

  describe("2FA (aal2) é obrigatório também para quem fala direto com a Data API", () => {
    // Um JWT só de senha (aal1) vale na Data API do Supabase. A RLS precisa barrar.
    it("admin com JWT aal1 não lê nenhum perfil", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.admin, "aal1");
        expect(await visibleIds(tx, ids)).toEqual([]);
      });
    });

    it("usuário comum com JWT aal1 não lê nem o próprio perfil", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.reception, "aal1");
        expect(await visibleIds(tx, ids)).toEqual([]);
      });
    });

    it("admin com JWT aal1 não cria nem altera perfis", async () => {
      await inTx(async ({ tx, ids, as, asOwner }) => {
        await as(ids.admin, "aal1");
        const updated = await tx
          .update(profiles)
          .set({ role: "reception" })
          .where(eq(profiles.id, ids.professional))
          .returning({ id: profiles.id });
        expect(updated).toEqual([]);

        // Confere (como dono) que nada mudou ANTES do INSERT: um erro aborta a transação.
        await asOwner();
        const [row] = await tx.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, ids.professional));
        expect(row?.role).toBe("professional");

        await as(ids.admin, "aal1");
        let code: string | undefined;
        try {
          await tx.insert(profiles).values({ id: ids.newcomer, fullName: "Novo", role: "reception" });
        } catch (error) {
          code = pgCode(error);
        }
        expect(code).toBe("42501");
      });
    });

    it("o mesmo admin com aal2 continua funcionando", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.admin, "aal2");
        expect((await visibleIds(tx, ids)).length).toBeGreaterThan(1);
      });
    });
  });

  describe("anon", () => {
    it("anon não lê profiles nem executa a função de papel", async () => {
      await inTx(async ({ tx, asOwner }) => {
        await asOwner();
        await tx.execute(sql`set local role anon`);
        let selectCode: string | undefined;
        try {
          await tx.select({ id: profiles.id }).from(profiles);
        } catch (error) {
          selectCode = pgCode(error);
        }
        expect(selectCode).toBe("42501");
      });
      await inTx(async ({ tx, asOwner }) => {
        await asOwner();
        await tx.execute(sql`set local role anon`);
        let fnCode: string | undefined;
        try {
          await tx.execute(sql`select app.current_app_role()`);
        } catch (error) {
          fnCode = pgCode(error);
        }
        expect(fnCode).toBe("42501");
      });
    });
  });

  describe("escrita", () => {
    it("recepção não consegue promover o próprio papel", async () => {
      await inTx(async ({ tx, ids, as, asOwner }) => {
        await as(ids.reception);
        const updated = await tx
          .update(profiles)
          .set({ role: "admin" })
          .where(eq(profiles.id, ids.reception))
          .returning({ id: profiles.id });
        expect(updated).toEqual([]);

        await asOwner();
        const [row] = await tx
          .select({ role: profiles.role })
          .from(profiles)
          .where(eq(profiles.id, ids.reception));
        expect(row?.role).toBe("reception");
      });
    });

    it("profissional não cria perfis", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.professional);
        let code: string | undefined;
        try {
          await tx
            .insert(profiles)
            .values({ id: ids.newcomer, fullName: "Novo", role: "admin" });
        } catch (error) {
          code = pgCode(error);
        }
        expect(code).toBe("42501");
      });
    });

    it("usuário sem perfil não consegue se auto-criar como admin (bootstrap)", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.stranger);
        let code: string | undefined;
        try {
          await tx
            .insert(profiles)
            .values({ id: ids.stranger, fullName: "Intruso", role: "admin" });
        } catch (error) {
          code = pgCode(error);
        }
        expect(code).toBe("42501");
      });
    });

    it("recepção e usuário inativo não criam perfis", async () => {
      for (const who of ["reception", "inactive"] as const) {
        await inTx(async ({ tx, ids, as }) => {
          await as(ids[who]);
          let code: string | undefined;
          try {
            await tx
              .insert(profiles)
              .values({ id: ids.newcomer, fullName: "Novo", role: "reception" });
          } catch (error) {
            code = pgCode(error);
          }
          expect(code, who).toBe("42501");
        });
      }
    });

    it("usuário comum não edita nem o próprio nome (edição de perfil é só do admin na 1A-1)", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.professional);
        const updated = await tx
          .update(profiles)
          .set({ fullName: "Outro Nome" })
          .where(eq(profiles.id, ids.professional))
          .returning({ id: profiles.id });
        expect(updated).toEqual([]);
      });
    });

    it("admin cria perfis e altera papéis", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.admin);
        const created = await tx
          .insert(profiles)
          .values({ id: ids.newcomer, fullName: "Novo Fictício", role: "reception" })
          .returning({ id: profiles.id });
        expect(created).toHaveLength(1);

        const updated = await tx
          .update(profiles)
          .set({ role: "professional" })
          .where(eq(profiles.id, ids.reception))
          .returning({ role: profiles.role });
        expect(updated).toEqual([{ role: "professional" }]);
      });
    });

    it("ninguém apaga perfis fisicamente, nem o admin (não há grant de DELETE)", async () => {
      await inTx(async ({ tx, ids, as }) => {
        await as(ids.admin);
        let code: string | undefined;
        try {
          await tx.delete(profiles).where(eq(profiles.id, ids.reception));
        } catch (error) {
          code = pgCode(error);
        }
        expect(code).toBe("42501");
      });
    });
  });
});
