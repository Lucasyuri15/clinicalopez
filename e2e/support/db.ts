import { randomBytes, randomUUID } from "node:crypto";

import postgres from "postgres";

import { assertMigrationTarget } from "../../src/server/db/migration-guard";

export type Role = "admin" | "reception" | "professional";

export const FIXTURE_DOMAIN = "teste.invalid";
const FIXTURE_PREFIX = "e2e-";

function connect() {
  const url = process.env.DIRECT_URL ?? "";
  // Nunca mexe em banco que não seja o projeto permitido (DEV).
  assertMigrationTarget(url, process.env.MIGRATION_PROJECT_REF);
  return postgres(url, { prepare: false, max: 1, onnotice: () => {} });
}

export function newPassword(): string {
  return randomBytes(18).toString("hex");
}

export function fixtureEmail(label: string): string {
  return `${FIXTURE_PREFIX}${label}-${randomUUID().slice(0, 8)}@${FIXTURE_DOMAIN}`;
}

/** Cria usuário fictício no Auth (senha já confirmada) e, se `role`, o perfil. */
export async function createFixtureUser(input: {
  email: string;
  password: string;
  role: Role | null;
  fullName: string;
}): Promise<string> {
  const sql = connect();
  const id = randomUUID();
  try {
    await sql.begin(async (tx) => {
      await tx`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
        reauthentication_token, phone_change, phone_change_token)
        values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated', ${input.email},
        extensions.crypt(${input.password}, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '')`;
      await tx`insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (${id}, ${id}, ${tx.json({ sub: id, email: input.email, email_verified: true })}, 'email', now(), now(), now())`;
      if (input.role) {
        await tx`insert into public.profiles (id, full_name, role) values (${id}, ${input.fullName}, ${input.role})`;
      }
    });
    return id;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Apaga TODOS os usuários fictícios dos e2e (perfil primeiro; o resto cai em cascata). */
export async function deleteFixtureUsers(): Promise<number> {
  const sql = connect();
  try {
    return await sql.begin(async (tx) => {
      const pattern = `${FIXTURE_PREFIX}%@${FIXTURE_DOMAIN}`;
      await tx`delete from public.profiles where id in (select id from auth.users where email like ${pattern})`;
      const removed = await tx`delete from auth.users where email like ${pattern} returning id`;
      return removed.length;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/**
 * Apaga as tentativas de login dos e2e: as do balde `unknown` (o dev local não tem
 * `x-real-ip`, então todos os testes caem nele) e as dos IPs de documentação (TEST-NET).
 * Sem isto, falhas de execuções anteriores contam na janela de 15 min e a suíte vira
 * flaky: o e-mail fixo `ninguem-existe@teste.invalid` chegaria ao teto e a mensagem mudaria.
 */
export async function deleteTestAttempts(): Promise<void> {
  const sql = connect();
  try {
    await sql`delete from public.auth_attempts
      where ip = 'unknown' or ip ~ '^(192\\.0\\.2|198\\.51\\.100|203\\.0\\.113)\\.'`;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Apaga as tentativas de login gravadas para IPs de documentação (TEST-NET) usados nos e2e. */
export async function deleteAttemptsForIps(ips: string[]): Promise<void> {
  if (!ips.every((ip) => /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/.test(ip))) {
    throw new Error("Recusado: só apago tentativas dos IPs de documentação usados nos e2e.");
  }
  const sql = connect();
  try {
    await sql`delete from public.auth_attempts where ip in ${sql(ips)}`;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Apaga um usuário fictício específico (sem afetar os outros testes em andamento). */
export async function deleteFixtureUser(email: string): Promise<void> {
  if (!email.startsWith(FIXTURE_PREFIX) || !email.endsWith(`@${FIXTURE_DOMAIN}`)) {
    throw new Error("Recusado: só apago usuários fictícios dos e2e.");
  }
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      await tx`delete from public.profiles where id in (select id from auth.users where email = ${email})`;
      await tx`delete from auth.users where email = ${email}`;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Fatores de 2FA de um usuário fictício (para provar que uma ação NÃO cadastrou outro). */
export async function factorCounts(email: string): Promise<{ verified: number; unverified: number }> {
  if (!email.startsWith(FIXTURE_PREFIX) || !email.endsWith(`@${FIXTURE_DOMAIN}`)) {
    throw new Error("Recusado: só leio usuários fictícios dos e2e.");
  }
  const sql = connect();
  try {
    const [row] = await sql<{ verified: number; unverified: number }[]>`
      select count(*) filter (where f.status = 'verified')::int as verified,
             count(*) filter (where f.status = 'unverified')::int as unverified
      from auth.mfa_factors f join auth.users u on u.id = f.user_id
      where u.email = ${email}`;
    return row ?? { verified: 0, unverified: 0 };
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/**
 * Catálogo fictício dos e2e (serviços, convênios e valores), etiquetado no NOME (`[e2e-cat xxxx]`)
 * para apagar só o que o teste criou. Criado pelo dono do banco (fora da RLS) para os testes de
 * leitura por papel; o teste do administrador cria os seus pela tela.
 */
export function catalogTag(): string {
  return `[e2e-cat ${randomUUID().slice(0, 8)}]`;
}

export async function seedCatalog(tag: string): Promise<{
  serviceName: string;
  insuranceName: string;
  insuranceId: string;
}> {
  const sql = connect();
  try {
    return await sql.begin(async (tx) => {
      const serviceName = `${tag} Fisioterapia`;
      const insuranceName = `${tag} Plano Ficticio`;
      const [service] = await tx`insert into public.services (name, specialty, duration_minutes)
        values (${serviceName}, 'physiotherapy', 50) returning id`;
      const [insurance] = await tx`insert into public.insurances (name) values (${insuranceName}) returning id`;
      await tx`insert into public.service_prices (service_id, insurance_id, price_cents)
        values (${service!.id}, null, 8765431), (${service!.id}, ${insurance!.id}, 7654321)`;
      return { serviceName, insuranceName, insuranceId: insurance!.id as string };
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Apaga o catálogo criado pelo teste (valores, serviços e convênios cujo nome começa com a etiqueta). */
export async function deleteCatalog(tag: string): Promise<void> {
  if (!/^\[e2e-cat [0-9a-f]{8}\]$/.test(tag)) throw new Error("Recusado: etiqueta de e2e inválida.");
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      const like = `${tag}%`;
      await tx`delete from public.service_prices
        where service_id in (select id from public.services where name like ${like})
           or insurance_id in (select id from public.insurances where name like ${like})`;
      await tx`delete from public.services where name like ${like}`;
      await tx`delete from public.insurances where name like ${like}`;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Estado REAL gravado (para provar que a tela gravou, ou que uma ação negada não gravou). */
export async function catalogState(tag: string): Promise<{
  services: { name: string; durationMinutes: number; active: boolean; particularCents: number | null }[];
  insurances: { name: string; active: boolean }[];
  insurancePrices: { insurance: string; service: string; cents: number }[];
}> {
  const sql = connect();
  try {
    const like = `${tag}%`;
    const services = await sql<{ name: string; durationMinutes: number; active: boolean; particularCents: number | null }[]>`
      select s.name, s.duration_minutes as "durationMinutes", s.active,
        (select p.price_cents from public.service_prices p
          where p.service_id = s.id and p.insurance_id is null and p.deleted_at is null) as "particularCents"
      from public.services s where s.name like ${like} and s.deleted_at is null order by s.name`;
    const insurances = await sql<{ name: string; active: boolean }[]>`
      select name, active from public.insurances where name like ${like} and deleted_at is null order by name`;
    const insurancePrices = await sql<{ insurance: string; service: string; cents: number }[]>`
      select i.name as insurance, s.name as service, p.price_cents as cents
      from public.service_prices p
      join public.insurances i on i.id = p.insurance_id
      join public.services s on s.id = p.service_id
      where i.name like ${like} and p.deleted_at is null order by i.name, s.name`;
    return { services, insurances, insurancePrices };
  } finally {
    await sql.end({ timeout: 2 });
  }
}
