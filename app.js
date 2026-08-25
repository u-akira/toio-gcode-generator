"use strict";

const { MAT, DEFAULT_CONFIG, nativeToMatPose, matToNativePoint } = window.PlotterCore;
const { ToioCube } = window.ToioBle;
const { Sb3Exporter } = window;
const { distance, turnAngle, clamp, degToRad, rotatePoint, normalizeDegrees, pointInBounds } = window.ToioPlotterGeometry;
const { formatSeconds, formatAngle, escapeHtml } = window.ToioPlotterFormatters;
const {
  loadConfig,
  saveConfig,
  loadDeadSegmentSettings,
  saveDeadSegmentSettings,
  serializeCommandOverrides,
  loadCommandOverrides,
  loadTurnCalibrationLog,
  saveTurnCalibrationLog,
  clearTurnCalibrationLog: clearStoredTurnCalibrationLog,
} = window.ToioPlotterStorage;

const COLORS = {
  drawing: "#202124",
  penSimulation: "#0f7b6c",
  penTravel: "#8a8f98",
  penUpEvent: "#f59e0b",
  penDownEvent: "#16a34a",
  cubePath: "#2563eb",
  cubeGhost: "#7c3aed",
  cubeStart: "#16a34a",
  cubeEnd: "#7c3aed",
  liveCube: "#bd2f2f",
};

const PLAY_MAT_IMAGE_SRC = "image/playmat-position-id-01.png";
const POSITION_FRESH_MS = 500;
const POSITION_HOLD_MS = 1500;
const POSITION_RUN_TIMEOUT_MS = 1000;
const POSITION_RETRY_WAIT_MS = 3000;
const POSITION_RETRY_POLL_MS = 100;
const POSITION_TARGET_RETRY_COUNT = 1;
const POSITION_UI_REFRESH_MS = 300;
const MIN_TURN_DURATION_MS = 150;

