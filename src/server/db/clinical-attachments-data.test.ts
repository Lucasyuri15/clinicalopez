import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getPatientRecord } from "@/server/clinical/queries";
import { openAttachment, removeAttachment, uploadAttachment } from "@/server/clinical/attachments";
import { createMemoryStore } from "@/server/storage/memory-store";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Camada de dados dos anexos clínicos (Fase 4B-1) contra o Supabase DEV pelo caminho REAL do app
 * (`DATABASE_URL` → `app_backend` → `authenticated` sob RLS, via `withUser`), com o Storage FALSO em
 * memória (o Storage real é provado no e2e). Só dados FICTÍCIOS, commitados pelo dono e apagados no
 * fim. Prova: enviar, abrir e remover; só o autor lê; a recepção não toca o banco; uma linha de log por
 * ação, sem nome nem conteúdo; arquivo disfarçado, vazio ou grande demais nunca chega ao Storage; o
 * duplo clique não duplica; o envio que o banco recusa não deixa órfão. Atendimentos em 2026-03
 * (passado, Realizados) e um agendado em 2031-12: nenhum outro arquivo usa.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-anexos ${randomUUID().slice(0, 8)}]`;
const at = (day: string, time: string) => new Date(`${day}T${time}:00.000Z`);

/** Um PDF "de mentira" (só o cabeçalho conta) único por `seed`. */
const pdf = (seed: string) => new TextEncoder().encode(`%PDF-1.7\n% ${seed}\n${"x".repeat(64)}`);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe.skipIf(!hasDb)("anexos clínicos: camada de dados (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    profA: { userId: randomUUID() },
    profB: { userId: randomUUID() },
  };
  const ids = { pA: "", pB: "", svc: "", pOut: "", p1: "", a1: "", aB1: "", aSched: "", aNoShow: "" };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`anexos-${key}-${userId}@teste.invalid`})`;
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
      ids.a1 = await appointment(ids.pA, "2026-03-02", "10:00", "done");
      ids.aB1 = await appointment(ids.pB, "2026-03-02", "14:00", "done");
      ids.aNoShow = await appointment(ids.pA, "2026-03-02", "15:00", "no_show");
      ids.aSched = await appointment(ids.pA, "2031-12-01", "10:00", "scheduled");
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function wipeAttachments() {
    const patientIds = owner`select id from public.patients where full_name like ${`${TAG}%`}`;
    await owner`delete from public.clinical_access_log where patient_id in (${patientIds})`;
    await owner`delete from public.clinical_attachments where patient_id in (${patientIds})`;
  }

  async function cleanup() {
    const like = `${TAG}%`;
    await wipeAttachments();
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
    await wipeAttachments();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const rowsOf = async () => await owner`select * from public.clinical_attachments where patient_id = ${ids.p1} order by created_at`;
  const logOf = async () =>
    await owner`select action, role, user_id, note_id, attachment_id from public.clinical_access_log where patient_id = ${ids.p1} order by id`;
  const actions = async () => (await logOf()).map((row) => row.action as string);
  const idOf = (result: { ok: boolean }) => (result as { ok: true; attachmentId: string }).attachmentId;
  const send = (store: ReturnType<typeof createMemoryStore>, bytes = pdf("a"), over: { name?: string; appointmentId?: string | null; patientId?: string; user?: { userId: string } } = {}) =>
    uploadAttachment(
      over.user ?? users.profA,
      { patientId: over.patientId ?? ids.p1, appointmentId: over.appointmentId ?? null, name: over.name ?? "Ressonância joelho.pdf", bytes },
      store,
    );

  describe("enviar", () => {
    it("grava o arquivo no Storage e os metadados no banco (tipo pelos bytes, nome limpo, hash), com 1 linha de log", async () => {
      const store = createMemoryStore();
      const bytes = pdf("exame");
      const result = await send(store, bytes, { name: "../../etc/Ressonância joelho.exe", appointmentId: ids.a1 });
      expect(result.ok).toBe(true);
      const [row] = await rowsOf();
      expect(row).toMatchObject({
        id: idOf(result),
        professional_id: ids.pA,
        appointment_id: ids.a1,
        original_name: "Ressonância joelho.pdf",
        content_type: "application/pdf",
        size_bytes: bytes.length,
        sha256: sha(bytes),
        created_by: users.profA.userId,
        removed_at: null,
      });
      expect(row!.storage_path).toMatch(/^[0-9a-f-]{36}$/);
      expect(store.objects.get(row!.storage_path as string)).toMatchObject({ contentType: "application/pdf" });
      expect([...store.objects.get(row!.storage_path as string)!.bytes]).toEqual([...bytes]);

      const log = await logOf();
      expect(log).toMatchObject([{ action: "upload_attachment", role: "professional", user_id: users.profA.userId, note_id: null, attachment_id: idOf(result) }]);
    });

    it.each([
      ["vazio", new Uint8Array(), "empty"],
      ["grande demais", new Uint8Array(4 * 1024 * 1024 + 1), "too-large"],
      ["SVG disfarçado de PDF", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "bad-type"],
      ["executável", new Uint8Array([0x4d, 0x5a, 0x90, 0, 0, 0]), "bad-type"],
    ] as const)("%s: recusado, e nada chega ao Storage, ao banco nem ao log", async (_label, bytes, reason) => {
      const store = createMemoryStore();
      expect(await send(store, bytes, { name: "laudo.pdf" })).toEqual({ ok: false, reason });
      expect(store.objects.size).toBe(0);
      expect(await rowsOf()).toEqual([]);
      expect(await logOf()).toEqual([]);
    });

    it("só atendimento REALIZADO, dele e do paciente; e só paciente que ele enxerga", async () => {
      const store = createMemoryStore();
      expect(await send(store, pdf("1"), { appointmentId: ids.aSched })).toEqual({ ok: false, reason: "not-realized" });
      expect(await send(store, pdf("2"), { appointmentId: ids.aNoShow })).toEqual({ ok: false, reason: "not-realized" });
      expect(await send(store, pdf("3"), { appointmentId: ids.aB1 })).toEqual({ ok: false, reason: "not-found" }); // é de B
      expect(await send(store, pdf("4"), { appointmentId: randomUUID() })).toEqual({ ok: false, reason: "not-found" });
      expect(await send(store, pdf("5"), { patientId: ids.pOut })).toEqual({ ok: false, reason: "not-found" }); // sem vínculo
      expect(store.objects.size).toBe(0);
      expect(await rowsOf()).toEqual([]);
      expect(await logOf()).toEqual([]);
    });

    it("admin, recepção e quem não é profissional não enviam (denied), sem tocar o Storage", async () => {
      const store = createMemoryStore();
      for (const user of [users.admin, users.reception, { userId: randomUUID() }]) {
        expect(await send(store, pdf("x"), { user })).toEqual({ ok: false, reason: "denied" });
      }
      expect(store.objects.size).toBe(0);
      expect(await logOf()).toEqual([]);
    });

    it("o mesmo arquivo duas vezes: a segunda é `duplicate` e NÃO deixa órfão no Storage", async () => {
      const store = createMemoryStore();
      expect((await send(store, pdf("igual"))).ok).toBe(true);
      expect(await send(store, pdf("igual"), { name: "outro nome.pdf" })).toEqual({ ok: false, reason: "duplicate" });
      expect(store.objects.size).toBe(1);
      expect(await rowsOf()).toHaveLength(1);
      expect(await actions()).toEqual(["upload_attachment"]);
    });

    it("duplo clique (dois envios iguais ao mesmo tempo): um só vale, sem erro cru e sem órfão", async () => {
      const store = createMemoryStore();
      const results = await Promise.all([send(store, pdf("clique")), send(store, pdf("clique"))]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "duplicate" }]);
      expect(store.objects.size).toBe(1);
      expect(await rowsOf()).toHaveLength(1);
    });

    it("se desfazer o envio órfão FALHAR, avisa no log do servidor só com o caminho (UUID), sem nome nem conteúdo, e devolve o motivo certo", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const store = createMemoryStore();
      expect((await send(store, pdf("igual"))).ok).toBe(true);
      store.failNext("remove", "unavailable");
      expect(await send(store, pdf("igual"), { name: "Nome sensível do exame.pdf" })).toEqual({ ok: false, reason: "duplicate" });
      expect(store.objects.size).toBe(2); // o órfão ficou
      const registered = (await rowsOf())[0]!.storage_path as string;
      const orphan = [...store.objects.keys()].find((path) => path !== registered);
      expect(spy).toHaveBeenCalledTimes(1);
      const message = spy.mock.calls.map((call) => call.map(String).join(" ")).join(" ");
      expect(message).toContain(orphan!);
      expect(message).not.toContain("sensível");
      expect(message).not.toContain("%PDF");
    });

    it("depois de remover, o mesmo arquivo pode ser enviado de novo", async () => {
      const store = createMemoryStore();
      const first = await send(store, pdf("volta"));
      await removeAttachment(users.profA, { attachmentId: idOf(first) });
      expect((await send(store, pdf("volta"))).ok).toBe(true);
    });

    it("o Storage fora do ar: `unavailable`, sem linha e sem log", async () => {
      const store = createMemoryStore();
      store.failNext("put", "unavailable");
      expect(await send(store, pdf("fora"))).toEqual({ ok: false, reason: "unavailable" });
      expect(await rowsOf()).toEqual([]);
      expect(await logOf()).toEqual([]);
    });
  });

  describe("abrir", () => {
    const sent = async (store: ReturnType<typeof createMemoryStore>, seed = "abrir") => idOf(await send(store, pdf(seed), { name: "Exame A.pdf" }));

    it("o autor abre: recebe os bytes, o tipo e o nome, e cada abertura vira 1 linha de log", async () => {
      const store = createMemoryStore();
      const id = await sent(store);
      for (let i = 0; i < 2; i++) {
        const opened = await openAttachment({ ...users.profA, role: "professional" }, { patientId: ids.p1, attachmentId: id }, store);
        // (compara como lista: o jsdom e o node têm `Uint8Array` diferentes e o toEqual estranha)
        expect(opened.ok).toBe(true);
        const file = (opened as Extract<typeof opened, { ok: true }>).file;
        expect([...file.bytes]).toEqual([...pdf("abrir")]);
        expect({ contentType: file.contentType, name: file.name }).toEqual({ contentType: "application/pdf", name: "Exame A.pdf" });
      }
      expect(await actions()).toEqual(["upload_attachment", "read_attachment", "read_attachment"]);
      // o log nunca guarda nome nem conteúdo: só as colunas de quem, quando, ação, paciente, evolução e anexo
      const columns = await owner`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'clinical_access_log' order by column_name`;
      expect(columns.map((c) => c.column_name)).toEqual(["action", "at", "attachment_id", "id", "note_id", "patient_id", "role", "user_id"]);
    });

    it("o profissional B (mesmo paciente) NÃO abre o anexo de A: not-found, sem log e sem tocar o Storage", async () => {
      const store = createMemoryStore();
      const id = await sent(store);
      const before = (await logOf()).length;
      expect(await openAttachment({ ...users.profB, role: "professional" }, { patientId: ids.p1, attachmentId: id }, store)).toEqual({ ok: false, reason: "not-found" });
      expect((await logOf()).length).toBe(before);
    });

    it("a recepção não abre (not-found) e não toca o banco: zero linhas de log novas", async () => {
      const store = createMemoryStore();
      const id = await sent(store);
      const before = (await logOf()).length;
      expect(await openAttachment({ ...users.reception, role: "reception" }, { patientId: ids.p1, attachmentId: id }, store)).toEqual({ ok: false, reason: "not-found" });
      expect((await logOf()).length).toBe(before);
    });

    it("o admin abre qualquer anexo, com o papel dele no log; id inexistente é not-found", async () => {
      const store = createMemoryStore();
      const id = await sent(store);
      expect((await openAttachment({ ...users.admin, role: "admin" }, { patientId: ids.p1, attachmentId: id }, store)).ok).toBe(true);
      expect((await logOf()).at(-1)).toMatchObject({ action: "read_attachment", role: "admin", user_id: users.admin.userId, attachment_id: id });
      expect(await openAttachment({ ...users.admin, role: "admin" }, { patientId: ids.p1, attachmentId: randomUUID() }, store)).toEqual({ ok: false, reason: "not-found" });
    });

    it("anexo removido: o autor não abre mais; o admin ainda abre", async () => {
      const store = createMemoryStore();
      const id = await sent(store);
      expect(await removeAttachment(users.profA, { attachmentId: id })).toEqual({ ok: true, attachmentId: id });
      expect(await openAttachment({ ...users.profA, role: "professional" }, { patientId: ids.p1, attachmentId: id }, store)).toEqual({ ok: false, reason: "not-found" });
      expect((await openAttachment({ ...users.admin, role: "admin" }, { patientId: ids.p1, attachmentId: id }, store)).ok).toBe(true);
    });

    it("o anexo só abre pelo paciente a que pertence: outro paciente na URL é not-found e não registra nada", async () => {
      const store = createMemoryStore();
      const id = await sent(store);
      const before = (await logOf()).length;
      expect(await openAttachment({ ...users.admin, role: "admin" }, { patientId: ids.pOut, attachmentId: id }, store)).toEqual({ ok: false, reason: "not-found" });
      expect((await logOf()).length).toBe(before);
    });

    it("o arquivo no Storage não bate com o que foi registrado (tamanho ou hash): `unavailable`, nada é devolvido", async () => {
      const store = createMemoryStore();
      const id = await sent(store);
      const [row] = await rowsOf();
      const stored = store.objects.get(row!.storage_path as string)!;
      const original = new Uint8Array(stored.bytes);
      stored.bytes = new Uint8Array([...original].map((byte, index) => (index === 10 ? byte ^ 0xff : byte))); // mesmo tamanho, outro conteúdo
      expect(await openAttachment({ ...users.profA, role: "professional" }, { patientId: ids.p1, attachmentId: id }, store)).toEqual({ ok: false, reason: "unavailable" });
      stored.bytes = original.slice(0, original.length - 1); // tamanho diferente
      expect(await openAttachment({ ...users.profA, role: "professional" }, { patientId: ids.p1, attachmentId: id }, store)).toEqual({ ok: false, reason: "unavailable" });
      stored.bytes = original; // íntegro volta a abrir
      expect((await openAttachment({ ...users.profA, role: "professional" }, { patientId: ids.p1, attachmentId: id }, store)).ok).toBe(true);
    });

    it("o Storage falha na leitura: `unavailable` (o acesso já ficou registrado, nada é devolvido)", async () => {
      const store = createMemoryStore();
      const id = await sent(store);
      store.failNext("get", "unavailable");
      expect(await openAttachment({ ...users.profA, role: "professional" }, { patientId: ids.p1, attachmentId: id }, store)).toEqual({ ok: false, reason: "unavailable" });
      expect((await actions()).filter((a) => a === "read_attachment")).toHaveLength(1);
    });
  });

  describe("remover", () => {
    it("o autor remove (lógico): a linha e o arquivo continuam, e há 1 linha de log", async () => {
      const store = createMemoryStore();
      const id = idOf(await send(store, pdf("rm")));
      expect(await removeAttachment(users.profA, { attachmentId: id })).toEqual({ ok: true, attachmentId: id });
      const [row] = await rowsOf();
      expect(row).toMatchObject({ id, removed_by: users.profA.userId });
      expect(row!.removed_at).toBeInstanceOf(Date);
      expect(store.objects.size).toBe(1);
      expect(await actions()).toEqual(["upload_attachment", "remove_attachment"]);
    });

    it("remover duas vezes: a segunda é not-found e não registra nada", async () => {
      const store = createMemoryStore();
      const id = idOf(await send(store, pdf("rm2")));
      await removeAttachment(users.profA, { attachmentId: id });
      expect(await removeAttachment(users.profA, { attachmentId: id })).toEqual({ ok: false, reason: "not-found" });
      expect(await actions()).toEqual(["upload_attachment", "remove_attachment"]);
    });

    it("o colega, o admin e a recepção não removem o anexo de A", async () => {
      const store = createMemoryStore();
      const id = idOf(await send(store, pdf("rm3")));
      expect(await removeAttachment(users.profB, { attachmentId: id })).toEqual({ ok: false, reason: "not-found" });
      expect(await removeAttachment(users.admin, { attachmentId: id })).toEqual({ ok: false, reason: "denied" });
      expect(await removeAttachment(users.reception, { attachmentId: id })).toEqual({ ok: false, reason: "denied" });
      expect((await rowsOf())[0]!.removed_at).toBeNull();
    });
  });

  describe("histórico do paciente", () => {
    it("o autor vê só os anexos dele (sem removidos) e os atendimentos Realizados dele; o colega não vê nada do outro", async () => {
      const store = createMemoryStore();
      const keep = idOf(await send(store, pdf("h1"), { name: "um.pdf", appointmentId: ids.a1 }));
      const gone = idOf(await send(store, pdf("h2"), { name: "dois.pdf" }));
      await removeAttachment(users.profA, { attachmentId: gone });

      const recordA = await getPatientRecord({ ...users.profA, role: "professional" }, ids.p1);
      expect(recordA!.attachments.map((a) => a.id)).toEqual([keep]);
      expect(recordA!.attachments[0]).toMatchObject({ originalName: "um.pdf", contentType: "application/pdf", removedAt: null });
      expect(recordA!.doneAppointments.map((a) => a.appointmentId)).toEqual([ids.a1]);

      const recordB = await getPatientRecord({ ...users.profB, role: "professional" }, ids.p1);
      expect(recordB!.attachments).toEqual([]);
      expect(recordB!.doneAppointments.map((a) => a.appointmentId)).toEqual([ids.aB1]);
    });

    it("o admin vê todos, inclusive os removidos (marcados) e com o nome do autor; não tem atendimentos para anexar", async () => {
      const store = createMemoryStore();
      const keep = idOf(await send(store, pdf("h3"), { name: "tres.pdf" }));
      const gone = idOf(await send(store, pdf("h4"), { name: "quatro.pdf" }));
      await removeAttachment(users.profA, { attachmentId: gone });
      const record = await getPatientRecord({ ...users.admin, role: "admin" }, ids.p1);
      expect(record!.attachments.map((a) => a.id).sort()).toEqual([keep, gone].sort());
      expect(record!.attachments.find((a) => a.id === gone)?.removedAt).toBeInstanceOf(Date);
      expect(record!.attachments.every((a) => a.professionalName === `${TAG} Ana`)).toBe(true);
      expect(record!.doneAppointments).toEqual([]);
    });

    it("listar não grava 1 linha de log por anexo: só o `read_history` de sempre", async () => {
      const store = createMemoryStore();
      await send(store, pdf("h5"));
      await send(store, pdf("h6"));
      await getPatientRecord({ ...users.profA, role: "professional" }, ids.p1);
      expect((await actions()).filter((a) => a === "read_history")).toHaveLength(1);
      expect((await actions()).filter((a) => a === "read_attachment")).toHaveLength(0);
    });
  });
});
