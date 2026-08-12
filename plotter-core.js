(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PlotterCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAT = {
    minX: 98,
    minY: 142,
    maxX: 402,
    maxY: 358,
  };

  const NATIVE_MAT = { ...MAT };
  const DEFAULT_CONFIG = {
    configVersion: 19,
    safeScale: 0.75,
    fixedHeading: 0,
    penOffsetX: -48,
    penOffsetY: 0,
    rotationCenterOffsetX: 0,
    rotationCenterOffsetY: 0,
    drawSpeed: 20,
    travelSpeed: 20,
    smoothing: 0.35,
    minPointDistance: 4,
    cornerAngle: 42,
    lineCorrection: 1,
    lineTolerance: 10,
    minSegmentLength: 12,
    targetTimeout: 6,
    upMotorSpeed: -30,
    upDurationMs: 300,
    downMotorSpeed: 30,
    downDurationMs: 300,
    penMotorMode: 0,
    settleMs: 250,
    runMode: "position",
    deadTurnSpeed: 15,
    deadTurnBalanceTrim: 0,
    deadMmPerSecAtDrawSpeed: 30,
    deadMmPerSecAtTravelSpeed: 70,
  };
  const MIN_TURN_DURATION_MS = 150;
  const DEAD_TURN_DURATION_BASE_SCALE = 0.5;

  function withDefaults(config = {}) {
    return { ...DEFAULT_CONFIG, ...config, configVersion: DEFAULT_CONFIG.configVersion };
  }

  function safeBounds(config) {
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

  function nativeToMatPoint(point) {
    return {
      x: point.x,
      y: point.y,
    };
  }

  function matToNativePoint(point) {
    return {
      x: point.x,
      y: point.y,
    };
  }

  function nativeToMatPose(pose) {
    return { ...pose, ...nativeToMatPoint(pose) };
  }

  function matToNativePose(pose) {
    return { ...pose, ...matToNativePoint(pose) };
  }

  function processStroke(raw, configInput = {}) {
    const config = withDefaults(configInput);
    const reduced = reducePoints(raw, config.minPointDistance);
    const sections = splitAtCorners(reduced, config.cornerAngle);
    const processed = [];
    for (const section of sections) {
      const smoothed = smoothPoints(section, config.smoothing);
      const corrected = config.lineCorrection ? simplifyForPlotter(smoothed, config) : smoothed;
      if (processed.length && corrected.length) corrected.shift();
      processed.push(...corrected);
    }
    return processed.length >= 2 ? processed : reduced;
  }

  class BasePlotterPlanner {
    constructor(configInput = {}) {
      this.config = withDefaults(configInput);
    }

    processStrokes(strokes) {
      return strokes.map((stroke) => ({ ...stroke, processed: processStroke(stroke.raw, this.config) }));
    }

    uniqueMessages(messages, limit) {
      return [...new Set(messages)].slice(0, limit);
    }
  }

  class PositionIdPlanner extends BasePlotterPlanner {
    plan(strokes) {
      const config = this.config;
      const bounds = safeBounds(config);
      const commands = [];
      const cubePath = [];
      const errors = [];
      const warnings = [];
      const processedStrokes = this.processStrokes(strokes);
      const stats = {
        rawPoints: 0,
        processedPoints: 0,
        drawSegments: 0,
        penDowns: 0,
        penUps: 0,
      };

      for (const stroke of processedStrokes) {
        if (!stroke.raw || stroke.processed.length < 2) continue;
        stats.rawPoints += stroke.raw.length;
        stats.processedPoints += stroke.processed.length;

        commands.push({ type: "pen", state: "up" });

        for (let i = 0; i < stroke.processed.length - 1; i += 1) {
          const start = stroke.processed[i];
          const end = stroke.processed[i + 1];
          if (distance(start, end) < 0.1) continue;
          const theta = headingBetween(start, end);
          const startCube = penToCube(start, theta, config);
          const endCube = penToCube(end, theta, config);

          this.validateSegment({ start, end, startCube, endCube, bounds, errors });
          this.addSegmentCommands({ commands, cubePath, stats, start, end, startCube, endCube, theta });
        }
      }

      return {
        mode: "position",
        commands,
        cubePath,
        processedStrokes,
        stats,
        errors: this.uniqueMessages(errors, 5),
        warnings: this.uniqueMessages(warnings, 3),
      };
    }

    validateSegment({ start, end, startCube, endCube, bounds, errors }) {
      for (const point of [start, end]) {
        if (!pointInBounds(point, bounds)) errors.push(`安全領域外の点があります: x=${point.x.toFixed(1)} y=${point.y.toFixed(1)}`);
      }
      for (const cube of [startCube, endCube]) {
        if (!pointInBounds(cube, MAT)) errors.push(`toio 本体の目標座標がマット外です: x=${cube.x.toFixed(1)} y=${cube.y.toFixed(1)}`);
      }
    }

    addSegmentCommands({ commands, cubePath, stats, start, end, startCube, endCube, theta }) {
      const config = this.config;
        commands.push({ type: "rotate", x: startCube.x, y: startCube.y, theta, speed: config.travelSpeed, penX: start.x, penY: start.y });
      commands.push({ type: "move", x: startCube.x, y: startCube.y, theta, speed: config.travelSpeed, penX: start.x, penY: start.y });
      commands.push({ type: "pen", state: "down", penX: start.x, penY: start.y });
      commands.push({ type: "move", x: endCube.x, y: endCube.y, theta, speed: config.drawSpeed, penX: end.x, penY: end.y });
      commands.push({ type: "pen", state: "up", penX: end.x, penY: end.y });

      stats.penDowns += 1;
      stats.penUps += 1;
      stats.drawSegments += 1;
      cubePath.push({ ...startCube, theta }, { ...endCube, theta });
    }
  }

  function createSimulation({ strokes, config: configInput }) {
    return new PositionIdPlanner(configInput).plan(strokes);
  }

  class DeadReckoningPlanner extends BasePlotterPlanner {
    constructor(configInput = {}, segmentSettings = {}) {
      super(configInput);
      this.segmentSettings = segmentSettings;
      this.currentPen = null;
      this.currentHeading = null;
      this.currentCube = null;
      this.segmentIndex = 0;
    }

    plan(strokes) {
      const processedStrokes = this.cloneProcessedStrokes(this.processStrokes(strokes));
      const plan = {
        mode: "dead",
        commands: [{ type: "pen", state: "up" }],
        cubePath: [],
        processedStrokes,
        segments: [],
        stats: {
          rawPoints: 0,
          processedPoints: 0,
          drawSegments: 0,
          travelSegments: 0,
          penDowns: 0,
          penUps: 0,
        },
        errors: [],
        warnings: [],
      };

      for (const stroke of processedStrokes) {
        this.addStroke(plan, stroke);
      }

      if (!plan.segments.length) plan.warnings.push("Dead reckoning用の線分がありません。");

      return {
        ...plan,
        errors: this.uniqueMessages(plan.errors, 5),
        warnings: this.uniqueMessages(plan.warnings, 3),
      };
    }

    cloneProcessedStrokes(strokes) {
      return strokes.map((stroke) => ({
        ...stroke,
        raw: stroke.raw.map((point) => ({ ...point })),
        processed: stroke.processed.map((point) => ({ ...point })),
      }));
    }

    addStroke(plan, stroke) {
      if (!stroke.raw || stroke.processed.length < 2) return;
      plan.stats.rawPoints += stroke.raw.length;
      plan.stats.processedPoints += stroke.processed.length;

      const strokeStart = stroke.processed[0];
      if (this.currentPen && distance(this.currentPen, strokeStart) >= 0.1) {
        this.addSegment(plan, "travel", this.currentPen, strokeStart);
      }

      for (let i = 0; i < stroke.processed.length - 1; i += 1) {
        const start = stroke.processed[i];
        const end = stroke.processed[i + 1];
        if (distance(start, end) < 0.1) continue;
        this.addSegment(plan, "draw", start, end);
      }
    }

    addSegment(plan, kind, start, end) {
      const segment = this.buildSegment(kind, start, end);
      plan.segments.push(segment);
      this.addSegmentCommands(plan, segment);
      this.currentPen = end;
      this.currentHeading = segment.heading;
      this.currentCube = segment.endCube;
      this.segmentIndex += 1;
    }

    buildSegment(kind, start, end) {
      const config = this.config;
      const id = `seg-${this.segmentIndex}`;
      const heading = headingBetween(start, end);
      const lengthMm = distance(start, end);
      const previousHeading = this.currentHeading == null ? heading : this.currentHeading;
      const turnAngleValue = signedAngleDelta(previousHeading, heading);
      const saved = this.segmentSettings[id] || {};
      const baseSpeed = kind === "draw" ? config.drawSpeed : config.travelSpeed;
      const baseMmPerSec = kind === "draw" ? config.deadMmPerSecAtDrawSpeed : config.deadMmPerSecAtTravelSpeed;
      const speed = clamp(Number(saved.speed ?? baseSpeed), 1, 255);
      const durationScale = clamp(Number(saved.durationScale ?? 1), 0.1, 5);
      const steeringTrim = clamp(Number(saved.steeringTrim ?? 0), -80, 80);
      const startCube = penToCube(start, heading, config);
      const endCube = penToCube(end, heading, config);
      return {
        id,
        kind,
        start,
        end,
        startCube,
        endCube,
        lengthMm,
        heading,
        turnAngle: turnAngleValue,
        speed,
        durationScale,
        steeringTrim,
        durationMs: computeStraightDurationMs(lengthMm, speed, baseSpeed, baseMmPerSec, durationScale),
        turnDurationMs: computeTurnDurationMs(turnAngleValue, config.deadTurnSpeed),
      };
    }

    addSegmentCommands(plan, segment) {
      if (this.currentCube) {
        this.addMotorOnlyTransition(plan, segment);
      }
      if (segment.kind === "draw") {
        plan.commands.push({ type: "pen", state: "down", penX: segment.start.x, penY: segment.start.y });
        plan.stats.penDowns += 1;
      }
      plan.commands.push({
        type: "motor",
        segmentId: segment.id,
        kind: segment.kind,
        leftSpeed: segment.speed + segment.steeringTrim,
        rightSpeed: segment.speed - segment.steeringTrim,
        durationMs: segment.durationMs,
        fromX: segment.startCube.x,
        fromY: segment.startCube.y,
        x: segment.endCube.x,
        y: segment.endCube.y,
        theta: segment.heading,
        penX: segment.end.x,
        penY: segment.end.y,
      });
      if (segment.kind === "draw") {
        plan.commands.push({ type: "pen", state: "up", penX: segment.end.x, penY: segment.end.y });
        plan.stats.penUps += 1;
        plan.stats.drawSegments += 1;
      } else {
        plan.stats.travelSegments += 1;
      }
      if (this.currentCube) plan.cubePath.push({ ...this.currentCube, theta: this.currentHeading });
      plan.cubePath.push({ ...segment.startCube, theta: segment.heading }, { ...segment.endCube, theta: segment.heading });
    }

    addMotorOnlyTransition(plan, segment) {
      const currentHeading = this.currentHeading ?? segment.heading;
      let pose = { ...this.currentCube, theta: currentHeading };
      const targetPose = { ...segment.startCube, theta: segment.heading };
      const travelDistance = distance(pose, targetPose);

      if (travelDistance >= 0.1) {
        const travelHeading = headingBetween(pose, targetPose);
        pose = this.addTurnStep(plan, {
          segment,
          pose,
          theta: travelHeading,
          label: "turn-to-travel",
        });
        pose = this.addTravelStep(plan, { segment, pose, targetPose, travelHeading });
        this.currentCube = { x: pose.x, y: pose.y };
        this.currentHeading = pose.theta;
      }

      this.addTurnStep(plan, {
        segment,
        pose: { ...targetPose, theta: this.currentHeading ?? pose.theta },
        theta: segment.heading,
        label: "turn-to-draw",
      });
    }

    addTurnStep(plan, { segment, pose, theta, label }) {
      const angle = signedAngleDelta(pose.theta, theta);
      const durationMs = computeTurnDurationMs(angle, this.config.deadTurnSpeed);
      const speeds = computeTurnWheelSpeeds(angle, this.config.deadTurnSpeed, this.config.deadTurnBalanceTrim);
      plan.commands.push({
        type: "turn",
        role: label,
        segmentId: segment.id,
        angle,
        leftSpeed: speeds.left,
        rightSpeed: speeds.right,
        turnDurationBaseScale: DEAD_TURN_DURATION_BASE_SCALE,
        durationMs,
        x: pose.x,
        y: pose.y,
        theta,
        penX: cubeToPen(pose, theta, this.config).x,
        penY: cubeToPen(pose, theta, this.config).y,
      });
      return { x: pose.x, y: pose.y, theta };
    }

    addTravelStep(plan, { segment, pose, targetPose, travelHeading }) {
      const travelDistance = distance(pose, targetPose);
      const durationMs = computeStraightDurationMs(
        travelDistance,
        this.config.travelSpeed,
        this.config.travelSpeed,
        this.config.deadMmPerSecAtTravelSpeed,
        segment.durationScale,
      );
      const penEnd = cubeToPen(targetPose, travelHeading, this.config);
      plan.commands.push({
        type: "motor",
        role: "transition-travel",
        segmentId: segment.id,
        kind: "travel",
        leftSpeed: this.config.travelSpeed,
        rightSpeed: this.config.travelSpeed,
        durationMs,
        fromX: pose.x,
        fromY: pose.y,
        x: targetPose.x,
        y: targetPose.y,
        theta: travelHeading,
        penX: penEnd.x,
        penY: penEnd.y,
      });
      plan.stats.travelSegments += 1;
      return { x: targetPose.x, y: targetPose.y, theta: travelHeading };
    }
  }

  function createDeadReckoningSimulation({ strokes, config: configInput, segmentSettings = {} }) {
    return new DeadReckoningPlanner(configInput, segmentSettings).plan(strokes);
  }

  function computeStraightDurationMs(lengthMm, speed, baseSpeed, baseMmPerSec, durationScale) {
    const mmPerSec = Math.max(1, baseMmPerSec * (speed / Math.max(1, baseSpeed)));
    return Math.max(10, Math.round((lengthMm / mmPerSec) * 1000 * durationScale));
  }

  function computeTurnDurationMs(angleDeg, turnSpeed) {
    if (Math.abs(angleDeg) < 0.1) return 0;
    const degPerSec = Math.max(10, Math.abs(turnSpeed) * 4);
    return Math.max(MIN_TURN_DURATION_MS, Math.round((Math.abs(angleDeg) / degPerSec) * 1000 * effectiveTurnDurationScale()));
  }

  function effectiveTurnDurationScale() {
    return DEAD_TURN_DURATION_BASE_SCALE;
  }

  function computeTurnWheelSpeeds(angleDeg, turnSpeed, balanceTrim) {
    const direction = angleDeg >= 0 ? 1 : -1;
    const base = Math.abs(Number(turnSpeed) || 0);
    const trim = Number(balanceTrim) || 0;
    return {
      left: Math.round(direction * clamp(base + trim, 0, 255)),
      right: Math.round(-direction * clamp(base - trim, 0, 255)),
    };
  }

  function cubeToPen(point, theta, configInput = {}) {
    const config = withDefaults(configInput);
    const offset = rotatePoint(
      {
        x: config.penOffsetX + config.rotationCenterOffsetX,
        y: config.penOffsetY + config.rotationCenterOffsetY,
      },
      theta,
    );
    return {
      x: point.x + offset.x,
      y: point.y + offset.y,
    };
  }

  function simplifyForPlotter(points, config) {
    if (points.length < 3) return [...points];
    const simplified = rdp(points, config.lineTolerance);
    return mergeShortSegments(simplified, config.minSegmentLength);
  }

  function rdp(points, epsilon) {
    if (points.length < 3 || epsilon <= 0) return [...points];
    let maxDistance = 0;
    let index = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i += 1) {
      const d = perpendicularDistance(points[i], first, last);
      if (d > maxDistance) {
        index = i;
        maxDistance = d;
      }
    }

    if (maxDistance > epsilon) {
      const left = rdp(points.slice(0, index + 1), epsilon);
      const right = rdp(points.slice(index), epsilon);
      return left.slice(0, -1).concat(right);
    }

    return [first, last];
  }

  function mergeShortSegments(points, minLength) {
    if (points.length < 3 || minLength <= 0) return [...points];
    const result = [points[0]];
    for (let i = 1; i < points.length - 1; i += 1) {
      const prev = result[result.length - 1];
      const next = points[i + 1];
      if (distance(prev, points[i]) < minLength && distance(points[i], next) < minLength) continue;
      result.push(points[i]);
    }
    result.push(points[points.length - 1]);
    return result;
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

  function penToCube(point, theta, configInput = {}) {
    const config = withDefaults(configInput);
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

  function signedAngleDelta(fromDeg, toDeg) {
    return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
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

  function pointInBounds(point, bounds) {
    return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
  }

  function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const length = Math.hypot(dx, dy);
    if (!length) return distance(point, lineStart);
    return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / length;
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

  return {
    MAT,
    NATIVE_MAT,
    DEFAULT_CONFIG,
    withDefaults,
    safeBounds,
    nativeToMatPoint,
    matToNativePoint,
    nativeToMatPose,
    matToNativePose,
    BasePlotterPlanner,
    PositionIdPlanner,
    DeadReckoningPlanner,
    processStroke,
    effectiveTurnDurationScale,
    computeTurnWheelSpeeds,
    createSimulation,
    createDeadReckoningSimulation,
    penToCube,
    headingBetween,
    signedAngleDelta,
    distance,
  };
});
