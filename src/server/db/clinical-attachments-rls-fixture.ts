import { createHash, randomUUID } from "node:crypto";

import { type ClinicalSeed, seedClinical } from "./clinical-rls-fixture";
import type { Tx } from "./client";
import { clinicalAttachments } from "./schema";

/**
 * Cenário dos testes de RLS dos anexos clínicos (Fase 4B-1; `clinical-attachments-rls.test.ts` e
 * `clinical-attachments-rls-write.test.ts`). Só dados FICTÍCIOS; só `*.test.ts` importam. Parte do
 * cenário do prontuário (`seedClinical`: paciente `pShared` vinculado aos profissionais A e B) e
 * acrescenta, pelo dono do banco:
 *  attA          anexo de A no atendimento `apA`
 *  attA2         anexo de A SEM atendimento (exame trazido fora de consulta)
 *  attARemoved   anexo de A já REMOVIDO (lógico)
 *  attB          anexo de B no atendimento `apB`
 */
export type AttachmentSeed = ClinicalSeed & {
  attA: string;
  attA2: string;
  attARemoved: string;
  attB: string;
  /** Caminho do arquivo no Storage de cada anexo (só UUID). */
  paths: { attA: string; attA2: string; attARemoved: string; attB: string };
  attachmentsOfA: string[];
  attachmentsOfB: string[];
  allAttachments: string[];
};

const PAST = new Date("2026-01-20T00:00:00Z");

export async function seedClinicalAttachments(
  tx: Tx,
  ids: { admin: string; professional: string; professional2: string },
  label: string,
): Promise<AttachmentSeed> {
  const base = await seedClinical(tx, ids, label);
  const attachment = async (
    professionalId: string,
    login: string,
    appointmentId: string | null,
    name: string,
    removed = false,
  ) => {
    const path = randomUUID();
    const [row] = await tx
      .insert(clinicalAttachments)
      .values({
        patientId: base.pShared,
        professionalId,
        appointmentId,
        storagePath: path,
        originalName: `[teste] ${name}`,
        contentType: "application/pdf",
        sizeBytes: 1234,
        sha256: createHash("sha256").update(path).digest("hex"),
        createdBy: login,
        createdAt: PAST,
        removedAt: removed ? PAST : null,
        removedBy: removed ? login : null,
      })
      .returning({ id: clinicalAttachments.id });
    return { id: row!.id, path };
  };
  const a = await attachment(base.professionalA, ids.professional, base.apA, "exame de A.pdf");
  const a2 = await attachment(base.professionalA, ids.professional, null, "avulso de A.pdf");
  const aRemoved = await attachment(base.professionalA, ids.professional, base.apA2, "removido de A.pdf", true);
  const b = await attachment(base.professionalB, ids.professional2, base.apB, "exame de B.pdf");
  return {
    ...base,
    attA: a.id,
    attA2: a2.id,
    attARemoved: aRemoved.id,
    attB: b.id,
    paths: { attA: a.path, attA2: a2.path, attARemoved: aRemoved.path, attB: b.path },
    attachmentsOfA: [a.id, a2.id, aRemoved.id],
    attachmentsOfB: [b.id],
    allAttachments: [a.id, a2.id, aRemoved.id, b.id],
  };
}
