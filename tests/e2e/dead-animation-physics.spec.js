const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.clock.install();
});

test("loading the keroppi sample immediately shows its simulation result without playing it", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const result = await page.evaluate(() => ({
    animation: window.__toioTest.getAnimationSnapshot(),
    commands: window.__toioTest.getCommands(),
    preview: window.__toioTest.getDeadPreview(),
  }));
  expect(result.animation).toBeNull();
  expect(result.commands.length).toBeGreaterThan(0);
  expect(result.preview.penDownSegments.length).toBeGreaterThan(0);
});

test("keroppi travel command 6 reaches the next eye draw pose without drawing", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const result = await page.evaluate(() => {
    const commands = window.__toioTest.getCommands();
    const timeline = window.__toioTest.getAnimationSnapshot();
    const travel = commands.find((command) => command.segmentId === "seg-1" && command.kind === "travel");
    const draw = commands.find((command) => command.segmentId === "seg-2" && command.kind === "draw");
    const travelIndex = commands.findIndex((command) => command.segmentId === "seg-1" && command.kind === "travel");
    const item = timeline.items.find((candidate) => candidate.commandIndex === travelIndex);
    return {
      travel,
      draw,
      item,
    };
  });

  expect(result.travel).toBeDefined();
  expect(result.draw).toBeDefined();
  expect(result.item).toBeDefined();
  expect(result.travel.x).toBeCloseTo(result.draw.fromX, 6);
  expect(result.travel.y).toBeCloseTo(result.draw.fromY, 6);

  await page.evaluate((time) => window.__toioTest.seekAnimation(time), result.item.endMs - 1);
  const duringTravel = await page.evaluate(() => ({
    commands: window.__toioTest.getAnimationSnapshot().commands,
    preview: window.__toioTest.getDeadPreview(),
  }));
  const activeTravel = duringTravel.commands.find((command) => command.segmentId === "seg-1" && command.kind === "travel");
  expect(activeTravel.x).toBeCloseTo(result.travel.x, 0);
  expect(activeTravel.y).toBeCloseTo(result.travel.y, 0);
  expect(duringTravel.preview.segmentPenPaths.some(([segmentId]) => segmentId === "seg-2")).toBe(false);
});

test("keroppi command 27 keeps its completed mouth path when simulation advances", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const item = await page.evaluate(() => {
    const timeline = window.__toioTest.getAnimationSnapshot();
    return timeline.items.find((candidate) => candidate.commandIndex === 26);
  });
  expect(item).toBeDefined();

  await page.evaluate((time) => window.__toioTest.seekAnimation(time), item.endMs - 1);
  const beforeAdvance = await page.evaluate(() => window.__toioTest.getDeadPreview());
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), item.endMs + 1);
  const afterAdvance = await page.evaluate(() => window.__toioTest.getDeadPreview());
  const beforePath = beforeAdvance.segmentPenPaths.find(([segmentId]) => segmentId === "seg-8")?.[1];
  const afterPath = afterAdvance.segmentPenPaths.find(([segmentId]) => segmentId === "seg-8")?.[1];

  expect(beforePath).toBeDefined();
  expect(afterPath).toBeDefined();
  expect(afterPath.length).toBe(beforePath.length);
  for (let index = 0; index < beforePath.length; index += 1) {
    expect(Math.hypot(afterPath[index].x - beforePath[index].x, afterPath[index].y - beforePath[index].y), `mouth path point ${index}`).toBeLessThan(0.5);
  }
});

