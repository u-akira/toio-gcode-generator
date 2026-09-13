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
    const angleDelta = Math.abs(((((current.theta - previous.theta) + 180) % 360) + 360) % 360 - 180);
    expect(angleDelta, `rotation jump ${angleDelta} between ${JSON.stringify(previous)} and ${JSON.stringify(current)}`).toBeLessThan(15);
  }
});

test("edited triangle draw animation remains physically continuous", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/triangle.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const thirdRow = page.locator(".command-row").nth(2);
  await expect(thirdRow).toBeVisible();
  const duration = thirdRow.locator('input[data-command-key="durationMs"]');
  await expect(duration).toHaveValue(/2500|2580/);
  await duration.fill("1000");
  await duration.blur();
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const initial = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const editedItem = initial.items.find((item) => item.commandIndex === 2);
  expect(editedItem).toBeDefined();
  expect(editedItem.durationMs).toBe(1000);

  const frames = [];
  for (let elapsedMs = 0; elapsedMs <= initial.items.at(-1).endMs; elapsedMs += 25) {
    await page.evaluate((time) => window.__toioTest.seekAnimation(time), elapsedMs);
    const snapshot = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
    const item = snapshot.items.find((candidate) => elapsedMs >= candidate.startMs && elapsedMs < candidate.endMs);
    const command = item && snapshot.commands[item.commandIndex];
    if (item && command?.x != null && command?.y != null && command?.theta != null) {
      frames.push({ elapsedMs, commandIndex: item.commandIndex, x: command.x, y: command.y, theta: command.theta });
    }
  }
  expect(frames.length).toBeGreaterThan(10);
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    expect(distance, `triangle position jump ${distance}: ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`).toBeLessThan(10);
    const angleDelta = Math.abs(((((current.theta - previous.theta) + 180) % 360) + 360) % 360 - 180);
    expect(angleDelta, `triangle rotation jump ${angleDelta}: ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`).toBeLessThan(15);
  }
});

test("edited keroppi arc stays near its loaded endpoint", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const loadedTimeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), loadedTimeline.durationMs);
  const loaded = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const loadedArc = loaded.commands.find((command) => command.segmentId === "seg-0");
  expect(loadedArc).toBeDefined();

  const frameJumps = [];
  for (let elapsedMs = 0; elapsedMs <= loadedTimeline.durationMs; elapsedMs += 25) {
    await page.evaluate((time) => window.__toioTest.seekAnimation(time), elapsedMs);
    const snapshot = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
    const item = snapshot.items.find((candidate) => elapsedMs >= candidate.startMs && elapsedMs < candidate.endMs);
    const command = item && snapshot.commands[item.commandIndex];
    if (command?.x == null || command?.y == null || command?.theta == null) continue;
    frameJumps.push({ x: command.x, y: command.y, theta: command.theta, elapsedMs });
  }
  for (let index = 1; index < frameJumps.length; index += 1) {
    const previous = frameJumps[index - 1];
    const current = frameJumps[index];
    expect(Math.hypot(current.x - previous.x, current.y - previous.y), `keroppi position jump at ${current.elapsedMs}ms`).toBeLessThan(10);
    const angleDelta = Math.abs(((((current.theta - previous.theta) + 180) % 360) + 360) % 360 - 180);
    expect(angleDelta, `keroppi rotation jump at ${current.elapsedMs}ms`).toBeLessThan(15);
  }

  const duration = page.locator(`input[data-command-index="${loaded.commands.indexOf(loadedArc)}"][data-command-key="durationMs"]`);
  await duration.fill(String(loadedArc.durationMs + 100));
  await duration.blur();
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), loadedTimeline.durationMs);
  const edited = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const editedArc = edited.commands.find((command) => command.segmentId === "seg-0");
  expect(editedArc).toBeDefined();
  expect(Math.hypot(editedArc.x - loadedArc.x, editedArc.y - loadedArc.y)).toBeLessThan(5);

  await duration.fill(String(loadedArc.durationMs));
  await duration.blur();
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), loadedTimeline.durationMs);
  const restored = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const restoredArc = restored.commands.find((command) => command.segmentId === "seg-0");
  expect(restoredArc).toBeDefined();
  expect(Math.hypot(restoredArc.x - loadedArc.x, restoredArc.y - loadedArc.y)).toBeLessThan(0.1);
});

