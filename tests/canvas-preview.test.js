const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../plotter-core.js");

function loadCanvasRenderer({ config }) {
  const context = { window: {}, globalThis: {}, Math };
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "app-canvas.js"), "utf8");
  vm.runInContext(source, context);
  return context.ToioPlotterCanvas.createCanvasRenderer({
    MAT: core.MAT,
    COLORS: {},
    canvas: {
      width: 800,
      height: 600,
      style: {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    },
    ctx: {},
    playMatImage: {},
    getConfig: () => config,
    getStrokes: () => [],
    getActiveStroke: () => null,
    getSimulation: () => null,
    getSimulationValid: () => true,
    getSimulationAnimation: () => null,
    getAnimatedCommands: () => [],
    getDeadSegments: () => [],
    getSelectedDeadSegmentId: () => null,
    getMovePoseStatus: () => ({}),
    getLegendVisible: () => false,
    isDeadMode: () => true,
    safeBounds: () => core.safeBounds(config),
    nativeToMatPose: core.nativeToMatPose,
    penToCube: core.penToCube,
    cubeToPen: core.cubeToPen,
    distance: core.distance,
    degToRad: (degrees) => degrees * Math.PI / 180,
    primitivePreviewPoints: core.primitivePreviewPoints,
  });
}

test("dead command preview honors partial motor progress", () => {
  const config = core.withDefaults({ drawSpeed: 20, deadMmPerSecAtTravelSpeed: 70, penOffsetX: 0, penOffsetY: 0 });
  const renderer = loadCanvasRenderer({ config });
  const preview = renderer.__test.buildDeadCommandPreview([
    {
      type: "motor",
      kind: "travel",
      geometry: "line",
      speed: 20,
      fromX: 10,
      fromY: 20,
      x: 10,
      y: 90,
      theta: 90,
      durationMs: 1000,
      previewProgress: 0.5,
    },
  ]);

  assert.equal(Math.round(preview.finalCubePose.x), 10);
  assert.equal(Math.round(preview.finalCubePose.y), 55);
});

test("dead command preview keeps drawn segments after pen up", () => {
  const config = core.withDefaults({ drawSpeed: 20, penOffsetX: 0, penOffsetY: 0 });
  const renderer = loadCanvasRenderer({ config });
  const preview = renderer.__test.buildDeadCommandPreview([
    { type: "pen", state: "down", penX: 10, penY: 20 },
    {
      type: "motor",
      kind: "draw",
      geometry: "line",
      speed: 20,
      fromX: 10,
      fromY: 20,
      x: 67,
      y: 20,
      theta: 0,
      durationMs: 1000,
      penX: 67,
      penY: 20,
    },
    { type: "pen", state: "up", penX: 67, penY: 20 },
  ]);

  assert.equal(preview.penDownSegments.length, 1);
  assert.equal(preview.penUpSegments.length, 0);
  assert.equal(Math.round(preview.penDownSegments[0][0].x), 10);
  assert.equal(Math.round(preview.penDownSegments[0].at(-1).x), 67);
});

test("dead command preview uses command endpoints for straight draw lines", () => {
  const config = core.withDefaults({ drawSpeed: 20, penOffsetX: 0, penOffsetY: 0 });
  const renderer = loadCanvasRenderer({ config });
  const preview = renderer.__test.buildDeadCommandPreview([
    { type: "pen", state: "down", penX: 10, penY: 20 },
    {
      type: "motor",
      kind: "draw",
      geometry: "line",
      speed: 20,
      fromX: 10,
      fromY: 20,
      x: 90,
      y: 20,
      theta: 0,
      durationMs: 100,
      penX: 90,
      penY: 20,
    },
    { type: "pen", state: "up", penX: 90, penY: 20 },
  ]);

  assert.equal(preview.penDownSegments.length, 1);
  assert.equal(preview.penDownSegments[0].at(-1).x, 90);
  assert.equal(preview.finalCubePose.x, 90);
});
