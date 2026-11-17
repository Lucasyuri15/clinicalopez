/** Situação de um cadastro. Não depende só da cor: o texto "Ativo"/"Inativo" está sempre visível. */
export function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? "rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
          : "rounded-full border border-dashed border-muted-foreground/50 px-2 py-0.5 text-xs font-medium text-muted-foreground"
      }
    >
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}