test("keroppi commands 33 and 39 keep their executed drawing at simulation completion", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const result = await page.evaluate(() => {
    const timeline = window.__toioTest.getAnimationSnapshot();
    const commands = window.__toioTest.getCommands();
    const targets = [32, 38].map((commandIndex) => ({
      commandIndex,
      segmentId: commands[commandIndex]?.segmentId,
    }));
    window.__toioTest.seekAnimation(Math.max(0, timeline.durationMs - 1));
    const before = window.__toioTest.getDeadPreview();
    window.__toioTest.seekAnimation(timeline.durationMs);
    const after = window.__toioTest.getDeadPreview();
    return { commandCount: commands.length, commands: commands.map((command, index) => ({ index, type: command.type, kind: command.kind, segmentId: command.segmentId })), targets, before: before.segmentPenPaths, after: after.segmentPenPaths };
  });

  for (const target of result.targets) {
    expect(target.segmentId, `command ${target.commandIndex + 1} segment: ${JSON.stringify(result)}`).toBeDefined();
    const before = result.before.find(([segmentId]) => segmentId === target.segmentId)?.[1];
    const after = result.after.find(([segmentId]) => segmentId === target.segmentId)?.[1];
    expect(before, `command ${target.commandIndex + 1} before path`).toBeDefined();
    expect(after, `command ${target.commandIndex + 1} after path`).toBeDefined();
    expect(after.length).toBe(before.length);
    for (let index = 0; index < before.length; index += 1) {
      expect(Math.hypot(after[index].x - before[index].x, after[index].y - before[index].y), `command ${target.commandIndex + 1} point ${index}`).toBeLessThan(0.5);
    }
  }
});

test("command edit matrix fixture exposes every dead-reckoning command family", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("tests/fixtures/command-edit-matrix.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const commands = await page.evaluate(() => window.__toioTest.getCommands());
  expect(commands.some((command) => command.type === "pen")).toBe(true);
  expect(commands.some((command) => command.type === "motor" && command.kind === "draw" && command.geometry === "line")).toBe(true);
  expect(commands.some((command) => command.type === "motor" && command.kind === "draw" && command.geometry === "arc" && !command.turnInPlace)).toBe(true);
  expect(commands.some((command) => command.type === "motor" && command.kind === "draw" && command.geometry === "arc" && command.turnInPlace)).toBe(true);
  expect(commands.some((command) => command.type === "motor" && command.kind === "travel" && command.geometry === "line")).toBe(true);
  expect(commands.some((command) => command.type === "turn" && command.role === "turn-to-travel")).toBe(true);
  expect(commands.some((command) => command.type === "turn" && command.role === "turn-to-draw")).toBe(true);
});

test("command edit matrix fixture keeps the edited execution continuous", async ({ page }) => {
  for (const edit of [
    { key: "speed", delta: 1 },
    { key: "leftSpeed", delta: 1 },
    { key: "rightSpeed", delta: -1 },
    { key: "durationMs", delta: 100 },
  ]) {
    await page.goto("/");
    await page.locator("#importInput").setInputFiles("tests/fixtures/command-edit-matrix.json");
    await page.click("#simulateBtn");
    await expect(page.locator("#simStatus")).toHaveClass(/ok/);
    const input = page.locator(`input[data-command-key="${edit.key}"]`).first();
    const original = Number(await input.inputValue());
    await input.fill(String(original + edit.delta));
    await page.click("#simulateBtn");
    await expect(page.locator("#simStatus")).toHaveClass(/ok/);
    const totalDuration = await page.evaluate(() => window.__toioTest.getAnimationSnapshot().durationMs);
    await page.evaluate((elapsedMs) => window.__toioTest.seekAnimation(elapsedMs), totalDuration - 1);
    const beforeFinish = await page.evaluate(() => window.__toioTest.getDeadPreview());
    await page.click("#simPauseBtn");
    await page.clock.runFor(100);
    const afterFinish = await page.evaluate(() => window.__toioTest.getDeadPreview());
    const beforePose = beforeFinish.cubePath.at(-1);
    const afterPose = afterFinish.cubePath.at(-1);
    expect(Math.hypot(afterPose.x - beforePose.x, afterPose.y - beforePose.y), edit.key).toBeLessThan(0.1);
    expect(Math.abs(afterPose.theta - beforePose.theta), edit.key).toBeLessThan(0.1);
  }
});

