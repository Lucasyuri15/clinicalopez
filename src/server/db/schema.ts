import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

/**
 * Sem `server-only` de propósito: o drizzle-kit carrega este arquivo fora do Next.
 * As políticas de RLS e os grants ficam em migrações SQL (ver migrations/).
 */

export const userRole = pgEnum("user_role", [
  "admin",
  "reception",
  "professional",
]);

export type UserRole = (typeof userRole.enumValues)[number];

/** Perfil de cada usuário do Supabase Auth: define o papel (RBAC). */
export const profiles = pgTable("profiles", {
  // Mesmo ID do usuário em auth.users. `restrict`: não permite apagar o usuário
  // do Auth deixando o perfil órfão (exclusão é sempre lógica, via deleted_at).
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "restrict" }),
  fullName: text("full_name").notNull(),
  role: userRole("role").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  // Só para a FK composta de `professionals` (perfil vinculado precisa ter o papel `professional`).
  unique("profiles_id_role_uq").on(table.id, table.role),
]).enableRLS();

/**
 * Tentativas de login/2FA para o limite próprio (ver `src/lib/auth/rate-limit-policy.ts`).
 * Cada tentativa grava uma linha ANTES de chamar o Supabase (fecha a corrida de tentativas
 * em paralelo); sucesso ou bloqueio apagam a linha, então o que sobra são as falhas.
 *
 * Só as funções `app.rate_limit_*` (SECURITY DEFINER, executáveis só por `app_backend`) a
 * tocam: RLS ligada, SEM política e SEM grant para anon/authenticated (nem pela Data API).
 * Não segue o modelo "RLS por perfil" de propósito: não há perfil, ninguém lê ou escreve
 * esta tabela diretamente. Grants e funções: migração 0005.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** `login` (senha) ou `mfa` (código do 2FA). */
    kind: text("kind").notNull(),
    /** IPv4 ou prefixo /64 do IPv6 (ver `clientIpFrom`), ou `unknown`. */
    ip: text("ip").notNull(),
    /** SHA-256 (hex) do e-mail normalizado (login) ou do ID do usuário (2FA): sem PII em claro. */
    subjectHash: text("subject_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("auth_attempts_kind_check", sql`${table.kind} in ('login', 'mfa')`),
    check("auth_attempts_ip_check", sql`char_length(${table.ip}) between 1 and 64`),
    check("auth_attempts_subject_check", sql`${table.subjectHash} ~ '^[0-9a-f]{64}$'`),
    index("auth_attempts_ip_idx").on(table.kind, table.ip, table.createdAt),
    index("auth_attempts_pair_idx").on(table.kind, table.subjectHash, table.ip, table.createdAt),
    index("auth_attempts_created_idx").on(table.createdAt),
  ],
).enableRLS();

/**
 * Especialidades. Mesma lista de `SPECIALTIES` em `src/lib/catalog/labels.ts` (duplicada de
 * propósito para o código de tela não importar o Drizzle; um teste confere que são iguais).
 */
export const specialty = pgEnum("specialty", [
  "physiotherapy",
  "dentistry",
  "psychology",
]);

/**
 * Catálogo (1B-1): serviços, convênios e valores. RLS e grants em migração SQL (0007).
 * Quem lê: `services` admin/recepção/profissional; `insurances` e `service_prices` só
 * admin/recepção (o profissional NUNCA vê valores: por isso o valor não é coluna de
 * `services`, a RLS é por linha). Quem escreve: só admin. Sem DELETE (exclusão lógica).
 */
export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    specialty: specialty("specialty").notNull(),
    durationMinutes: smallint("duration_minutes").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("services_name_check", sql`char_length(${table.name}) between 1 and 120 and ${table.name} ~ '^\\S(.*\\S)?$'`),
    check("services_duration_check", sql`${table.durationMinutes} between 5 and 480`),
    // Só para a FK composta de `professional_services` (serviço e profissional da mesma especialidade).
    unique("services_id_specialty_uq").on(table.id, table.specialty),
    uniqueIndex("services_specialty_name_uq")
      .on(table.specialty, sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} is null`),
  ],
).enableRLS();

export const insurances = pgTable(
  "insurances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("insurances_name_check", sql`char_length(${table.name}) between 1 and 120 and ${table.name} ~ '^\\S(.*\\S)?$'`),
    uniqueIndex("insurances_name_uq")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} is null`),
  ],
).enableRLS();

/**
 * Valor de um serviço: `insurance_id` nulo = valor PARTICULAR; preenchido = valor do convênio.
 * Ao agendar/cobrar (fases 2 e 5) o valor deve ser COPIADO para o atendimento: o preço de
 * hoje não pode reescrever o histórico.
 */
