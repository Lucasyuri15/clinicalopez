// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildCsp, generateNonce } from "./csp";

/** Diretiva por nome → lista de fontes (a CSP é "nome fonte fonte; nome fonte"). */
function parse(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name as string, sources]),
  );
}

describe("generateNonce", () => {
  it("gera um valor base64 diferente a cada chamada", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      // 16 bytes aleatórios no mínimo (128 bits) → 24 caracteres em base64
      expect(nonce.length).toBeGreaterThanOrEqual(22);
    }
  });
});

describe("buildCsp (produção)", () => {
  const nonce = "bm9uY2UtZGUtdGVzdGU=";
  const policy = parse(buildCsp({ nonce, isDev: false }));

  it("scripts: só com o nonce e strict-dynamic, sem unsafe-inline nem unsafe-eval", () => {
    const script = policy.get("script-src") ?? [];
    expect(script).toContain(`'nonce-${nonce}'`);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("estilos: usam o nonce em vez de unsafe-inline", () => {
    const style = policy.get("style-src") ?? [];
    expect(style).toContain(`'nonce-${nonce}'`);
    expect(style).not.toContain("'unsafe-inline'");
  });

  it("atributos style=\"\" (next/image, componentes de UI) só via style-src-attr; <style> segue só com nonce", () => {
    // O nonce vale para <style> e <link>, não para atributos: sem isto o next/image
    // (`style="color:transparent"`) viola a CSP. Atributo de estilo não executa script.
    expect(policy.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
    expect(policy.get("style-src") ?? []).not.toContain("'unsafe-inline'");
    expect(policy.has("style-src-elem")).toBe(false); // herda de style-src (nonce)
  });

  it("libera data: só em img-src (QR do 2FA), nunca em scripts, estilos ou default-src", () => {
    expect(policy.get("img-src")).toContain("data:");
    for (const [name, sources] of policy) {
      if (name === "img-src") continue;
      expect(sources, name).not.toContain("data:");
    }
  });

  it("fecha o resto: objetos, base, formulários, frames e HTTP", () => {
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.has("upgrade-insecure-requests")).toBe(true);
  });

  it("não permite origens externas (sem curinga nem http/https genéricos)", () => {
    const all = [...policy.values()].flat();
    expect(all).not.toContain("*");
    expect(all).not.toContain("http:");
    expect(all).not.toContain("https:");
  });
});

describe("buildCsp (desenvolvimento)", () => {
  const policy = parse(buildCsp({ nonce: "abc", isDev: true }));

  it("permite unsafe-eval só em scripts (o React usa eval para erros no dev)", () => {
    expect(policy.get("script-src")).toContain("'unsafe-eval'");
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("não força https em http://localhost", () => {
    expect(policy.has("upgrade-insecure-requests")).toBe(false);
  });
});

describe("buildCsp (entrada)", () => {
  it.each(["", "a b", "a;b", "a'b", "a\nb"])(
    "recusa nonce inválido (%j): evita injetar diretivas na CSP",
    (nonce) => {
      expect(() => buildCsp({ nonce, isDev: false })).toThrow(/nonce/i);
    },
  );
});
