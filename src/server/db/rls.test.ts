import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

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
  assertMigrationTarget(
    process.env.DIRECT_URL ?? "",
    process.env.MIGRATION_PROJECT_REF,
  );

  const owner = postgres(process.env.DIRECT_URL ?? "", {
    prepare: false,
    max: 1,
  });
  const db = drizzle(owner, { schema });
  afterAll(async () => {
    await owner.end({ timeout: 2 });
  });

  type Ids = {
    admin: string;
    reception: string;
    professional: string;
    inactive: string;
    deleted: string;
    stranger: string; // existe no Auth, mas não tem perfil
    newcomer: string; // existe no Auth, perfil ainda não criado
  };

  async function inTx(
    fn: (ctx: {
      tx: Tx;
      ids: Ids;
      as: (userId: string) => Promise<void>;
      asOwner: () => Promise<void>;
    }) => Promise<void>,
  ) {
    const ids: Ids = {
      admin: randomUUID(),
      reception: randomUUID(),
      professional: randomUUID(),
      inactive: randomUUID(),
      deleted: randomUUID(),
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
        ]);
        const asOwner = async () => {
          await tx.execute(sql`reset role`);
        };
        const as = async (userId: string) => {
          await asOwner();
          await applyUserContext(tx, userId);
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
          [ids.admin, ids.reception, ids.professional, ids.inactive, ids.deleted].sort(),
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

    it("ninguém apaga perfis fisicamente, nem o admin", async () => {
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
