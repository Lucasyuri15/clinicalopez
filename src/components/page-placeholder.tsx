import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PagePlaceholderProps = {
  title: string;
  description: string;
};

/** Tela provisória até a fase correspondente do PRD ser implementada. */
export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Em construção</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          Esta área será entregue em uma próxima fase do projeto.
        </CardContent>
      </Card>
    </div>
  );
}
