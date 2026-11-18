/** Unidades da Federação (sigla), para o campo "Estado" do endereço. */
export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export type Uf = (typeof UFS)[number];

/** "1990-05-10" → "10/05/1990". Sem `Date`: a data de nascimento é de calendário, sem fuso. */
export function formatBirthDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

/** "36 anos", "1 ano" e "menos de 1 ano" (bebê não é "0 anos"). */
export function formatAge(years: number): string {
  if (years < 1) return "menos de 1 ano";
  return years === 1 ? "1 ano" : `${years} anos`;
}