test("data keroppi keeps the edited execution continuous", async ({ page }) => {
  for (const edit of [
    { key: "speed", delta: 1 },
    { key: "leftSpeed", delta: 1 },
    { key: "rightSpeed", delta: -1 },
    { key: "durationMs", delta: 100 },
  ]) {
    await page.goto("/");
    await page.locator("#importInput").setInputFiles("data/keroppi-copy-paper.json");
    await page.click("#simulateBtn");
    await expect(page.locator("#simStatus")).toHaveClass(/ok/);
    const input = page.locator(`input[data-command-key="${edit.key}"]`).first();
    const original = Number(await input.inputValue());
    await input.fill(String(original + edit.delta));
    await page.click("#simulateBtn");
    await expect(page.locator("#simStatus")).toHaveClass(/ok/);
    const totalDuration = await page.evaluate(() => window.__toioTest.getAnimationSnapshot().durationMs);
    await page.evaluate((elapsedMs) => window.__toioTest.seekAnimation(elapsedMs), totalDuration - 1);
    const beforeFinish = await page.evaluate(() => window.__toioTest.getDeadPreview());
    await page.click("#simPauseBtn");
    await page.clock.runFor(100);
    const afterFinish = await page.evaluate(() => window.__toioTest.getDeadPreview());
    const beforePose = beforeFinish.cubePath.at(-1);
    const afterPose = afterFinish.cubePath.at(-1);
    expect(Math.hypot(afterPose.x - beforePose.x, afterPose.y - beforePose.y), edit.key).toBeLessThan(0.1);
    expect(Math.abs(afterPose.theta - beforePose.theta), edit.key).toBeLessThan(0.1);
  }
});

test("data keroppi first Next step draws only the current command", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("data/keroppi-copy-paper.json");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  await page.click("#simNextStepBtn");
  const result = await page.evaluate(() => {
    const snapshot = window.__toioTest.getAnimationSnapshot();
    const preview = window.__toioTest.getDeadPreview();
    return { snapshot, preview };
  });
  const visibleDrawCommands = result.snapshot.commands.filter((command) => command.type === "motor" && command.kind === "draw");
  expect(visibleDrawCommands.length).toBe(1);
  expect(result.preview.penDownSegments.length).toBe(1);
  const actual = result.preview.penDownSegments[0];
  const expected = visibleDrawCommands[0].penPreviewPoints;
  expect(actual.length).toBeGreaterThanOrEqual(2);
  expect(actual.length).toBeLessThanOrEqual(expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    expect(Math.hypot(actual[index].x - expected[index].x, actual[index].y - expected[index].y)).toBeLessThan(0.1);
  }
});

