"use strict";

const { MAT, DEFAULT_CONFIG, nativeToMatPose, matToNativePoint } = window.PlotterCore;
const { ToioCube } = window.ToioBle;
const { Sb3Exporter } = window;

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

const selectConfigInputs = {
  runMode: els.runMode,
};

const ctx = els.canvas.getContext("2d");
let resetTurnCalibrationLogOnLoad = true;
let config = loadConfig();
let strokes = [];
let activeStroke = null;
let simulation = null;
let simulationValid = false;
let simulationAnimation = null;
let activeSimulationCommandIndex = -1;
let deadSegmentSettings = loadDeadSegmentSettings();
let commandOverrides = new Map();
let turnCalibrationLog = loadTurnCalibrationLog();
let selectedDeadSegmentId = null;
let running = false;
let abortRun = false;
let moveCube = null;
let penCube = null;
let playMatImageLoaded = false;
let lastMovePose = null;
let lastMovePoseAt = 0;
let lastMovePoseState = "missed";
let lastMovePoseUiAt = 0;
let movePoseUiTimer = null;
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
playMatImage.src = PLAY_MAT_IMAGE_SRC;

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem("toioPlotterConfig") || "{}");
    const savedVersion = saved.configVersion || 0;
    let changed = false;
    if (!saved.configVersion && saved.penOffsetX === 0 && saved.penOffsetY === 48) {
      saved.penOffsetX = DEFAULT_CONFIG.penOffsetX;
      saved.penOffsetY = DEFAULT_CONFIG.penOffsetY;
      changed = true;
    }
    if (savedVersion < 3) {
      saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
      saved.downMotorSpeed = DEFAULT_CONFIG.downMotorSpeed;
      saved.penMotorMode = DEFAULT_CONFIG.penMotorMode;
      changed = true;
    }
    if (savedVersion < 4) {
      saved.travelSpeed = DEFAULT_CONFIG.travelSpeed;
      saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
      saved.downMotorSpeed = DEFAULT_CONFIG.downMotorSpeed;
      changed = true;
    }
    if (savedVersion < 5) {
      saved.drawSpeed = DEFAULT_CONFIG.drawSpeed;
      saved.travelSpeed = DEFAULT_CONFIG.travelSpeed;
      changed = true;
    }
    if (savedVersion < 6) {
      saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
      changed = true;
    }
    if (savedVersion < 7) {
      saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
      changed = true;
    }
    if (savedVersion < 8) {
      saved.runMode = DEFAULT_CONFIG.runMode;
      saved.deadTurnSpeed = DEFAULT_CONFIG.deadTurnSpeed;
      saved.deadTurnBalanceTrim = DEFAULT_CONFIG.deadTurnBalanceTrim;
      saved.deadMmPerSecAtDrawSpeed = DEFAULT_CONFIG.deadMmPerSecAtDrawSpeed;
      saved.deadMmPerSecAtTravelSpeed = DEFAULT_CONFIG.deadMmPerSecAtTravelSpeed;
      changed = true;
    }
    if (savedVersion < 11) {
      changed = true;
    }
    if (savedVersion < 12 && saved.deadTurnSpeed === 30) {
      saved.deadTurnSpeed = DEFAULT_CONFIG.deadTurnSpeed;
      changed = true;
    }
    if (savedVersion < 16) {
      saved.deadMmPerSecAtTravelSpeed = DEFAULT_CONFIG.deadMmPerSecAtTravelSpeed;
      changed = true;
    }
    if (savedVersion < 24) {
      saved.deadTurnSpeed = DEFAULT_CONFIG.deadTurnSpeed;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(saved, "deadTurnDurationScale")) {
      delete saved.deadTurnDurationScale;
      changed = true;
    }
    if (savedVersion < 24) {
      saved.deadTurnMsPer90 = DEFAULT_CONFIG.deadTurnMsPer90;
      changed = true;
    }
    if (savedVersion < 25) {
      saved.deadTravelDistanceScale = DEFAULT_CONFIG.deadTravelDistanceScale;
      changed = true;
    }
    const loaded = { ...DEFAULT_CONFIG, ...saved, configVersion: DEFAULT_CONFIG.configVersion };
    if (changed || saved.configVersion !== DEFAULT_CONFIG.configVersion) {
      localStorage.setItem("toioPlotterConfig", JSON.stringify(loaded));
    }
    return loaded;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  localStorage.setItem("toioPlotterConfig", JSON.stringify(config));
}

function loadDeadSegmentSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem("toioPlotterDeadSegmentSettings") || "{}");
    let changed = false;
    for (const setting of Object.values(settings)) {
      if (setting && Object.prototype.hasOwnProperty.call(setting, "turnDurationScale")) {
        delete setting.turnDurationScale;
        changed = true;
      }
    }
    if (changed) localStorage.setItem("toioPlotterDeadSegmentSettings", JSON.stringify(settings));
    return settings;
  } catch {
    return {};
  }
}

function saveDeadSegmentSettings() {
  localStorage.setItem("toioPlotterDeadSegmentSettings", JSON.stringify(deadSegmentSettings));
}

function serializeCommandOverrides() {
  return Object.fromEntries(commandOverrides.entries());
}

function loadCommandOverrides(value) {
  if (Array.isArray(value)) return new Map(value);
  if (value && typeof value === "object") return new Map(Object.entries(value));
  return new Map();
}

function loadTurnCalibrationLog() {
  if (resetTurnCalibrationLogOnLoad) {
    localStorage.removeItem("toioPlotterTurnCalibrationLog");
    return {};
  }
  try {
    return JSON.parse(localStorage.getItem("toioPlotterTurnCalibrationLog") || "{}");
  } catch {
    return {};
  }
}

function saveTurnCalibrationLog() {
  localStorage.setItem("toioPlotterTurnCalibrationLog", JSON.stringify(turnCalibrationLog));
}

function resetDeadSegmentSettings() {
  deadSegmentSettings = {};
  commandOverrides = new Map();
  selectedDeadSegmentId = null;
  saveDeadSegmentSettings();
  renderDeadSegmentsEditor();
}

function syncConfigToForm() {
  for (const [key, input] of Object.entries(configInputs)) {
    input.value = config[key];
  }
  for (const [key, input] of Object.entries(selectConfigInputs)) {
    input.value = config[key];
  }
}

