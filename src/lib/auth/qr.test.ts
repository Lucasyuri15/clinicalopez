import { describe, expect, it } from "vitest";

import { toSvgDataUri } from "./qr";

const SVG = '<?xml version="1.0"?>\n<svg width="10" height="10" xmlns="http://www.w3.org/2000/svg"><path fill="#000"/></svg>\n';

describe("toSvgDataUri", () => {
  it("converte o SVG do Supabase numa URL de dados bem formada (sem quebra de linha final)", () => {
    const uri = toSvgDataUri(`data:image/svg+xml;utf-8,${SVG}`);
    expect(uri).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG.trim())}`);
    expect(uri).not.toMatch(/\s$/);
    expect(uri).not.toMatch(/[<>"# ]/); // tudo codificado
  });

  it("é reversível: decodificar devolve o SVG original (sem espaços nas pontas)", () => {
    const uri = toSvgDataUri(`data:image/svg+xml;utf-8,${SVG}`);
    expect(decodeURIComponent(uri!.split(",")[1] ?? "")).toBe(SVG.trim());
  });

  it("recusa qualquer coisa que não seja uma imagem SVG em data URI", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "https://evil.example/qr.svg",
      "data:image/png;base64,AAAA",
      "",
    ]) {
      expect(toSvgDataUri(bad), bad).toBeNull();
    }
  });

  it("recusa SVG sem conteúdo", () => {
    expect(toSvgDataUri("data:image/svg+xml;utf-8,   ")).toBeNull();
  });
});