test("data keroppi does not switch a completed stroke back to its saved path", async ({ page }) => {
  await page.goto("/");
  await page.locator("#importInput").setInputFiles("data/keroppi-copy-paper.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const timeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const commands = await page.evaluate(() => window.__toioTest.getCommands());
  const drawItems = timeline.items.filter((item) => item.kind === "draw");
  expect(drawItems.length).toBeGreaterThan(0);

  for (const item of drawItems) {
    await page.evaluate((elapsedMs) => window.__toioTest.seekAnimation(elapsedMs), item.endMs - 1);
    const before = await page.evaluate(() => window.__toioTest.getDeadPreview());
    await page.evaluate((elapsedMs) => window.__toioTest.seekAnimation(elapsedMs), item.endMs + 1);
    const after = await page.evaluate(() => window.__toioTest.getDeadPreview());
    const segmentId = commands[item.commandIndex].segmentId;
    const beforeSegment = before.segmentPenPaths.find(([candidate]) => candidate === segmentId)?.[1];
    const afterSegment = after.segmentPenPaths.find(([candidate]) => candidate === segmentId)?.[1];
    if (!beforeSegment || !afterSegment) continue;
    const beforePoint = beforeSegment.at(-1);
    const afterPoint = afterSegment.at(-1);
    expect(Math.hypot(afterPoint.x - beforePoint.x, afterPoint.y - beforePoint.y), `segment ${segmentId}`).toBeLessThan(1);
  }
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

test("editing wave command 3 duration keeps its animated pen-down path", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/wave.json");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const duration = page.locator('input[data-command-index="2"][data-command-key="durationMs"]');
  await duration.fill("1000");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const result = await page.evaluate(() => {
    const commands = window.__toioTest.getCommands();
    const timeline = window.__toioTest.getAnimationSnapshot();
    const item = timeline.items.find((candidate) => candidate.commandIndex === 2);
    window.__toioTest.seekAnimation(item.startMs + (item.endMs - item.startMs) / 2);
    const midSnapshot = window.__toioTest.getAnimationSnapshot();
    const midPreview = window.__toioTest.getDeadPreview();
    const path = midPreview.segmentPenPaths.find(([segmentId]) => segmentId === commands[2].segmentId)?.[1];
    return {
      command: commands[2],
      item,
      active: midSnapshot.activeCommandIndex,
      path,
      start: path?.[0],
      end: path?.at(-1),
      pen: midSnapshot.commands[2]?.penX != null
        ? { x: midSnapshot.commands[2].penX, y: midSnapshot.commands[2].penY }
        : null,
    };
  });

  expect(result.command.durationMs).toBe(1000);
  expect(result.item).toBeDefined();
  expect(result.active).toBe(2);
  expect(result.path?.length).toBeGreaterThan(2);
  expect(Math.hypot(result.end.x - result.start.x, result.end.y - result.start.y)).toBeGreaterThan(0.1);
  expect(Math.hypot(result.end.x - result.pen.x, result.end.y - result.pen.y)).toBeLessThan(0.1);
});

test("editing wave command 3 recalculates command 6 and 7 from the edited pose", async ({ page }) => {
  const loadCommands = async (editCommand3) => {
    await page.goto("/");
    await page.selectOption("#sampleSelect", "samples/json/wave.json");
    await expect(page.locator("#simStatus")).toHaveClass(/ok/);
    if (editCommand3) {
      await page.locator('input[data-command-index="2"][data-command-key="durationMs"]').fill("1000");
    }
    await page.click("#simulateBtn");
    await expect(page.locator("#simStatus")).toHaveClass(/ok/);
    return page.evaluate(() => window.__toioTest.getCommands().map((command) => ({
      type: command.type,
      kind: command.kind,
      speed: command.speed,
      durationMs: command.durationMs,
      fromX: command.fromX,
      fromY: command.fromY,
      x: command.x,
      y: command.y,
    })));
  };

  const unedited = await loadCommands(false);
  const edited = await loadCommands(true);
  const unedited6 = unedited[5];
  const unedited7 = unedited[6];
  const edited5 = edited[4];
  const edited6 = edited[5];
  const edited7 = edited[6];

  expect(edited[2].durationMs).toBe(1000);
  expect(edited6.fromX).toBeCloseTo(edited5.x, 3);
  expect(edited6.fromY).toBeCloseTo(edited5.y, 3);
  expect(edited7.x).toBeCloseTo(edited6.x, 3);
  expect(edited7.y).toBeCloseTo(edited6.y, 3);
  expect(Math.hypot(edited6.x - unedited6.x, edited6.y - unedited6.y)).toBeGreaterThan(1);
  expect(Math.hypot(edited6.x - 260, edited6.y - 230)).toBeGreaterThan(1);
  expect(Math.hypot(edited7.x - unedited7.x, edited7.y - unedited7.y)).toBeGreaterThan(1);
});

test("edited wave simulation follows every generated command movement", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/wave.json");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  await page.locator('input[data-command-index="2"][data-command-key="durationMs"]').fill("1000");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const result = await page.evaluate(() => {
    const initial = window.__toioTest.getAnimationSnapshot();
    const commands = window.__toioTest.getCommands();
    const itemIndexes = initial.items.map((item) => item.commandIndex);
    const frames = initial.items.map((item) => {
      const times = [item.startMs + 0.001, item.startMs + (item.endMs - item.startMs) / 2, Math.max(item.startMs + 0.001, item.endMs - 0.001)];
      return {
        item,
        frames: times.map((time) => {
          window.__toioTest.seekAnimation(time);
          const snapshot = window.__toioTest.getAnimationSnapshot();
          const preview = window.__toioTest.getDeadPreview();
          const command = snapshot.commands[item.commandIndex];
          const path = command.segmentId
            ? preview.segmentPenPaths.find(([segmentId]) => segmentId === command.segmentId)?.[1] || null
            : null;
          return {
            command,
            activeCommandIndex: snapshot.activeCommandIndex,
            path,
            penDownSegments: preview.penDownSegments.length,
          };
        }),
      };
    });
    return {
      itemIndexes,
      durations: initial.items.map((item) => item.durationMs),
      commands: commands.map((command) => ({
        type: command.type,
        kind: command.kind || null,
        geometry: command.geometry || null,
        segmentId: command.segmentId || null,
      })),
      frames,
    };
  });

  expect(result.itemIndexes).toEqual([2, 4, 5, 6, 7, 8, 10]);
  expect(result.durations).toEqual([1000, 1110, 230, 310, 150, 890, 2680]);
  expect(result.commands.slice(0, 12).map((command) => command.type)).toEqual([
    "pen", "pen", "motor", "pen", "turn", "motor", "turn", "motor", "turn", "pen", "motor", "pen",
  ]);

  for (let index = 0; index < result.frames.length; index += 1) {
    const { item, frames } = result.frames[index];
    const [start, middle, end] = frames;
    expect(start.activeCommandIndex).toBe(item.commandIndex);
    expect(middle.activeCommandIndex).toBe(item.commandIndex);
    expect(end.activeCommandIndex).toBe(item.commandIndex);
    expect(start.command).toBeDefined();
    expect(middle.command).toBeDefined();
    expect(end.command).toBeDefined();
    expect(start.command.x).toBeDefined();
    expect(start.command.y).toBeDefined();
    expect(end.command.x).toBeDefined();
    expect(end.command.y).toBeDefined();

    if (item.commandIndex === 6) {
      expect(Math.hypot(end.command.x - start.command.x, end.command.y - start.command.y)).toBeLessThan(0.1);
      expect(Math.abs(end.command.theta - start.command.theta)).toBeGreaterThan(1);
      expect(end.path).toBeNull();
      continue;
    }

    if (result.commands[item.commandIndex].kind === "draw") {
      expect(start.path?.length).toBeGreaterThanOrEqual(1);
      expect(middle.path?.length).toBeGreaterThan(1);
      expect(end.path?.length).toBeGreaterThan(1);
      expect(Math.hypot(end.path.at(-1).x - end.command.penX, end.path.at(-1).y - end.command.penY)).toBeLessThan(0.1);
      continue;
    }

    if (result.commands[item.commandIndex].kind === "travel") {
      expect(end.path).toBeNull();
      expect(Math.hypot(end.command.x - start.command.x, end.command.y - start.command.y)).toBeGreaterThan(0.1);
    }
  }

  for (let index = 1; index < result.frames.length; index += 1) {
    const previousEnd = result.frames[index - 1].frames[2].command;
    const currentStart = result.frames[index].frames[0].command;
    expect(Math.hypot(currentStart.x - previousEnd.x, currentStart.y - previousEnd.y)).toBeLessThan(0.1);
  }
});

