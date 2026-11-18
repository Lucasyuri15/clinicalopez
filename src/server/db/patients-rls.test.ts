import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Tx } from "./client";
import { attempt, createRlsHarness, hasDb } from "./rls-harness";
import {
  insurances,
  patientPrivate,
  patientProfessionals,
  patients,
  professionals,
  profiles,
} from "./schema";

/**
 * RLS do cadastro de pacientes (1B-3a) contra o Supabase DEV, só dados FICTÍCIOS, transações
 * sempre revertidas. Regras (spec 1B-3):
 *  - `patients` (clínico-básico): admin lê todos; recepção lê os não removidos; profissional lê SÓ
 *    os pacientes vinculados a ele (e não removidos); admin e recepção criam e editam; só o admin
 *    remove (soft delete); ninguém apaga fisicamente.
 *  - `patient_private` (CPF, endereço, convênio, responsável, observações): SÓ admin e recepção;
 *    o profissional nunca lê, nem de paciente dele.
 *  - `patient_professionals` (vínculo): admin e recepção leem e gravam; o profissional lê só os
 *    próprios vínculos (nunca os de colegas).
 *  - `aal1` não passa; sem perfil, inativo ou removido não vê nem escreve; escrita de quem não
 *    pode falha com 42501 ANTES de qualquer constraint (nada vaza por erro de duplicidade).
 */
