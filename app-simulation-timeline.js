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
        if (command.x != null && command.y != null && command.theta != null) {
          lastCubePose = { x: command.x, y: command.y, theta: command.theta };
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
      if (!timeline.items.length) return simulation?.commands || [];
      for (const item of timeline.items) {
        if (elapsedMs >= item.endMs) {
          continue;
        }
        const endIndex = elapsedMs < item.startMs ? item.commandIndex : item.commandIndex + 1;
        const result = simulation.commands.slice(0, endIndex);
        if (elapsedMs >= item.startMs) result[result.length - 1] = partialCommand(item, elapsedMs, timeline.mode);
        return result.filter(Boolean);
      }
      return simulation.commands;
    }

    function partialCommand(item, elapsedMs, mode) {
      if (mode === "dead") return partialDeadCommand(item, elapsedMs);
      return partialPositionCommand(item, elapsedMs);
    }

    function partialDeadCommand(item, elapsedMs) {
      const command = item.command;
      const config = getConfig();
      if (command.type === "turn" && command.theta != null && item.fromTheta != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const theta = item.fromTheta + signedAngleDelta(item.fromTheta, command.theta) * t;
        const penPoint = command.x != null && command.y != null ? cubeToPen({ x: command.x, y: command.y }, theta, config) : null;
        return {
          ...command,
          theta,
          penX: penPoint ? penPoint.x : command.penX,
          penY: penPoint ? penPoint.y : command.penY,
        };
      }
      if (command.type === "motor" && command.geometry === "arc" && command.center && command.radius != null && command.startAngle != null && command.sweepAngle != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const angle = command.startAngle + command.sweepAngle * t;
        const theta = normalizeDegrees((command.startTheta ?? command.theta ?? 0) + command.sweepAngle * t);
        const cubePoint = pointOnCircle(command.center, command.radius, angle);
        const penPoint = cubeToPen(cubePoint, theta, config);
        const previewEnd = (points) => {
          if (!Array.isArray(points)) return points;
          const count = Math.max(1, Math.floor((points.length - 1) * t));
          return points.slice(0, count + 1);
        };
        return {
          ...command,
          x: cubePoint.x,
          y: cubePoint.y,
          theta,
          penX: penPoint.x,
          penY: penPoint.y,
          cubePreviewPoints: previewEnd(command.cubePreviewPoints),
          penPreviewPoints: previewEnd(command.penPreviewPoints),
        };
      }
      if (command.type === "motor" && command.x != null && command.y != null && item.fromCubePose) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const fromCube = {
          x: command.fromX ?? item.fromCubePose.x,
          y: command.fromY ?? item.fromCubePose.y,
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
      if (command.type === "motor" && command.x != null && command.y != null && command.fromX != null && command.fromY != null) {
        const span = Math.max(1, item.endMs - item.startMs);
        const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
        const cubePoint = {
          x: command.fromX + (command.x - command.fromX) * t,
          y: command.fromY + (command.y - command.fromY) * t,
        };
        const theta = command.theta || 0;
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