test("actual wave playback does not translate the cube when crossing command 6 to 7", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/wave.json");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  await page.locator('input[data-command-index="2"][data-command-key="durationMs"]').fill("1000");
  await page.click("#simulateBtn");

  const result = await page.evaluate(async () => {
    const samples = [];
    const commands = window.__toioTest.getCommands();
    const deadline = performance.now() + 3200;
    while (performance.now() < deadline) {
      const snapshot = window.__toioTest.getAnimationSnapshot();
      if (snapshot?.activeCommandIndex === 5 || snapshot?.activeCommandIndex === 6) {
        const command = snapshot.commands[snapshot.activeCommandIndex];
        samples.push({
          commandIndex: snapshot.activeCommandIndex,
          x: command?.x,
          y: command?.y,
          theta: command?.theta,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const previous = commands[5];
    const turns = samples.filter((sample) => sample.commandIndex === 6);
    return { previous, turns };
  });

  expect(result.previous).toBeDefined();
  expect(result.turns.length).toBeGreaterThan(1);
  for (const turn of result.turns) {
    expect(Math.hypot(turn.x - result.previous.x, turn.y - result.previous.y), JSON.stringify({ previous: result.previous, turn })).toBeLessThan(0.1);
  }
});

test("rendered wave playback keeps the simulated toio in place at command 6 to 7 boundary", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/wave.json");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  await page.locator('input[data-command-index="2"][data-command-key="durationMs"]').fill("1000");
  await page.click("#simulateBtn");
  await page.click("#simPauseBtn");
  await page.evaluate(() => window.__toioTest.seekAnimation(0));

  const turnStartMs = await page.evaluate(() => window.__toioTest.getAnimationSnapshot().items.find((item) => item.commandIndex === 6).startMs);
  const readRedCenter = () => page.evaluate(() => {
    const canvas = document.querySelector("#plotCanvas");
    const image = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const points = [];
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4;
        if (image.data[offset] > 120 && image.data[offset + 1] < 100 && image.data[offset + 2] < 100 && image.data[offset + 3] > 200) points.push({ x, y });
      }
    }
    return points.reduce((center, point) => ({ x: center.x + point.x, y: center.y + point.y, count: center.count + 1 }), { x: 0, y: 0, count: 0 });
  });
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), turnStartMs - 0.001);
  const command6Red = await readRedCenter();
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), turnStartMs + 0.001);
  const command7Red = await readRedCenter();

  const result = await page.evaluate(() => {
    const commands = window.__toioTest.getCommands();
    const snapshot = window.__toioTest.getAnimationSnapshot();
    const preview = window.__toioTest.getDeadPreview();
    return {
      active: snapshot.activeCommandIndex,
      expected: commands[5],
      pose: preview.cubePath.at(-1),
    };
  });

  expect(result.active).toBe(6);
  expect(command6Red.count).toBeGreaterThan(0);
  expect(command7Red.count).toBeGreaterThan(0);
  expect(Math.hypot(command7Red.x / command7Red.count - command6Red.x / command6Red.count, command7Red.y / command7Red.count - command6Red.y / command6Red.count)).toBeLessThan(4);
  expect(Math.hypot(result.pose.x - result.expected.x, result.pose.y - result.expected.y)).toBeLessThan(0.1);
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

