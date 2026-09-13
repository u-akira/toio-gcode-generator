const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.clock.install();
});

test("wave command 9 pen-down preview is exactly its arc", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("data/wave-copy-paper.json");
  await page.click("#simulateBtn");
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), 999999);
  const commands = await page.evaluate(() => window.__toioTest.getCommands());
  const preview = await page.evaluate(() => window.__toioTest.getDeadPreview());
  const command9 = commands[8];
  const command9Path = preview.segmentPenPaths.find(([segmentId]) => segmentId === command9.segmentId)?.[1];
  expect(command9.type).toBe("motor");
  expect(command9.kind).toBe("draw");
  expect(command9.geometry).toBe("arc");
  expect(command9Path).toBeDefined();
  expect(command9Path.length).toBe(command9.penPreviewPoints.length);
  for (let index = 0; index < command9Path.length; index += 1) {
    expect(command9Path[index].x).toBeCloseTo(command9.penPreviewPoints[index].x, 6);
    expect(command9Path[index].y).toBeCloseTo(command9.penPreviewPoints[index].y, 6);
  }
  const drawCommands = commands.filter((command) => command.type === "motor" && command.kind === "draw");
  expect(preview.penDownSegments.length).toBe(drawCommands.length);
  for (let index = 0; index < drawCommands.length; index += 1) {
    const expected = drawCommands[index].penPreviewPoints;
    const actual = preview.penDownSegments[index];
    expect(actual.length).toBe(expected.length);
    for (let pointIndex = 0; pointIndex < expected.length; pointIndex += 1) {
      expect(Math.hypot(actual[pointIndex].x - expected[pointIndex].x, actual[pointIndex].y - expected[pointIndex].y)).toBeLessThan(0.1);
    }
  }
  expect(preview.segmentPenPaths.length).toBeGreaterThan(0);
  for (const [segmentId, path] of preview.segmentPenPaths) {
    const drawCommand = commands.find((command) => command.type === "motor" && command.kind === "draw" && command.segmentId === segmentId);
    expect(drawCommand, `unexpected pen-down path for ${segmentId}`).toBeDefined();
    expect(path[0].x).toBeCloseTo(drawCommand.penPreviewPoints[0].x, 6);
    expect(path[0].y).toBeCloseTo(drawCommand.penPreviewPoints[0].y, 6);
    expect(path.at(-1).x).toBeCloseTo(drawCommand.penPreviewPoints.at(-1).x, 6);
    expect(path.at(-1).y).toBeCloseTo(drawCommand.penPreviewPoints.at(-1).y, 6);
  }
  const timeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const command9Item = timeline.items.find((item) => item.commandIndex === 8);
  expect(command9Item).toBeDefined();
  const midTime = command9Item.startMs + (command9Item.endMs - command9Item.startMs) / 2;
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), midTime);
  const midSnapshot = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const midPreview = await page.evaluate(() => window.__toioTest.getDeadPreview());
  const midPath = midPreview.segmentPenPaths.find(([segmentId]) => segmentId === command9.segmentId)?.[1];
  const midCommand9 = midSnapshot.commands[8];
  expect(midPath).toBeDefined();
  expect(Math.hypot(midPath.at(-1).x - midCommand9.penX, midPath.at(-1).y - midCommand9.penY)).toBeLessThan(0.1);
});

test("wave JSON Next to command 9 does not invent pen-down drawing", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("data/wave-copy-paper.json");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const before = await page.evaluate(() => ({ commands: window.__toioTest.getCommands(), preview: window.__toioTest.getDeadPreview() }));
  for (let index = 0; index < 9; index += 1) await page.click("#simNextStepBtn");
  const after = await page.evaluate(() => ({ commands: window.__toioTest.getCommands(), preview: window.__toioTest.getDeadPreview(), animation: window.__toioTest.getAnimationSnapshot() }));
  expect(after.animation.activeCommandIndex).toBe(8);
  expect(after.preview.penDownSegments.length).toBe(before.preview.penDownSegments.length);
  const visibleDrawCommands = after.animation.commands.filter((command) => command.type === "motor" && command.kind === "draw");
  expect(after.preview.penDownSegments.length).toBe(visibleDrawCommands.length);
  for (let index = 0; index < visibleDrawCommands.length; index += 1) {
    const expected = visibleDrawCommands[index].penPreviewPoints;
    const actual = after.preview.penDownSegments[index];
    expect(actual.length).toBeGreaterThanOrEqual(2);
    expect(actual.length).toBeLessThanOrEqual(expected.length);
    for (let pointIndex = 0; pointIndex < actual.length; pointIndex += 1) {
      expect(Math.hypot(actual[pointIndex].x - expected[pointIndex].x, actual[pointIndex].y - expected[pointIndex].y)).toBeLessThan(0.1);
    }
  }
});

