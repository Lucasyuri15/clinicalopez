import { SPECIALTIES, type Specialty } from "@/lib/catalog/labels";
import { wallParts } from "@/lib/datetime";

/** O mínimo que o agrupamento precisa de um atendimento (o `AgendaItem` da consulta serve). */
type Timed = { id: string; startsAt: Date };
type WithProfessional = Timed & { professionalId: string; professionalName: string; specialty: Specialty };

const byTime = (a: Timed, b: Timed) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id);
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

export type ProfessionalGroup<T> = {
  professionalId: string;
  professionalName: string;
  specialty: Specialty;
  items: T[];
};

/**
 * Atendimentos agrupados por profissional (especialidade na ordem do catálogo, depois o nome sem
 * diferenciar acento) e, dentro de cada um, por horário (o id desempata, para a ordem ser estável).
 * Não altera a lista recebida.
 */
export function groupByProfessional<T extends WithProfessional>(items: readonly T[]): ProfessionalGroup<T>[] {
  const groups = new Map<string, ProfessionalGroup<T>>();
  for (const item of [...items].sort(byTime)) {
    const group = groups.get(item.professionalId);
    if (group) group.items.push(item);
    else {
      groups.set(item.professionalId, {
        professionalId: item.professionalId,
        professionalName: item.professionalName,
        specialty: item.specialty,
        items: [item],
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      SPECIALTIES.indexOf(a.specialty) - SPECIALTIES.indexOf(b.specialty) ||
      collator.compare(a.professionalName, b.professionalName) ||
      a.professionalId.localeCompare(b.professionalId),
  );
}

export type DateGroup<T> = { date: string; items: T[] };

/**
 * Um grupo por data pedida (inclusive as vazias), na ordem pedida; o dia é o de BRASÍLIA
 * (`wallParts`), não o do relógio UTC. O que cair fora das datas é ignorado.
 */
export function groupByDate<T extends Timed>(items: readonly T[], dates: readonly string[]): DateGroup<T>[] {
  const groups = new Map<string, T[]>(dates.map((date) => [date, []]));
  for (const item of [...items].sort(byTime)) groups.get(wallParts(item.startsAt).date)?.push(item);
  return dates.map((date) => ({ date, items: groups.get(date) ?? [] }));
}