test("triangle command 6 straight animates continuously before reaching its endpoint", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/triangle.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const result = await page.evaluate(() => {
    const timeline = window.__toioTest.getAnimationSnapshot();
    const item = timeline.items.find((candidate) => candidate.commandIndex === 5);
    const command = window.__toioTest.getCommands()[5];
    const midpoint = (item.startMs + item.endMs) / 2;
    window.__toioTest.seekAnimation(midpoint);
    const middle = window.__toioTest.getAnimationSnapshot().commands[5];
    const preview = window.__toioTest.getDeadPreview();
    return { item, command, middle, preview: preview.cubePath.at(-1) };
  });

  expect(result.item).toBeDefined();
  expect(result.command.kind).toBe("travel");
  expect(result.middle.x).toBeGreaterThan(Math.min(result.command.fromX, result.command.x));
  expect(result.middle.x).toBeLessThan(Math.max(result.command.fromX, result.command.x));
  expect(result.middle.y).toBeGreaterThan(Math.min(result.command.fromY, result.command.y));
  expect(result.middle.y).toBeLessThan(Math.max(result.command.fromY, result.command.y));
  expect(result.preview.x).toBeGreaterThan(Math.min(result.command.fromX, result.command.x));
  expect(result.preview.x).toBeLessThan(Math.max(result.command.fromX, result.command.x));
  expect(result.preview.y).toBeGreaterThan(Math.min(result.command.fromY, result.command.y));
  expect(result.preview.y).toBeLessThan(Math.max(result.command.fromY, result.command.y));
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
  await page.click("#simPauseBtn");

  const loadedTimeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), loadedTimeline.durationMs);
  const loaded = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const loadedArc = loaded.commands.find((command) => command.segmentId === "seg-0");
  expect(loadedArc).toBeDefined();

  const frameJumps = [];
  for (let elapsedMs = 0; elapsedMs <= loadedTimeline.durationMs; elapsedMs += 100) {
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
  await page.locator("#toioCommandOutput").evaluate((element) => { element.scrollTop = 0; });
  await page.locator(`[data-command-step="${loaded.commands.indexOf(loadedArc)}"]`).click();
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

test("a 100ms keroppi arc edit reflows downstream commands from the edited pose", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const initial = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), initial.durationMs);
  const baseline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const editedArc = baseline.commands.find((command) => command.segmentId === "seg-0");
  const baselineTravel = baseline.commands.find((command) => command.segmentId === "seg-1" && command.kind === "travel");
  expect(editedArc).toBeDefined();
  expect(baselineTravel).toBeDefined();
  const editedIndex = baseline.commands.indexOf(editedArc);
  const duration = page.locator(`input[data-command-index="${editedIndex}"][data-command-key="durationMs"]`);
  await duration.fill(String(editedArc.durationMs + 100));
  await duration.blur();
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const editedTimeline = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), editedTimeline.durationMs);
  const edited = await page.evaluate(() => window.__toioTest.getAnimationSnapshot());
  const editedArcAfter = edited.commands.find((command) => command.segmentId === "seg-0");
  const editedTravel = edited.commands.find((command) => command.segmentId === "seg-1" && command.kind === "travel");
  expect(editedArcAfter).toBeDefined();
  expect(editedTravel).toBeDefined();
  expect(Math.hypot(editedArcAfter.x - editedArc.x, editedArcAfter.y - editedArc.y)).toBeGreaterThan(1);
  expect(editedTravel.fromX).toBeCloseTo(editedArcAfter.x, 6);
  expect(editedTravel.fromY).toBeCloseTo(editedArcAfter.y, 6);
  expect(Math.hypot(editedTravel.x - baselineTravel.x, editedTravel.y - baselineTravel.y)).toBeGreaterThan(1);

  const editedTurnInPlace = edited.commands.find((command) => command.turnInPlace);
  const precedingTravel = edited.commands
    .slice(0, edited.commands.indexOf(editedTurnInPlace))
    .reverse()
    .find((command) => command.type === "motor" && command.kind === "travel");
  expect(editedTurnInPlace).toBeDefined();
  expect(precedingTravel).toBeDefined();
  expect(editedTurnInPlace.center.x).toBeCloseTo(precedingTravel.x, 6);
  expect(editedTurnInPlace.center.y).toBeCloseTo(precedingTravel.y, 6);
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

