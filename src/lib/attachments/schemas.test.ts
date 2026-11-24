import { describe, expect, it } from "vitest";

import { removeAttachmentSchema, uploadAttachmentSchema } from "./schemas";

const PATIENT = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const APPOINTMENT = "1c0a4c3d-6e8f-4a21-9b7c-4d3e2f1a0b99";
const ATTACHMENT = "2d1b5d4e-7f90-4b32-8c8d-5e4f3a2b1c00";

const issues = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  result.error?.issues ?? [];

describe("uploadAttachmentSchema", () => {
  it("aceita paciente e atendimento, normalizando o id em minúsculas", () => {
    const parsed = uploadAttachmentSchema().safeParse({
      patientId: ` ${PATIENT.toUpperCase()} `,
      appointmentId: APPOINTMENT,
    });
    expect(parsed.data).toEqual({ patientId: PATIENT, appointmentId: APPOINTMENT });
  });

  it("o atendimento é opcional: vazio, só espaços ou ausente viram null", () => {
    for (const appointmentId of ["", "   ", undefined]) {
      const parsed = uploadAttachmentSchema().safeParse({ patientId: PATIENT, appointmentId });
      expect(parsed.data).toEqual({ patientId: PATIENT, appointmentId: null });
    }
  });

  it("recusa paciente inválido e atendimento preenchido mas inválido, com mensagem fixa", () => {
    const badPatient = uploadAttachmentSchema().safeParse({ patientId: "x", appointmentId: "" });
    expect(issues(badPatient)[0]).toMatchObject({ path: ["patientId"], message: "Paciente inválido." });
    const badAppointment = uploadAttachmentSchema().safeParse({ patientId: PATIENT, appointmentId: "segredo-123" });
    expect(issues(badAppointment)[0]).toMatchObject({ path: ["appointmentId"], message: "Atendimento inválido." });
    expect(JSON.stringify(issues(badAppointment))).not.toContain("segredo-123");
  });
});

describe("removeAttachmentSchema", () => {
  it("só pede o id do anexo", () => {
    expect(removeAttachmentSchema().safeParse({ attachmentId: ATTACHMENT.toUpperCase() }).data).toEqual({
      attachmentId: ATTACHMENT,
    });
    expect(issues(removeAttachmentSchema().safeParse({ attachmentId: "" }))[0]).toMatchObject({
      path: ["attachmentId"],
      message: "Anexo inválido.",
    });
  });
});
