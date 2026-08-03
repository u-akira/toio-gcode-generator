"use strict";

const { MAT, DEFAULT_CONFIG, nativeToMatPose, matToNativePoint } = window.PlotterCore;
const { ToioCube } = window.ToioBle;

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
  stopBtn: document.getElementById("stopBtn"),
  penUpBtn: document.getElementById("penUpBtn"),
  penDownBtn: document.getElementById("penDownBtn"),
  legendToggleBtn: document.getElementById("legendToggleBtn"),
  runMode: document.getElementById("runMode"),
  deadSegmentsEditor: document.getElementById("deadSegmentsEditor"),
  toioCommandOutput: document.getElementById("toioCommandOutput"),
  prevSegmentBtn: document.getElementById("prevSegmentBtn"),
  nextSegmentBtn: document.getElementById("nextSegmentBtn"),
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
  "deadMmPerSecAtDrawSpeed",
  "deadMmPerSecAtTravelSpeed",
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
let config = loadConfig();
let strokes = [];
let activeStroke = null;
let simulation = null;
let simulationValid = false;
let simulationAnimation = null;
let deadSegmentSettings = loadDeadSegmentSettings();
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
    if (!saved.configVersion && saved.penOffsetX === 0 && saved.penOffsetY === 48) {
      saved.penOffsetX = DEFAULT_CONFIG.penOffsetX;
      saved.penOffsetY = DEFAULT_CONFIG.penOffsetY;
    }
    if ((saved.configVersion || 0) < 3) {
      saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
      saved.downMotorSpeed = DEFAULT_CONFIG.downMotorSpeed;
      saved.penMotorMode = DEFAULT_CONFIG.penMotorMode;
    }
    if ((saved.configVersion || 0) < 4) {
      saved.travelSpeed = DEFAULT_CONFIG.travelSpeed;
      saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
      saved.downMotorSpeed = DEFAULT_CONFIG.downMotorSpeed;
    }
    if ((saved.configVersion || 0) < 5) {
      saved.drawSpeed = DEFAULT_CONFIG.drawSpeed;
      saved.travelSpeed = DEFAULT_CONFIG.travelSpeed;
    }
    if ((saved.configVersion || 0) < 6) {
      saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
    }
    if ((saved.configVersion || 0) < 7) {
      saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
    }
    if ((saved.configVersion || 0) < 8) {
      saved.runMode = DEFAULT_CONFIG.runMode;
      saved.deadTurnSpeed = DEFAULT_CONFIG.deadTurnSpeed;
      saved.deadTurnBalanceTrim = DEFAULT_CONFIG.deadTurnBalanceTrim;
      saved.deadMmPerSecAtDrawSpeed = DEFAULT_CONFIG.deadMmPerSecAtDrawSpeed;
      saved.deadMmPerSecAtTravelSpeed = DEFAULT_CONFIG.deadMmPerSecAtTravelSpeed;
    }
    return { ...DEFAULT_CONFIG, ...saved, configVersion: DEFAULT_CONFIG.configVersion };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  localStorage.setItem("toioPlotterConfig", JSON.stringify(config));
}

function loadDeadSegmentSettings() {
  try {
    return JSON.parse(localStorage.getItem("toioPlotterDeadSegmentSettings") || "{}");
  } catch {
    return {};
  }
}

function saveDeadSegmentSettings() {
  localStorage.setItem("toioPlotterDeadSegmentSettings", JSON.stringify(deadSegmentSettings));
}

function resetDeadSegmentSettings() {
  deadSegmentSettings = {};
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
}

function invalidateSimulation(reason) {
  simulationValid = false;
  stopSimulationAnimation();
  els.runBtn.disabled = true;
  setPill(els.simStatus, "未シミュレーション", "warn");
  renderToioCommandOutput();
  if (reason) log(reason);
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
  els.canvas.style.cursor = isDeadMode() && simulationValid && getDrawSegments().length ? "pointer" : "crosshair";
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
  const drawSegments = getDrawSegments();
  if (!isDeadMode() || !drawSegments.length) return;
  for (let index = 0; index < drawSegments.length; index += 1) {
    const segment = drawSegments[index];
    const selected = segment.id === selectedDeadSegmentId;
    drawSegmentHighlight(segment, index + 1, selected);
  }
}

