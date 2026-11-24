import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_NAME_MAX,
  displayName,
  sniffContentType,
  validateFile,
} from "./files";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);
const pad = (head: Uint8Array, total = 64) => {
  const out = new Uint8Array(Math.max(total, head.length));
  out.set(head);
  return out;
};

const PDF = pad(ascii("%PDF-1.7\n"));
const PNG = pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
const JPEG = pad(bytes(0xff, 0xd8, 0xff, 0xe0));
const WEBP = pad(new Uint8Array([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBP")]));

describe("sniffContentType (decide pelos bytes, nunca pelo nome nem pelo tipo do navegador)", () => {
  it("reconhece PDF, PNG, JPEG e WebP", () => {
    expect(sniffContentType(PDF)).toBe("application/pdf");
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(JPEG)).toBe("image/jpeg");
    expect(sniffContentType(WEBP)).toBe("image/webp");
  });

  it("recusa executável, SVG, HTML, script, zip e RIFF que não é WebP", () => {
    for (const head of [
      bytes(0x4d, 0x5a, 0x90, 0x00), // .exe
      ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      ascii("<!doctype html><script>alert(1)</script>"),
      ascii("<html></html>"),
      ascii("#!/bin/sh\nrm -rf /"),
      bytes(0x50, 0x4b, 0x03, 0x04), // zip/docx
      new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]),
    ]) {
      expect(sniffContentType(pad(head))).toBeNull();
    }
  });

  it("recusa vazio e arquivo curto demais para ter assinatura", () => {
    expect(sniffContentType(new Uint8Array())).toBeNull();
    expect(sniffContentType(bytes(0xff, 0xd8))).toBeNull();
  });

  it("assinatura só vale no começo do arquivo", () => {
    expect(sniffContentType(pad(new Uint8Array([0x20, ...ascii("%PDF-1.7")])))).toBeNull();
  });
});

describe("validateFile", () => {
  it("aceita um PDF pequeno e devolve o tipo pelos bytes", () => {
    expect(validateFile(PDF)).toEqual({ ok: true, contentType: "application/pdf" });
  });

  it("recusa arquivo vazio", () => {
    expect(validateFile(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
  });

  it("o limite é 4 MiB: exato passa, um byte a mais falha", () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(4 * 1024 * 1024);
    const exact = new Uint8Array(ATTACHMENT_MAX_BYTES);
    exact.set(PDF);
    expect(validateFile(exact)).toEqual({ ok: true, contentType: "application/pdf" });
    const over = new Uint8Array(ATTACHMENT_MAX_BYTES + 1);
    over.set(PDF);
    expect(validateFile(over)).toEqual({ ok: false, reason: "too-large" });
  });

  it("tamanho tem prioridade sobre tipo (não lê um arquivo enorme à toa)", () => {
    expect(validateFile(new Uint8Array(ATTACHMENT_MAX_BYTES + 1))).toEqual({ ok: false, reason: "too-large" });
  });

  it("recusa tipo não permitido", () => {
    expect(validateFile(pad(ascii("<svg></svg>")))).toEqual({ ok: false, reason: "bad-type" });
  });
});

describe("displayName (texto de exibição: nunca caminho, nunca invisível, sempre válido)", () => {
  it("mantém um nome comum", () => {
    expect(displayName("Ressonância joelho.pdf", "application/pdf")).toBe("Ressonância joelho.pdf");
  });

  it("tira o caminho: ../ e pastas do Windows", () => {
    expect(displayName("../../etc/passwd.pdf", "application/pdf")).toBe("passwd.pdf");
    expect(displayName("C:\\Users\\ana\\exame.png", "image/png")).toBe("exame.png");
  });

  it("tira controle e caracteres invisíveis ou de direção (RTL override)", () => {
    expect(displayName("exa\u0000me\u202e.pdf", "application/pdf")).toBe("exame.pdf");
    expect(displayName("a\u200bb.pdf", "application/pdf")).toBe("ab.pdf");
  });

  it("junta espaços e normaliza em NFC", () => {
    expect(displayName("  laudo   final \n .pdf ", "application/pdf")).toBe("laudo final.pdf");
    expect(displayName("cafe\u0301.pdf", "application/pdf")).toBe("caf\u00e9.pdf");
  });

  it("nome vazio, só ponto ou só invisível vira 'arquivo' com a extensão do tipo real", () => {
    expect(displayName("", "application/pdf")).toBe("arquivo.pdf");
    expect(displayName("   ", "image/jpeg")).toBe("arquivo.jpg");
    expect(displayName("..", "image/png")).toBe("arquivo.png");
    expect(displayName("\u200b\u202e", "image/webp")).toBe("arquivo.webp");
  });

  it("a extensão acompanha o TIPO REAL, não o que o nome diz (exe disfarçado de pdf)", () => {
    expect(displayName("fatura.exe", "application/pdf")).toBe("fatura.pdf");
    expect(displayName("foto.png", "image/jpeg")).toBe("foto.jpg");
    expect(displayName("laudo", "application/pdf")).toBe("laudo.pdf");
  });

  it("nome longo é cortado em 120 pontos de código, preservando a extensão", () => {
    const out = displayName(`${"a".repeat(300)}.pdf`, "application/pdf");
    expect([...out]).toHaveLength(ATTACHMENT_NAME_MAX);
    expect(out.endsWith(".pdf")).toBe(true);
    const emoji = displayName(`${"😀".repeat(300)}.png`, "image/png");
    expect([...emoji]).toHaveLength(ATTACHMENT_NAME_MAX);
    expect(emoji.endsWith(".png")).toBe(true);
  });
});
