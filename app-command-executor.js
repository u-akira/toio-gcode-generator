"use strict";

(function (root) {
  function createCommandExecutor(deps) {
    const {
      cubeToPen,
      clamp,
      normalizeDegrees,
      signedAngleDelta,
      deadMotion,
    } = deps;

    function rebasePreview(command, fromCubePose, config) {
      if (!fromCubePose || !Array.isArray(command.cubePreviewPoints) || !Array.isArray(command.penPreviewPoints)
        || !command.cubePreviewPoints.length || !command.penPreviewPoints.length) {
        return {
          ...command,
          ...(Array.isArray(command.cubePreviewPoints) ? { cubePreviewPoints: command.cubePreviewPoints.filter(Boolean) } : {}),
          ...(Array.isArray(command.penPreviewPoints) ? { penPreviewPoints: command.penPreviewPoints.filter(Boolean) } : {}),
        };
      }
      const cubePoints = command.cubePreviewPoints.filter(Boolean);
      const penPoints = command.penPreviewPoints.filter(Boolean);
      if (!cubePoints.length || !penPoints.length) return { ...command, cubePreviewPoints: [], penPreviewPoints: [] };
      const firstCube = cubePoints[0];
      const firstPen = penPoints[0];
      const cubeDelta = { x: fromCubePose.x - firstCube.x, y: fromCubePose.y - firstCube.y };
      const startTheta = firstCube.theta ?? command.startTheta ?? command.theta ?? fromCubePose.theta ?? 0;
      const targetPen = cubeToPen(fromCubePose, startTheta, config);
      const penDelta = { x: targetPen.x - firstPen.x, y: targetPen.y - firstPen.y };
      const translateCube = (point) => ({ ...point, x: point.x + cubeDelta.x, y: point.y + cubeDelta.y });
      const translatePen = (point) => ({ ...point, x: point.x + penDelta.x, y: point.y + penDelta.y });
      const cubePreviewPoints = cubePoints.map(translateCube);
      const penPreviewPoints = penPoints.map(translatePen);
      const lastCube = cubePreviewPoints.at(-1);
      const lastPen = penPreviewPoints.at(-1);
      return {
        ...command,
        fromX: fromCubePose.x,
        fromY: fromCubePose.y,
        x: lastCube.x,
        y: lastCube.y,
        theta: lastCube.theta ?? command.theta,
        penX: lastPen.x,
        penY: lastPen.y,
        cubePreviewPoints,
        penPreviewPoints,
      };
    }

    function interpolatePreview(points, progress) {
      if (!Array.isArray(points) || !points.length) return null;
      const position = (points.length - 1) * progress;
      const lowerIndex = Math.floor(position);
      const upperIndex = Math.min(points.length - 1, lowerIndex + 1);
      const amount = position - lowerIndex;
      const lower = points[lowerIndex];
      const upper = points[upperIndex];
      return {
        x: lower.x + (upper.x - lower.x) * amount,
        y: lower.y + (upper.y - lower.y) * amount,
        ...(lower.theta != null && upper.theta != null
          ? { theta: lower.theta + signedAngleDelta(lower.theta, upper.theta) * amount }
          : {}),
      };
    }

    function previewPrefix(points, progress, currentPoint) {
      if (!Array.isArray(points) || !points.length) return points;
      if (progress >= 0.995) return points;
      const lastCompletedIndex = Math.floor((points.length - 1) * progress);
      const result = points.slice(0, lastCompletedIndex + 1);
      const last = result.at(-1);
      if (!last || Math.hypot(last.x - currentPoint.x, last.y - currentPoint.y) >= 0.01) result.push(currentPoint);
      return result;
    }

    function execute(command, { fromCubePose = null, fromTheta = null, progress = 1, config }) {
      const t = clamp(Number(progress) || 0, 0, 1);

      if (command.type === "turn" && command.theta != null
        && !(command.leftSpeed != null && command.rightSpeed != null
          && command.motionModel === "differential-drive")) {
        const startTheta = fromTheta ?? fromCubePose?.theta ?? command.startTheta ?? 0;
        const theta = normalizeDegrees(startTheta + signedAngleDelta(startTheta, command.theta) * t);
        const cubePoint = fromCubePose
          ? { x: fromCubePose.x, y: fromCubePose.y }
          : { x: command.x, y: command.y };
        if (cubePoint.x == null || cubePoint.y == null) return null;
        const penPoint = cubeToPen(cubePoint, theta, config);
        return { x: cubePoint.x, y: cubePoint.y, theta, penX: penPoint.x, penY: penPoint.y };
      }

      if ((command.type === "move" || command.type === "rotate") && command.x != null && command.y != null) {
        const from = fromCubePose || { x: command.x, y: command.y, theta: fromTheta ?? command.theta ?? 0 };
        const target = { x: command.x, y: command.y, theta: command.theta ?? from.theta ?? 0 };
        let cubePoint = { x: target.x, y: target.y };
        let theta = target.theta;
        if (command.type === "rotate") {
          cubePoint = {
            x: from.x + (target.x - from.x) * t,
            y: from.y + (target.y - from.y) * t,
          };
          theta = from.theta + signedAngleDelta(from.theta, target.theta) * t;
        } else {
          const dx = target.x - from.x;
          const dy = target.y - from.y;
          const travelDistance = Math.hypot(dx, dy);
          if (travelDistance < 0.1) {
            theta = from.theta + signedAngleDelta(from.theta, target.theta) * t;
            cubePoint = { x: target.x, y: target.y };
          } else {
            const travelTheta = Math.atan2(dy, dx) * 180 / Math.PI;
            const firstTurnWeight = Math.abs(signedAngleDelta(from.theta, travelTheta)) > 1
              ? Math.abs(signedAngleDelta(from.theta, travelTheta)) / 90 * 35 : 0;
            const finalTurnWeight = Math.abs(signedAngleDelta(travelTheta, target.theta)) > 1
              ? Math.abs(signedAngleDelta(travelTheta, target.theta)) / 90 * 35 : 0;
            const totalWeight = Math.max(1, firstTurnWeight + travelDistance + finalTurnWeight);
            const firstTurnEnd = firstTurnWeight / totalWeight;
            const moveEnd = (firstTurnWeight + travelDistance) / totalWeight;
            if (t < firstTurnEnd && firstTurnEnd > 0) {
              theta = from.theta + signedAngleDelta(from.theta, travelTheta) * (t / firstTurnEnd);
              cubePoint = { x: from.x, y: from.y };
            } else if (t < moveEnd) {
              const localT = (t - firstTurnEnd) / Math.max(0.001, moveEnd - firstTurnEnd);
              cubePoint = { x: from.x + dx * localT, y: from.y + dy * localT };
              theta = travelTheta;
            } else {
              cubePoint = { x: target.x, y: target.y };
              theta = travelTheta + signedAngleDelta(travelTheta, target.theta)
                * ((t - moveEnd) / Math.max(0.001, 1 - moveEnd));
            }
          }
        }
        const penPoint = cubeToPen(cubePoint, theta, config);
        return { x: cubePoint.x, y: cubePoint.y, theta, penX: penPoint.x, penY: penPoint.y };
      }

      if (command.type === "motor" && command.kind === "travel"
        && !command.turnInPlace && command.x != null && command.y != null
        && command.fromX != null && command.fromY != null) {
        const fromCube = fromCubePose || {
          x: command.fromX,
          y: command.fromY,
          theta: command.startTheta ?? command.theta ?? 0,
        };
        const cubePoint = {
          x: fromCube.x + (command.x - fromCube.x) * t,
          y: fromCube.y + (command.y - fromCube.y) * t,
        };
        const theta = command.theta ?? fromCube.theta;
        const penPoint = cubeToPen(cubePoint, theta, config);
        return {
          fromX: fromCube.x,
          fromY: fromCube.y,
          x: cubePoint.x,
          y: cubePoint.y,
          theta,
          penX: penPoint.x,
          penY: penPoint.y,
        };
      }

      if (command.type === "motor" && command.kind === "draw" && command.geometry === "line"
        && command.x != null && command.y != null
        && command.fromX != null && command.fromY != null) {
        const fromCube = { x: command.fromX, y: command.fromY, theta: fromCubePose?.theta ?? command.startTheta ?? command.theta ?? 0 };
        const cubePoint = {
          x: fromCube.x + (command.x - fromCube.x) * t,
          y: fromCube.y + (command.y - fromCube.y) * t,
        };
        const theta = command.theta ?? fromCube.theta ?? 0;
        const penPoint = cubeToPen(cubePoint, theta, config);
        const startPenPoint = cubeToPen(fromCube, theta, config);
        return {
          fromX: fromCube.x,
          fromY: fromCube.y,
          x: cubePoint.x,
          y: cubePoint.y,
          theta,
          penX: penPoint.x,
          penY: penPoint.y,
          cubePreviewPoints: [fromCube, { ...cubePoint, theta }],
          penPreviewPoints: [startPenPoint, penPoint],
        };
      }

      if (command.type === "motor" && command.geometry !== "arc"
        && command.x != null && command.y != null
        && command.fromX != null && command.fromY != null) {
        const fromCube = fromCubePose || {
          x: command.fromX,
          y: command.fromY,
          theta: command.startTheta ?? command.theta ?? 0,
        };
        const cubePoint = {
          x: fromCube.x + (command.x - fromCube.x) * t,
          y: fromCube.y + (command.y - fromCube.y) * t,
        };
        const theta = command.theta ?? fromCube.theta ?? 0;
        const penPoint = cubeToPen(cubePoint, theta, config);
        return { ...command, x: cubePoint.x, y: cubePoint.y, theta, penX: penPoint.x, penY: penPoint.y };
      }

      if (command.type === "motor" && command.turnInPlace && command.geometry === "arc"
        && command.center && command.sweepAngle != null) {
        const executable = rebasePreview(command, fromCubePose, config);
        const startTheta = executable.startTheta ?? fromCubePose?.theta ?? 0;
        const theta = normalizeDegrees(startTheta + executable.sweepAngle * t);
        const center = executable.cubePreviewPoints?.[0]
          ? { x: executable.cubePreviewPoints[0].x, y: executable.cubePreviewPoints[0].y }
          : executable.center;
        const penPoint = cubeToPen(center, theta, config);
        return {
          ...executable,
          x: center.x,
          y: center.y,
          theta,
          penX: penPoint.x,
          penY: penPoint.y,
          cubePreviewPoints: previewPrefix(executable.cubePreviewPoints, t, { ...center, theta }),
          penPreviewPoints: previewPrefix(executable.penPreviewPoints, t, penPoint),
        };
      }

      if ((command.type === "motor" || command.type === "turn")
        && (command.kind === "travel" || command.geometry === "arc"
          || (command.kind === "draw" && command.geometry === "line")
          || (command.type === "turn" && command.leftSpeed != null && command.rightSpeed != null))
        && command.leftSpeed != null && command.rightSpeed != null
        && (command.fromX != null && command.fromY != null
          || (command.type === "turn" && command.x != null && command.y != null))) {
        const executable = rebasePreview(command, fromCubePose, config);
        const hasPreview = Array.isArray(executable.cubePreviewPoints)
          && Array.isArray(executable.penPreviewPoints)
          && executable.cubePreviewPoints.length > 1
          && executable.penPreviewPoints.length > 1;
        if (hasPreview && (command.geometry === "arc" || command.type === "turn")) {
          const cubePoint = interpolatePreview(executable.cubePreviewPoints, t);
          const penPoint = interpolatePreview(executable.penPreviewPoints, t);
          return {
            ...executable,
            x: cubePoint.x,
            y: cubePoint.y,
            theta: normalizeDegrees(cubePoint.theta ?? command.theta ?? 0),
            penX: penPoint.x,
            penY: penPoint.y,
            cubePreviewPoints: previewPrefix(executable.cubePreviewPoints, t, cubePoint),
            penPreviewPoints: previewPrefix(executable.penPreviewPoints, t, penPoint),
          };
        }
        const start = fromCubePose || {
          x: command.fromX ?? command.x,
          y: command.fromY ?? command.y,
        };
        const startTheta = fromCubePose?.theta ?? command.startTheta ?? command.theta ?? 0;
        const pose = deadMotion.integrateDifferentialDrive(
          start, startTheta, command.leftSpeed, command.rightSpeed,
          (command.durationMs || 0) * t, command, config,
        );
        const penPoint = cubeToPen(pose, pose.theta, config);
        const preview = deadMotion.differentialPreviewPoints(
          start, startTheta, command.leftSpeed, command.rightSpeed,
          (command.durationMs || 0) * t, command, config,
        ).filter(Boolean);
        return {
          ...command,
          x: pose.x,
          y: pose.y,
          theta: normalizeDegrees(pose.theta),
          penX: penPoint.x,
          penY: penPoint.y,
          cubePreviewPoints: preview.map((point) => ({ ...point, theta: normalizeDegrees(point.theta) })),
          penPreviewPoints: preview.map((point) => cubeToPen(point, point.theta, config)),
        };
      }

      if (command.type === "motor" && command.geometry === "arc"
        && command.center && command.radius != null && command.startAngle != null && command.sweepAngle != null) {
        const executable = command.fromX != null && command.fromY != null
          ? rebasePreview(command, fromCubePose, config)
          : command;
        const angle = executable.startAngle + executable.sweepAngle * t;
        const cubePoint = {
          x: executable.center.x + Math.cos(angle * Math.PI / 180) * executable.radius,
          y: executable.center.y + Math.sin(angle * Math.PI / 180) * executable.radius,
        };
        const theta = normalizeDegrees((command.startTheta ?? command.theta ?? 0) + command.sweepAngle * t);
        const penPoint = interpolatePreview(executable.penPreviewPoints, t) || cubeToPen(cubePoint, theta, config);
        return {
          ...executable,
          x: cubePoint.x,
          y: cubePoint.y,
          theta,
          penX: penPoint.x,
          penY: penPoint.y,
          cubePreviewPoints: previewPrefix(executable.cubePreviewPoints, t, { ...cubePoint, theta }),
          penPreviewPoints: previewPrefix(executable.penPreviewPoints, t, penPoint),
        };
      }

      return null;
    }

    return { execute, rebasePreview };
  }

  root.ToioPlotterCommandExecutor = { createCommandExecutor };
})(typeof globalThis !== "undefined" ? globalThis : window);
