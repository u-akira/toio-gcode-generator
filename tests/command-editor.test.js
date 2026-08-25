const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCommandEditor({
  commands,
  overrides,
  formatCommand = () => "",
  outputEl = null,
  getActiveCommandIndex = () => -1,
  getConfig = () => ({}),
  penToCube = (point) => point,
  cubeToPen = (point) => point,
}) {
  const context = { window: {}, Math };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "app-command-editor.js"), "utf8");
  vm.runInContext(source, context);
  return context.window.ToioPlotterCommandEditor.createCommandEditor({
    outputEl,
    getSimulation: () => ({ commands }),
    getSimulationValid: () => true,
    getConfig,
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
    penToCube,
    cubeToPen,
    degToRad: (degrees) => degrees * Math.PI / 180,
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

test("straight motor duration override wins over captured distance scale", () => {
  const overrides = new Map();
  const editedCommands = [
    {
      type: "motor",
      kind: "draw",
      geometry: "line",
      segmentId: "seg-0",
      speed: 20,
      durationMs: 1000,
      distanceScale: 1000 / 3000,
      fromX: 0,
      fromY: 0,
      x: 100,
      y: 0,
      theta: 0,
      baseMotion: { speed: 20, durationMs: 2550, fromX: 0, fromY: 0, x: 255, y: 0, theta: 0 },
    },
  ];
  loadCommandEditor({ commands: editedCommands, overrides }).captureCommandOverrides();

  const regeneratedCommands = [
    {
      type: "motor",
      kind: "draw",
      geometry: "line",
      segmentId: "seg-0",
      speed: 20,
      durationMs: 100,
      fromX: 0,
      fromY: 0,
      x: 10,
      y: 0,
      theta: 0,
    },
  ];
  loadCommandEditor({ commands: regeneratedCommands, overrides }).applyCommandOverrides();

  assert.equal(regeneratedCommands[0].durationMs, 1000);
});

test("dead line command reflow starts following travel at the edited endpoint", () => {
  const commands = [
    { type: "pen", state: "down", penX: 0, penY: 0 },
    { type: "motor", kind: "draw", geometry: "line", segmentId: "seg-0", speed: 20, durationMs: 1000, fromX: 0, fromY: 0, x: 140, y: 0, theta: 0 },
    { type: "pen", state: "up", penX: 140, penY: 0 },
    { type: "turn", role: "turn-to-travel", segmentId: "seg-1", angle: 45, durationMs: 500, x: 140, y: 0, theta: 45, penX: 140, penY: 0 },
    { type: "motor", kind: "travel", geometry: "line", segmentId: "seg-1", speed: 20, durationMs: 1000, fromX: 140, fromY: 0, x: 200, y: 60, theta: 45 },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    getConfig: () => ({ drawSpeed: 20, travelSpeed: 20, deadMmPerSecAtDrawSpeed: 30, deadMmPerSecAtTravelSpeed: 70 }),
  });

  editor.reflowDeadLineCommandPath();

  assert.equal(commands[1].penX, 30);
  assert.equal(commands[2].penX, 30);
  assert.equal(commands[3].x, 30);
  assert.equal(commands[4].fromX, 30);
});

test("dead draw reflow uses configured draw millimeters per second", () => {
  const commands = [
    { type: "pen", state: "down", penX: 0, penY: 0 },
    { type: "motor", kind: "draw", geometry: "line", segmentId: "seg-0", speed: 20, durationMs: 2780, fromX: 0, fromY: 0, x: 999, y: 0, theta: 0 },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    getConfig: () => ({ drawSpeed: 20, travelSpeed: 20, deadMmPerSecAtDrawSpeed: 30, deadMmPerSecAtTravelSpeed: 70 }),
  });

  editor.reflowDeadLineCommandPath();

  assert.ok(Math.abs(commands[1].penX - 83.4) < 0.001);
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
