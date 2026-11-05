import type { Page } from "@playwright/test";

/**
 * Coleta violações de Content-Security-Policy da página. O Chromium registra cada uma como
 * mensagem de console (persiste entre navegações, ao contrário de `window`). Chame ANTES
 * de navegar; leia `violations` ao final.
 */
export function watchCsp(page: Page): { violations: string[] } {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy|Content-Security-Policy|Refused to (load|execute|apply|connect)/i.test(text)) {
      violations.push(text.slice(0, 200));
    }
  });
  return { violations };
}