describe.skipIf(!hasDb)("RLS de pacientes (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  beforeAll(() => harness.connect());
  afterAll(() => harness.close());

  type Seed = {
    pA: string; // profissional ligado a ids.professional
    pB: string; // profissional ligado a ids.professional2
    pRemoved: string; // profissional removido
    insuranceId: string;
    p1: string; // só de A
    p2: string; // só de B
    p3: string; // de A e de B
    p4: string; // sem vínculo
    p5: string; // REMOVIDO, de A
    p6: string; // INATIVO, de A
  };

  let cpfCounter = 0;
  /** CPFs fictícios só no formato (o banco confere 11 dígitos; os dígitos verificadores são do app). */
  const nextCpf = () => String(10_000_000_000 + ++cpfCounter + Math.floor(Math.random() * 1_000_000) * 100);

  async function seed(tx: Tx, ids: { professional: string; professional2: string }): Promise<Seed> {
    const [pA] = await tx
      .insert(professionals)
      .values({ fullName: "[teste] Ana Pac", specialty: "physiotherapy", profileId: ids.professional })
      .returning({ id: professionals.id });
    const [pB] = await tx
      .insert(professionals)
      .values({ fullName: "[teste] Bia Pac", specialty: "physiotherapy", profileId: ids.professional2 })
      .returning({ id: professionals.id });
    const [pRemoved] = await tx
      .insert(professionals)
      .values({ fullName: "[teste] Davi Pac", specialty: "dentistry", deletedAt: new Date() })
      .returning({ id: professionals.id });
    const [insurance] = await tx
      .insert(insurances)
      .values({ name: "[teste] Convênio Pac" })
      .returning({ id: insurances.id });

    const rows = await tx
      .insert(patients)
      .values([
        { fullName: "[teste] Paciente Um", birthDate: "1990-05-10", phone: "11912345678" },
        { fullName: "[teste] Paciente Dois", birthDate: "1985-03-02" },
        { fullName: "[teste] Paciente Tres", birthDate: "2001-12-31", email: "tres@teste.invalid" },
        { fullName: "[teste] Paciente Quatro", birthDate: "1970-01-01" },
        { fullName: "[teste] Paciente Cinco", birthDate: "1999-09-09", deletedAt: new Date() },
        { fullName: "[teste] Paciente Seis", birthDate: "1960-06-06", active: false },
      ])
      .returning({ id: patients.id });
    const [p1, p2, p3, p4, p5, p6] = rows.map((r) => r.id) as [string, string, string, string, string, string];

    await tx.insert(patientPrivate).values(
      [p1, p2, p3, p4, p5, p6].map((patientId, i) => ({
        patientId,
        cpf: i === 3 ? null : nextCpf(),
        noCpfReason: i === 3 ? "[teste] Estrangeiro" : null,
        street: "[teste] Rua Fictícia",
        insuranceId: i === 0 ? insurance!.id : null,
        insuranceCard: i === 0 ? "123456" : null,
        adminNotes: "[teste] observação administrativa",
      })),
    );
    await tx.insert(patientProfessionals).values([
      { patientId: p1, professionalId: pA!.id },
      { patientId: p2, professionalId: pB!.id },
      { patientId: p3, professionalId: pA!.id },
      { patientId: p3, professionalId: pB!.id },
      { patientId: p5, professionalId: pA!.id },
      { patientId: p6, professionalId: pA!.id },
    ]);
    return { pA: pA!.id, pB: pB!.id, pRemoved: pRemoved!.id, insuranceId: insurance!.id, p1, p2, p3, p4, p5, p6 };
  }

  const sorted = (list: string[]) => [...list].sort();
  const all = (s: Seed) => [s.p1, s.p2, s.p3, s.p4, s.p5, s.p6];
  const seenPatients = async (tx: Tx, s: Seed) =>
    sorted((await tx.select({ id: patients.id }).from(patients).where(inArray(patients.id, all(s)))).map((r) => r.id));
  const seenPrivate = async (tx: Tx, s: Seed) =>
    sorted(
      (await tx.select({ id: patientPrivate.patientId }).from(patientPrivate).where(inArray(patientPrivate.patientId, all(s)))).map(
        (r) => r.id,
      ),
    );
  /** Vínculos como "paciente|profissional", para comparar com clareza. */
  const seenLinks = async (tx: Tx, s: Seed) =>
    sorted(
      (await tx.select().from(patientProfessionals).where(inArray(patientProfessionals.patientId, all(s)))).map(
        (r) => `${r.patientId}|${r.professionalId}`,
      ),
    );
  const link = (patientId: string, professionalId: string) => `${patientId}|${professionalId}`;

  describe("leitura de patients (clínico-básico)", () => {
    it("admin lê todos, inclusive removido e inativo", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(await seenPatients(tx, s)).toEqual(sorted(all(s)));
      });
    });

    it("recepção lê todos os NÃO removidos (inclusive inativos)", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.reception);
        expect(await seenPatients(tx, s)).toEqual(sorted([s.p1, s.p2, s.p3, s.p4, s.p6]));
      });
    });

    it("profissional lê SÓ os pacientes vinculados a ele, nunca os de colegas, sem vínculo ou removidos", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual(sorted([s.p1, s.p3, s.p6])); // p5 removido some
        await as(ids.professional2);
        expect(await seenPatients(tx, s)).toEqual(sorted([s.p2, s.p3]));
      });
    });

    it("o vínculo é o que dá acesso: ao desfazer o vínculo, o paciente some; ao criar, aparece", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        await tx.delete(patientProfessionals).where(and(eq(patientProfessionals.patientId, s.p1), eq(patientProfessionals.professionalId, s.pA)));
        await tx.insert(patientProfessionals).values({ patientId: s.p4, professionalId: s.pA });
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual(sorted([s.p3, s.p4, s.p6]));
      });
    });

    it("profissional removido, desativado ou sem login vinculado não lê nenhum paciente", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await as(ids.professional);
        expect(await seenPatients(tx, s)).not.toEqual([]); // prova que o fixture existe
        await asOwner();
        await tx.update(professionals).set({ active: false }).where(eq(professionals.id, s.pA)); // desativado
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.pB)); // removido
        for (const who of [ids.professional, ids.professional2]) {
          await as(who);
          expect(await seenPatients(tx, s)).toEqual([]);
        }
        await asOwner();
        await tx.update(professionals).set({ active: true, profileId: null }).where(eq(professionals.id, s.pA)); // sem login
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual([]);
      });
    });

    it("profissional VINCULADO cujo perfil foi desativado ou removido depois deixa de ler", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        await tx.update(profiles).set({ active: false }).where(eq(profiles.id, ids.professional));
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual([]);
        await asOwner();
        await tx.update(profiles).set({ active: true, deletedAt: new Date() }).where(eq(profiles.id, ids.professional));
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual([]);
      });
    });

    it("admin e recepção com perfil DESATIVADO ou REMOVIDO deixam de ler (o papel some)", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(await seenPatients(tx, s)).not.toEqual([]);
        await asOwner();
        await tx.update(profiles).set({ active: false }).where(eq(profiles.id, ids.admin));
        await as(ids.admin);
        expect(await seenPatients(tx, s)).toEqual([]);
        await asOwner();
        await tx.update(profiles).set({ active: true, deletedAt: new Date() }).where(eq(profiles.id, ids.admin));
        await as(ids.admin);
        expect(await seenPatients(tx, s)).toEqual([]);
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)(
      "usuário %s (sem perfil, inativo ou removido) não lê nada",
      async (who) => {
        await harness.inTx(async ({ tx, ids, as }) => {
          const s = await seed(tx, ids);
          await as(ids[who]);
          expect(await seenPatients(tx, s)).toEqual([]);
          expect(await seenPrivate(tx, s)).toEqual([]);
          expect(await seenLinks(tx, s)).toEqual([]);
        });
      },
    );

    it.each(["admin", "reception", "professional"] as const)("%s com JWT aal1 não lê nada", async (who) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids[who], "aal1");
        expect(await seenPatients(tx, s)).toEqual([]);
        expect(await seenPrivate(tx, s)).toEqual([]);
        expect(await seenLinks(tx, s)).toEqual([]);
      });
    });
  });

  describe("leitura de patient_private (CPF, endereço, convênio, responsável, observações)", () => {
    it("admin lê tudo; recepção lê dos não removidos", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(await seenPrivate(tx, s)).toEqual(sorted(all(s)));
        await as(ids.reception);
        expect(await seenPrivate(tx, s)).toEqual(sorted([s.p1, s.p2, s.p3, s.p4, s.p6]));
      });
    });

    it("o PROFISSIONAL nunca lê dados administrativos, nem dos pacientes vinculados a ele", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual(sorted([s.p1, s.p3, s.p6])); // vê o básico...
        expect(await seenPrivate(tx, s)).toEqual([]); // ...e NADA do administrativo
        // nem por junção, nem lendo colunas específicas, nem por contagem
        const joined = await tx
          .select({ cpf: patientPrivate.cpf })
          .from(patients)
          .innerJoin(patientPrivate, eq(patientPrivate.patientId, patients.id));
        expect(joined).toEqual([]);
        const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(patientPrivate);
        expect(count?.n).toBe(0);
      });
    });
  });

  describe("leitura de patient_professionals (vínculos)", () => {
    it("admin lê todos; recepção lê os de paciente e profissional NÃO removidos", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        await tx.insert(patientProfessionals).values({ patientId: s.p4, professionalId: s.pRemoved });
        await as(ids.admin);
        expect(await seenLinks(tx, s)).toEqual(
          sorted([
            link(s.p1, s.pA),
            link(s.p2, s.pB),
            link(s.p3, s.pA),
            link(s.p3, s.pB),
            link(s.p5, s.pA),
            link(s.p6, s.pA),
            link(s.p4, s.pRemoved),
          ]),
        );
        await as(ids.reception);
        expect(await seenLinks(tx, s)).toEqual(
          sorted([link(s.p1, s.pA), link(s.p2, s.pB), link(s.p3, s.pA), link(s.p3, s.pB), link(s.p6, s.pA)]),
        );
      });
    });

    it("profissional lê SÓ os próprios vínculos: nem o de colega no MESMO paciente, nem de paciente removido", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.professional);
        expect(await seenLinks(tx, s)).toEqual(sorted([link(s.p1, s.pA), link(s.p3, s.pA), link(s.p6, s.pA)]));
        await as(ids.professional2);
        expect(await seenLinks(tx, s)).toEqual(sorted([link(s.p2, s.pB), link(s.p3, s.pB)]));
      });
    });
  });

  describe("escrita em patients", () => {
    const novo = (over: Partial<typeof patients.$inferInsert> = {}) => ({
      fullName: "[teste] Novo Paciente",
      birthDate: "1995-01-01",
      ...over,
    });

    it.each(["admin", "reception"] as const)("%s cria e edita pacientes", async (who) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids[who]);
        const [created] = await tx.insert(patients).values(novo()).returning({ id: patients.id });
        expect(created?.id).toBeTruthy();
        const edited = await tx
          .update(patients)
          .set({ fullName: "[teste] Nome Editado", active: false })
          .where(eq(patients.id, s.p1))
          .returning({ id: patients.id });
        expect(edited).toHaveLength(1);
      });
    });

    it("o profissional não cria (42501) nem edita (0 linhas), nem o paciente vinculado a ele", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await as(ids.professional);
        expect(await attempt(tx, (x) => x.insert(patients).values(novo()))).toBe("42501");
        const edited = await tx.update(patients).set({ fullName: "[teste] Invasor" }).where(eq(patients.id, s.p1)).returning({ id: patients.id });
        expect(edited).toEqual([]);
        await asOwner();
        const [row] = await tx.select({ name: patients.fullName }).from(patients).where(eq(patients.id, s.p1));
        expect(row?.name).toBe("[teste] Paciente Um");
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)("usuário %s não escreve (42501)", async (who) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        await seed(tx, ids);
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.insert(patients).values(novo()))).toBe("42501");
      });
    });

    it.each(["admin", "reception"] as const)("%s com aal1 não escreve", async (who) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids[who], "aal1");
        expect(await attempt(tx, (x) => x.insert(patients).values(novo()))).toBe("42501");
        const edited = await tx.update(patients).set({ fullName: "[teste] x" }).where(eq(patients.id, s.p1)).returning({ id: patients.id });
        expect(edited).toEqual([]);
      });
    });

    it("SÓ o admin remove (soft delete) e restaura; a recepção recebe 42501 e não edita removido", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.reception);
        expect(await attempt(tx, (x) => x.update(patients).set({ deletedAt: new Date() }).where(eq(patients.id, s.p1)))).toBe("42501");
        const touchRemoved = await tx.update(patients).set({ fullName: "[teste] x" }).where(eq(patients.id, s.p5)).returning({ id: patients.id });
        expect(touchRemoved).toEqual([]); // removido não é visível: 0 linhas
        const restore = await tx.update(patients).set({ deletedAt: null }).where(eq(patients.id, s.p5)).returning({ id: patients.id });
        expect(restore).toEqual([]);

        await as(ids.admin);
        const removed = await tx.update(patients).set({ deletedAt: new Date() }).where(eq(patients.id, s.p1)).returning({ id: patients.id });
        expect(removed).toHaveLength(1);
        const restored = await tx.update(patients).set({ deletedAt: null }).where(eq(patients.id, s.p5)).returning({ id: patients.id });
        expect(restored).toHaveLength(1);
      });
    });

    it("ninguém apaga fisicamente, nem o admin (sem privilégio DELETE: 42501)", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        for (const who of [ids.admin, ids.reception, ids.professional]) {
          await as(who);
          expect(await attempt(tx, (x) => x.delete(patients).where(eq(patients.id, s.p1)))).toBe("42501");
          expect(await attempt(tx, (x) => x.delete(patientPrivate).where(eq(patientPrivate.patientId, s.p1)))).toBe("42501");
        }
      });
    });
  });

  describe("escrita em patient_private", () => {
    const newPatient = async (tx: Tx) => {
      const [row] = await tx.insert(patients).values({ fullName: "[teste] Sem Privado", birthDate: "1992-02-02" }).returning({ id: patients.id });
      return row!.id;
    };

    it.each(["admin", "reception"] as const)("%s cria e edita os dados administrativos", async (who) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids[who]);
        const id = await newPatient(tx);
        await tx.insert(patientPrivate).values({ patientId: id, cpf: nextCpf() });
        const edited = await tx.update(patientPrivate).set({ street: "[teste] Rua Nova" }).where(eq(patientPrivate.patientId, s.p1)).returning({ id: patientPrivate.patientId });
        expect(edited).toHaveLength(1);
      });
    });

    it("o profissional não grava (42501) nem edita (0 linhas) dados administrativos, nem de paciente dele", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        const id = await newPatient(tx);
        await tx.insert(patientProfessionals).values({ patientId: id, professionalId: s.pA });
        await as(ids.professional);
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values({ patientId: id, cpf: nextCpf() }))).toBe("42501");
        const edited = await tx.update(patientPrivate).set({ street: "[teste] Invasor" }).where(eq(patientPrivate.patientId, s.p1)).returning({ id: patientPrivate.patientId });
        expect(edited).toEqual([]);
      });
    });

    it("a escrita de quem não pode falha com 42501 ANTES do CPF duplicado: nada vaza por constraint", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        const [existing] = await tx.select({ cpf: patientPrivate.cpf }).from(patientPrivate).where(eq(patientPrivate.patientId, s.p2));
        const id = await newPatient(tx);
        await as(ids.professional);
        // CPF do paciente p2 (que este profissional nem vê): continua 42501, não 23505
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values({ patientId: id, cpf: existing!.cpf }))).toBe("42501");
      });
    });

    it("CPF duplicado é recusado (23505), inclusive de paciente removido; o CPF é único para todos", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        const [active] = await tx.select({ cpf: patientPrivate.cpf }).from(patientPrivate).where(eq(patientPrivate.patientId, s.p2));
        const [removed] = await tx.select({ cpf: patientPrivate.cpf }).from(patientPrivate).where(eq(patientPrivate.patientId, s.p5));
        const id = await newPatient(tx);
        await as(ids.reception);
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values({ patientId: id, cpf: active!.cpf }))).toBe("23505");
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values({ patientId: id, cpf: removed!.cpf }))).toBe("23505");
        expect(await attempt(tx, (x) => x.update(patientPrivate).set({ cpf: active!.cpf }).where(eq(patientPrivate.patientId, s.p1)))).toBe("23505");
      });
    });

    it("recepção não cria dados administrativos de paciente REMOVIDO (42501) nem os edita (0 linhas); o admin edita", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        await tx.delete(patientPrivate).where(eq(patientPrivate.patientId, s.p5));
        await as(ids.reception);
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values({ patientId: s.p5, cpf: nextCpf() }))).toBe("42501");
        await asOwner();
        await tx.insert(patientPrivate).values({ patientId: s.p5, cpf: nextCpf() });
        await as(ids.reception);
        const byReception = await tx.update(patientPrivate).set({ street: "[teste] x" }).where(eq(patientPrivate.patientId, s.p5)).returning({ id: patientPrivate.patientId });
        expect(byReception).toEqual([]);
        await as(ids.admin);
        const byAdmin = await tx.update(patientPrivate).set({ street: "[teste] x" }).where(eq(patientPrivate.patientId, s.p5)).returning({ id: patientPrivate.patientId });
        expect(byAdmin).toHaveLength(1);
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)("usuário %s não escreve (42501)", async (who) => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        await seed(tx, ids);
        await asOwner();
        const id = await newPatient(tx);
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values({ patientId: id, cpf: nextCpf() }))).toBe("42501");
      });
    });

    it.each(["admin", "reception"] as const)(
      "%s não troca a chave: nem o patient_id (mover dados para outro paciente) nem o id do paciente (42501)",
      async (who) => {
        await harness.inTx(async ({ tx, ids, as, asOwner }) => {
          const s = await seed(tx, ids);
          await asOwner();
          const fresh = await newPatient(tx);
          await as(ids[who]);
          expect(await attempt(tx, (x) => x.update(patientPrivate).set({ patientId: fresh }).where(eq(patientPrivate.patientId, s.p1)))).toBe("42501");
          expect(await attempt(tx, (x) => x.update(patients).set({ id: fresh }).where(eq(patients.id, s.p1)))).toBe("42501");
          expect(await attempt(tx, (x) => x.update(patients).set({ createdAt: new Date(0) }).where(eq(patients.id, s.p1)))).toBe("42501");
        });
      },
    );
  });

  describe("escrita em patient_professionals", () => {
    it.each(["admin", "reception"] as const)("%s cria e apaga vínculos", async (who) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids[who]);
        await tx.insert(patientProfessionals).values({ patientId: s.p4, professionalId: s.pA });
        const gone = await tx
          .delete(patientProfessionals)
          .where(and(eq(patientProfessionals.patientId, s.p1), eq(patientProfessionals.professionalId, s.pA)))
          .returning({ id: patientProfessionals.patientId });
        expect(gone).toHaveLength(1);
      });
    });

    it("o profissional não vincula (42501) nem desvincula (0 linhas), nem o próprio vínculo", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await as(ids.professional);
        expect(await attempt(tx, (x) => x.insert(patientProfessionals).values({ patientId: s.p4, professionalId: s.pA }))).toBe("42501");
        const gone = await tx.delete(patientProfessionals).where(inArray(patientProfessionals.patientId, all(s))).returning({ id: patientProfessionals.patientId });
        expect(gone).toEqual([]);
        await asOwner();
        expect(await seenLinks(tx, s)).toHaveLength(6);
      });
    });

    it("não vincula profissional removido, desativado ou inexistente, nem paciente removido (42501)", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await asOwner();
        await tx.update(professionals).set({ active: false }).where(eq(professionals.id, s.pB));
        for (const who of [ids.admin, ids.reception]) {
          await as(who);
          const missing = "00000000-0000-4000-8000-000000000000";
          for (const professionalId of [s.pRemoved, s.pB, missing]) {
            expect(await attempt(tx, (x) => x.insert(patientProfessionals).values({ patientId: s.p4, professionalId }))).toBe("42501");
          }
          expect(await attempt(tx, (x) => x.insert(patientProfessionals).values({ patientId: s.p5, professionalId: s.pA }))).toBe("42501");
        }
      });
    });

    it("vínculo repetido é recusado para quem pode escrever (23505)", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.reception);
        expect(await attempt(tx, (x) => x.insert(patientProfessionals).values({ patientId: s.p1, professionalId: s.pA }))).toBe("23505");
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)("usuário %s não escreve (42501)", async (who) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.insert(patientProfessionals).values({ patientId: s.p4, professionalId: s.pA }))).toBe("42501");
      });
    });

    it("admin com aal1 não escreve nem apaga", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin, "aal1");
        expect(await attempt(tx, (x) => x.insert(patientProfessionals).values({ patientId: s.p4, professionalId: s.pA }))).toBe("42501");
        const gone = await tx.delete(patientProfessionals).where(eq(patientProfessionals.patientId, s.p1)).returning({ id: patientProfessionals.patientId });
        expect(gone).toEqual([]);
      });
    });

    it("ninguém atualiza vínculo (sem UPDATE): 42501", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.update(patientProfessionals).set({ professionalId: s.pB }).where(eq(patientProfessionals.patientId, s.p1)))).toBe("42501");
      });
    });
  });

  describe("endurecimentos da revisão independente", () => {
    const other = () => ({ fullName: "[teste] Outro", birthDate: "1991-01-01" });

    it.each(["admin", "reception"] as const)(
      "%s com aal1 não escreve em patient_private: CPF duplicado dá 42501 (não 23505) e o UPDATE afeta 0 linhas",
      async (who) => {
        await harness.inTx(async ({ tx, ids, as, asOwner }) => {
          const s = await seed(tx, ids);
          await asOwner();
          const [taken] = await tx.select({ cpf: patientPrivate.cpf }).from(patientPrivate).where(eq(patientPrivate.patientId, s.p2));
          const [fresh] = await tx.insert(patients).values(other()).returning({ id: patients.id });
          await as(ids[who], "aal1");
          expect(await attempt(tx, (x) => x.insert(patientPrivate).values({ patientId: fresh!.id, cpf: taken!.cpf }))).toBe("42501");
          const edited = await tx.update(patientPrivate).set({ street: "[teste] x" }).where(eq(patientPrivate.patientId, s.p1)).returning({ id: patientPrivate.patientId });
          expect(edited).toEqual([]);
        });
      },
    );

    it("a recepção não cria paciente já REMOVIDO (42501); o admin pode", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        await seed(tx, ids);
        await as(ids.reception);
        expect(await attempt(tx, (x) => x.insert(patients).values({ ...other(), deletedAt: new Date() }))).toBe("42501");
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.insert(patients).values({ ...other(), deletedAt: new Date() }))).toBeUndefined();
      });
    });

    it.each(["admin", "reception"] as const)(
      "%s com perfil DESATIVADO ou REMOVIDO não escreve nada (42501 / 0 linhas)",
      async (who) => {
        await harness.inTx(async ({ tx, ids, as, asOwner }) => {
          const s = await seed(tx, ids);
          for (const change of [{ active: false }, { active: true, deletedAt: new Date() }]) {
            await asOwner();
            await tx.update(profiles).set(change).where(eq(profiles.id, ids[who]));
            await as(ids[who]);
            expect(await attempt(tx, (x) => x.insert(patients).values(other()))).toBe("42501");
            expect(await attempt(tx, (x) => x.insert(patientProfessionals).values({ patientId: s.p4, professionalId: s.pA }))).toBe("42501");
            expect(await tx.update(patients).set({ fullName: "[teste] x" }).where(eq(patients.id, s.p1)).returning({ id: patients.id })).toEqual([]);
            expect(await tx.update(patientPrivate).set({ street: "[teste] x" }).where(eq(patientPrivate.patientId, s.p1)).returning({ id: patientPrivate.patientId })).toEqual([]);
          }
        });
      },
    );

    it("o profissional não remove (UPDATE deleted_at afeta 0 linhas), nem o paciente dele", async () => {
      await harness.inTx(async ({ tx, ids, as, asOwner }) => {
        const s = await seed(tx, ids);
        await as(ids.professional);
        const removed = await tx.update(patients).set({ deletedAt: new Date() }).where(eq(patients.id, s.p1)).returning({ id: patients.id });
        expect(removed).toEqual([]);
        await asOwner();
        const [row] = await tx.select({ deletedAt: patients.deletedAt }).from(patients).where(eq(patients.id, s.p1));
        expect(row?.deletedAt).toBeNull();
      });
    });

    it("app.is_own_patient chamada direta: só confirma o vínculo do PRÓPRIO usuário, e nunca com aal1", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        const call = async (patientId: string) => {
          const [row] = await tx.execute<{ own: boolean }>(sql`select app.is_own_patient(${patientId}::uuid) as own`);
          return row?.own;
        };
        await as(ids.professional);
        expect(await call(s.p1)).toBe(true); // dele
        expect(await call(s.p2)).toBe(false); // só do colega
        expect(await call(s.p4)).toBe(false); // sem vínculo
        await as(ids.professional, "aal1");
        expect(await call(s.p1)).toBe(false); // sem 2FA nem a função confirma
        await as(ids.reception);
        expect(await call(s.p1)).toBe(false); // não é profissional
        await as(ids.stranger);
        expect(await call(s.p1)).toBe(false); // sem perfil
      });
    });
  });

  describe("regras do banco (checks e chaves)", () => {
    const patientBase = (over: Partial<typeof patients.$inferInsert> = {}) => ({
      fullName: "[teste] Regra",
      birthDate: "1990-01-01",
      ...over,
    });

    it.each([
      ["nome vazio", { fullName: "" }],
      ["nome com espaço na ponta", { fullName: " Maria" }],
      ["nome com 121 caracteres", { fullName: "a".repeat(121) }],
      ["nome com caractere de controle", { fullName: "Maria\u0007Silva" }],
      ["nascimento antes de 1900", { birthDate: "1899-12-31" }],
      ["nascimento no futuro", { birthDate: "2999-01-01" }],
      ["telefone com 9 dígitos", { phone: "119123456" }],
      ["telefone com letras", { phone: "1191234567a" }],
      ["e-mail sem arroba", { email: "sem-arroba" }],
    ])("patients recusa %s (23514)", async (_label, over) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        await seed(tx, ids);
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.insert(patients).values(patientBase(over)))).toBe("23514");
      });
    });

    it("patients aceita 1º/01/1900 e nascimento hoje", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        await seed(tx, ids);
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.insert(patients).values(patientBase({ birthDate: "1900-01-01" })))).toBeUndefined();
        expect(await attempt(tx, (x) => x.insert(patients).values(patientBase({ birthDate: sql`current_date` as unknown as string })))).toBeUndefined();
      });
    });

    const privateBase = (patientId: string, over: Partial<typeof patientPrivate.$inferInsert> = {}) => ({
      patientId,
      cpf: nextCpf(),
      ...over,
    });
    const freshPatient = async (tx: Tx) => {
      const [row] = await tx.insert(patients).values({ fullName: "[teste] Regra Privado", birthDate: "1990-01-01" }).returning({ id: patients.id });
      return row!.id;
    };

    it.each([
      ["CPF e motivo juntos", { noCpfReason: "Estrangeiro" }],
      ["nem CPF nem motivo", { cpf: null }],
      ["CPF com 10 dígitos", { cpf: "1234567890" }],
      ["CPF com pontuação", { cpf: "529.982.247-25" }],
      ["motivo vazio", { cpf: null, noCpfReason: "" }],
      ["motivo com espaço na ponta", { cpf: null, noCpfReason: "Estrangeiro " }],
      ["motivo com 201 caracteres", { cpf: null, noCpfReason: "a".repeat(201) }],
      ["CEP com 7 dígitos", { cep: "0131010" }],
      ["UF minúscula", { state: "sp" }],
      ["UF com 3 letras", { state: "SPP" }],
      ["rua com 121 caracteres", { street: "a".repeat(121) }],
      ["número com 21 caracteres", { number: "1".repeat(21) }],
      ["carteirinha sem convênio", { insuranceCard: "123" }],
      ["telefone do responsável com 9 dígitos", { guardianPhone: "119123456" }],
      ["CPF do responsável com 10 dígitos", { guardianCpf: "1234567890" }],
      ["parentesco com 41 caracteres", { guardianRelationship: "a".repeat(41) }],
      ["observações vazias", { adminNotes: "" }],
      ["observações com 1001 caracteres", { adminNotes: "a".repeat(1001) }],
      ["observações com caractere de controle", { adminNotes: "ruim\u0007" }],
    ])("patient_private recusa %s (23514)", async (_label, over) => {
      await harness.inTx(async ({ tx, ids, as }) => {
        await seed(tx, ids);
        await as(ids.admin);
        const id = await freshPatient(tx);
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values(privateBase(id, over)))).toBe("23514");
      });
    });

    it("patient_private aceita 'Sem CPF' com motivo, observações com quebra de linha e todos os campos", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        const a = await freshPatient(tx);
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values({ patientId: a, noCpfReason: "Estrangeiro, sem CPF" }))).toBeUndefined();
        const b = await freshPatient(tx);
        expect(
          await attempt(tx, (x) =>
            x.insert(patientPrivate).values({
              patientId: b,
              cpf: nextCpf(),
              cep: "01310100",
              street: "Rua Fictícia",
              number: "100",
              complement: "Apto 1",
              district: "Centro",
              city: "São Paulo",
              state: "SP",
              insuranceId: s.insuranceId,
              insuranceCard: "123 456",
              guardianName: "Responsável Fictício",
              guardianRelationship: "Mãe",
              guardianPhone: "11988887777",
              guardianCpf: nextCpf(),
              adminNotes: "linha 1\nlinha 2",
            }),
          ),
        ).toBeUndefined();
      });
    });

    it("chaves estrangeiras: convênio e paciente inexistentes (23503) e 1:1 por paciente (23505)", async () => {
      await harness.inTx(async ({ tx, ids, as }) => {
        const s = await seed(tx, ids);
        await as(ids.admin);
        const id = await freshPatient(tx);
        const missing = "00000000-0000-4000-8000-000000000000";
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values(privateBase(id, { insuranceId: missing })))).toBe("23503");
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values(privateBase(missing)))).toBe("42501"); // a política exige paciente existente e não removido
        expect(await attempt(tx, (x) => x.insert(patientPrivate).values(privateBase(s.p1)))).toBe("23505"); // já tem dados administrativos
      });
    });
  });

  describe("privilégios e políticas (catálogo do Postgres)", () => {
    const expected: Record<string, { ins: boolean; upd: boolean; del: boolean }> = {
      // UPDATE só por coluna (0019): não há UPDATE de tabela inteira em patients e patient_private.
      patients: { ins: true, upd: false, del: false },
      patient_private: { ins: true, upd: false, del: false },
      patient_professionals: { ins: true, upd: false, del: true },
    };

    it.each(Object.keys(expected))("%s: anon não tem nada; authenticated só o necessário; RLS ligada", async (table) => {
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
            (select relrowsecurity from pg_class where oid = ${`public.${table}`}::regclass) as rls`);
        expect(row).toEqual({ anon: false, anonCols: false, sel: true, ...expected[table], extra: false, rls: true });
      });
    });

    it("UPDATE só nas colunas editáveis: chaves e created_at ficam de fora", async () => {
      await harness.inTx(async ({ tx, asOwner }) => {
        await asOwner();
        const can = async (table: string, column: string) => {
          const [row] = await tx.execute<{ ok: boolean }>(
            sql`select has_column_privilege('authenticated', ${`public.${table}`}, ${column}, 'UPDATE') as ok`,
          );
          return row?.ok;
        };
        for (const [table, column] of [
          ["patients", "id"],
          ["patients", "created_at"],
          ["patient_private", "patient_id"],
          ["patient_private", "created_at"],
        ] as const) {
          expect(await can(table, column), `${table}.${column}`).toBe(false);
        }
        for (const [table, column] of [
          ["patients", "full_name"],
          ["patients", "deleted_at"],
          ["patient_private", "cpf"],
          ["patient_private", "admin_notes"],
        ] as const) {
          expect(await can(table, column), `${table}.${column}`).toBe(true);
        }
      });
    });

    it.each(Object.keys(expected))("%s tem a política RESTRICTIVE que exige aal2", async (table) => {
      await harness.inTx(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string }>(
          sql`select policyname from pg_policies where schemaname = 'public' and tablename = ${table} and permissive = 'RESTRICTIVE'`,
        );
        expect(rows.map((r) => r.policyname)).toEqual([`${table}_require_aal2`]);
      });
    });

    it("não existe política que dê ao profissional acesso a patient_private (nem de leitura, nem de escrita)", async () => {
      await harness.inTx(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string; qual: string | null; with_check: string | null }>(
          sql`select policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'patient_private' and permissive = 'PERMISSIVE'`,
        );
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          const text = `${row.qual ?? ""} ${row.with_check ?? ""}`;
          expect(text, row.policyname).not.toContain("'professional'");
        }
      });
    });

    it("a função de vínculo (SECURITY DEFINER) não é executável por anon nem por PUBLIC", async () => {
      await harness.inTx(async ({ tx, asOwner }) => {
        await asOwner();
        const [row] = await tx.execute<{ anon: boolean; pub: boolean; auth: boolean }>(sql`
          select
            has_function_privilege('anon', 'app.is_own_patient(uuid)', 'EXECUTE') as anon,
            has_function_privilege('public', 'app.is_own_patient(uuid)', 'EXECUTE') as pub,
            has_function_privilege('authenticated', 'app.is_own_patient(uuid)', 'EXECUTE') as auth`);
        expect(row).toEqual({ anon: false, pub: false, auth: true });
      });
    });
  });
});

// Resíduo: estes testes só gravam dentro de transações revertidas. Garantia extra, rodando como dono:
describe.skipIf(!hasDb)("pacientes de teste não ficam gravados", () => {
  const harness = createRlsHarness();
  beforeAll(() => harness.connect());
  afterAll(() => harness.close());
  it("nenhum paciente '[teste]' sobra no banco", async () => {
    await harness.inTx(async ({ tx, asOwner }) => {
      await asOwner();
      const rows = await tx.select({ id: patients.id }).from(patients).where(like(patients.fullName, "[teste]%"));
      expect(rows).toEqual([]);
    });
  });
});
