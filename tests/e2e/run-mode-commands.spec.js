const { test, expect } = require("@playwright/test");

async function commandLabels(page) {
  await page.waitForFunction(() => document.querySelectorAll("#toioCommandOutput .command-label").length > 0);
  return page.locator("#toioCommandOutput .command-label").allTextContents();
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  page.on("console", (message) => {
    if (message.type() === "error") throw new Error(message.text());
  });
  await page.addInitScript(() => window.localStorage.clear());
});

test("run mode changes produce different generated command labels", async ({ page }) => {
  await page.goto("/");

  await page.selectOption("#sampleSelect", "samples/json/line-1.json");
  await page.click("#simulateBtn");

  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const positionLabels = await commandLabels(page);
  expect(positionLabels.length).toBeGreaterThan(0);
  expect(positionLabels.some((label) => label.startsWith("move: move") || label.startsWith("move: rotate"))).toBe(true);
  expect(positionLabels.some((label) => label.includes("x:") && label.includes("theta:"))).toBe(true);

  await page.selectOption("#runMode", "dead");

  await expect(page.locator("#simStatus")).toHaveClass(/warn/);
  await expect(page.locator("#toioCommandOutput")).toHaveText("Simulate after drawing to show commands.");
  await expect(page.locator("#sb3ExportBtn")).toBeDisabled();

  await page.click("#simulateBtn");

  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  await expect(page.locator("#sb3ExportBtn")).toBeEnabled();

  const deadLabels = await commandLabels(page);
  expect(deadLabels.length).toBeGreaterThan(0);
  expect(deadLabels).not.toEqual(positionLabels);
  expect(deadLabels.some((label) => label.startsWith("move: draw") || label.startsWith("move: travel"))).toBe(true);
  expect(deadLabels.some((label) => label.includes("speed:") || (label.includes("R:") && label.includes("L:")))).toBe(true);
  expect(deadLabels.some((label) => label.includes("x:") || label.includes("theta:"))).toBe(false);
});
