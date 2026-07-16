"use strict";

const TOIO = {
  service: "10b20100-5b3b-4571-9508-cf3efcd7bbae",
  id: "10b20101-5b3b-4571-9508-cf3efcd7bbae",
  motor: "10b20102-5b3b-4571-9508-cf3efcd7bbae",
};

const MAT = {
  minX: 34,
  minY: 35,
  maxX: 339,
  maxY: 250,
};

const DEFAULT_CONFIG = {
  safeScale: 0.75,
  fixedHeading: 0,
  penOffsetX: 0,
  penOffsetY: 48,
  rotationCenterOffsetX: 0,
  rotationCenterOffsetY: 0,
  drawSpeed: 35,
  travelSpeed: 60,
  smoothing: 0.35,
  minPointDistance: 4,
  cornerAngle: 42,
  targetTimeout: 6,
  upMotorSpeed: 50,
  upDurationMs: 300,
  downMotorSpeed: -50,
  downDurationMs: 300,
  settleMs: 250,
};

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
  "targetTimeout",
  "upMotorSpeed",
  "upDurationMs",
  "downMotorSpeed",
  "downDurationMs",
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

class ToioCube {
  constructor(role, statusEl) {
    this.role = role;
    this.statusEl = statusEl;
    this.device = null;
    this.server = null;
    this.idChar = null;
    this.motorChar = null;
    this.pose = null;
    this.nextTargetId = 1;
    this.pendingTargets = new Map();
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("このブラウザは Web Bluetooth に対応していません。PC の Chrome / Edge を使ってください。");
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [TOIO.service] }],
      optionalServices: [TOIO.service],
    });

    this.device.addEventListener("gattserverdisconnected", () => {
      this.statusEl.textContent = "切断";
      this.pose = null;
    });

    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(TOIO.service);
    this.idChar = await service.getCharacteristic(TOIO.id);
    this.motorChar = await service.getCharacteristic(TOIO.motor);

    await this.idChar.startNotifications();
    this.idChar.addEventListener("characteristicvaluechanged", (event) => this.handleId(event.target.value));

    await this.motorChar.startNotifications();
    this.motorChar.addEventListener("characteristicvaluechanged", (event) => this.handleMotor(event.target.value));

    this.statusEl.textContent = this.device.name || "接続済み";
    log(`${this.role} toio を接続しました`);
  }

  handleId(value) {
    if (value.getUint8(0) === 0x01 && value.byteLength >= 13) {
      this.pose = {
        x: value.getUint16(1, true),
        y: value.getUint16(3, true),
        theta: value.getUint16(5, true),
        sensorX: value.getUint16(7, true),
        sensorY: value.getUint16(9, true),
        sensorTheta: value.getUint16(11, true),
      };
      if (this.role === "移動用") {
        els.positionState.textContent = `x:${this.pose.x} y:${this.pose.y} θ:${this.pose.theta}`;
        draw();
      }
    } else if (value.getUint8(0) === 0x03 && this.role === "移動用") {
      els.positionState.textContent = "Position ID missed";
    }
  }

  handleMotor(value) {
    const kind = value.getUint8(0);
    if (kind !== 0x83 || value.byteLength < 3) return;
    const id = value.getUint8(1);
    const result = value.getUint8(2);
    const pending = this.pendingTargets.get(id);
    if (!pending) return;
    this.pendingTargets.delete(id);
    if (result === 0x00) {
      pending.resolve();
    } else {
      pending.reject(new Error(`toio target ${id} failed: 0x${result.toString(16).padStart(2, "0")}`));
    }
  }

  async write(bytes) {
    if (!this.motorChar) throw new Error(`${this.role} toio が未接続です。`);
    await this.motorChar.writeValueWithoutResponse(Uint8Array.from(bytes));
  }

  async stop() {
    if (!this.motorChar) return;
    await this.write([0x01, 0x01, 0x01, 0x00, 0x02, 0x01, 0x00]);
  }

  async timedMotor(speed, durationMs) {
    const duration = clamp(Math.round(durationMs / 10), 1, 255);
    const direction = speed >= 0 ? 0x01 : 0x02;
    const amount = clamp(Math.abs(Math.round(speed)), 0, 255);
    await this.write([0x02, 0x01, direction, amount, 0x02, direction, amount, duration]);
  }

  async moveTo(x, y, theta, speed, timeoutSec) {
    const id = this.nextTargetId;
    this.nextTargetId = (this.nextTargetId + 1) & 0xff;
    const bytes = new Uint8Array(13);
    bytes[0] = 0x03;
    bytes[1] = id;
    bytes[2] = clamp(Math.round(timeoutSec), 1, 255);
    bytes[3] = 0x00;
    bytes[4] = clamp(Math.round(speed), 10, 255);
    bytes[5] = 0x00;
    bytes[6] = 0x00;
    writeU16(bytes, 7, clamp(Math.round(x), 0, 0xffff));
    writeU16(bytes, 9, clamp(Math.round(y), 0, 0xffff));
    writeU16(bytes, 11, clamp(Math.round(theta) % 360, 0, 0x1fff));

    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTargets.delete(id);
        reject(new Error(`toio target ${id} response timeout`));
      }, (timeoutSec + 3) * 1000);
      this.pendingTargets.set(id, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });

    await this.motorChar.writeValueWithoutResponse(bytes);
    return promise;
  }
}

