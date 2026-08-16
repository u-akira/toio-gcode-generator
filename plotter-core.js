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
    configVersion: 28,
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
    deadTurnSpeed: 12,
    deadTurnBalanceTrim: 0,
    deadTurnMsPer90: 660,
    deadMmPerSecAtDrawSpeed: 30,
    deadMmPerSecAtTravelSpeed: 70,
    deadTravelDistanceScale: 1,
    deadWheelBaseMm: 26,
  };
  const MIN_TURN_DURATION_MS = 150;
  const ARC_PREVIEW_STEP_DEG = 5;
  const RIGHT_ANGLE_DEG = 90;
  const RIGHT_ANGLE_TOLERANCE_DEG = 18;
  const MIN_ARC_SWEEP_DEG = 15;
  const MAX_ARC_SWEEP_DEG = 270;
  const MIN_PEN_ARC_RADIUS_MM = 8;

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

  function processStrokeShape(raw, configInput = {}) {
    const config = withDefaults(configInput);
    const fallback = processStroke(raw, config);
    if (!config.lineCorrection) return { processed: fallback, primitives: null };
    const reduced = reducePoints(raw, config.minPointDistance);
    if (reduced.length < 2) return { processed: fallback, primitives: null };
    const smoothed = smoothPoints(reduced, config.smoothing);
    const shaped = fitShapePrimitives(smoothed, config);
    if (!shaped?.primitives?.length) return { processed: fallback, primitives: null };
    return shaped;
  }

  class BasePlotterPlanner {
    constructor(configInput = {}) {
      this.config = withDefaults(configInput);
    }

    processStrokes(strokes) {
      return strokes.map((stroke) => ({
        ...this.processStrokeRecord(stroke),
      }));
    }

    processStrokeRecord(stroke) {
      const raw = Array.isArray(stroke.raw) ? stroke.raw : [];
      if (stroke.source === "freehand") {
        const shaped = processStrokeShape(raw, this.config);
        return {
          ...stroke,
          raw,
          primitives: shaped.primitives,
          processed: shaped.processed,
        };
      }
      return {
        ...stroke,
        raw,
        primitives: Array.isArray(stroke.primitives) ? stroke.primitives : null,
        processed: processStroke(raw, this.config),
      };
    }

    primitivePreviewPoints(primitive) {
      return primitivePreviewPoints(primitive, this.config);
    }

    primitivesPreviewPoints(primitives) {
      const result = [];
      for (const primitive of primitives || []) {
        const points = this.primitivePreviewPoints(primitive);
        if (!points.length) continue;
        if (result.length && distance(result[result.length - 1], points[0]) < 0.1) points.shift();
        result.push(...points);
      }
      return result;
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
      let currentCube = null;
      let currentTheta = null;
      let penState = "down";
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

        if (penState !== "up") {
          commands.push({ type: "pen", state: "up" });
          penState = "up";
        }

        for (let i = 0; i < stroke.processed.length - 1; i += 1) {
          const start = stroke.processed[i];
          const end = stroke.processed[i + 1];
          if (distance(start, end) < 0.1) continue;
          const theta = headingBetween(start, end);
          const startCube = penToCube(start, theta, config);
          const endCube = penToCube(end, theta, config);

          this.validateSegment({ start, end, startCube, endCube, bounds, errors });
          const result = this.addSegmentCommands({ commands, cubePath, stats, start, end, startCube, endCube, theta, currentCube, currentTheta, penState });
          currentCube = result.currentCube;
          currentTheta = result.currentTheta;
          penState = result.penState;
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

    addSegmentCommands({ commands, cubePath, stats, start, end, startCube, endCube, theta, currentCube, currentTheta, penState }) {
      const config = this.config;
      if (currentCube) {
        const travelDistance = distance(currentCube, startCube);
        const turnAngleValue = currentTheta == null ? 0 : Math.abs(signedAngleDelta(currentTheta, theta));
        const type = travelDistance < 0.1 && turnAngleValue > 0.1 ? "rotate" : "move";
        if (travelDistance >= 0.1 || turnAngleValue > 0.1) {
          commands.push({ type, x: startCube.x, y: startCube.y, theta, speed: config.travelSpeed, penX: start.x, penY: start.y });
        }
      } else {
        commands.push({ type: "move", x: startCube.x, y: startCube.y, theta, speed: config.travelSpeed, penX: start.x, penY: start.y });
      }
      if (penState !== "down") {
        commands.push({ type: "pen", state: "down", penX: start.x, penY: start.y });
        penState = "down";
      }
      commands.push({ type: "move", x: endCube.x, y: endCube.y, theta, speed: config.drawSpeed, penX: end.x, penY: end.y });
      commands.push({ type: "pen", state: "up", penX: end.x, penY: end.y });
      penState = "up";

      stats.penDowns += 1;
      stats.penUps += 1;
      stats.drawSegments += 1;
      cubePath.push({ ...startCube, theta }, { ...endCube, theta });
      return { currentCube: endCube, currentTheta: theta, penState };
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
        primitives: stroke.primitives?.map((primitive) => clonePrimitive(primitive)) || null,
        processed: stroke.processed.map((point) => ({ ...point })),
      }));
    }

    addStroke(plan, stroke) {
      if (!stroke.raw && !stroke.primitives) return;
      plan.stats.rawPoints += stroke.raw.length;
      plan.stats.processedPoints += stroke.processed.length;

      if (stroke.primitives?.length) {
        this.addPrimitiveStroke(plan, stroke);
        return;
      }

      if (stroke.processed.length < 2) return;

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

    addPrimitiveStroke(plan, stroke) {
      for (const primitive of stroke.primitives) {
        const primitiveStart = this.primitiveStartPoint(primitive);
        if (!primitiveStart) continue;
        if (this.currentPen && distance(this.currentPen, primitiveStart) >= 0.1) {
          this.addSegment(plan, "travel", this.currentPen, primitiveStart);
        }
        if (primitive.kind === "line") {
          const start = clonePoint(primitive.start);
          const end = clonePoint(primitive.end);
          if (!isFinitePoint(start) || !isFinitePoint(end) || distance(start, end) < 0.1) continue;
          this.addSegment(plan, "draw", start, end);
        } else if (primitive.kind === "arc") {
          this.addArcSegment(plan, "draw", primitive);
        }
      }
    }

    primitiveStartPoint(primitive) {
      if (!primitive) return null;
      if (primitive.kind === "line") return clonePoint(primitive.start);
      if (primitive.kind === "arc") {
        const arc = normalizeArcPrimitive(primitive);
        if (!arc) return null;
        return cubeToPen(pointOnCircle(arc.center, arc.radius, arc.startAngle), arc.startHeading, this.config);
      }
      return null;
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

    addArcSegment(plan, kind, primitive) {
      const segment = this.buildArcSegment(kind, primitive);
      if (!segment) return;
      plan.segments.push(segment);
      this.addSegmentCommands(plan, segment);
      this.currentPen = segment.end;
      this.currentHeading = segment.endHeading;
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
      const distanceScale = kind === "travel" ? clamp(Number(saved.distanceScale ?? config.deadTravelDistanceScale), 0.1, 2) : 1;
      const steeringTrim = clamp(Number(saved.steeringTrim ?? 0), -80, 80);
      const startCube = penToCube(start, heading, config);
      const endCube = penToCube(end, heading, config);
      return {
        id,
        kind,
        geometry: "line",
        start,
        end,
        startCube,
        endCube,
        lengthMm,
        heading,
        turnAngle: turnAngleValue,
        speed,
        durationScale,
        distanceScale,
        steeringTrim,
        durationMs: computeStraightDurationMs(lengthMm, speed, baseSpeed, baseMmPerSec, durationScale * distanceScale),
        turnDurationMs: computeTurnDurationMs(turnAngleValue, config),
      };
    }

    buildArcSegment(kind, primitive) {
      const config = this.config;
      const arc = normalizeArcPrimitive(primitive);
      if (!arc) return null;
      const id = `seg-${this.segmentIndex}`;
      const previousHeading = this.currentHeading == null ? arc.startHeading : this.currentHeading;
      const turnAngleValue = signedAngleDelta(previousHeading, arc.startHeading);
      const saved = this.segmentSettings[id] || {};
      const baseSpeed = kind === "draw" ? config.drawSpeed : config.travelSpeed;
      const baseMmPerSec = kind === "draw" ? config.deadMmPerSecAtDrawSpeed : config.deadMmPerSecAtTravelSpeed;
      const speed = clamp(Number(saved.speed ?? baseSpeed), 1, 255);
      const durationScale = clamp(Number(saved.durationScale ?? 1), 0.1, 5);
      const steeringTrim = clamp(Number(saved.steeringTrim ?? 0), -80, 80);
      const wheelBaseMm = Math.max(1, Number(config.deadWheelBaseMm) || DEFAULT_CONFIG.deadWheelBaseMm);
      const startCube = pointOnCircle(arc.center, arc.radius, arc.startAngle);
      const endCube = pointOnCircle(arc.center, arc.radius, arc.startAngle + arc.sweepAngle);
      const start = cubeToPen(startCube, arc.startHeading, config);
      const end = cubeToPen(endCube, arc.endHeading, config);
      const arcLengthMm = arc.radius * Math.abs(degToRad(arc.sweepAngle));
      const wheelSpeeds = computeArcWheelSpeeds(speed, arc.radius, arc.sweepAngle, wheelBaseMm, steeringTrim);
      const averageSpeed = (Math.abs(wheelSpeeds.left) + Math.abs(wheelSpeeds.right)) / 2;
      const durationMs = computeUnclampedMotionDurationMs(arcLengthMm, averageSpeed, baseSpeed, baseMmPerSec, durationScale);
      const preview = arcPreviewPoints({ ...arc, startCube, endCube }, config);
      return {
        id,
        kind,
        geometry: "arc",
        center: arc.center,
        radius: arc.radius,
        startAngle: arc.startAngle,
        sweepAngle: arc.sweepAngle,
        clockwise: arc.sweepAngle >= 0,
        start,
        end,
        startCube,
        endCube,
        heading: arc.startHeading,
        startHeading: arc.startHeading,
        endHeading: arc.endHeading,
        lengthMm: arcLengthMm,
        turnAngle: turnAngleValue,
        speed,
        durationScale,
        distanceScale: 1,
        steeringTrim,
        wheelBaseMm,
        leftSpeed: wheelSpeeds.left,
        rightSpeed: wheelSpeeds.right,
        durationMs,
        turnDurationMs: computeTurnDurationMs(turnAngleValue, config),
        cubePreviewPoints: preview.cubePreviewPoints,
        penPreviewPoints: preview.penPreviewPoints,
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
        geometry: segment.geometry,
        leftSpeed: segment.leftSpeed ?? segment.speed + segment.steeringTrim,
        rightSpeed: segment.rightSpeed ?? segment.speed - segment.steeringTrim,
        durationMs: segment.durationMs,
        fromX: segment.startCube.x,
        fromY: segment.startCube.y,
        x: segment.endCube.x,
        y: segment.endCube.y,
        theta: segment.endHeading ?? segment.heading,
        startTheta: segment.startHeading ?? segment.heading,
        penX: segment.end.x,
        penY: segment.end.y,
        center: segment.center,
        radius: segment.radius,
        startAngle: segment.startAngle,
        sweepAngle: segment.sweepAngle,
        cubePreviewPoints: segment.cubePreviewPoints,
        penPreviewPoints: segment.penPreviewPoints,
      });
      if (segment.kind === "draw") {
        plan.commands.push({ type: "pen", state: "up", penX: segment.end.x, penY: segment.end.y });
        plan.stats.penUps += 1;
        plan.stats.drawSegments += 1;
      } else {
        plan.stats.travelSegments += 1;
      }
      if (this.currentCube) plan.cubePath.push({ ...this.currentCube, theta: this.currentHeading });
      if (segment.geometry === "arc") {
        plan.cubePath.push(...segment.cubePreviewPoints);
      } else {
        plan.cubePath.push({ ...segment.startCube, theta: segment.heading }, { ...segment.endCube, theta: segment.heading });
      }
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
      const durationMs = computeTurnDurationMs(angle, this.config);
      const speeds = computeTurnWheelSpeeds(angle, this.config.deadTurnSpeed, this.config.deadTurnBalanceTrim);
      plan.commands.push({
        type: "turn",
        role: label,
        segmentId: segment.id,
        angle,
        leftSpeed: speeds.left,
        rightSpeed: speeds.right,
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
        clamp(Number(this.config.deadTravelDistanceScale), 0.1, 2),
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
    return roundToMotorDurationMs(Math.max(10, (lengthMm / mmPerSec) * 1000 * durationScale));
  }

  function computeUnclampedMotionDurationMs(lengthMm, speed, baseSpeed, baseMmPerSec, durationScale) {
    const mmPerSec = Math.max(1, baseMmPerSec * (speed / Math.max(1, baseSpeed)));
    return Math.max(10, Math.round(((lengthMm / mmPerSec) * 1000 * durationScale) / 10) * 10);
  }

  function computeArcWheelSpeeds(speed, radius, sweepAngle, wheelBaseMm, steeringTrim = 0) {
    const turnSign = sweepAngle >= 0 ? 1 : -1;
    const halfBase = wheelBaseMm / 2;
    const safeRadius = Math.max(1, Math.abs(radius));
    let left = speed * (safeRadius + turnSign * halfBase) / safeRadius;
    let right = speed * (safeRadius - turnSign * halfBase) / safeRadius;
    left += steeringTrim;
    right -= steeringTrim;
    const maxAbs = Math.max(Math.abs(left), Math.abs(right), 1);
    if (maxAbs > 255) {
      const scale = 255 / maxAbs;
      left *= scale;
      right *= scale;
    }
    return {
      left: Math.round(clamp(left, -255, 255)),
      right: Math.round(clamp(right, -255, 255)),
    };
  }

  function computeTurnDurationMs(angleDeg, configInput = {}) {
    if (Math.abs(angleDeg) < 0.1) return 0;
    const config = withDefaults(configInput);
    const msPer90 = Math.max(MIN_TURN_DURATION_MS, Number(config.deadTurnMsPer90) || DEFAULT_CONFIG.deadTurnMsPer90);
    return roundToMotorDurationMs(Math.max(MIN_TURN_DURATION_MS, (Math.abs(angleDeg) / 90) * msPer90));
  }

  function roundToMotorDurationMs(durationMs) {
    return clamp(Math.round(durationMs / 10), 1, 255) * 10;
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

  function normalizeArcPrimitive(primitive) {
    const center = clonePoint(primitive.center);
    const radius = Number(primitive.radius);
    const startAngle = Number(primitive.startAngle);
    const sweepAngle = Number(primitive.sweepAngle);
    if (!isFinitePoint(center) || !Number.isFinite(radius) || !Number.isFinite(startAngle) || !Number.isFinite(sweepAngle)) return null;
    if (Math.abs(radius) < 1 || Math.abs(sweepAngle) < 0.1) return null;
    const startHeading = normalizeDegrees(startAngle + (sweepAngle >= 0 ? 90 : -90));
    const endHeading = normalizeDegrees(startHeading + sweepAngle);
    return {
      center,
      radius: Math.abs(radius),
      startAngle,
      sweepAngle,
      startHeading,
      endHeading,
    };
  }

  function arcPreviewPoints(arc, config) {
    const count = Math.max(1, Math.ceil(Math.abs(arc.sweepAngle) / ARC_PREVIEW_STEP_DEG));
    const cubePreviewPoints = [];
    const penPreviewPoints = [];
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      const angle = arc.startAngle + arc.sweepAngle * t;
      const theta = normalizeDegrees(arc.startHeading + arc.sweepAngle * t);
      const cube = pointOnCircle(arc.center, arc.radius, angle);
      const cubePose = { ...cube, theta };
      cubePreviewPoints.push(cubePose);
      penPreviewPoints.push(cubeToPen(cube, theta, config));
    }
    return { cubePreviewPoints, penPreviewPoints };
  }

  function pointOnCircle(center, radius, angleDeg) {
    const angle = degToRad(angleDeg);
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  }

  function primitivePreviewPoints(primitive, configInput = {}) {
    const config = withDefaults(configInput);
    if (primitive?.kind === "line") {
      const start = clonePoint(primitive.start);
      const end = clonePoint(primitive.end);
      return isFinitePoint(start) && isFinitePoint(end) ? [start, end] : [];
    }
    if (primitive?.kind === "arc") {
      const arc = normalizeArcPrimitive(primitive);
      if (!arc) return [];
      return arcPreviewPoints(arc, config).penPreviewPoints;
    }
    return [];
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

  function angleFrom(center, point) {
    return normalizeDegrees(radToDeg(Math.atan2(point.y - center.y, point.x - center.x)));
  }

  function fitShapePrimitives(points, config) {
    if (points.length < 2) return null;
    const tolerance = Math.max(0, Number(config.lineTolerance) || 0);
    const corner = findRightAngleCorner(points, config, tolerance);
    if (corner) {
      const first = points[0];
      const last = points[points.length - 1];
      return {
        processed: [first, corner.point, last],
        primitives: [
          { kind: "line", start: clonePoint(first), end: clonePoint(corner.point) },
          { kind: "line", start: clonePoint(corner.point), end: clonePoint(last) },
        ],
      };
    }

    const line = fitLinePrimitive(points);
    const arc = fitArcPrimitive(points, config, tolerance);
    if (arc && arc.avgError <= line.avgError * 0.7) {
      return {
        processed: primitivePreviewPoints(arc.primitive, config),
        primitives: [arc.primitive],
      };
    }

    return {
      processed: [clonePoint(line.start), clonePoint(line.end)],
      primitives: [{ kind: "line", start: clonePoint(line.start), end: clonePoint(line.end) }],
    };
  }

  function findRightAngleCorner(points, config, tolerance) {
    if (points.length < 3) return null;
    const maxLineError = Math.max(1, tolerance * 2.5);
    const minLength = Math.max(1, Number(config.minSegmentLength) || 0);
    let best = null;
    for (let i = 1; i < points.length - 1; i += 1) {
      const angle = turnAngle(points[i - 1], points[i], points[i + 1]);
      const closeness = Math.abs(angle - RIGHT_ANGLE_DEG);
      if (closeness > RIGHT_ANGLE_TOLERANCE_DEG) continue;
      if (distance(points[0], points[i]) < minLength || distance(points[i], points[points.length - 1]) < minLength) continue;
      const left = fitLinePrimitive(points.slice(0, i + 1));
      const right = fitLinePrimitive(points.slice(i));
      if (left.maxError > maxLineError || right.maxError > maxLineError) continue;
      if (!best || closeness < best.closeness) best = { index: i, point: clonePoint(points[i]), closeness };
    }
    return best;
  }

  function fitLinePrimitive(points) {
    const start = clonePoint(points[0]);
    const end = clonePoint(points[points.length - 1]);
    let totalError = 0;
    let maxError = 0;
    for (const point of points) {
      const error = perpendicularDistance(point, start, end);
      totalError += error;
      maxError = Math.max(maxError, error);
    }
    return {
      start,
      end,
      avgError: totalError / Math.max(1, points.length),
      maxError,
    };
  }

  function fitArcPrimitive(points, config, tolerance) {
    if (points.length < 3) return null;
    const circle = fitCircle(points);
    if (!circle || circle.radius < MIN_PEN_ARC_RADIUS_MM) return null;
    const sweep = signedSweepAngle(points, circle.center);
    if (Math.abs(sweep) < MIN_ARC_SWEEP_DEG || Math.abs(sweep) > MAX_ARC_SWEEP_DEG) return null;

    let totalError = 0;
    let maxError = 0;
    for (const point of points) {
      const error = Math.abs(distance(point, circle.center) - circle.radius);
      totalError += error;
      maxError = Math.max(maxError, error);
    }
    const avgError = totalError / Math.max(1, points.length);
    if (avgError > tolerance || maxError > Math.max(1, tolerance * 2.5)) return null;

    const primitive = penArcToCubeArc(circle, points, sweep, config);
    if (!primitive) return null;
    return { primitive, avgError, maxError };
  }

  function fitCircle(points) {
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    let sumYY = 0;
    let sumXXX = 0;
    let sumXXY = 0;
    let sumXYY = 0;
    let sumYYY = 0;
    const n = points.length;
    for (const point of points) {
      const x = point.x;
      const y = point.y;
      const xx = x * x;
      const yy = y * y;
      sumX += x;
      sumY += y;
      sumXX += xx;
      sumXY += x * y;
      sumYY += yy;
      sumXXX += xx * x;
      sumXXY += xx * y;
      sumXYY += x * yy;
      sumYYY += yy * y;
    }
    const solution = solve3x3(
      [
        [sumXX, sumXY, sumX],
        [sumXY, sumYY, sumY],
        [sumX, sumY, n],
      ],
      [-(sumXXX + sumXYY), -(sumXXY + sumYYY), -(sumXX + sumYY)],
    );
    if (!solution) return null;
    const [d, e, f] = solution;
    const center = { x: -d / 2, y: -e / 2 };
    const radiusSq = center.x * center.x + center.y * center.y - f;
    if (!Number.isFinite(radiusSq) || radiusSq <= 0) return null;
    return { center, radius: Math.sqrt(radiusSq) };
  }

  function solve3x3(matrix, values) {
    const rows = matrix.map((row, index) => [...row, values[index]]);
    for (let col = 0; col < 3; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < 3; row += 1) {
        if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
      }
      if (Math.abs(rows[pivot][col]) < 1e-9) return null;
      if (pivot !== col) [rows[pivot], rows[col]] = [rows[col], rows[pivot]];
      const divisor = rows[col][col];
      for (let c = col; c < 4; c += 1) rows[col][c] /= divisor;
      for (let row = 0; row < 3; row += 1) {
        if (row === col) continue;
        const factor = rows[row][col];
        for (let c = col; c < 4; c += 1) rows[row][c] -= factor * rows[col][c];
      }
    }
    return [rows[0][3], rows[1][3], rows[2][3]];
  }

  function signedSweepAngle(points, center) {
    let previous = angleFrom(center, points[0]);
    let sweep = 0;
    for (let i = 1; i < points.length; i += 1) {
      const current = angleFrom(center, points[i]);
      const delta = signedAngleDelta(previous, current);
      sweep += delta;
      previous = current;
    }
    return sweep;
  }

  function penArcToCubeArc(circle, points, sweepAngle, config) {
    const startPenAngle = angleFrom(circle.center, points[0]);
    const offsetX = Number(config.penOffsetX || 0) + Number(config.rotationCenterOffsetX || 0);
    const offsetY = Number(config.penOffsetY || 0) + Number(config.rotationCenterOffsetY || 0);
    const radialSq = circle.radius * circle.radius - offsetX * offsetX;
    if (radialSq <= 0) return null;
    const radial = Math.sqrt(radialSq);
    const isPositiveSweep = sweepAngle >= 0;
    const radius = isPositiveSweep ? radial + offsetY : radial - offsetY;
    if (!Number.isFinite(radius) || radius < 1) return null;
    const angleOffset = isPositiveSweep ? radToDeg(Math.atan2(offsetX, radial)) : radToDeg(Math.atan2(-offsetX, radial));
    return {
      kind: "arc",
      center: clonePoint(circle.center),
      radius,
      startAngle: normalizeDegrees(startPenAngle - angleOffset),
      sweepAngle,
    };
  }

  function clonePoint(point) {
    return point ? { x: Number(point.x), y: Number(point.y) } : null;
  }

  function clonePrimitive(primitive) {
    if (primitive?.kind === "arc") {
      return {
        kind: "arc",
        center: clonePoint(primitive.center),
        radius: Number(primitive.radius),
        startAngle: Number(primitive.startAngle),
        sweepAngle: Number(primitive.sweepAngle),
      };
    }
    if (primitive?.kind === "line") {
      return {
        kind: "line",
        start: clonePoint(primitive.start),
        end: clonePoint(primitive.end),
      };
    }
    return { ...primitive };
  }

  function isFinitePoint(point) {
    return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
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

  function radToDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  function normalizeDegrees(value) {
    return ((value % 360) + 360) % 360;
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
    processStrokeShape,
    primitivePreviewPoints,
    computeTurnDurationMs,
    roundToMotorDurationMs,
    computeTurnWheelSpeeds,
    computeArcWheelSpeeds,
    createSimulation,
    createDeadReckoningSimulation,
    penToCube,
    cubeToPen,
    headingBetween,
    signedAngleDelta,
    distance,
    pointOnCircle,
  };
});
