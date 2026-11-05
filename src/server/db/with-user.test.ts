import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { assertMigrationTarget } from "./migration-guard";
import { withUser } from "./with-user";

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
const hasDb = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);

describe.skipIf(!hasDb)("withUser (integração, Supabase dev)", () => {
  // Nunca rodar testes de integração fora do projeto permitido.
  assertMigrationTarget(
    process.env.DIRECT_URL ?? "",
    process.env.MIGRATION_PROJECT_REF,
  );

  const raw = postgres(process.env.DATABASE_URL ?? "", {
    prepare: false,
    max: 1,
  });
  afterAll(async () => {
    await raw.end({ timeout: 2 });
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

  it("não vaza o papel para a consulta seguinte na mesma conexão", async () => {
    await withUser({ userId: USER_ID }, async () => undefined);
    const [row] = await raw`select current_user as u`;
    expect(row?.u).toBe("app_backend");
  });

  it("app_backend, sem withUser, não consegue ler profiles", async () => {
    await expect(raw`select * from public.profiles`).rejects.toMatchObject({
      code: "42501",
    });
  });
});