function writeU16(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem("toioPlotterConfig") || "{}") };
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

function readConfigFromForm() {
  for (const [key, input] of Object.entries(configInputs)) {
    config[key] = Number(input.value);
  }
  saveConfig();
  invalidateSimulation("設定を変更しました");
  draw();
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
  const scale = clamp(config.safeScale, 0.5, 1);
  const centerX = (MAT.minX + MAT.maxX) / 2;
  const centerY = (MAT.minY + MAT.maxY) / 2;
  const halfW = ((MAT.maxX - MAT.minX) * scale) / 2;
  const halfH = ((MAT.maxY - MAT.minY) * scale) / 2;
  return {
    minX: centerX - halfW,
    maxX: centerX + halfW,
    minY: centerY - halfH,
    maxY: centerY + halfH,
  };
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
  if (moveCube && moveCube.pose) drawCubePose(moveCube.pose, COLORS.liveCube, 1, true);
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
  ctx.fillText("A3 simple play mat", p1.x + 10, p1.y + 18);
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
  const size = 32 * getView().scale;
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
  const reduced = reducePoints(raw, config.minPointDistance);
  const sections = splitAtCorners(reduced, config.cornerAngle);
  const processed = [];
  for (const section of sections) {
    const smoothed = smoothPoints(section, config.smoothing);
    if (processed.length && smoothed.length) smoothed.shift();
    processed.push(...smoothed);
  }
  return processed.length >= 2 ? processed : reduced;
}

function reducePoints(points, minDistance) {
  if (points.length < 2) return [...points];
  const result = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    if (distance(points[i], result[result.length - 1]) >= minDistance) result.push(points[i]);
  }
  const last = points[points.length - 1];
  if (distance(last, result[result.length - 1]) > 0.1) result.push(last);
  return result;
}

function splitAtCorners(points, angleThreshold) {
  if (points.length < 3) return [points];
  const sections = [];
  let section = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    section.push(points[i]);
    if (turnAngle(points[i - 1], points[i], points[i + 1]) >= angleThreshold) {
      sections.push(section);
      section = [points[i]];
    }
  }
  section.push(points[points.length - 1]);
  sections.push(section);
  return sections;
}

