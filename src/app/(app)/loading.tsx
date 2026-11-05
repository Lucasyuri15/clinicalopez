/**
 * Fronteira de carregamento de cada tela do app. O layout (menu) permanece montado
 * na navegação; o conteúdo de cada página lê a sessão (cookies) e por isso precisa
 * de um <Suspense> próprio para a navegação ser instantânea (Cache Components).
 */
export default function Loading() {
  return (
    <p role="status" className="text-muted-foreground">
      Carregando…
    </p>
  );
}
