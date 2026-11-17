import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Tx } from "./client";
import { attempt, createRlsHarness, hasDb } from "./rls-harness";
import { professionalTimeOff, professionalWorkHours, professionals, profiles } from "./schema";

/**
 * RLS da grade de horários (faixas semanais e folgas/bloqueios) contra o Supabase DEV, só dados
 * fictícios, transações sempre revertidas. Regras (spec 1B-2b): admin lê e escreve tudo;
 * recepção lê as de profissionais não removidos e não escreve; profissional lê SÓ as próprias
 * (nunca as de colegas); só admin grava; DELETE só do admin e sem UPDATE; `aal1` não passa; sem
 * perfil, inativo ou removido não vê nada. O banco recusa faixas sobrepostas (exclusão) e valores
 * fora dos limites (checks).
 */
describe.skipIf(!hasDb)("RLS da grade de horários (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  beforeAll(() => harness.connect());
  afterAll(() => harness.close());

  const H = (hours: number, minutes = 0) => hours * 60 + minutes;
  const DAY = 24 * 60 * 60 * 1000;
  const t = (iso: string) => new Date(iso);

  type Seed = {
    pA: string; // vinculado a ids.professional
    pB: string; // vinculado a ids.professional2
    pRemoved: string; // removido, sem login
    hA1: string; // pA segunda 08–12
    hA2: string; // pA segunda 14–18
    hB: string; // pB segunda 09–13
    hRemoved: string; // pRemoved terça 08–12
    oA: string; // folga de pA
    oB: string; // folga de pB
    oRemoved: string; // folga de pRemoved
  };

  async function seed(tx: Tx, ids: { professional: string; professional2: string }): Promise<Seed> {
    const [pA] = await tx
      .insert(professionals)
      .values({ fullName: "[teste] Ana Grade", specialty: "physiotherapy", profileId: ids.professional })
      .returning({ id: professionals.id });
    const [pB] = await tx
      .insert(professionals)
      .values({ fullName: "[teste] Bia Grade", specialty: "physiotherapy", profileId: ids.professional2 })
      .returning({ id: professionals.id });
    const [pRemoved] = await tx
      .insert(professionals)
      .values({ fullName: "[teste] Davi Grade", specialty: "dentistry", deletedAt: new Date() })
      .returning({ id: professionals.id });
    const hours = await tx
      .insert(professionalWorkHours)
      .values([
        { professionalId: pA!.id, weekday: 1, startMinute: H(8), endMinute: H(12) },
        { professionalId: pA!.id, weekday: 1, startMinute: H(14), endMinute: H(18) },
        { professionalId: pB!.id, weekday: 1, startMinute: H(9), endMinute: H(13) },
        { professionalId: pRemoved!.id, weekday: 2, startMinute: H(8), endMinute: H(12) },
      ])
      .returning({ id: professionalWorkHours.id });
    const off = await tx
      .insert(professionalTimeOff)
      .values([
        { professionalId: pA!.id, startsAt: t("2026-12-24T03:00:00Z"), endsAt: t("2026-12-27T03:00:00Z"), reason: "Férias" },
        { professionalId: pB!.id, startsAt: t("2026-12-28T03:00:00Z"), endsAt: t("2026-12-29T03:00:00Z"), reason: null },
        { professionalId: pRemoved!.id, startsAt: t("2026-12-30T03:00:00Z"), endsAt: t("2026-12-31T03:00:00Z"), reason: null },
      ])
      .returning({ id: professionalTimeOff.id });
    return {
      pA: pA!.id,
      pB: pB!.id,
      pRemoved: pRemoved!.id,
      hA1: hours[0]!.id,
      hA2: hours[1]!.id,
      hB: hours[2]!.id,
      hRemoved: hours[3]!.id,
      oA: off[0]!.id,
      oB: off[1]!.id,
      oRemoved: off[2]!.id,
    };
  }

  const sorted = (list: string[]) => [...list].sort();
  const seenHours = async (tx: Tx, s: Seed) =>
    sorted(
      (
        await tx
          .select({ id: professionalWorkHours.id })
          .from(professionalWorkHours)
          .where(inArray(professionalWorkHours.professionalId, [s.pA, s.pB, s.pRemoved]))
      ).map((r) => r.id),
    );
  const seenOff = async (tx: Tx, s: Seed) =>
    sorted(
      (
        await tx
          .select({ id: professionalTimeOff.id })
          .from(professionalTimeOff)
          .where(inArray(professionalTimeOff.professionalId, [s.pA, s.pB, s.pRemoved]))
      ).map((r) => r.id),
    );

  describe("leitura", () => {
    it("admin lê tudo, inclusive de profissional removido", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(await seenHours(tx, s)).toEqual(sorted([s.hA1, s.hA2, s.hB, s.hRemoved]));
        expect(await seenOff(tx, s)).toEqual(sorted([s.oA, s.oB, s.oRemoved]));
      });
    });

    it("recepção lê as de todos os profissionais NÃO removidos", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.reception);
        expect(await seenHours(tx, s)).toEqual(sorted([s.hA1, s.hA2, s.hB]));
        expect(await seenOff(tx, s)).toEqual(sorted([s.oA, s.oB]));
      });
    });

    it("profissional lê SÓ a própria grade e as próprias folgas, nunca as de colegas", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.professional);
        expect(await seenHours(tx, s)).toEqual(sorted([s.hA1, s.hA2]));
        expect(await seenOff(tx, s)).toEqual([s.oA]);
        await as(ids.professional2);
        expect(await seenHours(tx, s)).toEqual([s.hB]);
        expect(await seenOff(tx, s)).toEqual([s.oB]);
      });
    });

    it("profissional cujo cadastro foi removido, ou cujo login não está vinculado, não lê nada", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.pA));
        await tx.update(professionals).set({ profileId: null }).where(eq(professionals.id, s.pB));
        for (const who of [ids.professional, ids.professional2]) {
          await as(who);
          expect(await seenHours(tx, s)).toEqual([]);
          expect(await seenOff(tx, s)).toEqual([]);
        }
      });
    });

    it("quando o profissional é removido, a recepção deixa de ver a grade e as folgas dele", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.pB));
        await as(ids.reception);
        expect(await seenHours(tx, s)).toEqual(sorted([s.hA1, s.hA2]));
        expect(await seenOff(tx, s)).toEqual([s.oA]);
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)(
      "usuário %s (sem perfil, inativo ou removido) não lê nada",
      async (who) => {
        await harness.inTx(async ({ tx, ids, as }) => {
          const s = await seed(tx, ids);
          await as(ids[who]);
          expect(await seenHours(tx, s)).toEqual([]);
          expect(await seenOff(tx, s)).toEqual([]);
        });
      },
    );

    it("admin com perfil DESATIVADO ou REMOVIDO deixa de ler (o papel some, não só o 2FA)", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(await seenHours(tx, s)).not.toEqual([]); // prova que o fixture existe e o admin lê
        await asOwner();
        await tx.update(profiles).set({ active: false }).where(eq(profiles.id, ids.admin));
        await as(ids.admin);
        expect(await seenHours(tx, s)).toEqual([]);
        expect(await seenOff(tx, s)).toEqual([]);
        await asOwner();
        await tx.update(profiles).set({ active: true, deletedAt: new Date() }).where(eq(profiles.id, ids.admin));
        await as(ids.admin);
        expect(await seenHours(tx, s)).toEqual([]);
      });
    });

    it("profissional VINCULADO cujo perfil foi desativado ou removido depois deixa de ler a própria grade", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await as(ids.professional);
        expect(await seenHours(tx, s)).toEqual(sorted([s.hA1, s.hA2]));
        await asOwner();
        await tx.update(profiles).set({ active: false }).where(eq(profiles.id, ids.professional));
        await as(ids.professional);
        expect(await seenHours(tx, s)).toEqual([]);
        expect(await seenOff(tx, s)).toEqual([]);
        await asOwner();
        await tx.update(profiles).set({ active: true, deletedAt: new Date() }).where(eq(profiles.id, ids.professional));
        await as(ids.professional);
        expect(await seenHours(tx, s)).toEqual([]);
      });
    });

    it.each(["admin", "reception", "professional"] as const)("%s com JWT aal1 não lê nada", async (who) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids[who], "aal1");
        expect(await seenHours(tx, s)).toEqual([]);
        expect(await seenOff(tx, s)).toEqual([]);
      });
    });
  });

  describe("escrita (só admin)", () => {
    const hour = (professionalId: string, over: Partial<typeof professionalWorkHours.$inferInsert> = {}) => ({
      professionalId,
      weekday: 3,
      startMinute: H(8),
      endMinute: H(12),
      ...over,
    });
    const off = (professionalId: string, over: Partial<typeof professionalTimeOff.$inferInsert> = {}) => ({
      professionalId,
      startsAt: t("2027-01-04T03:00:00Z"),
      endsAt: t("2027-01-05T03:00:00Z"),
      ...over,
    });

    it("admin cria e apaga faixas e folgas", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        const [h] = await tx.insert(professionalWorkHours).values(hour(s.pA)).returning({ id: professionalWorkHours.id });
        const [o] = await tx.insert(professionalTimeOff).values(off(s.pA)).returning({ id: professionalTimeOff.id });
        expect(h?.id && o?.id).toBeTruthy();
        const goneH = await tx.delete(professionalWorkHours).where(eq(professionalWorkHours.id, s.hA1)).returning({ id: professionalWorkHours.id });
        const goneO = await tx.delete(professionalTimeOff).where(eq(professionalTimeOff.id, s.oA)).returning({ id: professionalTimeOff.id });
        expect(goneH).toHaveLength(1);
        expect(goneO).toHaveLength(1);
      });
    });

    it.each(["reception", "professional"] as const)(
      "%s não cria (42501) nem apaga (0 linhas); nada muda",
      async (who) => {
        await harness.inTx(async ({ tx, ids, as, asOwner }) => {
          const s = await seed(tx, ids);
          await as(ids[who]);
          expect(await attempt(tx, (x) => x.insert(professionalWorkHours).values(hour(s.pA)))).toBe("42501");
          expect(await attempt(tx, (x) => x.insert(professionalTimeOff).values(off(s.pA)))).toBe("42501");
          const goneH = await tx.delete(professionalWorkHours).where(inArray(professionalWorkHours.professionalId, [s.pA, s.pB])).returning({ id: professionalWorkHours.id });
          const goneO = await tx.delete(professionalTimeOff).where(inArray(professionalTimeOff.professionalId, [s.pA, s.pB])).returning({ id: professionalTimeOff.id });
          expect(goneH).toEqual([]);
          expect(goneO).toEqual([]);
          await asOwner();
          expect(await seenHours(tx, s)).toEqual(sorted([s.hA1, s.hA2, s.hB, s.hRemoved]));
          expect(await seenOff(tx, s)).toEqual(sorted([s.oA, s.oB, s.oRemoved]));
        });
      },
    );

    it.each(["stranger", "inactive", "deleted"] as const)("usuário %s não escreve (42501)", async (who) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.insert(professionalWorkHours).values(hour(s.pA)))).toBe("42501");
        expect(await attempt(tx, (x) => x.insert(professionalTimeOff).values(off(s.pA)))).toBe("42501");
      });
    });

    it("admin com aal1 não escreve nem apaga", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin, "aal1");
        expect(await attempt(tx, (x) => x.insert(professionalWorkHours).values(hour(s.pA)))).toBe("42501");
        expect(await attempt(tx, (x) => x.insert(professionalTimeOff).values(off(s.pA)))).toBe("42501");
        const goneH = await tx.delete(professionalWorkHours).where(eq(professionalWorkHours.id, s.hA1)).returning({ id: professionalWorkHours.id });
        expect(goneH).toEqual([]);
      });
    });

    it("admin apaga as linhas de um profissional removido (limpeza), a recepção não", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.reception);
        const byReception = await tx.delete(professionalWorkHours).where(eq(professionalWorkHours.id, s.hRemoved)).returning({ id: professionalWorkHours.id });
        expect(byReception).toEqual([]);
        await as(ids.admin);
        const byAdmin = await tx.delete(professionalWorkHours).where(eq(professionalWorkHours.id, s.hRemoved)).returning({ id: professionalWorkHours.id });
        expect(byAdmin).toHaveLength(1);
        const off = await tx.delete(professionalTimeOff).where(eq(professionalTimeOff.id, s.oRemoved)).returning({ id: professionalTimeOff.id });
        expect(off).toHaveLength(1);
      });
    });

    it("ninguém atualiza (sem UPDATE), nem o admin: 42501", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(
          await attempt(tx, (x) => x.update(professionalWorkHours).set({ weekday: 5 }).where(eq(professionalWorkHours.id, s.hA1))),
        ).toBe("42501");
        expect(
          await attempt(tx, (x) => x.update(professionalTimeOff).set({ reason: "x" }).where(eq(professionalTimeOff.id, s.oA))),
        ).toBe("42501");
      });
    });

    it("admin não grava para profissional REMOVIDO nem inexistente (42501, política)", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        const missing = "00000000-0000-4000-8000-000000000000";
        for (const professionalId of [s.pRemoved, missing]) {
          expect(await attempt(tx, (x) => x.insert(professionalWorkHours).values(hour(professionalId)))).toBe("42501");
          expect(await attempt(tx, (x) => x.insert(professionalTimeOff).values(off(professionalId)))).toBe("42501");
        }
      });
    });

    it.each(["reception", "professional"] as const)(
      "%s recebe SEMPRE 42501 ao escrever, mesmo com sobreposição, valor inválido ou profissional escondido (nada vaza por erro de constraint)",
      async (who) => {
        await harness.inTx(async ({ tx, ids, as }) => {
          const s = await seed(tx, ids);
          await as(ids[who]);
          const cases: Array<(x: Tx) => Promise<unknown>> = [
            (x) => x.insert(professionalWorkHours).values(hour(s.pA, { weekday: 1, startMinute: H(9), endMinute: H(11) })), // sobrepõe hA1
            (x) => x.insert(professionalWorkHours).values(hour(s.pA, { startMinute: H(12), endMinute: H(8) })), // fim antes do início
            (x) => x.insert(professionalWorkHours).values(hour(s.pA, { weekday: 9 })), // dia inválido
            (x) => x.insert(professionalWorkHours).values(hour(s.pRemoved)), // profissional removido (que nem enxergam)
            (x) => x.insert(professionalWorkHours).values(hour("00000000-0000-4000-8000-000000000000")), // inexistente
            (x) => x.insert(professionalTimeOff).values(off(s.pA, { startsAt: t("2027-01-05T00:00:00Z"), endsAt: t("2027-01-04T00:00:00Z") })),
            (x) => x.insert(professionalTimeOff).values(off(s.pA, { reason: " " })),
            (x) => x.insert(professionalTimeOff).values(off(s.pRemoved)),
          ];
          for (const run of cases) expect(await attempt(tx, run)).toBe("42501");
        });
      },
    );
  });

  describe("faixas semanais: regras do banco", () => {
    const base = (professionalId: string, over: Partial<typeof professionalWorkHours.$inferInsert> = {}) => ({
      professionalId,
      weekday: 4,
      startMinute: H(8),
      endMinute: H(12),
      ...over,
    });

    it("faixa sobreposta do mesmo profissional no mesmo dia é recusada pelo banco (23P01), inclusive repetida e contida", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        for (const over of [
          { weekday: 1, startMinute: H(8), endMinute: H(12) }, // igual à hA1
          { weekday: 1, startMinute: H(11), endMinute: H(13) }, // pega o fim da hA1
          { weekday: 1, startMinute: H(7), endMinute: H(9) }, // pega o início da hA1
          { weekday: 1, startMinute: H(9), endMinute: H(10) }, // dentro da hA1
          { weekday: 1, startMinute: H(6), endMinute: H(20) }, // contém hA1 e hA2
        ]) {
          expect(await attempt(tx, (x) => x.insert(professionalWorkHours).values(base(s.pA, over)))).toBe("23P01");
        }
      });
    });

    it("faixas que apenas ENCOSTAM valem (12:00 fim e 12:00 início); outro dia e outro profissional também", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        for (const over of [
          { weekday: 1, startMinute: H(12), endMinute: H(14) }, // entre hA1 e hA2, encostando nas duas
          { weekday: 1, startMinute: H(18), endMinute: H(20) }, // encosta no fim da hA2
          { weekday: 1, startMinute: H(6), endMinute: H(8) }, // encosta no início da hA1
          { weekday: 2, startMinute: H(8), endMinute: H(12) }, // outro dia
        ]) {
          expect(await attempt(tx, (x) => x.insert(professionalWorkHours).values(base(s.pA, over)))).toBeUndefined();
        }
        // a mesma faixa de pA (segunda 08-12) em outro profissional não conflita
        expect(
          await attempt(tx, (x) =>
            x.insert(professionalWorkHours).values(base(s.pB, { weekday: 1, startMinute: H(14), endMinute: H(18) })),
          ),
        ).toBeUndefined();
      });
    });

    it("depois de apagar a faixa, o mesmo horário pode ser recriado (editar a semana = substituir)", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        await tx.delete(professionalWorkHours).where(eq(professionalWorkHours.id, s.hA1));
        expect(
          await attempt(tx, (x) =>
            x.insert(professionalWorkHours).values(base(s.pA, { weekday: 1, startMinute: H(8), endMinute: H(12) })),
          ),
        ).toBeUndefined();
      });
    });

    it.each([
      ["dia -1", { weekday: -1 }],
      ["dia 7", { weekday: 7 }],
      ["início fora do passo de 5", { startMinute: H(8, 3) }],
      ["fim fora do passo de 5", { endMinute: H(12, 7) }],
      ["fim depois de 24:00", { endMinute: 1445 }],
      ["início negativo", { startMinute: -5 }],
      ["início 24:00", { startMinute: 1440, endMinute: 1440 }],
      ["fim igual ao início", { startMinute: H(8), endMinute: H(8) }],
      ["fim antes do início", { startMinute: H(12), endMinute: H(8) }],
    ])("recusa %s (23514)", async (_label, over) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.insert(professionalWorkHours).values(base(s.pA, over)))).toBe("23514");
      });
    });

    it("aceita os limites exatos (00:00 até 24:00, domingo e sábado)", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        for (const over of [
          { weekday: 0, startMinute: 0, endMinute: 1440 },
          { weekday: 6, startMinute: 1435, endMinute: 1440 },
          { weekday: 5, startMinute: 0, endMinute: 5 },
        ]) {
          expect(await attempt(tx, (x) => x.insert(professionalWorkHours).values(base(s.pA, over)))).toBeUndefined();
        }
      });
    });

    it("não dá para apagar (nem como dono) um profissional que tem faixas ou folgas (restrict)", async () => {
      await harness.inTx(async ({ tx, ids, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        expect(await attempt(tx, (x) => x.delete(professionals).where(eq(professionals.id, s.pA)))).toBe("23503");
      });
    });
  });

  describe("folgas e bloqueios: regras do banco", () => {
    const base = (professionalId: string, over: Partial<typeof professionalTimeOff.$inferInsert> = {}) => ({
      professionalId,
      startsAt: t("2027-02-01T03:00:00Z"),
      endsAt: t("2027-02-02T03:00:00Z"),
      ...over,
    });

    it.each([
      ["fim igual ao início", { endsAt: t("2027-02-01T03:00:00Z") }],
      ["fim antes do início", { endsAt: t("2027-01-31T03:00:00Z") }],
      ["período de 366 dias e 1 minuto", { endsAt: new Date(t("2027-02-01T03:00:00Z").getTime() + 366 * DAY + 60_000) }],
      ["motivo vazio", { reason: "" }],
      ["motivo só com espaços", { reason: "   " }],
      ["motivo com espaço na ponta", { reason: "Férias " }],
      ["motivo com 121 caracteres", { reason: "a".repeat(121) }],
    ])("recusa %s (23514)", async (_label, over) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.insert(professionalTimeOff).values(base(s.pA, over)))).toBe("23514");
      });
    });

    it.each([
      ["início antes de 2000", { startsAt: t("1999-12-31T00:00:00Z"), endsAt: t("2000-01-01T00:00:00Z") }],
      ["ano 0026 (erro de digitação)", { startsAt: t("0026-12-24T03:00:00Z"), endsAt: t("0026-12-25T03:00:00Z") }],
      ["fim depois de 2101-01-02", { startsAt: t("2101-01-01T00:00:00Z"), endsAt: t("2101-01-03T00:00:00Z") }],
      ["ano 9999", { startsAt: t("9999-12-30T00:00:00Z"), endsAt: t("9999-12-31T00:00:00Z") }],
    ])("recusa período fora de 2000 a 2100: %s (23514)", async (_label, over) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.insert(professionalTimeOff).values(base(s.pA, over)))).toBe("23514");
      });
    });

    it("aceita os extremos de 2000 e de 2100 (folga de dia inteiro em 31/12/2100 termina em 01/01/2101)", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        for (const over of [
          { startsAt: t("2000-01-01T03:00:00Z"), endsAt: t("2000-01-02T03:00:00Z") },
          { startsAt: t("2100-12-31T03:00:00Z"), endsAt: t("2101-01-01T03:00:00Z") },
        ]) {
          expect(await attempt(tx, (x) => x.insert(professionalTimeOff).values(base(s.pA, over)))).toBeUndefined();
        }
      });
    });

    it("aceita 366 dias exatos, 1 minuto de bloqueio, motivo com 120 caracteres e sem motivo", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        const start = t("2027-02-01T03:00:00Z");
        for (const over of [
          { endsAt: new Date(start.getTime() + 366 * DAY) },
          { endsAt: new Date(start.getTime() + 60_000) },
          { reason: "m".repeat(120) },
          { reason: null },
        ]) {
          expect(await attempt(tx, (x) => x.insert(professionalTimeOff).values(base(s.pA, over)))).toBeUndefined();
        }
      });
    });

    it("folgas que se sobrepõem são permitidas (vale a união)", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(
          await attempt(tx, (x) =>
            x.insert(professionalTimeOff).values(base(s.pA, { startsAt: t("2026-12-25T03:00:00Z"), endsAt: t("2026-12-26T03:00:00Z") })),
          ),
        ).toBeUndefined(); // dentro da folga oA (24 a 27/12)
      });
    });
  });

  describe("privilégios (catálogo do Postgres)", () => {
    it.each(["professional_work_hours", "professional_time_off"])(
      "%s: anon não tem nada; authenticated só SELECT/INSERT/DELETE; sem UPDATE/TRUNCATE/REFERENCES/TRIGGER; RLS ligada",
      async (table) => {
        await harness.inTx(async ({ tx, asOwner }) => {
          await asOwner();
          const [row] = await tx.execute<Record<string, boolean>>(sql`
            select
              has_table_privilege('anon', ${`public.${table}`}, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon,
              has_any_column_privilege('anon', ${`public.${table}`}, 'SELECT,INSERT,UPDATE,REFERENCES') as "anonCols",
              has_table_privilege('authenticated', ${`public.${table}`}, 'SELECT') as sel,
              has_table_privilege('authenticated', ${`public.${table}`}, 'INSERT') as ins,
              has_table_privilege('authenticated', ${`public.${table}`}, 'UPDATE') as upd,
              has_table_privilege('authenticated', ${`public.${table}`}, 'DELETE') as del,
              has_table_privilege('authenticated', ${`public.${table}`}, 'TRUNCATE,REFERENCES,TRIGGER') as extra,
              has_any_column_privilege('authenticated', ${`public.${table}`}, 'UPDATE,REFERENCES') as "writeCols",
              (select relrowsecurity from pg_class where oid = ${`public.${table}`}::regclass) as rls`);
          expect(row).toEqual({
            anon: false,
            anonCols: false,
            sel: true,
            ins: true,
            upd: false,
            del: true,
            extra: false,
            writeCols: false,
            rls: true,
          });
        });
      },
    );
  });
});
