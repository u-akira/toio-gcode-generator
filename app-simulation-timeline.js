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
              : lastTheta;
        if (isPlayableMoveCommand(command)) {
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
        if ((command.type === "move" || command.type === "motor") && command.penX != null) {
          lastPenPoint = { x: command.penX, y: command.penY };
        }
        if (command.type === "pen" && command.penX != null) {
          lastPenPoint = { x: command.penX, y: command.penY };
        }
      }
      return { items, durationMs: cursorMs };
    }

    function isPlayableMoveCommand(command) {
      return command.type === "move" || command.type === "rotate" || command.type === "motor" || command.type === "turn";
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
        if (elapsedMs >= item.startMs) result[result.length - 1] = partialCommand(item, elapsedMs);
        return result.filter(Boolean);
      }
      return simulation.commands;
    }

    function partialCommand(item, elapsedMs) {
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
      if ((command.type !== "move" && command.type !== "motor") || command.penX == null || !item.from) return command;
      const span = Math.max(1, item.endMs - item.startMs);
      const t = clamp((elapsedMs - item.startMs) / span, 0, 1);
      return {
        ...command,
        penX: item.from.x + (command.penX - item.from.x) * t,
        penY: item.from.y + (command.penY - item.from.y) * t,
      };
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
