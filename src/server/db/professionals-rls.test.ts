import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Tx } from "./client";
import { attempt, createRlsHarness, hasDb } from "./rls-harness";
import { professionalServices, professionals, profiles, services } from "./schema";

/**
 * RLS dos profissionais (cadastro e serviços que realizam) contra o Supabase DEV, só dados
 * fictícios, transações sempre revertidas. Regras (spec 1B-2a): admin lê e escreve tudo;
 * recepção lê os não removidos e não escreve; profissional lê SÓ o próprio cadastro (nunca
 * colegas); só admin grava; sem DELETE em `professionals`; DELETE em `professional_services`
 * só do admin; `aal1` não passa; sem perfil, inativo ou removido não vê nada. As FKs compostas
 * impedem perfil sem papel `professional` e serviço de outra especialidade.
 */
describe.skipIf(!hasDb)("RLS dos profissionais (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  // Cenário montado UMA vez por arquivo; cada teste roda num savepoint desfeito (ver `rls-harness.ts`).
  const shared = harness.shared((tx, ids) => seed(tx, ids));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  type Seed = {
    pA: string; // fisioterapia, vinculado a ids.professional, com 1 serviço
    pB: string; // fisioterapia, vinculado a ids.professional2, com 1 serviço
    pOpen: string; // odontologia, sem login, ativo
    pRemoved: string; // odontologia, removido (deleted_at), sem login
    sPhysio: string; // serviço de fisioterapia
    sPhysio2: string; // outro serviço de fisioterapia (sem ligação)
    sDental: string; // serviço de odontologia
    sRemoved: string; // serviço de fisioterapia removido
  };

  async function seed(tx: Tx, ids: { professional: string; professional2: string }): Promise<Seed> {
    const [sPhysio] = await tx
      .insert(services)
      .values({ name: "[teste] Fisio", specialty: "physiotherapy", durationMinutes: 50 })
      .returning({ id: services.id });
    const [sPhysio2] = await tx
      .insert(services)
      .values({ name: "[teste] Fisio 2", specialty: "physiotherapy", durationMinutes: 30 })
      .returning({ id: services.id });
    const [sDental] = await tx
      .insert(services)
      .values({ name: "[teste] Limpeza", specialty: "dentistry", durationMinutes: 40 })
      .returning({ id: services.id });
    const [sRemoved] = await tx
      .insert(services)
      .values({ name: "[teste] Fisio antigo", specialty: "physiotherapy", durationMinutes: 20, deletedAt: new Date() })
      .returning({ id: services.id });
    const [pA] = await tx
      .insert(professionals)
      .values({
        fullName: "[teste] Ana Fisio",
        specialty: "physiotherapy",
        registration: "CREFITO 12345",
        phone: "11912345678",
        email: "ana@teste.invalid",
        profileId: ids.professional,
      })
      .returning({ id: professionals.id });
    const [pB] = await tx
      .insert(professionals)
      .values({ fullName: "[teste] Bia Fisio", specialty: "physiotherapy", profileId: ids.professional2 })
      .returning({ id: professionals.id });
    const [pOpen] = await tx
      .insert(professionals)
      .values({ fullName: "[teste] Caio Dentista", specialty: "dentistry" })
      .returning({ id: professionals.id });
    const [pRemoved] = await tx
      .insert(professionals)
      .values({ fullName: "[teste] Davi Antigo", specialty: "dentistry", deletedAt: new Date() })
      .returning({ id: professionals.id });
    await tx.insert(professionalServices).values([
      { professionalId: pA!.id, serviceId: sPhysio!.id, specialty: "physiotherapy" },
      { professionalId: pB!.id, serviceId: sPhysio!.id, specialty: "physiotherapy" },
    ]);
    return {
      pA: pA!.id,
      pB: pB!.id,
      pOpen: pOpen!.id,
      pRemoved: pRemoved!.id,
      sPhysio: sPhysio!.id,
      sPhysio2: sPhysio2!.id,
      sDental: sDental!.id,
      sRemoved: sRemoved!.id,
    };
  }

  const sorted = (list: string[]) => [...list].sort();
  const seenProfessionals = async (tx: Tx, s: Seed) =>
    sorted(
      (
        await tx
          .select({ id: professionals.id })
          .from(professionals)
          .where(inArray(professionals.id, [s.pA, s.pB, s.pOpen, s.pRemoved]))
      ).map((r) => r.id),
    );
  const seenLinks = async (tx: Tx, s: Seed) =>
    (
      await tx
        .select({ p: professionalServices.professionalId })
        .from(professionalServices)
        .where(inArray(professionalServices.professionalId, [s.pA, s.pB, s.pOpen, s.pRemoved]))
    )
      .map((r) => r.p)
      .sort();

  describe("professionals: leitura", () => {
    it("admin lê todos, inclusive o removido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await seenProfessionals(tx, s)).toEqual(sorted([s.pA, s.pB, s.pOpen, s.pRemoved]));
      });
    });

    it("recepção lê todos os não removidos", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await seenProfessionals(tx, s)).toEqual(sorted([s.pA, s.pB, s.pOpen]));
      });
    });

    it("profissional lê SÓ o próprio cadastro, nunca o de colegas", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await seenProfessionals(tx, s)).toEqual([s.pA]);
        await as(ids.professional2);
        expect(await seenProfessionals(tx, s)).toEqual([s.pB]);
      });
    });

    it("profissional sem cadastro vinculado, ou com o cadastro removido, não lê nada", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.update(professionals).set({ profileId: null }).where(eq(professionals.id, s.pB));
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.pA));
        await as(ids.professional2); // perfil existe, mas nenhum cadastro aponta para ele
        expect(await seenProfessionals(tx, s)).toEqual([]);
        await as(ids.professional); // o cadastro dele foi removido
        expect(await seenProfessionals(tx, s)).toEqual([]);
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)(
      "usuário %s (sem perfil, inativo ou removido) não lê nada",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(await seenProfessionals(tx, s)).toEqual([]);
        });
      },
    );

    it.each(["admin", "reception", "professional"] as const)("%s com JWT aal1 não lê nada", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await seenProfessionals(tx, s)).toEqual([]);
      });
    });

    it("o contato do próprio profissional vem junto, o dos colegas não", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        const rows = await tx
          .select({ id: professionals.id, phone: professionals.phone, email: professionals.email })
          .from(professionals)
          .where(inArray(professionals.id, [s.pA, s.pB]));
        expect(rows).toEqual([{ id: s.pA, phone: "11912345678", email: "ana@teste.invalid" }]);
      });
    });
  });

  describe("professionals: escrita (só admin)", () => {
    const novo = { fullName: "[teste] Eva Psico", specialty: "psychology" } as const;

    it("admin cria, edita e faz exclusão lógica", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        const [created] = await tx.insert(professionals).values(novo).returning({ id: professionals.id });
        expect(created?.id).toBeTruthy();
        const edited = await tx
          .update(professionals)
          .set({ registration: "CRP 06/99999" })
          .where(eq(professionals.id, s.pOpen))
          .returning({ id: professionals.id });
        expect(edited).toHaveLength(1);
        const removed = await tx
          .update(professionals)
          .set({ deletedAt: new Date(), profileId: null })
          .where(eq(professionals.id, s.pB))
          .returning({ id: professionals.id });
        expect(removed).toHaveLength(1);
        await as(ids.reception);
        expect(await seenProfessionals(tx, s)).toEqual(sorted([s.pA, s.pOpen]));
      });
    });

    it.each(["reception", "professional"] as const)(
      "%s não cria (42501) nem edita (0 linhas); o dado não muda",
      async (who) => {
        await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
          await as(ids[who]);
          expect(await attempt(tx, (t) => t.insert(professionals).values(novo))).toBe("42501");
          const changed = await tx
            .update(professionals)
            .set({ fullName: "[teste] Hackeado", active: false })
            .where(inArray(professionals.id, [s.pA, s.pB, s.pOpen]))
            .returning({ id: professionals.id });
          expect(changed).toEqual([]);
          await asOwner();
          const [row] = await tx.select().from(professionals).where(eq(professionals.id, s.pA));
          expect(row?.fullName).toBe("[teste] Ana Fisio");
          expect(row?.active).toBe(true);
        });
      },
    );

    it.each(["stranger", "inactive", "deleted"] as const)("usuário %s não escreve (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids[who]);
        expect(await attempt(tx, (t) => t.insert(professionals).values(novo))).toBe("42501");
      });
    });

    it("admin com aal1 não escreve", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin, "aal1");
        expect(await attempt(tx, (t) => t.insert(professionals).values(novo))).toBe("42501");
        const changed = await tx
          .update(professionals)
          .set({ active: false })
          .where(eq(professionals.id, s.pA))
          .returning({ id: professionals.id });
        expect(changed).toEqual([]);
      });
    });

    it("nem o admin apaga um profissional (sem DELETE): 42501", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (t) => t.delete(professionals).where(eq(professionals.id, s.pOpen)))).toBe("42501");
      });
    });

    it.each(["reception", "professional"] as const)(
      "%s recebe SEMPRE 42501 ao escrever, mesmo com duplicata, valor inválido ou vínculo escondido (nada vaza por erro de constraint)",
      async (who) => {
        await shared.run(async ({ tx, ids, as }) => {
          await as(ids[who]);
          const cases: Array<(t: Tx) => Promise<unknown>> = [
            (t) => t.insert(professionals).values({ fullName: "[teste] Ana Fisio", specialty: "physiotherapy" }), // duplicata
            (t) => t.insert(professionals).values({ fullName: "  ", specialty: "psychology" }), // nome inválido
            (t) => t.insert(professionals).values({ ...novo, phone: "abc" }), // telefone inválido
            (t) => t.insert(professionals).values({ ...novo, profileId: ids.professional }), // perfil já vinculado a outro
            (t) => t.insert(professionals).values({ ...novo, profileId: ids.reception }), // perfil sem papel professional
            (t) =>
              t
                .insert(professionals)
                .values({ fullName: "[teste] Ana Fisio", specialty: "physiotherapy" })
                .onConflictDoNothing(),
          ];
          for (const run of cases) expect(await attempt(tx, run)).toBe("42501");
        });
      },
    );
  });

  describe("professionals: regras do banco (checks, únicos e vínculo)", () => {
    const base = { fullName: "[teste] Novo", specialty: "psychology" } as const;

    it.each([
      ["nome vazio", { fullName: "" }],
      ["nome só com espaços", { fullName: "   " }],
      ["nome com espaço na ponta", { fullName: " Fulano" }],
      ["nome com tabulação na ponta", { fullName: "Fulano\t" }],
      ["nome com 121 caracteres", { fullName: "a".repeat(121) }],
      ["registro com 2 caracteres", { registration: "12" }],
      ["registro com 31 caracteres", { registration: "1".repeat(31) }],
      ["registro com espaço na ponta", { registration: "123 " }],
      ["telefone com letras", { phone: "11abc345678" }],
      ["telefone curto", { phone: "119123456" }],
      ["telefone com máscara", { phone: "(11) 91234-5678" }],
      ["e-mail sem arroba", { email: "maria.teste.invalid" }],
      ["e-mail com espaço", { email: "ma ria@teste.invalid" }],
      ["e-mail com 255 caracteres", { email: `${"a".repeat(245)}@teste.com` }],
    ])("recusa %s (23514)", async (_label, over) => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids.admin);
        expect(await attempt(tx, (t) => t.insert(professionals).values({ ...base, ...over }))).toBe("23514");
      });
    });

    it("aceita os limites exatos e os campos opcionais vazios", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids.admin);
        for (const over of [
          { fullName: "n".repeat(120) },
          { fullName: "Reg 3", registration: "123" },
          { fullName: "Reg 30", registration: "1".repeat(30) },
          { fullName: "Tel 10", phone: "1134567890" },
          { fullName: "Tel 11", phone: "11912345678" },
        ]) {
          expect(await attempt(tx, (t) => t.insert(professionals).values({ ...base, ...over }))).toBeUndefined();
        }
      });
    });

    it("mesmo nome na mesma especialidade (sem diferenciar maiúsculas) é recusado (23505); em outra vale; removido libera o nome", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(
          await attempt(tx, (t) =>
            t.insert(professionals).values({ fullName: "[TESTE] ANA FISIO", specialty: "physiotherapy" }),
          ),
        ).toBe("23505");
        expect(
          await attempt(tx, (t) =>
            t.insert(professionals).values({ fullName: "[teste] Ana Fisio", specialty: "psychology" }),
          ),
        ).toBeUndefined();
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.pA));
        expect(
          await attempt(tx, (t) =>
            t.insert(professionals).values({ fullName: "[teste] Ana Fisio", specialty: "physiotherapy" }),
          ),
        ).toBeUndefined();
      });
    });

    it("o login (perfil) só pode estar em UM profissional não removido; libera depois de remover", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(
          await attempt(tx, (t) => t.insert(professionals).values({ ...base, profileId: ids.professional })),
        ).toBe("23505");
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.pA));
        expect(
          await attempt(tx, (t) => t.insert(professionals).values({ ...base, profileId: ids.professional })),
        ).toBeUndefined();
      });
    });

    it("só dá para vincular um perfil com papel 'professional' (FK composta): recepção, admin e inexistente dão 23503", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids.admin);
        for (const profileId of [ids.reception, ids.admin, "00000000-0000-4000-8000-000000000000"]) {
          expect(await attempt(tx, (t) => t.insert(professionals).values({ ...base, profileId }))).toBe("23503");
        }
      });
    });

    it("link_role não pode ser trocado para fugir da regra (23514)", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids.admin);
        expect(
          await attempt(tx, (t) =>
            t.insert(professionals).values({ ...base, profileId: ids.reception, linkRole: "reception" }),
          ),
        ).toBe("23514");
      });
    });

    it("não dá para mudar o papel de um perfil que está vinculado a um profissional (23503), nem apagá-lo", async () => {
      await shared.run(async ({ tx, ids, asOwner }) => {
        await asOwner();
        expect(
          await attempt(tx, (t) => t.update(profiles).set({ role: "reception" }).where(eq(profiles.id, ids.professional))),
        ).toBe("23503");
        expect(await attempt(tx, (t) => t.delete(profiles).where(eq(profiles.id, ids.professional)))).toBe("23503");
      });
    });

    it("um profissional REMOVIDO não pode manter o login vinculado (23514): a remoção libera o perfil", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(
          await attempt(tx, (t) => t.update(professionals).set({ deletedAt: new Date() }).where(eq(professionals.id, s.pA))),
        ).toBe("23514");
        expect(
          await attempt(tx, (t) =>
            t.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.pA)),
          ),
        ).toBeUndefined();
      });
    });

    it("com o login liberado, o papel do perfil pode mudar (a remoção não deixa o perfil preso)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.admin);
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.pA));
        await asOwner();
        expect(
          await attempt(tx, (t) => t.update(profiles).set({ role: "reception" }).where(eq(profiles.id, ids.professional))),
        ).toBeUndefined();
      });
    });

    it("profissional que perde o perfil (desativado depois de vinculado) deixa de ler o próprio cadastro e as ligações", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional);
        expect(await seenProfessionals(tx, s)).toEqual([s.pA]);
        await asOwner();
        await tx.update(profiles).set({ active: false }).where(eq(profiles.id, ids.professional));
        await as(ids.professional);
        expect(await seenProfessionals(tx, s)).toEqual([]);
        expect(await seenLinks(tx, s)).toEqual([]);
      });
    });

    it("desvincular e vincular de novo funciona", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        await tx.update(professionals).set({ profileId: null }).where(eq(professionals.id, s.pA));
        expect(
          await attempt(tx, (t) => t.update(professionals).set({ profileId: ids.professional }).where(eq(professionals.id, s.pOpen))),
        ).toBeUndefined();
      });
    });
  });

  describe("professional_services", () => {
    it("admin lê todas as ligações", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await seenLinks(tx, s)).toEqual(sorted([s.pA, s.pB]));
      });
    });

    it("recepção lê as ligações de profissionais e serviços não removidos", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.reception);
        expect(await seenLinks(tx, s)).toEqual(sorted([s.pA, s.pB]));
        await asOwner();
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.pB));
        await as(ids.reception);
        expect(await seenLinks(tx, s)).toEqual([s.pA]);
        await asOwner();
        await tx.update(services).set({ deletedAt: new Date() }).where(eq(services.id, s.sPhysio));
        await as(ids.reception);
        expect(await seenLinks(tx, s)).toEqual([]);
      });
    });

    it("profissional lê SÓ as ligações do próprio cadastro", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await seenLinks(tx, s)).toEqual([s.pA]);
        await as(ids.professional2);
        expect(await seenLinks(tx, s)).toEqual([s.pB]);
      });
    });

    it("profissional não vê a ligação a um serviço REMOVIDO (igual à recepção)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.update(services).set({ deletedAt: new Date() }).where(eq(services.id, s.sPhysio));
        await as(ids.professional);
        expect(await seenLinks(tx, s)).toEqual([]);
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)("usuário %s não lê nada", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await seenLinks(tx, s)).toEqual([]);
      });
    });

    it.each(["admin", "reception", "professional"] as const)("%s com aal1 não lê nada", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await seenLinks(tx, s)).toEqual([]);
      });
    });

    it("admin liga e desliga serviços", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        // (insert direto, não `attempt`: ele desfaz o que fez, e o DELETE abaixo precisa da linha)
        await tx
          .insert(professionalServices)
          .values({ professionalId: s.pA, serviceId: s.sPhysio2, specialty: "physiotherapy" });
        expect(await seenLinks(tx, s)).toEqual(sorted([s.pA, s.pA, s.pB]));
        const removed = await tx
          .delete(professionalServices)
          .where(eq(professionalServices.serviceId, s.sPhysio2))
          .returning({ p: professionalServices.professionalId });
        expect(removed).toHaveLength(1);
      });
    });

    it.each(["reception", "professional"] as const)(
      "%s não liga (42501) nem desliga (0 linhas); nada muda",
      async (who) => {
        await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
          await as(ids[who]);
          expect(
            await attempt(tx, (t) =>
              t.insert(professionalServices).values({ professionalId: s.pA, serviceId: s.sPhysio2, specialty: "physiotherapy" }),
            ),
          ).toBe("42501");
          const removed = await tx
            .delete(professionalServices)
            .where(inArray(professionalServices.professionalId, [s.pA, s.pB]))
            .returning({ p: professionalServices.professionalId });
          expect(removed).toEqual([]);
          await asOwner();
          expect(await seenLinks(tx, s)).toEqual(sorted([s.pA, s.pB]));
        });
      },
    );

    it("admin com aal1 não liga nem desliga", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin, "aal1");
        expect(
          await attempt(tx, (t) =>
            t.insert(professionalServices).values({ professionalId: s.pA, serviceId: s.sPhysio2, specialty: "physiotherapy" }),
          ),
        ).toBe("42501");
        const removed = await tx
          .delete(professionalServices)
          .where(eq(professionalServices.professionalId, s.pA))
          .returning({ p: professionalServices.professionalId });
        expect(removed).toEqual([]);
      });
    });

    it("ninguém atualiza uma ligação (sem UPDATE)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(
          await attempt(tx, (t) =>
            t.update(professionalServices).set({ serviceId: s.sPhysio2 }).where(eq(professionalServices.professionalId, s.pA)),
          ),
        ).toBe("42501");
      });
    });

    it("serviço de OUTRA especialidade é recusado pelo banco (23503), mesmo para o admin", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        // o serviço é de odontologia, o profissional é de fisioterapia (declarando qualquer das duas especialidades)
        for (const specialty of ["physiotherapy", "dentistry"] as const) {
          expect(
            await attempt(tx, (t) =>
              t.insert(professionalServices).values({ professionalId: s.pA, serviceId: s.sDental, specialty }),
            ),
          ).toBe("23503");
        }
      });
    });

    it("não liga a profissional ou serviço REMOVIDO nem inexistente (42501, política)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        const missing = "00000000-0000-4000-8000-000000000000";
        const bad = [
          { professionalId: s.pRemoved, serviceId: s.sDental, specialty: "dentistry" },
          { professionalId: s.pA, serviceId: s.sRemoved, specialty: "physiotherapy" },
          { professionalId: missing, serviceId: s.sDental, specialty: "dentistry" },
          { professionalId: s.pA, serviceId: missing, specialty: "physiotherapy" },
        ] as const;
        for (const row of bad) {
          expect(await attempt(tx, (t) => t.insert(professionalServices).values(row))).toBe("42501");
        }
      });
    });

    it("não liga o mesmo serviço duas vezes (23505)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(
          await attempt(tx, (t) =>
            t.insert(professionalServices).values({ professionalId: s.pA, serviceId: s.sPhysio, specialty: "physiotherapy" }),
          ),
        ).toBe("23505");
      });
    });

    it("trocar a especialidade do profissional ou do serviço com ligações é recusado (23503)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(
          await attempt(tx, (t) => t.update(professionals).set({ specialty: "psychology" }).where(eq(professionals.id, s.pA))),
        ).toBe("23503");
        expect(
          await attempt(tx, (t) => t.update(services).set({ specialty: "dentistry" }).where(eq(services.id, s.sPhysio))),
        ).toBe("23503");
      });
    });

    it("trocar a especialidade funciona depois de desligar os serviços (o que o app faz, na mesma transação)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        await tx.delete(professionalServices).where(eq(professionalServices.professionalId, s.pA));
        expect(
          await attempt(tx, (t) => t.update(professionals).set({ specialty: "psychology" }).where(eq(professionals.id, s.pA))),
        ).toBeUndefined();
      });
    });

    it("não dá para apagar (nem como dono) profissional ou serviço que tem ligações (restrict)", async () => {
      await shared.run(async ({ tx, asOwner, seed: s }) => {
        await asOwner();
        expect(await attempt(tx, (t) => t.delete(professionals).where(eq(professionals.id, s.pA)))).toBe("23503");
        expect(await attempt(tx, (t) => t.delete(services).where(eq(services.id, s.sPhysio)))).toBe("23503");
      });
    });
  });

  describe("privilégios (catálogo do Postgres)", () => {
    it.each([
      ["professionals", { sel: true, ins: true, upd: true, del: false }],
      ["professional_services", { sel: true, ins: true, upd: false, del: true }],
    ])("%s: anon não tem nada; authenticated só o previsto; sem TRUNCATE/REFERENCES/TRIGGER; RLS ligada", async (table, expected) => {
      await shared.run(async ({ tx, asOwner }) => {
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
            has_any_column_privilege('authenticated', ${`public.${table}`}, 'REFERENCES') as "refsCols",
            (select relrowsecurity from pg_class where oid = ${`public.${table}`}::regclass) as rls`);
        expect(row).toEqual({ anon: false, anonCols: false, ...expected, extra: false, refsCols: false, rls: true });
      });
    });
  });
});
