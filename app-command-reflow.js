"use strict";

(function (root) {
  function createCommandReflow(deps) {
    const {
      getSimulation,
      getConfig,
      isDeadMode,
      deadMotion,
      cubeToPen,
      degToRad,
      normalizeDegrees,
    } = deps;

    function reflowDeadLineCommandPath() {
      const simulation = getSimulation();
      if (!isDeadMode() || !simulation?.commands?.length) return;
      const config = getConfig();
      let currentPen = null;
      let currentCube = null;
      let currentTheta = null;
      for (const command of simulation.commands) {
        if (command.type === "pen") {
          if (currentPen && command.penX != null) {
            command.penX = currentPen.x;
            command.penY = currentPen.y;
          } else if (command.penX != null) {
            currentPen = { x: command.penX, y: command.penY };
          }
          continue;
        }
        if (command.type === "turn") {
          if (!currentCube && command.x != null && command.y != null) currentCube = { x: command.x, y: command.y };
          if ((command.motionModel === "differential-drive" || (command.leftSpeed != null && command.rightSpeed != null)) && currentCube) {
            const start = { ...currentCube };
            const startTheta = currentTheta ?? command.startTheta ?? (command.theta - (command.angle || 0));
            const result = deadMotion.integrateDifferentialDrive(start, startTheta, command.leftSpeed, command.rightSpeed, command.durationMs, command, config);
            command.x = result.x;
            command.y = result.y;
            command.fromX = start.x;
            command.fromY = start.y;
            command.startTheta = startTheta;
            command.theta = normalizeDegrees(result.theta);
            command.angle = signedThetaDelta(startTheta, command.theta);
            command.penPreviewPoints = deadMotion.differentialPreviewPoints(start, startTheta, command.leftSpeed, command.rightSpeed, command.durationMs, command, config)
              .map((point) => cubeToPen(point, point.theta, config));
            currentCube = { x: result.x, y: result.y };
            currentTheta = command.theta;
            currentPen = cubeToPen(currentCube, currentTheta, config);
            command.penX = currentPen.x;
            command.penY = currentPen.y;
            continue;
          }
          const theta = command.theta ?? currentTheta ?? 0;
          command.theta = theta;
          if (currentCube) {
            command.x = currentCube.x;
            command.y = currentCube.y;
            currentPen = cubeToPen(currentCube, theta, config);
            command.penX = currentPen.x;
            command.penY = currentPen.y;
          }
          currentTheta = theta;
          continue;
        }
        if (command.type !== "motor") continue;
        if (command.turnInPlace && command.geometry === "arc" && command.center && command.sweepAngle != null) {
          const startCube = currentCube || { x: command.center.x, y: command.center.y };
          const startTheta = currentTheta ?? command.startTheta ?? command.theta ?? 0;
          const sweepAngle = Number(command.sweepAngle) || 0;
          const previewCount = Math.max(1, Math.ceil(Math.abs(sweepAngle) / 5));
          command.center = { x: startCube.x, y: startCube.y };
          command.fromX = startCube.x;
          command.fromY = startCube.y;
          command.x = startCube.x;
          command.y = startCube.y;
          command.startTheta = startTheta;
          command.theta = normalizeDegrees(startTheta + sweepAngle);
          command.cubePreviewPoints = [];
          command.penPreviewPoints = [];
          for (let index = 0; index <= previewCount; index += 1) {
            const theta = normalizeDegrees(startTheta + sweepAngle * index / previewCount);
            const cubePoint = { x: startCube.x, y: startCube.y, theta };
            command.cubePreviewPoints.push(cubePoint);
            command.penPreviewPoints.push(cubeToPen(cubePoint, theta, config));
          }
          currentCube = { x: startCube.x, y: startCube.y };
          currentTheta = command.theta;
          currentPen = cubeToPen(currentCube, currentTheta, config);
          command.penX = currentPen.x;
          command.penY = currentPen.y;
          continue;
        }
        if (command.geometry === "arc" || command.motionModel === "differential-drive") {
          const start = currentCube || { x: command.fromX, y: command.fromY };
          if (!start || start.x == null || start.y == null) continue;
          const startTheta = currentTheta ?? command.startTheta ?? command.theta ?? 0;
          const result = deadMotion.integrateDifferentialDrive(start, startTheta, command.leftSpeed, command.rightSpeed, command.durationMs, command, config);
          const points = deadMotion.differentialPreviewPoints(start, startTheta, command.leftSpeed, command.rightSpeed, command.durationMs, command, config);
          const deltaTheta = signedThetaDelta(startTheta, result.theta);
          // PlotterCore's public integrator intentionally returns only a pose.
          // Reflow still needs the wheel rates to rebuild the command geometry,
          // so derive them from the edited command rather than reading optional
          // metadata from the pose result.
          const leftMmPerSec = deadMotion.deadWheelMmPerSec(command.leftSpeed, command, config);
          const rightMmPerSec = deadMotion.deadWheelMmPerSec(command.rightSpeed, command, config);
          const angularRadPerSec = (leftMmPerSec - rightMmPerSec)
            / Math.max(1, Number(config.deadWheelBaseMm) || 26);
          const averageMmPerSec = (leftMmPerSec + rightMmPerSec) / 2;
          const geometry = Math.abs(angularRadPerSec) < 1e-9 ? "line" : "arc";
          command.motionModel = "differential-drive";
          command.fromX = start.x;
          command.fromY = start.y;
          command.startTheta = startTheta;
          command.x = result.x;
          command.y = result.y;
          command.theta = normalizeDegrees(result.theta);
          command.geometry = geometry;
          if (geometry === "arc" && Math.abs(averageMmPerSec) < 1e-9) {
            command.type = "turn";
            delete command.geometry;
          } else {
            command.type = "motor";
          }
          command.penPreviewPoints = points.map((point) => cubeToPen(point, point.theta, config));
          command.cubePreviewPoints = points.map((point) => ({ x: point.x, y: point.y, theta: normalizeDegrees(point.theta) }));
          if (geometry === "arc") {
            const signedRadius = averageMmPerSec / angularRadPerSec;
            command.radius = Math.abs(signedRadius);
            command.sweepAngle = deltaTheta;
            command.center = {
              x: start.x - signedRadius * Math.sin(degToRad(startTheta)),
              y: start.y + signedRadius * Math.cos(degToRad(startTheta)),
            };
            command.startAngle = Math.atan2(start.y - command.center.y, start.x - command.center.x) * 180 / Math.PI;
          } else {
            delete command.center;
            delete command.radius;
            delete command.startAngle;
            delete command.sweepAngle;
          }
          currentCube = { x: result.x, y: result.y };
          currentTheta = command.theta;
          currentPen = cubeToPen(currentCube, currentTheta, config);
          command.penX = currentPen.x;
          command.penY = currentPen.y;
          continue;
        }
        const startCube = currentCube || { x: command.fromX, y: command.fromY };
        if (!startCube || startCube.x == null || startCube.y == null) continue;
        const theta = currentTheta ?? command.startTheta ?? command.theta ?? 0;
        const distanceMm = deadMotion.deadLineMotionDistanceMm(command, config);
        const endCube = {
          x: startCube.x + Math.cos(degToRad(theta)) * distanceMm,
          y: startCube.y + Math.sin(degToRad(theta)) * distanceMm,
        };
        command.fromX = startCube.x;
        command.fromY = startCube.y;
        command.x = endCube.x;
        command.y = endCube.y;
        command.theta = theta;
        currentCube = endCube;
        currentTheta = theta;
        currentPen = cubeToPen(endCube, theta, config);
        command.penX = currentPen.x;
        command.penY = currentPen.y;
      }
    }

    function signedThetaDelta(from, to) {
      return ((to - from + 540) % 360) - 180;
    }

    return { reflowDeadLineCommandPath };
  }

  root.ToioPlotterCommandReflow = { createCommandReflow };
})(typeof globalThis !== "undefined" ? globalThis : window);
