const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * Formata um valor em centavos inteiros como moeda brasileira.
 * Dinheiro é sempre guardado em centavos; a formatação só acontece na exibição.
 */
export function formatBRL(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError("O valor deve ser um número inteiro de centavos.");
  }
  return brl.format(cents / 100);
}
