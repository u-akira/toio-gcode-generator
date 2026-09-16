const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../plotter-core.js");

function loadCommandEditor({
  commands,
  overrides,
  formatCommand = () => "",
  outputEl = null,
  getActiveCommandIndex = () => -1,
  getConfig = () => ({}),
  cubeToPen = (point) => point,
  turnWheelSpeeds = () => ({ left: 0, right: 0 }),
  computeArcWheelSpeedsForDuration,
  plotterCore = null,
}) {
  const context = { window: {}, Math };
  if (plotterCore) context.PlotterCore = plotterCore;
  vm.createContext(context);
  const deadMotionSource = fs.readFileSync(path.join(__dirname, "..", "app-dead-motion.js"), "utf8");
  vm.runInContext(deadMotionSource, context);
  const reflowSource = fs.readFileSync(path.join(__dirname, "..", "app-command-reflow.js"), "utf8");
  vm.runInContext(reflowSource, context);
  const source = fs.readFileSync(path.join(__dirname, "..", "app-command-editor.js"), "utf8");
  vm.runInContext(source, context);
  const reflowApi = context.ToioPlotterCommandReflow || context.window.ToioPlotterCommandReflow;
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
    turnWheelSpeeds,
    computeArcWheelSpeedsForDuration,
    turnMsPer90: () => 660,
    cubeToPen,
    normalizeDegrees: (degrees) => ((degrees % 360) + 360) % 360,
    syncSimulationControls: () => {},
    focusCommand: () => true,
    getActiveCommandIndex,
    draw: () => {},
    commandReflow: reflowApi.createCommandReflow({
      getSimulation: () => ({ commands }),
      getConfig,
      isDeadMode: () => true,
      deadMotion: context.window.ToioPlotterDeadMotion,
      cubeToPen,
      degToRad: (degrees) => degrees * Math.PI / 180,
      normalizeDegrees: (degrees) => ((degrees % 360) + 360) % 360,
    }),
  });
}

test("editing arc duration does not overwrite a directly entered wheel speed", () => {
  let autoCalculationCalls = 0;
  const commands = [{
    type: "motor", kind: "draw", geometry: "arc", segmentId: "seg-0",
    leftSpeed: 8, rightSpeed: 12, durationMs: 900,
    fromX: 0, fromY: 0, x: 10, y: 10, theta: 20, startTheta: 0,
    center: { x: 0, y: 10 }, radius: 10, sweepAngle: 90,
  }];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    getConfig: () => ({ drawSpeed: 20, travelSpeed: 20, deadArcMmPerSecAtDrawSpeed: 30, deadMmPerSecAtTravelSpeed: 70, deadWheelBaseMm: 26 }),
    computeArcWheelSpeedsForDuration: () => {
      autoCalculationCalls += 1;
      return { left: 7, right: 12 };
    },
  });
  const input = (key, value) => ({ value: String(value), dataset: { commandIndex: "0", commandKey: key } });

  editor.updateCommandEdit(input("rightSpeed", 20), { render: false });
  editor.updateCommandEdit(input("durationMs", 1500), { render: false });

  assert.equal(commands[0].rightSpeed, 20);
  assert.equal(commands[0].durationMs, 1500);
  assert.equal(autoCalculationCalls, 0);
});

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