function applyConfigFromForm({ invalidate = true } = {}) {
  let changed = false;
  for (const [key, input] of Object.entries(configInputs)) {
    const value = Number(input.value);
    if (config[key] !== value) changed = true;
    config[key] = value;
  }
  for (const [key, input] of Object.entries(selectConfigInputs)) {
    if (config[key] !== input.value) changed = true;
    config[key] = input.value;
  }
  if (changed) {
    saveConfig();
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
  els.runBtn.disabled = running || !simulationValid || !hasRequiredToioConnection();
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

function getView() {
  const width = els.canvas.width;
  const height = els.canvas.height;
  const bounds = getDrawingBounds();
  const matW = bounds.maxX - bounds.minX;
  const matH = bounds.maxY - bounds.minY;
  const margin = 42 * (window.devicePixelRatio || 1);
  const scale = Math.min((width - margin * 2) / matW, (height - margin * 2) / matH);
  const drawW = matW * scale;
  const drawH = matH * scale;
  return {
    scale,
    left: (width - drawW) / 2,
    top: (height - drawH) / 2,
    width: drawW,
    height: drawH,
  };
}

function matToCanvas(point) {
  const view = getView();
  const bounds = getDrawingBounds();
  return {
    x: view.left + (point.x - bounds.minX) * view.scale,
    y: view.top + (point.y - bounds.minY) * view.scale,
  };
}

function canvasToMat(clientX, clientY) {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = (clientX - rect.left) * dpr;
  const y = (clientY - rect.top) * dpr;
  const view = getView();
  const bounds = getDrawingBounds();
  return {
    x: bounds.minX + (x - view.left) / view.scale,
    y: bounds.minY + (y - view.top) / view.scale,
  };
}

function isDeadMode() {
  return config.runMode === "dead";
}

function getDrawingBounds() {
  return MAT;
}

function safeBounds() {
  return window.PlotterCore.safeBounds(config);
}

function pointInBounds(point, bounds) {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

function draw() {
  els.canvas.style.cursor = isDeadMode() && simulationValid && getDeadSegments().length ? "pointer" : "crosshair";
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  drawMat();
  for (const stroke of strokes) drawStroke(stroke.processed || stroke.raw, COLORS.drawing, 2.2);
  if (activeStroke) drawStroke(activeStroke.raw, COLORS.drawing, 2.2);
  if (simulation) {
    const animatedCommands = getAnimatedCommands();
    drawCommands(animatedCommands);
    drawDeadSegmentSelectionOverlay();
    if (simulationAnimation) {
      drawAnimationCursor(animatedCommands);
    } else {
      drawCubePath(simulation.cubePath);
    }
  }
  const poseStatus = getMovePoseStatus();
  if (!isDeadMode() && poseStatus.pose && poseStatus.state !== "missed") {
    drawCubePose(nativeToMatPose(poseStatus.pose), COLORS.liveCube, poseStatus.state === "unstable" ? 0.42 : 1, true);
  }
  if (legendVisible) drawLegend();
}

function drawDeadSegmentSelectionOverlay() {
  const segments = getDeadSegments();
  if (!isDeadMode() || !segments.length) return;
  for (const segment of segments) {
    const selected = segment.id === selectedDeadSegmentId;
    drawSegmentHighlight(segment, selected);
  }
}

function drawSegmentHighlight(segment, selected) {
  const dpr = window.devicePixelRatio || 1;
  const start = matToCanvas(segment.start);
  const end = matToCanvas(segment.end);
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = selected ? "rgba(37, 99, 235, 0.85)" : "rgba(37, 99, 235, 0.45)";
  ctx.lineWidth = 2.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
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

function drawMat() {
  const bounds = getDrawingBounds();
  const p1 = matToCanvas({ x: bounds.minX, y: bounds.minY });
  const p2 = matToCanvas({ x: bounds.maxX, y: bounds.maxY });
  ctx.save();
  ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
  ctx.strokeStyle = "#9d9588";
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  if (!isDeadMode() && playMatImageLoaded) {
    ctx.drawImage(playMatImage, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  }
  ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

  let label = "A3 simple play mat #01 (Position ID)";
  const safe = safeBounds();
  const s1 = matToCanvas({ x: safe.minX, y: safe.minY });
  const s2 = matToCanvas({ x: safe.maxX, y: safe.maxY });
  ctx.setLineDash([8, 7]);
  ctx.strokeStyle = "#0f7b6c";
  ctx.strokeRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y);
  ctx.setLineDash([]);
  ctx.fillStyle = "#6c6f73";
  ctx.font = `${12 * (window.devicePixelRatio || 1)}px system-ui`;
  ctx.fillText("safe drawing area", s1.x + 10, s1.y + 18);

  if (isDeadMode()) {
    label = "Dead reckoning preview (same drawing coordinates)";
  }

  ctx.fillStyle = "#6c6f73";
  ctx.font = `${12 * (window.devicePixelRatio || 1)}px system-ui`;
  ctx.fillText(label, p1.x + 10, p1.y + 18);
  ctx.restore();
}

function drawStroke(points, color, width, dash = null) {
  if (!points || points.length < 2) return;
  ctx.save();
  ctx.lineWidth = width * (window.devicePixelRatio || 1);
  ctx.strokeStyle = color;
  if (dash) ctx.setLineDash(dash.map((value) => value * (window.devicePixelRatio || 1)));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const first = matToCanvas(points[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i += 1) {
    const point = matToCanvas(points[i]);
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawCommands(commands) {
  const downSegments = [];
  const upSegments = [];
  const events = [];
  let downPoints = [];
  let upPoints = [];
  let penDown = false;
  let lastPenPoint = null;
  for (const command of commands) {
    if (command.type === "pen") {
      const eventPoint = command.penX == null ? null : { x: command.penX, y: command.penY };
      if (eventPoint) {
        events.push({ ...eventPoint, state: command.state });
        lastPenPoint = eventPoint;
      }
      if (penDown && command.state === "up" && downPoints.length > 1) downSegments.push(downPoints);
      if (!penDown && command.state === "down" && upPoints.length > 1) upSegments.push(upPoints);
      if (command.state === "down") downPoints = eventPoint ? [eventPoint] : [];
      if (command.state === "up") upPoints = eventPoint ? [eventPoint] : [];
      penDown = command.state === "down";
    }
    if ((command.type === "move" || command.type === "motor") && command.penX != null) {
      const point = { x: command.penX, y: command.penY };
      if (penDown) {
        downPoints.push(point);
      } else {
        if (!upPoints.length && lastPenPoint) upPoints.push(lastPenPoint);
        upPoints.push(point);
      }
      lastPenPoint = point;
    }
  }
  if (penDown && downPoints.length > 1) downSegments.push(downPoints);
  if (!penDown && upPoints.length > 1) upSegments.push(upPoints);
  for (const segment of upSegments) drawStroke(segment, COLORS.penTravel, 1.25, [5, 5]);
  for (const segment of downSegments) drawStroke(segment, COLORS.penSimulation, 1.6);
  for (const event of events) drawPenEvent(event);
}

function drawCubePath(points) {
  if (!points.length) return;
  drawStroke(points, COLORS.cubePath, 1.4, [8, 7]);
  const stride = Math.max(1, Math.ceil(points.length / 18));
  for (let i = 0; i < points.length; i += stride) {
    drawCubePose(points[i], COLORS.cubeGhost, 0.36, false);
  }
  drawCubePose(points[0], COLORS.cubeStart, 0.95, true);
  drawCubeLabel(points[0], "START", COLORS.cubeStart, -1);
  drawCubePose(points[points.length - 1], COLORS.cubeEnd, 0.95, true);
  drawCubeLabel(points[points.length - 1], "END", COLORS.cubeEnd, 1);
}

function drawCubePose(pose, color, alpha = 1, filled = false) {
  const center = matToCanvas(pose);
  const size = 32 * 0.8 * getView().scale;
  const theta = degToRad(pose.theta || 0);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(theta);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
  if (filled) {
    ctx.globalAlpha = alpha * 0.16;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.globalAlpha = alpha;
  }
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size / 2, 0);
  ctx.stroke();
  ctx.restore();
}

function drawCubeLabel(pose, label, color, side = 1) {
  const dpr = window.devicePixelRatio || 1;
  const point = matToCanvas(pose);
  ctx.save();
  ctx.font = `bold ${10 * dpr}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const textWidth = ctx.measureText(label).width;
  const padX = 5 * dpr;
  const width = textWidth + padX * 2;
  const height = 16 * dpr;
  const y = point.y + side * 24 * dpr;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 * dpr;
  ctx.fillRect(point.x - width / 2, y - height / 2, width, height);
  ctx.strokeRect(point.x - width / 2, y - height / 2, width, height);
  ctx.fillStyle = color;
  ctx.fillText(label, point.x, y);
  ctx.restore();
}

function drawPenEvent(event) {
  const dpr = window.devicePixelRatio || 1;
  const point = matToCanvas(event);
  const isDown = event.state === "down";
  const radius = 5 * dpr;
  ctx.save();
  ctx.fillStyle = isDown ? COLORS.penDownEvent : COLORS.penUpEvent;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${10 * dpr}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(isDown ? "↓" : "↑", point.x, point.y - 0.5 * dpr);
  ctx.restore();
}

function drawLegend() {
  const dpr = window.devicePixelRatio || 1;
  const items = [
    ["描画線", COLORS.drawing, "solid"],
    ["pen down 描画", COLORS.penSimulation, "solid"],
    ["pen up 移動", COLORS.penTravel, "dash"],
    ["pen down/up", COLORS.penDownEvent, "event"],
    ["toio移動軌跡", COLORS.cubePath, "dash"],
    ["toio開始", COLORS.cubeStart, "box"],
    ["toio終了", COLORS.cubeEnd, "box"],
    ["実機toio", COLORS.liveCube, "box"],
  ];
  const x = els.canvas.width - 196 * dpr;
  const y = 50 * dpr;
  const lineH = 20 * dpr;
  const width = 178 * dpr;
  const height = (items.length * lineH + 12 * dpr);

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.strokeStyle = "#d8d3c8";
  ctx.lineWidth = 1 * dpr;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.font = `${11 * dpr}px system-ui`;
  ctx.textBaseline = "middle";

  items.forEach(([label, color, kind], index) => {
    const itemY = y + 12 * dpr + index * lineH;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2 * dpr;
    if (kind === "dash") ctx.setLineDash([6 * dpr, 5 * dpr]);
    if (kind === "event") {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x + 15 * dpr, itemY, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "box") {
      ctx.setLineDash([]);
      ctx.strokeRect(x + 10 * dpr, itemY - 5 * dpr, 10 * dpr, 10 * dpr);
    } else {
      ctx.beginPath();
      ctx.moveTo(x + 8 * dpr, itemY);
      ctx.lineTo(x + 24 * dpr, itemY);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = "#43464a";
    ctx.fillText(label, x + 32 * dpr, itemY);
  });
  ctx.restore();
}

function processStroke(raw) {
  return window.PlotterCore.processStroke(raw, config);
}

function createSimulation() {
  if (isDeadMode()) {
    return window.PlotterCore.createDeadReckoningSimulation({ strokes, config, segmentSettings: deadSegmentSettings });
  }
  return window.PlotterCore.createSimulation({ strokes, config });
}

function drawAnimationCursor(commands) {
  const point = latestPenPoint(commands);
  const pose = latestCubePose(commands, point);
  const penState = latestPenState(commands);
  if (pose) drawCubePose(pose, COLORS.liveCube, 1, true);
  if (!point) return;
  const dpr = window.devicePixelRatio || 1;
  const canvasPoint = matToCanvas(point);
  ctx.save();
  ctx.fillStyle = penState === "down" ? COLORS.penDownEvent : COLORS.penUpEvent;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.arc(canvasPoint.x, canvasPoint.y, 7 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawPenStateBadge(canvasPoint, penState);
  ctx.restore();
}

function drawPenStateBadge(canvasPoint, penState) {
  const dpr = window.devicePixelRatio || 1;
  const label = penState === "down" ? "DOWN" : "UP";
  ctx.font = `bold ${10 * dpr}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(label).width + 10 * dpr;
  const height = 16 * dpr;
  const x = canvasPoint.x;
  const y = canvasPoint.y - 18 * dpr;
  ctx.fillStyle = penState === "down" ? COLORS.penDownEvent : COLORS.penUpEvent;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5 * dpr;
  ctx.fillRect(x - width / 2, y - height / 2, width, height);
  ctx.strokeRect(x - width / 2, y - height / 2, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, x, y);
}

function latestPenPoint(commands) {
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const command = commands[i];
    if (command.penX != null) return { x: command.penX, y: command.penY };
  }
  return null;
}

function latestCubePose(commands, point) {
  const poseCommand = latestPoseCommand(commands);
  if (!poseCommand) return null;
  if (poseCommand.x != null && poseCommand.y != null) {
    return { x: poseCommand.x, y: poseCommand.y, theta: poseCommand.theta || 0 };
  }
  if (!point) return null;
  return { ...window.PlotterCore.penToCube(point, poseCommand.theta || 0, config), theta: poseCommand.theta || 0 };
}

function latestPenState(commands) {
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const command = commands[i];
    if (command.type === "pen") return command.state;
  }
  return "up";
}

function latestPoseCommand(commands) {
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const command = commands[i];
    if ((command.type === "move" || command.type === "rotate" || command.type === "motor" || command.type === "turn") && command.theta != null) {
      return command;
    }
  }
  return null;
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

function rotatePoint(point, angleDeg) {
  const angle = degToRad(angleDeg);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
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
  activeSimulationCommandIndex = -1;
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
  if (!simulation?.commands?.length) return;
  for (const [index, command] of simulation.commands.entries()) {
    const key = commandOverrideKey(command, index, simulation.commands);
    if (!key) continue;
    const override = commandOverrideFromCommand(command);
    if (override) commandOverrides.set(key, override);
  }
}

function applyCommandOverrides() {
  if (!simulation?.commands?.length || !commandOverrides.size) return;
  for (const [index, command] of simulation.commands.entries()) {
    const key = commandOverrideKey(command, index, simulation.commands);
    const override = key ? commandOverrides.get(key) : null;
    if (!override) continue;
    if (command.type === "motor") {
      ensureMotorBaseline(command);
      if (override.speed != null) command.speed = override.speed;
      if (override.durationMs != null) command.durationMs = override.durationMs;
      if (override.distanceScale != null) {
        command.distanceScale = override.distanceScale;
        command.durationMs = roundToMotorDurationMs(Math.max(10, command.baseMotion.durationMs * command.distanceScale));
      } else if (override.durationMs != null) {
        command.distanceScale = motorDistanceScale(command);
      }
      command.leftSpeed = command.speed;
      command.rightSpeed = command.speed;
      updateStraightMotorPose(command);
    } else if (command.type === "turn") {
      if (override.leftSpeed != null) command.leftSpeed = override.leftSpeed;
      if (override.rightSpeed != null) command.rightSpeed = override.rightSpeed;
      if (override.durationMs != null) command.durationMs = override.durationMs;
      command.manualWheelSpeeds = true;
      updateManualTurnPose(command, index);
    }
  }
}

function commandOverrideFromCommand(command) {
  if (command.type === "motor" && command.baseMotion) {
    return {
      speed: command.speed,
      durationMs: command.durationMs,
      distanceScale: command.distanceScale,
    };
  }
  if (command.type === "turn" && command.manualWheelSpeeds) {
    return {
      leftSpeed: command.leftSpeed,
      rightSpeed: command.rightSpeed,
      durationMs: command.durationMs,
    };
  }
  return null;
}

function commandOverrideKey(command, index, commands) {
  if (!command || (command.type !== "motor" && command.type !== "turn")) return null;
  const role = command.role || "";
  const segmentId = command.segmentId || "";
  const kind = command.kind || "";
  const occurrence = commands
    .slice(0, index + 1)
    .filter((item) => item.type === command.type && (item.role || "") === role && (item.segmentId || "") === segmentId && (item.kind || "") === kind)
    .length;
  return [command.type, kind, role, segmentId, occurrence].join("|");
}

function startSimulationAnimation() {
  const timeline = buildSimulationTimeline(simulation.commands);
  simulationAnimation = {
    startedAt: performance.now(),
    elapsedMs: 0,
    durationMs: Math.max(600, timeline.durationMs),
    timeline,
    playing: true,
    frameId: null,
  };
  const tick = () => {
    if (!simulationAnimation) return;
    const elapsed = getSimulationElapsedMs();
    if (elapsed >= simulationAnimation.durationMs) {
      activeSimulationCommandIndex = lastPlayableCommandIndex(simulationAnimation.timeline);
      simulationAnimation = null;
      syncSimulationControls();
      updateActiveCommandRow();
      draw();
      return;
    }
    activeSimulationCommandIndex = activeCommandIndexAtElapsed(simulationAnimation.timeline, elapsed);
    updateActiveCommandRow();
    draw();
    if (simulationAnimation?.playing) simulationAnimation.frameId = requestAnimationFrame(tick);
  };
  simulationAnimation.frameId = requestAnimationFrame(tick);
  syncSimulationControls();
}

function stopSimulationAnimation() {
  if (simulationAnimation?.frameId) cancelAnimationFrame(simulationAnimation.frameId);
  simulationAnimation = null;
  activeSimulationCommandIndex = -1;
  syncSimulationControls();
  updateActiveCommandRow();
}

function getSimulationElapsedMs() {
  if (!simulationAnimation) return Infinity;
  return simulationAnimation.playing ? performance.now() - simulationAnimation.startedAt : simulationAnimation.elapsedMs;
}

function toggleSimulationPause() {
  if (!simulationAnimation) return;
  if (simulationAnimation.playing) {
    simulationAnimation.elapsedMs = getSimulationElapsedMs();
    simulationAnimation.playing = false;
    if (simulationAnimation.frameId) cancelAnimationFrame(simulationAnimation.frameId);
    simulationAnimation.frameId = null;
  } else {
    simulationAnimation.playing = true;
    simulationAnimation.startedAt = performance.now() - simulationAnimation.elapsedMs;
    const tick = () => {
      if (!simulationAnimation) return;
      const elapsed = getSimulationElapsedMs();
      if (elapsed >= simulationAnimation.durationMs) {
        activeSimulationCommandIndex = lastPlayableCommandIndex(simulationAnimation.timeline);
        simulationAnimation = null;
        syncSimulationControls();
        updateActiveCommandRow();
        draw();
        return;
      }
      activeSimulationCommandIndex = activeCommandIndexAtElapsed(simulationAnimation.timeline, elapsed);
      updateActiveCommandRow();
      draw();
      if (simulationAnimation?.playing) simulationAnimation.frameId = requestAnimationFrame(tick);
    };
    simulationAnimation.frameId = requestAnimationFrame(tick);
  }
  syncSimulationControls();
  draw();
}

function stepSimulation(delta) {
  if (!simulationValid || !simulation?.commands?.length) return;
  if (!simulationAnimation) {
    const timeline = buildSimulationTimeline(simulation.commands);
    if (!timeline.items.length) return;
    simulationAnimation = {
      startedAt: performance.now(),
      elapsedMs: 0,
      durationMs: Math.max(600, timeline.durationMs),
      timeline,
      playing: false,
      frameId: null,
    };
  }
  if (simulationAnimation.frameId) cancelAnimationFrame(simulationAnimation.frameId);
  const current = activeSimulationCommandIndex < 0 ? -1 : activeSimulationCommandIndex;
  const currentItemIndex = simulationAnimation.timeline.items.findIndex((item) => item.commandIndex === current);
  const nextItemIndex = clamp((currentItemIndex < 0 ? -1 : currentItemIndex) + delta, 0, simulationAnimation.timeline.items.length - 1);
  const item = simulationAnimation.timeline.items[nextItemIndex];
  if (!item) return;
  simulationAnimation.elapsedMs = item.startMs + Math.min(1, Math.max(0, item.endMs - item.startMs) / 2);
  simulationAnimation.startedAt = performance.now() - simulationAnimation.elapsedMs;
  simulationAnimation.playing = false;
  simulationAnimation.frameId = null;
  activeSimulationCommandIndex = item.commandIndex;
  syncSimulationControls();
  updateActiveCommandRow();
  draw();
}

function syncSimulationControls() {
  const enabled = Boolean(simulationValid && simulation?.commands?.length);
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
  if (!simulationAnimation) return simulation?.commands || [];
  const elapsed = getSimulationElapsedMs();
  return commandsAtElapsed(simulationAnimation.timeline, elapsed);
}

function buildSimulationTimeline(commands) {
  const items = [];
  let cursorMs = 0;
  let lastPenPoint = null;
  let lastTheta = null;
  let lastCubePose = null;
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const durationMs = commandDurationMs(command, lastPenPoint);
    const fromTheta = command.type === "turn" && lastTheta == null && command.angle != null ? command.theta - command.angle : lastTheta;
    if (isPlayableMoveCommand(command)) {
      items.push({ command, commandIndex: index, startMs: cursorMs, endMs: cursorMs + durationMs, from: lastPenPoint, fromTheta, fromCubePose: lastCubePose });
      cursorMs += durationMs;
    }
    if (command.theta != null) lastTheta = command.theta;
    if (command.x != null && command.y != null && command.theta != null) {
      lastCubePose = { x: command.x, y: command.y, theta: command.theta };
    }
    if ((command.type === "move" || command.type === "motor") && command.penX != null) {
      lastPenPoint = { x: command.penX, y: command.penY };
    }
    if (command.type === "pen" && command.penX != null) {
      lastPenPoint = { x: command.penX, y: command.penY };
    }
  }
  return { items, durationMs: cursorMs };
}

function isPlayableMoveCommand(command) {
  return command.type === "move" || command.type === "rotate" || command.type === "motor" || command.type === "turn";
}

function commandDurationMs(command, lastPenPoint) {
  if (command.type === "wait") return command.ms;
  if (command.type === "turn") return Math.max(MIN_TURN_DURATION_MS, command.durationMs || 0);
  if (command.type === "motor") return Math.max(80, command.durationMs || 0);
  if ((command.type === "move" || command.type === "rotate") && command.durationMs) return Math.max(80, command.durationMs);
  if (command.type === "move" && command.penX != null && lastPenPoint) {
    return clamp(distance(lastPenPoint, { x: command.penX, y: command.penY }) * 12, 160, 1200);
  }
  if (command.type === "rotate") return 220;
  return 80;
}

function activeCommandIndexAtElapsed(timeline, elapsedMs) {
  if (!timeline.items.length) return -1;
  const item = timeline.items.find((entry) => elapsedMs >= entry.startMs && elapsedMs < entry.endMs);
  if (item) return item.commandIndex;
  return elapsedMs >= timeline.durationMs ? lastPlayableCommandIndex(timeline) : timeline.items[0].commandIndex;
}

function lastPlayableCommandIndex(timeline) {
  return timeline.items[timeline.items.length - 1]?.commandIndex ?? -1;
}

function commandsAtElapsed(timeline, elapsedMs) {
  if (!timeline.items.length) return simulation?.commands || [];
  for (const item of timeline.items) {
    if (elapsedMs >= item.endMs) {
      continue;
    }
    const endIndex = elapsedMs < item.startMs ? item.commandIndex : item.commandIndex + 1;
    const result = simulation.commands.slice(0, endIndex);
    if (elapsedMs >= item.startMs) result[result.length - 1] = partialCommand(item, elapsedMs);
    return result.filter(Boolean);
  }
  return simulation.commands;
}

function partialCommand(item, elapsedMs) {
  const command = item.command;
  if (command.type === "turn" && command.theta != null && item.fromTheta != null) {
    const span = Math.max(1, item.endMs - item.startMs);
    const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
    const theta = item.fromTheta + window.PlotterCore.signedAngleDelta(item.fromTheta, command.theta) * t;
    const penPoint = command.x != null && command.y != null ? cubeToPen({ x: command.x, y: command.y }, theta, config) : null;
    return {
      ...command,
      theta,
      penX: penPoint ? penPoint.x : command.penX,
      penY: penPoint ? penPoint.y : command.penY,
    };
  }
  if (command.type === "motor" && command.x != null && command.y != null && item.fromCubePose) {
    const span = Math.max(1, item.endMs - item.startMs);
    const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
    const fromCube = {
      x: command.fromX ?? item.fromCubePose.x,
      y: command.fromY ?? item.fromCubePose.y,
      theta: item.fromCubePose.theta,
    };
    const cubePoint = {
      x: fromCube.x + (command.x - fromCube.x) * t,
      y: fromCube.y + (command.y - fromCube.y) * t,
    };
    const theta = command.theta ?? fromCube.theta;
    const penPoint = cubeToPen(cubePoint, theta, config);
    return { ...command, x: cubePoint.x, y: cubePoint.y, theta, penX: penPoint.x, penY: penPoint.y };
  }
  if (command.type === "motor" && command.x != null && command.y != null && command.fromX != null && command.fromY != null) {
    const span = Math.max(1, item.endMs - item.startMs);
    const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
    const cubePoint = {
      x: command.fromX + (command.x - command.fromX) * t,
      y: command.fromY + (command.y - command.fromY) * t,
    };
    const theta = command.theta || 0;
    const penPoint = cubeToPen(cubePoint, theta, config);
    return { ...command, x: cubePoint.x, y: cubePoint.y, theta, penX: penPoint.x, penY: penPoint.y };
  }
  if ((command.type !== "move" && command.type !== "motor") || command.penX == null || !item.from) return command;
  const span = Math.max(1, item.endMs - item.startMs);
  const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
  return {
    ...command,
    penX: item.from.x + (command.penX - item.from.x) * t,
    penY: item.from.y + (command.penY - item.from.y) * t,
  };
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
  const title = segment.kind === "draw" ? "draw straight" : "travel straight";
  const distanceControl =
    segment.kind === "travel" ? segmentInputTemplate(segment.id, "distanceScale", "distance", segment.distanceScale, 0.05) : "";
  els.deadSegmentsEditor.innerHTML = `
    <div class="segment-card">
      <div class="segment-title">#${index} ${title}</div>
      <div class="segment-meta">長さ ${segment.lengthMm.toFixed(1)}mm / 角度 ${segment.heading.toFixed(0)}° / start (${segment.start.x.toFixed(1)}, ${segment.start.y.toFixed(1)}) → end (${segment.end.x.toFixed(1)}, ${segment.end.y.toFixed(1)})</div>
      <div class="segment-meta">直進</div>
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
  if (!els.toioCommandOutput) return;
  if (!simulationValid || !simulation) {
    els.toioCommandOutput.textContent = "シミュレーション後に表示されます。";
    return;
  }
  els.toioCommandOutput.textContent = isDeadMode() ? formatDeadToioCommands(simulation.commands) : formatPositionToioCommands(simulation.commands);
}

function formatDeadToioCommands(commands) {
  const lines = [];
  let index = 1;
  for (const command of commands) {
    const formatted = formatDeadToioCommand(command);
    if (!formatted) continue;
    lines.push(`${String(index).padStart(2, "0")}. ${formatted}`);
    index += 1;
  }
  return lines.join("\n") || "toioコマンドはありません。";
}

function formatDeadToioCommand(command) {
  if (command.type === "pen") {
    if (command.state === "up") return `昇降用: UP 速度:${config.upMotorSpeed}, ${formatSeconds(config.upDurationMs)}`;
    return `昇降用: DOWN 速度:${config.downMotorSpeed}, ${formatSeconds(config.downDurationMs)}`;
  }
  if (command.type === "turn") {
    const speeds = turnWheelSpeeds(command);
    return `移動用: 回転 ${formatAngle(command.angle)} / 右:${speeds.right}, 左:${speeds.left}, ${formatSeconds(command.durationMs)}`;
  }
  if (command.type === "motor") {
    const label = command.kind === "draw" ? "描画直進" : "移動直進";
    return `移動用: ${label} / 右:${Math.round(command.rightSpeed)}, 左:${Math.round(command.leftSpeed)}, ${formatSeconds(command.durationMs)}`;
  }
  if (command.type === "wait") return `待機: ${formatSeconds(command.ms)}`;
  return null;
}

function formatPositionToioCommands(commands) {
  const lines = [];
  let index = 1;
  for (const command of commands) {
    const formatted = formatPositionToioCommand(command);
    if (!formatted) continue;
    lines.push(`${String(index).padStart(2, "0")}. ${formatted}`);
    index += 1;
  }
  return lines.join("\n") || "toioコマンドはありません。";
}

function formatPositionToioCommand(command) {
  if (command.type === "pen") {
    if (command.state === "up") return `昇降用: UP 速度:${config.upMotorSpeed}, ${formatSeconds(config.upDurationMs)}`;
    return `昇降用: DOWN 速度:${config.downMotorSpeed}, ${formatSeconds(config.downDurationMs)}`;
  }
  if (command.type === "move" || command.type === "rotate") {
    return `移動用: ${command.type} x:${command.x.toFixed(1)}, y:${command.y.toFixed(1)}, θ:${command.theta.toFixed(0)}, speed:${command.speed}`;
  }
  if (command.type === "wait") return `待機: ${formatSeconds(command.ms)}`;
  return null;
}

function turnWheelSpeeds(command) {
  const direction = command.angle >= 0 ? 1 : -1;
  const base = Math.abs(config.deadTurnSpeed);
  const trim = config.deadTurnBalanceTrim;
  return {
    left: Math.round(direction * clamp(base + trim, 0, 255)),
    right: Math.round(-direction * clamp(base - trim, 0, 255)),
  };
}

function formatSeconds(ms) {
  return `${(Math.max(0, ms || 0) / 1000).toFixed(2).replace(/\.00$/, "")}s`;
}

function formatAngle(angle) {
  return `${angle >= 0 ? "+" : ""}${Number(angle || 0).toFixed(0)}°`;
}

function renderToioCommandOutput() {
  if (!els.toioCommandOutput) return;
  if (!simulationValid || !simulation) {
    els.toioCommandOutput.textContent = "Simulate after drawing to show commands.";
    syncSimulationControls();
    return;
  }
  els.toioCommandOutput.innerHTML = simulation.commands.map((command, index) => commandRowTemplate(command, index)).filter(Boolean).join("");
  syncSimulationControls();
  updateActiveCommandRow();
}

function commandRowTemplate(command, index) {
  const label = isDeadMode() ? formatDeadToioCommand(command) : formatPositionToioCommand(command);
  if (!label) return "";
  return `
    <div class="command-row" data-command-index="${index}">
      <button class="command-step-button" type="button" data-command-step="${index}">${String(index + 1).padStart(2, "0")}</button>
      <div class="command-main">
        <div class="command-label">${escapeHtml(label)}</div>
        ${commandControlsTemplate(command, index)}
      </div>
    </div>
  `;
}

function commandControlsTemplate(command, index) {
  if (command.type === "pen") {
    return "";
  }
  if (command.type === "move" || command.type === "rotate") {
    return `
      <div class="command-fields">
        ${commandInputTemplate(index, "speed", "speed", command.speed, 1, 10, 255)}
        ${commandInputTemplate(index, "durationMs", "sim ms", displayCommandDurationMs(index), 10, 80, 10000)}
      </div>
    `;
  }
  if (command.type === "motor") {
    const distanceInput =
      command.kind === "travel" ? commandInputTemplate(index, "distanceScale", "distance", motorDistanceScale(command), 0.05, 0.1, 2) : "";
    return `
      <div class="command-fields">
        ${commandInputTemplate(index, "speed", "speed", motorStraightSpeed(command), 1, -255, 255)}
        ${commandInputTemplate(index, "durationMs", "ms", command.durationMs || 10, 10, 10, 2550)}
        ${distanceInput}
      </div>
    `;
  }
  if (command.type === "turn") {
    const speeds = turnWheelSpeeds(command);
    return `
      <div class="command-fields">
        ${commandInputTemplate(index, "leftSpeed", "L", speeds.left, 1, -255, 255)}
        ${commandInputTemplate(index, "rightSpeed", "R", speeds.right, 1, -255, 255)}
        ${commandInputTemplate(index, "durationMs", "ms", command.durationMs || 0, 10, 0, 2550)}
      </div>
    `;
  }
  if (command.type === "wait") {
    return `<div class="command-fields">${commandInputTemplate(index, "ms", "ms", command.ms, 10, 0, 10000)}</div>`;
  }
  return "";
}

function motorStraightSpeed(command) {
  if (command.speed != null) return command.speed;
  return Math.round(((command.leftSpeed || 0) + (command.rightSpeed || 0)) / 2);
}

function motorDistanceScale(command) {
  if (command.distanceScale != null) return command.distanceScale;
  if (command.baseMotion?.durationMs) return (command.durationMs || 0) / Math.max(1, command.baseMotion.durationMs);
  return 1;
}

function displayCommandDurationMs(index) {
  const command = simulation?.commands?.[index];
  if (!command) return 0;
  if (command.durationMs != null) return command.durationMs;
  let lastPenPoint = null;
  for (let i = 0; i < index; i += 1) {
    const previous = simulation.commands[i];
    if ((previous.type === "move" || previous.type === "motor") && previous.penX != null) {
      lastPenPoint = { x: previous.penX, y: previous.penY };
    }
    if (previous.type === "pen" && previous.penX != null) {
      lastPenPoint = { x: previous.penX, y: previous.penY };
    }
  }
  return commandDurationMs(command, lastPenPoint);
}

function commandInputTemplate(index, key, label, value, step, min, max) {
  const rounded = Number(value || 0).toFixed(step < 1 ? 2 : 0);
  return `<label>${label}<input data-command-index="${index}" data-command-key="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${rounded}" /></label>`;
}

function getPenCommandSpeed(command) {
  if (command.speed != null) return command.speed;
  return command.state === "up" ? config.upMotorSpeed : config.downMotorSpeed;
}

function getPenCommandDuration(command) {
  if (command.durationMs != null) return command.durationMs;
  return command.state === "up" ? config.upDurationMs : config.downDurationMs;
}

function updateActiveCommandRow() {
  if (!els.toioCommandOutput?.querySelectorAll) return;
  for (const row of els.toioCommandOutput.querySelectorAll(".command-row")) {
    row.classList.toggle("active", Number(row.dataset.commandIndex) === activeSimulationCommandIndex);
  }
}

function updateCommandEdit(input, { render = true } = {}) {
  if (!simulation?.commands) return;
  const index = Number(input.dataset.commandIndex);
  const key = input.dataset.commandKey;
  const command = simulation.commands[index];
  if (!command || !key) return;
  if (input.value === "" || input.value === "-") return;
  if (command.type === "motor" && (key === "speed" || key === "durationMs" || key === "distanceScale")) {
    ensureMotorBaseline(command);
  }
  if (command.type === "turn" && (key === "leftSpeed" || key === "rightSpeed" || key === "durationMs") && !command.manualWheelSpeeds) {
    const speeds = turnWheelSpeeds(command);
    command.leftSpeed = speeds.left;
    command.rightSpeed = speeds.right;
  }
  let value = Number(input.value);
  if ((command.type === "turn" || command.type === "motor") && key === "durationMs") {
    const minMs = command.type === "turn" ? MIN_TURN_DURATION_MS : 10;
    value = roundToMotorDurationMs(Math.max(minMs, value));
  }
  if (command.type === "motor" && key === "distanceScale") {
    value = clamp(value, 0.1, 2);
    command.durationMs = roundToMotorDurationMs(Math.max(10, command.baseMotion.durationMs * value));
  }
  command[key] = value;
  if (command.type === "motor" && (key === "speed" || key === "durationMs" || key === "distanceScale")) {
    if (key !== "distanceScale") command.distanceScale = motorDistanceScale(command);
    command.leftSpeed = command.speed;
    command.rightSpeed = command.speed;
    updateStraightMotorPose(command);
  }
  if (command.type === "turn" && (key === "leftSpeed" || key === "rightSpeed" || key === "durationMs")) {
    command.manualWheelSpeeds = true;
    updateManualTurnPose(command, index);
  }
  const overrideKey = commandOverrideKey(command, index, simulation.commands);
  const override = commandOverrideFromCommand(command);
  if (overrideKey && override) commandOverrides.set(overrideKey, override);
  if (simulationAnimation?.frameId) cancelAnimationFrame(simulationAnimation.frameId);
  const timeline = buildSimulationTimeline(simulation.commands);
  const item = timelineItemForCommand(timeline, index);
  simulationAnimation = {
    startedAt: performance.now(),
    elapsedMs: item?.startMs || 0,
    durationMs: Math.max(600, timeline.durationMs),
    timeline,
    playing: false,
    frameId: null,
  };
  activeSimulationCommandIndex = index;
  if (render) {
    renderToioCommandOutput();
  } else {
    syncSimulationControls();
    updateActiveCommandRow();
  }
  draw();
}

function ensureMotorBaseline(command) {
  if (command.baseMotion) return;
  command.speed = motorStraightSpeed(command);
  command.baseMotion = {
    speed: command.speed || 1,
    durationMs: command.durationMs || 1,
    fromX: command.fromX,
    fromY: command.fromY,
    x: command.x,
    y: command.y,
    theta: command.theta,
  };
}

function updateStraightMotorPose(command) {
  const base = command.baseMotion;
  if (!base || base.fromX == null || base.fromY == null || base.x == null || base.y == null) return;
  const speedScale = (command.speed || 0) / (Math.abs(base.speed || 1) < 1 ? 1 : base.speed);
  const durationScale = (command.durationMs || 0) / Math.max(1, base.durationMs || 1);
  const scale = speedScale * durationScale;
  command.leftSpeed = command.speed;
  command.rightSpeed = command.speed;
  command.fromX = base.fromX;
  command.fromY = base.fromY;
  command.x = base.fromX + (base.x - base.fromX) * scale;
  command.y = base.fromY + (base.y - base.fromY) * scale;
  command.theta = base.theta;
  const penPoint = cubeToPen({ x: command.x, y: command.y }, command.theta || 0, config);
  command.penX = penPoint.x;
  command.penY = penPoint.y;
}

function updateManualTurnPose(command, index) {
  const fromTheta = turnStartThetaAtCommand(index, command);
  const angle = manualTurnAngle(command);
  command.angle = angle;
  command.theta = normalizeDegrees(fromTheta + angle);
  const penPoint = command.x != null && command.y != null ? cubeToPen({ x: command.x, y: command.y }, command.theta, config) : null;
  if (penPoint) {
    command.penX = penPoint.x;
    command.penY = penPoint.y;
  }
}

function turnStartThetaAtCommand(index, command) {
  let lastTheta = null;
  for (let i = 0; i < index; i += 1) {
    const previous = simulation.commands[i];
    if (previous.theta != null) lastTheta = previous.theta;
  }
  if (lastTheta != null) return lastTheta;
  return command.theta - (command.angle || 0);
}

function manualTurnAngle(command) {
  const speeds = turnWheelSpeeds(command);
  const direction = speeds.left - speeds.right >= 0 ? 1 : -1;
  const speedRatio = Math.abs((speeds.left - speeds.right) / 2) / Math.max(1, Math.abs(config.deadTurnSpeed));
  const angularSpeedDegPerSec = (90 / (turnMsPer90() / 1000)) * speedRatio * direction;
  return angularSpeedDegPerSec * ((command.durationMs || 0) / 1000);
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function jumpToCommand(index) {
  if (!simulationValid || !simulation?.commands?.length) return;
  if (simulationAnimation?.frameId) cancelAnimationFrame(simulationAnimation.frameId);
  const timeline = buildSimulationTimeline(simulation.commands);
  const item = timelineItemForCommand(timeline, index);
  if (!item) return;
  simulationAnimation = {
    startedAt: performance.now(),
    elapsedMs: item.startMs,
    durationMs: Math.max(600, timeline.durationMs),
    timeline,
    playing: false,
    frameId: null,
  };
  activeSimulationCommandIndex = index;
  syncSimulationControls();
  updateActiveCommandRow();
  draw();
}

function timelineItemForCommand(timeline, commandIndex) {
  return timeline.items.find((item) => item.commandIndex === commandIndex) || null;
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
    const label = command.kind === "draw" ? "draw straight" : "travel straight";
    return `move: ${label} / speed:${motorStraightSpeed(command)}, ${formatSeconds(command.durationMs)}`;
  }
  if (command.type === "wait") return `wait: ${formatSeconds(command.ms)}`;
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
  if (command.type === "wait") return `wait: ${formatSeconds(command.ms)}`;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  saveTurnCalibrationLog();
}

function finalizeTurnCalibrationInput() {
  renderTurnCalibration();
}

function clearTurnCalibrationLog() {
  turnCalibrationLog = {};
  localStorage.removeItem("toioPlotterTurnCalibrationLog");
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
  if (!isDeadMode() || !simulationValid || !simulation) return null;
  const rect = els.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const point = {
    x: (event.clientX - rect.left) * dpr,
    y: (event.clientY - rect.top) * dpr,
  };
  const threshold = 10 * dpr;
  let best = null;
  for (const segment of getDeadSegments()) {
    const start = matToCanvas(segment.start);
    const end = matToCanvas(segment.end);
    const d = distanceToCanvasSegment(point, start, end);
    if (d <= threshold && (!best || d < best.distance)) best = { segment, distance: d };
  }
  return best?.segment || null;
}

function distanceToCanvasSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1);
  const closest = { x: start.x + dx * t, y: start.y + dy * t };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function updateDeadSegmentSetting(input) {
  const segmentId = input.dataset.segmentId;
  const key = input.dataset.segmentKey;
  if (!segmentId || !key) return;
  deadSegmentSettings[segmentId] = { ...(deadSegmentSettings[segmentId] || {}), [key]: Number(input.value) };
  saveDeadSegmentSettings();
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
  if (!simulationValid || !simulation) {
    log("先にシミュレーションを成功させてください。");
    return;
  }
  if (isDeadMode()) {
    await runDeadReckoningToio();
    return;
  }
  if (!moveCube || !penCube) {
    log("移動用と昇降用の toio を接続してください。");
    return;
  }
  if (!hasFreshMovePose(POSITION_FRESH_MS)) {
    log("移動用 toio の Position ID が未取得です。プレイマット上に置き、赤い実機toio表示が出てから実行してください。");
    setPill(els.runStatus, "Position ID 未取得", "error");
    return;
  }
  running = true;
  abortRun = false;
  els.runBtn.disabled = true;
  setPill(els.runStatus, "実行中", "warn");

  try {
    for (const command of simulation.commands) {
      if (abortRun) throw new Error("Emergency stop");
      if (command.type === "pen") {
        if (command.state === "down") {
          await ensureFreshPositionOrRetry("pen down 前");
        }
        await setPen(command.state, command);
        await ensureFreshPositionAfterPen(command.state, Date.now());
      } else if (command.type === "move" || command.type === "rotate") {
        const nativePoint = matToNativePoint(command);
        if (!pointInBounds(nativePoint, MAT)) {
          throw new Error(`toio 目標座標がマット外です: x=${nativePoint.x.toFixed(1)} y=${nativePoint.y.toFixed(1)}`);
        }
        await runMoveCommandWithPositionRetry(command, nativePoint);
      } else if (command.type === "wait") {
        await sleep(command.ms);
      }
    }
    setPill(els.runStatus, "完了", "ok");
    log("実機実行が完了しました。");
  } catch (error) {
    setPill(els.runStatus, "停止", "error");
    log(`実機実行を停止しました: ${error.message}`);
    await emergencyStop();
  } finally {
    running = false;
    syncRunButton();
  }
}

async function setPen(state, command = null) {
  if (!penCube) throw new Error("ペン昇降用 toio が未接続です。");
  const speed = command ? getPenCommandSpeed(command) : state === "up" ? config.upMotorSpeed : config.downMotorSpeed;
  const durationMs = command ? getPenCommandDuration(command) : state === "up" ? config.upDurationMs : config.downDurationMs;
  if (state === "up") {
    await penCube.timedMotor(speed, durationMs, config.penMotorMode);
  } else {
    await penCube.timedMotor(speed, durationMs, config.penMotorMode);
  }
  await sleep(config.settleMs);
}

async function runMoveCommandWithPositionRetry(command, nativePoint) {
  for (let attempt = 0; attempt <= POSITION_TARGET_RETRY_COUNT; attempt += 1) {
    if (attempt > 0) log(`Position ID retry: ${attempt}/${POSITION_TARGET_RETRY_COUNT}`);
    log(
      `toio ${command.type}: x=${nativePoint.x.toFixed(1)} y=${nativePoint.y.toFixed(1)} ` +
        `θ=${command.theta.toFixed(0)} speed=${command.speed}`,
    );
    try {
      await moveCube.moveTo(nativePoint.x, nativePoint.y, command.theta, command.speed, config.targetTimeout);
      return;
    } catch (error) {
      if (attempt >= POSITION_TARGET_RETRY_COUNT || !isPositionRetryableError(error)) throw error;
      log(`Position ID retry: ${error.message}`);
      await recoverPositionForRetry();
    }
  }
}

async function ensureFreshPositionOrRetry(context) {
  if (hasFreshMovePose(POSITION_RUN_TIMEOUT_MS)) return;
  log(`Position ID retry: ${context}にPosition IDを見失いました。ペンを上げて停止します。`);
  await recoverPositionForRetry();
}

async function ensureFreshPositionAfterPen(state, sinceMs) {
  const recovered = await waitForFreshMovePoseAfter(sinceMs, POSITION_RUN_TIMEOUT_MS);
  if (recovered) return;
  log(`Position ID retry: pen ${state} aftershock, waiting for stable Position ID.`);
  await recoverPositionForRetry();
}

async function recoverPositionForRetry() {
  await setPen("up");
  await moveCube?.stop();
  log("Position ID retry: 再取得を待っています...");
  const recovered = await waitForFreshMovePose(POSITION_RETRY_WAIT_MS);
  if (!recovered) throw new Error("移動用 toio の Position ID を再取得できませんでした。");
  log("Position ID retry: 再取得しました。");
}

async function waitForFreshMovePose(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    if (hasFreshMovePose(POSITION_FRESH_MS)) return true;
    await sleep(POSITION_RETRY_POLL_MS);
  }
  return false;
}

async function waitForFreshMovePoseAfter(sinceMs, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    if (lastMovePoseAt >= sinceMs && hasFreshMovePose(POSITION_FRESH_MS)) return true;
    await sleep(POSITION_RETRY_POLL_MS);
  }
  return false;
}

function isPositionRetryableError(error) {
  return String(error?.message || "").includes("0x02");
}

async function emergencyStop() {
  abortRun = true;
  await Promise.allSettled([moveCube?.stop(), penCube?.stop()]);
  setPill(els.runStatus, "停止", "error");
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
    commandOverrides: serializeCommandOverrides(),
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

function importDrawingPayload(payload, reason) {
  strokes = Array.isArray(payload.strokes) ? payload.strokes : [];
  deadSegmentSettings = payload.deadSegmentSettings && typeof payload.deadSegmentSettings === "object" ? payload.deadSegmentSettings : {};
  commandOverrides = loadCommandOverrides(payload.commandOverrides);
  selectedDeadSegmentId = null;
  saveDeadSegmentSettings();
  renderDeadSegmentsEditor();
  if (payload.config) {
    config = { ...config, ...payload.config };
    syncConfigToForm();
    saveConfig();
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
  const response = await fetch(src);
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
  activeStroke = { raw: [canvasToMat(event.clientX, event.clientY)] };
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
    activeStroke.processed = processStroke(activeStroke.raw);
    strokes.push(activeStroke);
    resetDeadSegmentSettings();
    simulation = null;
    invalidateSimulation("描画を変更しました");
  }
  activeStroke = null;
  draw();
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function turnAngle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const denom = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!denom) return 0;
  const dot = (ab.x * cb.x + ab.y * cb.y) / denom;
  const angle = (Math.acos(clamp(dot, -1, 1)) * 180) / Math.PI;
  return 180 - angle;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
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
  abortRun = true;
  if (running) {
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
  if (!moveCube || !penCube) {
    log("移動用と昇降用の toio を接続してください。");
    return;
  }
  log("Dead reckoning: ペン先を start 点に置き、toio 前方を最初の線分方向に合わせてから実行します。");

  running = true;
  abortRun = false;
  els.runBtn.disabled = true;
  setPill(els.runStatus, "Dead reckoning 実行中", "warn");

  try {
    for (const command of simulation.commands) {
      if (abortRun) throw new Error("Emergency stop");
      if (command.type === "pen") {
        await setPen(command.state, command);
      } else if (command.type === "turn") {
        await runDeadTurn(command);
      } else if (command.type === "motor") {
        await runDeadMotor(command);
      } else if (command.type === "wait") {
        await sleep(command.ms);
      }
    }
    setPill(els.runStatus, "完了", "ok");
    log("Dead reckoning 実行が完了しました。");
  } catch (error) {
    setPill(els.runStatus, "停止", "error");
    log(`Dead reckoning 実行を停止しました: ${error.message}`);
    await emergencyStop();
  } finally {
    running = false;
    syncRunButton();
  }
}

async function runDeadTurn(command) {
  if (!command.durationMs) return;
  const durationMs = deadTurnDurationMsForRun(command);
  const speeds = turnWheelSpeeds(command);
  const leftSpeed = speeds.left;
  const rightSpeed = speeds.right;
  log(`turn ${command.angle.toFixed(0)}°: L=${leftSpeed} R=${rightSpeed} ${durationMs}ms`);
  if (durationMs !== command.durationMs && !command.manualWheelSpeeds) {
    command.durationMs = durationMs;
    renderToioCommandOutput();
  }
  await moveCube.timedMotorPair(leftSpeed, rightSpeed, durationMs);
  await sleep(durationMs);
}

function deadTurnDurationMsForRun(command) {
  const durationMs = Math.max(MIN_TURN_DURATION_MS, command.durationMs || 0);
  if (command.manualWheelSpeeds) return durationMs;
  return plannedTurnDurationMs(command.angle || 0);
}

function plannedTurnDurationMs(angleDeg) {
  if (Math.abs(angleDeg) < 0.1) return 0;
  return roundToMotorDurationMs(Math.max(MIN_TURN_DURATION_MS, (Math.abs(angleDeg) / 90) * turnMsPer90()));
}

function roundToMotorDurationMs(durationMs) {
  return clamp(Math.round(durationMs / 10), 1, 255) * 10;
}

async function runDeadMotor(command) {
  const speed = command.speed != null ? command.speed : motorStraightSpeed(command);
  const leftSpeed = clamp(speed, -255, 255);
  const rightSpeed = clamp(speed, -255, 255);
  log(`${command.kind}: L=${leftSpeed} R=${rightSpeed} ${command.durationMs}ms`);
  await moveCube.timedMotorPair(leftSpeed, rightSpeed, command.durationMs);
  await sleep(command.durationMs);
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
  for (const input of Object.values(selectConfigInputs)) {
    input.addEventListener("change", readConfigFromForm);
  }
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
  resizeCanvasBackingStore();
  setPill(els.simStatus, "未シミュレーション", "warn");
  log("準備完了。フリーハンドで描画してください。");
}

init();
