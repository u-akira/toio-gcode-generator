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
  liveCube: "#bd2f2f",
};

const PLAY_MAT_IMAGE_SRC = "image/playmat-position-id-01.png";
const POSITION_FRESH_MS = 500;
const POSITION_HOLD_MS = 1500;
const POSITION_RUN_TIMEOUT_MS = 1000;

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
  connectMoveBtn: document.getElementById("connectMoveBtn"),
  connectPenBtn: document.getElementById("connectPenBtn"),
  swapRolesBtn: document.getElementById("swapRolesBtn"),
  simulateBtn: document.getElementById("simulateBtn"),
  runBtn: document.getElementById("runBtn"),
  stopBtn: document.getElementById("stopBtn"),
  penUpBtn: document.getElementById("penUpBtn"),
  penDownBtn: document.getElementById("penDownBtn"),
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
let config = loadConfig();
let strokes = [];
let activeStroke = null;
let simulation = null;
let simulationValid = false;
let running = false;
let abortRun = false;
let moveCube = null;
let penCube = null;
let playMatImageLoaded = false;
let lastMovePose = null;
let lastMovePoseAt = 0;
let lastMovePoseState = "missed";

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
    return { ...DEFAULT_CONFIG, ...saved, configVersion: DEFAULT_CONFIG.configVersion };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  localStorage.setItem("toioPlotterConfig", JSON.stringify(config));
}

