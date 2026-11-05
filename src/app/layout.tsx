import type { Metadata } from "next";
import { Fredoka, Inter } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "López + Saúde", template: "%s · López + Saúde" },
  description: "Agendamentos e gestão da clínica López + Saúde",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Renderiza TODA rota por requisição, inclusive as que não leem cookies (ex.: /login).
  // Sem isto o Next gera a página no build, onde não existe nonce, e a CSP bloqueia os
  // scripts. Ver src/lib/security/csp.ts e dynamic-rendering.test.ts.
  await connection();
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${fredoka.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
