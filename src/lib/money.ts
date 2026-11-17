const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * Formata um valor em centavos inteiros como moeda brasileira.
 * Dinheiro é sempre guardado em centavos; a formatação só acontece na exibição.
 */
export function formatBRL(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(
      "O valor deve ser um número inteiro seguro de centavos.",
    );
  }
  // `+ 0` normaliza -0 para 0, evitando "-R$ 0,00".
  return brl.format((cents + 0) / 100);
}

// Inteiro com milhar em pontos de 3 em 3 dígitos (1.234.567) OU só dígitos; centavos opcionais (1 ou 2).
const BRL_INPUT = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Lê um valor digitado em reais (pt-BR) e devolve centavos inteiros, ou `null` se não for
 * um valor claro: "120", "120,5", "1.200,00" e "R$ 1.200,00" valem. Recusa vazio, negativo,
 * mais de 2 casas, vírgula sem centavos e ponto como decimal ("1200.50" é ambíguo com o
 * separador de milhar). Nunca adivinha.
 */
export function parseBRLToCents(input: string): number | null {
  const text = input.trim().replace(/^R\$\s*/, "");
  const match = BRL_INPUT.exec(text);
  if (!match) return null;
  const reais = Number((match[1] ?? "").replaceAll(".", ""));
  const centavos = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = reais * 100 + centavos;
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Centavos como texto para preencher um campo de valor: "150,00" (sem "R$" e sem milhar, para
 * quem edita não precisar apagar nada). Volta a ser lido igual por `parseBRLToCents`.
 */
export function formatCentsForInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError("O valor deve ser um número inteiro não negativo de centavos.");
  }
  const reais = Math.floor(cents / 100);
  return `${reais},${String(cents % 100).padStart(2, "0")}`;
}
