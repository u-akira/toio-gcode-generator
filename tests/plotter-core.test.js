const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../plotter-core.js");
const circleSample = require("../samples/json/circle.json");
const catFaceSample = require("../samples/json/cat-face.json");
const coderSample = require("../samples/json/coder.json");
const dojoSample = require("../samples/json/dojo.json");
const keroppiOutlineSample = require("../samples/json/keroppi-outline.json");
const stackChanSample = require("../samples/json/stack-chan.json");
const starSample = require("../samples/json/star.json");

function makeStroke(points) {
  return { raw: points.map(([x, y]) => ({ x, y })) };
}

function boundsOfPoints(points) {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
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
  assert.equal(core.DEFAULT_CONFIG.deadTurnSpeed, 8);
});

test("default run mode is dead reckoning", () => {
  assert.equal(core.DEFAULT_CONFIG.runMode, "dead");
});

test("default dead reckoning turn duration uses direct 90 degree milliseconds", () => {
  assert.equal(core.DEFAULT_CONFIG.deadTurnMsPer90, 1023);
  assert.equal(core.computeTurnDurationMs(90, core.withDefaults()), 1020);
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

test("freehand shape correction closes a nearly complete circle", () => {
  const points = [];
  for (let angle = 0; angle <= 340; angle += 20) {
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
  assert.equal(shape.primitives[0].sweepAngle, 360);
});

test("freehand shape correction rejects curved strokes that are not stable arcs", () => {
  const shape = core.processStrokeShape(
    [
      { x: 170, y: 250 },
      { x: 195, y: 222 },
      { x: 220, y: 282 },
      { x: 245, y: 225 },
      { x: 270, y: 278 },
      { x: 295, y: 250 },
    ],
    core.withDefaults({ smoothing: 0, minPointDistance: 1, lineCorrection: 1, lineTolerance: 4, minSegmentLength: 0 }),
  );

  assert.equal(shape.primitives, null);
  assert.match(shape.error, /補正できません|ばらつき/);
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

test("default dead reckoning draw timing maps 140mm to 2500ms", () => {
  const stroke = makeStroke([
    [180, 250],
    [320, 250],
  ]);
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0 })).plan([stroke]);
  const drawMotor = result.commands.find((command) => command.type === "motor" && command.kind === "draw");

  assert.equal(result.segments[0].lengthMm, 140);
  assert.equal(drawMotor.durationMs, 2500);
});

test("dead reckoning draw timing calibration does not change line geometry", () => {
  const stroke = makeStroke([
    [180, 250],
    [320, 250],
  ]);
  const slow = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadMmPerSecAtDrawSpeed: 30 })).plan([stroke]);
  const fast = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadMmPerSecAtDrawSpeed: 56 })).plan([stroke]);
  const slowMotor = slow.commands.find((command) => command.type === "motor" && command.kind === "draw");
  const fastMotor = fast.commands.find((command) => command.type === "motor" && command.kind === "draw");

  assert.equal(slow.segments[0].lengthMm, fast.segments[0].lengthMm);
  assert.deepEqual(slow.segments[0].start, fast.segments[0].start);
  assert.deepEqual(slow.segments[0].end, fast.segments[0].end);
  assert.equal(slowMotor.fromX, fastMotor.fromX);
  assert.equal(slowMotor.fromY, fastMotor.fromY);
  assert.equal(slowMotor.x, fastMotor.x);
  assert.equal(slowMotor.y, fastMotor.y);
  assert.equal(slowMotor.penX, fastMotor.penX);
  assert.equal(slowMotor.penY, fastMotor.penY);
  assert.notEqual(slowMotor.durationMs, fastMotor.durationMs);
});

