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
      // Esperas criadas ou encerradas por esses usuários: referenciam o perfil (FK restrict) e o
      // atendimento (FK restrict), então saem ANTES dos atendimentos.
      await tx`delete from public.waitlist_entries where created_by in (select id from auth.users where email like ${pattern})
        or closed_by in (select id from auth.users where email like ${pattern})`;
      // Atendimentos criados ou alterados por esses usuários referenciam o perfil (FK restrict).
      await tx`delete from public.appointment_prices where appointment_id in
        (select id from public.appointments where created_by in (select id from auth.users where email like ${pattern})
          or status_changed_by in (select id from auth.users where email like ${pattern}))`;
      await tx`delete from public.appointments where created_by in (select id from auth.users where email like ${pattern})
        or status_changed_by in (select id from auth.users where email like ${pattern})`;
      // Consentimentos registrados por esses usuários referenciam o perfil (FK restrict).
      await tx`delete from public.patient_consents where registered_by in
        (select id from auth.users where email like ${pattern})`;
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
      await tx`delete from public.waitlist_entries where created_by in (select id from auth.users where email = ${email})
        or closed_by in (select id from auth.users where email = ${email})`;
      await tx`delete from public.appointment_prices where appointment_id in
        (select id from public.appointments where created_by in (select id from auth.users where email = ${email})
          or status_changed_by in (select id from auth.users where email = ${email}))`;
      await tx`delete from public.appointments where created_by in (select id from auth.users where email = ${email})
        or status_changed_by in (select id from auth.users where email = ${email})`;
      await tx`delete from public.patient_consents where registered_by in
        (select id from auth.users where email = ${email})`;
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
      await tx`delete from public.waitlist_entries where service_id in (select id from public.services where name like ${like})`;
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

/**
 * Profissionais fictícios dos e2e, etiquetados no NOME com a MESMA etiqueta do catálogo
 * (`catalogTag()`): `deleteProfessionals(tag)` apaga os profissionais ANTES de `deleteCatalog(tag)`
 * (as ligações com serviços são `restrict`) e antes de apagar qualquer login fictício.
 */
export function profileIdByEmail(email: string): Promise<string> {
  if (!email.startsWith(FIXTURE_PREFIX) || !email.endsWith(`@${FIXTURE_DOMAIN}`)) {
    throw new Error("Recusado: só leio usuários fictícios dos e2e.");
  }
  const sql = connect();
  return sql`select id from auth.users where email = ${email}`
    .then((rows) => {
      if (!rows[0]) throw new Error("Usuário fictício não encontrado.");
      return rows[0].id as string;
    })
    .finally(() => sql.end({ timeout: 2 }));
}

export type SeededProfessionals = {
  /** Serviço de fisioterapia (do catálogo etiquetado). */
  physioService: string;
  own: { name: string; phoneDigits: string; phoneShown: string; email: string; registration: string };
  colleague: { name: string; phoneDigits: string; phoneShown: string; email: string; registration: string };
};

/** Cria um catálogo mínimo e dois profissionais: `own` (opcionalmente vinculado a um login) e um colega sem login. */
export async function seedProfessionals(tag: string, options: { linkProfileId?: string } = {}): Promise<SeededProfessionals> {
  const { serviceName: physioService } = await seedCatalog(tag);
  const own = {
    name: `${tag} Ana Propria`,
    phoneDigits: "11911112222",
    phoneShown: "(11) 91111-2222",
    email: "ana.propria@teste.invalid",
    registration: "CREFITO 11111",
  };
  const colleague = {
    name: `${tag} Bruno Colega`,
    phoneDigits: "11933334444",
    phoneShown: "(11) 93333-4444",
    email: "bruno.colega@teste.invalid",
    registration: "CRO 22222",
  };
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      const [dental] = await tx`insert into public.services (name, specialty, duration_minutes)
        values (${`${tag} Limpeza`}, 'dentistry', 40) returning id`;
      const [physio] = await tx`select id from public.services where name = ${physioService}`;
      const [a] = await tx`insert into public.professionals (full_name, specialty, registration, phone, email, profile_id)
        values (${own.name}, 'physiotherapy', ${own.registration}, ${own.phoneDigits}, ${own.email}, ${options.linkProfileId ?? null})
        returning id`;
      const [b] = await tx`insert into public.professionals (full_name, specialty, registration, phone, email)
        values (${colleague.name}, 'dentistry', ${colleague.registration}, ${colleague.phoneDigits}, ${colleague.email})
        returning id`;
      await tx`insert into public.professional_services (professional_id, service_id, specialty) values
        (${a!.id}, ${physio!.id}, 'physiotherapy'), (${b!.id}, ${dental!.id}, 'dentistry')`;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
  return { physioService, own, colleague };
}