export const servicePrices = pgTable(
  "service_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    insuranceId: uuid("insurance_id").references(() => insurances.id, {
      onDelete: "restrict",
    }),
    priceCents: integer("price_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("service_prices_price_check", sql`${table.priceCents} between 0 and 10000000`),
    uniqueIndex("service_prices_particular_uq")
      .on(table.serviceId)
      .where(sql`${table.insuranceId} is null and ${table.deletedAt} is null`),
    uniqueIndex("service_prices_insurance_uq")
      .on(table.serviceId, table.insuranceId)
      .where(sql`${table.insuranceId} is not null and ${table.deletedAt} is null`),
    index("service_prices_insurance_idx").on(table.insuranceId),
  ],
).enableRLS();

/**
 * Profissionais de saúde (1B-2a). Quem lê: admin (todos), recepção (não removidos) e o próprio
 * profissional (só a linha cujo `profile_id` é o dele). Quem escreve: só admin. Sem DELETE
 * (exclusão lógica). RLS e grants em migração SQL.
 *
 * O vínculo com o login (`profile_id`) é opcional e único. O banco garante que o perfil
 * vinculado tem papel `professional` pela FK composta `(profile_id, link_role)` ->
 * `profiles(id, role)`, com `link_role` fixo em `professional` (sem trigger). O conselho
 * (CREFITO/CRO/CRP) é derivado da especialidade: não é guardado.
 */
export const professionals = pgTable(
  "professionals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    specialty: specialty("specialty").notNull(),
    /** Número do registro no conselho (texto livre; opcional). */
    registration: text("registration"),
    /** Só dígitos: DDD + número (10 ou 11). */
    phone: text("phone"),
    email: text("email"),
    profileId: uuid("profile_id"),
    linkRole: userRole("link_role").notNull().default("professional"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "professionals_name_check",
      sql`char_length(${table.fullName}) between 1 and 120 and ${table.fullName} ~ '^\\S(.*\\S)?$'`,
    ),
    check(
      "professionals_registration_check",
      sql`${table.registration} is null or (char_length(${table.registration}) between 3 and 30 and ${table.registration} ~ '^\\S(.*\\S)?$')`,
    ),
    check("professionals_phone_check", sql`${table.phone} is null or ${table.phone} ~ '^[0-9]{10,11}$'`),
    check(
      "professionals_email_check",
      sql`${table.email} is null or (char_length(${table.email}) <= 254 and ${table.email} ~ '^[^\\s@]+@[^\\s@]+$')`,
    ),
    check("professionals_link_role_check", sql`${table.linkRole} = 'professional'`),
    // Um profissional REMOVIDO não guarda o login: sem isso o perfil ficaria preso (a FK composta
    // impediria mudar o papel dele) por um cadastro que ninguém mais vê. Remover = soltar o login.
    check(
      "professionals_removed_unlinked_check",
      sql`${table.deletedAt} is null or ${table.profileId} is null`,
    ),
    foreignKey({
      name: "professionals_profile_fk",
      columns: [table.profileId, table.linkRole],
      foreignColumns: [profiles.id, profiles.role],
    }).onDelete("restrict"),
    // Só para a FK composta de `professional_services`.
    unique("professionals_id_specialty_uq").on(table.id, table.specialty),
    uniqueIndex("professionals_profile_uq")
      .on(table.profileId)
      .where(sql`${table.profileId} is not null and ${table.deletedAt} is null`),
    uniqueIndex("professionals_specialty_name_uq")
      .on(table.specialty, sql`lower(${table.fullName})`)
      .where(sql`${table.deletedAt} is null`),
  ],
).enableRLS();

/**
 * Serviços que cada profissional realiza. `specialty` repetida de propósito: as duas FKs
 * compostas obrigam o profissional e o serviço a serem da MESMA especialidade (um
 * fisioterapeuta não recebe serviço de odontologia, nem por chamada direta ao banco).
 * Tabela de ligação (configuração, não registro clínico): o admin pode apagar linhas.
 */
