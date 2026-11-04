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
