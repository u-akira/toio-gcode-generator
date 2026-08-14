const test = require("node:test");
const assert = require("node:assert/strict");
const exporter = require("../sb3-exporter.js");

function makeTemplateBytes(project) {
  return exporter.writeZip([
    {
      name: "project.json",
      data: new TextEncoder().encode(JSON.stringify(project)),
    },
    {
      name: "asset.svg",
      data: new TextEncoder().encode("<svg></svg>"),
    },
  ]);
}

function makeTemplateProject() {
  return {
    targets: [
      {
        isStage: true,
        name: "Stage",
        blocks: {},
      },
      {
        isStage: false,
        name: "Sprite1",
        blocks: {
          flag: { opcode: "event_whenflagclicked", next: null, parent: null, inputs: {}, fields: {}, topLevel: true, x: 10, y: 10 },
          move1: { opcode: "toio1_moveWheelsFor", next: null, parent: null, inputs: {}, fields: {}, topLevel: false },
          stop1: { opcode: "toio1_stopWheels", next: null, parent: null, inputs: {}, fields: {}, topLevel: false },
          move2: { opcode: "toio2_moveWheelsFor", next: null, parent: null, inputs: {}, fields: {}, topLevel: false },
          stop2: { opcode: "toio2_stopWheels", next: null, parent: null, inputs: {}, fields: {}, topLevel: false },
          wait: { opcode: "control_wait", next: null, parent: null, inputs: {}, fields: {}, topLevel: false },
        },
      },
    ],
    meta: { semver: "3.0.0" },
  };
}

function makeMoveForOnlyTemplateProject() {
  return {
    targets: [
      { isStage: true, name: "Stage", blocks: {} },
      {
        isStage: false,
        name: "Sprite1",
        blocks: {
          move1: { opcode: "toio_moveFor", next: null, parent: null, inputs: {}, fields: {}, topLevel: false },
          move2: { opcode: "toio2_moveFor", next: null, parent: null, inputs: {}, fields: {}, topLevel: false },
        },
      },
    ],
  };
}

test("speed values are scaled from -255..255 to -100..100", () => {
  assert.equal(exporter.scaleSpeed(255), 100);
  assert.equal(exporter.scaleSpeed(30), 12);
  assert.equal(exporter.scaleSpeed(20), 8);
  assert.equal(exporter.scaleSpeed(-30), -12);
  assert.equal(exporter.scaleSpeed(999), 100);
});

test("buildOperations converts dead reckoning commands into two-cube toio Do steps", () => {
  const operations = exporter.buildOperations(
    [
      { type: "pen", state: "down", speed: 30, durationMs: 300 },
      { type: "turn", angle: 90, leftSpeed: -40, rightSpeed: 40, durationMs: 500, manualWheelSpeeds: true },
      { type: "motor", leftSpeed: 20, rightSpeed: 25, durationMs: 1000 },
      { type: "wait", ms: 250 },
    ],
    { settleMs: 200 },
    {
      turnWheelSpeeds: (command) => ({ left: command.leftSpeed, right: command.rightSpeed }),
      getPenCommandSpeed: (command) => command.speed,
      getPenCommandDuration: (command) => command.durationMs,
    },
  );

  assert.deepEqual(operations.slice(0, 2), [
    { kind: "stop", cube: 1 },
    { kind: "stop", cube: 2 },
  ]);
  assert.deepEqual(operations[2], { kind: "wheels", cube: 2, leftSpeed: 12, rightSpeed: 12, duration: 0.3 });
  assert.deepEqual(operations[5], { kind: "wheels", cube: 1, leftSpeed: -16, rightSpeed: 16, duration: 0.5 });
  assert.deepEqual(operations[7], { kind: "wheels", cube: 1, leftSpeed: 8, rightSpeed: 10, duration: 1 });
});

test("buildOperations keeps arc motor commands explicit", () => {
  const operations = exporter.buildOperations(
    [{ type: "motor", geometry: "arc", leftSpeed: 20, rightSpeed: 35, durationMs: 1500 }],
    { settleMs: 0 },
    {
      turnWheelSpeeds: () => ({ left: 0, right: 0 }),
      getPenCommandSpeed: () => 0,
      getPenCommandDuration: () => 0,
    },
  );

  assert.deepEqual(operations[2], { kind: "arc", cube: 1, leftSpeed: 8, rightSpeed: 14, duration: 1.5 });
});