const els = {
  canvas: document.getElementById("plotCanvas"),
  simStatus: document.getElementById("simStatus"),
  runStatus: document.getElementById("runStatus"),
  messageLog: document.getElementById("messageLog"),
  moveCubeState: document.getElementById("moveCubeState"),
  penCubeState: document.getElementById("penCubeState"),
  positionState: document.getElementById("positionState"),
  undoBtn: document.getElementById("undoBtn"),
  clearBtn: document.getElementById("clearBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importInput: document.getElementById("importInput"),
  sampleSelect: document.getElementById("sampleSelect"),
  loadSampleBtn: document.getElementById("loadSampleBtn"),
  connectMoveBtn: document.getElementById("connectMoveBtn"),
  connectPenBtn: document.getElementById("connectPenBtn"),
  swapRolesBtn: document.getElementById("swapRolesBtn"),
  simulateBtn: document.getElementById("simulateBtn"),
  runBtn: document.getElementById("runBtn"),
  sb3ExportBtn: document.getElementById("sb3ExportBtn"),
  stopBtn: document.getElementById("stopBtn"),
  penUpBtn: document.getElementById("penUpBtn"),
  penDownBtn: document.getElementById("penDownBtn"),
  legendToggleBtn: document.getElementById("legendToggleBtn"),
  runMode: document.getElementById("runMode"),
  deadSegmentsEditor: document.getElementById("deadSegmentsEditor"),
  toioCommandOutput: document.getElementById("toioCommandOutput"),
  prevSegmentBtn: document.getElementById("prevSegmentBtn"),
  nextSegmentBtn: document.getElementById("nextSegmentBtn"),
  simPauseBtn: document.getElementById("simPauseBtn"),
  simPrevStepBtn: document.getElementById("simPrevStepBtn"),
  simNextStepBtn: document.getElementById("simNextStepBtn"),
  copyCommandReportBtn: document.getElementById("copyCommandReportBtn"),
  turnCalibrationOutput: document.getElementById("turnCalibrationOutput"),
  clearTurnLogBtn: document.getElementById("clearTurnLogBtn"),
};

const configInputs = [
  "safeScale",
  "fixedHeading",
  "penOffsetX",
  "penOffsetY",
  "rotationCenterOffsetX",
  "rotationCenterOffsetY",
  "drawSpeed",
  "travelSpeed",
  "deadTurnSpeed",
  "deadTurnBalanceTrim",
  "deadTurnMsPer90",
  "deadMmPerSecAtDrawSpeed",
  "deadMmPerSecAtTravelSpeed",
  "deadTravelDistanceScale",
  "deadWheelBaseMm",
  "smoothing",
  "minPointDistance",
  "cornerAngle",
  "lineCorrection",
  "lineTolerance",
  "minSegmentLength",
  "targetTimeout",
  "upMotorSpeed",
  "upDurationMs",
  "downMotorSpeed",
  "downDurationMs",
  "penMotorMode",
  "settleMs",
].reduce((map, id) => {
  map[id] = document.getElementById(id);
  return map;
}, {});

const ctx = els.canvas.getContext("2d");
let resetTurnCalibrationLogOnLoad = true;
let config = loadConfig();
let strokes = [];
let activeStroke = null;
let simulation = null;
let simulationValid = false;
let runMode = DEFAULT_CONFIG.runMode;
let deadSegmentSettings = loadDeadSegmentSettings();
let commandOverrides = new Map();
let turnCalibrationLog = loadTurnCalibrationLog({ resetOnLoad: resetTurnCalibrationLogOnLoad });
let selectedDeadSegmentId = null;
let moveCube = null;
let penCube = null;
let playMatImageLoaded = false;
let lastMovePose = null;
let lastMovePoseAt = 0;
let lastMovePoseState = "missed";
let lastMovePoseUiAt = 0;
let movePoseUiTimer = null;
let canvasResizeObserver = null;
let legendVisible = localStorage.getItem("toioPlotterLegendVisible") !== "false";

const playMatImage = new Image();
playMatImage.onload = () => {
  playMatImageLoaded = true;
  draw();
};
playMatImage.onerror = () => {
  playMatImageLoaded = false;
  log(`プレイマット画像を読み込めませんでした: ${PLAY_MAT_IMAGE_SRC}`);
  draw();
};

const canvasRenderer = window.ToioPlotterCanvas.createCanvasRenderer({
  MAT,
  COLORS,
  canvas: els.canvas,
  ctx,
  playMatImage,
  getConfig: () => config,
  getStrokes: () => strokes,
  getActiveStroke: () => activeStroke,
  getSimulation: () => simulation,
  getSimulationValid: () => simulationValid,
  getSimulationAnimation: () => simulationPlayback.getAnimation(),
  getAnimatedCommands: () => getAnimatedCommands(),
  getDeadSegments: () => getDeadSegments(),
  getSelectedDeadSegmentId: () => selectedDeadSegmentId,
  getMovePoseStatus: () => getMovePoseStatus(),
  getLegendVisible: () => legendVisible,
  isDeadMode: () => isDeadMode(),
  safeBounds: () => safeBounds(),
  nativeToMatPose,
  penToCube: window.PlotterCore.penToCube,
  cubeToPen,
  distance,
  degToRad,
  primitivePreviewPoints: window.PlotterCore.primitivePreviewPoints,
});

const simulationTimelineTools = window.ToioPlotterTimeline.createSimulationTimelineTools({
  getSimulation: () => simulation,
  getConfig: () => config,
  cubeToPen,
  clamp,
  distance,
  normalizeDegrees,
  signedAngleDelta: window.PlotterCore.signedAngleDelta,
  pointOnCircle: window.PlotterCore.pointOnCircle,
  minTurnDurationMs: MIN_TURN_DURATION_MS,
});

const simulationPlayback = window.ToioPlotterSimulationPlayer.createSimulationPlaybackController({
  getSimulationValid: () => simulationValid,
  getCommands: () => simulation?.commands || [],
  timelineTools: simulationTimelineTools,
  clamp,
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (frameId) => cancelAnimationFrame(frameId),
  onControlsChanged: () => syncSimulationControls(),
  onActiveCommandChanged: () => updateActiveCommandRow(),
  onDraw: () => draw(),
});

const commandEditor = window.ToioPlotterCommandEditor.createCommandEditor({
  outputEl: els.toioCommandOutput,
  getSimulation: () => simulation,
  getSimulationValid: () => simulationValid,
  getConfig: () => config,
  getCommandOverrides: () => commandOverrides,
  isDeadMode,
  formatDeadToioCommand,
  formatPositionToioCommand,
  escapeHtml,
  commandDurationMs,
  roundToMotorDurationMs,
  clamp,
  minTurnDurationMs: MIN_TURN_DURATION_MS,
  turnWheelSpeeds,
  turnMsPer90,
  penToCube: window.PlotterCore.penToCube,
  cubeToPen,
  degToRad,
  normalizeDegrees,
  syncSimulationControls,
  focusCommand: (index, options) => simulationPlayback.focusCommand(index, options),
  getActiveCommandIndex: () => simulationPlayback.getActiveCommandIndex(),
  draw,
});

const toioRunner = window.ToioPlotterRunner.createToioRunner({
  MAT,
  getConfig: () => config,
  getSimulation: () => simulation,
  getSimulationValid: () => simulationValid,
  getMoveCube: () => moveCube,
  getPenCube: () => penCube,
  isDeadMode,
  hasFreshMovePose,
  getLastMovePoseAt: () => lastMovePoseAt,
  matToNativePoint,
  pointInBounds,
  getPenCommandSpeed,
  getPenCommandDuration,
  motorStraightSpeed,
  turnWheelSpeeds,
  turnMsPer90,
  roundToMotorDurationMs,
  clamp,
  minTurnDurationMs: MIN_TURN_DURATION_MS,
  positionFreshMs: POSITION_FRESH_MS,
  positionRunTimeoutMs: POSITION_RUN_TIMEOUT_MS,
  positionRetryWaitMs: POSITION_RETRY_WAIT_MS,
  positionRetryPollMs: POSITION_RETRY_POLL_MS,
  positionTargetRetryCount: POSITION_TARGET_RETRY_COUNT,
  setPill,
  runStatusEl: els.runStatus,
  runButtonEl: els.runBtn,
  log,
  syncRunButton,
  renderToioCommandOutput,
});

function resetDeadSegmentSettings() {
  deadSegmentSettings = {};
  commandOverrides = new Map();
  selectedDeadSegmentId = null;
  saveDeadSegmentSettings(deadSegmentSettings);
  renderDeadSegmentsEditor();
}

function syncConfigToForm() {
  for (const [key, input] of Object.entries(configInputs)) {
    input.value = config[key];
  }
  syncRunModeToForm();
}

function syncRunModeToForm() {
  els.runMode.value = runMode;
}

function applyConfigFromForm({ invalidate = true } = {}) {
  let changed = false;
  for (const [key, input] of Object.entries(configInputs)) {
    const value = Number(input.value);
    if (config[key] !== value) changed = true;
    config[key] = value;
  }
  if (changed) {
    saveConfig(config);
    if (invalidate) {
      simulation = null;
      invalidateSimulation("設定を変更しました");
      draw();
    }
  }
  return changed;
}

function readConfigFromForm() {
  applyConfigFromForm({ invalidate: true });
  renderTurnCalibration();
}

function changeRunMode() {
  runMode = els.runMode.value;
  selectedDeadSegmentId = null;
  simulation = null;
  invalidateSimulation("実行モードを変更しました");
  renderDeadSegmentsEditor();
  draw();
}

function invalidateSimulation(reason) {
  simulationValid = false;
  stopSimulationAnimation();
  els.runBtn.disabled = true;
  updateSb3ExportButton();
  setPill(els.simStatus, "未シミュレーション", "warn");
  renderToioCommandOutput();
  if (reason) log(reason);
}

function updateSb3ExportButton() {
  if (!els.sb3ExportBtn) return;
  els.sb3ExportBtn.disabled = !simulationValid || !simulation?.commands?.length || !isDeadMode();
}

function syncRunButton() {
  els.runBtn.disabled = toioRunner.isRunning() || !simulationValid || !hasRequiredToioConnection();
}

function hasRequiredToioConnection() {
  return isCubeConnected(moveCube) && isCubeConnected(penCube);
}

function isCubeConnected(cube) {
  return Boolean(cube?.isConnected?.());
}

function setConnectionState(el, state, text) {
  el.textContent = text;
  el.classList.remove("connected", "disconnected", "connecting");
  if (state) el.classList.add(state);
}

function setPill(el, text, cls = "") {
  el.className = `status-pill ${cls}`.trim();
  el.textContent = text;
}

function log(message) {
  const now = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  els.messageLog.textContent = `[${now}] ${message}\n${els.messageLog.textContent}`.slice(0, 1800);
}

function resizeCanvasBackingStore() {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
    draw();
  }
}

function canvasToMat(clientX, clientY) {
  return canvasRenderer.canvasToMat(clientX, clientY);
}

function observeCanvasSize() {
  if (!window.ResizeObserver || canvasResizeObserver) return;
  canvasResizeObserver = new ResizeObserver(() => resizeCanvasBackingStore());
  canvasResizeObserver.observe(els.canvas);
}