test("keroppi simulation does not teleport between pen-up commands", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const frames = await page.evaluate(() => {
    const timeline = window.__toioTest.getAnimationSnapshot();
    const result = [];
    for (let elapsedMs = 0; elapsedMs <= timeline.durationMs; elapsedMs += 25) {
      window.__toioTest.seekAnimation(elapsedMs);
      const snapshot = window.__toioTest.getAnimationSnapshot();
      const item = snapshot.items.find((candidate) => elapsedMs >= candidate.startMs && elapsedMs < candidate.endMs);
      const command = item && snapshot.commands[item.commandIndex];
      if (command?.x == null || command?.y == null) continue;
      result.push({ elapsedMs, commandIndex: item.commandIndex, type: command.type, kind: command.kind, motionModel: command.motionModel, turnInPlace: command.turnInPlace, leftSpeed: command.leftSpeed, rightSpeed: command.rightSpeed, durationMs: command.durationMs, startTheta: command.startTheta, theta: command.theta, fromX: command.fromX, fromY: command.fromY, x: command.x, y: command.y });
    }
    return result;
  });

  expect(frames.length).toBeGreaterThan(10);
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    expect(distance, `position jump: ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`).toBeLessThan(12);
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

test("keroppi simulation keeps the loaded command sequence", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  const loaded = await page.evaluate(() => window.__toioTest.getCommands());
  await page.click("#simulateBtn");
  const after = await page.evaluate(() => window.__toioTest.getCommands());
  expect(after).toEqual(loaded);
});

