import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type AttachmentSeed, seedClinicalAttachments } from "./clinical-attachments-rls-fixture";
import type { Tx } from "./client";
import { attempt, createRlsHarness, hasDb } from "./rls-harness";

const BUCKET = "clinical-attachments";
const sorted = (list: string[]) => [...list].sort();

/**
 * Storage dos anexos clínicos (Fase 4B-1): o bucket privado e as políticas de `storage.objects`,
 * provados por SQL como cada papel (a API HTTP só repassa o JWT do usuário a estas mesmas políticas),
 * contra o Supabase DEV, só dados FICTÍCIOS, transações sempre revertidas. Regras:
 *  - quem LÊ o arquivo é quem lê a linha de `clinical_attachments` com aquele caminho (autor e admin),
 *    e o anexo REMOVIDO só o admin; quem não tem linha nem o próprio órfão não vê o objeto;
 *  - só o profissional ENVIA, para o bucket certo e com nome UUID; o órfão (sem linha) é do próprio
 *    autor e só ele o apaga; nunca há UPDATE; o arquivo com linha nunca é apagado;
 *  - `aal2` RESTRICTIVE em tudo; o bucket é privado, com limite de 4 MiB e só os 4 tipos.
 */
type StorageSeed = AttachmentSeed & { orphanA: string; orphanB: string };

