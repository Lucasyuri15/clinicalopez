/**
 * CPF: guarda-se só os 11 dígitos. Aceita o que se digita ("529.982.247-25"), recusa o que é
 * ambíguo. A validação confere os dois dígitos verificadores; não prova que o CPF pertence a
 * alguém (isso só a Receita sabe).
 */
// `\d` é só ASCII em JavaScript: dígitos de outros alfabetos não passam.
const TYPED = /^[\d\s.-]+$/;
const ELEVEN_DIGITS = /^\d{11}$/;

/** Dígito verificador: soma ponderada dos `length` primeiros dígitos, pesos de `length + 1` até 2. */
function checkDigit(digits: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += Number(digits[i]) * (length + 1 - i);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/** Só aceita os 11 dígitos já normalizados (sem pontos nem traço). */
export function isValidCpf(digits: string): boolean {
  if (!ELEVEN_DIGITS.test(digits)) return false;
  // "00000000000", "11111111111"...: passam na conta, mas não são CPFs.
  if (/^(\d)\1{10}$/.test(digits)) return false;
  return checkDigit(digits, 9) === Number(digits[9]) && checkDigit(digits, 10) === Number(digits[10]);
}

/** Devolve os 11 dígitos ou `null` se o texto não for um CPF válido. */
export function normalizeCpf(input: string): string | null {
  const text = input.trim();
  if (text === "" || !TYPED.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  return isValidCpf(digits) ? digits : null;
}

/** "52998224725" → "529.982.247-25". Se não forem 11 dígitos, devolve o texto como está. */
export function formatCpf(digits: string): string {
  if (!ELEVEN_DIGITS.test(digits)) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}