export const professionalServices = pgTable(
  "professional_services",
  {
    professionalId: uuid("professional_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    specialty: specialty("specialty").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "professional_services_pk", columns: [table.professionalId, table.serviceId] }),
    foreignKey({
      name: "professional_services_professional_fk",
      columns: [table.professionalId, table.specialty],
      foreignColumns: [professionals.id, professionals.specialty],
    }).onDelete("restrict"),
    foreignKey({
      name: "professional_services_service_fk",
      columns: [table.serviceId, table.specialty],
      foreignColumns: [services.id, services.specialty],
    }).onDelete("restrict"),
    index("professional_services_service_idx").on(table.serviceId),
  ],
).enableRLS();

/**
 * Grade semanal de atendimento (1B-2b): uma linha por FAIXA (`weekday` 0 = domingo a 6;
 * `start_minute`/`end_minute` em minutos desde a meia-noite, de 5 em 5, faixa meio-aberta
 * `[início, fim)`). O intervalo de almoço é o vão entre duas faixas do mesmo dia. A exclusão
 * `professional_work_hours_no_overlap` (btree_gist, na migração SQL: o drizzle-kit não modela
 * exclusão) impede faixas sobrepostas do mesmo profissional no mesmo dia; faixas que só
 * encostam valem. Editar a semana = apagar e recriar as faixas numa transação (só o admin).
 */
export const professionalWorkHours = pgTable(
  "professional_work_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "restrict" }),
    weekday: smallint("weekday").notNull(),
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("professional_work_hours_weekday_check", sql`${table.weekday} between 0 and 6`),
    check(
      "professional_work_hours_range_check",
      sql`${table.startMinute} between 0 and 1435 and ${table.endMinute} between 5 and 1440 and ${table.startMinute} < ${table.endMinute} and ${table.startMinute} % 5 = 0 and ${table.endMinute} % 5 = 0`,
    ),
    index("professional_work_hours_professional_idx").on(table.professionalId, table.weekday, table.startMinute),
  ],
).enableRLS();

/**
 * Folgas e bloqueios (1B-2b): períodos em que o profissional NÃO atende, em UTC (as telas
 * convertem de/para o horário de Brasília). Folga de dia inteiro = da meia-noite do primeiro dia
 * à meia-noite depois do último; bloqueio parcial = horário dentro do período. Sobreposição
 * entre folgas é permitida (vale a união). `reason` é texto livre visível à recepção e ao
 * próprio profissional: a tela pede para NÃO registrar dado de saúde.
 */
export const professionalTimeOff = pgTable(
  "professional_time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("professional_time_off_period_check", sql`${table.startsAt} < ${table.endsAt}`),
    check(
      "professional_time_off_max_period_check",
      sql`${table.endsAt} - ${table.startsAt} <= interval '366 days'`,
    ),
    // Mesma faixa da validação do app (2000 a 2100): pega ano de dígitos trocados mesmo por fora do app.
    check(
      "professional_time_off_bounds_check",
      sql`${table.startsAt} >= timestamptz '2000-01-01 00:00:00+00' and ${table.endsAt} < timestamptz '2101-01-02 00:00:00+00'`,
    ),
    check(
      "professional_time_off_reason_check",
      sql`${table.reason} is null or (char_length(${table.reason}) between 1 and 120 and ${table.reason} ~ '^\\S(.*\\S)?$')`,
    ),
    index("professional_time_off_professional_idx").on(table.professionalId, table.startsAt),
  ],
).enableRLS();

/**
 * Pacientes (1B-3a). DADO PESSOAL E DE SAÚDE (LGPD): a RLS é o que separa quem vê o quê.
 * `patients` guarda só o CLÍNICO-BÁSICO (nome, nascimento, contato): é o que o profissional vê, e só
 * dos pacientes VINCULADOS a ele (`patient_professionals`). CPF, endereço, convênio, responsável e
 * observações ficam em `patient_private` (só admin e recepção): a RLS é por linha, então o dado
 * que o profissional não pode ver é tabela própria, não coluna. Admin e recepção criam, editam e
 * inativam (`active`); só o admin remove (soft delete por `deleted_at`). Sem DELETE físico.
 */
export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    birthDate: date("birth_date", { mode: "string" }).notNull(),
    /** Só dígitos: DDD + número (10 ou 11). */
    phone: text("phone"),
    email: text("email"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "patients_name_check",
      sql`char_length(${table.fullName}) between 1 and 120 and ${table.fullName} ~ '^\\S(.*\\S)?$' and ${table.fullName} !~ '[\\x01-\\x1f\\x7f]'`,
    ),
    // Hoje em UTC nunca está atrás de hoje em Brasília: uma data válida digitada hoje nunca é recusada.
    check("patients_birth_date_check", sql`${table.birthDate} between date '1900-01-01' and current_date`),
    check("patients_phone_check", sql`${table.phone} is null or ${table.phone} ~ '^[0-9]{10,11}$'`),
    check(
      "patients_email_check",
      sql`${table.email} is null or (char_length(${table.email}) <= 254 and ${table.email} ~ '^[^\\s@]+@[^\\s@]+$')`,
    ),
    index("patients_name_idx").on(sql`lower(${table.fullName})`),
  ],
).enableRLS();

