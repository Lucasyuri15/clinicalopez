import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listConsents } from "@/server/patients/consent-queries";
import { restorePatient } from "@/server/patients/mutations";
import { getPatient, listPatients, listRemovedPatients } from "@/server/patients/queries";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Reativar paciente removido (1B-3b) contra o Supabase DEV pelo caminho REAL do app
 * (`DATABASE_URL` → `app_backend` → `authenticated` sob RLS, via `withUser`). Só dados FICTÍCIOS.
 * Fixtures commitados pelo dono e apagados no fim. A RLS em si está em `patients-rls-write.test.ts`;
 * aqui se prova a camada de dados: só o admin enxerga e reativa removidos, e o paciente volta com
 * o cadastro, o CPF e o histórico de consentimentos intactos.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-rest ${randomUUID().slice(0, 8)}]`;

describe.skipIf(!hasDb)("reativar paciente removido (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = { admin: { userId: randomUUID() }, reception: { userId: randomUUID() } };
  const ids = { older: "", newer: "", active: "" };
  const OLDER_CPF = String(30_000_000_000 + Math.floor(Math.random() * 1_000_000_000));

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`rest-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin'),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception')`;
      const rows = await owner`insert into public.patients (full_name, birth_date, deleted_at) values
        (${`${TAG} Removido Antigo`}, '1980-02-02', now() - interval '2 days'),
        (${`${TAG} Removido Recente`}, '1981-03-03', now() - interval '1 day'),
        (${`${TAG} Ativo`}, '1982-04-04', null) returning id`;
      ids.older = rows[0]!.id;
      ids.newer = rows[1]!.id;
      ids.active = rows[2]!.id;
      await owner`insert into public.patient_private (patient_id, cpf) values (${ids.older}, ${OLDER_CPF})`;
      await owner`insert into public.patient_consents (patient_id, kind, granted, given_by, method, occurred_on, registered_by)
        values (${ids.older}, 'data_processing', true, 'patient', 'signed_paper', '2026-01-01', ${users.admin.userId})`;
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function cleanup() {
    const like = `${TAG}%`;
    await owner`delete from public.patient_consents where patient_id in
      (select id from public.patients where full_name like ${like})`;
    await owner`delete from public.patient_private where patient_id in
      (select id from public.patients where full_name like ${like})`;
    await owner`delete from public.patients where full_name like ${like}`;
    const all = Object.values(users).map((u) => u.userId);
    await owner`delete from public.profiles where id = any(${all})`;
    await owner`delete from auth.users where id = any(${all})`;
  }

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await owner.end({ timeout: 5 });
    }
  });

  const mine = <T extends { fullName: string }>(items: T[]) => items.filter((item) => item.fullName.startsWith(TAG));

  it("o admin lista só os removidos, o removido mais recentemente primeiro, com o clínico-básico", async () => {
    const removed = mine(await listRemovedPatients(users.admin));
    expect(removed.map((item) => item.fullName)).toEqual([`${TAG} Removido Recente`, `${TAG} Removido Antigo`]);
    expect(removed[0]).toMatchObject({ id: ids.newer, birthDate: "1981-03-03" });
    expect(removed[0]!.deletedAt).toBeInstanceOf(Date);
    expect(removed[0]).not.toHaveProperty("cpf");
  });

  it("a recepção não enxerga removidos (a RLS não devolve linha)", async () => {
    expect(mine(await listRemovedPatients(users.reception))).toEqual([]);
  });

  it("quem não é o admin não reativa: nada muda (not-found) e o paciente continua removido", async () => {
    expect(await restorePatient(users.reception, ids.newer)).toEqual({ ok: false, reason: "not-found" });
    const [row] = await owner`select deleted_at from public.patients where id = ${ids.newer}`;
    expect(row!.deleted_at).not.toBeNull();
  });

  it("paciente que não está removido, não existe ou UUID inválido: not-found", async () => {
    expect(await restorePatient(users.admin, ids.active)).toEqual({ ok: false, reason: "not-found" });
    expect(await restorePatient(users.admin, randomUUID())).toEqual({ ok: false, reason: "not-found" });
    expect(await restorePatient(users.admin, "não-é-uuid")).toEqual({ ok: false, reason: "not-found" });
  });

  it("o admin reativa: volta às listas, com o CPF e o histórico de consentimentos intactos", async () => {
    expect(mine((await listPatients(users.reception, { search: TAG })).items)).toHaveLength(1); // só o ativo

    expect(await restorePatient(users.admin, ids.older)).toEqual({ ok: true, id: ids.older });

    const visible = mine((await listPatients(users.reception, { search: TAG })).items).map((item) => item.fullName);
    expect(visible.sort()).toEqual([`${TAG} Ativo`, `${TAG} Removido Antigo`].sort());
    expect(mine(await listRemovedPatients(users.admin)).map((item) => item.id)).toEqual([ids.newer]);

    const detail = await getPatient(users.reception, ids.older, { staff: true });
    expect(detail?.private?.cpf).toBe(OLDER_CPF);
    expect(await listConsents(users.admin, ids.older)).toHaveLength(1);
  });

  it("reativar de novo o mesmo paciente: not-found (já não está removido)", async () => {
    expect(await restorePatient(users.admin, ids.older)).toEqual({ ok: false, reason: "not-found" });
  });
});