function settleCanvasBackingStore() {
  resizeCanvasBackingStore();
  requestAnimationFrame(() => resizeCanvasBackingStore());
}

function isDeadMode() {
  return runMode === "dead";
}

function safeBounds() {
  return window.PlotterCore.safeBounds(config);
}

function draw() {
  canvasRenderer.draw({ playMatImageLoaded });
}

function syncLegendToggle() {
  els.legendToggleBtn.setAttribute("aria-expanded", String(legendVisible));
}

function toggleLegend() {
  legendVisible = !legendVisible;
  localStorage.setItem("toioPlotterLegendVisible", String(legendVisible));
  syncLegendToggle();
  draw();
}

function processStroke(raw) {
  return window.PlotterCore.processStroke(raw, config);
}

function processFreehandStroke(raw) {
  return window.PlotterCore.processStrokeShape(raw, config);
}

function createSimulation() {
  if (isDeadMode()) {
    return window.PlotterCore.createDeadReckoningSimulation({ strokes, config, segmentSettings: deadSegmentSettings });
  }
  return window.PlotterCore.createSimulation({ strokes, config });
}

function cubeToPen(point, theta, configInput = {}) {
  const offset = rotatePoint(
    {
      x: configInput.penOffsetX + configInput.rotationCenterOffsetX,
      y: configInput.penOffsetY + configInput.rotationCenterOffsetY,
    },
    theta,
  );
  return {
    x: point.x + offset.x,
    y: point.y + offset.y,
  };
}

function runSimulation() {
  applyConfigFromForm({ invalidate: false });
  stopSimulationAnimation();
  captureCommandOverrides();
  simulation = createSimulation();
  applyCommandOverrides();
  if (!isDeadMode()) strokes = simulation.processedStrokes;
  if (!simulation.commands.length) {
    simulationValid = false;
    selectedDeadSegmentId = null;
    syncRunButton();
    setPill(els.simStatus, "線なし", "warn");
    log("描画線がありません。");
  } else if (simulation.errors.length) {
    simulationValid = false;
    selectedDeadSegmentId = null;
    syncRunButton();
    setPill(els.simStatus, "失敗", "error");
    log(`シミュレーション失敗:\n${simulation.errors.join("\n")}`);
  } else {
    simulationValid = true;
    syncRunButton();
    setPill(els.simStatus, "成功", "ok");
    const warn = simulation.warnings.length ? `\n警告: ${simulation.warnings.join(" ")}` : "";
    const stats = simulation.stats;
    if (isDeadMode()) {
      log(
        `Dead reckoning シミュレーション成功: ${simulation.segments.length} segments, ` +
          `${stats.drawSegments} draw, ${stats.travelSegments} travel, ` +
          `points ${stats.rawPoints} -> ${stats.processedPoints}${warn}`,
      );
    } else {
      log(
        `シミュレーション成功: ${simulation.commands.length} commands, ` +
          `${stats.drawSegments} draw segments, pen down ${stats.penDowns}, pen up ${stats.penUps}, ` +
          `points ${stats.rawPoints} -> ${stats.processedPoints}${warn}`,
      );
    }
  }
  if (simulationValid && isDeadMode() && !getSelectedDeadSegment()) selectFirstDeadDrawSegment();
  updateSb3ExportButton();
  renderDeadSegmentsEditor();
  renderToioCommandOutput();
  if (simulationValid) startSimulationAnimation();
  draw();
}

function buildImportedSimulation(reason) {
  stopSimulationAnimation();
  simulation = createSimulation();
  applyCommandOverrides();
  if (!isDeadMode()) strokes = simulation.processedStrokes;
  const hasErrors = simulation.errors.length > 0;
  simulationValid = !hasErrors && simulation.commands.length > 0;
  if (simulationValid && isDeadMode() && !getSelectedDeadSegment()) selectFirstDeadDrawSegment();
  syncRunButton();
  updateSb3ExportButton();
  setPill(els.simStatus, simulationValid ? "成功" : "失敗", simulationValid ? "ok" : "error");
  if (reason) log(reason);
  if (hasErrors) log(`Import simulation failed:\n${simulation.errors.join("\n")}`);
  renderDeadSegmentsEditor();
  renderToioCommandOutput();
}

function captureCommandOverrides() {
  commandEditor.captureCommandOverrides();
}

function applyCommandOverrides() {
  commandEditor.applyCommandOverrides();
}

function commandOverrideFromCommand(command) {
  return commandEditor.commandOverrideFromCommand(command);
}

function commandOverrideKey(command, index, commands) {
  return commandEditor.commandOverrideKey(command, index, commands);
}

function startSimulationAnimation() {
  simulationPlayback.start();
}

function stopSimulationAnimation() {
  simulationPlayback.stop();
}

function getSimulationElapsedMs() {
  return simulationPlayback.getElapsedMs();
}

function toggleSimulationPause() {
  simulationPlayback.togglePause();
}

function stepSimulation(delta) {
  simulationPlayback.step(delta);
}

function syncSimulationControls() {
  const enabled = Boolean(simulationValid && simulation?.commands?.length);
  const simulationAnimation = simulationPlayback.getAnimation();
  if (els.simPauseBtn) {
    els.simPauseBtn.disabled = !enabled || !simulationAnimation;
    els.simPauseBtn.textContent = simulationAnimation?.playing ? "Pause" : "Play";
  }
  if (els.simPrevStepBtn) els.simPrevStepBtn.disabled = !enabled;
  if (els.simNextStepBtn) els.simNextStepBtn.disabled = !enabled;
  if (els.copyCommandReportBtn) els.copyCommandReportBtn.disabled = !enabled;
}

function buildCommandReportText() {
  if (!simulationValid || !simulation?.commands?.length) return "";
  const lines = [
    "toio plotter calibration report",
    `mode: ${isDeadMode() ? "dead reckoning" : "position id"}`,
    "",
    "settings:",
    `drawSpeed: ${config.drawSpeed}`,
    `travelSpeed: ${config.travelSpeed}`,
    `deadTurnSpeed: ${config.deadTurnSpeed}`,
    `deadTurnBalanceTrim: ${config.deadTurnBalanceTrim}`,
    `deadTurnMsPer90: ${config.deadTurnMsPer90}`,
    `deadMmPerSecAtDrawSpeed: ${config.deadMmPerSecAtDrawSpeed}`,
    `deadMmPerSecAtTravelSpeed: ${config.deadMmPerSecAtTravelSpeed}`,
    `deadTravelDistanceScale: ${config.deadTravelDistanceScale}`,
    `upMotorSpeed: ${config.upMotorSpeed}`,
    `upDurationMs: ${config.upDurationMs}`,
    `downMotorSpeed: ${config.downMotorSpeed}`,
    `downDurationMs: ${config.downDurationMs}`,
    `settleMs: ${config.settleMs}`,
    "",
    "commands:",
    ...simulation.commands.map((command, index) => `${String(index + 1).padStart(2, "0")}. ${formatCommandForReport(command)}`),
  ];
  if (isDeadMode() && simulation.segments?.length) {
    lines.push("", "segments:");
    for (const segment of simulation.segments) {
      lines.push(
        `${segment.id}: ${segment.kind} length:${segment.lengthMm.toFixed(1)}mm heading:${segment.heading.toFixed(0)} ` +
          `speed:${segment.speed} durationScale:${segment.durationScale.toFixed(2)} ` +
          `distanceScale:${(segment.distanceScale ?? 1).toFixed(2)} steeringTrim:${segment.steeringTrim}`,
      );
    }
  }
  return lines.join("\n");
}

