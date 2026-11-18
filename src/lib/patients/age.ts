/** Maioridade civil no Brasil. */
export const ADULT_AGE = 18;

/** Dia em que se completa `years` anos (29/02 vira 1º/03 em ano sem 29/02): "AAAA-MM-DD". */
function anniversary(birthDate: string, years: number): string {
  const [year, month, day] = birthDate.split("-") as [string, string, string];
  const targetYear = Number(year) + years;
  const leap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || targetYear % 400 === 0;
  const pad = String(targetYear).padStart(4, "0");
  return month === "02" && day === "29" && !leap ? `${pad}-03-01` : `${pad}-${month}-${day}`;
}

/**
 * Se a pessoa nascida em `birthDate` ainda não completou `years` anos em `today` (ambas
 * "AAAA-MM-DD"). Quem nasceu em 29/02 completa os anos em 1º/03 nos anos sem 29/02.
 * Compara textos de data de calendário: sem fuso, sem `Date`.
 */
export function isUnderAge(birthDate: string, today: string, years: number = ADULT_AGE): boolean {
  return today < anniversary(birthDate, years);
}

/** Anos completos em `today` (ambas "AAAA-MM-DD"), com a mesma regra de 29/02 de `isUnderAge`. */
export function ageInYears(birthDate: string, today: string): number {
  let years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (years < 0) return 0;
  if (today < anniversary(birthDate, years)) years -= 1;
  return Math.max(years, 0);
}
