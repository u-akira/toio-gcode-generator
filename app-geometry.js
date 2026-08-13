(function (root) {
  "use strict";

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

  function rotatePoint(point, angleDeg) {
    const angle = degToRad(angleDeg);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
    };
  }

  function normalizeDegrees(value) {
    return ((value % 360) + 360) % 360;
  }

  function pointInBounds(point, bounds) {
    return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
  }

  root.ToioPlotterGeometry = {
    distance,
    turnAngle,
    clamp,
    degToRad,
    rotatePoint,
    normalizeDegrees,
    pointInBounds,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
