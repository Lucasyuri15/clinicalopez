import { z } from "zod";

import { DAY_MINUTES, parseTime, STEP_MINUTES } from "@/lib/schedule/time";

/**
 * Validação (Zod) das entradas da lista de espera (Fase 3B). Recebe o que vem do formulário (tudo
 * texto) e devolve tipos prontos. Os limites espelham os `CHECK` do banco; aqui a mensagem é em
 * pt-BR e o banco é a última barreira.
 *
 * DADO SENSÍVEL: a nota é texto livre. Nenhuma mensagem de erro repete o que foi digitado.
 */
export const NOTE_MAX = 200;

const length = (text: string) => [...text].length;
/**
 * Caracteres de controle (byte nulo, bell...: o banco recusaria, 22021) e os invisíveis ou de direção
 * do texto (categoria Cf: espaço de largura zero, override bidi...), que deixariam uma nota "vazia" ou
 * embaralhariam o texto na tela da equipe.
 */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/u;

type Fail = (field: string, message: string) => void;

const uuidOf = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  return z.guid().safeParse(value).success ? value : null;
};

type PreferenceInput = {
  weekdays: string[];
  startTime: string;
  endTime: string;
  note: string;
};

type ParsedPreference = {
  weekdays: number[];
  startMinute: number | null;
  endMinute: number | null;
  note: string | null;
};

/** Dias (vazio = qualquer), faixa (vazia = qualquer; início e fim juntos) e nota. */
function parsePreference(v: PreferenceInput, fail: Fail): ParsedPreference | null {
  let ok = true;

  let weekdays: number[] = [];
  if (!v.weekdays.every((day) => /^[0-6]$/.test(day.trim()))) {
    fail("weekdays", "Dia da semana inválido.");
    ok = false;
  } else {
    weekdays = [...new Set(v.weekdays.map((day) => Number(day.trim())))].sort((a, b) => a - b);
  }

  let startMinute: number | null = null;
  let endMinute: number | null = null;
  const startText = v.startTime.trim();
  const endText = v.endTime.trim();
  if (startText !== "" || endText !== "") {
    if (startText === "") {
      fail("startTime", "Informe o início da faixa, ou deixe os dois horários em branco.");
      ok = false;
    } else if (endText === "") {
      fail("endTime", "Informe o fim da faixa, ou deixe os dois horários em branco.");
      ok = false;
    } else {
      const start = parseTime(startText);
      let end = parseTime(endText);
      // O campo de hora não digita 24:00: "00:00" como FIM (depois de um início) é a meia-noite.
      if (end === 0 && start !== null && start > 0) end = DAY_MINUTES;
      if (start === null || start >= DAY_MINUTES || start % STEP_MINUTES !== 0) {
        fail("startTime", `Informe o início (HH:MM) de ${STEP_MINUTES} em ${STEP_MINUTES} minutos.`);
        ok = false;
      }
      if (end === null || end % STEP_MINUTES !== 0) {
        fail("endTime", `Informe o fim (HH:MM) de ${STEP_MINUTES} em ${STEP_MINUTES} minutos.`);
        ok = false;
      } else if (start !== null && start < DAY_MINUTES && end <= start) {
        fail("endTime", "O fim da faixa deve ser depois do início.");
        ok = false;
      }
      if (ok) {
        startMinute = start;
        endMinute = end;
      }
    }
  }

  let note: string | null = null;
  if (CONTROL.test(v.note.replace(/\s/g, " "))) {
    fail("note", "A nota contém caracteres inválidos.");
    ok = false;
  } else {
    const cleaned = v.note.normalize("NFC").trim().replace(/\s+/g, " ");
    if (length(cleaned) > NOTE_MAX) {
      fail("note", `A nota pode ter até ${NOTE_MAX} caracteres.`);
      ok = false;
    } else if (cleaned !== "") note = cleaned;
  }

  return ok ? { weekdays, startMinute, endMinute, note } : null;
}

const PREFERENCE_FIELDS = {
  weekdays: z.array(z.string()),
  startTime: z.string(),
  endTime: z.string(),
  note: z.string(),
};

/** Profissional opcional: texto vazio = qualquer um que ofereça o serviço. */
function parseProfessional(raw: string, fail: Fail): { value: string | null; ok: boolean } {
  if (raw.trim() === "") return { value: null, ok: true };
  const id = uuidOf(raw);
  if (id === null) {
    fail("professionalId", "Profissional inválido.");
    return { value: null, ok: false };
  }
  return { value: id, ok: true };
}

/** Pôr alguém na espera: paciente e serviço (imutáveis depois) mais a preferência. */
export function addWaitlistSchema() {
  return z
    .object({ patientId: z.string(), serviceId: z.string(), professionalId: z.string(), ...PREFERENCE_FIELDS })
    .transform((v, ctx) => {
      let failed = false;
      const fail: Fail = (field, message) => {
        failed = true;
        ctx.addIssue({ code: "custom", path: [field], message });
      };
      const patientId = uuidOf(v.patientId);
      if (patientId === null) fail("patientId", "Paciente inválido.");
      const serviceId = uuidOf(v.serviceId);
      if (serviceId === null) fail("serviceId", "Serviço inválido.");
      const professional = parseProfessional(v.professionalId, fail);
      const preference = parsePreference(v, fail);
      if (failed || !patientId || !serviceId || !professional.ok || !preference) return z.NEVER;
      return { patientId, serviceId, professionalId: professional.value, ...preference };
    });
}

/** Editar só a preferência (profissional, dias, faixa, nota): paciente e serviço não mudam. */
export function updateWaitlistSchema() {
  return z.object({ id: z.string(), professionalId: z.string(), ...PREFERENCE_FIELDS }).transform((v, ctx) => {
    let failed = false;
    const fail: Fail = (field, message) => {
      failed = true;
      ctx.addIssue({ code: "custom", path: [field], message });
    };
    const id = uuidOf(v.id);
    if (id === null) fail("id", "Registro inválido.");
    const professional = parseProfessional(v.professionalId, fail);
    const preference = parsePreference(v, fail);
    if (failed || !id || !professional.ok || !preference) return z.NEVER;
    return { id, professionalId: professional.value, ...preference };
  });
}

/** Tirar da espera. */
export function removeWaitlistSchema() {
  return z.object({ id: z.string() }).transform((v, ctx) => {
    const id = uuidOf(v.id);
    if (id === null) {
      ctx.addIssue({ code: "custom", path: ["id"], message: "Registro inválido." });
      return z.NEVER;
    }
    return { id };
  });
}
