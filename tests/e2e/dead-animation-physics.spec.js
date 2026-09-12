const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.clock.install();
});

test("edited parallel-line animation uses the edited turn and remains physically continuous", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/line-2.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const turnRow = page.locator(".command-row").filter({ hasText: "move: turn" }).first();
  await expect(turnRow).toBeVisible();
  const turnDuration = turnRow.locator('input[data-command-key="durationMs"]');
  await turnDuration.fill("900");
  await turnDuration.blur();
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const timeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  expect(timeline).not.toBeNull();
  const turnItem = timeline.items.find((item) => item.type === "turn" && item.role === "turn-to-travel");
  expect(turnItem).toBeDefined();
  expect(turnItem.durationMs).toBe(900);
  const turnIndex = turnItem.commandIndex;
  const travelItem = timeline.items.find((item) => item.commandIndex > turnIndex);
  expect(travelItem).toBeDefined();

  const snapshotAt = async (elapsedMs) => {
    await page.evaluate((time) => window.__toioTest.seekAnimation(time), elapsedMs);
    return page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  };

  const commandAt = (snapshot, index) => snapshot.commands[index];
  const turnStart = await snapshotAt(turnItem.startMs + 1);
  const turnMiddle = await snapshotAt(turnItem.startMs + turnItem.durationMs / 2);
  const turnEnd = await snapshotAt(turnItem.endMs - 1);
  const travelStart = await snapshotAt(travelItem.startMs);

  const startPose = commandAt(turnStart, turnIndex);
  const middlePose = commandAt(turnMiddle, turnIndex);
  const endPose = commandAt(turnEnd, turnIndex);
  const travelPose = commandAt(travelStart, travelItem.commandIndex);
  expect(startPose.durationMs).toBe(900);
  expect(Math.hypot(middlePose.x - startPose.x, middlePose.y - startPose.y)).toBeLessThan(0.5);
  expect(Math.hypot(endPose.x - startPose.x, endPose.y - startPose.y)).toBeLessThan(0.5);
  expect(Math.abs(middlePose.theta - startPose.theta)).toBeGreaterThan(1);
  expect(Math.hypot(travelPose.x - endPose.x, travelPose.y - endPose.y)).toBeLessThan(0.5);

  const allFrames = [];
  for (let elapsedMs = 0; elapsedMs <= timeline.items.at(-1).endMs; elapsedMs += 25) {
    const snapshot = await snapshotAt(elapsedMs);
    const item = snapshot.items.find((candidate) => elapsedMs >= candidate.startMs && elapsedMs < candidate.endMs);
    if (!item) continue;
    const command = snapshot.commands[item.commandIndex];
    if (command?.x == null || command?.y == null || command?.theta == null) continue;
    allFrames.push({ elapsedMs, commandIndex: item.commandIndex, itemStartMs: item.startMs, itemEndMs: item.endMs, durationMs: command.durationMs, x: command.x, y: command.y, theta: command.theta });
  }
  expect(allFrames.length).toBeGreaterThan(10);
  for (let index = 1; index < allFrames.length; index += 1) {
    const previous = allFrames[index - 1];
    const current = allFrames[index];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    expect(distance, `jump ${distance} between ${JSON.stringify(previous)} and ${JSON.stringify(current)}`).toBeLessThan(10);
    const angleDelta = Math.abs(((current.theta - previous.theta + 180) % 360) - 180);
    expect(angleDelta, `rotation jump ${angleDelta} between ${JSON.stringify(previous)} and ${JSON.stringify(current)}`).toBeLessThan(15);
  }
});
