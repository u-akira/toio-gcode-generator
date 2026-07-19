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
    configVersion: 7,
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
  };

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

  function createSimulation({ strokes, config: configInput }) {
    const config = withDefaults(configInput);
    const bounds = safeBounds(config);
    const commands = [];
    const cubePath = [];
    const errors = [];
    const warnings = [];
    const processedStrokes = strokes.map((stroke) => ({ ...stroke, processed: processStroke(stroke.raw, config) }));
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

        for (const point of [start, end]) {
          if (!pointInBounds(point, bounds)) errors.push(`安全領域外の点があります: x=${point.x.toFixed(1)} y=${point.y.toFixed(1)}`);
        }
        for (const cube of [startCube, endCube]) {
          if (!pointInBounds(cube, MAT)) errors.push(`toio 本体の目標座標がマット外です: x=${cube.x.toFixed(1)} y=${cube.y.toFixed(1)}`);
        }

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

    return {
      commands,
      cubePath,
      processedStrokes,
      stats,
      errors: [...new Set(errors)].slice(0, 5),
      warnings: [...new Set(warnings)].slice(0, 3),
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
    processStroke,
    createSimulation,
    penToCube,
    headingBetween,
    distance,
  };
});
