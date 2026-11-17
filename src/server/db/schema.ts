import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
