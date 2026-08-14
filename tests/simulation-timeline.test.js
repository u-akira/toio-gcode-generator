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
});