test("keroppi Next to command 9 does not invent pen-down drawing", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  for (let index = 0; index < 9; index += 1) await page.click("#simNextStepBtn");
  const after = await page.evaluate(() => ({ preview: window.__toioTest.getDeadPreview(), animation: window.__toioTest.getAnimationSnapshot() }));
  const visibleDrawCommands = after.animation.commands.filter((command) => command.type === "motor" && command.kind === "draw");
  expect(after.preview.penDownSegments.length).toBe(visibleDrawCommands.length);
});

test("editing wave command 9 does not add an uncommanded pen-down segment", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("data/wave-copy-paper.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const before = await page.evaluate(() => window.__toioTest.getCommands());
  const duration = page.locator('input[data-command-index="8"][data-command-key="durationMs"]');
  await duration.fill(String(Number(await duration.inputValue()) + 100));
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const totalDuration = await page.evaluate(() => window.__toioTest.getAnimationSnapshot().durationMs);
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), totalDuration - 1);
  const after = await page.evaluate(() => ({ commands: window.__toioTest.getCommands(), animation: window.__toioTest.getAnimationSnapshot(), preview: window.__toioTest.getDeadPreview() }));
  const drawCommands = after.animation.commands.filter((command) => command.type === "motor" && command.kind === "draw");
  expect(after.preview.penDownSegments.length).toBe(drawCommands.length);
  expect(after.commands[8].durationMs).toBe(before[8].durationMs + 100);
  for (let index = 0; index < drawCommands.length; index += 1) {
    const expected = drawCommands[index].penPreviewPoints;
    const actual = after.preview.penDownSegments[index];
    expect(actual.length).toBe(expected.length);
    for (let pointIndex = 0; pointIndex < expected.length; pointIndex += 1) {
      expect(actual[pointIndex].x).toBeCloseTo(expected[pointIndex].x, 6);
      expect(actual[pointIndex].y).toBeCloseTo(expected[pointIndex].y, 6);
    }
  }
});

test("completed wave simulation keeps the edited pen-down path", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("data/wave-copy-paper.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const duration = page.locator('input[data-command-index="8"][data-command-key="durationMs"]');
  await duration.fill(String(Number(await duration.inputValue()) + 100));
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const totalDuration = await page.evaluate(() => window.__toioTest.getAnimationSnapshot().durationMs);
  await page.evaluate((elapsedMs) => window.__toioTest.seekAnimation(elapsedMs), totalDuration - 1);
  const beforeFinish = await page.evaluate(() => window.__toioTest.getDeadPreview());
  await page.click("#simPauseBtn");
  await page.clock.runFor(100);
  const result = await page.evaluate(() => ({ snapshot: window.__toioTest.getAnimationSnapshot(), preview: window.__toioTest.getDeadPreview() }));
  expect(result.snapshot).toBeNull();
  expect(result.preview.penDownSegments.length).toBe(beforeFinish.penDownSegments.length);
  for (let index = 0; index < beforeFinish.penDownSegments.length; index += 1) {
    const before = beforeFinish.penDownSegments[index].at(-1);
    const after = result.preview.penDownSegments[index].at(-1);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.1);
  }
});

test("wave L/R edit followed immediately by Simulate keeps the edited drawing", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("data/wave-copy-paper.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const left = page.locator('input[data-command-index="8"][data-command-key="leftSpeed"]');
  const right = page.locator('input[data-command-index="8"][data-command-key="rightSpeed"]');
  await left.fill("26");
  await right.fill("14");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const totalDuration = await page.evaluate(() => window.__toioTest.getAnimationSnapshot().durationMs);
  await page.evaluate((elapsedMs) => window.__toioTest.seekAnimation(elapsedMs), totalDuration - 1);
  const beforeFinish = await page.evaluate(() => window.__toioTest.getDeadPreview());
  await page.click("#simPauseBtn");
  await page.clock.runFor(100);
  const result = await page.evaluate(() => ({ commands: window.__toioTest.getCommands(), preview: window.__toioTest.getDeadPreview() }));
  expect(result.commands[8].leftSpeed).toBe(26);
  expect(result.commands[8].rightSpeed).toBe(14);
  expect(result.preview.penDownSegments.length).toBe(beforeFinish.penDownSegments.length);
  for (let index = 0; index < beforeFinish.penDownSegments.length; index += 1) {
    const before = beforeFinish.penDownSegments[index].at(-1);
    const after = result.preview.penDownSegments[index].at(-1);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.1);
  }
});