function formatCommandForReport(command) {
  const label = isDeadMode() ? formatDeadToioCommand(command) : formatPositionToioCommand(command);
  if (!command || !label) return "";
  if (command.type === "motor") {
    const details = [
      `left:${Math.round(command.leftSpeed ?? motorStraightSpeed(command))}`,
      `right:${Math.round(command.rightSpeed ?? motorStraightSpeed(command))}`,
      `durationMs:${command.durationMs || 0}`,
      `distanceScale:${motorDistanceScale(command).toFixed(2)}`,
    ];
    if (command.segmentId) details.push(`segment:${command.segmentId}`);
    if (command.role) details.push(`role:${command.role}`);
    return `${label} (${details.join(", ")})`;
  }
  if (command.type === "turn") {
    const speeds = turnWheelSpeeds(command);
    return `${label} (left:${speeds.left}, right:${speeds.right}, durationMs:${command.durationMs || 0})`;
  }
  if (command.type === "pen") {
    return `${label} (durationMs:${getPenCommandDuration(command)})`;
  }
  return label;
}

async function copyCommandReport() {
  const text = buildCommandReportText();
  if (!text) {
    log("コピーできるシミュレーション結果がありません。");
    return;
  }
  await copyText(text);
  log("コマンド報告テキストをコピーしました。");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function getAnimatedCommands() {
  return simulationPlayback.getAnimatedCommands();
}

function buildSimulationTimeline(commands) {
  return simulationTimelineTools.buildSimulationTimeline(commands);
}

function commandDurationMs(command, lastPenPoint) {
  return simulationTimelineTools.commandDurationMs(command, lastPenPoint);
}

function activeCommandIndexAtElapsed(timeline, elapsedMs) {
  return simulationTimelineTools.activeCommandIndexAtElapsed(timeline, elapsedMs);
}

function lastPlayableCommandIndex(timeline) {
  return simulationTimelineTools.lastPlayableCommandIndex(timeline);
}

function commandsAtElapsed(timeline, elapsedMs) {
  return simulationTimelineTools.commandsAtElapsed(timeline, elapsedMs);
}

function renderDeadSegmentsEditor() {
  if (!els.deadSegmentsEditor) return;
  if (!isDeadMode()) {
    els.deadSegmentsEditor.innerHTML = `<div class="segment-empty">Dead reckoning モードでシミュレーションすると調整できます。</div>`;
    return;
  }
  const segments = getDeadSegments();
  if (!segments.length) {
    els.deadSegmentsEditor.innerHTML = `<div class="segment-empty">シミュレーション後、キャンバス上の描画線分を選択してください。</div>`;
    return;
  }
  const segment = getSelectedDeadSegment();
  if (!segment) {
    els.deadSegmentsEditor.innerHTML = `<div class="segment-empty">キャンバス上の描画線分を選択してください。</div>`;
    return;
  }
  const index = segments.findIndex((item) => item.id === segment.id) + 1;
  const shape = segment.geometry === "arc" ? "arc" : "straight";
  const title = `${segment.kind === "draw" ? "draw" : "travel"} ${shape}`;
  const distanceControl =
    segment.kind === "travel" ? segmentInputTemplate(segment.id, "distanceScale", "distance", segment.distanceScale, 0.05) : "";
  els.deadSegmentsEditor.innerHTML = `
    <div class="segment-card">
      <div class="segment-title">#${index} ${title}</div>
      <div class="segment-meta">長さ ${segment.lengthMm.toFixed(1)}mm / 角度 ${segment.heading.toFixed(0)}° / start (${segment.start.x.toFixed(1)}, ${segment.start.y.toFixed(1)}) → end (${segment.end.x.toFixed(1)}, ${segment.end.y.toFixed(1)})</div>
      <div class="segment-meta">${segment.geometry === "arc" ? "円弧" : "直進"}</div>
      <div class="segment-fields">
        ${segmentInputTemplate(segment.id, "speed", "速度", segment.speed, 1)}
        ${segmentInputTemplate(segment.id, "durationScale", "時間倍率", segment.durationScale, 0.05)}
        ${distanceControl}
        ${segmentInputTemplate(segment.id, "steeringTrim", "直進補正", segment.steeringTrim, 1)}
      </div>
    </div>
  `;
}

function renderToioCommandOutput() {
  commandEditor.renderToioCommandOutput();
}

function commandRowTemplate(command, index) {
  return commandEditor.commandRowTemplate(command, index);
}

function commandControlsTemplate(command, index) {
  return commandEditor.commandControlsTemplate(command, index);
}

function motorStraightSpeed(command) {
  return commandEditor.motorStraightSpeed(command);
}

function motorDistanceScale(command) {
  return commandEditor.motorDistanceScale(command);
}

function displayCommandDurationMs(index) {
  return commandEditor.displayCommandDurationMs(index);
}

function commandInputTemplate(index, key, label, value, step, min, max) {
  return commandEditor.commandInputTemplate(index, key, label, value, step, min, max);
}

function getPenCommandSpeed(command) {
  return commandEditor.getPenCommandSpeed(command);
}

function getPenCommandDuration(command) {
  return commandEditor.getPenCommandDuration(command);
}

function updateActiveCommandRow() {
  commandEditor.updateActiveCommandRow();
}

function updateCommandEdit(input, { render = true } = {}) {
  commandEditor.updateCommandEdit(input, { render });
}

function ensureMotorBaseline(command) {
  commandEditor.ensureMotorBaseline(command);
}

function updateStraightMotorPose(command) {
  commandEditor.updateStraightMotorPose(command);
}

function updateManualTurnPose(command, index) {
  commandEditor.updateManualTurnPose(command, index);
}

function turnStartThetaAtCommand(index, command) {
  return commandEditor.turnStartThetaAtCommand(index, command);
}

function manualTurnAngle(command) {
  return commandEditor.manualTurnAngle(command);
}

function jumpToCommand(index) {
  if (!simulationPlayback.focusCommand(index)) return;
  syncSimulationControls();
  updateActiveCommandRow();
  draw();
}

function timelineItemForCommand(timeline, commandIndex) {
  return simulationTimelineTools.timelineItemForCommand(timeline, commandIndex);
}

function formatDeadToioCommands(commands) {
  return commands.map((command, index) => `${String(index + 1).padStart(2, "0")}. ${formatDeadToioCommand(command)}`).join("\n");
}

function formatDeadToioCommand(command) {
  if (command.type === "pen") {
    const action = command.state === "up" ? "UP" : "DOWN";
    return `pen: ${action} speed:${getPenCommandSpeed(command)}, ${formatSeconds(getPenCommandDuration(command))}`;
  }
  if (command.type === "turn") {
    const speeds = turnWheelSpeeds(command);
    return `move: turn ${formatAngle(command.angle)} / R:${speeds.right}, L:${speeds.left}, ${formatSeconds(command.durationMs)}`;
  }
  if (command.type === "motor") {
    const label = command.kind === "draw" ? `draw ${command.geometry === "arc" ? "arc" : "straight"}` : "travel straight";
    if (command.geometry === "arc") return `move: ${label} / R:${Math.round(command.rightSpeed)}, L:${Math.round(command.leftSpeed)}, ${formatSeconds(command.durationMs)}`;
    return `move: ${label} / speed:${motorStraightSpeed(command)}, ${formatSeconds(command.durationMs)}`;
  }
  if (command.type === "wait") return "wait";
  return null;
}

function formatPositionToioCommands(commands) {
  return commands.map((command, index) => `${String(index + 1).padStart(2, "0")}. ${formatPositionToioCommand(command)}`).join("\n");
}

function formatPositionToioCommand(command) {
  if (command.type === "pen") {
    const action = command.state === "up" ? "UP" : "DOWN";
    return `pen: ${action} speed:${getPenCommandSpeed(command)}, ${formatSeconds(getPenCommandDuration(command))}`;
  }
  if (command.type === "move" || command.type === "rotate") {
    return `move: ${command.type} x:${command.x.toFixed(1)}, y:${command.y.toFixed(1)}, theta:${command.theta.toFixed(0)}, speed:${command.speed}`;
  }
  if (command.type === "wait") return "wait";
  return null;
}

function turnWheelSpeeds(command) {
  if (command.leftSpeed != null || command.rightSpeed != null) {
    return {
      left: Math.round(clamp(command.leftSpeed || 0, -255, 255)),
      right: Math.round(clamp(command.rightSpeed || 0, -255, 255)),
    };
  }
  return window.PlotterCore.computeTurnWheelSpeeds(command.angle || 0, config.deadTurnSpeed, config.deadTurnBalanceTrim);
}

const TURN_CALIBRATION_TESTS = [
  { id: "plus90", label: "+90", targetAngle: 90 },
  { id: "minus90", label: "-90", targetAngle: -90 },
  { id: "plus180", label: "+180", targetAngle: 180 },
];

function renderTurnCalibration() {
  if (!els.turnCalibrationOutput) return;
  const rows = TURN_CALIBRATION_TESTS.map((test) => turnCalibrationRowTemplate(test)).join("");
  els.turnCalibrationOutput.innerHTML = `
    ${rows}
  `;
}

function turnCalibrationRowTemplate(test) {
  const entry = turnCalibrationLog[test.id] || {};
  const ms = turnTestDurationMs(test.targetAngle);
  const speeds = turnWheelSpeeds({ angle: test.targetAngle });
  const stats = turnCalibrationStats(test, entry);
  return `
    <div class="turn-test-row" data-turn-test-id="${test.id}">
      <div class="turn-test-main">
        <strong>${test.label}</strong>
        <span>L:${speeds.left}</span>
        <span>R:${speeds.right}</span>
        <span>ms:${ms}</span>
      </div>
      <div class="turn-test-inputs">
        ${turnRunInputTemplate(test.id, 0, entry.runs?.[0])}
        ${turnRunInputTemplate(test.id, 1, entry.runs?.[1])}
        ${turnRunInputTemplate(test.id, 2, entry.runs?.[2])}
      </div>
      <div class="turn-test-result">
        <span>avg:${stats.avg == null ? "--" : stats.avg.toFixed(1)}</span>
        <span>range:${stats.range == null ? "--" : stats.range.toFixed(1)}</span>
      </div>
      <button type="button" data-run-turn-test="${test.id}">Run</button>
    </div>
  `;
}

function turnRunInputTemplate(testId, runIndex, value) {
  const display = value == null || value === "" ? "" : Number(value).toFixed(0);
  return `<label>run${runIndex + 1}<input data-turn-test-id="${testId}" data-turn-run-index="${runIndex}" type="number" step="1" value="${display}" /></label>`;
}

function turnTestDurationMs(targetAngle) {
  return plannedTurnDurationMs(targetAngle);
}

function turnMsPer90() {
  return Math.max(MIN_TURN_DURATION_MS, Number(config.deadTurnMsPer90) || DEFAULT_CONFIG.deadTurnMsPer90);
}

function turnCalibrationStats(test, entry) {
  const runs = (entry.runs || []).map(Number).filter((value) => Number.isFinite(value) && value !== 0);
  if (!runs.length) return { avg: null, range: null, scale: null };
  const absolutes = runs.map((value) => Math.abs(value));
  const avg = absolutes.reduce((sum, value) => sum + value, 0) / absolutes.length;
  const range = Math.max(...absolutes) - Math.min(...absolutes);
  return { avg, range };
}

function updateTurnCalibrationInput(input) {
  const testId = input.dataset.turnTestId;
  const runIndex = Number(input.dataset.turnRunIndex);
  if (!testId || !Number.isInteger(runIndex)) return;
  const entry = turnCalibrationLog[testId] || { runs: [] };
  entry.runs = entry.runs || [];
  entry.runs[runIndex] = input.value === "" || input.value === "-" ? "" : Number(input.value);
  turnCalibrationLog[testId] = entry;
  saveTurnCalibrationLog(turnCalibrationLog);
}

function finalizeTurnCalibrationInput() {
  renderTurnCalibration();
}

function clearTurnCalibrationLog() {
  turnCalibrationLog = {};
  clearStoredTurnCalibrationLog();
  simulation = null;
  invalidateSimulation("回転テストログと回転倍率をリセットしました");
  renderTurnCalibration();
  draw();
}

async function runTurnCalibrationTest(testId) {
  const test = TURN_CALIBRATION_TESTS.find((item) => item.id === testId);
  if (!test) return;
  if (!moveCube) {
    log("移動用 toio を接続してください。");
    return;
  }
  const ms = turnTestDurationMs(test.targetAngle);
  const speeds = turnWheelSpeeds({ angle: test.targetAngle });
  log(`turn test ${test.label}: L=${speeds.left} R=${speeds.right} ${ms}ms`);
  await moveCube.timedMotorPair(speeds.left, speeds.right, ms);
  await sleep(ms);
}

function segmentInputTemplate(segmentId, key, label, value, step) {
  return `<label>${label}<input data-segment-id="${segmentId}" data-segment-key="${key}" type="number" step="${step}" value="${Number(value).toFixed(step < 1 ? 2 : 0)}" /></label>`;
}

function getDrawSegments() {
  return simulation?.segments?.filter((segment) => segment.kind === "draw") || [];
}

function getDeadSegments() {
  return simulation?.segments || [];
}

function getSelectedDrawSegment() {
  return getDrawSegments().find((segment) => segment.id === selectedDeadSegmentId) || null;
}

function getSelectedDeadSegment() {
  return getDeadSegments().find((segment) => segment.id === selectedDeadSegmentId) || null;
}

function selectDeadSegment(segmentId) {
  selectedDeadSegmentId = segmentId;
  renderDeadSegmentsEditor();
  draw();
}

function selectFirstDeadDrawSegment() {
  const [first] = getDeadSegments();
  selectedDeadSegmentId = first?.id || null;
}

function selectAdjacentDrawSegment(delta) {
  const segments = getDeadSegments();
  if (!segments.length) return;
  const currentIndex = Math.max(0, segments.findIndex((segment) => segment.id === selectedDeadSegmentId));
  const nextIndex = clamp(currentIndex + delta, 0, segments.length - 1);
  selectDeadSegment(segments[nextIndex].id);
}

function findClickedDrawSegment(event) {
  if (!simulationValid) return null;
  return canvasRenderer.findClickedDrawSegment(event);
}

function updateDeadSegmentSetting(input) {
  const segmentId = input.dataset.segmentId;
  const key = input.dataset.segmentKey;
  if (!segmentId || !key) return;
  deadSegmentSettings[segmentId] = { ...(deadSegmentSettings[segmentId] || {}), [key]: Number(input.value) };
  saveDeadSegmentSettings(deadSegmentSettings);
  if (!isDeadMode() || !simulation?.segments?.length) return;
  stopSimulationAnimation();
  simulation = createSimulation();
  if (!getSelectedDeadSegment()) selectFirstDeadDrawSegment();
  const hasErrors = simulation.errors.length > 0;
  simulationValid = !hasErrors && simulation.commands.length > 0;
  syncRunButton();
  setPill(els.simStatus, simulationValid ? "成功" : "失敗", simulationValid ? "ok" : "error");
  if (hasErrors) log(`線分調整エラー:\n${simulation.errors.join("\n")}`);
  renderDeadSegmentsEditor();
  renderToioCommandOutput();
  draw();
}

async function runToio() {
  await toioRunner.runToio();
}

async function setPen(state, command = null) {
  await toioRunner.setPen(state, command);
}

async function runMoveCommandWithPositionRetry(command, nativePoint) {
  await toioRunner.runMoveCommandWithPositionRetry(command, nativePoint);
}

async function ensureFreshPositionOrRetry(context) {
  await toioRunner.ensureFreshPositionOrRetry(context);
}

async function ensureFreshPositionAfterPen(state, sinceMs) {
  await toioRunner.ensureFreshPositionAfterPen(state, sinceMs);
}

async function recoverPositionForRetry() {
  await toioRunner.recoverPositionForRetry();
}

async function waitForFreshMovePose(timeoutMs) {
  return toioRunner.waitForFreshMovePose(timeoutMs);
}

async function waitForFreshMovePoseAfter(sinceMs, timeoutMs) {
  return toioRunner.waitForFreshMovePoseAfter(sinceMs, timeoutMs);
}

function isPositionRetryableError(error) {
  return toioRunner.isPositionRetryableError(error);
}

async function emergencyStop() {
  await toioRunner.emergencyStop();
}

function exportDrawing() {
  captureCommandOverrides();
  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    mat: MAT,
    config,
    strokes,
    deadSegmentSettings,
    commandOverrides: serializeCommandOverrides(commandOverrides),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "toio-plotter-drawing.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function exportSb3() {
  if (!isDeadMode()) {
    log("toio do export は Dead reckoning モードのシミュレーション結果だけに対応しています。");
    return;
  }
  if (!simulationValid || !simulation?.commands?.length) {
    log("toio do export の前に Dead reckoning で Simulate してください。");
    return;
  }
  if (!Sb3Exporter) {
    log("toio do export モジュールを読み込めませんでした。");
    return;
  }

  els.sb3ExportBtn.disabled = true;
  try {
    const response = await fetch(Sb3Exporter.TEMPLATE_URL);
    if (!response.ok) {
      throw new Error(`${Sb3Exporter.TEMPLATE_URL} を読み込めませんでした (${response.status})。`);
    }
    const templateBytes = new Uint8Array(await response.arrayBuffer());
    const sb3Bytes = await Sb3Exporter.exportProject({
      templateBytes,
      commands: simulation.commands,
      segments: simulation.segments,
      mat: MAT,
      config,
      turnWheelSpeeds,
      getPenCommandSpeed,
      getPenCommandDuration,
    });
    const blob = new Blob([sb3Bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = Sb3Exporter.EXPORT_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
    log(`toio do export: ${Sb3Exporter.EXPORT_FILENAME} を作成しました。`);
  } catch (error) {
    log(`toio do export failed: ${error.message}`);
  } finally {
    updateSb3ExportButton();
  }
}

async function importDrawing(file) {
  const text = await file.text();
  importDrawingPayload(JSON.parse(text), "描画 JSON を読み込みました");
}

function importDrawingPayload(payload, reason, options = { preservePenOffset: true }) {
  strokes = Array.isArray(payload.strokes) ? payload.strokes : [];
  deadSegmentSettings = payload.deadSegmentSettings && typeof payload.deadSegmentSettings === "object" ? payload.deadSegmentSettings : {};
  commandOverrides = loadCommandOverrides(payload.commandOverrides);
  selectedDeadSegmentId = null;
  saveDeadSegmentSettings(deadSegmentSettings);
  renderDeadSegmentsEditor();
  if (payload.config) {
    const importedConfig = { ...payload.config };
    delete importedConfig.runMode;
    if (options.preservePenOffset) {
      delete importedConfig.penOffsetX;
      delete importedConfig.penOffsetY;
      delete importedConfig.rotationCenterOffsetX;
      delete importedConfig.rotationCenterOffsetY;
    }
    config = { ...config, ...importedConfig };
    syncConfigToForm();
    saveConfig(config);
  }
  buildImportedSimulation(reason);
  draw();
}

async function loadSelectedSample() {
  const src = els.sampleSelect.value;
  if (!src) {
    log("サンプル図形を選択してください。");
    return;
  }
  const response = await fetch(src, { cache: "no-store" });
  if (!response.ok) throw new Error(`Sample load failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  importDrawingPayload(payload, `サンプルを読み込みました: ${els.sampleSelect.options[els.sampleSelect.selectedIndex].text}`);
}

function pointerDown(event) {
  event.preventDefault();
  const clickedSegment = findClickedDrawSegment(event);
  if (clickedSegment) {
    selectDeadSegment(clickedSegment.id);
    activeStroke = null;
    return;
  }
  activeStroke = { source: "freehand", raw: [canvasToMat(event.clientX, event.clientY)] };
  els.canvas.setPointerCapture(event.pointerId);
  draw();
}

function pointerMove(event) {
  if (!activeStroke) return;
  event.preventDefault();
  const point = canvasToMat(event.clientX, event.clientY);
  const last = activeStroke.raw[activeStroke.raw.length - 1];
  if (distance(point, last) > 0.5) activeStroke.raw.push(point);
  draw();
}

function pointerUp(event) {
  if (!activeStroke) return;
  event.preventDefault();
  if (activeStroke.raw.length > 1) {
    const shaped = processFreehandStroke(activeStroke.raw);
    if (shaped.error) {
      log(`円弧として補正できませんでした: ${shaped.error} 描いた線をクリアしました。`);
      activeStroke = null;
      draw();
      return;
    }
    activeStroke.processed = shaped.processed;
    activeStroke.primitives = shaped.primitives;
    strokes.push(activeStroke);
    resetDeadSegmentSettings();
    simulation = null;
    invalidateSimulation("描画を変更しました");
  }
  activeStroke = null;
  draw();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectedName(cube) {
  return cube?.device?.name || "未接続";
}

function handleCubeDisconnected(role) {
  if (role === "move") {
    lastMovePose = null;
    lastMovePoseAt = 0;
    lastMovePoseState = "missed";
    setConnectionState(els.moveCubeState, "disconnected", "切断");
    els.positionState.textContent = "Position ID missed";
  } else {
    setConnectionState(els.penCubeState, "disconnected", "切断");
  }
  toioRunner.requestAbort();
  if (toioRunner.isRunning()) {
    void emergencyStop().finally(() => setPill(els.runStatus, "toio切断", "error"));
  }
  syncRunButton();
  setPill(els.runStatus, "toio切断", "error");
  log(`${role === "move" ? "移動用" : "昇降用"} toio が切断されました`);
}

function getMovePoseStatus(now = Date.now()) {
  if (!lastMovePose) return { state: "missed", pose: null, ageMs: Infinity };
  const ageMs = now - lastMovePoseAt;
  if (ageMs <= POSITION_FRESH_MS) return { state: "fresh", pose: lastMovePose, ageMs };
  if (ageMs <= POSITION_HOLD_MS) return { state: "unstable", pose: lastMovePose, ageMs };
  return { state: "missed", pose: null, ageMs };
}

function hasFreshMovePose(maxAgeMs) {
  return Boolean(lastMovePose && Date.now() - lastMovePoseAt <= maxAgeMs);
}

function updateMovePoseText(status = getMovePoseStatus()) {
  lastMovePoseState = status.state;
  if (status.state === "fresh") {
    const matPose = nativeToMatPose(status.pose);
    els.positionState.textContent = `x:${matPose.x.toFixed(1)} y:${matPose.y.toFixed(1)} θ:${matPose.theta}`;
  } else if (status.state === "unstable") {
    els.positionState.textContent = "Position ID unstable";
  } else {
    els.positionState.textContent = "Position ID missed";
  }
}

function updateMovePoseUi({ force = false } = {}) {
  const now = Date.now();
  const elapsed = now - lastMovePoseUiAt;
  const apply = () => {
    if (movePoseUiTimer) {
      window.clearTimeout(movePoseUiTimer);
      movePoseUiTimer = null;
    }
    lastMovePoseUiAt = Date.now();
    updateMovePoseText();
    draw();
  };

  if (force || elapsed >= POSITION_UI_REFRESH_MS) {
    apply();
    return;
  }

  if (!movePoseUiTimer) {
    movePoseUiTimer = window.setTimeout(() => apply(), POSITION_UI_REFRESH_MS - elapsed);
  }
}

async function runDeadReckoningToio() {
  await toioRunner.runDeadReckoningToio();
}

async function runDeadTurn(command) {
  await toioRunner.runDeadTurn(command);
}

function deadTurnDurationMsForRun(command) {
  return toioRunner.deadTurnDurationMsForRun(command);
}

function plannedTurnDurationMs(angleDeg) {
  return toioRunner.plannedTurnDurationMs(angleDeg);
}

function roundToMotorDurationMs(durationMs) {
  return clamp(Math.round(durationMs / 10), 1, 255) * 10;
}

async function runDeadMotor(command) {
  await toioRunner.runDeadMotor(command);
}

async function runTimedMotorPairForDuration(leftSpeed, rightSpeed, durationMs) {
  await toioRunner.runTimedMotorPairForDuration(leftSpeed, rightSpeed, durationMs);
}

function refreshMovePoseStatus() {
  if (!moveCube || !lastMovePose) return;
  const previous = lastMovePoseState;
  const status = getMovePoseStatus();
  if (status.state !== previous) {
    updateMovePoseUi({ force: true });
  }
}

function setMoveCube(cube) {
  moveCube = cube;
  if (!cube) {
    lastMovePose = null;
    lastMovePoseAt = 0;
    lastMovePoseState = "missed";
    lastMovePoseUiAt = 0;
    if (movePoseUiTimer) {
      window.clearTimeout(movePoseUiTimer);
      movePoseUiTimer = null;
    }
    els.moveCubeState.textContent = "未接続";
    els.positionState.textContent = "未取得";
    return;
  }
  cube.role = "移動用";
  cube.onStatus = (status) => {
    setConnectionState(els.moveCubeState, isCubeConnected(cube) ? "connected" : "connecting", status);
    syncRunButton();
  };
  cube.onDisconnect = () => handleCubeDisconnected("move");
  cube.onPose = (pose) => {
    lastMovePose = pose;
    lastMovePoseAt = Date.now();
    updateMovePoseUi();
  };
  cube.onPositionMissed = () => {
    updateMovePoseUi();
  };
  cube.onLog = log;
  setConnectionState(els.moveCubeState, isCubeConnected(cube) ? "connected" : "connecting", connectedName(cube));
  syncRunButton();
  if (cube.pose) {
    lastMovePose = cube.pose;
    lastMovePoseAt = Date.now();
    updateMovePoseUi({ force: true });
  }
}

function setPenCube(cube) {
  penCube = cube;
  if (!cube) {
    els.penCubeState.textContent = "未接続";
    return;
  }
  cube.role = "昇降用";
  cube.onStatus = (status) => {
    setConnectionState(els.penCubeState, isCubeConnected(cube) ? "connected" : "connecting", status);
    syncRunButton();
  };
  cube.onDisconnect = () => handleCubeDisconnected("pen");
  cube.onPose = () => {};
  cube.onPositionMissed = () => {};
  cube.onLog = log;
  setConnectionState(els.penCubeState, isCubeConnected(cube) ? "connected" : "connecting", connectedName(cube));
  syncRunButton();
}

function swapCubeRoles() {
  if (!moveCube || !penCube) {
    log("役割入替には移動用と昇降用の両方を接続してください。");
    return;
  }
  const oldMove = moveCube;
  setMoveCube(penCube);
  setPenCube(oldMove);
  log("移動用と昇降用の役割を入れ替えました。");
  draw();
}

function bindEvents() {
  els.canvas.addEventListener("pointerdown", pointerDown);
  els.canvas.addEventListener("pointermove", pointerMove);
  els.canvas.addEventListener("pointerup", pointerUp);
  els.canvas.addEventListener("pointercancel", pointerUp);
  window.addEventListener("resize", resizeCanvasBackingStore);
  els.legendToggleBtn.addEventListener("click", toggleLegend);

  els.undoBtn.addEventListener("click", () => {
    strokes.pop();
    resetDeadSegmentSettings();
    simulation = null;
    invalidateSimulation("Undo");
    draw();
  });
  els.clearBtn.addEventListener("click", () => {
    strokes = [];
    activeStroke = null;
    resetDeadSegmentSettings();
    simulation = null;
    invalidateSimulation("Clear");
    draw();
  });
  els.exportBtn.addEventListener("click", exportDrawing);
  els.sb3ExportBtn?.addEventListener("click", () => exportSb3());
  els.importInput.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importDrawing(file).catch((error) => log(`Import failed: ${error.message}`));
    event.target.value = "";
  });
  els.loadSampleBtn.addEventListener("click", () => loadSelectedSample().catch((error) => log(error.message)));
  els.sampleSelect.addEventListener("change", () => {
    if (els.sampleSelect.value) loadSelectedSample().catch((error) => log(error.message));
  });

  els.simulateBtn.addEventListener("click", runSimulation);
  els.simPauseBtn?.addEventListener("click", toggleSimulationPause);
  els.simPrevStepBtn?.addEventListener("click", () => stepSimulation(-1));
  els.simNextStepBtn?.addEventListener("click", () => stepSimulation(1));
  els.copyCommandReportBtn?.addEventListener("click", () => copyCommandReport().catch((error) => log(`Copy failed: ${error.message}`)));
  els.toioCommandOutput?.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement) updateCommandEdit(event.target, { render: false });
  });
  els.toioCommandOutput?.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement) updateCommandEdit(event.target, { render: true });
  });
  els.toioCommandOutput?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-command-step]");
    if (button) jumpToCommand(Number(button.dataset.commandStep));
  });
  els.turnCalibrationOutput?.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement) updateTurnCalibrationInput(event.target);
  });
  els.turnCalibrationOutput?.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement) finalizeTurnCalibrationInput();
  });
  els.turnCalibrationOutput?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-run-turn-test]");
    if (button) runTurnCalibrationTest(button.dataset.runTurnTest).catch((error) => log(error.message));
  });
  els.clearTurnLogBtn?.addEventListener("click", clearTurnCalibrationLog);
  els.runBtn.addEventListener("click", () => runToio());
  els.stopBtn.addEventListener("click", () => emergencyStop());
  els.penUpBtn.addEventListener("click", () => setPen("up").then(() => log("Pen up")).catch((error) => log(error.message)));
  els.penDownBtn.addEventListener("click", () => setPen("down").then(() => log("Pen down")).catch((error) => log(error.message)));

  els.connectMoveBtn.addEventListener("click", async () => {
    let cube = null;
    try {
      cube = new ToioCube("移動用", { onLog: log });
      setMoveCube(cube);
      await cube.connect();
    } catch (error) {
      if (cube && !cube.isConnected?.()) setMoveCube(null);
      log(error.message);
    }
  });
  els.connectPenBtn.addEventListener("click", async () => {
    let cube = null;
    try {
      cube = new ToioCube("昇降用", { onLog: log });
      setPenCube(cube);
      await cube.connect();
    } catch (error) {
      if (cube && !cube.isConnected?.()) setPenCube(null);
      log(error.message);
    }
  });
  els.swapRolesBtn.addEventListener("click", swapCubeRoles);
  els.prevSegmentBtn?.addEventListener("click", () => selectAdjacentDrawSegment(-1));
  els.nextSegmentBtn?.addEventListener("click", () => selectAdjacentDrawSegment(1));
  els.deadSegmentsEditor?.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement) updateDeadSegmentSetting(event.target);
  });
  els.deadSegmentsEditor?.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement) updateDeadSegmentSetting(event.target);
  });

  for (const input of Object.values(configInputs)) {
    input.addEventListener("input", readConfigFromForm);
    input.addEventListener("change", readConfigFromForm);
  }
  els.runMode.addEventListener("change", changeRunMode);
}

function init() {
  syncConfigToForm();
  syncLegendToggle();
  renderDeadSegmentsEditor();
  renderToioCommandOutput();
  renderTurnCalibration();
  updateSb3ExportButton();
  bindEvents();
  window.setInterval(refreshMovePoseStatus, POSITION_UI_REFRESH_MS);
  observeCanvasSize();
  settleCanvasBackingStore();
  playMatImage.src = PLAY_MAT_IMAGE_SRC;
  setPill(els.simStatus, "未シミュレーション", "warn");
  log("準備完了。フリーハンドで描画してください。");
}

init();
