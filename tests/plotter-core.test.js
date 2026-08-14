const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../plotter-core.js");
const circleSample = require("../samples/json/circle.json");

function makeStroke(points) {
  return { raw: points.map(([x, y]) => ({ x, y })) };
}

function simulate(stroke, config = {}) {
  return new core.PositionIdPlanner(
    core.withDefaults({
      smoothing: 0,
      minPointDistance: 1,
      cornerAngle: 60,
      lineCorrection: 1,
      lineTolerance: 4,
      minSegmentLength: 0,
      ...config,
    }),
  ).plan([stroke]);
}

test("default dead reckoning turn speed is conservative for calibration", () => {
  assert.equal(core.DEFAULT_CONFIG.deadTurnSpeed, 12);
});

test("default dead reckoning turn duration uses direct 90 degree milliseconds", () => {
  assert.equal(core.DEFAULT_CONFIG.deadTurnMsPer90, 660);
  assert.equal(core.computeTurnDurationMs(90, core.withDefaults()), 660);
});

test("pen front/back offset changes simulated cube path", () => {
  const stroke = makeStroke([
    [190, 250],
    [250, 250],
  ]);
  const backPen = simulate(stroke, { penOffsetX: -48, penOffsetY: 0 });
  const centeredPen = simulate(stroke, { penOffsetX: 0, penOffsetY: 0 });

  assert.notDeepEqual(backPen.cubePath, centeredPen.cubePath);
  assert.equal(backPen.processedStrokes[0].processed[0].x, centeredPen.processedStrokes[0].processed[0].x);
});

test("pen left/right offset changes simulated cube path sideways", () => {
  const stroke = makeStroke([
    [190, 250],
    [250, 250],
  ]);
  const noSideOffset = simulate(stroke, { penOffsetY: 0 });
  const sideOffset = simulate(stroke, { penOffsetY: 30 });

  assert.notEqual(noSideOffset.cubePath[0].y, sideOffset.cubePath[0].y);
});

test("higher line tolerance reduces draw segments and pen up/down count", () => {
  const stroke = makeStroke([
    [170, 250],
    [190, 252],
    [210, 249],
    [230, 253],
    [250, 251],
    [270, 252],
  ]);
  const strict = simulate(stroke, { lineTolerance: 0, minSegmentLength: 0 });
  const corrected = simulate(stroke, { lineTolerance: 12, minSegmentLength: 0 });

  assert.ok(corrected.stats.drawSegments < strict.stats.drawSegments);
  assert.equal(corrected.stats.penDowns, corrected.stats.drawSegments);
  assert.equal(corrected.stats.penUps, corrected.stats.drawSegments);
});

test("corner preservation keeps an L shape as two draw segments", () => {
  const stroke = makeStroke([
    [190, 220],
    [220, 220],
    [250, 220],
    [250, 250],
    [250, 280],
  ]);
  const result = simulate(stroke, { lineTolerance: 40, cornerAngle: 45, minSegmentLength: 0 });

  assert.equal(result.stats.drawSegments, 2);
});

test("freehand shape correction turns a near straight stroke into one line primitive", () => {
  const shape = core.processStrokeShape(
    [
      { x: 170, y: 250 },
      { x: 200, y: 251 },
      { x: 230, y: 249 },
      { x: 270, y: 250 },
    ],
    core.withDefaults({ smoothing: 0, minPointDistance: 1, lineCorrection: 1, lineTolerance: 4, minSegmentLength: 0 }),
  );

  assert.equal(shape.primitives.length, 1);
  assert.equal(shape.primitives[0].kind, "line");
  assert.equal(shape.processed.length, 2);
});

test("freehand shape correction preserves a clear right angle as two line primitives", () => {
  const shape = core.processStrokeShape(
    [
      { x: 180, y: 220 },
      { x: 220, y: 220 },
      { x: 250, y: 220 },
      { x: 250, y: 250 },
      { x: 250, y: 290 },
    ],
    core.withDefaults({ smoothing: 0, minPointDistance: 1, lineCorrection: 1, lineTolerance: 4, minSegmentLength: 0 }),
  );

  assert.equal(shape.primitives.length, 2);
  assert.deepEqual(
    shape.primitives.map((primitive) => primitive.kind),
    ["line", "line"],
  );
});

test("freehand shape correction turns a curved stroke into one arc primitive", () => {
  const points = [];
  for (let angle = 180; angle >= 45; angle -= 15) {
    points.push({
      x: 250 + 70 * Math.cos((angle * Math.PI) / 180),
      y: 250 + 70 * Math.sin((angle * Math.PI) / 180),
    });
  }
  const shape = core.processStrokeShape(
    points,
    core.withDefaults({ smoothing: 0, minPointDistance: 1, lineCorrection: 1, lineTolerance: 4, minSegmentLength: 0, penOffsetX: -48, penOffsetY: 0 }),
  );

  assert.equal(shape.primitives.length, 1);
  assert.equal(shape.primitives[0].kind, "arc");
  assert.ok(Math.abs(shape.primitives[0].sweepAngle) >= 120);
  assert.ok(shape.processed.length > 2);
});

