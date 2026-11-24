import { describe, expect, it } from "vitest";

import { addendumSchema, finalizeNoteSchema, NOTE_MAX, saveNoteSchema } from "./schemas";

const APPOINTMENT = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const NOTE = "1c0a4c3d-6e8f-4a21-9b7c-4d3e2f1a0b99";

const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  result.error?.issues ?? [];

describe("saveNoteSchema", () => {
  it("aceita um texto e devolve o id em minúsculas e o corpo limpo", () => {
    const parsed = saveNoteSchema().safeParse({ appointmentId: ` ${APPOINTMENT.toUpperCase()} `, body: "  Dor lombar leve.  " });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ appointmentId: APPOINTMENT, body: "Dor lombar leve." });
  });

  it("preserva quebras de linha e tabulação (é texto clínico, não uma linha só)", () => {
    const parsed = saveNoteSchema().safeParse({ appointmentId: APPOINTMENT, body: "Queixa:\r\n\tdor\n\nConduta: repouso" });
    expect(parsed.data?.body).toBe("Queixa:\n\tdor\n\nConduta: repouso");
  });

  it("recusa corpo vazio ou só de espaços, com mensagem fixa", () => {
    for (const body of ["", "   ", "\n\n \t"]) {
      const parsed = saveNoteSchema().safeParse({ appointmentId: APPOINTMENT, body });
      expect(parsed.success).toBe(false);
      expect(issues(parsed)[0]).toMatchObject({ path: ["body"], message: "Escreva a evolução." });
    }
  });

  it("recusa byte nulo, caracteres de controle e de direção do texto", () => {
    for (const body of ["a\u0000b", "a\u0007b", "texto‮oculto", "a​b"]) {
      const parsed = saveNoteSchema().safeParse({ appointmentId: APPOINTMENT, body });
      expect(parsed.success).toBe(false);
      expect(issues(parsed)[0]?.path).toEqual(["body"]);
      // a mensagem explica o motivo (texto copiado do WhatsApp ou do Word costuma trazer marcas invisíveis)
      expect(issues(parsed)[0]?.message).toMatch(/invisíveis ou de controle/);
    }
  });

  it("o limite conta pontos de código: 20 000 passa, 20 001 falha, emoji vale 1", () => {
    expect(NOTE_MAX).toBe(20_000);
    expect(saveNoteSchema().safeParse({ appointmentId: APPOINTMENT, body: "a".repeat(NOTE_MAX) }).success).toBe(true);
    expect(saveNoteSchema().safeParse({ appointmentId: APPOINTMENT, body: "a".repeat(NOTE_MAX + 1) }).success).toBe(false);
    expect(saveNoteSchema().safeParse({ appointmentId: APPOINTMENT, body: "😀".repeat(NOTE_MAX) }).success).toBe(true);
    expect(saveNoteSchema().safeParse({ appointmentId: APPOINTMENT, body: "😀".repeat(NOTE_MAX + 1) }).success).toBe(false);
  });

  it("recusa atendimento com id inválido", () => {
    const parsed = saveNoteSchema().safeParse({ appointmentId: "não-é-uuid", body: "texto" });
    expect(parsed.success).toBe(false);
    expect(issues(parsed)[0]).toMatchObject({ path: ["appointmentId"], message: "Atendimento inválido." });
  });

  it("nenhuma mensagem de erro repete o texto enviado", () => {
    const secret = "SEGREDO-CLINICO-123";
    for (const input of [
      { appointmentId: "x", body: secret },
      { appointmentId: APPOINTMENT, body: `${secret}\u0000` },
      { appointmentId: APPOINTMENT, body: secret.repeat(NOTE_MAX) },
    ]) {
      const parsed = saveNoteSchema().safeParse(input);
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(issues(parsed))).not.toContain(secret);
    }
  });
});

describe("addendumSchema", () => {
  it("aceita nota e texto; mensagem de vazio fala em adendo", () => {
    expect(addendumSchema().safeParse({ noteId: NOTE, body: " Correção: lado direito. " }).data).toEqual({
      noteId: NOTE,
      body: "Correção: lado direito.",
    });
    const empty = addendumSchema().safeParse({ noteId: NOTE, body: "  " });
    expect(issues(empty)[0]).toMatchObject({ path: ["body"], message: "Escreva o adendo." });
  });

  it("recusa nota com id inválido e texto com controle ou acima do limite", () => {
    expect(issues(addendumSchema().safeParse({ noteId: "1", body: "ok" }))[0]).toMatchObject({
      path: ["noteId"],
      message: "Evolução inválida.",
    });
    expect(addendumSchema().safeParse({ noteId: NOTE, body: "a\u0000" }).success).toBe(false);
    expect(addendumSchema().safeParse({ noteId: NOTE, body: "a".repeat(NOTE_MAX + 1) }).success).toBe(false);
  });
});

describe("finalizeNoteSchema", () => {
  it("só pede o id da evolução", () => {
    expect(finalizeNoteSchema().safeParse({ noteId: NOTE.toUpperCase() }).data).toEqual({ noteId: NOTE });
    expect(issues(finalizeNoteSchema().safeParse({ noteId: "" }))[0]).toMatchObject({
      path: ["noteId"],
      message: "Evolução inválida.",
    });
  });
});