/** Texto opcional: nulo ou de 1 a `max` caracteres, sem espaço nas pontas nem caractere de controle. */
const optionalText = (column: AnyPgColumn, max: number) =>
  sql`${column} is null or (char_length(${column}) between 1 and ${sql.raw(String(max))} and ${column} ~ '^\\S(.*\\S)?$' and ${column} !~ '[\\x01-\\x1f\\x7f]')`;

/**
 * Dados administrativos do paciente (1:1 com `patients`): SÓ admin e recepção. CPF OU motivo de
 * não ter CPF (estrangeiro), nunca os dois nem nenhum. O CPF é único (inclusive de pacientes
 * removidos: reativar o cadastro é o caminho; o dado fica retido pela LGPD). A validade dos
 * dígitos do CPF é conferida no app (`src/lib/patients/cpf.ts`); o banco garante o formato.
 */
export const patientPrivate = pgTable(
  "patient_private",
  {
    patientId: uuid("patient_id")
      .primaryKey()
      .references(() => patients.id, { onDelete: "restrict" }),
    /** 11 dígitos. */
    cpf: text("cpf"),
    noCpfReason: text("no_cpf_reason"),
    /** 8 dígitos. */
    cep: text("cep"),
    street: text("street"),
    number: text("number"),
    complement: text("complement"),
    district: text("district"),
    city: text("city"),
    state: text("state"),
    insuranceId: uuid("insurance_id").references(() => insurances.id, { onDelete: "restrict" }),
    insuranceCard: text("insurance_card"),
    guardianName: text("guardian_name"),
    guardianRelationship: text("guardian_relationship"),
    guardianPhone: text("guardian_phone"),
    guardianCpf: text("guardian_cpf"),
    /** Observação administrativa: a tela avisa para NÃO registrar dado clínico. */
    adminNotes: text("admin_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("patient_private_cpf_check", sql`${table.cpf} is null or ${table.cpf} ~ '^[0-9]{11}$'`),
    check("patient_private_no_cpf_reason_check", optionalText(table.noCpfReason, 200)),
    check(
      "patient_private_cpf_or_reason_check",
      sql`(${table.cpf} is not null) <> (${table.noCpfReason} is not null)`,
    ),
    check("patient_private_cep_check", sql`${table.cep} is null or ${table.cep} ~ '^[0-9]{8}$'`),
    check("patient_private_street_check", optionalText(table.street, 120)),
    check("patient_private_number_check", optionalText(table.number, 20)),
    check("patient_private_complement_check", optionalText(table.complement, 60)),
    check("patient_private_district_check", optionalText(table.district, 60)),
    check("patient_private_city_check", optionalText(table.city, 60)),
    check("patient_private_state_check", sql`${table.state} is null or ${table.state} ~ '^[A-Z]{2}$'`),
    check("patient_private_card_check", optionalText(table.insuranceCard, 40)),
    check(
      "patient_private_card_insurance_check",
      sql`${table.insuranceCard} is null or ${table.insuranceId} is not null`,
    ),
    check("patient_private_guardian_name_check", optionalText(table.guardianName, 120)),
    check("patient_private_guardian_relationship_check", optionalText(table.guardianRelationship, 40)),
    check(
      "patient_private_guardian_phone_check",
      sql`${table.guardianPhone} is null or ${table.guardianPhone} ~ '^[0-9]{10,11}$'`,
    ),
    check(
      "patient_private_guardian_cpf_check",
      sql`${table.guardianCpf} is null or ${table.guardianCpf} ~ '^[0-9]{11}$'`,
    ),
    check(
      "patient_private_admin_notes_check",
      sql`${table.adminNotes} is null or (char_length(${table.adminNotes}) between 1 and 1000 and ${table.adminNotes} ~ '^\\S(.*\\S)?$' and ${table.adminNotes} !~ '[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]')`,
    ),
    uniqueIndex("patient_private_cpf_uq").on(table.cpf),
    index("patient_private_insurance_idx").on(table.insuranceId),
  ],
).enableRLS();

/**
 * Vínculo paciente-profissional: é o que define "os próprios pacientes" do profissional. Um
 * paciente pode ter vários profissionais. Admin e recepção definem; a agenda (fase 2) poderá criar
 * o vínculo no primeiro agendamento. Tabela de ligação (configuração): admin e recepção apagam linhas.
 */
export const patientProfessionals = pgTable(
  "patient_professionals",
  {
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "patient_professionals_pk", columns: [table.patientId, table.professionalId] }),
    index("patient_professionals_professional_idx").on(table.professionalId),
  ],
).enableRLS();