function smoothPoints(points, strength) {
  const amount = clamp(strength, 0, 1);
  if (points.length < 4 || amount <= 0) return [...points];
  let current = points.map((point) => ({ ...point }));
  const passes = Math.max(1, Math.round(amount * 4));
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [current[0]];
    for (let i = 1; i < current.length - 1; i += 1) {
      next.push({
        x: current[i].x * (1 - amount * 0.5) + (current[i - 1].x + current[i + 1].x) * amount * 0.25,
        y: current[i].y * (1 - amount * 0.5) + (current[i - 1].y + current[i + 1].y) * amount * 0.25,
      });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

function createSimulation() {
  const bounds = safeBounds();
  const commands = [];
  const cubePath = [];
  const errors = [];
  const warnings = [];
  const processedStrokes = strokes.map((stroke) => ({ ...stroke, processed: processStroke(stroke.raw) }));

  for (const stroke of processedStrokes) {
    if (stroke.processed.length < 2) continue;

    commands.push({ type: "pen", state: "up" });

    for (let i = 0; i < stroke.processed.length - 1; i += 1) {
      const start = stroke.processed[i];
      const end = stroke.processed[i + 1];
      if (distance(start, end) < 0.1) continue;
      const theta = headingBetween(start, end);
      const startCube = penToCube(start, theta);
      const endCube = penToCube(end, theta);

      for (const point of [start, end]) {
        if (!pointInBounds(point, bounds)) errors.push(`安全領域外の点があります: x=${point.x.toFixed(1)} y=${point.y.toFixed(1)}`);
      }
      for (const cube of [startCube, endCube]) {
        if (!pointInBounds(cube, MAT)) warnings.push("toio 本体の目標座標がマット外に出る可能性があります。");
      }

      commands.push({ type: "rotate", x: startCube.x, y: startCube.y, theta, speed: config.travelSpeed, penX: start.x, penY: start.y });
      commands.push({
        type: "move",
        x: startCube.x,
        y: startCube.y,
        theta,
        speed: config.travelSpeed,
        penX: start.x,
        penY: start.y,
      });
      commands.push({ type: "pen", state: "down", penX: start.x, penY: start.y });
      commands.push({
        type: "move",
        x: endCube.x,
        y: endCube.y,
        theta,
        speed: config.drawSpeed,
        penX: end.x,
        penY: end.y,
      });
      commands.push({ type: "pen", state: "up", penX: end.x, penY: end.y });

      cubePath.push({ ...startCube, theta }, { ...endCube, theta });
    }
  }

  return {
    commands,
    cubePath,
    processedStrokes,
    errors: [...new Set(errors)].slice(0, 5),
    warnings: [...new Set(warnings)].slice(0, 3),
  };
}

function penToCube(point, theta = config.fixedHeading) {
  const offset = rotatePoint(
    {
      x: config.penOffsetX + config.rotationCenterOffsetX,
      y: config.penOffsetY + config.rotationCenterOffsetY,
    },
    theta,
  );
  return {
    x: point.x - offset.x,
    y: point.y - offset.y,
  };
}

function headingBetween(start, end) {
  const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  return (angle + 360) % 360;
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
    log(`シミュレーション成功: ${simulation.commands.length} commands${warn}`);
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
        await moveCube.moveTo(command.x, command.y, command.theta, command.speed, config.targetTimeout);
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
    await penCube.timedMotor(config.upMotorSpeed, config.upDurationMs);
  } else {
    await penCube.timedMotor(config.downMotorSpeed, config.downDurationMs);
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
  return (Math.acos(clamp(dot, -1, 1)) * 180) / Math.PI;
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
    try {
      moveCube = new ToioCube("移動用", els.moveCubeState);
      await moveCube.connect();
    } catch (error) {
      log(error.message);
    }
  });
  els.connectPenBtn.addEventListener("click", async () => {
    try {
      penCube = new ToioCube("昇降用", els.penCubeState);
      await penCube.connect();
    } catch (error) {
      log(error.message);
    }
  });

  for (const input of Object.values(configInputs)) input.addEventListener("change", readConfigFromForm);
}

function init() {
  syncConfigToForm();
  bindEvents();
  resizeCanvasBackingStore();
  setPill(els.simStatus, "未シミュレーション", "warn");
  log("準備完了。フリーハンドで描画してください。");
}

init();
