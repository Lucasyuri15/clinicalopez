import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertMigrationTarget } from "./migration-guard";

import {
  createInsurance,
  createService,
  removePrice,
  setInsuranceActive,
  setPrice,
  setServiceActive,
  updateInsurance,
  updateService,
} from "@/server/catalog/mutations";
import {
  getInsurance,
  listInsurancePrices,
  listInsurances,
  listParticularPrices,
  listServices,
} from "@/server/catalog/queries";

/**
 * Camada de dados do catálogo contra o Supabase DEV pelo caminho REAL do app
 * (`DATABASE_URL` → `app_backend` → `authenticated` sob RLS, via `withUser`). Dados fictícios.
 * Os fixtures precisam estar COMMITADOS (o código usa outra conexão): são criados pelo dono
 * (`DIRECT_URL`) e apagados no fim. O que cada perfil enxerga é decisão da RLS (testada em
 * `catalog-rls.test.ts`); aqui se prova que as consultas e as gravações a respeitam de ponta a ponta.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-dados ${randomUUID().slice(0, 8)}]`;

describe.skipIf(!hasDb)("camada de dados do catálogo (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    professional: { userId: randomUUID() },
  };
  const ids = {
    physio: "",
    psych: "",
    removedService: "",
    plan: "",
    removedPlan: "",
    particular: "",
    planPrice: "",
    removedPrice: "",
  };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`dados-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, 'Admin Ficticio', 'admin'),
        (${users.reception.userId}, 'Recepcao Ficticia', 'reception'),
        (${users.professional.userId}, 'Profissional Ficticio', 'professional')`;

      const [physio] = await owner`insert into public.services (name, specialty, duration_minutes)
        values (${`${TAG} Fisio`}, 'physiotherapy', 50) returning id`;
      const [psych] = await owner`insert into public.services (name, specialty, duration_minutes, active)
        values (${`${TAG} Psico`}, 'psychology', 45, false) returning id`;
      const [removedService] = await owner`insert into public.services (name, specialty, duration_minutes, deleted_at)
        values (${`${TAG} Antigo`}, 'dentistry', 30, now()) returning id`;
      const [plan] = await owner`insert into public.insurances (name) values (${`${TAG} Plano A`}) returning id`;
      const [removedPlan] = await owner`insert into public.insurances (name, deleted_at)
        values (${`${TAG} Plano Velho`}, now()) returning id`;
      const [particular] = await owner`insert into public.service_prices (service_id, insurance_id, price_cents)
        values (${physio!.id}, null, 15000) returning id`;
      const [planPrice] = await owner`insert into public.service_prices (service_id, insurance_id, price_cents)
        values (${physio!.id}, ${plan!.id}, 9000) returning id`;
      const [removedPrice] = await owner`insert into public.service_prices (service_id, insurance_id, price_cents, deleted_at)
        values (${psych!.id}, ${plan!.id}, 7000, now()) returning id`;
      Object.assign(ids, {
        physio: physio!.id,
        psych: psych!.id,
        removedService: removedService!.id,
        plan: plan!.id,
        removedPlan: removedPlan!.id,
        particular: particular!.id,
        planPrice: planPrice!.id,
        removedPrice: removedPrice!.id,
      });
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function cleanup() {
    const like = `${TAG}%`;
    await owner`delete from public.service_prices where service_id in (select id from public.services where name like ${like})
      or insurance_id in (select id from public.insurances where name like ${like})`;
    await owner`delete from public.services where name like ${like}`;
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

  const mine = <T extends { name: string }>(rows: T[]) => rows.filter((row) => row.name.startsWith(TAG));

  describe("consultas", () => {
    it.each(["admin", "reception", "professional"] as const)(
      "%s lista os serviços não removidos (inclusive o inativo), ordenados, sem campo de valor",
      async (who) => {
        const list = mine(await listServices(users[who]));
        expect(list.map((s) => s.name)).toEqual([`${TAG} Fisio`, `${TAG} Psico`]); // fisioterapia antes de psicologia
        expect(list[1]).toMatchObject({ active: false, durationMinutes: 45, specialty: "psychology" });
        expect(Object.keys(list[0] ?? {}).sort()).toEqual(
          ["active", "durationMinutes", "id", "name", "specialty"].sort(),
        );
      },
    );

    it.each(["admin", "reception"] as const)("%s lista convênios não removidos", async (who) => {
      expect(mine(await listInsurances(users[who])).map((i) => i.name)).toEqual([`${TAG} Plano A`]);
    });

    it("profissional não recebe convênios nem valores (a RLS devolve vazio)", async () => {
      expect(mine(await listInsurances(users.professional))).toEqual([]);
      expect(await getInsurance(users.professional, ids.plan)).toBeNull();
      expect(await listParticularPrices(users.professional)).toEqual([]);
      expect(await listInsurancePrices(users.professional, ids.plan)).toEqual([]);
    });

    it.each(["admin", "reception"] as const)("%s lê o valor particular dos serviços visíveis", async (who) => {
      const prices = (await listParticularPrices(users[who])).filter((p) => p.serviceId === ids.physio);
      expect(prices).toEqual([{ id: ids.particular, serviceId: ids.physio, priceCents: 15000 }]);
    });

    it.each(["admin", "reception"] as const)(
      "%s lê os valores do convênio (sem o valor removido)",
      async (who) => {
        expect(await listInsurancePrices(users[who], ids.plan)).toEqual([
          { id: ids.planPrice, serviceId: ids.physio, priceCents: 9000 },
        ]);
      },
    );

    it("getInsurance devolve o convênio, e null para removido, inexistente ou id inválido", async () => {
      expect(await getInsurance(users.admin, ids.plan)).toMatchObject({ id: ids.plan, name: `${TAG} Plano A` });
      expect(await getInsurance(users.admin, ids.removedPlan)).toBeNull();
      expect(await getInsurance(users.admin, "00000000-0000-4000-8000-000000000000")).toBeNull();
      expect(await getInsurance(users.admin, "não-é-uuid")).toBeNull();
    });
  });

  describe("gravações (só admin)", () => {
    it("admin cria, edita e ativa/desativa um serviço", async () => {
      const created = await createService(users.admin, {
        name: `${TAG} Avaliacao`,
        specialty: "dentistry",
        durationMinutes: 40,
      });
      expect(created.ok).toBe(true);
      const id = created.ok ? created.id : "";
      expect(
        await updateService(users.admin, { id, name: `${TAG} Avaliacao 2`, specialty: "dentistry", durationMinutes: 45 }),
      ).toEqual({ ok: true, id });
      expect(await setServiceActive(users.admin, id, false)).toEqual({ ok: true, id });
      const row = (await listServices(users.admin)).find((s) => s.id === id);
      expect(row).toMatchObject({ name: `${TAG} Avaliacao 2`, durationMinutes: 45, active: false });
    });

    it("nome repetido na mesma especialidade devolve 'duplicate'; em outra especialidade vale", async () => {
      expect(
        await createService(users.admin, { name: `${TAG} Fisio`, specialty: "physiotherapy", durationMinutes: 50 }),
      ).toEqual({ ok: false, reason: "duplicate" });
      expect((await createService(users.admin, { name: `${TAG} Fisio`, specialty: "dentistry", durationMinutes: 50 })).ok).toBe(
        true,
      );
    });

    it("texto que o banco recusa (byte nulo, espaço Unicode na ponta) vira 'denied', não exceção", async () => {
      for (const name of [`${TAG} A\u0000B`, `${TAG} Fim\u0085`]) {
        expect(await createService(users.admin, { name, specialty: "dentistry", durationMinutes: 30 })).toEqual({
          ok: false,
          reason: "denied",
        });
        expect(await createInsurance(users.admin, { name })).toEqual({ ok: false, reason: "denied" });
      }
    });

    it("setPrice não atualiza um valor já removido (volta 'not-found' ou cria outro, nunca mexe no removido)", async () => {
      const [removed] = await owner`select id from public.service_prices where id = ${ids.removedPrice}`;
      expect(removed?.id).toBe(ids.removedPrice);
      // psych tem só um valor REMOVIDO de convênio: gravar de novo cria um valor novo, sem tocar no removido
      const created = await setPrice(users.admin, { serviceId: ids.psych, insuranceId: ids.plan, priceCents: 6100 });
      expect(created.ok).toBe(true);
      expect(created.ok && created.id).not.toBe(ids.removedPrice);
      const [old] = await owner`select price_cents, deleted_at from public.service_prices where id = ${ids.removedPrice}`;
      expect(old?.price_cents).toBe(7000);
      expect(old?.deleted_at).not.toBeNull();
      // desfaz (os testes seguintes esperam só os valores do fixture)
      if (created.ok) await owner`delete from public.service_prices where id = ${created.id}`;
    });

    it("editar serviço inexistente devolve 'not-found'", async () => {
      expect(
        await updateService(users.admin, {
          id: "00000000-0000-4000-8000-000000000000",
          name: `${TAG} X`,
          specialty: "dentistry",
          durationMinutes: 30,
        }),
      ).toEqual({ ok: false, reason: "not-found" });
    });

    it.each(["reception", "professional"] as const)("%s não grava nada (a RLS nega)", async (who) => {
      const input = { name: `${TAG} Proibido ${who}`, specialty: "dentistry", durationMinutes: 30 } as const;
      expect((await createService(users[who], input)).ok).toBe(false);
      expect((await updateService(users[who], { ...input, id: ids.physio })).ok).toBe(false);
      expect((await setServiceActive(users[who], ids.physio, false)).ok).toBe(false);
      expect((await createInsurance(users[who], { name: `${TAG} Proibido ${who}` })).ok).toBe(false);
      expect((await setPrice(users[who], { serviceId: ids.psych, insuranceId: null, priceCents: 1 })).ok).toBe(false);
      expect((await removePrice(users[who], ids.particular)).ok).toBe(false);
      const [row] = await owner`select active, duration_minutes from public.services where id = ${ids.physio}`;
      expect(row).toEqual({ active: true, duration_minutes: 50 });
    });

    it("admin cria, edita e desativa um convênio; nome repetido devolve 'duplicate'", async () => {
      const created = await createInsurance(users.admin, { name: `${TAG} Plano B` });
      expect(created.ok).toBe(true);
      const id = created.ok ? created.id : "";
      expect(await updateInsurance(users.admin, { id, name: `${TAG} Plano B2` })).toEqual({ ok: true, id });
      expect(await setInsuranceActive(users.admin, id, false)).toEqual({ ok: true, id });
      expect(await createInsurance(users.admin, { name: `${TAG} PLANO A` })).toEqual({
        ok: false,
        reason: "duplicate",
      });
      expect((await listInsurances(users.admin)).find((i) => i.id === id)).toMatchObject({
        name: `${TAG} Plano B2`,
        active: false,
      });
    });

    it("setPrice cria e depois ATUALIZA (um só valor por serviço+convênio), particular e de convênio", async () => {
      expect(await setPrice(users.admin, { serviceId: ids.psych, insuranceId: null, priceCents: 12000 })).toMatchObject({
        ok: true,
      });
      expect(await setPrice(users.admin, { serviceId: ids.psych, insuranceId: null, priceCents: 13000 })).toMatchObject({
        ok: true,
      });
      expect(await setPrice(users.admin, { serviceId: ids.physio, insuranceId: ids.plan, priceCents: 9500 })).toMatchObject({
        ok: true,
      });
      const rows = await owner`select price_cents from public.service_prices
        where service_id = ${ids.psych} and insurance_id is null and deleted_at is null`;
      expect(rows).toEqual([{ price_cents: 13000 }]);
      expect(await listInsurancePrices(users.admin, ids.plan)).toEqual([
        { id: ids.planPrice, serviceId: ids.physio, priceCents: 9500 },
      ]);
    });

    it("setPrice não cria valor para serviço removido ou convênio removido (negado)", async () => {
      expect((await setPrice(users.admin, { serviceId: ids.removedService, insuranceId: null, priceCents: 1 })).ok).toBe(
        false,
      );
      expect((await setPrice(users.admin, { serviceId: ids.physio, insuranceId: ids.removedPlan, priceCents: 1 })).ok).toBe(
        false,
      );
    });

    it("removePrice faz exclusão lógica e o valor some das consultas; recriar depois funciona", async () => {
      expect(await removePrice(users.admin, ids.planPrice)).toEqual({ ok: true, id: ids.planPrice });
      expect(await listInsurancePrices(users.admin, ids.plan)).toEqual([]);
      const [row] = await owner`select deleted_at from public.service_prices where id = ${ids.planPrice}`;
      expect(row?.deleted_at).not.toBeNull();
      expect(await removePrice(users.admin, ids.planPrice)).toEqual({ ok: false, reason: "not-found" }); // já removido
      expect((await setPrice(users.admin, { serviceId: ids.physio, insuranceId: ids.plan, priceCents: 8000 })).ok).toBe(true);
      expect(await listInsurancePrices(users.admin, ids.plan)).toMatchObject([{ serviceId: ids.physio, priceCents: 8000 }]);
    });
  });
});