describe.skipIf(!hasDb)("Storage dos anexos clínicos (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared(async (tx, ids): Promise<StorageSeed> => {
    const s = await seedClinicalAttachments(tx, ids, "Attachments Storage");
    const orphanA = randomUUID();
    const orphanB = randomUUID();
    const put = (name: string, owner: string) =>
      tx.execute(sql`insert into storage.objects (bucket_id, name, owner_id) values (${BUCKET}, ${name}, ${owner})`);
    await put(s.paths.attA, ids.professional);
    await put(s.paths.attA2, ids.professional);
    await put(s.paths.attARemoved, ids.professional);
    await put(s.paths.attB, ids.professional2);
    await put(orphanA, ids.professional);
    await put(orphanB, ids.professional2);
    return { ...s, orphanA, orphanB };
  });
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  const visible = async (tx: Tx, s: StorageSeed) => {
    const names = [s.paths.attA, s.paths.attA2, s.paths.attARemoved, s.paths.attB, s.orphanA, s.orphanB];
    const rows = await tx.execute<{ name: string }>(
      sql`select name from storage.objects where bucket_id = ${BUCKET} and name in (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`,
    );
    return sorted(rows.map((r) => r.name));
  };
  const put = (tx: Tx, name: string, owner: string, bucket = BUCKET) =>
    tx.execute(sql`insert into storage.objects (bucket_id, name, owner_id) values (${bucket}, ${name}, ${owner})`);

  describe("ler o arquivo", () => {
    it("o admin lê todos os arquivos com linha, inclusive o do anexo removido (não os órfãos)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await visible(tx, s)).toEqual(sorted([s.paths.attA, s.paths.attA2, s.paths.attARemoved, s.paths.attB]));
      });
    });

    it("o autor lê os arquivos dos anexos dele que não foram removidos e o próprio órfão; nunca o do colega", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await visible(tx, s)).toEqual(sorted([s.paths.attA, s.paths.attA2, s.orphanA]));
        await as(ids.professional2);
        expect(await visible(tx, s)).toEqual(sorted([s.paths.attB, s.orphanB]));
      });
    });

    it.each(["reception", "stranger", "inactive", "deleted"] as const)("usuário %s não lê arquivo nenhum", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await visible(tx, s)).toEqual([]);
      });
    });

    it.each(["admin", "professional"] as const)("%s com aal1 (só senha) não lê nada", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await visible(tx, s)).toEqual([]);
      });
    });

    it("profissional com cadastro INATIVO perde o acesso aos arquivos dele", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.execute(sql`update public.professionals set active = false where id = ${s.professionalA}`);
        await as(ids.professional);
        expect(await visible(tx, s)).toEqual([]);
      });
    });
  });

  describe("enviar o arquivo", () => {
    it("o profissional envia para o bucket dos anexos com nome UUID", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids.professional);
        await put(tx, randomUUID(), ids.professional);
      });
    });

    it.each(["admin", "reception", "stranger", "inactive", "deleted"] as const)("usuário %s não envia (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => put(x, randomUUID(), ids[who]))).toBe("42501");
      });
    });

    it("o profissional com aal1 não envia (42501)", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids.professional, "aal1");
        expect(await attempt(tx, (x) => put(x, randomUUID(), ids.professional))).toBe("42501");
      });
    });

    it("o dono do envio é quem envia: `owner_id` de outra pessoa ou vazio é recusado (42501)", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => put(x, randomUUID(), ids.professional2))).toBe("42501");
        expect(await attempt(tx, (x) => x.execute(sql`insert into storage.objects (bucket_id, name) values (${BUCKET}, ${randomUUID()})`))).toBe("42501");
      });
    });

    it("nome que não é UUID (pasta, ../, nome do paciente) e outro bucket são recusados (42501)", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids.professional);
        for (const name of ["pasta/arquivo", "../../etc/passwd", "maria-silva.pdf", `${randomUUID()}.pdf`]) {
          expect(await attempt(tx, (x) => put(x, name, ids.professional))).toBe("42501");
        }
        expect(await attempt(tx, (x) => put(x, randomUUID(), ids.professional, "outro-bucket"))).toBe("42501");
      });
    });
  });

  describe("apagar e alterar", () => {
    // O Supabase barra DELETE direto em `storage.objects` (gatilho `protect_delete`); a API do Storage
    // libera com esta variável de transação. O teste faz o mesmo para provar a POLÍTICA de DELETE.
    const remove = async (tx: Tx, name: string) => {
      await tx.execute(sql`select set_config('storage.allow_delete_query', 'true', true)`);
      return tx.execute(sql`delete from storage.objects where bucket_id = ${BUCKET} and name = ${name} returning id`);
    };
    const touch = (tx: Tx, name: string) =>
      tx.execute(sql`update storage.objects set name = ${randomUUID()} where bucket_id = ${BUCKET} and name = ${name} returning id`);

    it("o autor apaga o PRÓPRIO órfão (sem linha), para desfazer um envio que não foi registrado", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await remove(tx, s.orphanA)).toHaveLength(1);
      });
    });

    it("ninguém apaga o arquivo de um anexo com linha, nem o órfão do colega", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await remove(tx, s.paths.attA)).toHaveLength(0);
        expect(await remove(tx, s.orphanB)).toHaveLength(0);
        await as(ids.admin);
        expect(await remove(tx, s.paths.attA)).toHaveLength(0);
        expect(await remove(tx, s.orphanA)).toHaveLength(0);
      });
    });

    it("o órfão também some para o autor INATIVO (a regra do órfão não depende do que a RLS da tabela esconde)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.execute(sql`update public.professionals set active = false where id = ${s.professionalA}`);
        await as(ids.professional);
        expect(await remove(tx, s.orphanA)).toHaveLength(0);
        // e os arquivos com linha não viram "órfãos" só porque a linha ficou invisível
        expect(await remove(tx, s.paths.attA)).toHaveLength(0);
      });
    });

    it("ninguém altera objeto (sem política de UPDATE)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        for (const who of ["admin", "professional"] as const) {
          await as(ids[who]);
          expect(await touch(tx, s.paths.attA)).toHaveLength(0);
          expect(await touch(tx, s.orphanA)).toHaveLength(0);
        }
      });
    });
  });

  describe("catálogo", () => {
    it("o bucket é privado, com limite de 4 MiB e só PDF, JPEG, PNG e WebP", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const [bucket] = await tx.execute<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
          sql`select public, file_size_limit, allowed_mime_types from storage.buckets where id = ${BUCKET}`,
        );
        expect(bucket).toBeDefined();
        expect(bucket!.public).toBe(false);
        expect(Number(bucket!.file_size_limit)).toBe(4 * 1024 * 1024);
        expect(sorted(bucket!.allowed_mime_types)).toEqual(sorted(["application/pdf", "image/jpeg", "image/png", "image/webp"]));
      });
    });

    it("o aal1 não apaga nem o próprio órfão (42501 ou nenhuma linha)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional, "aal1");
        await tx.execute(sql`select set_config('storage.allow_delete_query', 'true', true)`);
        const rows = await tx.execute(sql`delete from storage.objects where bucket_id = ${BUCKET} and name = ${s.orphanA} returning id`);
        expect(rows).toHaveLength(0);
      });
    });

    it("storage.objects tem a política RESTRICTIVE de aal2 e nenhuma política da recepção, de UPDATE ou de ALL", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const restrictive = await tx.execute<{ policyname: string; qual: string }>(
          sql`select policyname, qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and permissive = 'RESTRICTIVE'`,
        );
        expect(restrictive.map((r) => r.policyname)).toContain("storage_objects_require_aal2");
        expect(restrictive.find((r) => r.policyname === "storage_objects_require_aal2")?.qual).toContain("aal2");
        const permissive = await tx.execute<{ cmd: string; qual: string | null; with_check: string | null }>(
          sql`select cmd, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects' and permissive = 'PERMISSIVE'`,
        );
        expect(permissive.length).toBeGreaterThan(0);
        expect(permissive.map((r) => r.cmd)).not.toContain("UPDATE");
        expect(permissive.map((r) => r.cmd)).not.toContain("ALL");
        for (const row of permissive) expect(`${row.qual ?? ""}${row.with_check ?? ""}`).not.toContain("reception");
      });
    });
  });
});