test("safe area setting affects simulation errors", () => {
  const stroke = makeStroke([
    [112, 152],
    [142, 152],
  ]);
  const smallSafeArea = simulate(stroke, { safeScale: 0.5 });
  const fullSafeArea = simulate(stroke, { safeScale: 1 });

  assert.ok(smallSafeArea.errors.length > 0);
  assert.equal(fullSafeArea.errors.length, 0);
});

test("draw and travel speed settings are reflected in commands", () => {
  const stroke = makeStroke([
    [190, 250],
    [250, 250],
  ]);
  const result = simulate(stroke, { drawSpeed: 22, travelSpeed: 77 });
  const drawMove = result.commands.find((command) => command.type === "move" && command.speed === 22);
  const travelMove = result.commands.find((command) => command.type === "move" && command.speed === 77);

  assert.ok(drawMove);
  assert.ok(travelMove);
});

test("position id travel between parallel strokes is a move, not a rotate", () => {
  const strokes = [
    makeStroke([
      [180, 225],
      [320, 225],
    ]),
    makeStroke([
      [180, 275],
      [320, 275],
    ]),
  ];
  const result = new core.PositionIdPlanner(
    core.withDefaults({
      smoothing: 0,
      minPointDistance: 1,
      cornerAngle: 60,
      lineCorrection: 1,
      lineTolerance: 4,
      minSegmentLength: 0,
      penOffsetX: -48,
      penOffsetY: 0,
      drawSpeed: 20,
      travelSpeed: 20,
    }),
  ).plan(strokes);

  assert.deepEqual(
    result.commands.map((command) => command.type),
    ["pen", "move", "pen", "move", "pen", "move", "pen", "move", "pen"],
  );
  assert.equal(result.commands.some((command) => command.type === "rotate"), false);
  assert.equal(result.commands[5].x, 228);
  assert.equal(result.commands[5].y, 275);
  assert.equal(result.commands[5].theta, 0);
});

test("native Position ID center is used directly as the play mat coordinate system", () => {
  const nativeCenter = {
    x: (core.NATIVE_MAT.minX + core.NATIVE_MAT.maxX) / 2,
    y: (core.NATIVE_MAT.minY + core.NATIVE_MAT.maxY) / 2,
  };
  const matCenter = core.nativeToMatPoint(nativeCenter);

  assert.deepEqual(matCenter, nativeCenter);
});

test("mat coordinates round-trip through native Position ID coordinates", () => {
  const matPoint = { x: 250, y: 250 };
  const nativePoint = core.matToNativePoint(matPoint);
  const result = core.nativeToMatPoint(nativePoint);

  assert.ok(Math.abs(result.x - matPoint.x) < 0.001);
  assert.ok(Math.abs(result.y - matPoint.y) < 0.001);
});

test("dead reckoning simulation creates draw segments and motor commands", () => {
  const stroke = makeStroke([
    [190, 250],
    [250, 250],
  ]);
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0 })).plan([stroke]);

  assert.equal(result.mode, "dead");
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].kind, "draw");
  assert.equal(result.segments[0].lengthMm, 60);
  assert.ok(result.commands.some((command) => command.type === "motor"));
});

test("dead reckoning arc primitive creates one arc motor command", () => {
  const stroke = {
    raw: [
      { x: 320, y: 250 },
      { x: 250, y: 320 },
      { x: 180, y: 250 },
      { x: 250, y: 180 },
      { x: 320, y: 250 },
    ],
    primitives: [
      {
        kind: "arc",
        center: { x: 250, y: 250 },
        radius: 70,
        startAngle: 0,
        sweepAngle: 360,
      },
    ],
  };
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, penOffsetX: 0, penOffsetY: 0 })).plan([stroke]);
  const drawMotors = result.commands.filter((command) => command.type === "motor" && command.kind === "draw");

  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].geometry, "arc");
  assert.equal(result.stats.drawSegments, 1);
  assert.equal(result.stats.penDowns, 1);
  assert.equal(result.stats.penUps, 1);
  assert.equal(drawMotors.length, 1);
  assert.equal(drawMotors[0].geometry, "arc");
  assert.notEqual(drawMotors[0].leftSpeed, drawMotors[0].rightSpeed);
  assert.ok(drawMotors[0].durationMs > 2550);
  assert.ok(drawMotors[0].penPreviewPoints.length > 10);
});