/** Apaga os profissionais do teste (ligações primeiro). Chame ANTES de `deleteCatalog` e dos logins. */
export async function deleteProfessionals(tag: string): Promise<void> {
  if (!/^\[e2e-cat [0-9a-f]{8}\]$/.test(tag)) throw new Error("Recusado: etiqueta de e2e inválida.");
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      const like = `${tag}%`;
      // Esperas que pedem um profissional do teste: referenciam o profissional e o atendimento (FK restrict).
      await tx`delete from public.waitlist_entries where professional_id in
        (select id from public.professionals where full_name like ${like})`;
      // Atendimentos (e valores) dos profissionais do teste: referenciam o profissional (FK restrict).
      await tx`delete from public.appointment_prices where appointment_id in
        (select id from public.appointments where professional_id in
          (select id from public.professionals where full_name like ${like}))`;
      await tx`delete from public.appointments where professional_id in
        (select id from public.professionals where full_name like ${like})`;
      await tx`delete from public.professional_work_hours where professional_id in
        (select id from public.professionals where full_name like ${like})`;
      await tx`delete from public.professional_time_off where professional_id in
        (select id from public.professionals where full_name like ${like})`;
      await tx`delete from public.patient_professionals where professional_id in
        (select id from public.professionals where full_name like ${like})`;
      await tx`delete from public.professional_services where professional_id in
        (select id from public.professionals where full_name like ${like})`;
      await tx`delete from public.professionals where full_name like ${like}`;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Estado REAL gravado dos profissionais do teste. */
export async function professionalsState(tag: string): Promise<
  {
    name: string;
    specialty: string;
    registration: string | null;
    phone: string | null;
    email: string | null;
    active: boolean;
    loginName: string | null;
    services: string[];
  }[]
> {
  const sql = connect();
  try {
    const rows = await sql`
      select p.full_name as name, p.specialty, p.registration, p.phone, p.email, p.active,
        (select pr.full_name from public.profiles pr where pr.id = p.profile_id) as "loginName",
        coalesce((select array_agg(s.name order by s.name) from public.professional_services ps
          join public.services s on s.id = ps.service_id where ps.professional_id = p.id), '{}') as services
      from public.professionals p where p.full_name like ${`${tag}%`} and p.deleted_at is null order by p.full_name`;
    return rows as unknown as Awaited<ReturnType<typeof professionalsState>>;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Id de um profissional fictício pelo nome (para abrir a tela de horários dele). */
export async function professionalIdByName(name: string): Promise<string> {
  if (!/^\[e2e-cat [0-9a-f]{8}\] /.test(name)) throw new Error("Recusado: nome de profissional de e2e inválido.");
  const sql = connect();
  try {
    const [row] = await sql`select id from public.professionals where full_name = ${name} and deleted_at is null`;
    if (!row) throw new Error("Profissional fictício não encontrado.");
    return row.id as string;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export type SeededSchedule = {
  /** Folga do profissional `own`, no texto exato que a tela mostra. */
  ownOffLabel: string;
  ownOffReason: string;
  colleagueOffReason: string;
};

/**
 * Grade e folgas dos dois profissionais criados por `seedProfessionals`. As folgas são relativas a
 * HOJE em Brasília (10 e 20 dias à frente) para o teste não envelhecer: a tela só lista as futuras
 * e as dos últimos 30 dias.
 */
export async function seedSchedule(seeded: SeededProfessionals): Promise<SeededSchedule> {
  const ownOffReason = "Recesso da clínica";
  const colleagueOffReason = "Compromisso do colega";
  const sql = connect();
  try {
    return await sql.begin(async (tx) => {
      const [own] = await tx`select id from public.professionals where full_name = ${seeded.own.name}`;
      const [colleague] = await tx`select id from public.professionals where full_name = ${seeded.colleague.name}`;
      await tx`insert into public.professional_work_hours (professional_id, weekday, start_minute, end_minute) values
        (${own!.id}, 1, 480, 720), (${own!.id}, 1, 840, 1080), (${own!.id}, 6, 480, 720),
        (${colleague!.id}, 2, 540, 780)`;
      const brt = tx`(now() at time zone 'America/Sao_Paulo')::date`;
      await tx`insert into public.professional_time_off (professional_id, starts_at, ends_at, reason) values
        (${own!.id}, ((${brt} + 10)::timestamp at time zone 'America/Sao_Paulo'), ((${brt} + 11)::timestamp at time zone 'America/Sao_Paulo'), ${ownOffReason}),
        (${colleague!.id}, ((${brt} + 20)::timestamp at time zone 'America/Sao_Paulo'), ((${brt} + 21)::timestamp at time zone 'America/Sao_Paulo'), ${colleagueOffReason})`;
      const [label] = await tx`select to_char(${brt} + 10, 'DD/MM/YYYY') as day`;
      return { ownOffLabel: `${label!.day} (dia inteiro)`, ownOffReason, colleagueOffReason };
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Estado REAL gravado da grade e das folgas de um profissional do teste. */
export async function scheduleState(name: string): Promise<{
  hours: { weekday: number; start: number; end: number }[];
  timeOff: { reason: string | null; startsAt: Date; endsAt: Date }[];
}> {
  const id = await professionalIdByName(name);
  const sql = connect();
  try {
    const hours = await sql`select weekday, start_minute as start, end_minute as "end"
      from public.professional_work_hours where professional_id = ${id} order by weekday, start_minute`;
    const timeOff = await sql`select reason, starts_at as "startsAt", ends_at as "endsAt"
      from public.professional_time_off where professional_id = ${id} order by starts_at`;
    return {
      hours: hours as unknown as { weekday: number; start: number; end: number }[],
      timeOff: timeOff as unknown as { reason: string | null; startsAt: Date; endsAt: Date }[],
    };
  } finally {
    await sql.end({ timeout: 2 });
  }
}

// ---------------------------------------------------------------------------------------------
// Pacientes (1B-3a). Só dados FICTÍCIOS; nomes etiquetados com a mesma etiqueta do catálogo.
// ---------------------------------------------------------------------------------------------

/** CPF FICTÍCIO com dígitos verificadores corretos e aleatório (o banco exige CPF único). */
export function fakeCpf(): string {
  for (;;) {
    const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    if (new Set(base).size === 1) continue; // 111.111.111-xx não é CPF válido
    const digit = (list: number[]) => {
      const sum = list.reduce((acc, value, i) => acc + value * (list.length + 1 - i), 0);
      const rest = (sum * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    const d1 = digit(base);
    const d2 = digit([...base, d1]);
    return [...base, d1, d2].join("");
  }
}

export const formatCpfDigits = (digits: string) =>
  `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;

export type SeededPatients = {
  /**
   * Paciente VINCULADO ao profissional `own` (de `seedProfessionals`), com TODOS os dados reservados
   * preenchidos. `secrets` = textos únicos que o profissional nunca pode ver (nem no HTML).
   */
  own: {
    name: string;
    cpfDigits: string;
    cpfShown: string;
    street: string;
    notes: string;
    phoneShown: string;
    secrets: string[];
  };
  /** Paciente vinculado ao profissional `own`, SEM CPF (motivo reservado). */
  ownForeign: { name: string; reason: string };
  /** Paciente vinculado só ao colega. */
  other: { name: string; cpfDigits: string; cpfShown: string; street: string; notes: string };
  /** Paciente sem nenhum vínculo. */
  loose: { name: string };
};

/** Cria quatro pacientes: dois do profissional `own`, um só do colega e um sem vínculo. Chame depois de `seedProfessionals`. */
export async function seedPatients(tag: string, seeded: { own: { name: string }; colleague: { name: string } }): Promise<SeededPatients> {
  const own = {
    name: `${tag} Paciente Proprio`,
    cpfDigits: fakeCpf(),
    street: "Rua Reservada Um",
    notes: "Observacao administrativa reservada do paciente proprio",
    phoneShown: "(11) 95555-6666",
  };
  const reserved = {
    cep: "01310100",
    complement: "Complemento Reservado",
    district: "Bairro Reservado",
    city: "Cidade Reservada",
    card: "CARTEIRINHA-RESERVADA-99",
    guardianName: "Responsavel Reservado Silva",
    guardianRelationship: "Parentesco Reservado",
    guardianCpf: fakeCpf(),
    insuranceName: `${tag} Plano Reservado`,
  };
  const ownForeign = { name: `${tag} Paciente Estrangeiro`, reason: "Motivo reservado de nao ter CPF" };
  const other = {
    name: `${tag} Paciente Alheio`,
    cpfDigits: fakeCpf(),
    street: "Rua Reservada Dois",
    notes: "Observacao administrativa reservada do paciente alheio",
  };
  const loose = { name: `${tag} Paciente Solto` };
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      const [insurance] = await tx`insert into public.insurances (name) values (${reserved.insuranceName}) returning id`;
      const [a] = await tx`insert into public.patients (full_name, birth_date, phone, email)
        values (${own.name}, '1985-03-02', '11955556666', 'paciente.proprio@teste.invalid') returning id`;
      const [f] = await tx`insert into public.patients (full_name, birth_date, phone)
        values (${ownForeign.name}, '1992-09-09', '11944445555') returning id`;
      const [b] = await tx`insert into public.patients (full_name, birth_date, phone)
        values (${other.name}, '1975-07-20', '11977778888') returning id`;
      const [c] = await tx`insert into public.patients (full_name, birth_date, phone)
        values (${loose.name}, '1960-01-15', '11999990000') returning id`;
      await tx`insert into public.patient_private (patient_id, cpf, cep, street, complement, district, city, state,
          insurance_id, insurance_card, guardian_name, guardian_relationship, guardian_phone, guardian_cpf, admin_notes)
        values (${a!.id}, ${own.cpfDigits}, ${reserved.cep}, ${own.street}, ${reserved.complement}, ${reserved.district},
          ${reserved.city}, 'SP', ${insurance!.id}, ${reserved.card}, ${reserved.guardianName},
          ${reserved.guardianRelationship}, '11966665555', ${reserved.guardianCpf}, ${own.notes})`;
      await tx`insert into public.patient_private (patient_id, no_cpf_reason) values (${f!.id}, ${ownForeign.reason})`;
      await tx`insert into public.patient_private (patient_id, cpf, street, admin_notes) values
        (${b!.id}, ${other.cpfDigits}, ${other.street}, ${other.notes}),
        (${c!.id}, ${fakeCpf()}, 'Rua Solta', 'Obs solta')`;
      const [pa] = await tx`select id from public.professionals where full_name = ${seeded.own.name}`;
      const [pb] = await tx`select id from public.professionals where full_name = ${seeded.colleague.name}`;
      await tx`insert into public.patient_professionals (patient_id, professional_id) values
        (${a!.id}, ${pa!.id}), (${f!.id}, ${pa!.id}), (${b!.id}, ${pb!.id})`;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
  return {
    own: {
      ...own,
      cpfShown: formatCpfDigits(own.cpfDigits),
      secrets: [
        own.cpfDigits,
        formatCpfDigits(own.cpfDigits),
        own.street,
        own.notes,
        reserved.complement,
        reserved.district,
        reserved.city,
        reserved.card,
        reserved.guardianName,
        reserved.guardianRelationship,
        reserved.guardianCpf,
        formatCpfDigits(reserved.guardianCpf),
        reserved.insuranceName,
        "01310-100",
        "(11) 96666-5555",
      ],
    },
    ownForeign,
    other: { ...other, cpfShown: formatCpfDigits(other.cpfDigits) },
    loose,
  };
}

/** Apaga os pacientes do teste (vínculos e dados administrativos primeiro). Chame ANTES de `deleteProfessionals`/`deleteCatalog`. */
export async function deletePatients(tag: string): Promise<void> {
  if (!/^\[e2e-cat [0-9a-f]{8}\]$/.test(tag)) throw new Error("Recusado: etiqueta de e2e inválida.");
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      const like = `${tag}%`;
      // Prontuário primeiro: log, adendos e evoluções referenciam o paciente e o atendimento (FK restrict).
      await tx`delete from public.clinical_access_log where patient_id in
        (select id from public.patients where full_name like ${like})`;
      // Anexos (só os metadados: o arquivo no Storage só some pela API; ver a spec da 4B-1).
      await tx`delete from public.clinical_attachments where patient_id in
        (select id from public.patients where full_name like ${like})`;
      await tx`delete from public.clinical_note_addenda where note_id in
        (select id from public.clinical_notes where patient_id in
          (select id from public.patients where full_name like ${like}))`;
      await tx`delete from public.clinical_notes where patient_id in
        (select id from public.patients where full_name like ${like})`;
      // Esperas primeiro: referenciam o paciente e o atendimento (FK restrict).
      await tx`delete from public.waitlist_entries where patient_id in
        (select id from public.patients where full_name like ${like})`;
      // Atendimentos (e valores) primeiro: referenciam o paciente (FK restrict).
      await tx`delete from public.appointment_prices where appointment_id in
        (select id from public.appointments where patient_id in
          (select id from public.patients where full_name like ${like}))`;
      await tx`delete from public.appointments where patient_id in
        (select id from public.patients where full_name like ${like})`;
      // Séries: as sessões (atendimentos) já foram; a série referencia o paciente (FK restrict).
      await tx`delete from public.appointment_series where patient_id in
        (select id from public.patients where full_name like ${like})`;
      // Consentimentos: referenciam o paciente (FK restrict).
      await tx`delete from public.patient_consents where patient_id in
        (select id from public.patients where full_name like ${like})`;
      await tx`delete from public.patient_professionals where patient_id in
        (select id from public.patients where full_name like ${like})`;
      await tx`delete from public.patient_private where patient_id in
        (select id from public.patients where full_name like ${like})`;
      await tx`delete from public.patients where full_name like ${like}`;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Estado REAL gravado dos pacientes do teste (inclui removidos). */
export async function patientsState(tag: string): Promise<
  {
    name: string;
    birthDate: string;
    phone: string | null;
    active: boolean;
    removed: boolean;
    cpf: string | null;
    noCpfReason: string | null;
    street: string | null;
    guardianName: string | null;
    professionals: string[];
  }[]
> {
  const sql = connect();
  try {
    const rows = await sql`
      select p.full_name as name, p.birth_date::text as "birthDate", p.phone, p.active,
        (p.deleted_at is not null) as removed, pp.cpf, pp.no_cpf_reason as "noCpfReason", pp.street,
        pp.guardian_name as "guardianName",
        coalesce((select array_agg(pr.full_name order by pr.full_name) from public.patient_professionals l
          join public.professionals pr on pr.id = l.professional_id where l.patient_id = p.id), '{}') as professionals
      from public.patients p left join public.patient_private pp on pp.patient_id = p.id
      where p.full_name like ${`${tag}%`} order by p.full_name`;
    return rows as unknown as Awaited<ReturnType<typeof patientsState>>;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Consentimentos REAIS gravados dos pacientes do teste, do mais antigo ao mais novo registro. */
export async function consentsState(tag: string): Promise<
  {
    patient: string;
    kind: string;
    granted: boolean;
    givenBy: string;
    method: string;
    occurredOn: string;
    note: string | null;
    registeredByEmail: string;
  }[]
> {
  if (!/^\[e2e-cat [0-9a-f]{8}\]$/.test(tag)) throw new Error("Recusado: etiqueta de e2e inválida.");
  const sql = connect();
  try {
    const rows = await sql`
      select p.full_name as patient, c.kind, c.granted, c.given_by as "givenBy", c.method,
        c.occurred_on::text as "occurredOn", c.note, u.email as "registeredByEmail"
      from public.patient_consents c
      join public.patients p on p.id = c.patient_id
      join auth.users u on u.id = c.registered_by
      where p.full_name like ${`${tag}%`} order by c.created_at, c.id`;
    return rows as unknown as Awaited<ReturnType<typeof consentsState>>;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Semeia um consentimento de um paciente do teste (registrado em nome de `registeredByEmail`). */
export async function seedConsent(input: {
  patientName: string;
  registeredByEmail: string;
  kind?: "data_processing" | "whatsapp";
  granted?: boolean;
  note?: string;
}): Promise<void> {
  if (!/^\[e2e-cat [0-9a-f]{8}\] /.test(input.patientName)) throw new Error("Recusado: paciente de e2e inválido.");
  if (input.registeredByEmail === "") throw new Error("seedConsent: e-mail de quem registra está vazio.");
  const sql = connect();
  try {
    const inserted = await sql`insert into public.patient_consents (patient_id, kind, granted, given_by, method, occurred_on, note, registered_by)
      select p.id, ${input.kind ?? "data_processing"}, ${input.granted ?? true}, 'patient', 'signed_paper',
        '2026-01-10', ${input.note ?? null}, u.id
      from public.patients p, auth.users u
      where p.full_name = ${input.patientName} and u.email = ${input.registeredByEmail}
      returning id`;
    // O `insert ... select` não falha quando nada casa: sem esta conferência, um teste de "não vê
    // consentimento" passaria contra um paciente que nem tem consentimento.
    if (inserted.length !== 1) throw new Error(`seedConsent: esperava inserir 1 consentimento e inseri ${inserted.length}.`);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Remove (soft delete) um paciente do teste por SQL, para semear a tela de reativação. */
export async function softDeletePatient(name: string): Promise<void> {
  if (!/^\[e2e-cat [0-9a-f]{8}\] /.test(name)) throw new Error("Recusado: paciente de e2e inválido.");
  const sql = connect();
  try {
    await sql`update public.patients set deleted_at = now() where full_name = ${name}`;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Id de um paciente fictício pelo nome (para abrir a tela dele). */
export async function patientIdByName(name: string): Promise<string> {
  if (!/^\[e2e-cat [0-9a-f]{8}\] /.test(name)) throw new Error("Recusado: nome de paciente de e2e inválido.");
  const sql = connect();
  try {
    const [row] = await sql`select id from public.patients where full_name = ${name}`;
    if (!row) throw new Error("Paciente fictício não encontrado.");
    return row.id as string;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

// ---------------------------------------------------------------------------------------------
// Atendimentos da agenda (Fase 2). Só dados FICTÍCIOS, ligados a profissionais, pacientes e
// serviços etiquetados. A limpeza vem junto de `deletePatients`/`deleteProfessionals` (e dos
// `deleteFixtureUser(s)`, por `created_by`/`status_changed_by`).
// ---------------------------------------------------------------------------------------------

const TAGGED_NAME = /^\[e2e-cat [0-9a-f]{8}\] /;

/**
 * Cria um atendimento como DONO do banco (não passa pela grade nem pelo "início no futuro": serve
 * para montar um atendimento passado ou um conflito). `createdBy` é o perfil de um usuário
 * fictício (apagar o usuário apaga o atendimento). `priceCents` cria o valor copiado.
 */
export async function seedAppointment(input: {
  professionalName: string;
  patientName: string;
  serviceName: string;
  startsAt: Date;
  durationMinutes: number;
  createdBy: string;
  status?: "scheduled" | "confirmed" | "done" | "no_show" | "cancelled";
  cancelReason?: string;
  priceCents?: number;
}): Promise<string> {
  for (const name of [input.professionalName, input.patientName, input.serviceName]) {
    if (!TAGGED_NAME.test(name)) throw new Error("Recusado: só uso nomes de e2e etiquetados.");
  }
  const status = input.status ?? "scheduled";
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
  const sql = connect();
  try {
    return await sql.begin(async (tx) => {
      const [professional] = await tx`select id, specialty from public.professionals where full_name = ${input.professionalName}`;
      const [patient] = await tx`select id from public.patients where full_name = ${input.patientName}`;
      const [service] = await tx`select id from public.services where name = ${input.serviceName}`;
      if (!professional || !patient || !service) throw new Error("Dados fictícios do atendimento não encontrados.");
      const [row] = await tx`insert into public.appointments
        (professional_id, patient_id, service_id, specialty, starts_at, ends_at, status, cancel_reason, created_by)
        values (${professional.id}, ${patient.id}, ${service.id}, ${professional.specialty}, ${input.startsAt},
          ${endsAt}, ${status}, ${status === "cancelled" ? (input.cancelReason ?? "Cancelamento de teste") : null},
          ${input.createdBy})
        returning id`;
      if (input.priceCents !== undefined) {
        await tx`insert into public.appointment_prices (appointment_id, price_cents) values (${row!.id}, ${input.priceCents})`;
      }
      return row!.id as string;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/**
 * Cria uma SÉRIE e as sessões dela como DONO do banco (não passa pela grade nem pelo "início no
 * futuro"). Só nomes de e2e etiquetados. Devolve o id da série e o de cada sessão, em ordem.
 */
export async function seedSeries(input: {
  professionalName: string;
  patientName: string;
  serviceName: string;
  startsAts: Date[];
  durationMinutes: number;
  createdBy: string;
}): Promise<{ seriesId: string; ids: string[] }> {
  for (const name of [input.professionalName, input.patientName, input.serviceName]) {
    if (!TAGGED_NAME.test(name)) throw new Error("Recusado: só uso nomes de e2e etiquetados.");
  }
  const sql = connect();
  try {
    return await sql.begin(async (tx) => {
      const [professional] = await tx`select id, specialty from public.professionals where full_name = ${input.professionalName}`;
      const [patient] = await tx`select id from public.patients where full_name = ${input.patientName}`;
      const [service] = await tx`select id from public.services where name = ${input.serviceName}`;
      if (!professional || !patient || !service) throw new Error("Dados fictícios da série não encontrados.");
      const [series] = await tx`insert into public.appointment_series (professional_id, patient_id, service_id, specialty, created_by)
        values (${professional.id}, ${patient.id}, ${service.id}, ${professional.specialty}, ${input.createdBy}) returning id`;
      const ids: string[] = [];
      for (const startsAt of input.startsAts) {
        const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
        const [row] = await tx`insert into public.appointments
          (series_id, professional_id, patient_id, service_id, specialty, starts_at, ends_at, created_by)
          values (${series!.id}, ${professional.id}, ${patient.id}, ${service.id}, ${professional.specialty}, ${startsAt}, ${endsAt}, ${input.createdBy})
          returning id`;
        ids.push(row!.id as string);
      }
      return { seriesId: series!.id as string, ids };
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export type SeriesSessionRow = {
  seriesId: string;
  patient: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  cancelReason: string | null;
};

/** Estado REAL gravado das sessões de série dos pacientes do teste, por horário. */
export async function seriesSessions(tag: string): Promise<SeriesSessionRow[]> {
  if (!/^\[e2e-cat [0-9a-f]{8}\]$/.test(tag)) throw new Error("Recusado: etiqueta de e2e inválida.");
  const sql = connect();
  try {
    const rows = await sql`
      select a.series_id as "seriesId", pa.full_name as patient, a.starts_at as "startsAt", a.ends_at as "endsAt",
        a.status, a.cancel_reason as "cancelReason"
      from public.appointments a
      join public.patients pa on pa.id = a.patient_id
      where a.series_id is not null and pa.full_name like ${`${tag}%`}
      order by a.starts_at`;
    return rows as unknown as SeriesSessionRow[];
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export type AppointmentRow = {
  patient: string;
  professional: string;
  service: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  cancelReason: string | null;
  priceCents: number | null;
  statusChanged: boolean;
};

/** Estado REAL gravado dos atendimentos dos profissionais do teste, por horário. */
export async function appointmentsState(tag: string): Promise<AppointmentRow[]> {
  if (!/^\[e2e-cat [0-9a-f]{8}\]$/.test(tag)) throw new Error("Recusado: etiqueta de e2e inválida.");
  const sql = connect();
  try {
    const rows = await sql`
      select pa.full_name as patient, pr.full_name as professional, s.name as service,
        a.starts_at as "startsAt", a.ends_at as "endsAt", a.status, a.cancel_reason as "cancelReason",
        (select p.price_cents from public.appointment_prices p where p.appointment_id = a.id) as "priceCents",
        a.status_changed_by is not null as "statusChanged"
      from public.appointments a
      join public.professionals pr on pr.id = a.professional_id
      join public.patients pa on pa.id = a.patient_id
      join public.services s on s.id = a.service_id
      where pr.full_name like ${`${tag}%`}
      order by a.starts_at, pr.full_name`;
    return rows as unknown as AppointmentRow[];
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** O paciente tem vínculo com o profissional? (agendar cria o vínculo). */
export async function patientIsLinked(patientName: string, professionalName: string): Promise<boolean> {
  for (const name of [patientName, professionalName]) {
    if (!TAGGED_NAME.test(name)) throw new Error("Recusado: só uso nomes de e2e etiquetados.");
  }
  const sql = connect();
  try {
    const rows = await sql`select 1 from public.patient_professionals pp
      join public.patients p on p.id = pp.patient_id
      join public.professionals pr on pr.id = pp.professional_id
      where p.full_name = ${patientName} and pr.full_name = ${professionalName}`;
    return rows.length > 0;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export type WaitlistRow = {
  patient: string;
  service: string;
  professional: string | null;
  status: "waiting" | "fulfilled" | "removed";
  weekdays: number[];
  startMinute: number | null;
  endMinute: number | null;
  note: string | null;
  hasClosedStamp: boolean;
};

/** Estado REAL gravado da lista de espera dos pacientes do teste (para provar o que a tela gravou). */
export async function waitlistState(tag: string): Promise<WaitlistRow[]> {
  if (!/^\[e2e-cat [0-9a-f]{8}\]$/.test(tag)) throw new Error("Recusado: etiqueta de e2e inválida.");
  const sql = connect();
  try {
    const rows = await sql`
      select pa.full_name as patient, s.name as service, pr.full_name as professional, w.status,
        w.weekdays, w.start_minute as "startMinute", w.end_minute as "endMinute", w.note,
        (w.closed_at is not null and w.closed_by is not null) as "hasClosedStamp"
      from public.waitlist_entries w
      join public.patients pa on pa.id = w.patient_id
      join public.services s on s.id = w.service_id
      left join public.professionals pr on pr.id = w.professional_id
      where pa.full_name like ${`${tag}%`}
      order by w.created_at, pa.full_name`;
    return rows as unknown as WaitlistRow[];
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/**
 * Põe alguém na lista de espera como DONO do banco (para montar o cenário de um teste que não é o do
 * cadastro). Só nomes de e2e etiquetados; `createdBy` é o perfil de um usuário fictício. Sem
 * `professionalName` a espera aceita qualquer profissional que ofereça o serviço. A limpeza é a de
 * `deletePatients` (as esperas saem junto com o paciente).
 */
export async function seedWaitlistEntry(input: {
  patientName: string;
  serviceName: string;
  professionalName?: string;
  weekdays?: number[];
  createdBy: string;
}): Promise<string> {
  for (const name of [input.patientName, input.serviceName, ...(input.professionalName ? [input.professionalName] : [])]) {
    if (!TAGGED_NAME.test(name)) throw new Error("Recusado: só uso nomes de e2e etiquetados.");
  }
  const sql = connect();
  try {
    return await sql.begin(async (tx) => {
      const [patient] = await tx`select id from public.patients where full_name = ${input.patientName}`;
      const [service] = await tx`select id, specialty from public.services where name = ${input.serviceName}`;
      const [professional] = input.professionalName
        ? await tx`select id from public.professionals where full_name = ${input.professionalName}`
        : [null];
      if (!patient || !service || (input.professionalName && !professional)) throw new Error("Dados fictícios da espera não encontrados.");
      const [row] = await tx`insert into public.waitlist_entries (patient_id, service_id, professional_id, specialty, weekdays, created_by)
        values (${patient.id}, ${service.id}, ${professional?.id ?? null}, ${service.specialty}, ${input.weekdays ?? []}::smallint[], ${input.createdBy})
        returning id`;
      return row!.id as string;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Vincula um paciente a mais um profissional (o paciente compartilhado entre dois profissionais). */
export async function linkPatient(patientName: string, professionalName: string): Promise<void> {
  for (const name of [patientName, professionalName]) {
    if (!TAGGED_NAME.test(name)) throw new Error("Recusado: só uso nomes de e2e etiquetados.");
  }
  const sql = connect();
  try {
    await sql`insert into public.patient_professionals (patient_id, professional_id)
      select p.id, pr.id from public.patients p, public.professionals pr
      where p.full_name = ${patientName} and pr.full_name = ${professionalName}
      on conflict do nothing`;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/**
 * Semeia uma EVOLUÇÃO como DONO do banco no atendimento (Realizado) indicado. `authorProfileId` é o
 * perfil de um usuário fictício (preenche `finalized_by` quando finalizada; apagar o usuário não deve
 * deixar linha clínica para trás: `deletePatients` as apaga antes). Só atendimentos de pacientes
 * etiquetados. Opcionalmente um adendo.
 */
export async function seedClinicalNote(input: {
  appointmentId: string;
  body: string;
  status: "draft" | "finalized";
  authorProfileId: string;
  addendum?: string;
}): Promise<string> {
  const sql = connect();
  try {
    return await sql.begin(async (tx) => {
      const [appointment] = await tx`select a.id, a.patient_id, a.professional_id, p.full_name as patient
        from public.appointments a join public.patients p on p.id = a.patient_id where a.id = ${input.appointmentId}`;
      if (!appointment || !TAGGED_NAME.test(appointment.patient as string)) throw new Error("Recusado: só uso atendimentos de e2e etiquetados.");
      const finalized = input.status === "finalized";
      const [note] = await tx`insert into public.clinical_notes
        (appointment_id, patient_id, professional_id, body, status, finalized_at, finalized_by)
        values (${appointment.id}, ${appointment.patient_id}, ${appointment.professional_id}, ${input.body}, ${input.status},
          ${finalized ? new Date() : null}, ${finalized ? input.authorProfileId : null})
        returning id`;
      if (input.addendum) {
        await tx`insert into public.clinical_note_addenda (note_id, body, created_by)
          values (${note!.id}, ${input.addendum}, ${input.authorProfileId})`;
      }
      return note!.id as string;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export type ClinicalState = {
  notes: { patient: string; professional: string; status: "draft" | "finalized"; body: string; addenda: string[] }[];
  log: { action: string; role: string }[];
};

/** Estado REAL gravado do prontuário e do log dos pacientes do teste (para provar o que a tela gravou). */
export async function clinicalState(tag: string): Promise<ClinicalState> {
  if (!/^\[e2e-cat [0-9a-f]{8}\]$/.test(tag)) throw new Error("Recusado: etiqueta de e2e inválida.");
  const sql = connect();
  try {
    const like = `${tag}%`;
    const notes = await sql`
      select pa.full_name as patient, pr.full_name as professional, n.status, n.body,
        coalesce((select array_agg(a.body order by a.created_at) from public.clinical_note_addenda a where a.note_id = n.id), '{}') as addenda
      from public.clinical_notes n
      join public.patients pa on pa.id = n.patient_id
      join public.professionals pr on pr.id = n.professional_id
      where pa.full_name like ${like}
      order by n.created_at`;
    const log = await sql`
      select l.action, l.role from public.clinical_access_log l
      join public.patients pa on pa.id = l.patient_id
      where pa.full_name like ${like}
      order by l.id`;
    return { notes: notes as unknown as ClinicalState["notes"], log: log as unknown as ClinicalState["log"] };
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/**
 * Cria um anexo clínico (só a LINHA: nenhum arquivo no Storage) como DONO do banco, para provar que o
 * profissional não vê o anexo do colega e que o admin lê e vê o removido. Só nomes de e2e etiquetados.
 */
export async function seedClinicalAttachment(input: {
  patientName: string;
  professionalName: string;
  authorProfileId: string;
  name: string;
  removed?: boolean;
}): Promise<string> {
  for (const name of [input.patientName, input.professionalName]) {
    if (!TAGGED_NAME.test(name)) throw new Error("Recusado: só uso nomes de e2e etiquetados.");
  }
  const sql = connect();
  try {
    const [patient] = await sql`select id from public.patients where full_name = ${input.patientName}`;
    const [professional] = await sql`select id from public.professionals where full_name = ${input.professionalName}`;
    if (!patient || !professional) throw new Error("Dados fictícios do anexo não encontrados.");
    const path = crypto.randomUUID();
    const [row] = await sql`insert into public.clinical_attachments
      (patient_id, professional_id, storage_path, original_name, content_type, size_bytes, sha256, created_by, removed_at, removed_by)
      values (${patient.id}, ${professional.id}, ${path}, ${input.name}, 'application/pdf', 1234, ${"c".repeat(64)}, ${input.authorProfileId},
        ${input.removed ? new Date() : null}, ${input.removed ? input.authorProfileId : null})
      returning id`;
    return row!.id as string;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export type AttachmentsState = {
  attachments: { patient: string; professional: string; name: string; contentType: string; sizeBytes: number; appointmentId: string | null; removed: boolean }[];
  log: { action: string; role: string }[];
};

/** Estado REAL gravado dos anexos e do log dos pacientes do teste (para provar o que a tela gravou). */
export async function attachmentsState(tag: string): Promise<AttachmentsState> {
  if (!/^\[e2e-cat [0-9a-f]{8}\]$/.test(tag)) throw new Error("Recusado: etiqueta de e2e inválida.");
  const sql = connect();
  try {
    const like = `${tag}%`;
    const attachments = await sql`
      select pa.full_name as patient, pr.full_name as professional, a.original_name as name, a.content_type as "contentType",
        a.size_bytes as "sizeBytes", a.appointment_id as "appointmentId", (a.removed_at is not null) as removed
      from public.clinical_attachments a
      join public.patients pa on pa.id = a.patient_id
      join public.professionals pr on pr.id = a.professional_id
      where pa.full_name like ${like}
      order by a.created_at`;
    const log = await sql`
      select l.action, l.role from public.clinical_access_log l
      join public.patients pa on pa.id = l.patient_id
      where pa.full_name like ${like}
      order by l.id`;
    return { attachments: attachments as unknown as AttachmentsState["attachments"], log: log as unknown as AttachmentsState["log"] };
  } finally {
    await sql.end({ timeout: 2 });
  }
}
