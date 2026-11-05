// @vitest-environment node
import { describe, expect, it } from "vitest";

import { clientIpFrom, UNKNOWN_IP } from "./client-ip";

const headers = (init: Record<string, string>) => new Headers(init);

describe("clientIpFrom", () => {
  it("lê o cabeçalho configurado (x-real-ip na Vercel)", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "203.0.113.7" }), "x-real-ip")).toBe("203.0.113.7");
  });

  it("o nome do cabeçalho não diferencia maiúsculas", () => {
    expect(clientIpFrom(headers({ "X-Real-IP": "203.0.113.7" }), "X-REAL-IP")).toBe("203.0.113.7");
  });

  it("sem o cabeçalho (ex.: dev local) usa o balde 'unknown'", () => {
    expect(clientIpFrom(headers({}), "x-real-ip")).toBe(UNKNOWN_IP);
  });

  it("ignora outros cabeçalhos: só o configurado vale (não dá para forjar por outro)", () => {
    const h = headers({ "x-forwarded-for": "198.51.100.1", "x-real-ip": "203.0.113.7" });
    expect(clientIpFrom(h, "x-real-ip")).toBe("203.0.113.7");
    expect(clientIpFrom(headers({ "x-forwarded-for": "198.51.100.1" }), "x-real-ip")).toBe(UNKNOWN_IP);
  });

  it("lista (x-forwarded-for): vale a ÚLTIMA entrada, a que o proxy confiável acrescentou", () => {
    const h = headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.5, 203.0.113.9" });
    expect(clientIpFrom(h, "x-forwarded-for")).toBe("203.0.113.9");
  });

  it("espaços ao redor são ignorados", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "  203.0.113.7 " }), "x-real-ip")).toBe("203.0.113.7");
  });

  it.each(["", "não-é-ip", "999.1.1.1", "1.2.3", "1.2.3.4.5", "203.0.113.7; drop table", "a".repeat(500)])(
    "valor inválido (%j) cai em 'unknown', nunca vira chave do banco",
    (value) => {
      expect(clientIpFrom(headers({ "x-real-ip": value }), "x-real-ip")).toBe(UNKNOWN_IP);
    },
  );

  it("IPv6: todo o bloco /64 compartilha o mesmo balde (um atacante tem 2^64 endereços)", () => {
    const a = clientIpFrom(headers({ "x-real-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }), "x-real-ip");
    const b = clientIpFrom(headers({ "x-real-ip": "2001:db8:1:2::1" }), "x-real-ip");
    const c = clientIpFrom(headers({ "x-real-ip": "2001:0DB8:0001:0002:0:0:0:ffff" }), "x-real-ip");
    expect(a).toBe("2001:0db8:0001:0002::/64");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("IPv6: /64 diferentes ficam em baldes diferentes", () => {
    const a = clientIpFrom(headers({ "x-real-ip": "2001:db8:1:2::1" }), "x-real-ip");
    const b = clientIpFrom(headers({ "x-real-ip": "2001:db8:1:3::1" }), "x-real-ip");
    expect(a).not.toBe(b);
  });

  it("IPv6 comprimido e com ID de zona", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "::1" }), "x-real-ip")).toBe("0000:0000:0000:0000::/64");
    expect(clientIpFrom(headers({ "x-real-ip": "fe80::1%eth0" }), "x-real-ip")).toBe("fe80:0000:0000:0000::/64");
  });

  it("aceita IP com porta e IPv6 entre colchetes (alguns proxies mandam assim), no mesmo balde do IP puro", () => {
    const v4 = clientIpFrom(headers({ "x-real-ip": "203.0.113.7" }), "x-real-ip");
    expect(clientIpFrom(headers({ "x-real-ip": "203.0.113.7:51234" }), "x-real-ip")).toBe(v4);
    const v6 = clientIpFrom(headers({ "x-real-ip": "2001:db8:1:2::1" }), "x-real-ip");
    expect(clientIpFrom(headers({ "x-real-ip": "[2001:db8:1:2::1]" }), "x-real-ip")).toBe(v6);
    expect(clientIpFrom(headers({ "x-real-ip": "[2001:db8:1:2::1]:443" }), "x-real-ip")).toBe(v6);
    expect(v4).toBe("203.0.113.7");
    expect(v6).toBe("2001:0db8:0001:0002::/64");
  });

  it.each(["203.0.113.7:", "203.0.113.7:abc", "203.0.113.7:123456", "[2001:db8::1", "[2001:db8::1]:x", "[203.0.113.7]", "[]"])(
    "porta ou colchetes malformados (%j) continuam virando 'unknown'",
    (value) => {
      expect(clientIpFrom(headers({ "x-real-ip": value }), "x-real-ip")).toBe(UNKNOWN_IP);
    },
  );

  it("IPv4 dentro de IPv6 (::ffff:a.b.c.d) vira o IPv4 (mesmo balde que o endereço puro)", () => {
    const mapped = clientIpFrom(headers({ "x-real-ip": "::ffff:203.0.113.7" }), "x-real-ip");
    expect(mapped).toBe("203.0.113.7");
    expect(mapped).toBe(clientIpFrom(headers({ "x-real-ip": "203.0.113.7" }), "x-real-ip"));
  });
});