test("completed animation keeps the command-executed drawing instead of reload preview", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("data/wave-copy-paper.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const duration = page.locator('input[data-command-index="8"][data-command-key="durationMs"]');
  await duration.fill(String(Number(await duration.inputValue()) + 100));
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const totalDuration = await page.evaluate(() => window.__toioTest.getAnimationSnapshot().durationMs);
  await page.evaluate((elapsedMs) => window.__toioTest.seekAnimation(elapsedMs), totalDuration - 1);
  const beforeFinish = await page.evaluate(() => window.__toioTest.getDeadPreview());
  await page.click("#simPauseBtn");
  await page.clock.runFor(100);
  const afterFinish = await page.evaluate(() => ({ snapshot: window.__toioTest.getAnimationSnapshot(), preview: window.__toioTest.getDeadPreview() }));

  expect(afterFinish.snapshot).toBeNull();
  expect(afterFinish.preview.penDownSegments.length).toBe(beforeFinish.penDownSegments.length);
  for (let index = 0; index < beforeFinish.penDownSegments.length; index += 1) {
    const before = beforeFinish.penDownSegments[index].at(-1);
    const after = afterFinish.preview.penDownSegments[index].at(-1);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.1);
  }
});

test("completed animation does not teleport the cube from its last animated pose", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("data/wave-copy-paper.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const duration = page.locator('input[data-command-index="8"][data-command-key="durationMs"]');
  await duration.fill(String(Number(await duration.inputValue()) + 100));
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const totalDuration = await page.evaluate(() => window.__toioTest.getAnimationSnapshot().durationMs);
  await page.evaluate((elapsedMs) => window.__toioTest.seekAnimation(elapsedMs), totalDuration - 1);
  const beforeFinish = await page.evaluate(() => window.__toioTest.getDeadPreview());
  const beforePose = beforeFinish.cubePath.at(-1);
  await page.click("#simPauseBtn");
  await page.clock.runFor(100);
  const afterFinish = await page.evaluate(() => window.__toioTest.getDeadPreview());
  const afterPose = afterFinish.cubePath.at(-1);

  expect(beforePose).toBeDefined();
  expect(afterPose).toBeDefined();
  expect(Math.hypot(afterPose.x - beforePose.x, afterPose.y - beforePose.y)).toBeLessThan(0.1);
  expect(Math.abs(afterPose.theta - beforePose.theta)).toBeLessThan(0.1);
});

