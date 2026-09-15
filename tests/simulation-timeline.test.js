const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../plotter-core.js");

function loadTimelineTools({ commands, config, mode = "position" }) {
  const context = { window: {}, Math };
  vm.createContext(context);
  const deadMotionSource = fs.readFileSync(path.join(__dirname, "..", "app-dead-motion.js"), "utf8");
  vm.runInContext(deadMotionSource, context);
  const source = fs.readFileSync(path.join(__dirname, "..", "app-simulation-timeline.js"), "utf8");
  vm.runInContext(source, context);
  return context.window.ToioPlotterTimeline.createSimulationTimelineTools({
    getSimulation: () => ({ commands, mode }),
    getConfig: () => config,
    cubeToPen: core.cubeToPen,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    distance: core.distance,
    normalizeDegrees: (degrees) => ((degrees % 360) + 360) % 360,
    signedAngleDelta: core.signedAngleDelta,
    pointOnCircle: core.pointOnCircle,
    minTurnDurationMs: 120,
    deadMotion: context.window.ToioPlotterDeadMotion,
  });
}

test("position id travel move animation turns before translating sideways", () => {
  const config = core.withDefaults({ penOffsetX: -48, penOffsetY: 0 });
  const commands = [
    { type: "move", x: 368, y: 225, theta: 0, speed: 20, penX: 320, penY: 225, durationMs: 1000 },
    { type: "move", x: 228, y: 275, theta: 0, speed: 20, penX: 180, penY: 275, durationMs: 1200 },
  ];
  const tools = loadTimelineTools({ commands, config });
  const timeline = tools.buildSimulationTimeline(commands);
  assert.equal(timeline.mode, "position");
  const travelItem = timeline.items[1];
  const frame = tools.commandsAtElapsed(timeline, travelItem.startMs + 80).at(-1);

  assert.equal(frame.type, "move");
  assert.ok(Math.abs(frame.x - 368) < 0.001);
  assert.ok(Math.abs(frame.y - 225) < 0.001);
  assert.notEqual(Math.round(frame.theta), 0);
});

test("dead reckoning motor animation uses dead timeline without position turn approximation", () => {
  const config = core.withDefaults({ penOffsetX: -48, penOffsetY: 0 });
  const commands = [
    {
      type: "motor",
      fromX: 100,
      fromY: 100,
      x: 100,
      y: 200,
      theta: 0,
      penX: 52,
      penY: 200,
      durationMs: 1000,
    },
  ];
  const tools = loadTimelineTools({ commands, config, mode: "dead" });
  const timeline = tools.buildSimulationTimeline(commands);
  assert.equal(timeline.mode, "dead");

  const frame = tools.commandsAtElapsed(timeline, 500).at(-1);
  assert.equal(frame.type, "motor");
  assert.equal(frame.x, 100);
  assert.equal(frame.y, 150);
  assert.equal(frame.theta, 0);
  assert.equal(frame.previewProgress, undefined);
});

test("dead reckoning motor animation starts from the previous pose", () => {
  const config = core.withDefaults({ penOffsetX: -48, penOffsetY: 0 });
  const commands = [
    {
      type: "turn",
      x: 10,
      y: 20,
      theta: 90,
      durationMs: 1000,
      penX: 10,
      penY: 20,
    },
    {
      type: "motor",
      kind: "travel",
      geometry: "line",
      speed: 20,
      fromX: 200,
      fromY: 200,
      x: 10,
      y: 120,
      theta: 90,
      penX: 10,
      penY: 120,
      durationMs: 1000,
    },
  ];
  const tools = loadTimelineTools({ commands, config, mode: "dead" });
  const timeline = tools.buildSimulationTimeline(commands);
  const travelItem = timeline.items[1];
  const frame = tools.commandsAtElapsed(timeline, travelItem.startMs).at(-1);
  const midFrame = tools.commandsAtElapsed(timeline, travelItem.startMs + 500).at(-1);

  assert.equal(frame.type, "motor");
  assert.equal(frame.x, 10);
  assert.equal(frame.y, 20);
  assert.equal(Math.round(midFrame.x), 10);
  assert.equal(Math.round(midFrame.y), 70);
});

