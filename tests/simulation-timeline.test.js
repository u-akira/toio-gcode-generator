const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../plotter-core.js");

function loadTimelineTools({ commands, config, mode = "position" }) {
  const context = { window: {}, Math };
  vm.createContext(context);
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

test("dead reckoning motor animation starts from the motor command from pose", () => {
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
  assert.equal(frame.x, 200);
  assert.equal(frame.y, 200);
  assert.equal(Math.round(midFrame.x), 105);
  assert.equal(Math.round(midFrame.y), 160);
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