test("circle sample dead reckoning duration is scaled to half", () => {
  const baseSample = {
    ...circleSample,
    deadSegmentSettings: {},
  };
  const base = core.createDeadReckoningSimulation({
    strokes: baseSample.strokes,
    config: core.withDefaults({ smoothing: 0, lineCorrection: 0, penOffsetX: 0, penOffsetY: 0 }),
    segmentSettings: baseSample.deadSegmentSettings,
  });
  const scaled = core.createDeadReckoningSimulation({
    strokes: circleSample.strokes,
    config: core.withDefaults({ smoothing: 0, lineCorrection: 0, penOffsetX: 0, penOffsetY: 0 }),
    segmentSettings: circleSample.deadSegmentSettings,
  });
  const baseMotor = base.commands.find((command) => command.type === "motor" && command.geometry === "arc");
  const scaledMotor = scaled.commands.find((command) => command.type === "motor" && command.geometry === "arc");

  assert.ok(baseMotor);
  assert.ok(scaledMotor);
  assert.equal(scaledMotor.durationMs, baseMotor.durationMs / 2);
});

test("dead reckoning uses auto-corrected freehand arcs as one draw motor command", () => {
  const raw = [];
  for (let angle = 180; angle >= 45; angle -= 15) {
    raw.push({
      x: 250 + 70 * Math.cos((angle * Math.PI) / 180),
      y: 250 + 70 * Math.sin((angle * Math.PI) / 180),
    });
  }
  const result = new core.DeadReckoningPlanner(
    core.withDefaults({ smoothing: 0, minPointDistance: 1, lineCorrection: 1, lineTolerance: 4, minSegmentLength: 0, penOffsetX: -48, penOffsetY: 0 }),
  ).plan([{ source: "freehand", raw }]);
  const drawMotors = result.commands.filter((command) => command.type === "motor" && command.kind === "draw");

  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].geometry, "arc");
  assert.equal(drawMotors.length, 1);
  assert.equal(drawMotors[0].geometry, "arc");
});

test("dead reckoning motor commands include cube start and end centers", () => {
  const stroke = makeStroke([
    [190, 250],
    [250, 250],
  ]);
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, penOffsetX: -48, penOffsetY: 0 })).plan([stroke]);
  const segment = result.segments[0];
  const motor = result.commands.find((command) => command.type === "motor" && command.kind === "draw");

  assert.ok(motor);
  assert.equal(motor.fromX, segment.startCube.x);
  assert.equal(motor.fromY, segment.startCube.y);
  assert.equal(motor.x, segment.endCube.x);
  assert.equal(motor.y, segment.endCube.y);
});

test("dead reckoning straight motor durations use 10ms steps", () => {
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadMmPerSecAtDrawSpeed: 37 })).plan([
    makeStroke([
      [190, 250],
      [240, 250],
    ]),
  ]);
  const motor = result.commands.find((command) => command.type === "motor" && command.kind === "draw");

  assert.ok(motor);
  assert.equal(motor.durationMs % 10, 0);
});

test("dead reckoning inserts travel between separate strokes", () => {
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0 })).plan([
      makeStroke([
        [10, 10],
        [60, 10],
      ]),
      makeStroke([
        [80, 40],
        [120, 40],
      ]),
    ]);

  assert.equal(result.stats.drawSegments, 2);
  assert.ok(result.stats.travelSegments >= 1);
  assert.equal(result.segments[1].kind, "travel");
});

test("dead reckoning travel distance scale shortens pen-up travel only", () => {
  const strokes = [
    makeStroke([
      [180, 225],
      [320, 225],
    ]),
    makeStroke([
      [180, 275],
      [320, 275],
    ]),
  ];
  const base = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadTravelDistanceScale: 1 })).plan(strokes);
  const shortened = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadTravelDistanceScale: 0.5 })).plan(strokes);
  const baseTravel = base.commands.find((command) => command.type === "motor" && command.kind === "travel");
  const shortenedTravel = shortened.commands.find((command) => command.type === "motor" && command.kind === "travel");
  const baseDraw = base.commands.find((command) => command.type === "motor" && command.kind === "draw");
  const shortenedDraw = shortened.commands.find((command) => command.type === "motor" && command.kind === "draw");

  assert.ok(baseTravel);
  assert.ok(shortenedTravel);
  assert.ok(shortenedTravel.durationMs < baseTravel.durationMs);
  assert.ok(Math.abs(shortenedTravel.durationMs - baseTravel.durationMs / 2) <= 10);
  assert.equal(shortenedDraw.durationMs, baseDraw.durationMs);
});

