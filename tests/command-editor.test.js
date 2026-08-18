const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCommandEditor({ commands, overrides, formatCommand = () => "", outputEl = null, getActiveCommandIndex = () => -1 }) {
  const context = { window: {}, Math };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "app-command-editor.js"), "utf8");
  vm.runInContext(source, context);
  return context.window.ToioPlotterCommandEditor.createCommandEditor({
    outputEl,
    getSimulation: () => ({ commands }),
    getSimulationValid: () => true,
    getConfig: () => ({}),
    getCommandOverrides: () => overrides,
    isDeadMode: () => true,
    formatDeadToioCommand: formatCommand,
    formatPositionToioCommand: formatCommand,
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
    getActiveCommandIndex,
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

test("commands without inputs render non-clickable step badges", () => {
  const commands = [
    { type: "pen", state: "up", penX: 222, penY: 226 },
    { type: "wait", ms: 1000, penX: 222, penY: 226 },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    formatCommand: (command) => command.type,
  });

  const penRow = editor.commandRowTemplate(commands[0], 0);
  assert.match(penRow, /class="command-step-static"/);
  assert.doesNotMatch(penRow, /data-command-step="0"/);

  const waitRow = editor.commandRowTemplate(commands[1], 1);
  assert.match(waitRow, /class="command-step-button"/);
  assert.match(waitRow, /data-command-step="1"/);
});

test("active command row scrolls near the top when active command changes", () => {
  let activeCommandIndex = 4;
  const outputEl = {
    scrollTop: 0,
    clientHeight: 80,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: () => rows,
  };
  const rows = Array.from({ length: 6 }, (_, index) => ({
    dataset: { commandIndex: String(index) },
    getBoundingClientRect: () => ({ top: index * 32 - outputEl.scrollTop }),
    classList: {
      active: false,
      toggle(name, value) {
        if (name === "active") this.active = value;
      },
    },
  }));
  const editor = loadCommandEditor({
    commands: [],
    overrides: new Map(),
    outputEl,
    getActiveCommandIndex: () => activeCommandIndex,
  });

  editor.updateActiveCommandRow();
  assert.equal(rows[4].classList.active, true);
  assert.equal(outputEl.scrollTop, 92);

  outputEl.scrollTop = 0;
  editor.updateActiveCommandRow();
  assert.equal(outputEl.scrollTop, 0);

  outputEl.scrollTop = 80;
  activeCommandIndex = 1;
  editor.updateActiveCommandRow();
  assert.equal(rows[1].classList.active, true);
  assert.equal(outputEl.scrollTop, 0);
});