test("exportProject emits reported arc command as toio wheel block", async () => {
  const templateBytes = makeTemplateBytes(makeTemplateProject());
  const sb3Bytes = await exporter.exportProject({
    templateBytes,
    commands: [{ type: "motor", kind: "draw", geometry: "arc", leftSpeed: 24, rightSpeed: 16, durationMs: 7330, segmentId: "seg-0" }],
    segments: [
      {
        id: "seg-0",
        kind: "draw",
        geometry: "arc",
        center: { x: 250, y: 250 },
        radius: 70,
        startAngle: 0,
        sweepAngle: 360,
        start: { x: 320, y: 250 },
        end: { x: 320, y: 250 },
        heading: 90,
        lengthMm: 439.8,
      },
    ],
    mat: { minX: 98, minY: 142, maxX: 402, maxY: 358 },
    config: { settleMs: 0 },
    turnWheelSpeeds: () => ({ left: 0, right: 0 }),
    getPenCommandSpeed: () => 0,
    getPenCommandDuration: () => 0,
  });
  const entries = exporter.readZip(sb3Bytes);
  const project = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "project.json").data));
  const block = project.targets[1].blocks.plotter_cmd_0002;

  assert.equal(block.opcode, "toio1_moveWheelsFor");
  assert.deepEqual(block.inputs.LEFT_SPEED, [1, [4, "9"]]);
  assert.deepEqual(block.inputs.RIGHT_SPEED, [1, [4, "6"]]);
  assert.deepEqual(block.inputs.DURATION, [1, [4, "7.33"]]);
  assert.ok(Object.values(project.targets[1].blocks).filter((entry) => entry.opcode === "motion_movesteps").length > 10);
  assert.ok(Object.values(project.targets[1].blocks).filter((entry) => entry.opcode === "motion_turnright" || entry.opcode === "motion_turnleft").length > 10);
});

test("exportProject draws arc sprite path from pen preview points", async () => {
  const templateBytes = makeTemplateBytes(makeTemplateProject());
  const sb3Bytes = await exporter.exportProject({
    templateBytes,
    commands: [{ type: "motor", kind: "draw", geometry: "arc", leftSpeed: 24, rightSpeed: 16, durationMs: 1000, segmentId: "seg-0" }],
    segments: [
      {
        id: "seg-0",
        kind: "draw",
        geometry: "arc",
        center: { x: 50, y: 0 },
        radius: 5,
        startAngle: 180,
        sweepAngle: 180,
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        heading: 0,
        lengthMm: 100,
        penPreviewPoints: [
          { x: 0, y: 0 },
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
      },
    ],
    mat: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    config: { settleMs: 0 },
    turnWheelSpeeds: () => ({ left: 0, right: 0 }),
    getPenCommandSpeed: () => 0,
    getPenCommandDuration: () => 0,
  });
  const entries = exporter.readZip(sb3Bytes);
  const project = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "project.json").data));
  const repeatCounts = Object.values(project.targets[1].blocks)
    .filter((entry) => entry.opcode === "control_repeat")
    .map((entry) => Number(entry.inputs.TIMES[1][1]));

  assert.ok(repeatCounts.some((count) => count >= 20));
});