test("persisted turn override reflows its endpoint into the following travel", () => {
  const overrides = new Map();
  const editedCommands = [
    { type: "turn", role: "turn-to-travel", segmentId: "seg-1", angle: 79, leftSpeed: 8, rightSpeed: -8, durationMs: 900, x: 100, y: 100, theta: 0, manualWheelSpeeds: true, motionModel: "differential-drive" },
  ];
  loadCommandEditor({
    commands: editedCommands,
    overrides,
    getConfig: () => ({ deadTurnMsPer90: 1023, deadTurnSpeed: 8, deadWheelBaseMm: 26, penOffsetX: 0, penOffsetY: 0 }),
  }).captureCommandOverrides();

  const regeneratedCommands = [
    { type: "turn", role: "turn-to-travel", segmentId: "seg-1", angle: 79, leftSpeed: 8, rightSpeed: -8, durationMs: 1200, x: 100, y: 100, theta: 0 },
    { type: "motor", kind: "travel", geometry: "line", segmentId: "seg-1", speed: 20, durationMs: 1000, fromX: 100, fromY: 100, x: 100, y: 170, theta: 0 },
  ];
  loadCommandEditor({
    commands: regeneratedCommands,
    overrides,
    getConfig: () => ({ drawSpeed: 20, travelSpeed: 20, deadTurnMsPer90: 1023, deadTurnSpeed: 8, deadWheelBaseMm: 26, deadMmPerSecAtTravelSpeed: 70, penOffsetX: 0, penOffsetY: 0 }),
  }).applyCommandOverrides();

  assert.equal(regeneratedCommands[0].motionModel, "differential-drive");
  assert.equal(regeneratedCommands[1].fromX, regeneratedCommands[0].x);
  assert.equal(regeneratedCommands[1].fromY, regeneratedCommands[0].y);
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

test("edited arc motor uses wheel speeds and duration, then reflows following commands", () => {
  const commands = [
    { type: "pen", state: "down", penX: 0, penY: 0 },
    {
      type: "motor", kind: "draw", geometry: "arc", segmentId: "seg-0",
      leftSpeed: 30, rightSpeed: 20, durationMs: 1000,
      fromX: 0, fromY: 0, x: 20, y: 10, theta: 20, startTheta: 0,
    },
    { type: "pen", state: "up", penX: 0, penY: 0 },
    { type: "motor", kind: "travel", geometry: "line", segmentId: "seg-1", speed: 20, durationMs: 1000, fromX: 20, fromY: 10, x: 80, y: 10, theta: 0 },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    getConfig: () => ({ drawSpeed: 20, travelSpeed: 20, deadArcMmPerSecAtDrawSpeed: 30, deadMmPerSecAtTravelSpeed: 70, deadWheelBaseMm: 26, penOffsetX: 0, penOffsetY: 0 }),
  });

  editor.reflowDeadLineCommandPath();

  assert.equal(commands[1].geometry, "arc");
  assert.ok(commands[1].x > 0);
  assert.ok(commands[1].y > 0);
  assert.equal(commands[3].fromX, commands[1].x);
  assert.equal(commands[3].fromY, commands[1].y);
});

test("reflow keeps a following arc finite when the motion integrator returns only its pose", () => {
  const commands = [
    { type: "pen", state: "up", penX: 0, penY: 0 },
    {
      type: "motor", kind: "draw", geometry: "arc", segmentId: "seg-0",
      leftSpeed: 8, rightSpeed: 16, durationMs: 1000,
      fromX: 0, fromY: 0, x: 10, y: 10, theta: 20, startTheta: 0,
      center: { x: 0, y: 10 }, radius: 10, startAngle: -90, sweepAngle: 90,
    },
    { type: "pen", state: "up", penX: 0, penY: 0 },
    {
      type: "motor", kind: "draw", geometry: "arc", segmentId: "seg-1",
      leftSpeed: 22, rightSpeed: 8, durationMs: 4210,
      fromX: 10, fromY: 10, x: 10, y: 10, theta: 360, startTheta: 0,
      center: { x: 10, y: 35 }, radius: 25, startAngle: -90, sweepAngle: 360,
    },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    plotterCore: {
      integrateDifferentialDrive: core.integrateDifferentialDrive,
      differentialPreviewPoints: core.differentialPreviewPoints,
    },
    getConfig: () => core.withDefaults({
      drawSpeed: 20,
      travelSpeed: 20,
      deadArcMmPerSecAtDrawSpeed: 55.43,
      deadMmPerSecAtTravelSpeed: 70,
      deadWheelBaseMm: 26,
      penOffsetX: -20,
      penOffsetY: 0,
    }),
  });

  editor.reflowDeadLineCommandPath();

  for (const command of [commands[1], commands[3]]) {
    assert.ok(Number.isFinite(command.center?.x), `invalid center: ${JSON.stringify(command)}`);
    assert.ok(Number.isFinite(command.center?.y), `invalid center: ${JSON.stringify(command)}`);
    assert.ok(Number.isFinite(command.startAngle), `invalid start angle: ${JSON.stringify(command)}`);
    assert.ok(command.penPreviewPoints.length > 2);
  }
});

