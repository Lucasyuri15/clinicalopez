import { expect, test } from "@playwright/test";

test("a aplicação responde", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
});