test("a 100ms keroppi arc edit keeps the drawing path stable", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const initial = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), initial.durationMs);
  const baseline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const baselineArcs = baseline.commands.filter((command) => command.type === "motor" && command.kind === "draw" && command.geometry === "arc" && !["seg-2", "seg-4"].includes(command.segmentId));
  expect(baselineArcs.length).toBeGreaterThan(3);

  const editedArc = baselineArcs.find((command) => command.segmentId === "seg-0");
  const editedIndex = baseline.commands.indexOf(editedArc);
  const duration = page.locator(`input[data-command-index="${editedIndex}"][data-command-key="durationMs"]`);
  await duration.fill(String(editedArc.durationMs + 100));
  await duration.blur();
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const editedTimeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), editedTimeline.durationMs);
  const edited = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const editedArcs = edited.commands.filter((command) => command.type === "motor" && command.kind === "draw" && command.geometry === "arc" && !["seg-2", "seg-4"].includes(command.segmentId));
  const bySegment = new Map(editedArcs.map((command) => [command.segmentId, command]));

  for (const before of baselineArcs) {
    const after = bySegment.get(before.segmentId);
    expect(after, `missing ${before.segmentId} after 100ms edit`).toBeDefined();
    expect(Math.hypot(after.x - before.x, after.y - before.y), `${before.segmentId} endpoint moved: ${JSON.stringify({ before: [before.x, before.y, before.theta], after: [after.x, after.y, after.theta], beforeFrom: [before.fromX, before.fromY], afterFrom: [after.fromX, after.fromY], beforeSpeed: [before.leftSpeed, before.rightSpeed], afterSpeed: [after.leftSpeed, after.rightSpeed] })}`).toBeLessThan(1);
    expect(Math.hypot(after.fromX - before.fromX, after.fromY - before.fromY), `${before.segmentId} start moved: ${JSON.stringify({ before: [before.fromX, before.fromY], after: [after.fromX, after.fromY] })}`).toBeLessThan(1);
    for (let pointIndex = 0; pointIndex < before.penPreviewPoints.length; pointIndex += 1) {
      const beforePoint = before.penPreviewPoints[pointIndex];
      const normalized = pointIndex / Math.max(1, before.penPreviewPoints.length - 1);
      const afterPoint = after.penPreviewPoints[Math.round(normalized * (after.penPreviewPoints.length - 1))];
      expect(Math.hypot(afterPoint.x - beforePoint.x, afterPoint.y - beforePoint.y), `${before.segmentId} path moved at point ${pointIndex}`).toBeLessThan(5);
    }
  }
});

test("keroppi has no position or heading jump at any command boundary", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const timeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const snapshotAt = async (elapsedMs) => {
    await page.evaluate((time) => window.__toioTest.seekAnimation(time), elapsedMs);
    return page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  };

  for (let itemIndex = 1; itemIndex < timeline.items.length; itemIndex += 1) {
    const previousItem = timeline.items[itemIndex - 1];
    const item = timeline.items[itemIndex];
    const previousSnapshot = await snapshotAt(Math.max(0, previousItem.endMs - 1));
    const currentSnapshot = await snapshotAt(item.startMs);
    const previous = previousSnapshot.commands[previousItem.commandIndex];
    const current = currentSnapshot.commands[item.commandIndex];
    if (!previous || !current || previous.x == null || current.x == null) continue;
    const positionJump = Math.hypot(current.x - previous.x, current.y - previous.y);
    const headingJump = Math.abs(((((current.theta - previous.theta) + 180) % 360) + 360) % 360 - 180);
    expect(positionJump, `boundary before command ${item.commandIndex} (${item.type})`).toBeLessThan(10);
    const hasPenUpGap = previousSnapshot.commands.some((command) => command.type === "pen" && command.state === "up");
    if (!hasPenUpGap) expect(headingJump, `heading boundary before command ${item.commandIndex} (${item.type})`).toBeLessThan(15);
  }
});

test("keroppi command 9 to 11 remains positionally continuous across pen up", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const timeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const previousItem = timeline.items.find((item) => item.commandIndex === 8);
  const currentItem = timeline.items.find((item) => item.commandIndex === 10);
  expect(previousItem, "command 9 timeline item").toBeDefined();
  expect(currentItem, "command 11 timeline item").toBeDefined();

  await page.evaluate((time) => window.__toioTest.seekAnimation(time), previousItem.endMs - 1);
  const previous = (await page.evaluate(() => window.__toioTest.getAnimationSnapshot())).commands[8];
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), currentItem.startMs);
  const current = (await page.evaluate(() => window.__toioTest.getAnimationSnapshot())).commands[10];
  const positionJump = Math.hypot(current.x - previous.x, current.y - previous.y);

  expect(positionJump, JSON.stringify({ previous, current })).toBeLessThan(10);
});

test("keroppi eye turn-in-place arc completes its full sweep", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const timeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const eyeItem = timeline.items.find((item) => item.commandIndex === 8);
  expect(eyeItem, "first eye arc timeline item").toBeDefined();
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), eyeItem.endMs);
  const eye = (await page.evaluate(() => window.__toioTest.getAnimationSnapshot())).commands[8];
  expect(eye.turnInPlace).toBe(true);
  expect(eye.sweepAngle).toBe(360);
  expect(Math.hypot(eye.penPreviewPoints[0].x - eye.penPreviewPoints.at(-1).x, eye.penPreviewPoints[0].y - eye.penPreviewPoints.at(-1).y)).toBeLessThan(1);
});
