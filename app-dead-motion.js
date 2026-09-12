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

  function deadWheelMmPerSec(speed, command, config) {
    const draw = command.kind === "draw";
    const baseSpeed = Math.max(1, Math.abs(Number(draw ? config.drawSpeed : config.travelSpeed) || 1));
    const baseMmPerSec = draw
      ? command.geometry === "arc" ? deadArcMmPerSecAtDrawSpeed(config) : deadDrawLineMmPerSec(config)
      : deadTravelMmPerSec(config);
    return baseMmPerSec * (Number(speed) || 0) / baseSpeed;
  }

  function deadArcMmPerSecAtDrawSpeed(config) {
    return Math.max(1, Number(config.deadArcMmPerSecAtDrawSpeed) || deadDrawLineMmPerSec(config));
  }

  function integrateDifferentialDrive(start, thetaDeg, leftSpeed, rightSpeed, durationMs, command, config) {
    const wheelBase = Math.max(1, Number(config.deadWheelBaseMm) || 26);
    const left = deadWheelMmPerSec(leftSpeed, command, config);
    const right = deadWheelMmPerSec(rightSpeed, command, config);
    const durationSec = Math.max(0, Number(durationMs) || 0) / 1000;
    const theta = (Number(thetaDeg) || 0) * Math.PI / 180;
    let linear = (left + right) / 2;
    let angular = (left - right) / wheelBase;
    if (command.type === "turn") {
      const turnSpeed = Math.max(1, Math.abs(Number(config.deadTurnSpeed) || 8));
      const msPer90 = Math.max(150, Number(config.deadTurnMsPer90) || 1023);
      linear = 0;
      angular = ((Number(leftSpeed) || 0) - (Number(rightSpeed) || 0)) / 2 / turnSpeed * (Math.PI / 2) / (msPer90 / 1000);
    }
    let x = Number(start.x) || 0;
    let y = Number(start.y) || 0;
    let endTheta = theta;
    if (Math.abs(angular) < 1e-9) {
      x += linear * durationSec * Math.cos(theta);
      y += linear * durationSec * Math.sin(theta);
    } else {
      const radius = linear / angular;
      endTheta = theta + angular * durationSec;
      x += radius * (Math.sin(endTheta) - Math.sin(theta));
      y += radius * (-Math.cos(endTheta) + Math.cos(theta));
    }
    return { x, y, theta: endTheta * 180 / Math.PI, leftMmPerSec: left, rightMmPerSec: right, angularRadPerSec: angular };
  }

  function differentialPreviewPoints(start, thetaDeg, leftSpeed, rightSpeed, durationMs, command, config, count = 32) {
    const points = [];
    const steps = Math.max(2, count);
    for (let i = 0; i <= steps; i += 1) {
      points.push(integrateDifferentialDrive(start, thetaDeg, leftSpeed, rightSpeed, (durationMs || 0) * i / steps, command, config));
    }
    return points;
  }

  const api = {
    deadDrawLineMmPerSec,
    deadTravelMmPerSec,
    deadLineMotionMmPerSec,
    deadLineMotionDistanceMm,
    deadDrawLinePreviewScale,
    deadArcMmPerSecAtDrawSpeed,
    deadWheelMmPerSec,
    integrateDifferentialDrive,
    differentialPreviewPoints,
  };

  root.ToioPlotterDeadMotion = api;
  if (root.window) root.window.ToioPlotterDeadMotion = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
