"use strict";

(function () {
  function createSimulationTimelineTools(deps) {
    const {
      getSimulation,
      getConfig,
      clamp,
      distance,
      normalizeDegrees,
      minTurnDurationMs,
      commandExecutor,
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
            const executed = commandExecutor?.execute(command, {
              fromCubePose: { x: startPose.x, y: startPose.y, theta: startTheta },
              fromTheta: startTheta,
              progress: 1,
              config,
            });
            if (executed?.x != null && executed?.y != null) {
              lastCubePose = {
                x: executed.x,
                y: executed.y,
                theta: normalizeDegrees(executed.theta ?? command.theta ?? startTheta),
              };
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
        return commandExecutor.rebasePreview(command, fromCubePose, config);
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
            partial = commandExecutor.rebasePreview(partial, previousPose, config);
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
      const span = Math.max(1, item.endMs - item.startMs);
      const executed = commandExecutor?.execute(command, {
        fromCubePose: item.fromCubePose,
        fromTheta: item.fromTheta,
        progress: (elapsedMs - item.startMs) / span,
        config: getConfig(),
      });
      return executed ? { ...command, ...executed } : command;
    }

    function partialPositionCommand(item, elapsedMs) {
      const command = item.command;
      const positionSpan = Math.max(1, item.endMs - item.startMs);
      const executed = commandExecutor?.execute(command, {
        fromCubePose: item.fromCubePose,
        fromTheta: item.fromTheta,
        progress: (elapsedMs - item.startMs) / positionSpan,
        config: getConfig(),
      });
      if (executed) return { ...command, ...executed };
      return command;
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
