import { describe, expect, it } from "vitest";

import { downloadHeaders } from "./download";

describe("downloadHeaders (cabeçalhos da entrega do anexo)", () => {
  it("nunca deixa o navegador adivinhar o tipo nem guardar o arquivo em cache", () => {
    const headers = downloadHeaders({ contentType: "application/pdf", name: "laudo.pdf", size: 10 });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Cache-Control"]).toBe("private, no-store");
    expect(headers["Content-Type"]).toBe("application/pdf");
    expect(headers["Content-Length"]).toBe("10");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });

  it("PDF baixa (attachment); imagem abre na aba (inline)", () => {
    expect(downloadHeaders({ contentType: "application/pdf", name: "a.pdf", size: 1 })["Content-Disposition"]).toMatch(/^attachment;/);
    for (const contentType of ["image/png", "image/jpeg", "image/webp"] as const) {
      expect(downloadHeaders({ contentType, name: "a.png", size: 1 })["Content-Disposition"]).toMatch(/^inline;/);
    }
  });

  it("o nome vai codificado (UTF-8) e com um equivalente ASCII, sem aspas, barras nem quebras de linha que injetem cabeçalho", () => {
    const disposition = downloadHeaders({ contentType: "application/pdf", name: 'Ressonância "joelho"\\x\r\nSet-Cookie: a=b.pdf', size: 1 })["Content-Disposition"]!;
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).toContain("filename*=UTF-8''Resson%C3%A2ncia");
    const ascii = /filename="([^"]*)"/.exec(disposition)?.[1] ?? "";
    expect(ascii).toMatch(/^[A-Za-z0-9._ -]+$/);
    expect(ascii).not.toContain('"');
  });

  it("o apóstrofo e os parênteses do nome também são codificados em filename*", () => {
    const disposition = downloadHeaders({ contentType: "image/png", name: "foto (1) d'ana.png", size: 1 })["Content-Disposition"]!;
    const encoded = /filename\*=UTF-8''(.*)$/.exec(disposition)?.[1] ?? "";
    expect(encoded).not.toMatch(/['()*]/);
  });
});
