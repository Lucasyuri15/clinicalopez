import { isIP } from "node:net";

/** Balde para quando não há IP confiável (ex.: dev local). Todos esses acessos dividem a contagem. */
export const UNKNOWN_IP = "unknown";

/** Cabeçalho que a Vercel define com o IP do cliente (outro host: `CLIENT_IP_HEADER`). */
export const DEFAULT_CLIENT_IP_HEADER = "x-real-ip";

const MAX_HEADER_LENGTH = 200;

/** Expande um IPv6 válido (já checado com `isIP`) para 8 grupos de 4 hex, minúsculos. */
function expandIpv6(address: string): string[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);

  // Cauda IPv4 (ex.: ::ffff:203.0.113.7) vira dois grupos hex.
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    const parts = text.slice(lastColon + 1).split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = parts;
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [head = "", tail, ...extra] = text.split("::");
  if (extra.length > 0) return null;
  const headGroups = head ? head.split(":") : [];
  if (tail === undefined) {
    return headGroups.length === 8 ? headGroups.map((g) => g.padStart(4, "0")) : null;
  }
  const tailGroups = tail ? tail.split(":") : [];
  const fill = 8 - headGroups.length - tailGroups.length;
  if (fill < 1) return null; // "::" cobre ao menos um grupo
  return [...headGroups, ...Array<string>(fill).fill("0"), ...tailGroups].map((g) =>
    g.padStart(4, "0"),
  );
}

/**
 * Tira a porta de formas que alguns proxies mandam (`1.2.3.4:80`, `[2001:db8::1]:443`,
 * `[2001:db8::1]`). Devolve "" se não for uma dessas formas com IP válido.
 */
function withoutPort(value: string): string {
  if (isIP(value)) return value; // IPv4 ou IPv6 puro (o IPv6 já tem ':' e não é porta)
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) return isIP(bracketed[1] ?? "") === 6 ? (bracketed[1] ?? "") : "";
  const v4 = /^([^:]+):\d{1,5}$/.exec(value);
  return v4 && isIP(v4[1] ?? "") === 4 ? (v4[1] ?? "") : "";
}

/** Normaliza para a chave de contagem: IPv4 puro, ou o prefixo /64 de um IPv6. */
function normalize(address: string): string {
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return UNKNOWN_IP;

  const groups = expandIpv6(address);
  if (!groups) return UNKNOWN_IP;

  // IPv4 mapeado em IPv6 (::ffff:a.b.c.d) = o mesmo cliente que o IPv4 puro.
  if (groups.slice(0, 5).every((g) => g === "0000") && groups[5] === "ffff") {
    const hi = Number.parseInt(groups[6] ?? "0", 16);
    const lo = Number.parseInt(groups[7] ?? "0", 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }

  // Quem controla um IPv6 residencial/de servidor controla um /64 inteiro (2^64 endereços):
  // contar por endereço exato deixaria o atacante trocar de IP a cada tentativa.
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/**
 * IP do cliente a partir do cabeçalho que a PLATAFORMA define (na Vercel, `x-real-ip`;
 * configurável por `CLIENT_IP_HEADER` para outro host). Só o cabeçalho configurado vale:
 * um cliente não consegue forjar o IP por outro. Em lista (`x-forwarded-for`) vale a ÚLTIMA
 * entrada, a que o proxy confiável acrescentou. Valor ausente ou inválido → `unknown`.
 */
export function clientIpFrom(
  headers: { get(name: string): string | null },
  headerName: string,
): string {
  const raw = headers.get(headerName);
  if (!raw || raw.length > MAX_HEADER_LENGTH) return UNKNOWN_IP;
  const last = withoutPort(raw.split(",").pop()?.trim() ?? "");
  return last ? normalize(last) : UNKNOWN_IP;
}
