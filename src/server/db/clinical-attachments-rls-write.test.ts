import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type AttachmentSeed, seedClinicalAttachments } from "./clinical-attachments-rls-fixture";
import type { Tx } from "./client";
import { attempt, createRlsHarness, hasDb, pgCode } from "./rls-harness";
import { clinicalAccessLog, clinicalAttachments } from "./schema";

/**
 * RLS dos anexos clínicos (Fase 4B-1), parte 2: ESCRITA, CHECKs e gatilhos contra o Supabase DEV, só
 * dados FICTÍCIOS, transações sempre revertidas. Regras:
 *  - só o profissional AUTOR anexa, em paciente que ele enxerga e, se informar atendimento, num
 *    atendimento REALIZADO e dele; `created_by` e `created_at` vêm do banco; nasce sem `removed_*`;
 *  - remover é LÓGICO: só o autor, uma vez, só `removed_at`/`removed_by` (carimbados pelo banco); a
 *    identidade e o conteúdo (caminho, nome, tipo, tamanho, hash) nunca mudam; sem DELETE;
 *  - o log aceita as ações de anexo só com o anexo certo, de um anexo que a pessoa enxerga e do MESMO
 *    paciente; quem não pode escrever falha com 42501 ANTES de qualquer constraint.
 */
describe.skipIf(!hasDb)("RLS dos anexos clínicos: escrita, constraints e gatilhos (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared((tx, ids) => seedClinicalAttachments(tx, ids, "Attachments Write"));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  type NewAttachment = typeof clinicalAttachments.$inferInsert;
  /** Um anexo novo de A, sem atendimento, no paciente compartilhado. */
  const nova = (s: AttachmentSeed, over: Partial<NewAttachment> = {}): NewAttachment => ({
    patientId: s.pShared,
    professionalId: s.professionalA,
    storagePath: crypto.randomUUID(),
    originalName: "[teste] exame novo.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
    sha256: "b".repeat(64),
    ...over,
  });
  const create = (tx: Tx, values: NewAttachment) =>
    tx.insert(clinicalAttachments).values(values).returning({ id: clinicalAttachments.id });
  const read = async (tx: Tx, id: string) =>
    (await tx.select().from(clinicalAttachments).where(eq(clinicalAttachments.id, id)))[0];
  const update = (tx: Tx, id: string, set: Partial<NewAttachment>) =>
    tx.update(clinicalAttachments).set(set).where(eq(clinicalAttachments.id, id)).returning({ id: clinicalAttachments.id });
  /** Quantas linhas o UPDATE alcançou, ou o SQLSTATE se o banco recusou. */
  const rowsOrCode = async (tx: Tx, id: string, set: Partial<NewAttachment>) => {
    try {
      return await tx.transaction(async (sp) => {
        const rows = await update(sp as unknown as Tx, id, set);
        // desfaz o efeito para o próximo passo do teste
        throw Object.assign(new Error("rollback"), { rows: rows.length });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "rollback") return (error as Error & { rows: number }).rows;
      return pgCode(error) ?? "sem-código";
    }
  };
  const log = (tx: Tx, values: typeof clinicalAccessLog.$inferInsert) => tx.insert(clinicalAccessLog).values(values);

  describe("anexar", () => {
    it("o profissional autor anexa ao paciente (sem atendimento), com autor e data do banco", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional);
        const [row] = await create(tx, nova(s));
        expect(row?.id).toBeTruthy();
        await asOwner();
        expect(await read(tx, row!.id)).toMatchObject({
          professionalId: s.professionalA,
          appointmentId: null,
          createdBy: ids.professional,
          removedAt: null,
          removedBy: null,
        });
        const [instant] = await tx.execute<{ same: boolean }>(
          sql`select created_at = now() as same from public.clinical_attachments where id = ${row!.id}`,
        );
        expect(instant?.same).toBe(true);
      });
    });

    it("pode ligar a um atendimento REALIZADO dele", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await create(tx, nova(s, { appointmentId: s.apAFree }))).toHaveLength(1);
      });
    });

    it.each(["admin", "reception", "professional2", "stranger", "inactive", "deleted"] as const)(
      "usuário %s não anexa em nome do profissional A (42501, antes de qualquer constraint)",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(await attempt(tx, (x) => create(x, nova(s)))).toBe("42501");
        });
      },
    );

    it("o profissional A com aal1 (só senha) não anexa (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional, "aal1");
        expect(await attempt(tx, (x) => create(x, nova(s)))).toBe("42501");
      });
    });

    it("o profissional A não anexa em nome de B, nem no atendimento de B (42501: não revela o que não vê)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, { professionalId: s.professionalB })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { appointmentId: s.apBFree })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { appointmentId: s.apBFree, professionalId: s.professionalB })))).toBe("42501");
      });
    });

    it("o profissional A não anexa em paciente que não enxerga (vinculado só a B): 42501", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, { patientId: s.p2 })))).toBe("42501");
      });
    });

    it("atendimento de outro paciente: a FK composta recusa (23503)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, { patientId: s.p1, appointmentId: s.apAFree })))).toBe("23503");
      });
    });

    it.each([
      ["agendado", (s: AttachmentSeed) => s.apAScheduled],
      ["falta", (s: AttachmentSeed) => s.apANoShow],
      ["cancelado", (s: AttachmentSeed) => s.apACancelled],
    ])("o atendimento informado precisa estar REALIZADO: %s é recusado (23514)", async (_label, pick) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, { appointmentId: pick(s) })))).toBe("23514");
      });
    });

    it("não forja autor, data nem remoção (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, { createdBy: ids.admin })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { createdAt: new Date("2020-01-01T00:00:00Z") })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { removedAt: new Date(), removedBy: ids.professional })))).toBe("42501");
      });
    });

    it.each([
      ["tipo não permitido (svg)", { contentType: "image/svg+xml" }],
      ["tipo não permitido (html)", { contentType: "text/html" }],
      ["tamanho zero", { sizeBytes: 0 }],
      ["4 MiB + 1 byte", { sizeBytes: 4 * 1024 * 1024 + 1 }],
      ["hash inválido", { sha256: "xyz" }],
      ["hash em maiúsculas", { sha256: "A".repeat(64) }],
      ["nome vazio", { originalName: "" }],
      ["nome só de espaços", { originalName: "   " }],
      ["nome com 121 caracteres", { originalName: "a".repeat(121) }],
      ["nome com caractere de controle", { originalName: "exame\u0007.pdf" }],
      ["caminho que não é UUID", { storagePath: "../../etc/passwd" }],
    ] as [string, Partial<NewAttachment>][])("CHECK: %s é recusado (23514)", async (_label, over) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, over)))).toBe("23514");
      });
    });

    it("exatamente 4 MiB e 120 caracteres passam", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await create(tx, nova(s, { sizeBytes: 4 * 1024 * 1024, originalName: "a".repeat(120) }))).toHaveLength(1);
      });
    });

    it("o mesmo arquivo (mesmo hash) não é anexado duas vezes ao mesmo paciente pelo mesmo autor (23505), mas pode de novo depois de removido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        const same = nova(s, { sha256: "e".repeat(64) });
        const [first] = await create(tx, same);
        expect(await attempt(tx, (x) => create(x, nova(s, { sha256: "e".repeat(64) })))).toBe("23505");
        await update(tx, first!.id, { removedAt: new Date() });
        expect(await create(tx, nova(s, { sha256: "e".repeat(64) }))).toHaveLength(1);
      });
    });

    it("o dedupe é só do mesmo autor: o colega pode anexar o mesmo arquivo", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        await create(tx, nova(s, { sha256: "f".repeat(64) }));
        await as(ids.professional2);
        expect(await create(tx, nova(s, { professionalId: s.professionalB, sha256: "f".repeat(64) }))).toHaveLength(1);
      });
    });

    it("o caminho do Storage é único (23505)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        const [existing] = await tx.select({ path: clinicalAttachments.storagePath }).from(clinicalAttachments).where(eq(clinicalAttachments.id, s.attA));
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, nova(s, { storagePath: existing!.path })))).toBe("23505");
      });
    });
  });

  describe("remover (lógico)", () => {
    it("o autor remove o próprio anexo: o banco carimba data e autor, e a linha continua lá", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional);
        expect(await update(tx, s.attA, { removedAt: new Date("2020-01-01T00:00:00Z"), removedBy: ids.admin })).toHaveLength(1);
        await asOwner();
        const [row] = await tx.execute<{ same: boolean; by: string }>(
          sql`select removed_at = now() as same, removed_by as by from public.clinical_attachments where id = ${s.attA}`,
        );
        expect(row).toEqual({ same: true, by: ids.professional });
      });
    });

    it("remover de novo não alcança nada (já removido) e não dá para desfazer a remoção", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await rowsOrCode(tx, s.attARemoved, { removedAt: new Date(), removedBy: ids.professional })).toBe(0);
        expect(await rowsOrCode(tx, s.attARemoved, { removedAt: null, removedBy: null })).toBe(0);
      });
    });

    it.each(["admin", "reception", "professional2", "stranger", "inactive", "deleted"] as const)(
      "usuário %s não remove o anexo de A (nenhuma linha alcançada)",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(await rowsOrCode(tx, s.attA, { removedAt: new Date(), removedBy: ids[who] })).toBe(0);
        });
      },
    );

    it("o profissional A com aal1 não remove", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional, "aal1");
        expect(await rowsOrCode(tx, s.attA, { removedAt: new Date(), removedBy: ids.professional })).toBe(0);
      });
    });

    it("o conteúdo e a identidade não mudam por UPDATE (sem privilégio de coluna: 42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        for (const change of [
          { originalName: "[teste] outro nome.pdf" },
          { contentType: "image/png" },
          { sizeBytes: 1 },
          { sha256: "c".repeat(64) },
          { storagePath: crypto.randomUUID() },
          { patientId: s.p1 },
          { professionalId: s.professionalB },
          { appointmentId: s.apAFree },
        ] as Partial<NewAttachment>[]) {
          expect(await attempt(tx, (x) => update(x, s.attA, change))).toBe("42501");
        }
      });
    });
  });

  describe("sem DELETE", () => {
    it.each(["admin", "professional"] as const)("%s não apaga anexo (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.delete(clinicalAttachments).where(eq(clinicalAttachments.id, s.attA)))).toBe("42501");
      });
    });
  });

  describe("log de acesso dos anexos", () => {
    const entry = (s: AttachmentSeed, over: Partial<typeof clinicalAccessLog.$inferInsert> = {}) => ({
      action: "read_attachment" as const,
      patientId: s.pShared,
      attachmentId: s.attA,
      ...over,
    });

    it.each([
      ["admin", "admin"],
      ["professional", "professional"],
    ] as const)("%s registra a leitura do anexo em nome próprio, com o papel do banco", async (who, role) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        await log(tx, entry(s));
        await asOwner();
        const rows = await tx.execute<{ user_id: string; role: string; action: string }>(
          sql`select user_id, role, action from public.clinical_access_log where user_id = ${ids[who]} and attachment_id = ${s.attA} order by id desc limit 1`,
        );
        expect(rows[0]).toMatchObject({ user_id: ids[who], role, action: "read_attachment" });
      });
    });

    it("o autor registra enviar (de um anexo que ele enviou) e remover (de um que ele removeu); o admin lê o removido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        await log(tx, entry(s, { action: "upload_attachment" }));
        await log(tx, entry(s, { action: "remove_attachment", attachmentId: s.attARemoved }));
        await as(ids.admin);
        await log(tx, entry(s, { attachmentId: s.attARemoved }));
      });
    });

    it("o log não aceita ação que a pessoa não fez: remover um anexo NÃO removido, e o admin enviar ou remover (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => log(x, entry(s, { action: "remove_attachment" })))).toBe("42501"); // attA não foi removido
        await as(ids.admin);
        expect(await attempt(tx, (x) => log(x, entry(s, { action: "upload_attachment" })))).toBe("42501");
        expect(await attempt(tx, (x) => log(x, entry(s, { action: "remove_attachment", attachmentId: s.attARemoved })))).toBe("42501");
      });
    });

    it("o autor não registra ter enviado ou removido o anexo de OUTRO autor, mesmo vendo-o (42501)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        // B ganha a leitura do anexo de A só neste cenário (dono altera `created_by`): ainda assim não pode afirmar que o enviou.
        await asOwner();
        await tx.execute(sql`update public.clinical_attachments set created_by = ${ids.professional} where id = ${s.attB}`);
        await as(ids.professional2);
        expect(await attempt(tx, (x) => log(x, entry(s, { action: "upload_attachment", attachmentId: s.attB })))).toBe("42501");
      });
    });

    it("o profissional B não registra acesso ao anexo de A (42501: ele não o enxerga)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional2);
        expect(await attempt(tx, (x) => log(x, entry(s)))).toBe("42501");
      });
    });

    it.each(["reception", "stranger", "inactive", "deleted"] as const)("usuário %s não registra (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => log(x, entry(s)))).toBe("42501");
      });
    });

    it("o anexo precisa ser do MESMO paciente do registro (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => log(x, entry(s, { patientId: s.p1 })))).toBe("42501");
      });
    });

    it("a ação aponta para o alvo certo: anexo só nas ações de anexo; evolução só nas de evolução (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => log(x, entry(s, { attachmentId: null })))).toBe("23514");
        // a política barra ação de evolução ou de histórico apontando para um anexo (42501, antes do CHECK)
        expect(await attempt(tx, (x) => log(x, entry(s, { action: "read_note", noteId: s.noteA })))).toBe("42501");
        expect(await attempt(tx, (x) => log(x, entry(s, { action: "read_history" })))).toBe("42501");
        // e o CHECK barra anexo E evolução juntos numa ação de anexo
        expect(await attempt(tx, (x) => log(x, entry(s, { noteId: s.noteA })))).toBe("23514");
        // e o que já valia na 4A continua valendo
        await log(tx, { action: "read_note", patientId: s.pShared, noteId: s.noteA });
        await log(tx, { action: "read_history", patientId: s.pShared });
      });
    });

    it("o autor registra o acesso ao próprio anexo mesmo depois de desvinculado do paciente (acesso é pelo autor)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.execute(sql`delete from public.patient_professionals where patient_id = ${s.pShared} and professional_id = ${s.professionalA}`);
        await as(ids.professional);
        await log(tx, entry(s));
      });
    });
  });

  describe("os gatilhos sozinhos (numa CÓPIA temporária da tabela: sem GRANT por coluna e sem a RLS a barrar antes)", () => {
    /**
     * Cria, na sessão do teste, uma tabela TEMPORÁRIA com as mesmas colunas e linhas e liga a ela os
     * MESMOS gatilhos (as funções reais `app.clinical_attachments_guard_*`), sem RLS e com todos os
     * privilégios: assim só o gatilho decide. Uma tabela temporária não pede lock em tabela
     * compartilhada (`alter table`/`create policy` na tabela real pedem ACCESS EXCLUSIVE e travariam as
     * outras suítes, que seguram transações abertas: SQLSTATE 55P03).
     */
    async function sandbox(asOwner: () => Promise<void>, tx: Tx) {
      await asOwner();
      await tx.execute(sql`create temp table zz_att (like public.clinical_attachments including defaults)`);
      await tx.execute(sql`insert into zz_att select * from public.clinical_attachments`);
      await tx.execute(sql`grant select, insert, update on zz_att to authenticated`);
      await tx.execute(sql`create trigger zz_guard_insert before insert on zz_att for each row execute function app.clinical_attachments_guard_insert()`);
      await tx.execute(sql`create trigger zz_guard_update before update on zz_att for each row execute function app.clinical_attachments_guard_update()`);
    }
    const touch = (tx: Tx, id: string, assignments: ReturnType<typeof sql>) =>
      tx.execute(sql`update zz_att set ${assignments} where id = ${id} returning id`);
    const insertRow = (tx: Tx, s: AttachmentSeed, over: { patientId?: string; professionalId?: string; appointmentId?: string | null } = {}) =>
      tx.execute(
        sql`insert into zz_att (patient_id, professional_id, appointment_id, storage_path, original_name, content_type, size_bytes, sha256, created_by)
            values (${over.patientId ?? s.pShared}, ${over.professionalId ?? s.professionalA}, ${over.appointmentId ?? null}, ${crypto.randomUUID()}, '[teste] x.pdf', 'application/pdf', 10, ${"d".repeat(64)}, ${s.pShared}) returning id`,
      );

    it.each([
      ["patient_id", (s: AttachmentSeed) => sql`patient_id = ${s.p1}`],
      ["professional_id", (s: AttachmentSeed) => sql`professional_id = ${s.professionalB}`],
      ["appointment_id", (s: AttachmentSeed) => sql`appointment_id = ${s.apAFree}`],
      ["storage_path", () => sql`storage_path = ${crypto.randomUUID()}`],
      ["original_name", () => sql`original_name = '[teste] outro.pdf'`],
      ["content_type", () => sql`content_type = 'image/png'`],
      ["size_bytes", () => sql`size_bytes = 1`],
      ["sha256", () => sql`sha256 = ${"d".repeat(64)}`],
      ["created_by", (s: AttachmentSeed) => sql`created_by = ${s.professionalA}`],
      ["created_at", () => sql`created_at = timestamptz '2020-01-01'`],
    ])("%s é imutável (42501)", async (_column, change) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.professional);
        expect(await attempt(tx, (x) => touch(x, s.attA, change(s)))).toBe("42501");
      });
    });

    it.each(["admin", "reception", "professional2", "stranger", "inactive", "deleted"] as const)(
      "usuário %s não altera nem remove o anexo de A (42501)",
      async (who) => {
        await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
          await sandbox(asOwner, tx);
          await as(ids[who]);
          expect(await attempt(tx, (x) => touch(x, s.attA, sql`removed_at = now(), removed_by = ${ids[who]}`))).toBe("42501");
        });
      },
    );

    it("o anexo já removido não muda de novo nem volta (42501)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.professional);
        expect(await attempt(tx, (x) => touch(x, s.attARemoved, sql`removed_at = now(), removed_by = ${ids.professional}`))).toBe("42501");
        expect(await attempt(tx, (x) => touch(x, s.attARemoved, sql`removed_at = null, removed_by = null`))).toBe("42501");
      });
    });

    it("um UPDATE que não remove nada é recusado (42501)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.professional);
        expect(await attempt(tx, (x) => touch(x, s.attA, sql`removed_at = null, removed_by = null`))).toBe("42501");
      });
    });

    it("ao remover, o banco SOBRESCREVE data e autor forjados", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.professional);
        expect(await touch(tx, s.attA, sql`removed_at = timestamptz '2020-01-01', removed_by = ${ids.admin}`)).toHaveLength(1);
        await asOwner();
        const [row] = await tx.execute<{ same: boolean; by: string }>(sql`select removed_at = now() as same, removed_by as by from zz_att where id = ${s.attA}`);
        expect(row).toEqual({ same: true, by: ids.professional });
      });
    });

    it("o autor remove normalmente (o teste acima não é só uma parede)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        await as(ids.professional);
        expect(await touch(tx, s.attA, sql`removed_at = now()`)).toHaveLength(1);
      });
    });

    it("o gatilho de INSERT sozinho: só o profissional autor, em paciente e atendimento que enxerga, Realizado", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await sandbox(asOwner, tx);
        for (const who of ["admin", "reception", "professional2", "stranger", "inactive", "deleted"] as const) {
          await as(ids[who]);
          expect(await attempt(tx, (x) => insertRow(x, s))).toBe("42501");
        }
        await as(ids.professional);
        expect(await attempt(tx, (x) => insertRow(x, s, { professionalId: s.professionalB }))).toBe("42501");
        expect(await attempt(tx, (x) => insertRow(x, s, { patientId: s.p2 }))).toBe("42501");
        expect(await attempt(tx, (x) => insertRow(x, s, { appointmentId: s.apBFree }))).toBe("42501");
        expect(await attempt(tx, (x) => insertRow(x, s, { appointmentId: s.apAScheduled }))).toBe("23514");
        expect(await insertRow(tx, s, { appointmentId: s.apAFree })).toHaveLength(1);
      });
    });
  });
});
