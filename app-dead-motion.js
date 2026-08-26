"use strict";

(function (root) {
  function deadDrawLineMmPerSec(config) {
    return Math.max(1, Number(config.deadMmPerSecAtDrawSpeed) || 30);
  }

  function deadTravelMmPerSec(config) {
    return Math.max(1, Number(config.deadMmPerSecAtTravelSpeed) || 1);
  }

  function deadLineMotionMmPerSec(command, config) {
    const draw = command.kind === "draw";
    const baseSpeed = Math.max(1, Math.abs(Number(draw ? config.drawSpeed : config.travelSpeed) || 1));
    const baseMmPerSec = draw ? deadDrawLineMmPerSec(config) : deadTravelMmPerSec(config);
    const speed = command.speed ?? (((Number(command.leftSpeed) || 0) + (Number(command.rightSpeed) || 0)) / 2);
    return baseMmPerSec * ((Number(speed) || 0) / baseSpeed);
  }

  function deadLineMotionDistanceMm(command, config) {
    if (command.kind !== "draw" && command.kind !== "travel" && command.fromX != null && command.fromY != null && command.x != null && command.y != null) {
      return Math.hypot(command.x - command.fromX, command.y - command.fromY);
    }
    return deadLineMotionMmPerSec(command, config) * ((command.durationMs || 0) / 1000);
  }

  function deadDrawLinePreviewScale(command, baseDistance, config) {
    if (baseDistance < 0.1) return 0;
    return deadLineMotionDistanceMm(command, config) / baseDistance;
  }

  const api = {
    deadDrawLineMmPerSec,
    deadTravelMmPerSec,
    deadLineMotionMmPerSec,
    deadLineMotionDistanceMm,
    deadDrawLinePreviewScale,
  };

  root.ToioPlotterDeadMotion = api;
  if (root.window) root.window.ToioPlotterDeadMotion = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
