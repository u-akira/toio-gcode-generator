const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCommandEditor({ commands, overrides }) {
  const context = { window: {}, Math };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "app-command-editor.js"), "utf8");
  vm.runInContext(source, context);
  return context.window.ToioPlotterCommandEditor.createCommandEditor({
    outputEl: null,
    getSimulation: () => ({ commands }),
    getSimulationValid: () => true,
    getConfig: () => ({}),
    getCommandOverrides: () => overrides,
    isDeadMode: () => true,
    formatDeadToioCommand: () => "",
    formatPositionToioCommand: () => "",
    escapeHtml: (value) => String(value),
    commandDurationMs: () => 0,
    roundToMotorDurationMs: (value) => value,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    minTurnDurationMs: 150,
    turnWheelSpeeds: () => ({ left: 0, right: 0 }),
    turnMsPer90: () => 660,
    cubeToPen: () => ({ x: 0, y: 0 }),
    normalizeDegrees: (degrees) => ((degrees % 360) + 360) % 360,
    syncSimulationControls: () => {},
    focusCommand: () => true,
    draw: () => {},
  });
}

test("wait command overrides are captured and applied for JSON round trips", () => {
  const commands = [
    { type: "pen", state: "down", penX: 222, penY: 226 },
    { type: "wait", ms: 1500, penX: 222, penY: 226 },
    { type: "pen", state: "up", penX: 222, penY: 226 },
  ];
  const overrides = new Map();
  const editor = loadCommandEditor({ commands, overrides });

  editor.captureCommandOverrides();
  assert.equal(overrides.size, 1);
  assert.equal([...overrides.values()][0].ms, 1500);

  commands[1].ms = 1000;
  editor.applyCommandOverrides();
  assert.equal(commands[1].ms, 1500);
});