function drawSegmentHighlight(segment, labelNumber, selected) {
  const dpr = window.devicePixelRatio || 1;
  const start = matToCanvas(segment.start);
  const end = matToCanvas(segment.end);
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = selected ? "#bd2f2f" : "rgba(37, 99, 235, 0.55)";
  ctx.lineWidth = (selected ? 5 : 2.5) * dpr;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const label = `#${labelNumber}`;
  ctx.font = `bold ${11 * dpr}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(label).width + 10 * dpr;
  const height = 17 * dpr;
  ctx.fillStyle = selected ? "#bd2f2f" : "#2563eb";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5 * dpr;
  ctx.fillRect(mid.x - width / 2, mid.y - height / 2, width, height);
  ctx.strokeRect(mid.x - width / 2, mid.y - height / 2, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, mid.x, mid.y);
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
  if (isDeadMode()) {
    label = "Dead reckoning preview (same drawing coordinates)";
  } else {
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
  simulation = createSimulation();
  if (!isDeadMode()) strokes = simulation.processedStrokes;
  if (!simulation.commands.length) {
    simulationValid = false;
    selectedDeadSegmentId = null;
    els.runBtn.disabled = true;
    setPill(els.simStatus, "線なし", "warn");
    log("描画線がありません。");
  } else if (simulation.errors.length) {
    simulationValid = false;
    selectedDeadSegmentId = null;
    els.runBtn.disabled = true;
    setPill(els.simStatus, "失敗", "error");
    log(`シミュレーション失敗:\n${simulation.errors.join("\n")}`);
  } else {
    simulationValid = true;
    els.runBtn.disabled = false;
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
  if (simulationValid && isDeadMode() && !getSelectedDrawSegment()) selectFirstDeadDrawSegment();
  renderDeadSegmentsEditor();
  renderToioCommandOutput();
  if (simulationValid) startSimulationAnimation();
  draw();
}

function startSimulationAnimation() {
  const timeline = buildSimulationTimeline(simulation.commands);
  simulationAnimation = {
    startedAt: performance.now(),
    durationMs: Math.max(600, timeline.durationMs),
    timeline,
    frameId: null,
  };
  const tick = () => {
    if (!simulationAnimation) return;
    const elapsed = performance.now() - simulationAnimation.startedAt;
    if (elapsed >= simulationAnimation.durationMs) {
      simulationAnimation = null;
      draw();
      return;
    }
    draw();
    if (simulationAnimation) simulationAnimation.frameId = requestAnimationFrame(tick);
  };
  simulationAnimation.frameId = requestAnimationFrame(tick);
}

function stopSimulationAnimation() {
  if (!simulationAnimation) return;
  if (simulationAnimation.frameId) cancelAnimationFrame(simulationAnimation.frameId);
  simulationAnimation = null;
}

function getAnimatedCommands() {
  if (!simulationAnimation) return simulation?.commands || [];
  const elapsed = performance.now() - simulationAnimation.startedAt;
  return commandsAtElapsed(simulationAnimation.timeline, elapsed);
}

function buildSimulationTimeline(commands) {
  const items = [];
  let cursorMs = 0;
  let lastPenPoint = null;
  let lastTheta = null;
  let lastCubePose = null;
  for (const command of commands) {
    const durationMs = commandDurationMs(command, lastPenPoint);
    const fromTheta = command.type === "turn" && lastTheta == null && command.angle != null ? command.theta - command.angle : lastTheta;
    items.push({ command, startMs: cursorMs, endMs: cursorMs + durationMs, from: lastPenPoint, fromTheta, fromCubePose: lastCubePose });
    cursorMs += durationMs;
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

function commandDurationMs(command, lastPenPoint) {
  if (command.type === "wait") return command.ms;
  if (command.type === "motor" || command.type === "turn") return Math.max(80, command.durationMs || 0);
  if (command.type === "move" && command.penX != null && lastPenPoint) {
    return clamp(distance(lastPenPoint, { x: command.penX, y: command.penY }) * 12, 160, 1200);
  }
  if (command.type === "rotate") return 220;
  return 80;
}

function commandsAtElapsed(timeline, elapsedMs) {
  const result = [];
  for (const item of timeline.items) {
    if (elapsedMs >= item.endMs) {
      result.push(item.command);
      continue;
    }
    if (elapsedMs < item.startMs) break;
    result.push(partialCommand(item, elapsedMs));
    break;
  }
  return result.filter(Boolean);
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
  const drawSegments = getDrawSegments();
  if (!drawSegments.length) {
    els.deadSegmentsEditor.innerHTML = `<div class="segment-empty">シミュレーション後、キャンバス上の描画線分を選択してください。</div>`;
    return;
  }
  const segment = getSelectedDrawSegment();
  if (!segment) {
    els.deadSegmentsEditor.innerHTML = `<div class="segment-empty">キャンバス上の描画線分を選択してください。</div>`;
    return;
  }
  const index = drawSegments.findIndex((item) => item.id === segment.id) + 1;
  els.deadSegmentsEditor.innerHTML = `
    <div class="segment-card">
      <div class="segment-title">#${index} 描画線分</div>
      <div class="segment-meta">長さ ${segment.lengthMm.toFixed(1)}mm / 角度 ${segment.heading.toFixed(0)}° / start (${segment.start.x.toFixed(1)}, ${segment.start.y.toFixed(1)}) → end (${segment.end.x.toFixed(1)}, ${segment.end.y.toFixed(1)})</div>
      <div class="segment-meta">直進</div>
      <div class="segment-fields">
        ${segmentInputTemplate(segment.id, "speed", "速度", segment.speed, 1)}
        ${segmentInputTemplate(segment.id, "durationScale", "時間倍率", segment.durationScale, 0.05)}
        ${segmentInputTemplate(segment.id, "steeringTrim", "直進補正", segment.steeringTrim, 1)}
      </div>
      <div class="segment-meta">描画前の向き合わせ</div>
      <div class="segment-fields">
        ${segmentInputTemplate(segment.id, "turnDurationScale", "回転倍率", segment.turnDurationScale, 0.05)}
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

function segmentInputTemplate(segmentId, key, label, value, step) {
  return `<label>${label}<input data-segment-id="${segmentId}" data-segment-key="${key}" type="number" step="${step}" value="${Number(value).toFixed(step < 1 ? 2 : 0)}" /></label>`;
}

function getDrawSegments() {
  return simulation?.segments?.filter((segment) => segment.kind === "draw") || [];
}

function getSelectedDrawSegment() {
  return getDrawSegments().find((segment) => segment.id === selectedDeadSegmentId) || null;
}

function selectDeadSegment(segmentId) {
  selectedDeadSegmentId = segmentId;
  renderDeadSegmentsEditor();
  draw();
}

function selectFirstDeadDrawSegment() {
  const [first] = getDrawSegments();
  selectedDeadSegmentId = first?.id || null;
}

function selectAdjacentDrawSegment(delta) {
  const drawSegments = getDrawSegments();
  if (!drawSegments.length) return;
  const currentIndex = Math.max(0, drawSegments.findIndex((segment) => segment.id === selectedDeadSegmentId));
  const nextIndex = clamp(currentIndex + delta, 0, drawSegments.length - 1);
  selectDeadSegment(drawSegments[nextIndex].id);
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
  for (const segment of getDrawSegments()) {
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
  if (!getSelectedDrawSegment()) selectFirstDeadDrawSegment();
  const hasErrors = simulation.errors.length > 0;
  simulationValid = !hasErrors && simulation.commands.length > 0;
  els.runBtn.disabled = !simulationValid;
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
        await setPen(command.state);
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
    els.runBtn.disabled = !simulationValid;
  }
}

async function setPen(state) {
  if (!penCube) throw new Error("ペン昇降用 toio が未接続です。");
  if (state === "up") {
    await penCube.timedMotor(config.upMotorSpeed, config.upDurationMs, config.penMotorMode);
  } else {
    await penCube.timedMotor(config.downMotorSpeed, config.downDurationMs, config.penMotorMode);
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
  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    mat: MAT,
    config,
    strokes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "toio-plotter-drawing.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importDrawing(file) {
  const text = await file.text();
  importDrawingPayload(JSON.parse(text), "描画 JSON を読み込みました");
}

function importDrawingPayload(payload, reason) {
  strokes = Array.isArray(payload.strokes) ? payload.strokes : [];
  resetDeadSegmentSettings();
  if (payload.config) {
    config = { ...config, ...payload.config };
    syncConfigToForm();
    saveConfig();
  }
  simulation = null;
  invalidateSimulation(reason);
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
        await setPen(command.state);
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
    els.runBtn.disabled = !simulationValid;
  }
}

async function runDeadTurn(command) {
  if (!command.durationMs) return;
  const direction = command.angle >= 0 ? 1 : -1;
  const base = Math.abs(config.deadTurnSpeed);
  const trim = config.deadTurnBalanceTrim;
  const leftSpeed = direction * clamp(base + trim, 0, 255);
  const rightSpeed = -direction * clamp(base - trim, 0, 255);
  log(`turn ${command.angle.toFixed(0)}°: L=${leftSpeed} R=${rightSpeed} ${command.durationMs}ms`);
  await moveCube.timedMotorPair(leftSpeed, rightSpeed, command.durationMs);
  await sleep(command.durationMs);
}

async function runDeadMotor(command) {
  const leftSpeed = clamp(command.leftSpeed, -255, 255);
  const rightSpeed = clamp(command.rightSpeed, -255, 255);
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
    els.moveCubeState.textContent = status;
  };
  cube.onPose = (pose) => {
    lastMovePose = pose;
    lastMovePoseAt = Date.now();
    updateMovePoseUi();
  };
  cube.onPositionMissed = () => {
    updateMovePoseUi();
  };
  cube.onLog = log;
  els.moveCubeState.textContent = connectedName(cube);
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
    els.penCubeState.textContent = status;
  };
  cube.onPose = () => {};
  cube.onPositionMissed = () => {};
  cube.onLog = log;
  els.penCubeState.textContent = connectedName(cube);
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
      if (cube && !cube.device) setMoveCube(null);
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
      if (cube && !cube.device) setPenCube(null);
      log(error.message);
    }
  });
  els.swapRolesBtn.addEventListener("click", swapCubeRoles);
  els.prevSegmentBtn.addEventListener("click", () => selectAdjacentDrawSegment(-1));
  els.nextSegmentBtn.addEventListener("click", () => selectAdjacentDrawSegment(1));
  els.deadSegmentsEditor.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement) updateDeadSegmentSetting(event.target);
  });
  els.deadSegmentsEditor.addEventListener("change", (event) => {
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
  bindEvents();
  window.setInterval(refreshMovePoseStatus, POSITION_UI_REFRESH_MS);
  resizeCanvasBackingStore();
  setPill(els.simStatus, "未シミュレーション", "warn");
  log("準備完了。フリーハンドで描画してください。");
}

init();