test("reflow recomputes travel after an edited arc instead of restoring its old target", () => {
  const commands = [
    { type: "pen", state: "down", penX: 0, penY: 0 },
    {
      type: "motor", kind: "draw", geometry: "arc", segmentId: "seg-0",
      leftSpeed: 8, rightSpeed: 16, durationMs: 1000,
      fromX: 0, fromY: 0, x: 10, y: 10, theta: 20, startTheta: 0,
      center: { x: 0, y: 10 }, radius: 10, startAngle: -90, sweepAngle: 90,
    },
    { type: "pen", state: "up", penX: 10, penY: 10 },
    {
      type: "motor", kind: "travel", geometry: "line", segmentId: "seg-1",
      speed: 20, durationMs: 1000,
      fromX: 10, fromY: 10, x: 260, y: 230, theta: 90,
    },
    {
      type: "turn", role: "turn-to-draw", segmentId: "seg-1",
      angle: -90, x: 260, y: 230, theta: 0,
    },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    plotterCore: {
      integrateDifferentialDrive: core.integrateDifferentialDrive,
      differentialPreviewPoints: core.differentialPreviewPoints,
    },
    getConfig: () => core.withDefaults({
      drawSpeed: 20,
      travelSpeed: 20,
      deadArcMmPerSecAtDrawSpeed: 55.43,
      deadMmPerSecAtTravelSpeed: 70,
      deadWheelBaseMm: 26,
      penOffsetX: 0,
      penOffsetY: 0,
    }),
  });

  editor.reflowDeadLineCommandPath();

  const arc = commands[1];
  const travel = commands[3];
  const followingTurn = commands[4];
  assert.equal(travel.fromX, arc.x);
  assert.equal(travel.fromY, arc.y);
  assert.ok(Math.abs(Math.hypot(travel.x - travel.fromX, travel.y - travel.fromY) - 70) < 1e-9);
  assert.ok(Math.hypot(travel.x - 260, travel.y - 230) > 1);
  assert.equal(followingTurn.x, travel.x);
  assert.equal(followingTurn.y, travel.y);
});

