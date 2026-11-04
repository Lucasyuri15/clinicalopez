import { expect, test } from "@playwright/test";

test.describe("linha de base de segurança", () => {
  test("responde com cabeçalhos de segurança", async ({ request }) => {
    const response = await request.get("/dashboard");
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["permissions-policy"]).toContain("microphone=()");
    expect(headers["strict-transport-security"]).toContain("max-age=");
  });

  test("não se identifica como Next.js", async ({ request }) => {
    const response = await request.get("/dashboard");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  });

  test("bloqueia indexação por buscadores", async ({ request, page }) => {
    const response = await request.get("/dashboard");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");

    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/Disallow:\s*\//);

    await page.goto("/dashboard");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });
});