test("keroppi turn animation reaches its commanded heading without overshoot", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/keroppi-outline.json");
  await page.click("#simulateBtn");
  const turns = await page.evaluate(() => {
    const timeline = window.__toioTest.getAnimationSnapshot();
    return timeline.items
      .filter((item) => item.type === "turn")
      .map((item) => ({ commandIndex: item.commandIndex, startMs: item.startMs, endMs: item.endMs }));
  });
  for (const turn of turns) {
    await page.evaluate((elapsedMs) => window.__toioTest.seekAnimation(elapsedMs), turn.endMs - 1);
    const frame = await page.evaluate((commandIndex) => window.__toioTest.getAnimationSnapshot().commands[commandIndex], turn.commandIndex);
    const target = await page.evaluate((commandIndex) => window.__toioTest.getCommands()[commandIndex].theta, turn.commandIndex);
    const delta = Math.abs(((((frame.theta - target) + 180) % 360) + 360) % 360 - 180);
    expect(delta, `turn command ${turn.commandIndex + 1}`).toBeLessThan(1);
  }
});

test("editing the first cat command reflows subsequent wait positions", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sampleSelect", "samples/json/cat-face.json");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);
  const before = await page.evaluate(() => window.__toioTest.getCommands());
  const waitIndex = before.findIndex((command) => command.type === "wait");
  expect(waitIndex).toBeGreaterThan(0);
  const beforeWait = before[waitIndex];
  const firstDuration = page.locator('#toioCommandOutput input[data-command-key="durationMs"]').first();
  const originalDuration = Number(await firstDuration.inputValue());
  await firstDuration.fill(String(originalDuration + 1000));
  await firstDuration.blur();
  await page.click("#simulateBtn");
  await expect(page.locator("#simStatus")).toHaveClass(/ok/);

  const after = await page.evaluate(() => window.__toioTest.getCommands());
  const afterWait = after[waitIndex];
  const previousPen = after[waitIndex - 1];
  const totalDuration = await page.evaluate(() => window.__toioTest.getAnimationSnapshot().durationMs);
  await page.evaluate((time) => window.__toioTest.seekAnimation(time), totalDuration);
  const waitPoint = (await page.evaluate(() => window.__toioTest.getDeadPreview())).waitPoints[0];
  expect(Math.hypot(afterWait.penX - beforeWait.penX, afterWait.penY - beforeWait.penY), JSON.stringify({ beforeWait, afterWait })).toBeGreaterThan(1);
  expect(afterWait.penX).toBeCloseTo(previousPen.penX, 6);
  expect(afterWait.penY).toBeCloseTo(previousPen.penY, 6);
  expect(waitPoint.x).toBeCloseTo(afterWait.penX, 6);
  expect(waitPoint.y).toBeCloseTo(afterWait.penY, 6);
});
