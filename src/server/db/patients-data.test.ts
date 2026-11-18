import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PatientInput } from "@/lib/patients/schemas";
import {
  createPatient,
  removePatient,
  setPatientActive,
  updatePatient,
} from "@/server/patients/mutations";
import { getPatient, listPatients } from "@/server/patients/queries";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Camada de dados de pacientes contra o Supabase DEV pelo caminho REAL do app (`DATABASE_URL` →
 * `app_backend` → `authenticated` sob RLS, via `withUser`). Só dados FICTÍCIOS. Fixtures
 * commitados pelo dono e apagados no fim (o código usa outra conexão). Quem vê o quê é da RLS
 * (`patients-rls.test.ts`); aqui se prova que consultas e gravações a respeitam de ponta a
 * ponta, que gravar é atômico, que o CPF duplicado vira resultado (não erro) e que a busca do
 * profissional não vira um oráculo de CPF.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-pac ${randomUUID().slice(0, 8)}]`;
/** CPFs fictícios só no formato (11 dígitos): a conferência dos dígitos é do app. */
let cpfSeed = 20_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
const nextCpf = () => String((cpfSeed += 97));

/** O tipo devolvido guarda o que `over` define (com `id` string, serve para `updatePatient`). */
const input = <T extends Partial<PatientInput> = Record<never, never>>(over: T = {} as T): PatientInput & T =>
  ({
  fullName: `${TAG} Maria`,
  birthDate: "1990-05-10",
  phone: "11912345678",
  email: null,
  cpf: nextCpf(),
  noCpfReason: null,
  cep: null,
  street: null,
  number: null,
  complement: null,
  district: null,
  city: null,
  state: null,
  insuranceId: null,
  insuranceCard: null,
  guardianName: null,
  guardianRelationship: null,
  guardianPhone: null,
  guardianCpf: null,
  adminNotes: null,
  professionalIds: [],
  ...over,
  }) as PatientInput & T;

describe.skipIf(!hasDb)("camada de dados de pacientes (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    prof1: { userId: randomUUID() },
    prof2: { userId: randomUUID() },
  };
  const ids = { p1: "", p2: "", removedProfessional: "", insurance: "", deletedInsurance: "" };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`pac-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin'),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception'),
        (${users.prof1.userId}, ${`${TAG} Login Um`}, 'professional'),
        (${users.prof2.userId}, ${`${TAG} Login Dois`}, 'professional')`;
      const [p1] = await owner`insert into public.professionals (full_name, specialty, profile_id)
        values (${`${TAG} Ana`}, 'physiotherapy', ${users.prof1.userId}) returning id`;
      const [p2] = await owner`insert into public.professionals (full_name, specialty, profile_id)
        values (${`${TAG} Bia`}, 'physiotherapy', ${users.prof2.userId}) returning id`;
      const [removed] = await owner`insert into public.professionals (full_name, specialty, deleted_at)
        values (${`${TAG} Antigo`}, 'dentistry', now()) returning id`;
      const [insurance] = await owner`insert into public.insurances (name) values (${`${TAG} Plano`}) returning id`;
      const [gone] = await owner`insert into public.insurances (name, deleted_at)
        values (${`${TAG} Plano Antigo`}, now()) returning id`;
      Object.assign(ids, {
        p1: p1!.id,
        p2: p2!.id,
        removedProfessional: removed!.id,
        insurance: insurance!.id,
        deletedInsurance: gone!.id,
      });
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function cleanup() {
    const like = `${TAG}%`;
    await owner`delete from public.patient_professionals where patient_id in
      (select id from public.patients where full_name like ${like})`;
    await owner`delete from public.patient_private where patient_id in
      (select id from public.patients where full_name like ${like})`;
    await owner`delete from public.patients where full_name like ${like}`;
    await owner`delete from public.professionals where full_name like ${like}`;
    await owner`delete from public.insurances where name like ${like}`;
    const all = Object.values(users).map((u) => u.userId);
    await owner`delete from public.profiles where id = any(${all})`;
    await owner`delete from auth.users where id = any(${all})`;
  }

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await owner?.end({ timeout: 2 });
    }
  });

  const patientRows = (name: string) =>
    owner`select id, full_name, birth_date::text as birth_date, phone, email, active, deleted_at
      from public.patients where full_name = ${name}`;
  const privateOf = async (patientId: string) =>
    (await owner`select * from public.patient_private where patient_id = ${patientId}`)[0];
  const linksOf = async (patientId: string) =>
    (await owner`select professional_id from public.patient_professionals where patient_id = ${patientId}`)
      .map((r) => r.professional_id as string)
      .sort();

  describe("criar", () => {
    it("admin cria paciente, dados administrativos e vínculos numa só gravação", async () => {
      const data = input({
        fullName: `${TAG} Completa`,
        email: "completa@teste.invalid",
        cep: "01310100",
        street: "Rua Fictícia",
        number: "10",
        state: "SP",
        city: "São Paulo",
        insuranceId: ids.insurance,
        insuranceCard: "123 456",
        guardianName: "Responsável Fictício",
        guardianRelationship: "Mãe",
        guardianPhone: "11988887777",
        adminNotes: "linha 1\nlinha 2",
        professionalIds: [ids.p1, ids.p2],
      });
      const result = await createPatient(users.admin, data);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [row] = await patientRows(data.fullName);
      expect(row).toMatchObject({ id: result.id, birth_date: "1990-05-10", phone: "11912345678", active: true, deleted_at: null });
      expect(await privateOf(result.id)).toMatchObject({
        cpf: data.cpf,
        no_cpf_reason: null,
        cep: "01310100",
        street: "Rua Fictícia",
        insurance_id: ids.insurance,
        insurance_card: "123 456",
        guardian_name: "Responsável Fictício",
        admin_notes: "linha 1\nlinha 2",
      });
      expect(await linksOf(result.id)).toEqual([ids.p1, ids.p2].sort());
    });

    it("recepção cria; 'Sem CPF' grava o motivo e deixa o CPF nulo", async () => {
      const data = input({ fullName: `${TAG} Estrangeira`, cpf: null, noCpfReason: "Estrangeira, sem CPF" });
      const result = await createPatient(users.reception, data);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(await privateOf(result.id)).toMatchObject({ cpf: null, no_cpf_reason: "Estrangeira, sem CPF" });
    });

    it("CPF repetido vira 'duplicate-cpf' e NADA fica gravado (atômico)", async () => {
      const cpf = nextCpf();
      expect((await createPatient(users.reception, input({ fullName: `${TAG} Original`, cpf }))).ok).toBe(true);
      const dup = await createPatient(
        users.reception,
        input({ fullName: `${TAG} Repetida`, cpf, professionalIds: [ids.p1] }),
      );
      expect(dup).toEqual({ ok: false, reason: "duplicate-cpf" });
      expect(await patientRows(`${TAG} Repetida`)).toHaveLength(0);
    });

    it("o profissional não cria paciente ('denied') e nada fica gravado", async () => {
      const result = await createPatient(users.prof1, input({ fullName: `${TAG} Invasao`, professionalIds: [ids.p1] }));
      expect(result).toEqual({ ok: false, reason: "denied" });
      expect(await patientRows(`${TAG} Invasao`)).toHaveLength(0);
    });

    it("profissional removido no vínculo desfaz TUDO ('denied')", async () => {
      const result = await createPatient(
        users.admin,
        input({ fullName: `${TAG} Vinculo Ruim`, professionalIds: [ids.p1, ids.removedProfessional] }),
      );
      expect(result).toEqual({ ok: false, reason: "denied" });
      expect(await patientRows(`${TAG} Vinculo Ruim`)).toHaveLength(0);
    });

    it("convênio removido ou inexistente desfaz tudo ('denied')", async () => {
      for (const insuranceId of [ids.deletedInsurance, randomUUID()]) {
        const result = await createPatient(
          users.reception,
          input({ fullName: `${TAG} Convenio Ruim`, insuranceId, insuranceCard: "1" }),
        );
        expect(result, insuranceId).toEqual({ ok: false, reason: "denied" });
      }
      expect(await patientRows(`${TAG} Convenio Ruim`)).toHaveLength(0);
    });
  });

  describe("editar", () => {
    it("recepção edita o cadastro, os dados administrativos e SUBSTITUI os vínculos", async () => {
      const created = await createPatient(
        users.admin,
        input({ fullName: `${TAG} Editar`, professionalIds: [ids.p1], adminNotes: "antes" }),
      );
      if (!created.ok) throw new Error("fixture");
      const cpf = nextCpf();
      const result = await updatePatient(
        users.reception,
        input({
          id: created.id,
          fullName: `${TAG} Editar Depois`,
          phone: null,
          email: "depois@teste.invalid",
          cpf,
          street: "Rua Nova",
          adminNotes: null,
          professionalIds: [ids.p2],
        }),
      );
      expect(result).toEqual({ ok: true, id: created.id });
      const [row] = await patientRows(`${TAG} Editar Depois`);
      expect(row).toMatchObject({ id: created.id, phone: null, email: "depois@teste.invalid" });
      expect(await privateOf(created.id)).toMatchObject({ cpf, street: "Rua Nova", admin_notes: null });
      expect(await linksOf(created.id)).toEqual([ids.p2]);
    });

    it("trocar CPF por 'Sem CPF' (e de volta) funciona", async () => {
      const created = await createPatient(users.admin, input({ fullName: `${TAG} Troca Cpf` }));
      if (!created.ok) throw new Error("fixture");
      const toReason = await updatePatient(
        users.admin,
        input({ id: created.id, fullName: `${TAG} Troca Cpf`, cpf: null, noCpfReason: "Passou a ser estrangeiro" }),
      );
      expect(toReason.ok).toBe(true);
      expect(await privateOf(created.id)).toMatchObject({ cpf: null, no_cpf_reason: "Passou a ser estrangeiro" });
      const cpf = nextCpf();
      expect((await updatePatient(users.admin, input({ id: created.id, fullName: `${TAG} Troca Cpf`, cpf }))).ok).toBe(true);
      expect(await privateOf(created.id)).toMatchObject({ cpf, no_cpf_reason: null });
    });

    it("vínculo com profissional que depois foi DESATIVADO é mantido ao reeditar (não vira 'denied')", async () => {
      const [inactive] = await owner`insert into public.professionals (full_name, specialty, active)
        values (${`${TAG} Inativo`}, 'psychology', false) returning id`;
      await owner`insert into public.patients (full_name, birth_date) values (${`${TAG} Com Inativo`}, '1980-01-01')`;
      const [patient] = await patientRows(`${TAG} Com Inativo`);
      await owner`insert into public.patient_private (patient_id, cpf) values (${patient!.id}, ${nextCpf()})`;
      await owner`insert into public.patient_professionals (patient_id, professional_id) values (${patient!.id}, ${inactive!.id})`;
      const result = await updatePatient(
        users.reception,
        input({ id: patient!.id, fullName: `${TAG} Com Inativo`, birthDate: "1980-01-01", professionalIds: [inactive!.id, ids.p1] }),
      );
      expect(result.ok).toBe(true);
      expect(await linksOf(patient!.id)).toEqual([inactive!.id, ids.p1].sort());
    });

    it("CPF de outro paciente: 'duplicate-cpf' e o cadastro original fica intacto", async () => {
      const a = await createPatient(users.admin, input({ fullName: `${TAG} Dono do Cpf` }));
      const b = await createPatient(users.admin, input({ fullName: `${TAG} Quer o Cpf`, professionalIds: [ids.p1] }));
      if (!a.ok || !b.ok) throw new Error("fixture");
      const taken = (await privateOf(a.id))!.cpf as string;
      const result = await updatePatient(
        users.reception,
        input({ id: b.id, fullName: `${TAG} Quer o Cpf Mudou`, cpf: taken, professionalIds: [ids.p2] }),
      );
      expect(result).toEqual({ ok: false, reason: "duplicate-cpf" });
      expect(await patientRows(`${TAG} Quer o Cpf Mudou`)).toHaveLength(0); // nome não mudou
      expect(await linksOf(b.id)).toEqual([ids.p1]); // vínculos intactos
    });

    it("paciente inexistente ou removido: 'not-found'", async () => {
      expect(await updatePatient(users.admin, input({ id: randomUUID() }))).toEqual({ ok: false, reason: "not-found" });
      const created = await createPatient(users.admin, input({ fullName: `${TAG} Vai Sumir` }));
      if (!created.ok) throw new Error("fixture");
      expect((await removePatient(users.admin, created.id)).ok).toBe(true);
      expect(await updatePatient(users.admin, input({ id: created.id, fullName: `${TAG} Vai Sumir` }))).toEqual({
        ok: false,
        reason: "not-found",
      });
    });

    it("o profissional não edita nem o paciente dele ('not-found') e nada muda", async () => {
      const created = await createPatient(users.admin, input({ fullName: `${TAG} Do Profissional`, professionalIds: [ids.p1] }));
      if (!created.ok) throw new Error("fixture");
      const result = await updatePatient(
        users.prof1,
        input({ id: created.id, fullName: `${TAG} Invasor`, professionalIds: [ids.p1, ids.p2] }),
      );
      expect(result.ok).toBe(false);
      expect(await patientRows(`${TAG} Invasor`)).toHaveLength(0);
      expect(await linksOf(created.id)).toEqual([ids.p1]);
    });

    it("duas edições SIMULTÂNEAS do mesmo paciente não se atropelam (trava): ambas ok, vínculos coerentes", async () => {
      const created = await createPatient(users.admin, input({ fullName: `${TAG} Corrida`, professionalIds: [ids.p1] }));
      if (!created.ok) throw new Error("fixture");
      const cpf = (await privateOf(created.id))!.cpf as string;
      const [first, second] = await Promise.all([
        updatePatient(users.admin, input({ id: created.id, fullName: `${TAG} Corrida`, cpf, professionalIds: [ids.p2] })),
        updatePatient(users.reception, input({ id: created.id, fullName: `${TAG} Corrida`, cpf, professionalIds: [ids.p1, ids.p2] })),
      ]);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      const links = await linksOf(created.id);
      expect([[ids.p2], [ids.p1, ids.p2].sort()]).toContainEqual(links);
    });
  });

  describe("trava por paciente", () => {
    it("uma edição ESPERA a transação que já está editando o mesmo paciente, e conclui quando ela termina", async () => {
      const created = await createPatient(users.admin, input({ fullName: `${TAG} Trava`, professionalIds: [ids.p1] }));
      if (!created.ok) throw new Error("fixture");
      const cpf = (await privateOf(created.id))!.cpf as string;

      // outra transação segura a trava do paciente (como uma edição em andamento)
      let release!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const gotLock = new Promise<void>((resolve) => (locked = resolve));
      // Conexão PRÓPRIA para segurar a trava: `owner` tem `max: 1` e a conferência abaixo ficaria na fila.
      const locker = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1, onnotice: () => {} });
      const holder = locker.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`patient:${created.id}`}, 0))`;
        locked();
        await hold;
      });
      await gotLock;

      let finished = false;
      const edit = updatePatient(users.reception, input({ id: created.id, fullName: `${TAG} Trava`, cpf, professionalIds: [ids.p2] })).then((result) => {
        finished = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(finished).toBe(false); // sem a trava, já teria terminado
      expect(await linksOf(created.id)).toEqual([ids.p1]); // e nada mudou ainda

      release();
      await holder;
      await locker.end({ timeout: 2 });
      expect((await edit).ok).toBe(true);
      expect(await linksOf(created.id)).toEqual([ids.p2]);
    });
  });

  describe("inativar e remover", () => {
    it("admin e recepção inativam e reativam; o profissional não ('not-found')", async () => {
      const created = await createPatient(users.admin, input({ fullName: `${TAG} Inativar`, professionalIds: [ids.p1] }));
      if (!created.ok) throw new Error("fixture");
      expect((await setPatientActive(users.reception, created.id, false)).ok).toBe(true);
      expect((await patientRows(`${TAG} Inativar`))[0]!.active).toBe(false);
      expect((await setPatientActive(users.admin, created.id, true)).ok).toBe(true);
      expect((await patientRows(`${TAG} Inativar`))[0]!.active).toBe(true);
      expect(await setPatientActive(users.prof1, created.id, false)).toEqual({ ok: false, reason: "not-found" });
      expect((await patientRows(`${TAG} Inativar`))[0]!.active).toBe(true);
    });

    it("SÓ o admin remove: a recepção recebe 'denied' e o paciente continua", async () => {
      const created = await createPatient(users.admin, input({ fullName: `${TAG} Remover` }));
      if (!created.ok) throw new Error("fixture");
      expect(await removePatient(users.reception, created.id)).toEqual({ ok: false, reason: "denied" });
      expect((await patientRows(`${TAG} Remover`))[0]!.deleted_at).toBeNull();
      expect(await removePatient(users.admin, created.id)).toEqual({ ok: true, id: created.id });
      expect((await patientRows(`${TAG} Remover`))[0]!.deleted_at).not.toBeNull();
      expect(await removePatient(users.admin, created.id)).toEqual({ ok: false, reason: "not-found" });
    });

    it("removido some das consultas de todos, inclusive do admin (a tela nunca o mostra)", async () => {
      const created = await createPatient(users.admin, input({ fullName: `${TAG} Sumido`, professionalIds: [ids.p1] }));
      if (!created.ok) throw new Error("fixture");
      await removePatient(users.admin, created.id);
      for (const who of [users.admin, users.reception, users.prof1]) {
        expect(await getPatient(who, created.id, { staff: who !== users.prof1 })).toBeNull();
        expect((await listPatients(who, { search: `${TAG} Sumido` })).items).toEqual([]);
      }
    });
  });

  describe("consultas", () => {
    const seeded: Record<string, string> = {};
    beforeAll(async () => {
      const make = async (key: string, over: Partial<PatientInput>) => {
        const result = await createPatient(users.admin, input({ fullName: `${TAG} Lista ${key}`, ...over }));
        if (!result.ok) throw new Error(`fixture ${key}`);
        seeded[key] = result.id;
      };
      await make("A", { professionalIds: [ids.p1] });
      await make("B", { professionalIds: [ids.p2] });
      await make("C", { professionalIds: [ids.p1, ids.p2] });
      await make("D", {});
      await make("Joao", { fullName: `${TAG} Lista João Ação`, professionalIds: [ids.p1] });
    });

    const names = (items: { fullName: string }[]) => items.map((i) => i.fullName.replace(`${TAG} `, ""));

    it("admin e recepção listam todos, em ordem alfabética; o profissional só os vinculados a ele", async () => {
      const search = { search: `${TAG} Lista` };
      const expectedAll = ["Lista A", "Lista B", "Lista C", "Lista D", "Lista João Ação"];
      expect(names((await listPatients(users.admin, search)).items)).toEqual(expectedAll);
      expect(names((await listPatients(users.reception, search)).items)).toEqual(expectedAll);
      expect(names((await listPatients(users.prof1, search)).items)).toEqual(["Lista A", "Lista C", "Lista João Ação"]);
      expect(names((await listPatients(users.prof2, search)).items)).toEqual(["Lista B", "Lista C"]);
    });

    it("a lista traz só o clínico-básico (nunca CPF, endereço, convênio, responsável ou observações)", async () => {
      const { items } = await listPatients(users.admin, { search: `${TAG} Lista A` });
      expect(Object.keys(items[0]!).sort()).toEqual(["active", "birthDate", "email", "fullName", "id", "phone"]);
    });

    it("busca sem acento e sem diferenciar maiúsculas ('joao acao' acha 'João Ação')", async () => {
      for (const term of ["joao acao", "JOÃO AÇÃO", "João Ação"]) {
        expect(names((await listPatients(users.reception, { search: `${TAG} Lista ${term}` })).items), term).toEqual(["Lista João Ação"]);
      }
    });

    it("sem staff, getPatient nem consulta os dados administrativos (defesa em profundidade)", async () => {
      // Mesmo um admin, se a tela pedir como não-staff, recebe só o básico: o código não depende só da RLS.
      const detail = await getPatient(users.admin, seeded.C!, { staff: false });
      expect(detail).toMatchObject({ id: seeded.C });
      expect(detail?.private).toBeNull();
      expect(detail?.professionalIds).toEqual([]);
    });

    it("a busca junta espaços repetidos e ignora caracteres de controle (um byte nulo não derruba a consulta)", async () => {
      expect(names((await listPatients(users.reception, { search: `${TAG}   Lista    A` })).items)).toEqual(["Lista A"]);
      await expect(listPatients(users.reception, { search: "Maria\u0000" })).resolves.toBeDefined();
    });

    it("curingas do LIKE são tratados como texto ('%' e '_' não casam tudo)", async () => {
      expect((await listPatients(users.admin, { search: "%" })).items.filter((i) => i.fullName.startsWith(TAG))).toEqual([]);
      expect((await listPatients(users.admin, { search: `${TAG} Lista _` })).items).toEqual([]);
    });

    it("busca por CPF (prefixo de 3+ dígitos) acha para admin e recepção, e NÃO para o profissional (nem do próprio paciente)", async () => {
      const cpf = (await privateOf(seeded.A!))!.cpf as string;
      for (const who of [users.admin, users.reception]) {
        expect(names((await listPatients(who, { search: cpf })).items), "completo").toEqual(["Lista A"]);
        expect(names((await listPatients(who, { search: cpf.slice(0, 8) })).items).includes("Lista A")).toBe(true);
      }
      // o profissional vê o paciente pelo nome, mas o CPF não pode servir de pergunta (oráculo)
      expect(names((await listPatients(users.prof1, { search: `${TAG} Lista A` })).items)).toEqual(["Lista A"]);
      expect((await listPatients(users.prof1, { search: cpf })).items).toEqual([]);
    });

    it("busca por CPF formatado ('000.000.000-00') também vale", async () => {
      const cpf = (await privateOf(seeded.A!))!.cpf as string;
      const formatted = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
      expect(names((await listPatients(users.reception, { search: formatted })).items)).toEqual(["Lista A"]);
    });

    it("limite: devolve até `limit` e avisa que há mais", async () => {
      const page = await listPatients(users.admin, { search: `${TAG} Lista`, limit: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.truncated).toBe(true);
      const all = await listPatients(users.admin, { search: `${TAG} Lista`, limit: 50 });
      expect(all.truncated).toBe(false);
    });

    it("getPatient: admin e recepção recebem o cadastro COMPLETO com os vínculos", async () => {
      for (const who of [users.admin, users.reception]) {
        const detail = await getPatient(who, seeded.C!, { staff: true });
        expect(detail).toMatchObject({ id: seeded.C, fullName: `${TAG} Lista C`, active: true });
        expect(detail?.private).toMatchObject({ noCpfReason: null });
        expect(detail?.private?.cpf).toHaveLength(11);
        expect([...(detail?.professionalIds ?? [])].sort()).toEqual([ids.p1, ids.p2].sort());
      }
    });

    it("getPatient para o PROFISSIONAL: só o básico, `private` nulo e nenhum vínculo; paciente alheio = null", async () => {
      const own = await getPatient(users.prof1, seeded.C!, { staff: false });
      expect(own).toMatchObject({ id: seeded.C, fullName: `${TAG} Lista C` });
      expect(own?.private).toBeNull();
      expect(own?.professionalIds).toEqual([]); // vínculos (nem o dele, nem o do colega) só para staff
      expect(JSON.stringify(own)).not.toContain((await privateOf(seeded.C!))!.cpf);
      expect(await getPatient(users.prof1, seeded.B!, { staff: false })).toBeNull(); // só de p2
      expect(await getPatient(users.prof1, seeded.D!, { staff: false })).toBeNull(); // sem vínculo
    });

    it("getPatient com identificador que não é UUID devolve null (sem erro de banco)", async () => {
      expect(await getPatient(users.admin, "abc", { staff: true })).toBeNull();
    });
  });
});