test("reflow keeps a following turn-in-place arc at the recalculated cube position", () => {
  const config = core.withDefaults({
    drawSpeed: 20,
    travelSpeed: 20,
    deadArcMmPerSecAtDrawSpeed: 55.43,
    deadMmPerSecAtTravelSpeed: 70,
    deadWheelBaseMm: 26,
    penOffsetX: -20,
    penOffsetY: 0,
  });
  const commands = [
    { type: "pen", state: "down", penX: 0, penY: 0 },
    {
      type: "motor", kind: "draw", geometry: "arc", segmentId: "seg-0",
      leftSpeed: 8, rightSpeed: 16, durationMs: 1000,
      fromX: 0, fromY: 0, x: 10, y: 10, theta: 20, startTheta: 0,
      center: { x: 0, y: 10 }, radius: 10, startAngle: -90, sweepAngle: 90,
    },
    { type: "pen", state: "up", penX: 0, penY: 0 },
    {
      type: "motor", kind: "travel", geometry: "line", segmentId: "seg-1",
      speed: 20, durationMs: 1000,
      fromX: 10, fromY: 10, x: 230, y: 238, theta: 90,
    },
    {
      type: "motor", kind: "draw", geometry: "arc", segmentId: "seg-2",
      turnInPlace: true, motionModel: "differential-drive",
      leftSpeed: 8, rightSpeed: -8, durationMs: 1000,
      fromX: 230, fromY: 238, x: 230, y: 238, theta: 280, startTheta: 0,
      center: { x: 230, y: 238 }, radius: 8, startAngle: 220, sweepAngle: -80,
      cubePreviewPoints: [{ x: 230, y: 238, theta: 0 }],
      penPreviewPoints: [{ x: 230, y: 218 }],
    },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    plotterCore: {
      integrateDifferentialDrive: core.integrateDifferentialDrive,
      differentialPreviewPoints: core.differentialPreviewPoints,
    },
    cubeToPen: core.cubeToPen,
    getConfig: () => config,
  });

  editor.reflowDeadLineCommandPath();

  const travel = commands[3];
  const turn = commands[4];
  assert.equal(turn.center.x, travel.x);
  assert.equal(turn.center.y, travel.y);
  assert.equal(turn.fromX, travel.x);
  assert.equal(turn.fromY, travel.y);
  assert.equal(turn.x, travel.x);
  assert.equal(turn.y, travel.y);
  assert.ok(turn.cubePreviewPoints.length > 2);
  assert.ok(turn.penPreviewPoints.length > 2);
  const expectedStartPen = core.cubeToPen({ x: travel.x, y: travel.y }, turn.startTheta, config);
  assert.ok(Math.hypot(turn.penPreviewPoints[0].x - expectedStartPen.x, turn.penPreviewPoints[0].y - expectedStartPen.y) < 1e-9);
});

test("edited arc with equal wheel speeds becomes a line", () => {
  const commands = [
    { type: "pen", state: "down", penX: 0, penY: 0 },
    {
      type: "motor", kind: "draw", geometry: "arc", segmentId: "seg-0",
      leftSpeed: 20, rightSpeed: 20, durationMs: 1000,
      fromX: 0, fromY: 0, x: 20, y: 10, theta: 20, startTheta: 0,
    },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    getConfig: () => ({ drawSpeed: 20, travelSpeed: 20, deadArcMmPerSecAtDrawSpeed: 30, deadMmPerSecAtTravelSpeed: 70, deadWheelBaseMm: 26, penOffsetX: 0, penOffsetY: 0 }),
  });

  editor.reflowDeadLineCommandPath();

  assert.equal(commands[1].type, "motor");
  assert.equal(commands[1].geometry, "line");
  assert.equal(commands[1].x, 30);
  assert.equal(commands[1].y, 0);
  assert.equal(commands[1].theta, 0);
});

test("edited arc with opposite wheel speeds becomes a turn and keeps a preview path", () => {
  const commands = [
    { type: "pen", state: "down", penX: 0, penY: 0 },
    {
      type: "motor", kind: "draw", geometry: "arc", segmentId: "seg-0",
      leftSpeed: 20, rightSpeed: -20, durationMs: 1000,
      fromX: 0, fromY: 0, x: 20, y: 10, theta: 20, startTheta: 0,
    },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    getConfig: () => ({ drawSpeed: 20, travelSpeed: 20, deadArcMmPerSecAtDrawSpeed: 30, deadMmPerSecAtTravelSpeed: 70, deadWheelBaseMm: 26, penOffsetX: 10, penOffsetY: 0, deadTurnSpeed: 8 }),
  });

  editor.reflowDeadLineCommandPath();

  assert.equal(commands[1].type, "turn");
  assert.equal(commands[1].x, 0);
  assert.equal(commands[1].y, 0);
  assert.ok(Math.abs(commands[1].theta) > 1);
  assert.ok(commands[1].penPreviewPoints.length > 2);
});

