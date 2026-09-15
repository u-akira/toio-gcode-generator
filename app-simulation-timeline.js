"use strict";

(function () {
  function createSimulationTimelineTools(deps) {
    const {
      getSimulation,
      getConfig,
      cubeToPen,
      clamp,
      distance,
      normalizeDegrees,
      signedAngleDelta,
      pointOnCircle,
      minTurnDurationMs,
      deadMotion,
    } = deps;

    function buildSimulationTimeline(commands) {
      const mode = simulationModeForCommands(commands);
      const config = getConfig();
      const initialTheta = Number(config.fixedHeading) || 0;
      const items = [];
      let cursorMs = 0;
      let lastPenPoint = null;
      let lastTheta = null;
      let lastCubePose = null;
      for (let index = 0; index < commands.length; index += 1) {
        const command = commands[index];
        const durationMs = commandDurationMs(command, lastPenPoint);
        const fromTheta =
          command.type === "turn" && lastTheta == null && command.angle != null
            ? command.theta - command.angle
            : command.type === "motor" && command.geometry === "arc" && command.startTheta != null
              ? command.startTheta
              : command.type === "rotate" && lastTheta == null
                ? initialTheta
                : lastTheta;
        if (isPlayableCommand(command, mode)) {
          items.push({
            command,
            commandIndex: index,
            startMs: cursorMs,
            endMs: cursorMs + durationMs,
            from: lastPenPoint,
            fromTheta,
            fromCubePose: lastCubePose,
          });
          cursorMs += durationMs;
        }
        if (command.theta != null) lastTheta = command.theta;
        if ((command.type === "motor" || command.type === "turn") && command.leftSpeed != null && command.rightSpeed != null) {
          const startPose = lastCubePose || (command.fromX != null && command.fromY != null
            ? { x: command.fromX, y: command.fromY, theta: command.startTheta ?? command.theta ?? lastTheta ?? initialTheta }
            : null);
          if (startPose) {
            const startTheta = command.startTheta ?? startPose.theta ?? lastTheta ?? initialTheta;
            if (command.x != null && command.y != null && Math.abs((command.leftSpeed || 0) - (command.rightSpeed || 0)) < 0.001) {
              lastCubePose = {
                x: command.x,
                y: command.y,
                theta: normalizeDegrees(command.theta ?? startTheta),
              };
            } else {
              const pose = deadMotion.integrateDifferentialDrive(
                { x: startPose.x, y: startPose.y },
                startTheta,
                command.leftSpeed,
                command.rightSpeed,
                command.durationMs || 0,
                command,
                config,
              );
              lastCubePose = { x: pose.x, y: pose.y, theta: normalizeDegrees(pose.theta) };
            }
          }
        } else if ((command.type === "move" || command.type === "rotate" || command.type === "motor" || command.type === "turn") && command.x != null && command.y != null) {
          lastCubePose = { x: command.x, y: command.y, theta: command.theta ?? lastTheta ?? initialTheta };
        }
        if ((command.type === "move" || command.type === "rotate" || command.type === "motor") && command.penX != null) {
          lastPenPoint = { x: command.penX, y: command.penY };
        }
        if (command.type === "pen" && command.penX != null) {
          lastPenPoint = { x: command.penX, y: command.penY };
        }
        if (command.type === "wait" && command.penX != null) {
          lastPenPoint = { x: command.penX, y: command.penY };
        }
      }
      return { items, durationMs: cursorMs, mode };
    }

    function simulationModeForCommands(commands) {
      const simulationMode = getSimulation()?.mode;
      if (simulationMode === "dead") return "dead";
      if (simulationMode === "position") return "position";
      return commands.some((command) => command.type === "motor" || command.type === "turn") ? "dead" : "position";
    }

    function isPlayableCommand(command, mode) {
      if (command.type === "wait") return true;
      if (mode === "dead") return command.type === "motor" || command.type === "turn";
      return command.type === "move" || command.type === "rotate";
    }

    function commandDurationMs(command, lastPenPoint) {
      if (command.type === "wait") return command.ms;
      if (command.type === "turn") return Math.max(minTurnDurationMs, command.durationMs || 0);
      if (command.type === "motor") return Math.max(80, command.durationMs || 0);
      if ((command.type === "move" || command.type === "rotate") && command.durationMs) return Math.max(80, command.durationMs);
      if (command.type === "move" && command.penX != null && lastPenPoint) {
        return clamp(distance(lastPenPoint, { x: command.penX, y: command.penY }) * 12, 160, 1200);
      }
      if (command.type === "rotate") return 220;
      return 80;
    }

    function rebaseCommandPreview(command, fromCubePose, config) {
      if (!fromCubePose || !Array.isArray(command.cubePreviewPoints) || !Array.isArray(command.penPreviewPoints)
        || !command.cubePreviewPoints.length || !command.penPreviewPoints.length) return command;
      const firstCube = command.cubePreviewPoints[0];
      const firstPen = command.penPreviewPoints[0];
      const cubeDelta = { x: fromCubePose.x - firstCube.x, y: fromCubePose.y - firstCube.y };
      const startTheta = firstCube.theta ?? command.startTheta ?? command.theta ?? fromCubePose.theta ?? 0;
      const targetPen = cubeToPen(fromCubePose, startTheta, config);
      const penDelta = { x: targetPen.x - firstPen.x, y: targetPen.y - firstPen.y };
      const translateCube = (point) => ({ ...point, x: point.x + cubeDelta.x, y: point.y + cubeDelta.y });
      const translatePen = (point) => ({ ...point, x: point.x + penDelta.x, y: point.y + penDelta.y });
      const cubePreviewPoints = command.cubePreviewPoints.map(translateCube);
      const penPreviewPoints = command.penPreviewPoints.map(translatePen);
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

    function normalizeCompletedCommand(command, item, config, previousPose = null) {
      const fromCubePose = previousPose || item?.fromCubePose;
      if (!fromCubePose) return command;
      if (command.type === "turn") {
        return {
          ...command,
          x: fromCubePose.x,
          y: fromCubePose.y,
        };
      }
      if (command.type === "motor" && Array.isArray(command.cubePreviewPoints)) {
        return rebaseCommandPreview(command, fromCubePose, config);
      }
      return command;
    }

    function activeCommandIndexAtElapsed(timeline, elapsedMs) {
      if (!timeline.items.length) return -1;
      const item = timeline.items.find((entry) => elapsedMs >= entry.startMs && elapsedMs < entry.endMs);
      if (item) return item.commandIndex;
      return elapsedMs >= timeline.durationMs ? lastPlayableCommandIndex(timeline) : timeline.items[0].commandIndex;
    }

    function lastPlayableCommandIndex(timeline) {
      return timeline.items[timeline.items.length - 1]?.commandIndex ?? -1;
    }

    function commandsAtElapsed(timeline, elapsedMs) {
      const simulation = getSimulation();
      const config = getConfig();
      if (!timeline.items.length) return simulation?.commands || [];
      // A command must start where the preceding command actually ended.  Do
      // not derive this from a freshly simulated previous item: that can use
      // the turn's stale metadata and create a visible teleport at the
      // boundary between travel and turn.
      const previousCommandPose = (currentItem) => {
        const previousCommand = simulation.commands
          .slice(0, currentItem.commandIndex)
          .reverse()
          .find((candidate) => candidate?.x != null && candidate?.y != null);
        return previousCommand
          ? { x: previousCommand.x, y: previousCommand.y, theta: previousCommand.theta }
          : null;
      };
      for (const item of timeline.items) {
        if (elapsedMs >= item.endMs) {
          continue;
        }
        const endIndex = elapsedMs < item.startMs ? item.commandIndex : item.commandIndex + 1;
        const result = simulation.commands.slice(0, endIndex);
        for (const completedItem of timeline.items) {
          if (completedItem.commandIndex >= endIndex) break;
          const completedCommand = result[completedItem.commandIndex];
          if (!completedCommand) continue;
          const previousPose = previousCommandPose(completedItem);
          result[completedItem.commandIndex] = normalizeCompletedCommand(completedCommand, completedItem, config, previousPose);
        }
        if (elapsedMs >= item.startMs) {
          const previousPose = previousCommandPose(item);
          const activeItem = previousPose
            ? {
                ...item,
                fromCubePose: previousPose,
                fromTheta: previousPose.theta ?? item.fromTheta,
              }
            : item;
          let partial = partialCommand(activeItem, elapsedMs, timeline.mode);
          if (previousPose && partial?.type === "motor" && partial.turnInPlace && Array.isArray(partial.cubePreviewPoints)) {
            partial = rebaseCommandPreview(partial, previousPose, config);
            partial.x = previousPose.x;
            partial.y = previousPose.y;
          }
          if (partial?.type === "turn") {
            const previousCommand = [...result.slice(0, -1)].reverse().find((candidate) => candidate?.x != null && candidate?.y != null);
            if (previousCommand) {
              partial.x = previousCommand.x;
              partial.y = previousCommand.y;
            }
          }
          if (partial?.type === "motor" && partial.turnInPlace) {
            const previousCommand = [...result.slice(0, -1)].reverse().find((candidate) => candidate?.x != null && candidate?.y != null);
            if (previousCommand) {
              partial.x = previousCommand.x;
              partial.y = previousCommand.y;
            }
          }
          result[result.length - 1] = partial;
        }
        return result.filter(Boolean);
      }
      return simulation.commands.map((command, commandIndex) => {
        const item = timeline.items.find((candidate) => candidate.commandIndex === commandIndex);
        const currentItem = timeline.items.find((candidate) => candidate.commandIndex === commandIndex);
        const previousPose = currentItem ? previousCommandPose(currentItem) : null;
        return normalizeCompletedCommand(command, item, config, previousPose);
      });
    }

    function partialCommand(item, elapsedMs, mode) {
      if (mode === "dead") return partialDeadCommand(item, elapsedMs);
      return partialPositionCommand(item, elapsedMs);
    }

    function partialDeadCommand(item, elapsedMs) {
      const command = item.command;
      const config = getConfig();
      if (command.type === "motor" && command.turnInPlace && command.geometry === "arc" && command.center && command.sweepAngle != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const executableCommand = rebaseCommandPreview(command, item.fromCubePose, config);
        const startTheta = executableCommand.startTheta ?? item.fromCubePose?.theta ?? 0;
        const theta = normalizeDegrees(startTheta + executableCommand.sweepAngle * t);
        const center = executableCommand.cubePreviewPoints?.[0]
          ? { x: executableCommand.cubePreviewPoints[0].x, y: executableCommand.cubePreviewPoints[0].y }
          : { x: executableCommand.center.x, y: executableCommand.center.y };
        const penPoint = cubeToPen(center, theta, config);
        const previewEnd = (points, currentPoint) => {
          if (!Array.isArray(points) || !points.length) return points;
          if (t >= 0.995) return points;
          const lastCompletedIndex = Math.floor((points.length - 1) * t);
          const result = points.slice(0, lastCompletedIndex + 1);
          const last = result[result.length - 1];
          if (!last || Math.hypot(last.x - currentPoint.x, last.y - currentPoint.y) >= 0.01) result.push(currentPoint);
          return result;
        };
        return {
          ...executableCommand,
          x: center.x,
          y: center.y,
          theta,
          penX: penPoint.x,
          penY: penPoint.y,
          cubePreviewPoints: previewEnd(executableCommand.cubePreviewPoints, { ...center, theta }),
          penPreviewPoints: previewEnd(executableCommand.penPreviewPoints, penPoint),
        };
      }
      if (command.type === "motor" && command.kind === "travel" && command.geometry === "line" && !command.turnInPlace
        && command.x != null && command.y != null && command.fromX != null && command.fromY != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const fromCube = item.fromCubePose || {
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
          ...command,
          fromX: fromCube.x,
          fromY: fromCube.y,
          x: cubePoint.x,
          y: cubePoint.y,
          theta,
          penX: penPoint.x,
          penY: penPoint.y,
        };
      }
      if (command.type === "turn" && command.angle != null && Math.abs(command.angle) > 0.001
        && command.theta != null && item.fromTheta != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const theta = normalizeDegrees(item.fromTheta + signedAngleDelta(item.fromTheta, command.theta) * t);
        const cubePoint = item.fromCubePose
          ? { x: item.fromCubePose.x, y: item.fromCubePose.y }
          : { x: command.x, y: command.y };
        const penPoint = cubeToPen(cubePoint, theta, config);
        return {
          ...command,
          x: cubePoint.x,
          y: cubePoint.y,
          theta,
          penX: penPoint.x,
          penY: penPoint.y,
        };
      }
      if ((command.type === "turn" || command.type === "motor") && (command.motionModel === "differential-drive" || (command.type === "turn" && command.leftSpeed != null && command.rightSpeed != null)) && (command.fromX != null || (command.type === "turn" && command.x != null))) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const interpolatePreviewPoint = (points) => {
          if (!Array.isArray(points) || !points.length) return null;
          const position = (points.length - 1) * t;
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
        };
        const hasCommandPreview = Array.isArray(command.cubePreviewPoints)
          && Array.isArray(command.penPreviewPoints)
          && command.cubePreviewPoints.length > 1
          && command.penPreviewPoints.length > 1;
        if (hasCommandPreview) {
          const executableCommand = rebaseCommandPreview(command, item.fromCubePose, config);
          const currentCube = interpolatePreviewPoint(executableCommand.cubePreviewPoints);
          const currentPen = interpolatePreviewPoint(executableCommand.penPreviewPoints);
          const previewEnd = (points, currentPoint) => {
            const lastCompletedIndex = Math.floor((points.length - 1) * t);
            if (t >= 0.995) return points;
            const result = points.slice(0, lastCompletedIndex + 1);
            const last = result[result.length - 1];
            if (!last || Math.hypot(last.x - currentPoint.x, last.y - currentPoint.y) >= 0.01) result.push(currentPoint);
            return result;
          };
          return {
            ...executableCommand,
            x: currentCube.x,
            y: currentCube.y,
            theta: normalizeDegrees(currentCube.theta ?? command.theta ?? 0),
            penX: currentPen.x,
            penY: currentPen.y,
            cubePreviewPoints: previewEnd(executableCommand.cubePreviewPoints, currentCube),
            penPreviewPoints: previewEnd(executableCommand.penPreviewPoints, currentPen),
          };
        }
        const theta = command.startTheta ?? command.theta ?? item.fromTheta ?? 0;
        const start = item.fromCubePose
          ? { x: item.fromCubePose.x, y: item.fromCubePose.y }
          : {
              x: command.fromX ?? command.x,
              y: command.fromY ?? command.y,
            };
        const isStraightCommand = command.kind === "travel"
          && command.geometry === "line"
          && !command.turnInPlace
          && command.x != null
          && command.y != null;
        const pose = isStraightCommand
          ? {
              x: start.x + (command.x - start.x) * t,
              y: start.y + (command.y - start.y) * t,
              theta,
            }
          : deadMotion.integrateDifferentialDrive(
              start,
              theta,
              command.leftSpeed,
              command.rightSpeed,
              (command.durationMs || 0) * t,
              command,
              config,
            );
        const penPoint = cubeToPen(pose, pose.theta, config);
        const preview = isStraightCommand
          ? [{ x: start.x, y: start.y, theta }, { x: pose.x, y: pose.y, theta }]
          : deadMotion.differentialPreviewPoints(
              start, theta, command.leftSpeed, command.rightSpeed,
              (command.durationMs || 0) * t, command, config,
            );
        return {
          ...command,
          x: pose.x,
          y: pose.y,
          theta: normalizeDegrees(pose.theta),
          penX: penPoint.x,
          penY: penPoint.y,
          cubePreviewPoints: preview.map((point) => ({ x: point.x, y: point.y, theta: normalizeDegrees(point.theta) })),
          penPreviewPoints: preview.map((point) => cubeToPen(point, point.theta, config)),
        };
      }
      if (command.type === "turn" && command.theta != null && item.fromTheta != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const theta = item.fromTheta + signedAngleDelta(item.fromTheta, command.theta) * t;
        const cubePoint = item.fromCubePose
          ? { x: item.fromCubePose.x, y: item.fromCubePose.y }
          : command.x != null && command.y != null
            ? { x: command.x, y: command.y }
            : null;
        const penPoint = cubePoint ? cubeToPen(cubePoint, theta, config) : null;
        return {
          ...command,
          ...(cubePoint ? { x: cubePoint.x, y: cubePoint.y } : {}),
          theta,
          penX: penPoint ? penPoint.x : command.penX,
          penY: penPoint ? penPoint.y : command.penY,
        };
      }
      if (command.type === "motor" && command.geometry === "arc" && (command.cubeCenter || command.center) && (command.cubeRadius ?? command.radius) != null && (command.cubeStartAngle ?? command.startAngle) != null && command.sweepAngle != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const center = command.cubeCenter || command.center;
        const radius = command.cubeRadius ?? command.radius;
        const startAngle = command.cubeStartAngle ?? command.startAngle;
        const angle = startAngle + command.sweepAngle * t;
        const theta = normalizeDegrees((command.startTheta ?? command.theta ?? 0) + command.sweepAngle * t);
        const cubePoint = pointOnCircle(center, radius, angle);
        const penPoint = cubeToPen(cubePoint, theta, config);
        const previewEnd = (points, currentPoint) => {
          if (!Array.isArray(points)) return points;
          if (!points.length || !currentPoint) return points;
          if (t >= 0.995) return points;
          const lastCompletedIndex = Math.floor((points.length - 1) * t);
          const result = points.slice(0, lastCompletedIndex + 1);
          const last = result[result.length - 1];
          if (!last || Math.hypot(last.x - currentPoint.x, last.y - currentPoint.y) >= 0.01) result.push(currentPoint);
          return result;
        };
        return {
          ...command,
          x: cubePoint.x,
          y: cubePoint.y,
          theta,
          penX: penPoint.x,
          penY: penPoint.y,
          cubePreviewPoints: previewEnd(command.cubePreviewPoints, { ...cubePoint, theta }),
          penPreviewPoints: previewEnd(command.penPreviewPoints, penPoint),
        };
      }
      if (command.type === "motor" && command.leftSpeed != null && command.rightSpeed != null && command.fromX != null && command.fromY != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const startTheta = item.fromCubePose?.theta ?? command.startTheta ?? command.theta ?? 0;
        const pose = deadMotion.integrateDifferentialDrive(
          item.fromCubePose || { x: command.fromX, y: command.fromY },
          startTheta,
          command.leftSpeed,
          command.rightSpeed,
          (command.durationMs || 0) * t,
          command,
          config,
        );
        const penPoint = cubeToPen(pose, pose.theta, config);
        return {
          ...command,
          x: pose.x,
          y: pose.y,
          theta: normalizeDegrees(pose.theta),
          penX: penPoint.x,
          penY: penPoint.y,
          cubePreviewPoints: null,
          penPreviewPoints: null,
        };
      }
      if (command.type === "motor" && command.x != null && command.y != null && command.fromX != null && command.fromY != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const fromCube = item.fromCubePose
          ? { ...item.fromCubePose }
          : {
              x: command.fromX,
              y: command.fromY,
              theta: command.startTheta ?? command.theta ?? 0,
            };
        const theta = command.theta ?? fromCube.theta;
        const cubePoint = {
          x: fromCube.x + (command.x - fromCube.x) * t,
          y: fromCube.y + (command.y - fromCube.y) * t,
        };
        const penPoint = cubeToPen(cubePoint, theta, config);
        return {
          ...command,
          fromX: fromCube.x,
          fromY: fromCube.y,
          x: cubePoint.x,
          y: cubePoint.y,
          theta,
          penX: penPoint.x,
          penY: penPoint.y,
        };
      }
      if (command.type === "motor" && command.x != null && command.y != null && item.fromCubePose) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const fromCube = {
          x: item.fromCubePose.x,
          y: item.fromCubePose.y,
          theta: item.fromCubePose.theta,
        };
        const cubePoint = {
          x: fromCube.x + (command.x - fromCube.x) * t,
          y: fromCube.y + (command.y - fromCube.y) * t,
        };
        const theta = command.theta ?? fromCube.theta;
        const penPoint = cubeToPen(cubePoint, theta, config);
        return { ...command, x: cubePoint.x, y: cubePoint.y, theta, penX: penPoint.x, penY: penPoint.y };
      }
      return command;
    }

    function partialPositionCommand(item, elapsedMs) {
      const command = item.command;
      const config = getConfig();
      if (command.type === "rotate" && command.x != null && command.y != null && command.theta != null && item.fromTheta != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const cubePoint = item.fromCubePose
          ? {
              x: item.fromCubePose.x + (command.x - item.fromCubePose.x) * t,
              y: item.fromCubePose.y + (command.y - item.fromCubePose.y) * t,
            }
          : { x: command.x, y: command.y };
        const theta = item.fromTheta + signedAngleDelta(item.fromTheta, command.theta) * t;
        const penPoint = cubeToPen(cubePoint, theta, config);
        return { ...command, x: cubePoint.x, y: cubePoint.y, theta, penX: penPoint.x, penY: penPoint.y };
      }
      if (command.type === "move" && command.x != null && command.y != null && command.theta != null && item.fromCubePose) {
        return partialPositionMoveCommand(command, item, elapsedMs, config);
      }
      if (command.type !== "move" || command.penX == null || !item.from) return command;
      const span = Math.max(1, item.endMs - item.startMs);
      const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
      return {
        ...command,
        penX: item.from.x + (command.penX - item.from.x) * t,
        penY: item.from.y + (command.penY - item.from.y) * t,
      };
    }

    function partialPositionMoveCommand(command, item, elapsedMs, config) {
      const span = Math.max(1, item.endMs - item.startMs);
      const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
      const from = item.fromCubePose;
      const target = { x: command.x, y: command.y, theta: command.theta };
      const dx = target.x - from.x;
      const dy = target.y - from.y;
      const travelDistance = Math.hypot(dx, dy);
      if (travelDistance < 0.1) {
        const theta = from.theta + signedAngleDelta(from.theta, target.theta) * t;
        const penPoint = cubeToPen(target, theta, config);
        return { ...command, x: target.x, y: target.y, theta, penX: penPoint.x, penY: penPoint.y };
      }

      const travelTheta = normalizeDegrees((Math.atan2(dy, dx) * 180) / Math.PI);
      const firstTurnAngle = Math.abs(signedAngleDelta(from.theta, travelTheta));
      const finalTurnAngle = Math.abs(signedAngleDelta(travelTheta, target.theta));
      const firstTurnWeight = firstTurnAngle > 1 ? (firstTurnAngle / 90) * 35 : 0;
      const finalTurnWeight = finalTurnAngle > 1 ? (finalTurnAngle / 90) * 35 : 0;
      const totalWeight = Math.max(1, firstTurnWeight + travelDistance + finalTurnWeight);
      const firstTurnEnd = firstTurnWeight / totalWeight;
      const moveEnd = (firstTurnWeight + travelDistance) / totalWeight;

      let cubePoint = { x: from.x, y: from.y };
      let theta = from.theta;
      if (t < firstTurnEnd && firstTurnEnd > 0) {
        const localT = t / firstTurnEnd;
        theta = from.theta + signedAngleDelta(from.theta, travelTheta) * localT;
      } else if (t < moveEnd) {
        const localT = (t - firstTurnEnd) / Math.max(0.001, moveEnd - firstTurnEnd);
        cubePoint = {
          x: from.x + dx * localT,
          y: from.y + dy * localT,
        };
        theta = travelTheta;
      } else {
        const localT = (t - moveEnd) / Math.max(0.001, 1 - moveEnd);
        cubePoint = { x: target.x, y: target.y };
        theta = travelTheta + signedAngleDelta(travelTheta, target.theta) * localT;
      }

      const penPoint = cubeToPen(cubePoint, theta, config);
      return { ...command, x: cubePoint.x, y: cubePoint.y, theta, penX: penPoint.x, penY: penPoint.y };
    }

    function timelineItemForCommand(timeline, commandIndex) {
      return timeline.items.find((item) => item.commandIndex === commandIndex) || null;
    }

    return {
      buildSimulationTimeline,
      commandDurationMs,
      activeCommandIndexAtElapsed,
      lastPlayableCommandIndex,
      commandsAtElapsed,
      timelineItemForCommand,
    };
  }

  window.ToioPlotterTimeline = {
    createSimulationTimelineTools,
  };
})();
