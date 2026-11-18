import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Tx } from "./client";
import { assertMigrationTarget } from "./migration-guard";
import { pgErrorCode } from "./pg-error";
import { profiles } from "./schema";
import * as schema from "./schema";
import { applyUserContext } from "./with-user";

/**
 * Apoio dos testes de RLS contra o Supabase DEV (só dados fictícios). Cada teste roda numa
 * transação SEMPRE revertida: nada fica gravado. Os fixtures são criados pelo dono
 * (`DIRECT_URL`) e as consultas rodam como `authenticated` com o usuário em teste, igual ao
 * `withUser`. Não é código de produção: só é importado por `*.test.ts`.
 */
export const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);

class Rollback extends Error {}

export { pgErrorCode as pgCode } from "./pg-error";

/**
 * Roda `fn` num savepoint que é SEMPRE desfeito e devolve o SQLSTATE do erro (ou `undefined`
 * se não houve erro). Um erro de SQL aborta a transação inteira; o savepoint deixa checar
 * vários erros (e depois voltar a consultar) no mesmo teste.
 */
export async function attempt(
  tx: Tx,
  fn: (tx: Tx) => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await tx.transaction(async (savepoint) => {
      await fn(savepoint as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (error instanceof Rollback) return undefined;
    return pgErrorCode(error) ?? "sem-código";
  }
  return undefined;
}

export type RlsIds = {
  admin: string;
  reception: string;
  professional: string;
  professional2: string; // segundo profissional (para provar que um não vê o outro)
  inactive: string; // recepção com perfil inativo
  deleted: string; // profissional removido (soft delete)
  stranger: string; // existe no Auth, mas não tem perfil
};

export type RlsContext = {
  tx: Tx;
  ids: RlsIds;
  /** Passa a agir como `userId` (papel `authenticated`, JWT com `aal2` por padrão). */
  as: (userId: string, aal?: "aal1" | "aal2") => Promise<void>;
  /** Volta a agir como dono (`postgres`), para montar fixtures e conferir o estado real. */
  asOwner: () => Promise<void>;
};

/** Cria os usuários e perfis fictícios (um INSERT de cada: cada ida ao banco remoto custa ~150 ms). */
async function createFixtureUsers(tx: Tx): Promise<RlsIds> {
  const ids: RlsIds = {
    admin: randomUUID(),
    reception: randomUUID(),
    professional: randomUUID(),
    professional2: randomUUID(),
    inactive: randomUUID(),
    deleted: randomUUID(),
    stranger: randomUUID(),
  };
  await tx.execute(
    sql`insert into auth.users (id, aud, role, email) values ${sql.join(
      Object.entries(ids).map(
        ([key, id]) => sql`(${id}, 'authenticated', 'authenticated', ${`${key}-${id}@teste.invalid`})`,
      ),
      sql`, `,
    )}`,
  );
  await tx.insert(profiles).values([
    { id: ids.admin, fullName: "Admin Fictício", role: "admin" },
    { id: ids.reception, fullName: "Recepção Fictícia", role: "reception" },
    { id: ids.professional, fullName: "Profissional Fictício", role: "professional" },
    { id: ids.professional2, fullName: "Profissional Dois Fictício", role: "professional" },
    { id: ids.inactive, fullName: "Inativo Fictício", role: "reception", active: false },
    { id: ids.deleted, fullName: "Removido Fictício", role: "professional", deletedAt: new Date() },
  ]);
  return ids;
}

/** `as` e `asOwner` de um contexto: o papel só dura até o fim da transação (ou do savepoint). */
function contextFor(tx: Tx, ids: RlsIds): RlsContext {
  const asOwner = async () => {
    await tx.execute(sql`reset role`);
  };
  const as = async (userId: string, aal?: "aal1" | "aal2") => {
    await asOwner();
    await applyUserContext(tx, userId, aal);
  };
  return { tx, ids, as, asOwner };
}

export function createRlsHarness() {
  let owner: ReturnType<typeof postgres> | undefined;
  let db: PostgresJsDatabase<typeof schema> | undefined;

  return {
    /** Chame no `beforeAll` (sem efeitos colaterais no corpo do `describe`). */
    connect() {
      assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
      owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
      db = drizzle(owner, { schema });
    },
    async close() {
      await owner?.end({ timeout: 2 });
    },
    /** Uma transação SÓ para o teste (usuários e fixtures novos), sempre revertida. */
    async inTx(fn: (context: RlsContext) => Promise<void>) {
      if (!db) throw new Error("Harness não conectado: chame connect() no beforeAll.");
      try {
        await db.transaction(async (tx) => {
          const ids = await createFixtureUsers(tx);
          await fn(contextFor(tx, ids));
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    },
    /**
     * Cenário COMPARTILHADO: os usuários e o fixture (`seedFn`) são criados UMA vez, numa transação
     * que fica aberta durante o arquivo de testes, e cada teste roda dentro de um SAVEPOINT sempre
     * desfeito (`run`). Montar o cenário é o grosso do custo de cada teste (muitas idas ao banco
     * remoto): assim se paga uma vez só. O isolamento é o mesmo: tudo o que o teste faz (inclusive
     * `set local role` e as gravações do dono) é desfeito ao fim do savepoint, e o próximo teste
     * começa de novo como dono, com o cenário intacto. Uso: `open()` no `beforeAll` (depois de
     * `connect()`), `close()` no `afterAll`, `run(...)` nos testes.
     */
    shared<S>(seedFn: (tx: Tx, ids: RlsIds) => Promise<S>) {
      let release: () => void = () => {};
      let finished: Promise<void> = Promise.resolve();
      let root: { tx: Tx; ids: RlsIds; seed: S } | undefined;
      return {
        async open() {
          const database = db;
          if (!database) throw new Error("Harness não conectado: chame connect() no beforeAll.");
          const released = new Promise<void>((resolve) => (release = resolve));
          let ready!: () => void;
          let failed!: (error: unknown) => void;
          const readyPromise = new Promise<void>((resolve, reject) => {
            ready = resolve;
            failed = reject;
          });
          finished = database
            .transaction(async (tx) => {
              try {
                const ids = await createFixtureUsers(tx);
                const seed = await seedFn(tx as unknown as Tx, ids);
                root = { tx: tx as unknown as Tx, ids, seed };
              } catch (error) {
                failed(error); // o `beforeAll` falha com o erro verdadeiro
                throw error;
              }
              ready();
              await released;
              throw new Rollback();
            })
            .then(
              () => undefined,
              () => undefined, // Rollback esperado, ou erro já entregue por `failed`
            );
          await readyPromise;
        },
        /** Desfaz TUDO (cenário e usuários) e libera a conexão. */
        async close() {
          release();
          await finished;
          root = undefined;
        },
        /** Roda o teste num savepoint que é SEMPRE desfeito. `seed` é o que `seedFn` devolveu. */
        async run(fn: (context: RlsContext & { seed: S }) => Promise<void>) {
          if (!root) throw new Error("Cenário compartilhado fechado: chame open() no beforeAll.");
          const { tx, ids, seed } = root;
          try {
            await tx.transaction(async (savepoint) => {
              await fn({ ...contextFor(savepoint as unknown as Tx, ids), seed });
              throw new Rollback();
            });
          } catch (error) {
            if (!(error instanceof Rollback)) throw error;
          }
        },
      };
    },
  };
}
