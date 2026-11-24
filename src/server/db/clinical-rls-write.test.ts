import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ClinicalSeed, seedClinical } from "./clinical-rls-fixture";
import type { Tx } from "./client";
import { attempt, createRlsHarness, hasDb } from "./rls-harness";
import { clinicalAccessLog, clinicalNoteAddenda, clinicalNotes } from "./schema";

/**
 * RLS do prontuário (Fase 4A), parte 2: ESCRITA, CHECKs e gatilhos contra o Supabase DEV, só dados
 * FICTÍCIOS, transações sempre revertidas. Regras:
 *  - só o profissional AUTOR cria a evolução, só em atendimento REALIZADO e dele; nasce sempre
 *    rascunho; o autor edita o texto do rascunho e o finaliza; `finalized_*` e `updated_at` vêm do
 *    banco; a evolução FINALIZADA fica trancada (nem o autor altera) e a identidade nunca muda;
 *  - o adendo só entra em evolução FINALIZADA do próprio autor, com autor e data do banco;
 *  - o log aceita só admin e profissional, em nome próprio, com o papel do banco, de paciente que a
 *    pessoa enxerga e de evolução do mesmo paciente que ela enxerga;
 *  - nada é apagado e adendo e log nunca mudam. Quem não pode escrever falha com 42501 ANTES de
 *    qualquer constraint (o gatilho dispara antes do WITH CHECK da política).
 */