test("reflow does not teleport to the original draw target after shortened travel", () => {
  const commands = [
    { type: "pen", state: "down", penX: 0, penY: 0 },
    { type: "motor", kind: "draw", geometry: "line", segmentId: "seg-0", speed: 20, durationMs: 1000, fromX: 0, fromY: 0, x: 30, y: 0, theta: 0, penX: 30, penY: 0 },
    { type: "pen", state: "up", penX: 30, penY: 0 },
    { type: "turn", role: "turn-to-travel", segmentId: "seg-1", angle: 90, durationMs: 500, x: 30, y: 0, theta: 90, penX: 30, penY: 0 },
    { type: "motor", kind: "travel", geometry: "line", segmentId: "seg-1", speed: 20, durationMs: 1000, fromX: 30, fromY: 0, x: 30, y: 100, theta: 90, penX: 30, penY: 100 },
    { type: "turn", role: "turn-to-draw", segmentId: "seg-2", angle: -90, durationMs: 500, x: 30, y: 100, theta: 0, penX: 30, penY: 100 },
    { type: "pen", state: "down", penX: 30, penY: 100 },
    { type: "motor", kind: "draw", geometry: "line", segmentId: "seg-2", speed: 20, durationMs: 1000, fromX: 30, fromY: 100, x: 60, y: 100, theta: 0, penX: 60, penY: 100 },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    getConfig: () => ({ drawSpeed: 20, travelSpeed: 20, deadArcMmPerSecAtDrawSpeed: 30, deadMmPerSecAtTravelSpeed: 30, deadWheelBaseMm: 26, penOffsetX: 0, penOffsetY: 0 }),
  });

  editor.reflowDeadLineCommandPath();

  assert.ok(commands[4].y < 100);
  assert.equal(commands[5].x, commands[4].x);
  assert.equal(commands[5].y, commands[4].y);
  assert.equal(commands[7].fromX, commands[4].x);
  assert.equal(commands[7].fromY, commands[4].y);
});

test("editing turn duration reflows the following parallel-line travel and draw", () => {
  const commands = [
    { type: "pen", state: "down", penX: 0, penY: 0 },
    { type: "motor", kind: "draw", geometry: "line", segmentId: "seg-0", speed: 20, durationMs: 1000, fromX: 0, fromY: 0, x: 30, y: 0, theta: 0, penX: 30, penY: 0 },
    { type: "pen", state: "up", penX: 30, penY: 0 },
    { type: "turn", role: "turn-to-travel", segmentId: "seg-1", angle: 90, leftSpeed: 8, rightSpeed: -8, durationMs: 1800, x: 30, y: 0, theta: 90, penX: 30, penY: 0 },
    { type: "motor", kind: "travel", geometry: "line", segmentId: "seg-1", speed: 20, durationMs: 1000, fromX: 30, fromY: 0, x: 30, y: 100, theta: 90, penX: 30, penY: 100 },
    { type: "turn", role: "turn-to-draw", segmentId: "seg-2", angle: -90, leftSpeed: -8, rightSpeed: 8, durationMs: 1800, x: 30, y: 100, theta: 0, penX: 30, penY: 100 },
    { type: "pen", state: "down", penX: 30, penY: 100 },
    { type: "motor", kind: "draw", geometry: "line", segmentId: "seg-2", speed: 20, durationMs: 1000, fromX: 30, fromY: 100, x: 60, y: 100, theta: 0, penX: 60, penY: 100 },
  ];
  const editor = loadCommandEditor({
    commands,
    overrides: new Map(),
    turnWheelSpeeds: (command) => ({ left: command.leftSpeed, right: command.rightSpeed }),
    getConfig: () => ({ drawSpeed: 20, travelSpeed: 20, deadArcMmPerSecAtDrawSpeed: 30, deadMmPerSecAtTravelSpeed: 30, deadWheelBaseMm: 26, penOffsetX: 0, penOffsetY: 0 }),
  });
  editor.reflowDeadLineCommandPath();
  const before = { x: commands[7].fromX, y: commands[7].fromY };

  editor.updateCommandEdit({ dataset: { commandIndex: "3", commandKey: "durationMs" }, value: "900" });

  assert.notDeepEqual({ x: commands[7].fromX, y: commands[7].fromY }, before);
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
