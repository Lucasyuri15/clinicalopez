import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { changeAppointmentStatus } from "@/server/appointments/mutations";
import { getPatientRecord } from "@/server/clinical/queries";
import { addAddendum, finalizeNote, saveNote } from "@/server/clinical/mutations";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Camada de dados do prontuário (Fase 4A) contra o Supabase DEV pelo caminho REAL do app
 * (`DATABASE_URL` → `app_backend` → `authenticated` sob RLS, via `withUser`). Só dados FICTÍCIOS,
 * commitados pelo dono e apagados no fim (o código usa outra conexão). Prova: o fluxo criar → salvar →
 * finalizar → adendar; a trava depois de finalizar; a regra "só atendimento Realizado e só o autor";
 * o histórico por papel; uma linha de log por leitura e por gravação, sem texto; e as corridas.
 * Atendimentos em 2026-02 (passado, Realizados) e um agendado em 2031-10: nenhum outro arquivo usa.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-prontuario ${randomUUID().slice(0, 8)}]`;
const at = (day: string, time: string) => new Date(`${day}T${time}:00.000Z`);

describe.skipIf(!hasDb)("prontuário: camada de dados (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    profA: { userId: randomUUID() },
    profB: { userId: randomUUID() },
  };
  const ids = { pA: "", pB: "", svc: "", svcGone: "", pOut: "", aGone: "", aGone2: "", p1: "", a1: "", a2: "", a3: "", a4: "", aB1: "", aSched: "", aNoShow: "" };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`prontuario-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin'),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception'),
        (${users.profA.userId}, ${`${TAG} Login A`}, 'professional'),
        (${users.profB.userId}, ${`${TAG} Login B`}, 'professional')`;
      const pros = await owner`insert into public.professionals (full_name, specialty, profile_id, active) values
        (${`${TAG} Ana`}, 'physiotherapy', ${users.profA.userId}, true),
        (${`${TAG} Bia`}, 'physiotherapy', ${users.profB.userId}, true) returning id`;
      [ids.pA, ids.pB] = pros.map((row) => row.id as string) as [string, string];
      const [svc] = await owner`insert into public.services (name, specialty, duration_minutes)
        values (${`${TAG} Sessao`}, 'physiotherapy', 50) returning id`;
      ids.svc = svc!.id;
      const [svcGone] = await owner`insert into public.services (name, specialty, duration_minutes)
        values (${`${TAG} Sessao Antiga`}, 'physiotherapy', 50) returning id`;
      ids.svcGone = svcGone!.id;
      const [pOut] = await owner`insert into public.patients (full_name, birth_date)
        values (${`${TAG} Paciente Sem Vinculo`}, '1985-01-01') returning id`;
      ids.pOut = pOut!.id;
      const [p1] = await owner`insert into public.patients (full_name, birth_date)
        values (${`${TAG} Paciente Um`}, '1990-05-10') returning id`;
      ids.p1 = p1!.id;
      await owner`insert into public.patient_professionals (patient_id, professional_id) values (${ids.p1}, ${ids.pA}), (${ids.p1}, ${ids.pB})`;
      const appointment = async (professionalId: string, day: string, time: string, status: string) => {
        const end = new Date(at(day, time).getTime() + 50 * 60_000);
        const [row] = await owner`insert into public.appointments
          (professional_id, patient_id, service_id, specialty, starts_at, ends_at, status, cancel_reason, created_by)
          values (${professionalId}, ${ids.p1}, ${ids.svc}, 'physiotherapy', ${at(day, time)}, ${end}, ${status}, null, ${users.admin.userId})
          returning id`;
        return row!.id as string;
      };
      ids.a1 = await appointment(ids.pA, "2026-02-02", "10:00", "done");
      ids.a2 = await appointment(ids.pA, "2026-02-02", "11:00", "done");
      ids.a3 = await appointment(ids.pA, "2026-02-02", "12:00", "done");
      ids.a4 = await appointment(ids.pA, "2026-02-02", "13:00", "done");
      ids.aB1 = await appointment(ids.pB, "2026-02-02", "14:00", "done");
      ids.aNoShow = await appointment(ids.pA, "2026-02-02", "15:00", "no_show");
      ids.aSched = await appointment(ids.pA, "2031-10-06", "10:00", "scheduled");
      const goneAppointment = async (time: string) => {
        const [row] = await owner`insert into public.appointments
          (professional_id, patient_id, service_id, specialty, starts_at, ends_at, status, cancel_reason, created_by)
          values (${ids.pA}, ${ids.p1}, ${ids.svcGone}, 'physiotherapy', ${at("2026-02-03", time)}, ${new Date(at("2026-02-03", time).getTime() + 50 * 60_000)}, 'done', null, ${users.admin.userId})
          returning id`;
        return row!.id as string;
      };
      ids.aGone = await goneAppointment("10:00");
      ids.aGone2 = await goneAppointment("11:00");
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function wipeClinical() {
    const patientIds = owner`select id from public.patients where full_name like ${`${TAG}%`}`;
    await owner`delete from public.clinical_access_log where patient_id in (${patientIds})`;
    await owner`delete from public.clinical_note_addenda where note_id in
      (select id from public.clinical_notes where patient_id in (${patientIds}))`;
    await owner`delete from public.clinical_notes where patient_id in (${patientIds})`;
  }

  async function cleanup() {
    const like = `${TAG}%`;
    await wipeClinical();
    const patientIds = owner`select id from public.patients where full_name like ${like}`;
    await owner`delete from public.appointments where patient_id in (${patientIds})`;
    await owner`delete from public.patient_professionals where patient_id in (${patientIds})`;
    await owner`delete from public.patients where full_name like ${like}`;
    await owner`delete from public.professionals where full_name like ${like}`;
    await owner`delete from public.services where name like ${like}`;
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

  beforeEach(async () => {
    await wipeClinical();
    await owner`update public.appointments set status = 'done' where id = ${ids.a1}`;
  });

  const notesOf = async () => await owner`select * from public.clinical_notes where patient_id = ${ids.p1} order by created_at`;
  const logOf = async () =>
    await owner`select action, role, user_id, note_id from public.clinical_access_log where patient_id = ${ids.p1} order by id`;
  const actions = async () => (await logOf()).map((row) => row.action as string);
  const noteId = (result: { ok: boolean }) => (result as { ok: true; noteId: string }).noteId;

  describe("escrever", () => {
    it("fluxo completo: criar, salvar de novo, finalizar e adendar, com uma linha de log por gravação", async () => {
      const created = await saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] primeira versão" });
      expect(created.ok).toBe(true);
      const id = noteId(created);
      expect(await notesOf()).toMatchObject([{ id, status: "draft", body: "[teste] primeira versão", professional_id: ids.pA }]);

      expect(await saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] segunda versão" })).toEqual({ ok: true, noteId: id });
      expect((await notesOf())[0]).toMatchObject({ body: "[teste] segunda versão", status: "draft" });

      expect(await finalizeNote(users.profA, { noteId: id })).toEqual({ ok: true, noteId: id });
      expect((await notesOf())[0]).toMatchObject({ status: "finalized", finalized_by: users.profA.userId, body: "[teste] segunda versão" });

      expect(await saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] tarde demais" })).toEqual({ ok: false, reason: "locked" });
      expect(await finalizeNote(users.profA, { noteId: id })).toEqual({ ok: false, reason: "locked" });
      expect((await notesOf())[0]!.body).toBe("[teste] segunda versão");

      expect(await addAddendum(users.profA, { noteId: id, body: "[teste] correção" })).toEqual({ ok: true, noteId: id });
      const addenda = await owner`select * from public.clinical_note_addenda where note_id = ${id}`;
      expect(addenda).toMatchObject([{ body: "[teste] correção", created_by: users.profA.userId }]);

      // só as gravações que deram certo entram no log, e o log nunca tem o texto
      expect(await actions()).toEqual(["create_note", "update_draft", "finalize", "add_addendum"]);
      expect((await logOf()).every((row) => row.user_id === users.profA.userId && row.role === "professional")).toBe(true);
    });

    it("não existe rascunho vazio: texto só de espaços é recusado e nada é gravado nem logado", async () => {
      expect(await saveNote(users.profA, { appointmentId: ids.a1, body: "  \n " })).toEqual({ ok: false, reason: "denied" });
      expect(await notesOf()).toEqual([]);
      expect(await logOf()).toEqual([]);
    });

    it("só atendimento REALIZADO e que o profissional enxerga", async () => {
      expect(await saveNote(users.profA, { appointmentId: ids.aSched, body: "[teste] x" })).toEqual({ ok: false, reason: "not-realized" });
      expect(await saveNote(users.profA, { appointmentId: ids.aNoShow, body: "[teste] x" })).toEqual({ ok: false, reason: "not-realized" });
      expect(await saveNote(users.profA, { appointmentId: randomUUID(), body: "[teste] x" })).toEqual({ ok: false, reason: "not-found" });
      expect(await saveNote(users.profA, { appointmentId: ids.aB1, body: "[teste] x" })).toEqual({ ok: false, reason: "not-found" }); // é de B
      expect(await notesOf()).toEqual([]);
      expect(await logOf()).toEqual([]);
    });

    it("admin e recepção não gravam evolução (denied)", async () => {
      for (const user of [users.admin, users.reception]) {
        expect(await saveNote(user, { appointmentId: ids.a1, body: "[teste] x" })).toEqual({ ok: false, reason: "denied" });
      }
      expect(await notesOf()).toEqual([]);
    });

    it("o profissional B, vinculado ao mesmo paciente, não vê nem mexe na evolução de A", async () => {
      const id = noteId(await saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] de A" }));
      expect(await saveNote(users.profB, { appointmentId: ids.a1, body: "[teste] invasão" })).toEqual({ ok: false, reason: "not-found" });
      expect(await finalizeNote(users.profB, { noteId: id })).toEqual({ ok: false, reason: "not-found" });
      await finalizeNote(users.profA, { noteId: id });
      expect(await addAddendum(users.profB, { noteId: id, body: "[teste] invasão" })).toEqual({ ok: false, reason: "not-found" });
      expect((await notesOf())[0]).toMatchObject({ body: "[teste] de A", status: "finalized" });
    });

    it("adendo só em evolução finalizada", async () => {
      const id = noteId(await saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] rascunho" }));
      expect(await addAddendum(users.profA, { noteId: id, body: "[teste] cedo" })).toEqual({ ok: false, reason: "not-finalized" });
    });
  });

  describe("histórico do paciente", () => {
    async function seedNotes() {
      const first = noteId(await saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] evolução um" }));
      await finalizeNote(users.profA, { noteId: first });
      await addAddendum(users.profA, { noteId: first, body: "[teste] adendo um" });
      const second = noteId(await saveNote(users.profA, { appointmentId: ids.a2, body: "[teste] rascunho dois" }));
      const other = noteId(await saveNote(users.profB, { appointmentId: ids.aB1, body: "[teste] evolução de B" }));
      await finalizeNote(users.profB, { noteId: other });
      await wipeLog();
      return { first, second, other };
    }
    const wipeLog = async () => {
      await owner`delete from public.clinical_access_log where patient_id = ${ids.p1}`;
    };

    it("o profissional A vê só as dele (mais recente primeiro), os adendos e os Realizados sem evolução", async () => {
      const { first, second } = await seedNotes();
      const record = await getPatientRecord({ ...users.profA, role: "professional" }, ids.p1);
      expect(record).not.toBeNull();
      expect(record!.notes.map((note) => note.id)).toEqual([second, first]);
      expect(record!.notes[0]).toMatchObject({ status: "draft", body: "[teste] rascunho dois", addenda: [] });
      expect(record!.notes[1]).toMatchObject({ status: "finalized", professionalName: `${TAG} Ana` });
      expect(record!.notes[1]!.addenda.map((addendum) => addendum.body)).toEqual(["[teste] adendo um"]);
      expect(record!.pending.map((item) => item.appointmentId).sort()).toEqual([ids.a3, ids.a4, ids.aGone, ids.aGone2].sort());
    });

    it("o profissional B só vê a dele e o atendimento pendente dele", async () => {
      const { other } = await seedNotes();
      const record = await getPatientRecord({ ...users.profB, role: "professional" }, ids.p1);
      expect(record!.notes.map((note) => note.id)).toEqual([other]);
      expect(record!.pending).toEqual([]);
    });

    it("o admin vê as evoluções de todos (inclusive rascunhos) e nenhuma pendência", async () => {
      const { first, second, other } = await seedNotes();
      const record = await getPatientRecord({ ...users.admin, role: "admin" }, ids.p1);
      expect(record!.notes.map((note) => note.id).sort()).toEqual([first, second, other].sort());
      expect(record!.pending).toEqual([]);
    });

    it("a recepção recebe null e NADA é consultado nem registrado", async () => {
      await seedNotes();
      expect(await getPatientRecord({ ...users.reception, role: "reception" }, ids.p1)).toBeNull();
      expect(await logOf()).toEqual([]);
    });

    it("N textos devolvidos = N linhas `read_note` + 1 `read_history`, no papel e no nome de quem leu", async () => {
      const { first, second } = await seedNotes();
      await getPatientRecord({ ...users.profA, role: "professional" }, ids.p1);
      const rows = await logOf();
      expect(rows.map((row) => row.action).sort()).toEqual(["read_history", "read_note", "read_note"]);
      expect(rows.filter((row) => row.action === "read_note").map((row) => row.note_id).sort()).toEqual([first, second].sort());
      expect(rows.every((row) => row.user_id === users.profA.userId && row.role === "professional")).toBe(true);

      await wipeLog();
      await getPatientRecord({ ...users.admin, role: "admin" }, ids.p1);
      const adminRows = await logOf();
      expect(adminRows.filter((row) => row.action === "read_note")).toHaveLength(3);
      expect(adminRows.every((row) => row.user_id === users.admin.userId && row.role === "admin")).toBe(true);
    });

    it("sem evolução nenhuma, ainda registra a abertura do histórico", async () => {
      await getPatientRecord({ ...users.profB, role: "professional" }, ids.p1);
      expect(await actions()).toEqual(["read_history"]);
    });

    it("o log nunca guarda texto: só as colunas de quem, quando, ação, paciente e evolução", async () => {
      const columns = await owner`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'clinical_access_log' order by column_name`;
      expect(columns.map((row) => row.column_name)).toEqual(["action", "at", "id", "note_id", "patient_id", "role", "user_id"]);
    });

    it("a evolução continua do autor e na lista dele mesmo se o admin corrigir Realizada para Falta", async () => {
      const id = noteId(await saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] texto" }));
      const changed = await changeAppointmentStatus(users.admin, { id: ids.a1, status: "no_show" }, "admin");
      expect(changed.ok).toBe(true);
      const record = await getPatientRecord({ ...users.profA, role: "professional" }, ids.p1);
      expect(record!.notes.map((note) => note.id)).toContain(id);
      expect(record!.pending.map((item) => item.appointmentId)).not.toContain(ids.a1);
    });
  });

  describe("falhas que não podem passar em silêncio", () => {
    it("serviço REMOVIDO depois: o autor continua vendo a evolução e o atendimento pendente (rótulo de apoio)", async () => {
      const id = noteId(await saveNote(users.profA, { appointmentId: ids.aGone, body: "[teste] evolução de serviço antigo" }));
      await owner`update public.services set active = false, deleted_at = now() where id = ${ids.svcGone}`;
      try {
        const record = await getPatientRecord({ ...users.profA, role: "professional" }, ids.p1);
        expect(record!.notes.find((note) => note.id === id)).toMatchObject({ body: "[teste] evolução de serviço antigo", serviceName: "Serviço removido" });
        expect(record!.pending.find((item) => item.appointmentId === ids.aGone2)).toMatchObject({ serviceName: "Serviço removido" });
        // o admin continua vendo o nome verdadeiro
        const adminRecord = await getPatientRecord({ ...users.admin, role: "admin" }, ids.p1);
        expect(adminRecord!.notes.find((note) => note.id === id)?.serviceName).toBe(`${TAG} Sessao Antiga`);
      } finally {
        await owner`update public.services set active = true, deleted_at = null where id = ${ids.svcGone}`;
      }
    });

    it("se o log não puder ser gravado, a leitura FALHA e nada é devolvido (falha fechada, sem texto no erro)", async () => {
      // O profissional A não enxerga este paciente (sem vínculo) nem tem evolução dele: o log é recusado.
      const failure = await getPatientRecord({ ...users.profA, role: "professional" }, ids.pOut).then(
        () => null,
        (error: unknown) => error as Error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure!.message).toBe("Falha inesperada no banco (SQLSTATE 42501).");
      expect(await owner`select 1 from public.clinical_access_log where patient_id = ${ids.pOut}`).toEqual([]);
    });
  });

  describe("concorrência", () => {
    it("dois primeiros salvamentos ao mesmo tempo: uma evolução só e nenhum erro cru", async () => {
      const results = await Promise.all([
        saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] um" }),
        saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] dois" }),
      ]);
      for (const result of results) {
        expect(result.ok || result.reason === "busy").toBe(true);
      }
      expect(results.some((result) => result.ok)).toBe(true);
      expect(await notesOf()).toHaveLength(1);
    });

    it("salvar e finalizar ao mesmo tempo: sempre termina finalizada; salvar vence ou diz locked, nunca erro cru", async () => {
      const id = noteId(await saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] base" }));
      const [save, finalize] = await Promise.all([
        saveNote(users.profA, { appointmentId: ids.a1, body: "[teste] novo" }),
        finalizeNote(users.profA, { noteId: id }),
      ]);
      expect(finalize).toEqual({ ok: true, noteId: id });
      const row = (await notesOf())[0]!;
      expect(row.status).toBe("finalized");
      if (save.ok) expect(row.body).toBe("[teste] novo");
      else {
        expect(save).toEqual({ ok: false, reason: "locked" });
        expect(row.body).toBe("[teste] base");
      }
    });
  });
});
