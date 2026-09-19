"use strict";

(function (root) {
  function createCommandPreviewBuilder(deps) {
    const { getConfig, cubeToPen, commandExecutor } = deps;

      function buildDeadCommandPreview(commands) {
        const config = getConfig();
        const state = {
          penDownSegments: [],
          penUpSegments: [],
          events: [],
          waitPoints: [],
          cubePath: [],
          segmentPenPaths: new Map(),
          currentCube: null,
          currentPen: null,
          currentTheta: null,
          penState: "up",
          downPoints: [],
          upPoints: [],
        };
  
        const commandList = commands || [];
        for (let commandIndex = 0; commandIndex < commandList.length; commandIndex += 1) {
          const command = commandList[commandIndex];
          if (command.type === "pen") {
            const nextDraw = command.state === "down"
              ? nextPenDownDrawCommand(commandList, commandIndex + 1)
              : null;
            const eventPoint = nextDraw?.penPreviewPoints?.[0]
              ? { ...nextDraw.penPreviewPoints[0] }
              : commandPointOrCurrentPen(command, state);
            flushPenPreviewSegment(state, state.penState === "down");
            if (eventPoint) {
              state.events.push({ ...eventPoint, state: command.state });
              state.currentPen = eventPoint;
            }
            if (command.state === "down") state.downPoints = eventPoint ? [eventPoint] : [];
            if (command.state === "up") state.upPoints = eventPoint ? [eventPoint] : [];
            state.penState = command.state;
            continue;
          }
  
          if (command.type === "turn") {
            replayTurnCommand(command, state, config);
            continue;
          }
  
          if (command.type === "motor") {
            replayMotorCommand(command, state, config);
            continue;
          }
  
          if (command.type === "wait") {
            replayWaitCommand(command, state);
            continue;
          }
  
          if (command.type === "move" || command.type === "rotate") {
            replayPositionCommand(command, state);
          }
        }
  
        flushPenPreviewSegment(state, state.penState === "down");
        return {
          penDownSegments: state.penDownSegments,
          penUpSegments: state.penUpSegments,
          events: state.events,
          waitPoints: state.waitPoints,
          cubePath: state.cubePath,
          segmentPenPaths: state.segmentPenPaths,
          finalPenPoint: state.currentPen,
          finalCubePose: state.currentCube && { ...state.currentCube, theta: state.currentTheta || 0 },
          penState: state.penState,
        };
      }
  
      function commandPointOrCurrentPen(command, state) {
        if (command.penX != null && command.penY != null) return { x: command.penX, y: command.penY };
        if (state.currentPen) return { ...state.currentPen };
        return null;
      }

      function nextPenDownDrawCommand(commands, startIndex) {
        for (let index = startIndex; index < commands.length; index += 1) {
          const candidate = commands[index];
          if (candidate.type === "pen") return null;
          if (candidate.type === "motor" && candidate.kind === "draw" && Array.isArray(candidate.penPreviewPoints)) {
            return candidate;
          }
        }
        return null;
      }
  
      function flushPenPreviewSegment(state, down) {
        if (down && state.downPoints.length > 1) state.penDownSegments.push(state.downPoints);
        if (!down && state.upPoints.length > 1) state.penUpSegments.push(state.upPoints);
        if (down) state.downPoints = [];
        if (!down) state.upPoints = [];
      }
  
      function replayWaitCommand(command, state) {
        const point = commandPointOrCurrentPen(command, state);
        if (!point) return;
        state.currentPen = point;
        if (state.penState === "down") state.waitPoints.push(point);
      }
  
      function replayTurnCommand(command, state, config) {
        if (commandExecutor) {
          const executed = commandExecutor.execute(command, {
            fromCubePose: state.currentCube && { ...state.currentCube, theta: state.currentTheta ?? 0 },
            fromTheta: state.currentTheta,
            progress: 1,
            config,
          });
          if (executed) {
            const point = { x: executed.x, y: executed.y, theta: executed.theta };
            appendCubePreviewPoint(state, point);
            const penPoint = { x: executed.penX, y: executed.penY };
            if (state.penState === "down") appendPenPreviewPoint(state, penPoint, command.segmentId);
            else resetPenPreviewAnchor(state, penPoint);
            state.currentCube = { x: point.x, y: point.y };
            state.currentTheta = point.theta;
            state.currentPen = penPoint;
            return;
          }
        }
        return;
      }
  
      function replayMotorCommand(command, state, config) {
        if (!commandExecutor) return;
        const executed = commandExecutor.execute(command, {
          fromCubePose: state.currentCube && { ...state.currentCube, theta: state.currentTheta ?? 0 },
          fromTheta: state.currentTheta,
          progress: Number.isFinite(command.previewProgress) ? command.previewProgress : 1,
          config,
        });
        if (executed) {
          replayExecutedMotorCommand({ ...command, ...executed }, state);
        }
      }
  
      function replayExecutedMotorCommand(command, state) {
        const cubePreviewPoints = Array.isArray(command.cubePreviewPoints)
          ? command.cubePreviewPoints.filter(Boolean)
          : [];
        const penPreviewPoints = Array.isArray(command.penPreviewPoints)
          ? command.penPreviewPoints.filter(Boolean)
          : [];
        if (cubePreviewPoints.length && penPreviewPoints.length) {
          replayPreviewPointArrays({ ...command, cubePreviewPoints, penPreviewPoints }, state);
          return;
        }
        const cubePoint = finitePoint(command.x, command.y);
        if (!cubePoint) return;
        const theta = command.theta ?? state.currentTheta ?? 0;
        appendCubePreviewPoint(state, { ...cubePoint, theta });
        const penPoint = finitePoint(command.penX, command.penY) || cubeToPen({ ...cubePoint, theta }, theta, getConfig());
        appendPenPreviewPoint(state, penPoint, command.segmentId);
        state.currentCube = cubePoint;
        state.currentTheta = theta;
        state.currentPen = penPoint;
      }
  
      function replayPreviewPointArrays(command, state) {
        const cubePreviewPoints = command.cubePreviewPoints.filter(Boolean);
        const penPreviewPoints = command.penPreviewPoints.filter(Boolean);
        for (const point of cubePreviewPoints) appendCubePreviewPoint(state, point);
        for (const point of penPreviewPoints) appendPenPreviewPoint(state, point, command.segmentId);
        const lastCube = cubePreviewPoints[cubePreviewPoints.length - 1];
        const lastPen = penPreviewPoints[penPreviewPoints.length - 1];
        if (lastCube) {
          state.currentCube = { x: lastCube.x, y: lastCube.y };
          state.currentTheta = lastCube.theta ?? command.theta ?? state.currentTheta;
        }
        if (lastPen) state.currentPen = { x: lastPen.x, y: lastPen.y };
      }
  
      function replayPositionCommand(command, state) {
        if (commandExecutor) {
          const executed = commandExecutor.execute(command, {
            fromCubePose: state.currentCube && { ...state.currentCube, theta: state.currentTheta ?? 0 },
            fromTheta: state.currentTheta,
            progress: 1,
            config,
          });
          if (executed) {
            const point = { x: executed.x, y: executed.y, theta: executed.theta };
            appendCubePreviewPoint(state, point);
            const penPoint = { x: executed.penX, y: executed.penY };
            appendPenPreviewPoint(state, penPoint, command.segmentId);
            state.currentCube = { x: point.x, y: point.y };
            state.currentTheta = point.theta;
            state.currentPen = penPoint;
            return;
          }
        }
        return;
      }
  
      function appendCubePreviewPoint(state, point) {
        const previous = state.cubePath[state.cubePath.length - 1];
        if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 0.01 && Math.abs((previous.theta || 0) - (point.theta || 0)) < 0.01) return;
        state.cubePath.push(point);
      }
  
      function appendPenPreviewPoint(state, point, segmentId) {
        const target = state.penState === "down" ? state.downPoints : state.upPoints;
        const previous = target[target.length - 1];
        if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) >= 0.01) target.push(point);
        if (segmentId && state.penState === "down") {
          const segmentPath = state.segmentPenPaths.get(segmentId) || [];
          const lastSegmentPoint = segmentPath[segmentPath.length - 1];
          if (!lastSegmentPoint || Math.hypot(lastSegmentPoint.x - point.x, lastSegmentPoint.y - point.y) >= 0.01) segmentPath.push(point);
          state.segmentPenPaths.set(segmentId, segmentPath);
        }
      }
  
      function resetPenPreviewAnchor(state, point) {
        if (state.penState === "down") {
          state.downPoints = [point];
        } else {
          state.upPoints = [point];
        }
      }
  
      function finitePoint(x, y) {
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      }
  

    return { buildDeadCommandPreview };
  }

  root.ToioPlotterCommandPreview = { createCommandPreviewBuilder };
})(typeof globalThis !== "undefined" ? globalThis : window);
