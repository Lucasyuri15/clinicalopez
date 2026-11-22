import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WorkRange } from "@/lib/schedule/week";
import { addTimeOff, removeTimeOff, saveWeek, scheduleLockKey } from "@/server/schedule/mutations";
import { getScheduleOwner, getWeek, listTimeOff } from "@/server/schedule/queries";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Camada de dados da grade de horários contra o Supabase DEV pelo caminho REAL do app
 * (`DATABASE_URL` → `app_backend` → `authenticated` sob RLS, via `withUser`). Dados fictícios.
 * Fixtures commitados pelo dono e apagados no fim (o código usa outra conexão). A regra de quem
 * vê o quê é da RLS (testada em `schedule-rls.test.ts`); aqui se prova que consultas e gravações
 * a respeitam de ponta a ponta, que a gravação da semana é atômica e que duas gravações
 * simultâneas não se atropelam.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-grade ${randomUUID().slice(0, 8)}]`;
const H = (hours: number, minutes = 0) => hours * 60 + minutes;
const r = (weekday: number, start: number, end: number): WorkRange => ({ weekday, start, end });

describe.skipIf(!hasDb)("camada de dados da grade de horários (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    prof1: { userId: randomUUID() },
    prof2: { userId: randomUUID() },
  };
  const ids = { p1: "", p2: "", removed: "" };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`grade-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin'),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception'),
        (${users.prof1.userId}, ${`${TAG} Login Um`}, 'professional'),
        (${users.prof2.userId}, ${`${TAG} Login Dois`}, 'professional')`;
      const [p1] = await owner`insert into public.professionals (full_name, specialty, profile_id)
        values (${`${TAG} Ana`}, 'physiotherapy', ${users.prof1.userId}) returning id`;
      const [p2] = await owner`insert into public.professionals (full_name, specialty, profile_id)
        values (${`${TAG} Bia`}, 'physiotherapy', ${users.prof2.userId}) returning id`;
      const [removed] = await owner`insert into public.professionals (full_name, specialty, deleted_at)
        values (${`${TAG} Antigo`}, 'dentistry', now()) returning id`;
      Object.assign(ids, { p1: p1!.id, p2: p2!.id, removed: removed!.id });
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function cleanup() {
    const like = `${TAG}%`;
    await owner`delete from public.professional_work_hours where professional_id in
      (select id from public.professionals where full_name like ${like})`;
    await owner`delete from public.professional_time_off where professional_id in
      (select id from public.professionals where full_name like ${like})`;
    await owner`delete from public.professionals where full_name like ${like}`;
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

  const rowsOf = async (professionalId: string) =>
    (
      await owner`select weekday, start_minute, end_minute from public.professional_work_hours
        where professional_id = ${professionalId} order by weekday, start_minute`
    ).map((row) => r(row.weekday, row.start_minute, row.end_minute));

  describe("gravar a semana", () => {
    const monTue = [r(1, H(8), H(12)), r(1, H(14), H(18)), r(2, H(9), H(13))];

    it("admin grava a semana; ler devolve igual, ordenado; gravar de novo SUBSTITUI o conjunto", async () => {
      expect(await saveWeek(users.admin, { professionalId: ids.p1, ranges: monTue })).toEqual({ ok: true, id: ids.p1 });
      expect(await getWeek(users.admin, ids.p1)).toEqual(monTue);
      expect(await rowsOf(ids.p1)).toEqual(monTue);

      const replaced = [r(3, H(7), H(11)), r(3, H(11), H(13))]; // faixas que encostam valem
      expect((await saveWeek(users.admin, { professionalId: ids.p1, ranges: replaced })).ok).toBe(true);
      expect(await rowsOf(ids.p1)).toEqual(replaced);
    });

    it("semana vazia limpa a grade", async () => {
      await saveWeek(users.admin, { professionalId: ids.p1, ranges: monTue });
      expect((await saveWeek(users.admin, { professionalId: ids.p1, ranges: [] })).ok).toBe(true);
      expect(await rowsOf(ids.p1)).toEqual([]);
    });

    it("faixas sobrepostas são recusadas ('overlap') e a grade ANTERIOR continua intacta (atômico)", async () => {
      await saveWeek(users.admin, { professionalId: ids.p1, ranges: monTue });
      const result = await saveWeek(users.admin, {
        professionalId: ids.p1,
        ranges: [r(5, H(8), H(12)), r(5, H(11), H(14))],
      });
      expect(result).toEqual({ ok: false, reason: "overlap" });
      expect(await rowsOf(ids.p1)).toEqual(monTue);
    });

    it("a grade de um profissional não interfere na de outro (mesmo horário)", async () => {
      await saveWeek(users.admin, { professionalId: ids.p1, ranges: [r(1, H(8), H(12))] });
      expect((await saveWeek(users.admin, { professionalId: ids.p2, ranges: [r(1, H(8), H(12))] })).ok).toBe(true);
      expect(await rowsOf(ids.p1)).toEqual([r(1, H(8), H(12))]);
      expect(await rowsOf(ids.p2)).toEqual([r(1, H(8), H(12))]);
    });

    it("profissional inexistente ou removido devolve 'not-found' e não grava", async () => {
      expect(await saveWeek(users.admin, { professionalId: "00000000-0000-4000-8000-000000000000", ranges: monTue })).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await saveWeek(users.admin, { professionalId: ids.removed, ranges: monTue })).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await rowsOf(ids.removed)).toEqual([]);
    });

    it.each(["reception", "prof1", "prof2"] as const)("%s não grava (a RLS nega) e nada muda, nem com semana vazia", async (who) => {
      await saveWeek(users.admin, { professionalId: ids.p1, ranges: monTue });
      expect((await saveWeek(users[who], { professionalId: ids.p1, ranges: [r(4, H(8), H(9))] })).ok).toBe(false);
      expect((await saveWeek(users[who], { professionalId: ids.p1, ranges: [] })).ok).toBe(false); // "limpar" não vira sucesso
      expect(await rowsOf(ids.p1)).toEqual(monTue);
    });

    it("duas gravações SIMULTÂNEAS da mesma semana terminam sem erro e a grade é exatamente uma das duas (trava por profissional)", async () => {
      const a = [r(1, H(8), H(12)), r(2, H(8), H(12))];
      const b = [r(1, H(9), H(13)), r(3, H(9), H(13))];
      const [ra, rb] = await Promise.all([
        saveWeek(users.admin, { professionalId: ids.p2, ranges: a }),
        saveWeek(users.admin, { professionalId: ids.p2, ranges: b }),
      ]);
      expect(ra.ok).toBe(true);
      expect(rb.ok).toBe(true);
      const final = await rowsOf(ids.p2);
      expect([JSON.stringify(a), JSON.stringify(b)]).toContain(JSON.stringify(final));
    });
  });

  describe("ler a grade", () => {
    it("cada papel lê o que a RLS permite; ids inválidos devolvem lista vazia", async () => {
      const week = [r(1, H(8), H(12)), r(4, H(14), H(18))];
      await saveWeek(users.admin, { professionalId: ids.p1, ranges: week });
      await saveWeek(users.admin, { professionalId: ids.p2, ranges: [r(1, H(9), H(10))] });

      expect(await getWeek(users.admin, ids.p1)).toEqual(week);
      expect(await getWeek(users.reception, ids.p1)).toEqual(week);
      expect(await getWeek(users.prof1, ids.p1)).toEqual(week); // a própria
      expect(await getWeek(users.prof1, ids.p2)).toEqual([]); // a do colega: a RLS devolve vazio
      expect(await getWeek(users.prof2, ids.p1)).toEqual([]);
      expect(await getWeek(users.admin, "não-é-uuid")).toEqual([]);
      expect(await getWeek({ userId: randomUUID() }, ids.p1)).toEqual([]); // sem perfil
    });
  });

  describe("folgas e bloqueios", () => {
    const now = new Date("2026-12-10T12:00:00Z");
    const day = (iso: string) => new Date(iso);

    it("admin cria e remove; a lista traz as FUTURAS e as recentes (30 dias), em ordem", async () => {
      const far = await addTimeOff(users.admin, {
        professionalId: ids.p1,
        startsAt: day("2027-03-01T03:00:00Z"),
        endsAt: day("2027-03-02T03:00:00Z"),
        reason: null,
      });
      const near = await addTimeOff(users.admin, {
        professionalId: ids.p1,
        startsAt: day("2026-12-24T03:00:00Z"),
        endsAt: day("2026-12-27T03:00:00Z"),
        reason: "Férias",
      });
      const recent = await addTimeOff(users.admin, {
        professionalId: ids.p1,
        startsAt: day("2026-11-20T03:00:00Z"),
        endsAt: day("2026-11-21T03:00:00Z"),
        reason: "Compromisso",
      });
      const old = await addTimeOff(users.admin, {
        professionalId: ids.p1,
        startsAt: day("2026-01-05T03:00:00Z"),
        endsAt: day("2026-01-06T03:00:00Z"),
        reason: null,
      });
      expect([far, near, recent, old].every((x) => x.ok)).toBe(true);

      const list = await listTimeOff(users.admin, ids.p1, { now });
      expect(list.map((x) => x.reason)).toEqual(["Compromisso", "Férias", null]); // a antiga (jan/2026) fica de fora
      expect(list[1]).toMatchObject({ startsAt: day("2026-12-24T03:00:00Z"), endsAt: day("2026-12-27T03:00:00Z") });

      const id = near.ok ? near.id : "";
      expect(await removeTimeOff(users.admin, id)).toEqual({ ok: true, id });
      expect(await removeTimeOff(users.admin, id)).toEqual({ ok: false, reason: "not-found" });
      expect((await listTimeOff(users.admin, ids.p1, { now })).map((x) => x.reason)).toEqual(["Compromisso", null]);
    });

    it("cada papel lê só o que a RLS permite", async () => {
      await addTimeOff(users.admin, { professionalId: ids.p2, startsAt: day("2026-12-28T03:00:00Z"), endsAt: day("2026-12-29T03:00:00Z"), reason: "Só da Bia" });
      expect((await listTimeOff(users.reception, ids.p2, { now })).some((x) => x.reason === "Só da Bia")).toBe(true);
      expect((await listTimeOff(users.prof2, ids.p2, { now })).some((x) => x.reason === "Só da Bia")).toBe(true);
      expect(await listTimeOff(users.prof1, ids.p2, { now })).toEqual([]); // colega
      expect(await listTimeOff(users.admin, "não-é-uuid", { now })).toEqual([]);
    });

    it("quem não é admin não cria nem remove", async () => {
      const created = await addTimeOff(users.admin, { professionalId: ids.p1, startsAt: day("2027-04-01T03:00:00Z"), endsAt: day("2027-04-02T03:00:00Z"), reason: "Alvo" });
      const id = created.ok ? created.id : "";
      for (const who of ["reception", "prof1", "prof2"] as const) {
        expect(
          (await addTimeOff(users[who], { professionalId: ids.p1, startsAt: day("2027-05-01T03:00:00Z"), endsAt: day("2027-05-02T03:00:00Z"), reason: null })).ok,
        ).toBe(false);
        expect((await removeTimeOff(users[who], id)).ok).toBe(false);
      }
      const [row] = await owner`select count(*)::int as n from public.professional_time_off where id = ${id}`;
      expect(row?.n).toBe(1);
    });

    it("uma folga nova ESPERA as reservas em andamento (trava compartilhada da agenda) e só então grava", async () => {
      // Uma reserva (Fase 2) toma a trava COMPARTILHADA do profissional antes de ler a grade e as folgas.
      // A folga nova toma a EXCLUSIVA: espera a reserva terminar, para que nenhuma reserva leia as
      // folgas, perca a corrida e grave um atendimento em cima da folga que acabou de ser criada.
      const holder = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let acquired: () => void = () => {};
      const lockTaken = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const reservation = holder.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock_shared(hashtextextended(${scheduleLockKey(ids.p2)}, 0))`;
        acquired();
        await gate;
      });
      try {
        await lockTaken;
        let settled = false;
        const pending = addTimeOff(users.admin, {
          professionalId: ids.p2,
          startsAt: new Date("2031-03-01T10:00:00Z"),
          endsAt: new Date("2031-03-01T12:00:00Z"),
          reason: null,
        }).then((result) => {
          settled = true;
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(settled, "a folga não pode gravar enquanto uma reserva segura a trava").toBe(false);

        release();
        await reservation;
        const result = await pending;
        expect(result.ok).toBe(true);
      } finally {
        release();
        await reservation.catch(() => {});
        await holder.end({ timeout: 2 });
      }
    });

    it("texto que o banco recusa (byte nulo no motivo) vira 'denied', não exceção", async () => {
      expect(
        await addTimeOff(users.admin, { professionalId: ids.p1, startsAt: day("2027-07-01T03:00:00Z"), endsAt: day("2027-07-02T03:00:00Z"), reason: "Fér\u0000ias" }),
      ).toEqual({ ok: false, reason: "denied" });
    });

    it("profissional removido ou período inválido pelo banco viram resultado, não exceção", async () => {
      expect(
        await addTimeOff(users.admin, { professionalId: ids.removed, startsAt: day("2027-06-01T03:00:00Z"), endsAt: day("2027-06-02T03:00:00Z"), reason: null }),
      ).toEqual({ ok: false, reason: "denied" });
      expect(
        await addTimeOff(users.admin, { professionalId: ids.p1, startsAt: day("2027-06-02T03:00:00Z"), endsAt: day("2027-06-01T03:00:00Z"), reason: null }),
      ).toEqual({ ok: false, reason: "denied" });
    });
  });

  describe("dono do horário (cabeçalho da tela)", () => {
    it("admin, recepção e o próprio profissional leem; o colega e o removido, não", async () => {
      expect(await getScheduleOwner(users.admin, ids.p1)).toMatchObject({ id: ids.p1, fullName: `${TAG} Ana`, specialty: "physiotherapy" });
      expect(await getScheduleOwner(users.reception, ids.p1)).toMatchObject({ id: ids.p1 });
      expect(await getScheduleOwner(users.prof1, ids.p1)).toMatchObject({ id: ids.p1 });
      expect(await getScheduleOwner(users.prof1, ids.p2)).toBeNull();
      expect(await getScheduleOwner(users.admin, ids.removed)).toBeNull();
      expect(await getScheduleOwner(users.admin, "não-é-uuid")).toBeNull();
    });
  });
});
