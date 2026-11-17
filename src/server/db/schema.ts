import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
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
}).enableRLS();

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