test("arc wheel speeds entered before duration remain unchanged", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const arcRow = page.locator('.command-row:has(input[data-command-key="rightSpeed"])').first();
  await arcRow.locator('input[data-command-key="leftSpeed"]').fill("8");
  await expect(arcRow.locator('input[data-command-key="leftSpeed"]')).toHaveValue("8");
  await arcRow.locator('input[data-command-key="rightSpeed"]').fill("20");
  await expect(arcRow.locator('input[data-command-key="rightSpeed"]')).toHaveValue("20");
  await arcRow.locator('input[data-command-key="durationMs"]').fill("1500");
  await arcRow.locator('input[data-command-key="durationMs"]').blur();

  await expect(arcRow.locator('input[data-command-key="leftSpeed"]')).toHaveValue("8");
  await expect(arcRow.locator('input[data-command-key="rightSpeed"]')).toHaveValue("20");
  await expect(arcRow.locator('input[data-command-key="durationMs"]')).toHaveValue("1500");
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

test("edited wave arc animation remains physically continuous", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("data/wave-copy-paper.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const before = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const firstArc = before.commands.find((command) => command.segmentId === "seg-0" && command.geometry === "arc");
  expect(firstArc).toBeDefined();
  const firstArcIndex = before.commands.indexOf(firstArc);
  const duration = page.locator(`input[data-command-index="${firstArcIndex}"][data-command-key="durationMs"]`);
  await duration.fill(String(firstArc.durationMs + 100));
  await duration.blur();
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const timeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const editedArc = timeline.commands[firstArcIndex];
  expect(editedArc.durationMs).toBe(firstArc.durationMs + 100);
  const editedItem = timeline.items.find((item) => item.commandIndex === firstArcIndex);
  expect(editedItem).toBeDefined();
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), timeline.durationMs);
  const finalSnapshot = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const finalPreview = await page.evaluate(() => window.__toioTest.getDeadPreview());
  const editedPath = finalPreview.segmentPenPaths.find(([segmentId]) => segmentId === "seg-0")?.[1];
  expect(editedPath).toBeDefined();
  const finalEditedArc = finalSnapshot.commands[firstArcIndex];
  expect(Math.hypot(editedPath.at(-1).x - finalEditedArc.penX, editedPath.at(-1).y - finalEditedArc.penY)).toBeLessThan(0.1);
  const midTime = editedItem.startMs + (editedItem.endMs - editedItem.startMs) / 2;
  if (Number.isFinite(midTime)) {
    await page.evaluate((time) => window.__toioTest.seekAnimation(time), midTime);
    const midSnapshot = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
    const midPreview = await page.evaluate(() => window.__toioTest.getDeadPreview());
    const midPath = midPreview.segmentPenPaths.find(([segmentId]) => segmentId === "seg-0")?.[1];
    const midArc = midSnapshot.commands[firstArcIndex];
    expect(midPath).toBeDefined();
    expect(Math.hypot(midPath.at(-1).x - midArc.penX, midPath.at(-1).y - midArc.penY)).toBeLessThan(0.1);
  }
  await page.evaluate((time) => window.__toioTest.seekAnimation(0), 0);
  const followingItem = timeline.items.find((item) => item.startMs >= editedItem.endMs && item.commandIndex !== firstArcIndex);
  expect(followingItem).toBeDefined();

  const at = async (elapsedMs) => {
    await page.evaluate((time) => window.__toioTest.seekAnimation(time), elapsedMs);
    return page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  };
  const arcEnd = await at(editedItem.endMs - 1);
  const followingStart = await at(followingItem.startMs);
  const arcPose = arcEnd.commands[firstArcIndex];
  const followingPose = followingStart.commands[followingItem.commandIndex];
  expect(Math.hypot(followingPose.x - arcPose.x, followingPose.y - arcPose.y)).toBeLessThan(10);

  const frames = [];
  for (let elapsedMs = 0; elapsedMs <= timeline.durationMs; elapsedMs += 25) {
    const snapshot = await at(elapsedMs);
    const item = snapshot.items.find((candidate) => elapsedMs >= candidate.startMs && elapsedMs < candidate.endMs);
    const command = item && snapshot.commands[item.commandIndex];
    if (command?.x == null || command?.y == null || command?.theta == null) continue;
    frames.push({ elapsedMs, commandIndex: item.commandIndex, x: command.x, y: command.y, theta: command.theta });
  }
  expect(frames.length).toBeGreaterThan(10);
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    expect(Math.hypot(current.x - previous.x, current.y - previous.y), `wave position jump: ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`).toBeLessThan(10);
    const angleDelta = Math.abs(((((current.theta - previous.theta) + 180) % 360) + 360) % 360 - 180);
    expect(angleDelta, `wave rotation jump: ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`).toBeLessThan(15);
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
  const baselineArcs = baseline.commands.filter((command) => command.type === "motor" && command.kind === "draw" && command.geometry === "arc" && !["seg-2", "seg-4", "seg-10", "seg-12"].includes(command.segmentId));
  expect(baselineArcs.length).toBeGreaterThanOrEqual(3);

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

test("keroppi inner eye arcs stay inside the eye outline", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const timeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), timeline.durationMs);
  const eyes = (await page.evaluate(() => window.__toioTest.getAnimationSnapshot())).commands.filter((command) => command.geometry === "arc" && command.sweepAngle === -80 && command.turnInPlace);
  expect(eyes.length).toBe(2);
  for (const eye of eyes) {
    expect(eye.penPreviewPoints.length).toBeGreaterThan(2);
    expect(Math.hypot(eye.x - eye.fromX, eye.y - eye.fromY)).toBeLessThan(1);
  }
});
