import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Tx } from "./client";
import { attempt, createRlsHarness, hasDb } from "./rls-harness";
import { appointments, professionals, waitlistEntries } from "./schema";
import { seedWaitlist, type WaitlistSeed } from "./waitlist-rls-fixture";

/**
 * RLS da lista de espera (Fase 3B), parte 2: ESCRITA, CHECKs, FKs compostas, índice único e gatilho
 * contra o Supabase DEV, só dados FICTÍCIOS, transações sempre revertidas. Regras:
 *  - pôr na espera: só admin e recepção, em nome próprio, sempre "waiting", com `created_at` do banco
 *    e sem encerramento; paciente e serviço ativos, profissional (se houver) ativo; o banco garante a
 *    mesma especialidade (23503), a forma da preferência (23514) e uma espera ABERTA por
 *    paciente + serviço + profissional (23505);
 *  - editar só a preferência; atender (`fulfilled`) só com um atendimento do mesmo paciente, serviço e
 *    profissional; tirar da espera (`removed`); `closed_at`/`closed_by` vêm do gatilho, nunca do cliente;
 *  - só linhas "waiting" mudam; sem DELETE; escrita de quem não pode falha ANTES de qualquer constraint.
 */
describe.skipIf(!hasDb)("RLS da lista de espera: escrita, constraints e gatilho (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared((tx, ids) => seedWaitlist(tx, ids, "Waitlist Write"));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  type NewEntry = typeof waitlistEntries.$inferInsert;
  /** Uma espera nova e livre: p4 + serviço, qualquer profissional (a de p4 já está removida). */
  const nova = (s: WaitlistSeed, over: Partial<NewEntry> = {}): NewEntry => ({
    patientId: s.p4,
    serviceId: s.serviceId,
    specialty: "physiotherapy",
    ...over,
  });
  const create = (tx: Tx, values: NewEntry) => tx.insert(waitlistEntries).values(values).returning({ id: waitlistEntries.id });
  const readRow = async (tx: Tx, id: string) => (await tx.select().from(waitlistEntries).where(eq(waitlistEntries.id, id)))[0];
  const update = (tx: Tx, id: string, set: Partial<NewEntry>) =>
    tx.update(waitlistEntries).set(set).where(eq(waitlistEntries.id, id)).returning({ id: waitlistEntries.id });

  describe("pôr na espera", () => {
    it.each(["admin", "reception"] as const)("%s põe em nome próprio, sempre aberta, com autor e criação do banco", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        const [row] = await create(tx, nova(s, { weekdays: [2, 4], startMinute: 480, endMinute: 720, note: "[teste] manhãs" }));
        expect(row?.id).toBeTruthy();
        await asOwner();
        const saved = await readRow(tx, row!.id);
        expect(saved).toMatchObject({
          createdBy: ids[who],
          status: "waiting",
          appointmentId: null,
          closedAt: null,
          closedBy: null,
          weekdays: [2, 4],
          startMinute: 480,
          endMinute: 720,
        });
        const [instant] = await tx.execute<{ sameInstant: boolean }>(
          sql`select created_at = now() as "sameInstant" from public.waitlist_entries where id = ${row!.id}`,
        );
        expect(instant?.sameInstant).toBe(true);
      });
    });

    it("aceita profissional da especialidade do serviço", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        const [row] = await create(tx, nova(s, { professionalId: s.professionalB }));
        expect(row?.id).toBeTruthy();
      });
    });

    it.each(["professional", "professional2", "stranger", "inactive", "deleted"] as const)("usuário %s não põe ninguém na espera (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => create(x, nova(s)))).toBe("42501");
      });
    });

    it.each(["admin", "reception"] as const)("%s com aal1 não põe ninguém (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await attempt(tx, (x) => create(x, nova(s)))).toBe("42501");
      });
    });

    it("não se falsifica autor, data de criação, status nem encerramento (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await attempt(tx, (x) => create(x, nova(s, { createdBy: ids.admin })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { createdAt: new Date("2020-01-01T00:00:00Z") })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { status: "removed", closedAt: new Date() })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { closedBy: ids.admin })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { status: "fulfilled", appointmentId: s.a6, closedAt: new Date() })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { appointmentId: s.a6 })))).toBe("42501");
      });
    });

    it("recusa paciente removido, serviço inativo, profissional removido ou inativo (42501)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        const [inactivePro] = await tx
          .insert(professionals)
          .values({ fullName: `[teste] Inativa Waitlist ${s.p4.slice(0, 8)}`, specialty: "physiotherapy", active: false })
          .returning({ id: professionals.id });
        await as(ids.admin);
        expect(await attempt(tx, (x) => create(x, nova(s, { patientId: s.pRemoved })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { serviceId: s.inactiveServiceId })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { professionalId: s.professionalGone })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, nova(s, { professionalId: inactivePro!.id })))).toBe("42501");
      });
    });

    it("o banco recusa serviço ou profissional de outra especialidade (23503, FK composta)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        const [dentist] = await tx
          .insert(professionals)
          .values({ fullName: `[teste] Dentista Waitlist ${s.p4.slice(0, 8)}`, specialty: "dentistry" })
          .returning({ id: professionals.id });
        await as(ids.admin);
        expect(await attempt(tx, (x) => create(x, nova(s, { serviceId: s.dentalServiceId })))).toBe("23503");
        expect(await attempt(tx, (x) => create(x, nova(s, { professionalId: dentist!.id })))).toBe("23503");
      });
    });

    it("o banco recusa preferência malformada (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        const bad: Partial<NewEntry>[] = [
          { weekdays: [7] },
          { weekdays: [-1] },
          { weekdays: [0, 1, 2, 3, 4, 5, 6, 0] },
          { startMinute: 600 }, // faixa pela metade
          { endMinute: 600 },
          { startMinute: 600, endMinute: 600 }, // início = fim
          { startMinute: 900, endMinute: 600 }, // fim antes do início
          { startMinute: 603, endMinute: 720 }, // fora do passo de 5
          { startMinute: 600, endMinute: 1445 }, // passa de 24:00
          { startMinute: 1440, endMinute: 1440 },
          { note: " começa com espaço" },
          { note: "termina com espaço " },
          { note: "" },
          { note: "a".repeat(201) },
          { note: "controle\u0001" },
        ];
        for (const over of bad) {
          expect(await attempt(tx, (x) => create(x, nova(s, over))), JSON.stringify(over)).toBe("23514");
        }
        // As bordas válidas passam.
        expect(await attempt(tx, (x) => create(x, nova(s, { weekdays: [0, 6], startMinute: 0, endMinute: 1440, note: "a".repeat(200) })))).toBeUndefined();
      });
    });

    it("uma espera ABERTA por paciente + serviço + profissional (23505); encerrada não bloqueia", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        // Já existe aberta: (p1, serviço, pA) e (p2, serviço, qualquer).
        expect(await attempt(tx, (x) => create(x, nova(s, { patientId: s.p1, professionalId: s.professionalA })))).toBe("23505");
        expect(await attempt(tx, (x) => create(x, nova(s, { patientId: s.p2 })))).toBe("23505");
        // Outro profissional, ou "qualquer", para o mesmo paciente é outra espera.
        expect(await attempt(tx, (x) => create(x, nova(s, { patientId: s.p1, professionalId: s.professionalB })))).toBeUndefined();
        expect(await attempt(tx, (x) => create(x, nova(s, { patientId: s.p1 })))).toBeUndefined();
        // p4 só tem a espera REMOVIDA: pode entrar de novo (e não duas vezes).
        const [first] = await create(tx, nova(s));
        expect(first?.id).toBeTruthy();
        expect(await attempt(tx, (x) => create(x, nova(s)))).toBe("23505");
      });
    });
  });

  describe("editar a preferência", () => {
    it.each(["admin", "reception"] as const)("%s edita profissional, dias, faixa e nota de uma espera aberta", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        const changed = await update(tx, s.entryA, {
          professionalId: s.professionalB,
          weekdays: [5],
          startMinute: 480,
          endMinute: 600,
          note: null,
        });
        expect(changed).toHaveLength(1);
        await asOwner();
        expect(await readRow(tx, s.entryA)).toMatchObject({
          professionalId: s.professionalB,
          weekdays: [5],
          startMinute: 480,
          endMinute: 600,
          note: null,
          status: "waiting",
          closedAt: null,
        });
      });
    });

    it("não troca paciente, serviço, especialidade, autor, criação nem o encerramento (42501: sem privilégio de coluna)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        const forbidden: Partial<NewEntry>[] = [
          { patientId: s.p3 },
          { serviceId: s.inactiveServiceId },
          { specialty: "dentistry" },
          { createdBy: ids.reception },
          { createdAt: new Date("2020-01-01T00:00:00Z") },
          { closedAt: new Date() },
          { closedBy: ids.admin },
        ];
        for (const set of forbidden) {
          expect(await attempt(tx, (x) => update(x, s.entryA, set)), JSON.stringify(Object.keys(set))).toBe("42501");
        }
      });
    });

    it("o banco recusa profissional de outra especialidade e preferência malformada na edição (23503, 23514)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        const [dentist] = await tx
          .insert(professionals)
          .values({ fullName: `[teste] Dentista Edit ${s.p4.slice(0, 8)}`, specialty: "dentistry" })
          .returning({ id: professionals.id });
        await as(ids.admin);
        expect(await attempt(tx, (x) => update(x, s.entryA, { professionalId: dentist!.id }))).toBe("23503");
        expect(await attempt(tx, (x) => update(x, s.entryA, { weekdays: [9] }))).toBe("23514");
        expect(await attempt(tx, (x) => update(x, s.entryA, { startMinute: 700, endMinute: null }))).toBe("23514");
      });
    });

    it("recusa TROCAR para um profissional removido ou inativo (gatilho: 42501)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        const [inactivePro] = await tx
          .insert(professionals)
          .values({ fullName: `[teste] Inativa Troca ${s.p4.slice(0, 8)}`, specialty: "physiotherapy", active: false })
          .returning({ id: professionals.id });
        await as(ids.admin);
        expect(await attempt(tx, (x) => update(x, s.entryA, { professionalId: s.professionalGone }))).toBe("42501");
        expect(await attempt(tx, (x) => update(x, s.entryA, { professionalId: inactivePro!.id }))).toBe("42501");
        // "Qualquer profissional" (nulo) é sempre válido.
        expect(await attempt(tx, (x) => update(x, s.entryA, { professionalId: null }))).toBeUndefined();
      });
    });

    it("manter o profissional (mesmo removido depois) não impede editar dias, faixa e nota", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.admin);
        // entryGone aponta para um profissional REMOVIDO: o cadastro dele não trava a edição.
        expect(await update(tx, s.entryGone, { weekdays: [2], note: "[teste] ajuste" })).toHaveLength(1);
        await asOwner();
        expect(await readRow(tx, s.entryGone)).toMatchObject({ professionalId: s.professionalGone, weekdays: [2] });
      });
    });

    it.each(["professional", "professional2", "stranger", "inactive", "deleted"] as const)("usuário %s não edita nada (0 linhas: nem enxerga)", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        const changed = await update(tx, s.entryA, { note: "[teste] invadido" }).catch(() => []);
        expect(changed).toHaveLength(0);
        await asOwner();
        expect((await readRow(tx, s.entryA))?.note).toBe("[teste] prefere à tarde");
      });
    });

    it.each(["admin", "reception"] as const)("%s com aal1 não edita (0 linhas)", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await update(tx, s.entryA, { note: "[teste] aal1" })).toHaveLength(0);
        await asOwner();
        expect((await readRow(tx, s.entryA))?.note).toBe("[teste] prefere à tarde");
      });
    });

    it("a recepção não edita a espera de paciente ou profissional removido; o admin edita", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await update(tx, s.entryRemovedPatient, { note: "[teste] x" })).toHaveLength(0);
        expect(await update(tx, s.entryGone, { note: "[teste] x" })).toHaveLength(0);
        await as(ids.admin);
        expect(await update(tx, s.entryRemovedPatient, { note: "[teste] x" })).toHaveLength(1);
        expect(await update(tx, s.entryGone, { note: "[teste] x" })).toHaveLength(1);
      });
    });

    it("uma espera encerrada não muda mais (0 linhas), nem para o admin", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.admin);
        expect(await update(tx, s.entryFulfilled, { note: "[teste] x" })).toHaveLength(0);
        expect(await update(tx, s.entryRemoved, { note: "[teste] x", status: "waiting" })).toHaveLength(0);
        await asOwner();
        expect(await readRow(tx, s.entryRemoved)).toMatchObject({ status: "removed", note: null });
        expect(await readRow(tx, s.entryFulfilled)).toMatchObject({ status: "fulfilled", appointmentId: s.a1 });
      });
    });
  });

  describe("tirar da espera", () => {
    it.each(["admin", "reception"] as const)("%s tira da espera; quem e quando vêm do gatilho", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        expect(await update(tx, s.entryB, { status: "removed" })).toHaveLength(1);
        await asOwner();
        expect(await readRow(tx, s.entryB)).toMatchObject({ status: "removed", appointmentId: null, closedBy: ids[who] });
        const [instant] = await tx.execute<{ sameInstant: boolean }>(
          sql`select closed_at = now() as "sameInstant" from public.waitlist_entries where id = ${s.entryB}`,
        );
        expect(instant?.sameInstant).toBe(true);
      });
    });

    it("o admin tira da espera quem aguardava um profissional que depois foi removido", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.admin);
        expect(await update(tx, s.entryGone, { status: "removed" })).toHaveLength(1);
        await asOwner();
        expect(await readRow(tx, s.entryGone)).toMatchObject({ status: "removed", closedBy: ids.admin, professionalId: s.professionalGone });
      });
    });

    it("tirar da espera não aceita atendimento junto (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => update(x, s.entryB, { status: "removed", appointmentId: s.a2 }))).toBe("23514");
      });
    });

    it("o profissional não tira ninguém da espera", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional);
        expect(await update(tx, s.entryA, { status: "removed" }).catch(() => [])).toHaveLength(0);
        await asOwner();
        expect((await readRow(tx, s.entryA))?.status).toBe("waiting");
      });
    });
  });

  describe("atender (fulfilled)", () => {
    it.each(["admin", "reception"] as const)("%s atende com o atendimento do mesmo paciente, serviço e profissional", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        // apFresh é de p1 + pA + serviço, criado depois da espera; entryA pede p1 + pA + serviço.
        expect(await update(tx, s.entryA, { status: "fulfilled", appointmentId: s.apFresh })).toHaveLength(1);
        await asOwner();
        expect(await readRow(tx, s.entryA)).toMatchObject({ status: "fulfilled", appointmentId: s.apFresh, closedBy: ids[who] });
      });
    });

    it("sem profissional na espera, qualquer profissional do mesmo paciente e serviço serve", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        // entryB: p2, qualquer profissional. a2 é de p2 + pB + serviço.
        expect(await update(tx, s.entryB, { status: "fulfilled", appointmentId: s.a2 })).toHaveLength(1);
      });
    });

    it("recusa atendimento de outro paciente, de outro serviço e de OUTRO PROFISSIONAL (23514)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        // Um atendimento de p1 + pA, mas de OUTRO serviço de fisioterapia.
        const [otherService] = await tx.execute<{ id: string }>(sql`
          insert into public.services (name, specialty, duration_minutes)
          values (${`[teste] Outro Waitlist ${s.p4.slice(0, 8)}`}, 'physiotherapy', 30) returning id`);
        const [wrongService] = await tx
          .insert(appointments)
          .values({
            professionalId: s.professionalA,
            patientId: s.p1,
            serviceId: otherService!.id,
            specialty: "physiotherapy",
            startsAt: new Date("2031-06-03T10:00:00Z"),
            endsAt: new Date("2031-06-03T10:30:00Z"),
            createdBy: ids.admin,
            createdAt: new Date("2026-02-01T00:00:00Z"),
            updatedAt: new Date("2026-02-01T00:00:00Z"),
          })
          .returning({ id: appointments.id });
        await as(ids.admin);
        const fulfil = (appointmentId: string) => attempt(tx, (x) => update(x, s.entryA, { status: "fulfilled", appointmentId }));
        expect(await fulfil(s.a2)).toBe("23514"); // p2, outro paciente
        expect(await fulfil(s.a3)).toBe("23514"); // p3, outro paciente
        expect(await fulfil(wrongService!.id)).toBe("23514"); // outro serviço
        // Mesmo paciente e serviço, mas de pB: entryA pede pA. Só o profissional separa os dois.
        expect(await fulfil(s.apOtherPro)).toBe("23514");
        // O de pA, criado depois da espera, serve.
        expect(await fulfil(s.apFresh)).toBeUndefined();
      });
    });

    it("recusa atendimento CANCELADO (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        // a5 é de p2 + pA + serviço e está CANCELADA; entryB (p2, qualquer profissional) combinaria em tudo o mais.
        expect(await attempt(tx, (x) => update(x, s.entryB, { status: "fulfilled", appointmentId: s.a5 }))).toBe("23514");
        // O mesmo pedido com um atendimento vivo de p2 passa.
        expect(await attempt(tx, (x) => update(x, s.entryB, { status: "fulfilled", appointmentId: s.a2 }))).toBeUndefined();
      });
    });

    it("recusa atendimento criado ANTES da espera (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => update(x, s.entryA, { status: "fulfilled", appointmentId: s.apStale }))).toBe("23514");
      });
    });

    it("um atendimento atende UMA espera só (23505, índice único em appointment_id)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        // a1 já atendeu entryFulfilled.
        expect(await attempt(tx, (x) => update(x, s.entryA, { status: "fulfilled", appointmentId: s.a1 }))).toBe("23505");
      });
    });

    it("não troca o profissional no mesmo UPDATE que atende (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        // entryA pedia pA; soltar o profissional e atender com o de pB contornaria o pedido.
        expect(
          await attempt(tx, (x) => update(x, s.entryA, { status: "fulfilled", appointmentId: s.apOtherPro, professionalId: null })),
        ).toBe("42501");
        expect(
          await attempt(tx, (x) => update(x, s.entryA, { status: "removed", professionalId: s.professionalB })),
        ).toBe("42501");
      });
    });

    it("atender sem o atendimento, ou com um inexistente, é recusado", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => update(x, s.entryA, { status: "fulfilled" }))).toBe("23514");
        expect(
          await attempt(tx, (x) => update(x, s.entryA, { status: "fulfilled", appointmentId: "00000000-0000-4000-8000-000000000000" })),
        ).toBe("23514");
      });
    });

    it("um atendimento sem a espera aberta não vira 'aberta' de novo (status waiting com atendimento: 23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => update(x, s.entryA, { appointmentId: s.a1 }))).toBe("23514");
      });
    });
  });

  describe("o gatilho sozinho (sem o GRANT por coluna e sem a RLS a barrar antes)", () => {
    /** Como dono, dá UPDATE em todas as colunas e desliga a RLS DENTRO do savepoint do teste (sempre desfeito). */
    async function unlock(asOwner: () => Promise<void>, tx: Tx) {
      await asOwner();
      await tx.execute(
        sql`grant update (patient_id, service_id, specialty, created_by, created_at, closed_at, closed_by, id) on public.waitlist_entries to authenticated`,
      );
      await tx.execute(sql`alter table public.waitlist_entries disable row level security`);
    }

    it.each([
      ["patient_id", (s: WaitlistSeed) => ({ patientId: s.p3 })],
      ["service_id", (s: WaitlistSeed) => ({ serviceId: s.inactiveServiceId })],
      ["specialty", () => ({ specialty: "dentistry" as const })],
      ["created_by", (s: WaitlistSeed) => ({ createdBy: s.entryA })],
      ["created_at", () => ({ createdAt: new Date("2020-01-01T00:00:00Z") })],
    ])("%s é imutável mesmo com privilégio de coluna (42501)", async (_column, change) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await unlock(asOwner, tx);
        await as(ids.admin);
        expect(await attempt(tx, (x) => update(x, s.entryA, change(s) as Partial<NewEntry>))).toBe("42501");
      });
    });

    it("uma espera encerrada não muda (42501), mesmo sem a política de USING", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await unlock(asOwner, tx);
        await as(ids.admin);
        expect(await attempt(tx, (x) => update(x, s.entryFulfilled, { note: "[teste] x" }))).toBe("42501");
        expect(await attempt(tx, (x) => update(x, s.entryRemoved, { status: "waiting" }))).toBe("42501");
      });
    });

    it.each(["professional", "stranger", "inactive", "deleted"] as const)("usuário %s não altera (42501), mesmo sem a RLS", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await unlock(asOwner, tx);
        await as(ids[who]);
        expect(await attempt(tx, (x) => update(x, s.entryA, { note: "[teste] x" }))).toBe("42501");
      });
    });

    it("sem a RLS, o admin ainda edita e encerra normalmente (o teste acima não é só uma parede)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await unlock(asOwner, tx);
        await as(ids.admin);
        expect(await update(tx, s.entryA, { note: "[teste] ok" })).toHaveLength(1);
        expect(await update(tx, s.entryA, { status: "removed" })).toHaveLength(1);
      });
    });
  });

  describe("sem DELETE", () => {
    it.each(["admin", "reception"] as const)("%s não apaga espera (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.delete(waitlistEntries).where(eq(waitlistEntries.id, s.entryA)))).toBe("42501");
        expect(await attempt(tx, (x) => x.execute(sql`truncate table public.waitlist_entries`))).toBe("42501");
      });
    });
  });
});
