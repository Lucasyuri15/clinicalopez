/**
 * Telefone brasileiro: guarda-se só dígitos (DDD + número, 10 ou 11), sem código do país.
 * Aceita o que se digita ("(11) 91234-5678", "+55 11 91234-5678"), recusa o que é ambíguo.
 */
// `\d` é só ASCII em JavaScript: dígitos de outros alfabetos não passam.
const TYPED = /^[\d\s().+-]+$/;

/**
 * Devolve só os dígitos (DDD + número) ou `null` se não for um telefone brasileiro claro:
 * DDD de 11 a 99 (sem zero), celular de 11 dígitos começando em 9 e fixo de 10 dígitos
 * começando em 2 a 5. Remove o código do país (55) quando vem junto.
 */
export function normalizePhone(input: string): string | null {
  const text = input.trim();
  if (text === "" || !TYPED.test(text)) return null;

  let digits = text.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (!/^[1-9][1-9]/.test(digits)) return null; // DDD

  const first = digits[2] ?? "";
  if (digits.length === 11) return first === "9" ? digits : null; // celular
  return /[2-5]/.test(first) ? digits : null; // fixo
}

/** "11912345678" → "(11) 91234-5678". Se não for um número de 10 ou 11 dígitos, devolve o texto como está. */
export function formatPhone(digits: string): string {
  if (!/^\d{10,11}$/.test(digits)) return digits;
  const area = digits.slice(0, 2);
  const local = digits.slice(2);
  const split = local.length - 4;
  return `(${area}) ${local.slice(0, split)}-${local.slice(split)}`;
}
