import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createProfessional,
  setProfessionalActive,
  updateProfessional,
} from "@/server/professionals/mutations";
import { listLinkableProfiles, listProfessionals } from "@/server/professionals/queries";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Camada de dados dos profissionais contra o Supabase DEV pelo caminho REAL do app
 * (`DATABASE_URL` → `app_backend` → `authenticated` sob RLS, via `withUser`). Dados fictícios.
 * Os fixtures precisam estar COMMITADOS (o código usa outra conexão): criados pelo dono e
 * apagados no fim. A regra de quem vê o quê é da RLS (testada em `professionals-rls.test.ts`);
 * aqui se prova que consultas e gravações a respeitam de ponta a ponta, e que as gravações
 * são atômicas (nada fica pela metade).
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-prof ${randomUUID().slice(0, 8)}]`;

describe.skipIf(!hasDb)("camada de dados dos profissionais (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    prof1: { userId: randomUUID() },
    prof2: { userId: randomUUID() },
    prof3: { userId: randomUUID() },
    inactive: { userId: randomUUID() },
  };
  const ids = { physio: "", physio2: "", dental: "" };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`prof-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role, active) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin', true),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception', true),
        (${users.prof1.userId}, ${`${TAG} Login Um`}, 'professional', true),
        (${users.prof2.userId}, ${`${TAG} Login Dois`}, 'professional', true),
        (${users.prof3.userId}, ${`${TAG} Login Tres`}, 'professional', true),
        (${users.inactive.userId}, ${`${TAG} Login Inativo`}, 'professional', false)`;
      const [physio] = await owner`insert into public.services (name, specialty, duration_minutes)
        values (${`${TAG} Fisio`}, 'physiotherapy', 50) returning id`;
      const [physio2] = await owner`insert into public.services (name, specialty, duration_minutes)
        values (${`${TAG} Fisio 2`}, 'physiotherapy', 30) returning id`;
      const [dental] = await owner`insert into public.services (name, specialty, duration_minutes)
        values (${`${TAG} Limpeza`}, 'dentistry', 40) returning id`;
      Object.assign(ids, { physio: physio!.id, physio2: physio2!.id, dental: dental!.id });
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function cleanup() {
    const like = `${TAG}%`;
    await owner`delete from public.professional_services where professional_id in
      (select id from public.professionals where full_name like ${like})`;
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

  const input = (over: Record<string, unknown> = {}) => ({
    fullName: `${TAG} Ana`,
    specialty: "physiotherapy" as const,
    registration: "CREFITO 12345" as string | null,
    phone: "11912345678" as string | null,
    email: "ana@teste.invalid" as string | null,
    profileId: null as string | null,
    serviceIds: [] as string[],
    ...over,
  });
  const mine = <T extends { fullName: string }>(rows: T[]) => rows.filter((r) => r.fullName.startsWith(TAG));
  const rowOf = async (name: string) => {
    const [row] = await owner`select id, specialty, active, profile_id, deleted_at from public.professionals where full_name = ${name}`;
    return row;
  };
  const linksOf = async (professionalId: string) =>
    (await owner`select service_id from public.professional_services where professional_id = ${professionalId} order by service_id`).map(
      (r) => r.service_id as string,
    );

  describe("criar e listar", () => {
    it("admin cria com serviços e login; cada papel enxerga o que a RLS permite", async () => {
      const name = `${TAG} Ana`;
      const created = await createProfessional(
        users.admin,
        input({ fullName: name, profileId: users.prof1.userId, serviceIds: [ids.physio, ids.physio2] }),
      );
      expect(created.ok).toBe(true);
      const id = created.ok ? created.id : "";
      const other = await createProfessional(
        users.admin,
        input({ fullName: `${TAG} Bia`, profileId: users.prof2.userId, serviceIds: [ids.physio], registration: null, phone: null, email: null }),
      );
      expect(other.ok).toBe(true);
      const otherId = other.ok ? other.id : "";

      const asAdmin = mine(await listProfessionals(users.admin));
      expect(asAdmin.map((p) => p.fullName)).toEqual([`${TAG} Ana`, `${TAG} Bia`]);
      const ana = asAdmin.find((p) => p.id === id);
      expect(ana).toMatchObject({
        specialty: "physiotherapy",
        registration: "CREFITO 12345",
        phone: "11912345678",
        email: "ana@teste.invalid",
        profileId: users.prof1.userId,
        active: true,
      });
      expect([...(ana?.serviceIds ?? [])].sort()).toEqual([ids.physio, ids.physio2].sort());

      // recepção lê todos
      expect(mine(await listProfessionals(users.reception)).map((p) => p.id).sort()).toEqual([id, otherId].sort());
      // cada profissional lê SÓ o próprio, com o contato dele
      const asProf1 = mine(await listProfessionals(users.prof1));
      expect(asProf1.map((p) => p.id)).toEqual([id]);
      expect(asProf1[0]?.phone).toBe("11912345678");
      const asProf2 = mine(await listProfessionals(users.prof2));
      expect(asProf2.map((p) => p.id)).toEqual([otherId]);
      expect(asProf2[0]?.serviceIds).toEqual([ids.physio]);
    });

    it("quem não tem perfil, ou está inativo, não recebe nada", async () => {
      expect(mine(await listProfessionals({ userId: randomUUID() }))).toEqual([]);
      expect(mine(await listProfessionals(users.inactive))).toEqual([]);
    });
  });

  describe("editar (atômico)", () => {
    it("edita os dados e SUBSTITUI o conjunto de serviços", async () => {
      const name = `${TAG} Edita`;
      const created = await createProfessional(users.admin, input({ fullName: name, serviceIds: [ids.physio] }));
      const id = created.ok ? created.id : "";
      const result = await updateProfessional(
        users.admin,
        { ...input({ fullName: `${name} 2`, registration: null, serviceIds: [ids.physio2] }), id },
      );
      expect(result).toEqual({ ok: true, id });
      expect(await linksOf(id)).toEqual([ids.physio2]);
      const row = mine(await listProfessionals(users.admin)).find((p) => p.id === id);
      expect(row).toMatchObject({ fullName: `${name} 2`, registration: null, serviceIds: [ids.physio2] });
    });

    it("trocar a especialidade com serviços da NOVA especialidade funciona (apaga e recria na mesma transação)", async () => {
      const created = await createProfessional(
        users.admin,
        input({ fullName: `${TAG} Troca`, serviceIds: [ids.physio] }),
      );
      const id = created.ok ? created.id : "";
      const result = await updateProfessional(users.admin, {
        ...input({ fullName: `${TAG} Troca`, specialty: "dentistry", serviceIds: [ids.dental] }),
        id,
      });
      expect(result.ok).toBe(true);
      expect((await rowOf(`${TAG} Troca`))?.specialty).toBe("dentistry");
      expect(await linksOf(id)).toEqual([ids.dental]);
    });

    it("serviço de outra especialidade é recusado e NADA muda (a transação inteira volta)", async () => {
      const created = await createProfessional(
        users.admin,
        input({ fullName: `${TAG} Atomico`, serviceIds: [ids.physio] }),
      );
      const id = created.ok ? created.id : "";
      const result = await updateProfessional(users.admin, {
        ...input({ fullName: `${TAG} Atomico Novo`, serviceIds: [ids.physio2, ids.dental] }),
        id,
      });
      expect(result).toEqual({ ok: false, reason: "denied" });
      expect((await rowOf(`${TAG} Atomico`))?.id).toBe(id); // nome antigo continua
      expect(await rowOf(`${TAG} Atomico Novo`)).toBeUndefined();
      expect(await linksOf(id)).toEqual([ids.physio]); // serviços antigos continuam
    });

    it("criar com serviço de outra especialidade é recusado e não deixa o profissional pela metade", async () => {
      const result = await createProfessional(
        users.admin,
        input({ fullName: `${TAG} Metade`, serviceIds: [ids.dental] }),
      );
      expect(result).toEqual({ ok: false, reason: "denied" });
      expect(await rowOf(`${TAG} Metade`)).toBeUndefined();
    });

    it("editar profissional inexistente ou removido devolve 'not-found' sem mexer em nada", async () => {
      expect(
        await updateProfessional(users.admin, {
          ...input({ fullName: `${TAG} Fantasma` }),
          id: "00000000-0000-4000-8000-000000000000",
        }),
      ).toEqual({ ok: false, reason: "not-found" });

      const created = await createProfessional(users.admin, input({ fullName: `${TAG} Removido`, serviceIds: [ids.physio] }));
      const id = created.ok ? created.id : "";
      await owner`update public.professionals set deleted_at = now() where id = ${id}`;
      expect(await updateProfessional(users.admin, { ...input({ fullName: `${TAG} Removido`, serviceIds: [] }), id })).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await linksOf(id)).toEqual([ids.physio]); // os serviços não foram apagados
    });
  });

  describe("regras", () => {
    it("nome repetido na mesma especialidade devolve 'duplicate-name'", async () => {
      await createProfessional(users.admin, input({ fullName: `${TAG} Repetido` }));
      expect(await createProfessional(users.admin, input({ fullName: `${TAG} REPETIDO` }))).toEqual({
        ok: false,
        reason: "duplicate-name",
      });
    });

    it("o mesmo login em dois profissionais devolve 'duplicate-login'", async () => {
      const first = await createProfessional(users.admin, input({ fullName: `${TAG} Login A`, profileId: users.prof3.userId }));
      expect(first.ok).toBe(true);
      expect(
        await createProfessional(users.admin, input({ fullName: `${TAG} Login B`, profileId: users.prof3.userId })),
      ).toEqual({ ok: false, reason: "duplicate-login" });
    });

    it("vincular um perfil que não é 'professional' (recepção) é recusado", async () => {
      expect(
        await createProfessional(users.admin, input({ fullName: `${TAG} Sem Papel`, profileId: users.reception.userId })),
      ).toEqual({ ok: false, reason: "denied" });
      expect(await rowOf(`${TAG} Sem Papel`)).toBeUndefined();
    });

    it("vincular um perfil INATIVO ou REMOVIDO é recusado (login morto), e nada fica gravado", async () => {
      expect(
        await createProfessional(users.admin, input({ fullName: `${TAG} Login Morto`, profileId: users.inactive.userId })),
      ).toEqual({ ok: false, reason: "denied" });
      expect(await rowOf(`${TAG} Login Morto`)).toBeUndefined();
      const gone = randomUUID();
      await owner`insert into auth.users (id, aud, role, email) values (${gone}, 'authenticated', 'authenticated', ${`prof-gone-${gone}@teste.invalid`})`;
      await owner`insert into public.profiles (id, full_name, role, deleted_at) values (${gone}, ${`${TAG} Login Removido`}, 'professional', now())`;
      try {
        expect(
          await createProfessional(users.admin, input({ fullName: `${TAG} Login Removido`, profileId: gone })),
        ).toEqual({ ok: false, reason: "denied" });
      } finally {
        await owner`delete from public.profiles where id = ${gone}`;
        await owner`delete from auth.users where id = ${gone}`;
      }
    });

    it("ativar e desativar; o inativo continua na lista, marcado", async () => {
      const created = await createProfessional(users.admin, input({ fullName: `${TAG} Liga` }));
      const id = created.ok ? created.id : "";
      expect(await setProfessionalActive(users.admin, id, false)).toEqual({ ok: true, id });
      expect(mine(await listProfessionals(users.admin)).find((p) => p.id === id)?.active).toBe(false);
      expect(await setProfessionalActive(users.admin, id, true)).toEqual({ ok: true, id });
      expect(await setProfessionalActive(users.admin, "00000000-0000-4000-8000-000000000000", true)).toEqual({
        ok: false,
        reason: "not-found",
      });
    });

    it("texto que o banco recusa (byte nulo) vira 'denied', não exceção", async () => {
      expect(await createProfessional(users.admin, input({ fullName: `${TAG} A\u0000B` }))).toEqual({
        ok: false,
        reason: "denied",
      });
    });
  });

  describe("só admin grava", () => {
    it.each(["reception", "prof2", "inactive"] as const)("%s não cria, edita nem ativa/desativa", async (who) => {
      const created = await createProfessional(users.admin, input({ fullName: `${TAG} Alvo ${who}`, serviceIds: [ids.physio] }));
      const id = created.ok ? created.id : "";
      expect((await createProfessional(users[who], input({ fullName: `${TAG} Intruso ${who}` }))).ok).toBe(false);
      expect(
        (await updateProfessional(users[who], { ...input({ fullName: `${TAG} Hackeado ${who}`, serviceIds: [] }), id })).ok,
      ).toBe(false);
      expect((await setProfessionalActive(users[who], id, false)).ok).toBe(false);
      expect(await rowOf(`${TAG} Intruso ${who}`)).toBeUndefined();
      expect((await rowOf(`${TAG} Alvo ${who}`))?.active).toBe(true);
      expect(await linksOf(id)).toEqual([ids.physio]);
    });
  });

  describe("perfis para vincular", () => {
    it("lista só perfis 'professional' ativos e ainda livres; na edição mantém o atual", async () => {
      // independe da ordem dos outros testes: solta todos os logins deste arquivo antes
      await owner`update public.professionals set profile_id = null where full_name like ${`${TAG}%`}`;
      const created = await createProfessional(users.admin, input({ fullName: `${TAG} Vinculado`, profileId: users.prof1.userId }));
      const id = created.ok ? created.id : "";
      const free = (await listLinkableProfiles(users.admin)).filter((p) => p.fullName.startsWith(TAG));
      expect(free.map((p) => p.id).sort()).toEqual([users.prof2.userId, users.prof3.userId].sort()); // sem prof1 (vinculado), sem recepção/admin/inativo
      const editing = (await listLinkableProfiles(users.admin, { keepProfileIds: [users.prof1.userId] })).filter((p) =>
        p.fullName.startsWith(TAG),
      );
      expect(editing.map((p) => p.id).sort()).toEqual([users.prof1.userId, users.prof2.userId, users.prof3.userId].sort());
      // removido o profissional, o login volta a ficar livre
      await owner`update public.professionals set deleted_at = now(), profile_id = null where id = ${id}`;
      const afterRemoval = (await listLinkableProfiles(users.admin)).filter((p) => p.fullName.startsWith(TAG));
      expect(afterRemoval.map((p) => p.id)).toContain(users.prof1.userId);
    });

    it("login desativado DEPOIS de vinculado continua na lista de edição (marcado), para a edição não desvinculá-lo em silêncio", async () => {
      await owner`update public.professionals set profile_id = null where full_name like ${`${TAG}%`}`;
      const created = await createProfessional(users.admin, input({ fullName: `${TAG} Login Cai`, profileId: users.prof3.userId }));
      expect(created.ok).toBe(true);
      await owner`update public.profiles set active = false where id = ${users.prof3.userId}`;
      try {
        const withKeep = (await listLinkableProfiles(users.admin, { keepProfileIds: [users.prof3.userId] })).find(
          (p) => p.id === users.prof3.userId,
        );
        expect(withKeep).toMatchObject({ fullName: `${TAG} Login Tres`, active: false });
        // sem "manter", um perfil inativo nunca é oferecido
        expect((await listLinkableProfiles(users.admin)).some((p) => p.id === users.prof3.userId)).toBe(false);
        // e salvar a edição sem mexer no login NÃO o solta (nem exige perfil ativo)
        const id = created.ok ? created.id : "";
        const result = await updateProfessional(users.admin, {
          ...input({ fullName: `${TAG} Login Cai`, phone: "11955556666", profileId: users.prof3.userId }),
          id,
        });
        expect(result.ok).toBe(true);
        expect((await rowOf(`${TAG} Login Cai`))?.profile_id).toBe(users.prof3.userId);
      } finally {
        await owner`update public.profiles set active = true where id = ${users.prof3.userId}`;
      }
    });

    it("quem não é admin não enxerga os perfis dos outros", async () => {
      const seen = (await listLinkableProfiles(users.reception)).filter((p) => p.fullName.startsWith(TAG));
      expect(seen).toEqual([]);
    });
  });
});
