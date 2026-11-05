import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertMigrationTarget } from "./migration-guard";
import * as schema from "./schema";
import { applyUserContext, withUser } from "./with-user";

const USER_ID = "00000000-0000-4000-8000-000000000001";

describe("withUser (validação)", () => {
  it("recusa ID de usuário que não é UUID, sem tocar no banco", async () => {
    let called = false;
    await expect(
      withUser({ userId: "1; drop table profiles" }, async () => {
        called = true;
      }),
    ).rejects.toThrow(/userId/i);
    expect(called).toBe(false);
  });
});

// Integração: roda contra o Supabase DEV. Pulado sem .env.local (outra máquina/CI).
// O corpo do describe NÃO pode ter efeitos colaterais (o Vitest o executa mesmo
// quando a suíte é pulada): a trava e as conexões ficam no beforeAll.
const hasDb = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);

describe.skipIf(!hasDb)("withUser (integração, Supabase dev)", () => {
  let single: ReturnType<typeof postgres>;

  beforeAll(() => {
    // Nunca rodar testes de integração fora do projeto permitido.
    assertMigrationTarget(
      process.env.DIRECT_URL ?? "",
      process.env.MIGRATION_PROJECT_REF,
    );
    // max: 1 => a mesma conexão atende todas as consultas, então dá para provar
    // que o contexto do usuário não vaza depois da transação.
    single = postgres(process.env.DATABASE_URL ?? "", {
      prepare: false,
      max: 1,
    });
  });
  afterAll(async () => {
    await single?.end({ timeout: 2 });
  });

  it("assume o papel authenticated com o usuário informado", async () => {
    const result = await withUser({ userId: USER_ID }, async (tx) => {
      const rows = await tx.execute<{ u: string; uid: string }>(
        sql`select current_user as u, auth.uid()::text as uid`,
      );
      return rows[0];
    });
    expect(result).toEqual({ u: "authenticated", uid: USER_ID });
  });

  it("não vaza papel nem claims para a consulta seguinte na MESMA conexão", async () => {
    const db = drizzle(single, { schema });
    const inside = await db.transaction(async (tx) => {
      await applyUserContext(tx, USER_ID);
      const rows = await tx.execute<{ u: string }>(sql`select current_user as u`);
      return rows[0]?.u;
    });
    expect(inside).toBe("authenticated");

    const [after] = await single`
      select current_user as u, current_setting('request.jwt.claims', true) as claims`;
    expect(after?.u).toBe("app_backend");
    expect(after?.claims ?? "").toBe("");
  });

  it("app_backend, sem withUser, não consegue ler profiles", async () => {
    await expect(single`select * from public.profiles`).rejects.toMatchObject({
      code: "42501",
    });
  });
});
