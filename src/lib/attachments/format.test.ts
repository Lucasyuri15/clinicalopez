import { describe, expect, it } from "vitest";

import { fitWithin, formatSize, typeLabel } from "./format";

describe("formatSize (pt-BR)", () => {
  it("bytes, KB e MB com vírgula decimal", () => {
    expect(formatSize(0)).toBe("0 KB");
    expect(formatSize(1)).toBe("1 KB");
    expect(formatSize(850 * 1024)).toBe("850 KB");
    expect(formatSize(1024 * 1024)).toBe("1,0 MB");
    expect(formatSize(1.5 * 1024 * 1024)).toBe("1,5 MB");
    expect(formatSize(4 * 1024 * 1024)).toBe("4,0 MB");
  });
});

describe("typeLabel", () => {
  it("rótulo curto de cada tipo", () => {
    expect(typeLabel("application/pdf")).toBe("PDF");
    expect(typeLabel("image/jpeg")).toBe("Imagem JPEG");
    expect(typeLabel("image/png")).toBe("Imagem PNG");
    expect(typeLabel("image/webp")).toBe("Imagem WebP");
    expect(typeLabel("text/plain")).toBe("Arquivo");
  });
});

describe("fitWithin (reduz a foto mantendo a proporção)", () => {
  it("não aumenta nem mexe no que já cabe", () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(2000, 2000, 2000)).toEqual({ width: 2000, height: 2000 });
  });

  it("reduz o lado maior para o limite e arredonda o outro", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(4001, 3001, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it("nunca devolve lado zero (foto muito comprida)", () => {
    expect(fitWithin(100000, 10, 2000)).toEqual({ width: 2000, height: 1 });
  });
});