test("dead reckoning changes draw direction with motor-only transition steps", () => {
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, penOffsetX: -48, penOffsetY: 0 })).plan([
    makeStroke([
      [190, 250],
      [250, 250],
      [250, 310],
    ]),
  ]);
  const first = result.segments[0];
  const second = result.segments[1];
  const transitionMotor = result.commands.find((command) => command.role === "transition-travel");
  const turnToTravel = result.commands.find((command) => command.role === "turn-to-travel");
  const turnToDraw = result.commands.find((command) => command.role === "turn-to-draw");

  assert.ok(turnToTravel);
  assert.ok(transitionMotor);
  assert.ok(turnToDraw);
  assert.equal(turnToTravel.x, first.endCube.x);
  assert.equal(turnToTravel.y, first.endCube.y);
  assert.equal(transitionMotor.x, second.startCube.x);
  assert.equal(transitionMotor.y, second.startCube.y);
  assert.equal(turnToDraw.x, second.startCube.x);
  assert.equal(turnToDraw.y, second.startCube.y);
  assert.equal(result.commands.some((command) => command.type === "align"), false);
});

test("dead reckoning ignores saved turn duration scale values", () => {
  const base = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadTurnDurationScale: 1 })).plan([
    makeStroke([
      [190, 250],
      [250, 250],
      [250, 310],
    ]),
  ]);
  const scaled = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadTurnDurationScale: 0.5 })).plan([
    makeStroke([
      [190, 250],
      [250, 250],
      [250, 310],
    ]),
  ]);
  const baseTurn = base.commands.find((command) => command.type === "turn" && Math.abs(command.angle) > 1);
  const scaledTurn = scaled.commands.find((command) => command.type === "turn" && Math.abs(command.angle) > 1);

  assert.ok(baseTurn);
  assert.ok(scaledTurn);
  assert.equal(scaledTurn.durationMs, baseTurn.durationMs);
});

test("dead reckoning default turn duration uses 90 degree milliseconds", () => {
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadTurnMsPer90: 720 })).plan([
    makeStroke([
      [190, 250],
      [250, 250],
      [250, 310],
    ]),
  ]);
  const turn = result.commands.find((command) => command.type === "turn" && Math.abs(command.angle) > 1);

  assert.ok(turn);
  const calibratedMs = Math.round((Math.abs(turn.angle) / 90) * 720);
  assert.equal(turn.durationMs, calibratedMs);
});

test("dead reckoning turn commands keep planned wheel speeds", () => {
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadTurnSpeed: 12, deadTurnBalanceTrim: 0 })).plan([
    makeStroke([
      [190, 250],
      [250, 250],
      [250, 310],
    ]),
  ]);
  const turn = result.commands.find((command) => command.type === "turn" && Math.abs(command.angle) > 1);

  assert.ok(turn);
  assert.equal(turn.leftSpeed, 12);
  assert.equal(turn.rightSpeed, -12);
});

test("dead reckoning segment turn duration scale is ignored", () => {
  const base = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadTurnSpeed: 20, deadTurnDurationScale: 1 })).plan([
    makeStroke([
      [190, 250],
      [250, 250],
      [250, 310],
    ]),
  ]);
  const doubled = new core.DeadReckoningPlanner(
    core.withDefaults({ smoothing: 0, lineCorrection: 0, deadTurnSpeed: 20 }),
    { "seg-0": { turnDurationScale: 2 } },
  ).plan([
    makeStroke([
      [190, 250],
      [250, 250],
      [250, 310],
    ]),
  ]);
  const baseTurn = base.commands.find((command) => command.type === "turn" && Math.abs(command.angle) > 1);
  const doubledTurn = doubled.commands.find((command) => command.type === "turn" && Math.abs(command.angle) > 1);

  assert.ok(baseTurn);
  assert.ok(doubledTurn);
  assert.equal(doubledTurn.durationMs, baseTurn.durationMs);
});

test("dead reckoning turn commands keep a practical minimum duration", () => {
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadTurnSpeed: 20 })).plan([
    makeStroke([
      [190, 250],
      [250, 250],
      [309, 260],
    ]),
  ]);
  const smallTurn = result.commands.find((command) => command.type === "turn" && Math.abs(command.angle) > 1);

  assert.ok(smallTurn);
  assert.ok(smallTurn.durationMs >= 150);
});

test("signed angle delta returns the shortest turn", () => {
  assert.equal(core.signedAngleDelta(350, 10), 20);
  assert.equal(core.signedAngleDelta(10, 350), -20);
});

test("legacy simulation functions delegate to mode planners", () => {
  const stroke = makeStroke([
    [190, 250],
    [250, 250],
  ]);
  const config = core.withDefaults({ smoothing: 0, lineCorrection: 0 });
  const position = core.createSimulation({ strokes: [stroke], config });
  const positionPlanner = new core.PositionIdPlanner(config).plan([stroke]);
  const dead = core.createDeadReckoningSimulation({ strokes: [stroke], config });
  const deadPlanner = new core.DeadReckoningPlanner(config).plan([stroke]);

  assert.deepEqual(position.commands, positionPlanner.commands);
  assert.deepEqual(dead.commands, deadPlanner.commands);
});
