const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../plotter-core.js");

function makeStroke(points) {
  return { raw: points.map(([x, y]) => ({ x, y })) };
}

function simulate(stroke, config = {}) {
  return core.createSimulation({
    strokes: [stroke],
    config: core.withDefaults({
      smoothing: 0,
      minPointDistance: 1,
      cornerAngle: 60,
      lineCorrection: 1,
      lineTolerance: 4,
      minSegmentLength: 0,
      ...config,
    }),
  });
}

test("pen front/back offset changes simulated cube path", () => {
  const stroke = makeStroke([
    [120, 120],
    [180, 120],
  ]);
  const backPen = simulate(stroke, { penOffsetX: -48, penOffsetY: 0 });
  const centeredPen = simulate(stroke, { penOffsetX: 0, penOffsetY: 0 });

  assert.notDeepEqual(backPen.cubePath, centeredPen.cubePath);
  assert.equal(backPen.processedStrokes[0].processed[0].x, centeredPen.processedStrokes[0].processed[0].x);
});

test("pen left/right offset changes simulated cube path sideways", () => {
  const stroke = makeStroke([
    [120, 120],
    [180, 120],
  ]);
  const noSideOffset = simulate(stroke, { penOffsetY: 0 });
  const sideOffset = simulate(stroke, { penOffsetY: 30 });

  assert.notEqual(noSideOffset.cubePath[0].y, sideOffset.cubePath[0].y);
});

test("higher line tolerance reduces draw segments and pen up/down count", () => {
  const stroke = makeStroke([
    [80, 110],
    [100, 112],
    [120, 109],
    [140, 113],
    [160, 111],
    [180, 112],
  ]);
  const strict = simulate(stroke, { lineTolerance: 0, minSegmentLength: 0 });
  const corrected = simulate(stroke, { lineTolerance: 12, minSegmentLength: 0 });

  assert.ok(corrected.stats.drawSegments < strict.stats.drawSegments);
  assert.equal(corrected.stats.penDowns, corrected.stats.drawSegments);
  assert.equal(corrected.stats.penUps, corrected.stats.drawSegments);
});

test("corner preservation keeps an L shape as two draw segments", () => {
  const stroke = makeStroke([
    [120, 120],
    [150, 120],
    [180, 120],
    [180, 150],
    [180, 180],
  ]);
  const result = simulate(stroke, { lineTolerance: 40, cornerAngle: 45, minSegmentLength: 0 });

  assert.equal(result.stats.drawSegments, 2);
});

test("safe area setting affects simulation errors", () => {
  const stroke = makeStroke([
    [60, 60],
    [90, 60],
  ]);
  const smallSafeArea = simulate(stroke, { safeScale: 0.5 });
  const fullSafeArea = simulate(stroke, { safeScale: 1 });

  assert.ok(smallSafeArea.errors.length > 0);
  assert.equal(fullSafeArea.errors.length, 0);
});

test("draw and travel speed settings are reflected in commands", () => {
  const stroke = makeStroke([
    [120, 120],
    [180, 120],
  ]);
  const result = simulate(stroke, { drawSpeed: 22, travelSpeed: 77 });
  const drawMove = result.commands.find((command) => command.type === "move" && command.speed === 22);
  const travelMove = result.commands.find((command) => command.type === "move" && command.speed === 77);

  assert.ok(drawMove);
  assert.ok(travelMove);
});