test("dead reckoning motor animation interpolates to the command endpoint", () => {
  const config = core.withDefaults({ penOffsetX: 0, penOffsetY: 0 });
  const commands = [
    {
      type: "turn",
      x: 0,
      y: 0,
      theta: 0,
      durationMs: 100,
      penX: 0,
      penY: 0,
    },
    {
      type: "motor",
      kind: "draw",
      geometry: "line",
      speed: 20,
      fromX: 0,
      fromY: 0,
      x: 80,
      y: 0,
      theta: 0,
      penX: 80,
      penY: 0,
      durationMs: 3000,
    },
  ];
  const tools = loadTimelineTools({ commands, config, mode: "dead" });
  const timeline = tools.buildSimulationTimeline(commands);
  const item = timeline.items[1];
  const frame = tools.commandsAtElapsed(timeline, item.startMs + 1500).at(-1);

  assert.equal(frame.x, 40);
  assert.equal(frame.y, 0);
  assert.equal(frame.penX, 40);
  assert.equal(frame.penY, 0);
});

test("dead reckoning arc animation appends the exact current arc point", () => {
  const config = core.withDefaults({ penOffsetX: 0, penOffsetY: 0 });
  const commands = [
    {
      type: "motor",
      kind: "draw",
      geometry: "arc",
      center: { x: 0, y: 0 },
      radius: 100,
      startAngle: 0,
      sweepAngle: 90,
      startTheta: 90,
      theta: 180,
      durationMs: 1000,
      cubePreviewPoints: [
        { x: 100, y: 0, theta: 90 },
        { x: 0, y: 100, theta: 180 },
      ],
      penPreviewPoints: [
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
    },
  ];
  const tools = loadTimelineTools({ commands, config, mode: "dead" });
  const timeline = tools.buildSimulationTimeline(commands);
  const frame = tools.commandsAtElapsed(timeline, 500).at(-1);

  assert.equal(frame.cubePreviewPoints.length, 2);
  assert.equal(frame.penPreviewPoints.length, 2);
  assert.ok(Math.abs(frame.cubePreviewPoints.at(-1).x - 70.71) < 0.02);
  assert.ok(Math.abs(frame.cubePreviewPoints.at(-1).y - 70.71) < 0.02);
  assert.equal(frame.cubePreviewPoints.at(-1).x, frame.x);
  assert.equal(frame.cubePreviewPoints.at(-1).y, frame.y);
  assert.equal(frame.cubePreviewPoints.at(-1).theta, frame.theta);
  assert.equal(frame.penPreviewPoints.at(-1).x, frame.penX);
  assert.equal(frame.penPreviewPoints.at(-1).y, frame.penY);
});

test("dead reckoning edited differential command animates its computed path", () => {
  const config = core.withDefaults({ penOffsetX: 0, penOffsetY: 0, deadWheelBaseMm: 26, deadArcMmPerSecAtDrawSpeed: 30 });
  const commands = [
    { type: "pen", state: "down", penX: 0, penY: 0 },
    {
      type: "motor", kind: "draw", geometry: "arc", motionModel: "differential-drive",
      leftSpeed: 30, rightSpeed: 20, durationMs: 1000,
      fromX: 0, fromY: 0, x: 0, y: 0, theta: 0, startTheta: 0,
      penX: 0, penY: 0,
    },
  ];
  const tools = loadTimelineTools({ commands, config, mode: "dead" });
  const timeline = tools.buildSimulationTimeline(commands);
  const frame = tools.commandsAtElapsed(timeline, 500).at(-1);

  assert.ok(frame.x > 0);
  assert.ok(frame.y > 0);
  assert.ok(frame.penPreviewPoints.length > 2);
});

test("dead reckoning travel animation follows the command endpoint continuously", () => {
  const config = core.withDefaults({ penOffsetX: 0, penOffsetY: 0, deadWheelBaseMm: 26, deadMmPerSecAtTravelSpeed: 30 });
  const commands = [
    {
      type: "motor", kind: "travel", geometry: "line",
      leftSpeed: 20, rightSpeed: 20, durationMs: 1000,
      fromX: 0, fromY: 0, x: 100, y: 0, theta: 90, startTheta: 90,
      penX: 100, penY: 0,
    },
  ];
  const tools = loadTimelineTools({ commands, config, mode: "dead" });
  const timeline = tools.buildSimulationTimeline(commands);
  const frame = tools.commandsAtElapsed(timeline, 500).at(-1);

  assert.ok(Math.abs(frame.x - 50) < 0.001);
  assert.ok(Math.abs(frame.y) < 0.001);
});

test("dead reckoning straight draw animation uses straight-line calibration", () => {
  const config = core.withDefaults({ penOffsetX: 0, penOffsetY: 0, deadMmPerSecAtDrawSpeed: 56, deadArcMmPerSecAtDrawSpeed: 29.84 });
  const commands = [
    {
      type: "motor", kind: "draw", geometry: "line", motionModel: "differential-drive",
      leftSpeed: 20, rightSpeed: 20, durationMs: 2500,
      fromX: 0, fromY: 0, x: 140, y: 0, theta: 0, startTheta: 0,
      penX: 140, penY: 0,
    },
  ];
  const tools = loadTimelineTools({ commands, config, mode: "dead" });
  const timeline = tools.buildSimulationTimeline(commands);
  const frame = tools.commandsAtElapsed(timeline, 1250).at(-1);

  assert.ok(Math.abs(frame.x - 70) < 0.01);
  assert.ok(Math.abs(frame.y) < 0.01);
});

test("dead reckoning travel animation starts from the previous command pose", () => {
  const config = core.withDefaults({ penOffsetX: 0, penOffsetY: 0 });
  const commands = [
    { type: "turn", x: 50, y: 50, theta: 90, durationMs: 100, startTheta: 0 },
    {
      type: "motor", kind: "travel", geometry: "line",
      durationMs: 1000, fromX: 0, fromY: 0, x: 50, y: 120, theta: 90,
      penX: 50, penY: 120,
    },
  ];
  const tools = loadTimelineTools({ commands, config, mode: "dead" });
  const timeline = tools.buildSimulationTimeline(commands);
  const frame = tools.commandsAtElapsed(timeline, 620).at(-1);

  assert.equal(frame.fromX, 50);
  assert.equal(frame.fromY, 50);
  assert.equal(frame.x, 50);
  assert.equal(frame.y, 85);
});

test("dead reckoning edited turn keeps the turn calibration", () => {
  const config = core.withDefaults({ deadTurnSpeed: 8, deadTurnMsPer90: 1023, deadWheelBaseMm: 26 });
  const commands = [
    {
      type: "turn", motionModel: "differential-drive", manualWheelSpeeds: true,
      leftSpeed: 8, rightSpeed: -8, durationMs: 900,
      x: 0, y: 0, theta: 0, startTheta: 0, angle: 0,
      fromX: 0, fromY: 0,
    },
  ];
  const tools = loadTimelineTools({ commands, config, mode: "dead" });
  const timeline = tools.buildSimulationTimeline(commands);
  const frame = tools.commandsAtElapsed(timeline, 450).at(-1);

  assert.ok(Math.abs(frame.theta - 39.56) < 0.2);
  assert.ok(Math.abs(frame.x) < 0.001);
  assert.ok(Math.abs(frame.y) < 0.001);
});

test("dead reckoning wait commands are playable while pen remains down", () => {
  const config = core.withDefaults({ penOffsetX: -48, penOffsetY: 0 });
  const commands = [
    { type: "pen", state: "down", penX: 222, penY: 226 },
    { type: "wait", ms: 1000, penX: 222, penY: 226 },
    { type: "pen", state: "up", penX: 222, penY: 226 },
  ];
  const tools = loadTimelineTools({ commands, config, mode: "dead" });
  const timeline = tools.buildSimulationTimeline(commands);

  assert.equal(timeline.items.length, 1);
  assert.equal(timeline.items[0].commandIndex, 1);
  assert.equal(timeline.durationMs, 1000);
  assert.equal(tools.activeCommandIndexAtElapsed(timeline, 500), 1);
  assert.deepEqual(
    tools.commandsAtElapsed(timeline, 500).map((command) => command.type === "pen" ? `${command.type}:${command.state}` : command.type),
    ["pen:down", "wait"],
  );
});
