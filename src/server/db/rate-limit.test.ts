import { createHash } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { APP_POSTGRES_OPTIONS } from "./client";
import { assertMigrationTarget } from "./migration-guard";

/**
 * Funções `app.rate_limit_*` e tabela `auth_attempts`, contra o Supabase DEV (só dados fictícios).
 * - LÓGICA: como dono (`postgres`), em transação SEMPRE revertida. As funções são
 *   SECURITY DEFINER, então o dono executa o mesmo código do `app_backend`.
 * - CAMINHO REAL: poucos testes pela `DATABASE_URL` (o `app_backend` de verdade); gravam de
 *   verdade e o dono limpa depois. IPs de documentação (TEST-NET), nada real.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);

class Rollback extends Error {}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const A = sha("rl-test-a");
const B = sha("rl-test-b");
const C = sha("rl-test-c");
const IP1 = "198.51.100.10";
const IP2 = "198.51.100.11";
const WINDOW = 900;

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

type Begin = {
  attempt_id: string;
  ip_failures: number;
  ip_last_age_s: number | null;
  pair_failures: number;
  pair_last_age_s: number | null;
  subject_failures: number;
};

describe.skipIf(!hasDb)("limite de tentativas: banco (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  let app: ReturnType<typeof postgres>;

  beforeAll(() => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1, onnotice: () => {} });
    // A configuração REAL do app (max 5, sem pipeline): 30 chamadas em paralelo ficam em fila.
    app = postgres(process.env.DATABASE_URL ?? "", { ...APP_POSTGRES_OPTIONS, onnotice: () => {} });
  });
  afterAll(async () => {
    await app?.end({ timeout: 2 });
    await owner?.end({ timeout: 2 });
  });

  /** Roda `fn` numa transação do dono e a reverte SEMPRE. */
  async function inRollback(fn: (tx: postgres.TransactionSql) => Promise<void>) {
    try {
      await owner.begin(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  const begin = async (
    tx: postgres.Sql | postgres.TransactionSql,
    p: { kind?: string; ip?: string; subject?: string; window?: number } = {},
  ): Promise<Begin> => {
    const rows = await tx<Begin[]>`
      select * from app.rate_limit_begin(${p.kind ?? "login"}, ${p.ip ?? IP1}, ${p.subject ?? A}, ${p.window ?? WINDOW})`;
    const row = rows[0];
    if (!row) throw new Error("rate_limit_begin não devolveu linha");
    return row;
  };
  const release = (tx: postgres.Sql | postgres.TransactionSql, id: string, forgive: boolean) =>
    tx`select app.rate_limit_release(${id}::bigint, ${forgive})`;

  describe("contagens (begin)", () => {
    it("primeira tentativa: nada antes dela, sem idade", async () => {
      await inRollback(async (tx) => {
        const first = await begin(tx);
        expect(first).toMatchObject({
          ip_failures: 0,
          ip_last_age_s: null,
          pair_failures: 0,
          pair_last_age_s: null,
          subject_failures: 0,
        });
        expect(first.attempt_id).toBeTruthy();
      });
    });

    it("cada begin conta as anteriores (sem contar a si mesma)", async () => {
      await inRollback(async (tx) => {
        await begin(tx);
        await begin(tx);
        const third = await begin(tx);
        expect(third).toMatchObject({ ip_failures: 2, pair_failures: 2, subject_failures: 2 });
        expect(third.pair_last_age_s).toBeGreaterThanOrEqual(0);
        expect(third.pair_last_age_s).toBeLessThan(5);
      });
    });

    it("o IP soma e-mails diferentes; o par e o e-mail não", async () => {
      await inRollback(async (tx) => {
        await begin(tx, { subject: A });
        await begin(tx, { subject: A });
        await begin(tx, { subject: B });
        const c = await begin(tx, { subject: C });
        expect(c).toMatchObject({ ip_failures: 3, pair_failures: 0, subject_failures: 0 });
      });
    });

    it("o e-mail soma IPs diferentes (alerta); o par e o IP não", async () => {
      await inRollback(async (tx) => {
        await begin(tx, { ip: IP1 });
        await begin(tx, { ip: IP1 });
        const other = await begin(tx, { ip: IP2 });
        expect(other).toMatchObject({ ip_failures: 0, pair_failures: 0, subject_failures: 2 });
      });
    });

    it("login e 2FA têm contagens separadas", async () => {
      await inRollback(async (tx) => {
        await begin(tx, { kind: "login" });
        await begin(tx, { kind: "login" });
        const mfa = await begin(tx, { kind: "mfa" });
        expect(mfa).toMatchObject({ ip_failures: 0, pair_failures: 0, subject_failures: 0 });
      });
    });

    it("janela deslizante: tentativas antigas deixam de contar; a idade é a da mais recente", async () => {
      await inRollback(async (tx) => {
        await begin(tx);
        await begin(tx);
        await tx`update public.auth_attempts set created_at = clock_timestamp() - interval '20 minutes'`;
        const afterWindow = await begin(tx);
        expect(afterWindow).toMatchObject({ ip_failures: 0, pair_failures: 0, pair_last_age_s: null });

        // Agora há 3 linhas (as 2 antigas + a de `afterWindow`): todas passam a ter 30 s.
        await tx`update public.auth_attempts set created_at = clock_timestamp() - interval '30 seconds'`;
        const aged = await begin(tx);
        expect(aged.pair_failures).toBe(3);
        expect(aged.pair_last_age_s).toBeGreaterThanOrEqual(29);
        expect(aged.pair_last_age_s).toBeLessThanOrEqual(32);
      });
    });

    it("apaga tentativas com mais de 1 dia (limpeza oportunista)", async () => {
      await inRollback(async (tx) => {
        await begin(tx);
        await tx`update public.auth_attempts set created_at = clock_timestamp() - interval '2 days'`;
        await begin(tx, { subject: B, ip: IP2 });
        const [{ n } = { n: -1 }] = await tx<{ n: number }[]>`
          select count(*)::int as n from public.auth_attempts where created_at < clock_timestamp() - interval '1 day'`;
        expect(n).toBe(0);
      });
    });
  });

  describe("liberação (release)", () => {
    it("sem perdão: apaga só esta tentativa (bloqueada), as falhas ficam", async () => {
      await inRollback(async (tx) => {
        await begin(tx);
        const second = await begin(tx);
        await release(tx, second.attempt_id, false);
        const third = await begin(tx);
        expect(third.pair_failures).toBe(1);
      });
    });

    it("com perdão (login certo): apaga esta e as falhas do MESMO par, e só dele", async () => {
      await inRollback(async (tx) => {
        await begin(tx, { subject: A, ip: IP1 });
        await begin(tx, { subject: A, ip: IP1 });
        await begin(tx, { subject: A, ip: IP2 }); // mesmo e-mail, outro IP
        await begin(tx, { subject: B, ip: IP1 }); // outro e-mail, mesmo IP
        const success = await begin(tx, { subject: A, ip: IP1 });
        await release(tx, success.attempt_id, true);

        const samePair = await begin(tx, { subject: A, ip: IP1 });
        expect(samePair.pair_failures).toBe(0);
        const otherIp = await begin(tx, { subject: A, ip: IP2 });
        expect(otherIp.pair_failures).toBe(1);
        const otherSubject = await begin(tx, { subject: B, ip: IP1 });
        expect(otherSubject.pair_failures).toBe(1);
      });
    });

    it("com perdão não apaga o 2FA do mesmo par (tipos separados)", async () => {
      await inRollback(async (tx) => {
        await begin(tx, { kind: "mfa" });
        const login = await begin(tx, { kind: "login" });
        await release(tx, login.attempt_id, true);
        const mfa = await begin(tx, { kind: "mfa" });
        expect(mfa.pair_failures).toBe(1);
      });
    });

    it("ID inexistente não dá erro nem apaga nada", async () => {
      await inRollback(async (tx) => {
        await begin(tx);
        await release(tx, "9223372036854775807", true);
        expect((await begin(tx)).pair_failures).toBe(1);
      });
    });
  });

  describe("validação de entrada (dados inválidos nunca viram linha)", () => {
    const rejects = async (run: (tx: postgres.TransactionSql) => Promise<unknown>, code: string) => {
      let caught: unknown;
      try {
        await owner.begin(async (tx) => {
          await run(tx);
          throw new Rollback();
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).not.toBeInstanceOf(Rollback);
      expect(pgCode(caught)).toBe(code);
    };

    it("tipo desconhecido é recusado", async () => {
      await rejects((tx) => begin(tx, { kind: "senha" }), "22023");
    });
    it("janela fora de 1 s a 24 h é recusada", async () => {
      await rejects((tx) => begin(tx, { window: 0 }), "22023");
      await rejects((tx) => begin(tx, { window: 86401 }), "22023");
    });
    it("hash do e-mail que não é SHA-256 hex é recusado", async () => {
      await rejects((tx) => begin(tx, { subject: "maria@exemplo.com" }), "23514");
    });
    it("IP vazio ou gigante é recusado", async () => {
      await rejects((tx) => begin(tx, { ip: "" }), "23514");
      await rejects((tx) => begin(tx, { ip: "x".repeat(65) }), "23514");
    });
  });

  describe("permissões (catálogo)", () => {
    it("a tabela tem RLS, nenhuma política e nenhum grant para anon, authenticated, PUBLIC ou app_backend", async () => {
      const [table] = await owner`
        select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
          (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = 'auth_attempts') as policies,
          c.relacl::text as acl
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'auth_attempts'`;
      expect(table).toMatchObject({ rls: true, policies: 0 });
      // ACL só do dono: nada de "=..." (PUBLIC) nem de anon/authenticated/app_backend
      expect(String(table?.acl ?? "")).not.toMatch(/(^|[{,])(=|anon=|authenticated=|app_backend=)/);

      for (const role of ["anon", "authenticated", "app_backend"]) {
        const [row] = await owner`
          select has_table_privilege(${role}, 'public.auth_attempts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as any_priv`;
        expect(row?.any_priv, role).toBe(false);
      }
    });

    it("as funções são SECURITY DEFINER com search_path vazio e só o app_backend as executa", async () => {
      const fns = await owner`
        select p.proname, p.prosecdef, ('search_path=""' = any (p.proconfig)) as empty_path, p.proacl::text as acl,
          has_function_privilege('app_backend', p.oid, 'EXECUTE') as app_backend,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname like 'rate_limit_%' order by p.proname`;
      expect(fns.map((f) => f.proname)).toEqual(["rate_limit_begin", "rate_limit_release"]);
      for (const fn of fns) {
        expect(fn.prosecdef, fn.proname).toBe(true);
        expect(fn.empty_path, `${fn.proname} com search_path vazio`).toBe(true);
        expect(String(fn.acl), `${fn.proname} sem PUBLIC`).not.toMatch(/(^|[{,])=/);
        expect(fn.app_backend, fn.proname).toBe(true);
        expect(fn.anon, fn.proname).toBe(false);
        expect(fn.authenticated, fn.proname).toBe(false);
      }
    });

    it("anon e authenticated nem enxergam o schema app além do que já tinham", async () => {
      const [row] = await owner`
        select has_schema_privilege('app_backend', 'app', 'USAGE') as app_backend,
               has_schema_privilege('anon', 'app', 'USAGE') as anon`;
      expect(row).toEqual({ app_backend: true, anon: false });
    });
  });

  describe("caminho real: como o app_backend (DATABASE_URL)", () => {
    const REAL_IP = "198.51.100.250";
    const REAL = sha("rl-test-real-path");
    const cleanup = () => owner`delete from public.auth_attempts where ip = ${REAL_IP}`;

    // (suíte pulada, sem .env.local, nem roda o afterAll)
    afterAll(async () => {
      await cleanup();
    });

    it("executa begin e release, mas NÃO lê nem escreve a tabela diretamente", async () => {
      await cleanup();
      const row = await begin(app, { ip: REAL_IP, subject: REAL });
      expect(row.pair_failures).toBe(0);

      await expect(app`select count(*) from public.auth_attempts`).rejects.toMatchObject({ code: "42501" });
      await expect(
        app`insert into public.auth_attempts (kind, ip, subject_hash) values ('login', ${REAL_IP}, ${REAL})`,
      ).rejects.toMatchObject({ code: "42501" });
      await expect(app`delete from public.auth_attempts`).rejects.toMatchObject({ code: "42501" });

      await release(app, row.attempt_id, true);
      const [{ n } = { n: -1 }] = await owner<{ n: number }[]>`
        select count(*)::int as n from public.auth_attempts where ip = ${REAL_IP}`;
      expect(n).toBe(0);
    });

    it("30 tentativas EM PARALELO são serializadas: cada uma enxerga um número diferente de falhas", async () => {
      // Sem o lock por IP/par, várias leriam "0 falhas" ao mesmo tempo e passariam pelo limite.
      await cleanup();
      const results = await Promise.all(
        Array.from({ length: 30 }, () => begin(app, { ip: REAL_IP, subject: REAL })),
      );
      const seen = results.map((r) => r.pair_failures).sort((x, y) => x - y);
      expect(seen).toEqual(Array.from({ length: 30 }, (_, i) => i));
      const ipSeen = results.map((r) => r.ip_failures).sort((x, y) => x - y);
      expect(ipSeen).toEqual(seen);
    }, 30_000);
  });
});
