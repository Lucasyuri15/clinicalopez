import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SPECIALTIES } from "@/lib/catalog/labels";

import type { Tx } from "./client";
import { attempt, createRlsHarness, hasDb } from "./rls-harness";
import { insurances, servicePrices, services, specialty } from "./schema";

/**
 * RLS do catálogo (serviços, convênios e valores) contra o Supabase DEV, só dados fictícios,
 * transações sempre revertidas. Regras (spec 1B-1): admin lê e escreve tudo; recepção lê o
 * que não foi removido; profissional lê SÓ serviços (nunca convênios nem valores); sem DELETE;
 * `aal1` (só senha) não passa; usuário sem perfil, inativo ou removido não vê nada.
 */
describe.skipIf(!hasDb)("RLS do catálogo (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  // Cenário montado UMA vez por arquivo; cada teste roda num savepoint desfeito (ver `rls-harness.ts`).
  const shared = harness.shared((tx) => seed(tx));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  type Seed = {
    sPhysio: string; // ativo, com valor particular e valor do Plano A
    sPsych: string; // inativo (active = false), sem valores
    sRemoved: string; // removido (deleted_at)
    plan: string; // convênio ativo
    planRemoved: string; // convênio removido
    pParticular: string;
    pPlan: string;
    pRemoved: string; // valor removido (deleted_at), de outro serviço
  };

  /** Fixtures criados pelo DONO (a transação ainda não assumiu `authenticated`). */
  async function seed(tx: Tx): Promise<Seed> {
    const [physio] = await tx
      .insert(services)
      .values({ name: "[teste] Sessao de fisioterapia", specialty: "physiotherapy", durationMinutes: 50 })
      .returning({ id: services.id });
    const [psych] = await tx
      .insert(services)
      .values({
        name: "[teste] Psicoterapia",
        specialty: "psychology",
        durationMinutes: 50,
        active: false,
      })
      .returning({ id: services.id });
    const [removed] = await tx
      .insert(services)
      .values({
        name: "[teste] Servico antigo",
        specialty: "dentistry",
        durationMinutes: 30,
        deletedAt: new Date(),
      })
      .returning({ id: services.id });
    const [plan] = await tx
      .insert(insurances)
      .values({ name: "[teste] Plano A Ficticio" })
      .returning({ id: insurances.id });
    const [planRemoved] = await tx
      .insert(insurances)
      .values({ name: "[teste] Plano Velho Ficticio", deletedAt: new Date() })
      .returning({ id: insurances.id });
    const [pParticular] = await tx
      .insert(servicePrices)
      .values({ serviceId: physio!.id, insuranceId: null, priceCents: 15000 })
      .returning({ id: servicePrices.id });
    const [pPlan] = await tx
      .insert(servicePrices)
      .values({ serviceId: physio!.id, insuranceId: plan!.id, priceCents: 9000 })
      .returning({ id: servicePrices.id });
    const [pRemoved] = await tx
      .insert(servicePrices)
      .values({
        serviceId: psych!.id,
        insuranceId: null,
        priceCents: 12000,
        deletedAt: new Date(),
      })
      .returning({ id: servicePrices.id });
    return {
      sPhysio: physio!.id,
      sPsych: psych!.id,
      sRemoved: removed!.id,
      plan: plan!.id,
      planRemoved: planRemoved!.id,
      pParticular: pParticular!.id,
      pPlan: pPlan!.id,
      pRemoved: pRemoved!.id,
    };
  }

  const sorted = (list: string[]) => [...list].sort();
  const seenServices = async (tx: Tx, s: Seed) =>
    sorted(
      (
        await tx
          .select({ id: services.id })
          .from(services)
          .where(inArray(services.id, [s.sPhysio, s.sPsych, s.sRemoved]))
      ).map((r) => r.id),
    );
  const seenInsurances = async (tx: Tx, s: Seed) =>
    sorted(
      (
        await tx
          .select({ id: insurances.id })
          .from(insurances)
          .where(inArray(insurances.id, [s.plan, s.planRemoved]))
      ).map((r) => r.id),
    );
  const seenPrices = async (tx: Tx, s: Seed) =>
    sorted(
      (
        await tx
          .select({ id: servicePrices.id })
          .from(servicePrices)
          .where(inArray(servicePrices.id, [s.pParticular, s.pPlan, s.pRemoved]))
      ).map((r) => r.id),
    );

  describe("enum", () => {
    it("`specialty` do banco tem as mesmas especialidades de SPECIALTIES (src/lib/catalog)", () => {
      expect([...specialty.enumValues]).toEqual([...SPECIALTIES]);
    });
  });

  describe("services", () => {
    it("admin lê todos, inclusive inativo e removido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await seenServices(tx, s)).toEqual(sorted([s.sPhysio, s.sPsych, s.sRemoved]));
      });
    });

    it.each(["reception", "professional"] as const)(
      "%s lê os não removidos (inclusive inativo), e não o removido",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(await seenServices(tx, s)).toEqual(sorted([s.sPhysio, s.sPsych]));
        });
      },
    );

    it.each(["stranger", "inactive", "deleted"] as const)(
      "usuário %s (sem perfil, inativo ou removido) não lê nada",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(await seenServices(tx, s)).toEqual([]);
        });
      },
    );

    it.each(["admin", "reception", "professional"] as const)(
      "%s com JWT aal1 (só senha) não lê nada",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who], "aal1");
          expect(await seenServices(tx, s)).toEqual([]);
        });
      },
    );

    it("admin cria e edita; recepção e profissional não criam (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        const novo = { name: "[teste] Avaliacao", specialty: "dentistry", durationMinutes: 40 } as const;

        await as(ids.admin);
        const [created] = await tx.insert(services).values(novo).returning({ id: services.id });
        expect(created?.id).toBeTruthy();
        const edited = await tx
          .update(services)
          .set({ durationMinutes: 45 })
          .where(eq(services.id, s.sPhysio))
          .returning({ id: services.id });
        expect(edited).toHaveLength(1);

        for (const who of ["reception", "professional"] as const) {
          await as(ids[who]);
          expect(await attempt(tx, (t) => t.insert(services).values({ ...novo, name: `X ${who}` }))).toBe(
            "42501",
          );
        }
      });
    });

    it("recepção e profissional não editam nem removem (0 linhas), e o dado não muda", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        for (const who of ["reception", "professional"] as const) {
          await as(ids[who]);
          const changed = await tx
            .update(services)
            .set({ durationMinutes: 99, deletedAt: new Date() })
            .where(eq(services.id, s.sPhysio))
            .returning({ id: services.id });
          expect(changed).toEqual([]);
        }
        await asOwner();
        const [row] = await tx.select().from(services).where(eq(services.id, s.sPhysio));
        expect(row?.durationMinutes).toBe(50);
        expect(row?.deletedAt).toBeNull();
      });
    });

    it("admin faz exclusão lógica (deleted_at) e, depois, recepção deixa de ver o serviço", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        const done = await tx
          .update(services)
          .set({ deletedAt: new Date() })
          .where(eq(services.id, s.sPhysio))
          .returning({ id: services.id });
        expect(done).toHaveLength(1);
        await as(ids.reception);
        expect(await seenServices(tx, s)).toEqual([s.sPsych]);
      });
    });

    it("admin com aal1 não cria nem edita (42501 / 0 linhas)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin, "aal1");
        expect(
          await attempt(tx, (t) =>
            t.insert(services).values({ name: "Z", specialty: "dentistry", durationMinutes: 30 }),
          ),
        ).toBe("42501");
        const changed = await tx
          .update(services)
          .set({ durationMinutes: 99 })
          .where(eq(services.id, s.sPhysio))
          .returning({ id: services.id });
        expect(changed).toEqual([]);
      });
    });

    it("nem o admin apaga (sem DELETE): 42501", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (t) => t.delete(services).where(eq(services.id, s.sPsych)))).toBe(
          "42501",
        );
      });
    });

    describe("regras do banco (únicos e checks)", () => {
      const base = { name: "[teste] Sessao nova", specialty: "physiotherapy", durationMinutes: 50 } as const;

      it("nome repetido na mesma especialidade (sem diferenciar maiúsculas) é recusado (23505)", async () => {
        await shared.run(async ({ tx, ids, as }) => {
          await as(ids.admin);
          expect(
            await attempt(tx, (t) => t.insert(services).values({ ...base, name: "[TESTE] SESSAO DE FISIOTERAPIA" })),
          ).toBe("23505");
        });
      });

      it("mesmo nome em outra especialidade vale; e depois da exclusão lógica o nome pode voltar", async () => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids.admin);
          expect(
            await attempt(tx, (t) =>
              t.insert(services).values({ ...base, name: "[teste] Sessao de fisioterapia", specialty: "psychology" }),
            ),
          ).toBeUndefined();
          await tx.update(services).set({ deletedAt: new Date() }).where(eq(services.id, s.sPhysio));
          expect(
            await attempt(tx, (t) => t.insert(services).values({ ...base, name: "[teste] Sessao de fisioterapia" })),
          ).toBeUndefined();
        });
      });

      it.each([
        ["duração 4", { durationMinutes: 4 }],
        ["duração 481", { durationMinutes: 481 }],
        ["duração 0", { durationMinutes: 0 }],
        ["nome só com espaços", { name: "   " }],
        ["nome vazio", { name: "" }],
        ["nome com 121 caracteres", { name: "a".repeat(121) }],
        ["nome com espaço no início", { name: " Sessao" }],
        ["nome com espaço no fim", { name: "Sessao " }],
        ["nome com tabulação na ponta", { name: "\tSessao" }],
        ["nome com 10 mil espaços no fim", { name: `a${" ".repeat(10_000)}` }],
      ])("recusa %s (23514)", async (_label, over) => {
        await shared.run(async ({ tx, ids, as }) => {
          await as(ids.admin);
          expect(await attempt(tx, (t) => t.insert(services).values({ ...base, ...over }))).toBe("23514");
        });
      });

      it("aceita os limites exatos (duração 5 e 480, nome com 120 caracteres)", async () => {
        await shared.run(async ({ tx, ids, as }) => {
          await as(ids.admin);
          for (const over of [
            { name: "Curto", durationMinutes: 5 },
            { name: "Longo", durationMinutes: 480 },
            { name: "n".repeat(120) },
          ]) {
            expect(await attempt(tx, (t) => t.insert(services).values({ ...base, ...over }))).toBeUndefined();
          }
        });
      });

      it("especialidade fora da lista é recusada (22P02)", async () => {
        await shared.run(async ({ tx, ids, as }) => {
          await as(ids.admin);
          expect(
            await attempt(tx, (t) =>
              t.execute(
                sql`insert into services (name, specialty, duration_minutes) values ('Y', 'cardiology', 30)`,
              ),
            ),
          ).toBe("22P02");
        });
      });
    });
  });

  describe("insurances", () => {
    it("admin lê todos, inclusive o removido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await seenInsurances(tx, s)).toEqual(sorted([s.plan, s.planRemoved]));
      });
    });

    it("recepção lê só o não removido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await seenInsurances(tx, s)).toEqual([s.plan]);
      });
    });

    it("profissional NÃO lê convênios", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await seenInsurances(tx, s)).toEqual([]);
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)("usuário %s não lê nada", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await seenInsurances(tx, s)).toEqual([]);
      });
    });

    it.each(["admin", "reception"] as const)("%s com aal1 não lê nada", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await seenInsurances(tx, s)).toEqual([]);
      });
    });

    it("admin cria e edita; recepção e profissional não escrevem", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (t) => t.insert(insurances).values({ name: "[teste] Plano B Ficticio" }))).toBeUndefined();
        const edited = await tx
          .update(insurances)
          .set({ active: false })
          .where(eq(insurances.id, s.plan))
          .returning({ id: insurances.id });
        expect(edited).toHaveLength(1);

        for (const who of ["reception", "professional"] as const) {
          await as(ids[who]);
          expect(await attempt(tx, (t) => t.insert(insurances).values({ name: `Plano ${who}` }))).toBe("42501");
          const changed = await tx
            .update(insurances)
            .set({ name: "Hackeado" })
            .where(eq(insurances.id, s.plan))
            .returning({ id: insurances.id });
          expect(changed).toEqual([]);
        }
        await asOwner();
        const [row] = await tx.select().from(insurances).where(eq(insurances.id, s.plan));
        expect(row?.name).toBe("[teste] Plano A Ficticio");
      });
    });

    it("admin com aal1 não escreve; nem o admin apaga", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin, "aal1");
        expect(await attempt(tx, (t) => t.insert(insurances).values({ name: "Z" }))).toBe("42501");
        await as(ids.admin);
        expect(await attempt(tx, (t) => t.delete(insurances).where(eq(insurances.id, s.plan)))).toBe("42501");
      });
    });

    it("nome repetido (sem diferenciar maiúsculas) é recusado; vazio e grande demais também", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids.admin);
        expect(await attempt(tx, (t) => t.insert(insurances).values({ name: "[TESTE] PLANO A FICTICIO" }))).toBe("23505");
        expect(await attempt(tx, (t) => t.insert(insurances).values({ name: "  " }))).toBe("23514");
        expect(await attempt(tx, (t) => t.insert(insurances).values({ name: "p".repeat(121) }))).toBe("23514");
        expect(await attempt(tx, (t) => t.insert(insurances).values({ name: " Plano" }))).toBe("23514");
        expect(await attempt(tx, (t) => t.insert(insurances).values({ name: "Plano\n" }))).toBe("23514");
      });
    });

    it("o nome de um convênio removido pode ser reutilizado", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids.admin);
        expect(await attempt(tx, (t) => t.insert(insurances).values({ name: "[teste] Plano Velho Ficticio" }))).toBeUndefined();
      });
    });
  });

  describe("service_prices", () => {
    it("admin lê todos, inclusive o removido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await seenPrices(tx, s)).toEqual(sorted([s.pParticular, s.pPlan, s.pRemoved]));
      });
    });

    it("recepção lê os não removidos", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await seenPrices(tx, s)).toEqual(sorted([s.pParticular, s.pPlan]));
      });
    });

    it("profissional NÃO lê valores (nem por junção com serviços)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await seenPrices(tx, s)).toEqual([]);
        const joined = await tx
          .select({ name: services.name, price: servicePrices.priceCents })
          .from(services)
          .leftJoin(servicePrices, eq(servicePrices.serviceId, services.id))
          .where(eq(services.id, s.sPhysio));
        expect(joined).toEqual([{ name: "[teste] Sessao de fisioterapia", price: null }]);
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)("usuário %s não lê nada", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await seenPrices(tx, s)).toEqual([]);
      });
    });

    it.each(["admin", "reception"] as const)("%s com aal1 não lê nada", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await seenPrices(tx, s)).toEqual([]);
      });
    });

    it("admin cria, edita e faz exclusão lógica; recepção e profissional não escrevem", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.admin);
        // valor particular do serviço inativo (o removido já existe, então o novo é permitido)
        expect(
          await attempt(tx, (t) =>
            t.insert(servicePrices).values({ serviceId: s.sPsych, insuranceId: null, priceCents: 11000 }),
          ),
        ).toBeUndefined();
        const edited = await tx
          .update(servicePrices)
          .set({ priceCents: 16000 })
          .where(eq(servicePrices.id, s.pParticular))
          .returning({ id: servicePrices.id });
        expect(edited).toHaveLength(1);
        const removed = await tx
          .update(servicePrices)
          .set({ deletedAt: new Date() })
          .where(eq(servicePrices.id, s.pPlan))
          .returning({ id: servicePrices.id });
        expect(removed).toHaveLength(1);

        for (const who of ["reception", "professional"] as const) {
          await as(ids[who]);
          expect(
            await attempt(tx, (t) =>
              t.insert(servicePrices).values({ serviceId: s.sPsych, insuranceId: s.plan, priceCents: 1 }),
            ),
          ).toBe("42501");
          const changed = await tx
            .update(servicePrices)
            .set({ priceCents: 1 })
            .where(eq(servicePrices.id, s.pParticular))
            .returning({ id: servicePrices.id });
          expect(changed).toEqual([]);
        }
        await asOwner();
        const [row] = await tx.select().from(servicePrices).where(eq(servicePrices.id, s.pParticular));
        expect(row?.priceCents).toBe(16000);
      });
    });

    it("admin com aal1 não escreve; nem o admin apaga", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin, "aal1");
        expect(
          await attempt(tx, (t) =>
            t.insert(servicePrices).values({ serviceId: s.sPsych, insuranceId: null, priceCents: 1 }),
          ),
        ).toBe("42501");
        await as(ids.admin);
        expect(
          await attempt(tx, (t) => t.delete(servicePrices).where(eq(servicePrices.id, s.pPlan))),
        ).toBe("42501");
      });
    });

    it("valores de serviço ou convênio REMOVIDOS somem para a recepção; o admin ainda os vê", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        const [pOk] = await tx
          .insert(servicePrices)
          .values({ serviceId: s.sPsych, insuranceId: s.plan, priceCents: 8000 })
          .returning({ id: servicePrices.id });
        const [orphan] = await tx
          .insert(servicePrices)
          .values({ serviceId: s.sPsych, insuranceId: s.planRemoved, priceCents: 5000 })
          .returning({ id: servicePrices.id });
        await tx.update(services).set({ deletedAt: new Date() }).where(eq(services.id, s.sPhysio));
        const all = [s.pParticular, s.pPlan, s.pRemoved, pOk!.id, orphan!.id];
        const seen = async () =>
          sorted(
            (
              await tx
                .select({ id: servicePrices.id })
                .from(servicePrices)
                .where(inArray(servicePrices.id, all))
            ).map((r) => r.id),
          );

        await as(ids.reception);
        // só o valor cujo serviço E convênio estão visíveis (e que não foi removido)
        expect(await seen()).toEqual([pOk!.id]);
        await as(ids.admin);
        expect(await seen()).toEqual(sorted(all));
      });
    });

    describe("regras do banco (únicos, checks e chaves)", () => {
      it.each([
        ["valor negativo", -1],
        ["valor acima do teto", 10_000_001],
      ])("recusa %s (23514)", async (_label, priceCents) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids.admin);
          expect(
            await attempt(tx, (t) =>
              t.insert(servicePrices).values({ serviceId: s.sPsych, insuranceId: s.plan, priceCents }),
            ),
          ).toBe("23514");
        });
      });

      it("aceita zero e o teto exato", async () => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids.admin);
          for (const priceCents of [0, 10_000_000]) {
            expect(
              await attempt(tx, (t) =>
                t.insert(servicePrices).values({ serviceId: s.sPsych, insuranceId: s.plan, priceCents }),
              ),
            ).toBeUndefined();
          }
        });
      });

      it("um só valor particular e um só valor por convênio, por serviço (23505)", async () => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids.admin);
          expect(
            await attempt(tx, (t) =>
              t.insert(servicePrices).values({ serviceId: s.sPhysio, insuranceId: null, priceCents: 1 }),
            ),
          ).toBe("23505");
          expect(
            await attempt(tx, (t) =>
              t.insert(servicePrices).values({ serviceId: s.sPhysio, insuranceId: s.plan, priceCents: 1 }),
            ),
          ).toBe("23505");
        });
      });

      it("o mesmo serviço pode ter valor em outro convênio; e depois da exclusão lógica o valor pode ser recriado", async () => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids.admin);
          const [other] = await tx
            .insert(insurances)
            .values({ name: "[teste] Plano C Ficticio" })
            .returning({ id: insurances.id });
          expect(
            await attempt(tx, (t) =>
              t.insert(servicePrices).values({ serviceId: s.sPhysio, insuranceId: other!.id, priceCents: 7000 }),
            ),
          ).toBeUndefined();
          await tx.update(servicePrices).set({ deletedAt: new Date() }).where(eq(servicePrices.id, s.pParticular));
          expect(
            await attempt(tx, (t) =>
              t.insert(servicePrices).values({ serviceId: s.sPhysio, insuranceId: null, priceCents: 17000 }),
            ),
          ).toBeUndefined();
        });
      });

      it("admin não cria valor para serviço/convênio inexistente ou REMOVIDO (42501, política); a chave estrangeira segue valendo para o dono (23503)", async () => {
        await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
          const missing = "00000000-0000-4000-8000-000000000000";
          const bad = [
            { serviceId: missing, insuranceId: null },
            { serviceId: s.sPsych, insuranceId: missing },
            { serviceId: s.sRemoved, insuranceId: null }, // serviço removido
            { serviceId: s.sPsych, insuranceId: s.planRemoved }, // convênio removido
          ];
          await as(ids.admin);
          for (const row of bad) {
            expect(await attempt(tx, (t) => t.insert(servicePrices).values({ ...row, priceCents: 1 }))).toBe(
              "42501",
            );
          }
          await asOwner();
          expect(
            await attempt(tx, (t) =>
              t.insert(servicePrices).values({ serviceId: missing, insuranceId: null, priceCents: 1 }),
            ),
          ).toBe("23503");
          expect(
            await attempt(tx, (t) =>
              t.insert(servicePrices).values({ serviceId: s.sPsych, insuranceId: missing, priceCents: 1 }),
            ),
          ).toBe("23503");
        });
      });

      it("não dá para apagar (nem como dono) um serviço ou convênio que tem valores (restrict)", async () => {
        await shared.run(async ({ tx, asOwner, seed: s }) => {
          await asOwner();
          expect(await attempt(tx, (t) => t.delete(services).where(eq(services.id, s.sPhysio)))).toBe("23503");
          expect(await attempt(tx, (t) => t.delete(insurances).where(eq(insurances.id, s.plan)))).toBe("23503");
        });
      });
    });
  });

  describe("quem não é admin recebe SEMPRE 42501 ao escrever (nenhum erro de constraint revela dado escondido)", () => {
    const missing = "00000000-0000-4000-8000-000000000000";

    it.each(["reception", "professional"] as const)(
      "%s: duplicata, valor inválido e chave estrangeira dão 42501, igual a uma linha limpa",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          const cases: Array<(t: Tx) => Promise<unknown>> = [
            // serviços: nome repetido e duração inválida
            (t) =>
              t.insert(services).values({
                name: "[teste] Sessao de fisioterapia",
                specialty: "physiotherapy",
                durationMinutes: 50,
              }),
            (t) =>
              t.insert(services).values({ name: "Novo", specialty: "dentistry", durationMinutes: 4 }),
            // convênios: nome repetido (inclusive de um REMOVIDO, que o não-admin nem enxerga) e vazio
            (t) => t.insert(insurances).values({ name: "[teste] Plano A Ficticio" }),
            (t) => t.insert(insurances).values({ name: "[teste] Plano Velho Ficticio" }),
            (t) => t.insert(insurances).values({ name: "  " }),
            // valores: par já existente, valor inválido, serviço/convênio inexistente e convênio escondido
            (t) => t.insert(servicePrices).values({ serviceId: s.sPhysio, insuranceId: null, priceCents: 1 }),
            (t) => t.insert(servicePrices).values({ serviceId: s.sPhysio, insuranceId: s.plan, priceCents: 1 }),
            (t) => t.insert(servicePrices).values({ serviceId: s.sPsych, insuranceId: s.plan, priceCents: -1 }),
            (t) => t.insert(servicePrices).values({ serviceId: missing, insuranceId: null, priceCents: 1 }),
            (t) => t.insert(servicePrices).values({ serviceId: s.sPsych, insuranceId: missing, priceCents: 1 }),
            (t) => t.insert(servicePrices).values({ serviceId: s.sPsych, insuranceId: s.planRemoved, priceCents: 1 }),
            // ON CONFLICT não é um atalho
            (t) => t.insert(insurances).values({ name: "[teste] Plano A Ficticio" }).onConflictDoNothing(),
            (t) =>
              t
                .insert(services)
                .values({ name: "[teste] Sessao de fisioterapia", specialty: "physiotherapy", durationMinutes: 50 })
                .onConflictDoUpdate({
                  target: [services.id],
                  set: { durationMinutes: 99 },
                }),
          ];
          for (const run of cases) expect(await attempt(tx, run)).toBe("42501");
        });
      },
    );

    it.each(["stranger", "inactive", "deleted"] as const)(
      "usuário %s (sem perfil, inativo ou removido) não escreve em nenhuma tabela (42501)",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(
            await attempt(tx, (t) =>
              t.insert(services).values({ name: "W", specialty: "dentistry", durationMinutes: 30 }),
            ),
          ).toBe("42501");
          expect(await attempt(tx, (t) => t.insert(insurances).values({ name: "W" }))).toBe("42501");
          expect(
            await attempt(tx, (t) =>
              t.insert(servicePrices).values({ serviceId: s.sPsych, insuranceId: null, priceCents: 1 }),
            ),
          ).toBe("42501");
        });
      },
    );

    it.each(["reception", "professional"] as const)(
      "%s com JWT aal1 também não escreve (42501)",
      async (who) => {
        await shared.run(async ({ tx, ids, as }) => {
          await as(ids[who], "aal1");
          expect(
            await attempt(tx, (t) =>
              t.insert(services).values({ name: "W", specialty: "dentistry", durationMinutes: 30 }),
            ),
          ).toBe("42501");
        });
      },
    );
  });

  describe("privilégios (catálogo do Postgres)", () => {
    it.each(["services", "insurances", "service_prices"])(
      "%s: anon não tem nada; authenticated só SELECT/INSERT/UPDATE; RLS ligada",
      async (table) => {
        await shared.run(async ({ tx, asOwner }) => {
          await asOwner();
          const [row] = await tx.execute<{
            anon: boolean;
            sel: boolean;
            ins: boolean;
            upd: boolean;
            del: boolean;
            trunc: boolean;
            refs: boolean;
            trg: boolean;
            rls: boolean;
            anonCols: boolean;
            refsCols: boolean;
          }>(sql`
            select
              has_table_privilege('anon', ${`public.${table}`}, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon,
              has_any_column_privilege('anon', ${`public.${table}`}, 'SELECT,INSERT,UPDATE,REFERENCES') as "anonCols",
              has_any_column_privilege('authenticated', ${`public.${table}`}, 'REFERENCES') as "refsCols",
              has_table_privilege('authenticated', ${`public.${table}`}, 'SELECT') as sel,
              has_table_privilege('authenticated', ${`public.${table}`}, 'INSERT') as ins,
              has_table_privilege('authenticated', ${`public.${table}`}, 'UPDATE') as upd,
              has_table_privilege('authenticated', ${`public.${table}`}, 'DELETE') as del,
              has_table_privilege('authenticated', ${`public.${table}`}, 'TRUNCATE') as trunc,
              has_table_privilege('authenticated', ${`public.${table}`}, 'REFERENCES') as refs,
              has_table_privilege('authenticated', ${`public.${table}`}, 'TRIGGER') as trg,
              (select relrowsecurity from pg_class where oid = ${`public.${table}`}::regclass) as rls`);
          expect(row).toEqual({
            anon: false,
            sel: true,
            ins: true,
            upd: true,
            del: false,
            trunc: false,
            refs: false,
            trg: false,
            rls: true,
            anonCols: false,
            refsCols: false,
          });
        });
      },
    );
  });
});