describe.skipIf(!hasDb)("RLS do prontuário: escrita, constraints e gatilhos (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared((tx, ids) => seedClinical(tx, ids, "Clinical Write"));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  type NewNote = typeof clinicalNotes.$inferInsert;
  /** Uma evolução nova de A: no atendimento Realizado livre de A (`apAFree`). */
  const nova = (s: ClinicalSeed, over: Partial<NewNote> = {}): NewNote => ({
    appointmentId: s.apAFree,
    patientId: s.pShared,
    professionalId: s.professionalA,
    body: "[teste] evolução nova",
    ...over,
  });
  const create = (tx: Tx, values: NewNote) => tx.insert(clinicalNotes).values(values).returning({ id: clinicalNotes.id });
  const readNote = async (tx: Tx, id: string) => (await tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, id)))[0];
  const update = (tx: Tx, id: string, set: Partial<NewNote>) =>
    tx.update(clinicalNotes).set(set).where(eq(clinicalNotes.id, id)).returning({ id: clinicalNotes.id });
  const addAddendum = (tx: Tx, noteId: string, over: Partial<typeof clinicalNoteAddenda.$inferInsert> = {}) =>
    tx.insert(clinicalNoteAddenda).values({ noteId, body: "[teste] adendo novo", ...over }).returning({ id: clinicalNoteAddenda.id });
  const log = (tx: Tx, values: typeof clinicalAccessLog.$inferInsert) => tx.insert(clinicalAccessLog).values(values);

  describe("criar a evolução", () => {
    it("o profissional autor cria o rascunho no atendimento Realizado dele, com data do banco", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional);
        const [row] = await create(tx, nova(s));
        expect(row?.id).toBeTruthy();
        await asOwner();
        expect(await readNote(tx, row!.id)).toMatchObject({
          status: "draft",
          finalizedAt: null,
          finalizedBy: null,
          professionalId: s.professionalA,
          appointmentId: s.apAFree,
        });
        const [instant] = await tx.execute<{ same: boolean }>(
          sql`select created_at = now() and updated_at = now() as same from public.clinical_notes where id = ${row!.id}`,
        );
        expect(instant?.same).toBe(true);
      });
    });

    it.each(["admin", "reception", "professional2", "stranger", "inactive", "deleted"] as const)(
      "usuário %s não cria evolução do profissional A (42501, antes de qualquer constraint)",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(await attempt(tx, (x) => create(x, nova(s)))).toBe("42501");
        });
      },
    );

    it("o profissional A com aal1 (só senha) não cria (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional, "aal1");
        expect(await attempt(tx, (x) => create(x, nova(s)))).toBe("42501");
      });
    });

    it("o profissional A não cria no atendimento de B nem fingindo ser B (42501: ele nem enxerga o atendimento)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, { appointmentId: s.apBFree })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { appointmentId: s.apBFree, professionalId: s.professionalB })))).toBe("42501");
      });
    });

    it("o profissional A não cria no atendimento de B que JÁ tem evolução: 42501, nunca 23505 (não revela a nota de B)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, { appointmentId: s.apB })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { appointmentId: s.apB, professionalId: s.professionalB })))).toBe("42501");
      });
    });

    it("INSERT ... ON CONFLICT DO UPDATE não reescreve uma evolução finalizada (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        const upsert = (x: Tx) =>
          x.insert(clinicalNotes).values(nova(s, { appointmentId: s.apA })).onConflictDoUpdate({ target: clinicalNotes.appointmentId, set: { body: "[teste] sobrescrito" } });
        expect(await attempt(tx, upsert)).toBe("42501");
      });
    });

    it.each([
      ["agendado", (s: ClinicalSeed) => s.apAScheduled],
      ["falta", (s: ClinicalSeed) => s.apANoShow],
      ["cancelado", (s: ClinicalSeed) => s.apACancelled],
    ])("só atendimento REALIZADO aceita evolução: %s é recusado (23514)", async (_label, pick) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, { appointmentId: pick(s) })))).toBe("23514");
      });
    });

    it("uma evolução por atendimento (23505) e o paciente tem de ser o do atendimento (23503)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, { appointmentId: s.apA })))).toBe("23505");
        expect(await attempt(tx, (x) => create(x, nova(s, { patientId: s.p1 })))).toBe("23503");
      });
    });

    it("não nasce finalizada, nem com autor ou data forjados (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        const forged = [
          { status: "finalized" as const, finalizedAt: new Date(), finalizedBy: ids.professional },
          { createdAt: new Date("2020-01-01T00:00:00Z") },
          { finalizedBy: ids.professional },
        ];
        for (const over of forged) expect(await attempt(tx, (x) => create(x, nova(s, over)))).toBe("42501");
      });
    });

    it("texto vazio, só espaços ou com controle é recusado pelo banco (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        for (const body of ["", "   \n\t", "a\u0007b"]) expect(await attempt(tx, (x) => create(x, nova(s, { body })))).toBe("23514");
        expect(await create(tx, nova(s, { body: "linha 1\nlinha 2\tcom tab" }))).toHaveLength(1);
      });
    });
  });

  describe("editar e finalizar", () => {
    it("o autor edita o texto do rascunho; `updated_at` é do banco", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional);
        expect(await update(tx, s.draftA, { body: "[teste] texto novo" })).toHaveLength(1);
        await asOwner();
        expect((await readNote(tx, s.draftA))?.body).toBe("[teste] texto novo");
        const [instant] = await tx.execute<{ same: boolean }>(sql`select updated_at = now() as same from public.clinical_notes where id = ${s.draftA}`);
        expect(instant?.same).toBe(true);
      });
    });

    it.each(["admin", "reception", "professional2", "stranger", "inactive", "deleted"] as const)(
      "usuário %s não altera o rascunho de A (nenhuma linha) e o texto fica intacto",
      async (who) => {
        await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
          await as(ids[who]);
          expect(await update(tx, s.draftA, { body: "[teste] invasão" })).toEqual([]);
          await asOwner();
          expect((await readNote(tx, s.draftA))?.body).toBe("[teste] rascunho de A");
        });
      },
    );

    it("o autor com aal1 (só senha) não altera o rascunho (nenhuma linha) e o texto fica intacto", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional, "aal1");
        expect(await update(tx, s.draftA, { body: "[teste] sem 2fa" })).toEqual([]);
        expect(await update(tx, s.draftA, { status: "finalized" })).toEqual([]);
        await asOwner();
        expect(await readNote(tx, s.draftA)).toMatchObject({ body: "[teste] rascunho de A", status: "draft" });
      });
    });

    it("finalizar: o banco carimba quando e quem; o texto não muda junto (42501)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => update(x, s.draftA, { status: "finalized", body: "[teste] outro texto" }))).toBe("42501");
        expect(await update(tx, s.draftA, { status: "finalized" })).toHaveLength(1);
        await asOwner();
        expect(await readNote(tx, s.draftA)).toMatchObject({ status: "finalized", finalizedBy: ids.professional });
        const [instant] = await tx.execute<{ same: boolean }>(sql`select finalized_at = now() as same from public.clinical_notes where id = ${s.draftA}`);
        expect(instant?.same).toBe(true);
      });
    });

    it("`finalized_at`, `finalized_by`, identidade e `created_at` não têm privilégio de coluna (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        const forbidden: Partial<NewNote>[] = [
          { finalizedAt: new Date() },
          { finalizedBy: ids.professional },
          { appointmentId: s.apAFree },
          { patientId: s.p1 },
          { professionalId: s.professionalB },
          { createdAt: new Date("2020-01-01T00:00:00Z") },
          { updatedAt: new Date("2020-01-01T00:00:00Z") },
        ];
        for (const set of forbidden) expect(await attempt(tx, (x) => update(x, s.draftA, set))).toBe("42501");
      });
    });

    it("a evolução FINALIZADA é trancada: nem o autor edita, reabre ou finaliza de novo (nenhuma linha)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional);
        expect(await update(tx, s.noteA, { body: "[teste] mudou" })).toEqual([]);
        expect(await update(tx, s.noteA, { status: "draft" })).toEqual([]);
        expect(await update(tx, s.noteA, { status: "finalized" })).toEqual([]);
        await asOwner();
        expect(await readNote(tx, s.noteA)).toMatchObject({ body: "[teste] evolução finalizada de A", status: "finalized" });
      });
    });
  });

  describe("adendo", () => {
    it("o autor adenda a própria evolução FINALIZADA; autor e data vêm do banco", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional);
        const [row] = await addAddendum(tx, s.noteA);
        await asOwner();
        const [saved] = await tx.select().from(clinicalNoteAddenda).where(eq(clinicalNoteAddenda.id, row!.id));
        expect(saved).toMatchObject({ createdBy: ids.professional, noteId: s.noteA });
        const [instant] = await tx.execute<{ same: boolean }>(sql`select created_at = now() as same from public.clinical_note_addenda where id = ${row!.id}`);
        expect(instant?.same).toBe(true);
      });
    });

    it("não adenda rascunho (23514), nem evolução de outro autor (42501), nem forja autor ou data (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => addAddendum(x, s.draftA))).toBe("23514");
        expect(await attempt(tx, (x) => addAddendum(x, s.noteB))).toBe("42501");
        expect(await attempt(tx, (x) => addAddendum(x, s.noteA, { createdBy: ids.professional2 }))).toBe("42501");
        expect(await attempt(tx, (x) => addAddendum(x, s.noteA, { createdAt: new Date("2020-01-01T00:00:00Z") }))).toBe("42501");
        expect(await attempt(tx, (x) => addAddendum(x, s.noteA, { body: "  " }))).toBe("23514");
      });
    });

    it.each(["admin", "reception", "professional2", "stranger", "inactive", "deleted"] as const)(
      "usuário %s não adenda a evolução de A (42501)",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(await attempt(tx, (x) => addAddendum(x, s.noteA))).toBe("42501");
        });
      },
    );

    it("o profissional A com aal1 não adenda (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional, "aal1");
        expect(await attempt(tx, (x) => addAddendum(x, s.noteA))).toBe("42501");
      });
    });

    it("o adendo nunca muda nem se apaga (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => x.update(clinicalNoteAddenda).set({ body: "x" }).where(eq(clinicalNoteAddenda.id, s.addendumA)))).toBe("42501");
        expect(await attempt(tx, (x) => x.delete(clinicalNoteAddenda).where(eq(clinicalNoteAddenda.id, s.addendumA)))).toBe("42501");
      });
    });
  });

  describe("log de acesso", () => {
    const entry = (s: ClinicalSeed, over: Partial<typeof clinicalAccessLog.$inferInsert> = {}) => ({
      action: "read_note" as const,
      patientId: s.pShared,
      noteId: s.noteA,
      ...over,
    });

    it.each([
      ["admin", "admin"],
      ["professional", "professional"],
    ] as const)("%s registra em nome próprio, com o papel e a hora do banco", async (who, role) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        await log(tx, entry(s));
        await asOwner();
        const rows = await tx.execute<{ user_id: string; role: string; same: boolean }>(
          sql`select user_id, role, at = now() as same from public.clinical_access_log where user_id = ${ids[who]} order by id desc limit 1`,
        );
        expect(rows[0]).toMatchObject({ user_id: ids[who], role, same: true });
      });
    });

    it.each(["reception", "stranger", "inactive", "deleted"] as const)("usuário %s não registra (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => log(x, entry(s)))).toBe("42501");
      });
    });

    it.each(["admin", "professional"] as const)("%s com aal1 não registra (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await attempt(tx, (x) => log(x, entry(s)))).toBe("42501");
      });
    });

    it("não forja usuário, papel ou hora (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => log(x, entry(s, { userId: ids.admin })))).toBe("42501");
        expect(await attempt(tx, (x) => log(x, entry(s, { role: "admin" })))).toBe("42501");
        expect(await attempt(tx, (x) => log(x, entry(s, { at: new Date("2020-01-01T00:00:00Z") })))).toBe("42501");
      });
    });

    it("o profissional só registra paciente e evolução que ele enxerga, e a evolução tem de ser do paciente informado (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => log(x, entry(s, { noteId: s.noteB })))).toBe("42501"); // evolução de B
        expect(await attempt(tx, (x) => log(x, entry(s, { patientId: s.p2, noteId: null })))).toBe("42501"); // paciente só de B
        expect(await attempt(tx, (x) => log(x, entry(s, { patientId: s.p1 })))).toBe("42501"); // evolução de outro paciente
        await log(tx, entry(s, { action: "read_history", noteId: null })); // histórico do paciente, sem evolução
      });
    });

    it("o autor continua registrando a leitura das próprias evoluções depois que o paciente foi desvinculado ou removido", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.execute(sql`delete from public.patient_professionals where patient_id = ${s.pShared} and professional_id = ${s.professionalA}`);
        await as(ids.professional);
        await log(tx, entry(s)); // read_note de uma evolução dele
        await log(tx, entry(s, { action: "read_history", noteId: null }));
      });
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.execute(sql`update public.patients set deleted_at = now() where id = ${s.pShared}`);
        await as(ids.professional);
        await log(tx, entry(s));
        // mas só registra paciente de que ele tem evolução ou que enxerga: o paciente só de B continua barrado
        expect(await attempt(tx, (x) => log(x, entry(s, { patientId: s.p2, noteId: null, action: "read_history" })))).toBe("42501");
      });
    });

    it("só `read_history` vale sem evolução (as outras ações exigem a evolução: 23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        for (const action of ["read_note", "create_note", "update_draft", "finalize", "add_addendum"] as const) {
          expect(await attempt(tx, (x) => log(x, entry(s, { action, noteId: null })))).toBe("23514");
        }
        await log(tx, entry(s, { action: "read_history", noteId: null }));
      });
    });

    it("o log nunca muda nem se apaga (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.update(clinicalAccessLog).set({ action: "finalize" }).where(eq(clinicalAccessLog.id, s.logA)))).toBe("42501");
        expect(await attempt(tx, (x) => x.delete(clinicalAccessLog).where(eq(clinicalAccessLog.id, s.logA)))).toBe("42501");
      });
    });
  });

  describe("sem DELETE na evolução", () => {
    it.each(["admin", "professional"] as const)("%s não apaga evolução (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.delete(clinicalNotes).where(eq(clinicalNotes.id, s.draftA)))).toBe("42501");
      });
    });
  });

  describe("os gatilhos sozinhos (numa CÓPIA temporária da tabela: sem GRANT por coluna e sem a RLS a barrar antes)", () => {
    /**
     * Cria, na sessão do teste, tabelas TEMPORÁRIAS com as mesmas colunas e linhas e liga a elas os
     * MESMOS gatilhos (as funções reais `app.clinical_*_guard_*`), sem RLS e com todos os privilégios:
     * assim só o gatilho decide. Uma tabela temporária não pede lock em tabela compartilhada
     * (`alter table ... disable row level security` na tabela real pede ACCESS EXCLUSIVE e travava as
     * outras suítes, que seguram transações abertas e gravam o log: SQLSTATE 55P03).
     */
    async function sandbox(asOwner: () => Promise<void>, tx: Tx) {
      await asOwner();
      await tx.execute(sql`create temp table zz_notes (like public.clinical_notes including defaults)`);
      await tx.execute(sql`insert into zz_notes select * from public.clinical_notes`);
      await tx.execute(sql`create temp table zz_addenda (like public.clinical_note_addenda including defaults)`);
      await tx.execute(sql`insert into zz_addenda select * from public.clinical_note_addenda`);
      await tx.execute(sql`grant select, insert, update on zz_notes, zz_addenda to authenticated`);
      await tx.execute(sql`create trigger zz_guard_insert before insert on zz_notes for each row execute function app.clinical_notes_guard_insert()`);
      await tx.execute(sql`create trigger zz_guard_update before update on zz_notes for each row execute function app.clinical_notes_guard_update()`);
      await tx.execute(sql`create trigger zz_guard_insert before insert on zz_addenda for each row execute function app.clinical_note_addenda_guard_insert()`);
    }
    const touch = (tx: Tx, id: string, assignments: ReturnType<typeof sql>) =>
      tx.execute(sql`update zz_notes set ${assignments} where id = ${id} returning id`);
    const insertNote = (tx: Tx, s: ClinicalSeed, appointmentId: string) =>
      tx.execute(
        sql`insert into zz_notes (appointment_id, patient_id, professional_id, body) values (${appointmentId}, ${s.pShared}, ${s.professionalA}, '[teste] evolução nova') returning id`,
      );
    const insertAddendum = (tx: Tx, noteId: string) =>
      tx.execute(sql`insert into zz_addenda (note_id, body) values (${noteId}, '[teste] adendo novo') returning id`);

    it.each([
      ["appointment_id", (s: ClinicalSeed) => sql`appointment_id = ${s.apAFree}`],
      ["patient_id", (s: ClinicalSeed) => sql`patient_id = ${s.p1}`],
      ["professional_id", (s: ClinicalSeed) => sql`professional_id = ${s.professionalB}`],
      ["created_at", () => sql`created_at = timestamptz '2020-01-01'`],
      ["finalized_at (num rascunho)", () => sql`finalized_at = now()`],
      ["finalized_by (num rascunho)", (s: ClinicalSeed) => sql`finalized_by = ${s.professionalA}`],
    ])("%s é imutável no rascunho (42501)", async (_column, change) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.professional);
        expect(await attempt(tx, (x) => touch(x, s.draftA, change(s)))).toBe("42501");
      });
    });

    it("a evolução finalizada não muda (42501)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.professional);
        expect(await attempt(tx, (x) => touch(x, s.noteA, sql`body = '[teste] mudou'`))).toBe("42501");
        expect(await attempt(tx, (x) => touch(x, s.noteA, sql`status = 'draft'`))).toBe("42501");
        expect(await attempt(tx, (x) => touch(x, s.noteA, sql`status = 'finalized'`))).toBe("42501");
      });
    });

    it.each(["admin", "reception", "professional2", "stranger", "inactive", "deleted"] as const)(
      "usuário %s não altera a evolução de A (42501)",
      async (who) => {
        await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
          await sandbox(asOwner, tx);
          await as(ids[who]);
          expect(await attempt(tx, (x) => touch(x, s.draftA, sql`body = '[teste] invasão'`))).toBe("42501");
        });
      },
    );

    it("ao finalizar, o banco SOBRESCREVE um `finalized_at` forjado", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.professional);
        expect(await touch(tx, s.draftA, sql`status = 'finalized', finalized_at = timestamptz '2020-01-01', finalized_by = ${ids.admin}`)).toHaveLength(1);
        await asOwner();
        const [row] = await tx.execute<{ same: boolean; by: string }>(sql`select finalized_at = now() as same, finalized_by as by from zz_notes where id = ${s.draftA}`);
        expect(row).toEqual({ same: true, by: ids.professional });
      });
    });

    it("o autor ainda edita e finaliza normalmente (o teste acima não é só uma parede)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.professional);
        expect(await touch(tx, s.draftA, sql`body = '[teste] ok'`)).toHaveLength(1);
        expect(await touch(tx, s.draftA, sql`status = 'finalized'`)).toHaveLength(1);
      });
    });

    it("o gatilho de INSERT sozinho: só o autor, só atendimento Realizado e dele", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.admin);
        expect(await attempt(tx, (x) => insertNote(x, s, s.apAFree))).toBe("42501");
        await as(ids.professional2);
        expect(await attempt(tx, (x) => insertNote(x, s, s.apAFree))).toBe("42501"); // atendimento de A
        await as(ids.professional);
        expect(await attempt(tx, (x) => insertNote(x, s, s.apAScheduled))).toBe("23514");
        expect(await insertNote(tx, s, s.apAFree)).toHaveLength(1);
      });
    });

    it("o gatilho de INSERT do adendo sozinho: só o autor, só evolução finalizada", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.admin);
        expect(await attempt(tx, (x) => insertAddendum(x, s.noteA))).toBe("42501");
        await as(ids.professional2);
        expect(await attempt(tx, (x) => insertAddendum(x, s.noteA))).toBe("42501");
        await as(ids.professional);
        expect(await attempt(tx, (x) => insertAddendum(x, s.draftA))).toBe("23514");
        expect(await insertAddendum(tx, s.noteA)).toHaveLength(1);
      });
    });
  });

  it("catálogo: os três gatilhos de proteção existem e estão habilitados", async () => {
    await shared.run(async ({ tx, asOwner }) => {
      await asOwner();
      const rows = await tx.execute<{ tgname: string; tgenabled: string }>(
        sql`select tgname, tgenabled from pg_trigger
            where tgrelid in ('public.clinical_notes'::regclass, 'public.clinical_note_addenda'::regclass) and not tgisinternal order by tgname`,
      );
      expect(rows.map((r) => [r.tgname, r.tgenabled])).toEqual([
        ["clinical_note_addenda_guard_insert", "O"],
        ["clinical_notes_guard_insert", "O"],
        ["clinical_notes_guard_update", "O"],
      ]);
    });
  });
});