test("dead reckoning straight draw timing calibration does not affect arcs", () => {
  const stroke = {
    raw: [
      { x: 320, y: 250 },
      { x: 250, y: 320 },
      { x: 180, y: 250 },
    ],
    primitives: [
      {
        kind: "arc",
        center: { x: 250, y: 250 },
        radius: 70,
        startAngle: 0,
        sweepAngle: 180,
      },
    ],
  };
  const slowStraight = new core.DeadReckoningPlanner(
    core.withDefaults({ smoothing: 0, lineCorrection: 0, deadMmPerSecAtDrawSpeed: 30, deadArcMmPerSecAtDrawSpeed: 30 }),
  ).plan([stroke]);
  const fastStraight = new core.DeadReckoningPlanner(
    core.withDefaults({ smoothing: 0, lineCorrection: 0, deadMmPerSecAtDrawSpeed: 56, deadArcMmPerSecAtDrawSpeed: 30 }),
  ).plan([stroke]);
  const fastArc = new core.DeadReckoningPlanner(
    core.withDefaults({ smoothing: 0, lineCorrection: 0, deadMmPerSecAtDrawSpeed: 56, deadArcMmPerSecAtDrawSpeed: 56 }),
  ).plan([stroke]);
  const slowStraightMotor = slowStraight.commands.find((command) => command.type === "motor" && command.kind === "draw");
  const fastStraightMotor = fastStraight.commands.find((command) => command.type === "motor" && command.kind === "draw");
  const fastArcMotor = fastArc.commands.find((command) => command.type === "motor" && command.kind === "draw");

  assert.equal(slowStraightMotor.durationMs, fastStraightMotor.durationMs);
  assert.notEqual(fastStraightMotor.durationMs, fastArcMotor.durationMs);
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

test("small dead reckoning arcs allow the inner wheel to reverse", () => {
  const speeds = core.computeArcWheelSpeeds(20, 8, 180, 26);

  assert.equal(speeds.left, 53);
  assert.equal(speeds.right, -12);
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
  assert.equal(scaledMotor.durationMs, 7400);
  assert.equal(scaledMotor.durationMs, Math.round((baseMotor.durationMs / 2) / 10) * 10);
});

test("cat face sample connects angled ears and forehead arc to the lower arc", () => {
  const result = core.createDeadReckoningSimulation({
    strokes: [catFaceSample.strokes[0]],
    config: core.withDefaults({ smoothing: 0, lineCorrection: 0 }),
  });
  const arcs = result.segments.filter((segment) => segment.geometry === "arc");
  const lowerArc = arcs[arcs.length - 1];
  const previous = result.segments[result.segments.indexOf(lowerArc) - 1];

  assert.equal(result.segments.length, 6);
  assert.equal(result.segments.some((segment) => segment.kind === "travel"), false);
  assert.equal(arcs.length, 2);
  assert.ok(lowerArc);
  assert.ok(previous);
  assert.ok(core.distance(previous.end, lowerArc.start) < 0.1);
  assert.ok(core.distance(lowerArc.end, result.segments[0].start) < 0.1);
});

test("cat face sample marks eyes and nose with waits and four straight whiskers", () => {
  const result = core.createDeadReckoningSimulation({
    strokes: catFaceSample.strokes,
    config: core.withDefaults({ smoothing: 0, lineCorrection: 0 }),
  });
  const waits = result.commands.filter((command) => command.type === "wait");
  const whiskerStrokes = catFaceSample.strokes.slice(4);

  assert.deepEqual(
    waits.map((command) => ({ ms: command.ms, penX: command.penX, penY: command.penY })),
    [
      { ms: 1000, penX: 224, penY: 268 },
      { ms: 1000, penX: 276, penY: 268 },
      { ms: 1000, penX: 250, penY: 286 },
    ],
  );
  assert.equal(whiskerStrokes.length, 4);
  assert.ok(whiskerStrokes.every((stroke) => stroke.primitives.length === 1 && stroke.primitives[0].kind === "line"));
});

test("keroppi outline sample draws tight outer eyes and side outline arcs slowly", () => {
  const result = core.createDeadReckoningSimulation({
    strokes: keroppiOutlineSample.strokes,
    config: core.withDefaults({ smoothing: 0, lineCorrection: 0 }),
    segmentSettings: keroppiOutlineSample.deadSegmentSettings,
  });
  const drawMotors = result.commands.filter((command) => command.type === "motor" && command.kind === "draw");
  const drawSegments = result.segments.filter((segment) => segment.kind === "draw");
  const leftOutline = drawSegments[0];
  const rightOutline = drawSegments[3];
  const mouth = drawSegments[4];
  const leftInnerEye = drawSegments[5];
  const rightInnerEye = drawSegments[6];
  const leftEyeRadius = Math.hypot(8, 48);
  const rightEyeRadius = Math.hypot(8, 48);

  assert.deepEqual(result.errors, []);
  assert.equal(result.stats.drawSegments, 7);
  assert.ok(Math.abs(core.distance(leftOutline.start, { x: 201, y: 218 }) - leftEyeRadius) < 1);
  assert.ok(leftOutline.start.x > 160);
  assert.ok(leftOutline.start.y > 245);
  assert.ok(leftOutline.end.x > 140);
  assert.ok(leftOutline.end.y > 350);
  assert.ok(Math.abs(core.distance(rightOutline.start, { x: 299, y: 218 }) - rightEyeRadius) < 1);
  assert.ok(Math.abs(leftOutline.start.x + rightOutline.start.x - 500) < 1);
  assert.ok(Math.abs(leftOutline.end.x + rightOutline.end.x - 500) < 1);
  assert.ok(Math.abs(leftOutline.end.y - rightOutline.end.y) < 1);
  assert.ok(mouth.start.x < 210);
  assert.ok(mouth.end.x > 290);
  assert.ok(Math.max(...mouth.penPreviewPoints.map((point) => point.y)) > 345);
  assert.ok(Math.abs(leftInnerEye.start.x + rightInnerEye.end.x - 500) < 1);
  assert.ok(Math.abs(leftInnerEye.end.x + rightInnerEye.start.x - 500) < 1);
  assert.ok(Math.min(...leftInnerEye.penPreviewPoints.map((point) => point.y)) < 220);
  assert.ok(Math.min(...rightInnerEye.penPreviewPoints.map((point) => point.y)) < 220);
  assert.ok(drawMotors.some((command) => command.leftSpeed < 0 || command.rightSpeed < 0));
  assert.ok(drawMotors.every((command) => Math.max(Math.abs(command.leftSpeed), Math.abs(command.rightSpeed)) <= 32));
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

test("dead reckoning straight motor duration is not capped to one toio packet", () => {
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, deadMmPerSecAtDrawSpeed: 30 })).plan([
    makeStroke([
      [180, 260],
      [196, 178],
    ]),
  ]);
  const motor = result.commands.find((command) => command.type === "motor" && command.kind === "draw");

  assert.ok(motor);
  assert.ok(motor.durationMs > 2550);
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

test("dead reckoning recalculates pen-up travel directly to the next draw start", () => {
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
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0, penOffsetX: -48, penOffsetY: 0 })).plan(strokes);
  const travelMotor = result.commands.find((command) => command.type === "motor" && command.kind === "travel" && command.segmentId === "seg-1");
  const travelTurns = result.commands.filter((command) => command.type === "turn" && command.segmentId === "seg-1");
  const drawTurn = result.commands.find((command) => command.type === "turn" && command.segmentId === "seg-2" && command.role === "turn-to-draw");

  assert.ok(travelMotor);
  assert.equal(travelMotor.targetSegmentId, "seg-2");
  assert.equal(travelMotor.fromX, result.segments[0].endCube.x);
  assert.equal(travelMotor.fromY, result.segments[0].endCube.y);
  assert.equal(travelMotor.x, result.segments[2].startCube.x);
  assert.equal(travelMotor.y, result.segments[2].startCube.y);
  assert.deepEqual(
    travelTurns.map((command) => command.role),
    ["turn-to-travel"],
  );
  assert.ok(drawTurn);
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

test("stack-chan sample marks eyes with one second pen-down waits", () => {
  const result = new core.DeadReckoningPlanner(core.withDefaults({ smoothing: 0, lineCorrection: 0 })).plan(stackChanSample.strokes);
  const waitIndexes = result.commands.map((command, index) => (command.type === "wait" ? index : -1)).filter((index) => index >= 0);
  const waits = waitIndexes.map((index) => result.commands[index]);

  assert.equal(waits.length, 2);
  assert.deepEqual(
    waits.map((command) => command.ms),
    [1000, 1000],
  );
  for (const index of waitIndexes) {
    assert.equal(result.commands[index - 1].type, "pen");
    assert.equal(result.commands[index - 1].state, "down");
    assert.equal(result.commands[index + 1].type, "pen");
    assert.equal(result.commands[index + 1].state, "up");
    const previousMotor = result.commands.slice(0, index - 1).findLast((command) => command.type === "motor");
    assert.ok(previousMotor);
    assert.ok(Math.abs(previousMotor.penX - result.commands[index - 1].penX) < 0.001);
    assert.ok(Math.abs(previousMotor.penY - result.commands[index - 1].penY) < 0.001);
  }
});

test("stack-chan sample uses a wider raised inner rectangle", () => {
  const primitives = stackChanSample.strokes[0].primitives;
  const innerRectangle = primitives.slice(4, 8);

  assert.deepEqual(innerRectangle[0].start, { x: 184, y: 194 });
  assert.deepEqual(innerRectangle[0].end, { x: 316, y: 194 });
  assert.deepEqual(innerRectangle[2].start, { x: 316, y: 278 });
  assert.deepEqual(innerRectangle[2].end, { x: 184, y: 278 });
});

test("star sample dead reckoning cube path stays inside the A3 preview area", () => {
  const config = core.withDefaults();
  const result = core.createDeadReckoningSimulation({ strokes: starSample.strokes, config });
  const centerX = (config.mat?.minX ?? 98) + ((config.mat?.maxX ?? 402) - (config.mat?.minX ?? 98)) / 2;
  const centerY = (config.mat?.minY ?? 142) + ((config.mat?.maxY ?? 358) - (config.mat?.minY ?? 142)) / 2;
  const halfW = 420 / 2;
  const halfH = 297 / 2;
  const cubeHalfSizeMm = 16;
  const safe = {
    minX: centerX - halfW + cubeHalfSizeMm,
    maxX: centerX + halfW - cubeHalfSizeMm,
    minY: centerY - halfH + cubeHalfSizeMm,
    maxY: centerY + halfH - cubeHalfSizeMm,
  };

  assert.ok(result.cubePath.length > 0);
  for (const point of result.cubePath) {
    assert.ok(point.x >= safe.minX && point.x <= safe.maxX, `cube x ${point.x} is outside ${safe.minX}..${safe.maxX}`);
    assert.ok(point.y >= safe.minY && point.y <= safe.maxY, `cube y ${point.y} is outside ${safe.minY}..${safe.maxY}`);
  }
});

test("star sample drawing stays inside the minimum A3 safe drawing area", () => {
  const config = core.withDefaults({ safeScale: 0.5 });
  const result = core.createDeadReckoningSimulation({ strokes: starSample.strokes, config });
  const centerX = (config.mat?.minX ?? 98) + ((config.mat?.maxX ?? 402) - (config.mat?.minX ?? 98)) / 2;
  const centerY = (config.mat?.minY ?? 142) + ((config.mat?.maxY ?? 358) - (config.mat?.minY ?? 142)) / 2;
  const safe = {
    minX: centerX - (420 * config.safeScale) / 2,
    maxX: centerX + (420 * config.safeScale) / 2,
    minY: centerY - (297 * config.safeScale) / 2,
    maxY: centerY + (297 * config.safeScale) / 2,
  };
  const drawPoints = result.segments.filter((segment) => segment.kind === "draw").flatMap((segment) => [segment.start, segment.end]);

  for (const point of drawPoints) {
    assert.ok(point.x >= safe.minX && point.x <= safe.maxX, `draw x ${point.x} is outside ${safe.minX}..${safe.maxX}`);
    assert.ok(point.y >= safe.minY && point.y <= safe.maxY, `draw y ${point.y} is outside ${safe.minY}..${safe.maxY}`);
  }
});

test("star sample dead reckoning draw segments preserve the sample size", () => {
  const result = core.createDeadReckoningSimulation({ strokes: starSample.strokes, config: core.withDefaults() });
  const rawBounds = boundsOfPoints(starSample.strokes.flatMap((stroke) => stroke.raw));
  const drawBounds = boundsOfPoints(result.segments.filter((segment) => segment.kind === "draw").flatMap((segment) => [segment.start, segment.end]));

  assert.equal(result.segments.filter((segment) => segment.kind === "draw").length, 10);
  assert.deepEqual(drawBounds, rawBounds);
});

test("coder and dojo samples use straight segments for lowercase o", () => {
  for (const { sample, edgeCount } of [
    { sample: coderSample, edgeCount: 4 },
    { sample: dojoSample, edgeCount: 4 },
  ]) {
    const result = core.createDeadReckoningSimulation({
      strokes: sample.strokes,
      config: core.withDefaults({ smoothing: 0, lineCorrection: 0, penOffsetX: -48, penOffsetY: 0 }),
    });
    const hasSpin = sample.strokes.some((stroke) => stroke.primitives?.some((primitive) => primitive.kind === "spin"));
    const closedLineO = sample.strokes.some((stroke) => {
      const primitives = stroke.primitives || [];
      if (primitives.length !== edgeCount || !primitives.every((primitive) => primitive.kind === "line")) return false;
      return core.distance(primitives[0].start, primitives[primitives.length - 1].end) < 0.1;
    });

    assert.deepEqual(result.errors, []);
    assert.equal(hasSpin, false);
    assert.equal(closedLineO, true);
  }
});

test("dojo sample draws the j dot with the same point wait as stack-chan eyes", () => {
  const dojoDot = dojoSample.strokes.flatMap((stroke) => stroke.primitives || []).find((primitive) => primitive.kind === "point");
  const stackChanEye = stackChanSample.strokes[0].primitives.find((primitive) => primitive.kind === "point");

  assert.ok(dojoDot);
  assert.ok(stackChanEye);
  assert.equal(dojoDot.waitMs, stackChanEye.waitMs);
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
