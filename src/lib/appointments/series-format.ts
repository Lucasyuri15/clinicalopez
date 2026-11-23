import { formatDateBR, formatTimeBR, wallParts } from "@/lib/datetime";
import { weekdayLabel } from "@/lib/schedule/time";

/**
 * Texto das datas de uma série na prévia e no resumo: "Segunda-feira, 02/06/2031 às 14:00". Recebe o
 * instante UTC (texto ISO, como as ações devolvem) e mostra SEMPRE o horário de Brasília: o dia da
 * semana sai do relógio de parede (`wallParts`), não do UTC, que viraria o dia à noite.
 */
export function formatSeriesSlot(iso: string): string {
  const instant = new Date(iso);
  return `${weekdayLabel(wallParts(instant).weekday)}, ${formatDateBR(instant)} às ${formatTimeBR(instant)}`;
}

/** Quantas datas da prévia cabem e quantas não (`reason` nulo = cabe). */
export function previewSummary(rows: readonly { reason: string | null }[]): { fits: number; skipped: number; total: number } {
  const fits = rows.filter((row) => row.reason === null).length;
  return { fits, skipped: rows.length - fits, total: rows.length };
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/**
 * O andamento da série para o detalhe do atendimento: "Sessão 3 de 10 · 2 realizadas · 7 restantes".
 * Faltas e canceladas só entram quando existem. Sem posição (a própria sessão foi cancelada), diz isso.
 */
export function seriesProgressText(series: {
  position: number | null;
  total: number;
  done: number;
  noShow: number;
  remaining: number;
  cancelled: number;
}): string {
  const parts = [
    series.position === null ? "Sessão cancelada" : `Sessão ${series.position} de ${series.total}`,
    plural(series.done, "realizada", "realizadas"),
  ];
  if (series.noShow > 0) parts.push(plural(series.noShow, "falta", "faltas"));
  parts.push(plural(series.remaining, "restante", "restantes"));
  if (series.cancelled > 0) parts.push(plural(series.cancelled, "cancelada", "canceladas"));
  return parts.join(" · ");
}

/** O selo discreto do cartão da agenda ("Série 3/10"); só a equipe o recebe. */
export function seriesBadgeText(series: { position: number | null; total: number }): string {
  return series.position === null ? "Série" : `Série ${series.position}/${series.total}`;
}

/** O resumo da prévia: "1 de 3 datas cabem; 2 não cabem." (singular e plural corretos). */
export function previewSummaryText(rows: readonly { reason: string | null }[]): string {
  const { fits, skipped, total } = previewSummary(rows);
  const head = `${fits} de ${total} ${total === 1 ? "data cabe" : "datas cabem"}`;
  return skipped > 0 ? `${head}; ${skipped} ${skipped === 1 ? "não cabe" : "não cabem"}.` : `${head}.`;
}

/** A frase que abre o resumo depois de CRIAR com datas puladas. */
export function createdSummaryText(created: number, skipped: number): string {
  const made = `${created} ${created === 1 ? "sessão criada" : "sessões criadas"}.`;
  return skipped === 1
    ? `${made} Esta data não coube e ficou de fora:`
    : `${made} Estas ${skipped} datas não couberam e ficaram de fora:`;
}

/** A frase que abre o resumo depois de REMARCAR daqui para frente com sessões que não couberam. */
export function unmovedSummaryText(moved: number, unmoved: number): string {
  const done = moved === 0 ? "Nenhuma sessão remarcada." : `${moved} ${moved === 1 ? "sessão remarcada" : "sessões remarcadas"}.`;
  return unmoved === 1
    ? `${done} Esta sessão não coube no novo horário e ficou onde estava:`
    : `${done} Estas ${unmoved} sessões não couberam no novo horário e ficaram onde estavam:`;
}