function syncConfigToForm() {
  for (const [key, input] of Object.entries(configInputs)) {
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
  els.runBtn.disabled = true;
  setPill(els.simStatus, "未シミュレーション", "warn");
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
  const matW = MAT.maxX - MAT.minX;
  const matH = MAT.maxY - MAT.minY;
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
  return {
    x: view.left + (point.x - MAT.minX) * view.scale,
    y: view.top + (point.y - MAT.minY) * view.scale,
  };
}

function canvasToMat(clientX, clientY) {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = (clientX - rect.left) * dpr;
  const y = (clientY - rect.top) * dpr;
  const view = getView();
  return {
    x: MAT.minX + (x - view.left) / view.scale,
    y: MAT.minY + (y - view.top) / view.scale,
  };
}

function safeBounds() {
  return window.PlotterCore.safeBounds(config);
}

function pointInBounds(point, bounds) {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

function draw() {
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  drawMat();
  for (const stroke of strokes) drawStroke(stroke.processed || stroke.raw, COLORS.drawing, 2.2);
  if (activeStroke) drawStroke(activeStroke.raw, COLORS.drawing, 2.2);
  if (simulation) {
    drawCommands(simulation.commands);
    drawCubePath(simulation.cubePath);
  }
  const poseStatus = getMovePoseStatus();
  if (poseStatus.pose && poseStatus.state !== "missed") {
    drawCubePose(nativeToMatPose(poseStatus.pose), COLORS.liveCube, poseStatus.state === "unstable" ? 0.42 : 1, true);
  }
  drawLegend();
}

function drawMat() {
  const p1 = matToCanvas({ x: MAT.minX, y: MAT.minY });
  const p2 = matToCanvas({ x: MAT.maxX, y: MAT.maxY });
  ctx.save();
  ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
  ctx.strokeStyle = "#9d9588";
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  if (playMatImageLoaded) {
    ctx.drawImage(playMatImage, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  }
  ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

  const safe = safeBounds();
  const s1 = matToCanvas({ x: safe.minX, y: safe.minY });
  const s2 = matToCanvas({ x: safe.maxX, y: safe.maxY });
  ctx.setLineDash([8, 7]);
  ctx.strokeStyle = "#0f7b6c";
  ctx.strokeRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y);
  ctx.setLineDash([]);

  ctx.fillStyle = "#6c6f73";
  ctx.font = `${12 * (window.devicePixelRatio || 1)}px system-ui`;
  ctx.fillText("A3 simple play mat #01 (Position ID)", p1.x + 10, p1.y + 18);
  ctx.fillText("safe drawing area", s1.x + 10, s1.y + 18);
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
    if (command.type === "move" && command.penX != null) {
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
  drawCubePose(points[0], COLORS.cubeGhost, 0.8, false);
  drawCubePose(points[points.length - 1], COLORS.cubeGhost, 0.9, true);
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
    ["toio姿勢", COLORS.cubeGhost, "box"],
    ["実機toio", COLORS.liveCube, "box"],
  ];
  const x = 18 * dpr;
  const y = 18 * dpr;
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
  return window.PlotterCore.createSimulation({ strokes, config });
}

function runSimulation() {
  applyConfigFromForm({ invalidate: false });
  simulation = createSimulation();
  strokes = simulation.processedStrokes;
  if (!simulation.commands.length) {
    simulationValid = false;
    els.runBtn.disabled = true;
    setPill(els.simStatus, "線なし", "warn");
    log("描画線がありません。");
  } else if (simulation.errors.length) {
    simulationValid = false;
    els.runBtn.disabled = true;
    setPill(els.simStatus, "失敗", "error");
    log(`シミュレーション失敗:\n${simulation.errors.join("\n")}`);
  } else {
    simulationValid = true;
    els.runBtn.disabled = false;
    setPill(els.simStatus, "成功", "ok");
    const warn = simulation.warnings.length ? `\n警告: ${simulation.warnings.join(" ")}` : "";
    const stats = simulation.stats;
    log(
      `シミュレーション成功: ${simulation.commands.length} commands, ` +
        `${stats.drawSegments} draw segments, pen down ${stats.penDowns}, pen up ${stats.penUps}, ` +
        `points ${stats.rawPoints} -> ${stats.processedPoints}${warn}`,
    );
  }
  draw();
}

async function runToio() {
  if (!simulationValid || !simulation) {
    log("先にシミュレーションを成功させてください。");
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
        await setPen(command.state);
      } else if (command.type === "move" || command.type === "rotate") {
        if (!hasFreshMovePose(POSITION_RUN_TIMEOUT_MS)) {
          throw new Error("移動用 toio の Position ID を見失いました。マット上で再取得してから実行してください。");
        }
        const nativePoint = matToNativePoint(command);
        if (!pointInBounds(nativePoint, MAT)) {
          throw new Error(`toio 目標座標がマット外です: x=${nativePoint.x.toFixed(1)} y=${nativePoint.y.toFixed(1)}`);
        }
        log(
          `toio ${command.type}: x=${nativePoint.x.toFixed(1)} y=${nativePoint.y.toFixed(1)} ` +
            `θ=${command.theta.toFixed(0)} speed=${command.speed}`,
        );
        await moveCube.moveTo(nativePoint.x, nativePoint.y, command.theta, command.speed, config.targetTimeout);
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
  const payload = JSON.parse(text);
  strokes = Array.isArray(payload.strokes) ? payload.strokes : [];
  if (payload.config) {
    config = { ...config, ...payload.config };
    syncConfigToForm();
    saveConfig();
  }
  simulation = null;
  invalidateSimulation("描画 JSON を読み込みました");
  draw();
}

function pointerDown(event) {
  event.preventDefault();
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

function refreshMovePoseStatus() {
  if (!moveCube || !lastMovePose) return;
  const previous = lastMovePoseState;
  const status = getMovePoseStatus();
  if (status.state !== previous) {
    updateMovePoseText(status);
    draw();
  }
}

function setMoveCube(cube) {
  moveCube = cube;
  if (!cube) {
    lastMovePose = null;
    lastMovePoseAt = 0;
    lastMovePoseState = "missed";
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
    updateMovePoseText({ state: "fresh", pose, ageMs: 0 });
    draw();
  };
  cube.onPositionMissed = () => {
    updateMovePoseText();
    draw();
  };
  cube.onLog = log;
  els.moveCubeState.textContent = connectedName(cube);
  if (cube.pose) {
    lastMovePose = cube.pose;
    lastMovePoseAt = Date.now();
    updateMovePoseText({ state: "fresh", pose: cube.pose, ageMs: 0 });
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

  els.undoBtn.addEventListener("click", () => {
    strokes.pop();
    simulation = null;
    invalidateSimulation("Undo");
    draw();
  });
  els.clearBtn.addEventListener("click", () => {
    strokes = [];
    activeStroke = null;
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

  for (const input of Object.values(configInputs)) {
    input.addEventListener("input", readConfigFromForm);
    input.addEventListener("change", readConfigFromForm);
  }
}

function init() {
  syncConfigToForm();
  bindEvents();
  window.setInterval(refreshMovePoseStatus, 250);
  resizeCanvasBackingStore();
  setPill(els.simStatus, "未シミュレーション", "warn");
  log("準備完了。フリーハンドで描画してください。");
}

init();
