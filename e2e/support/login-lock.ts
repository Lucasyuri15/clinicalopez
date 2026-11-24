import fs from "node:fs";
import path from "node:path";

/**
 * Cada projeto (desktop, celular) tem UM login por papel, e o banco só deixa esse login ligado a UM
 * profissional ativo por vez. Os specs que ligam o login do profissional a um profissional de teste
 * (`seedProfessionals(tag, { linkProfileId })`) não podem rodar ao mesmo tempo, e o Playwright roda
 * ARQUIVOS em paralelo. Este "cadeado" de arquivo (criar um diretório é atômico) faz um spec esperar o
 * outro terminar o bloco inteiro. Um cadeado esquecido por um processo morto vence em 5 minutos.
 */
const DIR = path.join(process.cwd(), "e2e", ".auth", "locks");
const STALE_MS = 5 * 60_000;

export async function acquireLoginLock(name: string): Promise<() => void> {
  fs.mkdirSync(DIR, { recursive: true });
  const lock = path.join(DIR, `${name}.lock`);
  for (;;) {
    try {
      fs.mkdirSync(lock);
      return () => fs.rmSync(lock, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
      } catch {
        // outro processo soltou o cadeado entre a checagem e a limpeza: tenta de novo
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