test("exportProject keeps assets and injects a generated block chain", async () => {
  const templateBytes = makeTemplateBytes(makeTemplateProject());
  const sb3Bytes = await exporter.exportProject({
    templateBytes,
    commands: [{ type: "motor", leftSpeed: 255, rightSpeed: -255, durationMs: 1200 }],
    segments: [{ kind: "draw", start: { x: 190, y: 250 }, end: { x: 250, y: 250 }, heading: 0, lengthMm: 60 }],
    mat: { minX: 98, minY: 142, maxX: 402, maxY: 358 },
    config: { settleMs: 0 },
    turnWheelSpeeds: () => ({ left: 0, right: 0 }),
    getPenCommandSpeed: () => 0,
    getPenCommandDuration: () => 0,
  });
  const entries = exporter.readZip(sb3Bytes);
  const projectEntry = entries.find((entry) => entry.name === "project.json");
  const assetEntry = entries.find((entry) => entry.name === "asset.svg");
  const project = JSON.parse(new TextDecoder().decode(projectEntry.data));
  const blocks = project.targets[1].blocks;

  assert.ok(assetEntry);
  assert.equal(blocks.flag, undefined);
  assert.equal(blocks.move1, undefined);
  assert.equal(blocks.plotter_flag_0000.opcode, "event_whenflagclicked");
  assert.equal(blocks.plotter_cmd_0000.opcode, "toio1_stopWheels");
  assert.equal(blocks.plotter_cmd_0001.opcode, "toio2_stopWheels");
  assert.equal(blocks.plotter_cmd_0002.opcode, "toio1_moveWheelsFor");
  assert.deepEqual(blocks.plotter_cmd_0002.inputs.LEFT_SPEED, [1, [4, "100"]]);
  assert.deepEqual(blocks.plotter_cmd_0002.inputs.RIGHT_SPEED, [1, [4, "-100"]]);
  assert.equal(blocks.plotter_sprite_flag_0000.opcode, "event_whenflagclicked");
  assert.equal(blocks.plotter_sprite_0000.opcode, "pen_clear");
  assert.equal(blocks.plotter_sprite_0001.opcode, "pen_setPenColorToColor");
  assert.deepEqual(blocks.plotter_sprite_0001.inputs.COLOR, [1, [9, "#000000"]]);
  assert.equal(blocks.plotter_sprite_0002.opcode, "pen_penUp");
  assert.equal(blocks.plotter_sprite_0003.opcode, "motion_gotoxy");
  assert.equal(blocks.plotter_sprite_0004.opcode, "motion_pointindirection");
  assert.equal(blocks.plotter_sprite_0005.opcode, "pen_penDown");
  assert.equal(blocks.plotter_sprite_0006.opcode, "control_repeat");
  assert.equal(blocks.plotter_sprite_0006_move.opcode, "motion_movesteps");
  assert.equal(project.extensions.includes("pen"), true);
});

test("exportProject can derive wheel and stop opcodes from moveFor templates", async () => {
  const templateBytes = makeTemplateBytes(makeMoveForOnlyTemplateProject());
  const sb3Bytes = await exporter.exportProject({
    templateBytes,
    commands: [{ type: "motor", leftSpeed: 255, rightSpeed: -255, durationMs: 1200 }],
    segments: [],
    mat: { minX: 98, minY: 142, maxX: 402, maxY: 358 },
    config: { settleMs: 0 },
    turnWheelSpeeds: () => ({ left: 0, right: 0 }),
    getPenCommandSpeed: () => 0,
    getPenCommandDuration: () => 0,
  });
  const entries = exporter.readZip(sb3Bytes);
  const project = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "project.json").data));
  const blocks = project.targets[1].blocks;

  assert.equal(blocks.plotter_cmd_0000.opcode, "toio_stopWheels");
  assert.equal(blocks.plotter_cmd_0001.opcode, "toio2_stopWheels");
  assert.equal(blocks.plotter_cmd_0002.opcode, "toio_moveWheelsFor");
});

test("exportProject generates repeated sprite turns for segment heading changes", async () => {
  const templateBytes = makeTemplateBytes(makeTemplateProject());
  const sb3Bytes = await exporter.exportProject({
    templateBytes,
    commands: [{ type: "motor", leftSpeed: 20, rightSpeed: 20, durationMs: 1000 }],
    segments: [
      { kind: "draw", start: { x: 190, y: 250 }, end: { x: 250, y: 250 }, heading: 0, lengthMm: 60 },
      { kind: "draw", start: { x: 250, y: 250 }, end: { x: 250, y: 310 }, heading: 90, lengthMm: 60 },
    ],
    mat: { minX: 98, minY: 142, maxX: 402, maxY: 358 },
    config: { settleMs: 0 },
    turnWheelSpeeds: () => ({ left: 0, right: 0 }),
    getPenCommandSpeed: () => 0,
    getPenCommandDuration: () => 0,
  });
  const entries = exporter.readZip(sb3Bytes);
  const project = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "project.json").data));
  const blocks = project.targets[1].blocks;
  const turnBlocks = Object.values(blocks).filter((block) => block.opcode === "motion_turnright" || block.opcode === "motion_turnleft");

  assert.ok(turnBlocks.length >= 1);
  assert.ok(Object.values(blocks).some((block) => block.opcode === "control_repeat" && block.inputs.SUBSTACK));
});
