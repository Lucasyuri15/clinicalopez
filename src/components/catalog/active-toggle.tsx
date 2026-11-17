import { Button } from "@/components/ui/button";

/**
 * Ativa ou desativa um cadastro. Formulário simples ligado direto a uma Server Action (sem JS
 * no cliente); a ação revalida o administrador no servidor.
 */
export function ActiveToggle({
  action,
  id,
  active,
  name,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  active: boolean;
  /** Nome do cadastro, para o rótulo acessível ("Desativar Sessão de fisioterapia"). */
  name: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <Button type="submit" variant="outline" size="sm" className="h-10 md:h-7" aria-label={`${active ? "Desativar" : "Ativar"} ${name}`}>
        {active ? "Desativar" : "Ativar"}
      </Button>
    </form>
  );
}
