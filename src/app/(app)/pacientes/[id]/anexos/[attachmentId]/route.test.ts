// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  openAttachmentForRequest: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("@/server/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/server/clinical/attachment-open", () => ({ openAttachmentForRequest: mocks.openAttachmentForRequest }));

import { GET } from "./route";

const PATIENT = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const ATTACHMENT = "2d1b5d4e-7f90-4b32-8c8d-5e4f3a2b1c00";
const USER = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id: PATIENT, attachmentId: ATTACHMENT }) };
const call = () => GET(new Request("http://localhost/x"), ctx);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue({ userId: USER, role: "professional", fullName: "Fictício" });
});

describe("GET /pacientes/[id]/anexos/[attachmentId] (abrir o anexo)", () => {
  it("só admin e profissional (a recepção é barrada antes de qualquer leitura)", async () => {
    mocks.requireRole.mockRejectedValue(new RedirectSignal("/dashboard?acesso=negado"));
    await expect(call()).rejects.toBeInstanceOf(RedirectSignal);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "professional");
    expect(mocks.openAttachmentForRequest).not.toHaveBeenCalled();
  });

  it("entrega os bytes com o tipo guardado e os cabeçalhos seguros; o usuário e o papel vêm da sessão", async () => {
    mocks.openAttachmentForRequest.mockResolvedValue({ ok: true, file: { bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf", name: "laudo.pdf" } });
    const response = await call();
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(mocks.openAttachmentForRequest).toHaveBeenCalledWith(
      { userId: USER, role: "professional" },
      { patientId: PATIENT, attachmentId: ATTACHMENT },
    );
  });

  it("anexo que não existe ou que a pessoa não enxerga: 404 sem corpo revelador, sem cache", async () => {
    mocks.openAttachmentForRequest.mockResolvedValue({ ok: false, reason: "not-found" });
    const response = await call();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("Anexo não encontrado.");
  });

  it("Storage fora do ar: 503 com texto fixo", async () => {
    mocks.openAttachmentForRequest.mockResolvedValue({ ok: false, reason: "unavailable" });
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Arquivo indisponível no momento. Tente de novo.");
  });
});
