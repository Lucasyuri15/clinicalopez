import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Testes do catálogo do Postgres (Supabase DEV): garantem que os papéis, grants e
 * privilégios padrão continuam como a migração de controle de acesso determina.
 * Somente leitura. Pulado sem .env.local; sem efeitos colaterais no corpo do describe.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);

describe.skipIf(!hasDb)("catálogo do banco (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;

  beforeAll(() => {
    assertMigrationTarget(
      process.env.DIRECT_URL ?? "",
      process.env.MIGRATION_PROJECT_REF,
    );
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
  });
  afterAll(async () => {
    await owner?.end({ timeout: 2 });
  });

  it("app_backend é login simples: sem superuser, BYPASSRLS, herança, criação de papéis/bancos ou replicação", async () => {
    const [role] = await owner`
      select rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb, rolreplication
      from pg_roles where rolname = 'app_backend'`;
    expect(role).toEqual({
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
  });

  it("app_backend só pode virar authenticated (SET), sem herdar privilégios", async () => {
    const [grant] = await owner`
      select m.inherit_option, m.set_option
      from pg_auth_members m
      join pg_roles member on member.oid = m.member
      join pg_roles granted on granted.oid = m.roleid
      where member.rolname = 'app_backend' and granted.rolname = 'authenticated'`;
    expect(grant).toEqual({ inherit_option: false, set_option: true });
  });

  it("app_backend tem limites de tempo (statement, lock e transação ociosa)", async () => {
    const [role] = await owner`
      select rolconfig from pg_roles where rolname = 'app_backend'`;
    const config = (role?.rolconfig ?? []) as string[];
    for (const key of [
      "statement_timeout",
      "lock_timeout",
      "idle_in_transaction_session_timeout",
    ]) {
      expect(config.some((entry) => entry.startsWith(`${key}=`))).toBe(true);
    }
  });

  it("anon não tem nenhum privilégio em profiles nem execução da função de papel", async () => {
    const [row] = await owner`
      select
        has_table_privilege('anon', 'public.profiles', 'SELECT') as sel,
        has_table_privilege('anon', 'public.profiles', 'INSERT') as ins,
        has_table_privilege('anon', 'public.profiles', 'UPDATE') as upd,
        has_table_privilege('anon', 'public.profiles', 'DELETE') as del,
        has_table_privilege('anon', 'public.profiles', 'TRUNCATE') as trunc,
        has_function_privilege('anon', 'app.current_app_role()', 'EXECUTE') as fn`;
    expect(row).toEqual({
      sel: false,
      ins: false,
      upd: false,
      del: false,
      trunc: false,
      fn: false,
    });
  });

  it("authenticated não pode apagar nem truncar profiles (RLS não protege TRUNCATE)", async () => {
    const [row] = await owner`
      select
        has_table_privilege('authenticated', 'public.profiles', 'DELETE') as del,
        has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE') as trunc,
        has_table_privilege('authenticated', 'public.profiles', 'REFERENCES') as refs,
        has_table_privilege('authenticated', 'public.profiles', 'TRIGGER') as trg`;
    expect(row).toEqual({ del: false, trunc: false, refs: false, trg: false });
  });

  it("toda tabela do schema public tem RLS ligada e nenhum grant para anon", async () => {
    const offenders = await owner`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and (
          not c.relrowsecurity
          or has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        )`;
    expect(offenders.map((row) => row.relname)).toEqual([]);
  });

  it("toda tabela de public acessível a authenticated tem política RESTRICTIVE exigindo aal2", async () => {
    // JWT só de senha (aal1) vale na Data API: a RLS precisa exigir o 2FA em cada tabela.
    const offenders = await owner`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
            and p.permissive = 'RESTRICTIVE'
            and p.cmd = 'ALL'
            and 'authenticated' = any (p.roles)
            and p.qual like '%aal2%'
            and p.with_check like '%aal2%'
        )`;
    expect(offenders.map((row) => row.relname)).toEqual([]);
  });

  it("tabelas futuras criadas pelo dono (postgres) NÃO nascem com grants para anon/authenticated", async () => {
    const rows = await owner`
      select d.defaclobjtype as tipo, d.defaclacl::text as acl
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
      where pg_get_userbyid(d.defaclrole) = 'postgres' and n.nspname = 'public'`;
    for (const row of rows) {
      expect(row.acl, `tipo ${row.tipo}`).not.toMatch(/(^|[{,])(anon|authenticated)=/);
    }
  });
});
