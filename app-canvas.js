(function (root) {
  "use strict";

  function createCanvasRenderer(deps) {
    const {
      MAT,
      COLORS,
      canvas,
      ctx,
      playMatImage,
      getConfig,
      getStrokes,
      getActiveStroke,
      getSimulation,
      getSimulationValid,
      getSimulationAnimation,
      getAnimatedCommands,
      getDeadSegments,
      getSelectedDeadSegmentId,
      getMovePoseStatus,
      getLegendVisible,
      isDeadMode,
      safeBounds,
      nativeToMatPose,
      penToCube,
      cubeToPen,
      distance,
      degToRad,
      primitivePreviewPoints,
    } = deps;

    const A3_PREVIEW_WIDTH_MM = 420;
    const A3_PREVIEW_HEIGHT_MM = 297;
    function getDrawingBounds() {
      if (isDeadMode()) {
        const centerX = (MAT.minX + MAT.maxX) / 2;
        const centerY = (MAT.minY + MAT.maxY) / 2;
        return {
          minX: centerX - A3_PREVIEW_WIDTH_MM / 2,
          maxX: centerX + A3_PREVIEW_WIDTH_MM / 2,
          minY: centerY - A3_PREVIEW_HEIGHT_MM / 2,
          maxY: centerY + A3_PREVIEW_HEIGHT_MM / 2,
        };
      }
      return MAT;
    }

    function syncCanvasBackingStore() {
      const rect = canvas.getBoundingClientRect();
      const dpr = root.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function getView() {
      const width = canvas.width;
      const height = canvas.height;
      const bounds = getDrawingBounds();
      const matW = bounds.maxX - bounds.minX;
      const matH = bounds.maxY - bounds.minY;
      const margin = 42 * (root.devicePixelRatio || 1);
      const scale = Math.min((width - margin * 2) / matW, (height - margin * 2) / matH);
      const drawW = matW * scale;
      const drawH = matH * scale;
      return {
        scale,
        left: (width - drawW) / 2,
        top: (height - drawH) / 2,
        width: drawW,
        height: drawH,
      };
    }

    function matToCanvas(point) {
      const view = getView();
      const bounds = getDrawingBounds();
      return {
        x: view.left + (point.x - bounds.minX) * view.scale,
        y: view.top + (point.y - bounds.minY) * view.scale,
      };
    }

    function canvasToMat(clientX, clientY) {
      syncCanvasBackingStore();
      const rect = canvas.getBoundingClientRect();
      const dpr = root.devicePixelRatio || 1;
      const x = (clientX - rect.left) * dpr;
      const y = (clientY - rect.top) * dpr;
      const view = getView();
      const bounds = getDrawingBounds();
      return {
        x: bounds.minX + (x - view.left) / view.scale,
        y: bounds.minY + (y - view.top) / view.scale,
      };
    }

    function draw({ playMatImageLoaded = false } = {}) {
      syncCanvasBackingStore();
      const simulation = getSimulation();
      canvas.style.cursor = isDeadMode() && getSimulationValid() && getDeadSegments().length ? "pointer" : "crosshair";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawMat(playMatImageLoaded);
      if (!simulation) {
        for (const stroke of getStrokes()) {
          drawSourceStroke(stroke);
        }
      }
      const activeStroke = getActiveStroke();
      if (activeStroke) drawStroke(activeStroke.raw, COLORS.drawing, 2.2);
      if (simulation) {
        const animatedCommands = getAnimatedCommands();
        const deadPreview = isDeadMode() ? buildDeadCommandPreview(animatedCommands) : null;
        const simulationAnimation = getSimulationAnimation();
        if (deadPreview) {
          drawCubePath(deadPreview.cubePath);
          drawDeadSegmentSelectionOverlay(deadPreview);
          drawCommandPreview(deadPreview);
          if (!simulationAnimation) drawCubeHeadingMarkers(deadPreview.cubePath);
        } else {
          drawDeadSegmentSelectionOverlay(null);
          drawCommands(animatedCommands);
        }
        if (simulationAnimation) {
          deadPreview ? drawAnimationCursorFromPreview(deadPreview) : drawAnimationCursor(animatedCommands);
        } else if (!deadPreview) {
          drawCubePath(simulation.cubePath);
        }
      }
      const poseStatus = getMovePoseStatus();
      if (!isDeadMode() && poseStatus.pose && poseStatus.state !== "missed") {
        drawCubePose(nativeToMatPose(poseStatus.pose), COLORS.liveCube, poseStatus.state === "unstable" ? 0.42 : 1, true);
      }
      if (getLegendVisible()) drawLegend();
    }

    function drawSourceStroke(stroke) {
      if (stroke.source === "freehand" && Array.isArray(stroke.primitives) && stroke.primitives.length) {
        drawStroke(stroke.raw, "rgba(32, 33, 36, 0.22)", 1.4);
        drawStroke(primitivesPreviewPoints(stroke.primitives), COLORS.drawing, 2.2);
        return;
      }
      if (isDeadMode() && Array.isArray(stroke.primitives) && stroke.primitives.length) return;
      drawStroke(stroke.processed || stroke.raw, COLORS.drawing, 2.2);
    }

    function primitivesPreviewPoints(primitives) {
      const result = [];
      for (const primitive of primitives) {
        const points = primitivePreviewPoints(primitive, getConfig());
        if (!points.length) continue;
        if (result.length && distance(result[result.length - 1], points[0]) < 0.1) points.shift();
        result.push(...points);
      }
      return result;
    }

    function drawDeadSegmentSelectionOverlay(deadPreview) {
      const segments = getDeadSegments();
      if (!isDeadMode() || !segments.length) return;
      const selectedId = getSelectedDeadSegmentId();
      for (const segment of segments) {
        drawSegmentHighlight(segment, segment.id === selectedId, deadPreview);
      }
    }

    function drawSegmentHighlight(segment, selected, deadPreview) {
      const dpr = root.devicePixelRatio || 1;
      const points = segmentPenPoints(segment, deadPreview).map(matToCanvas);
      if (points.length < 2) return;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = selected ? "rgba(124, 58, 237, 0.72)" : "rgba(124, 58, 237, 0.16)";
      ctx.lineWidth = (selected ? 2.1 : 1.1) * dpr;
      if (segment.kind === "travel") ctx.setLineDash([8 * dpr, 7 * dpr]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      ctx.restore();
    }

    function segmentPenPoints(segment, deadPreview) {
      const previewPath = deadPreview?.segmentPenPaths?.get(segment.id);
      if (previewPath?.length) return previewPath;
      if (segment.geometry === "arc" && Array.isArray(segment.penPreviewPoints)) return segment.penPreviewPoints;
      if (isDeadMode() && segment.kind === "draw" && segment.geometry === "line") return deadCommandLinePoints(currentSegmentDrawCommand(segment)) || [segment.start, segment.end].filter(Boolean);
      return [segment.start, segment.end].filter(Boolean);
    }

    function currentSegmentDrawCommand(segment) {
      return getSimulation()?.commands?.find(
        (command) => command.type === "motor" && command.kind === "draw" && command.geometry === "line" && command.segmentId === segment.id,
      );
    }

    function deadCommandLinePoints(command) {
      if (!command || command.fromX == null || command.fromY == null || command.penX == null) return null;
      const theta = command.startTheta ?? command.theta ?? 0;
      return [
        cubeToPen({ x: command.fromX, y: command.fromY }, theta, getConfig()),
        { x: command.penX, y: command.penY },
      ];
    }

    function drawMat(playMatImageLoaded) {
      const bounds = getDrawingBounds();
      const p1 = matToCanvas({ x: bounds.minX, y: bounds.minY });
      const p2 = matToCanvas({ x: bounds.maxX, y: bounds.maxY });
      ctx.save();
      ctx.lineWidth = 1.5 * (root.devicePixelRatio || 1);
      ctx.strokeStyle = "#9d9588";
      ctx.fillStyle = "#fffdf8";
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      if (!isDeadMode() && playMatImageLoaded) {
        ctx.drawImage(playMatImage, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      }
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

      let label = "A3 simple play mat #01 (Position ID)";
      const safe = getSafeDrawingBounds();
      const s1 = matToCanvas({ x: safe.minX, y: safe.minY });
      const s2 = matToCanvas({ x: safe.maxX, y: safe.maxY });
      ctx.setLineDash([8, 7]);
      ctx.strokeStyle = "#0f7b6c";
      ctx.strokeRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y);
      ctx.setLineDash([]);
      ctx.fillStyle = "#6c6f73";
      ctx.font = `${12 * (root.devicePixelRatio || 1)}px system-ui`;
      ctx.fillText("safe drawing area", s1.x + 10, s1.y + 18);

      if (isDeadMode()) label = "Dead reckoning preview (same drawing coordinates)";

      ctx.fillStyle = "#6c6f73";
      ctx.font = `${12 * (root.devicePixelRatio || 1)}px system-ui`;
      ctx.fillText(label, p1.x + 10, p1.y + 18);
      ctx.restore();
    }

    function getSafeDrawingBounds() {
      if (!isDeadMode()) return safeBounds();
      const bounds = getDrawingBounds();
      const scale = Math.max(0.5, Math.min(1, Number(getConfig().safeScale) || 0.75));
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const halfW = ((bounds.maxX - bounds.minX) * scale) / 2;
      const halfH = ((bounds.maxY - bounds.minY) * scale) / 2;
      return {
        minX: centerX - halfW,
        maxX: centerX + halfW,
        minY: centerY - halfH,
        maxY: centerY + halfH,
      };
    }

    function drawStroke(points, color, width, dash = null) {
      if (!points || points.length < 2) return;
      ctx.save();
      ctx.lineWidth = width * (root.devicePixelRatio || 1);
      ctx.strokeStyle = color;
      if (dash) ctx.setLineDash(dash.map((value) => value * (root.devicePixelRatio || 1)));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const first = matToCanvas(points[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < points.length; i += 1) {
        const point = matToCanvas(points[i]);
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawCommands(commands) {
      const downSegments = [];
      const upSegments = [];
      const events = [];
      const waitPoints = [];
      let downPoints = [];
      let upPoints = [];
      let penDown = false;
      let lastPenPoint = null;
      for (const command of commands) {
        if (command.type === "pen") {
          const eventPoint = command.penX == null ? null : { x: command.penX, y: command.penY };
          if (eventPoint) {
            events.push({ ...eventPoint, state: command.state });
            lastPenPoint = eventPoint;
          }
          if (penDown && command.state === "up" && downPoints.length > 1) downSegments.push(downPoints);
          if (!penDown && command.state === "down" && upPoints.length > 1) upSegments.push(upPoints);
          if (command.state === "down") downPoints = eventPoint ? [eventPoint] : [];
          if (command.state === "up") upPoints = eventPoint ? [eventPoint] : [];
          penDown = command.state === "down";
        }
        if (command.type === "motor" && command.geometry === "arc" && Array.isArray(command.penPreviewPoints)) {
          for (const point of command.penPreviewPoints) {
            if (penDown) {
              downPoints.push(point);
            } else {
              if (!upPoints.length && lastPenPoint) upPoints.push(lastPenPoint);
              upPoints.push(point);
            }
            lastPenPoint = point;
          }
        } else if ((command.type === "move" || command.type === "motor") && command.penX != null) {
          const point = { x: command.penX, y: command.penY };
          if (penDown) {
            downPoints.push(point);
          } else {
            if (!upPoints.length && lastPenPoint) upPoints.push(lastPenPoint);
            upPoints.push(point);
          }
          lastPenPoint = point;
        } else if (command.type === "wait") {
          const point = command.penX != null && command.penY != null ? { x: command.penX, y: command.penY } : lastPenPoint;
          if (penDown && point) waitPoints.push(point);
          if (point) lastPenPoint = point;
        }
      }
      if (penDown && downPoints.length > 1) downSegments.push(downPoints);
      if (!penDown && upPoints.length > 1) upSegments.push(upPoints);
      for (const segment of upSegments) drawStroke(segment, COLORS.penTravel, 1.25, [5, 5]);
      for (const segment of downSegments) drawStroke(segment, COLORS.penSimulation, 1.6);
      for (const event of events) drawPenEvent(event);
      for (const point of waitPoints) drawWaitPoint(point);
    }

    function drawCommandPreview(preview) {
      for (const segment of preview.penUpSegments) drawStroke(segment, "rgba(107, 114, 128, 0.42)", 1.1, [5, 5]);
      for (const segment of preview.penDownSegments) drawStroke(segment, COLORS.penSimulation, 3.2);
      for (const event of preview.events) drawPenEvent(event);
      for (const point of preview.waitPoints) drawWaitPoint(point);
    }

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

      for (const command of commands || []) {
        if (command.type === "pen") {
          const eventPoint = commandPointOrCurrentPen(command, state);
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
      const theta = command.theta ?? state.currentTheta ?? 0;
      if (command.x != null && command.y != null) {
        state.currentCube = { x: command.x, y: command.y };
      }
      if (!state.currentCube) {
        state.currentTheta = theta;
        return;
      }
      state.currentTheta = theta;
      const cubePose = { ...state.currentCube, theta };
      state.cubePath.push(cubePose);
      const penPoint = cubeToPen(state.currentCube, theta, config);
      if (state.penState === "down") {
        appendPenPreviewPoint(state, penPoint, command.segmentId);
      } else {
        resetPenPreviewAnchor(state, penPoint);
      }
      state.currentPen = penPoint;
    }

    function replayMotorCommand(command, state, config) {
      if (command.geometry === "arc" && Array.isArray(command.cubePreviewPoints) && Array.isArray(command.penPreviewPoints)) {
        replayPreviewPointArrays(command, state);
        return;
      }

      const theta = command.theta ?? state.currentTheta ?? 0;
      const startCube =
        finitePoint(command.fromX, command.fromY) ||
        state.currentCube ||
        (state.currentPen ? penToCube(state.currentPen, theta, config) : null) ||
        finitePoint(command.x, command.y);
      if (!startCube) return;
      const progress = Number.isFinite(command.previewProgress) ? Math.max(0, Math.min(1, command.previewProgress)) : 1;
      const targetCube = finitePoint(command.x, command.y);
      const endCube = targetCube
        ? {
            x: startCube.x + (targetCube.x - startCube.x) * progress,
            y: startCube.y + (targetCube.y - startCube.y) * progress,
          }
        : {
            x: startCube.x + Math.cos(degToRad(theta)) * deadLineMotionDistanceMm(command, config) * progress,
            y: startCube.y + Math.sin(degToRad(theta)) * deadLineMotionDistanceMm(command, config) * progress,
          };
      const startPose = { ...startCube, theta: command.startTheta ?? state.currentTheta ?? theta };
      const endPose = { ...endCube, theta };
      appendCubePreviewPoint(state, startPose);
      appendCubePreviewPoint(state, endPose);

      const startPen = cubeToPen(startCube, startPose.theta, config);
      const endPen = cubeToPen(endCube, theta, config);
      appendPenPreviewPoint(state, startPen, command.segmentId);
      appendPenPreviewPoint(state, endPen, command.segmentId);
      state.currentCube = endCube;
      state.currentTheta = theta;
      state.currentPen = endPen;
    }

    function replayPreviewPointArrays(command, state) {
      for (const point of command.cubePreviewPoints) appendCubePreviewPoint(state, point);
      for (const point of command.penPreviewPoints) appendPenPreviewPoint(state, point, command.segmentId);
      const lastCube = command.cubePreviewPoints[command.cubePreviewPoints.length - 1];
      const lastPen = command.penPreviewPoints[command.penPreviewPoints.length - 1];
      if (lastCube) {
        state.currentCube = { x: lastCube.x, y: lastCube.y };
        state.currentTheta = lastCube.theta ?? command.theta ?? state.currentTheta;
      }
      if (lastPen) state.currentPen = { x: lastPen.x, y: lastPen.y };
    }

    function replayPositionCommand(command, state) {
      if (command.x != null && command.y != null) {
        appendCubePreviewPoint(state, { x: command.x, y: command.y, theta: command.theta || 0 });
        state.currentCube = { x: command.x, y: command.y };
        state.currentTheta = command.theta ?? state.currentTheta;
      }
      if (command.penX != null && command.penY != null) {
        const point = { x: command.penX, y: command.penY };
        appendPenPreviewPoint(state, point, command.segmentId);
        state.currentPen = point;
      }
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

    function deadLineMotionDistanceMm(command, config) {
      if (command.kind !== "draw" && command.kind !== "travel" && command.fromX != null && command.fromY != null && command.x != null && command.y != null) {
        return Math.hypot(command.x - command.fromX, command.y - command.fromY);
      }
      const draw = command.kind === "draw";
      const baseSpeed = Math.max(1, Math.abs(Number(draw ? config.drawSpeed : config.travelSpeed) || 1));
      const mmPerSec = draw ? deadDrawMmPerSec(config) : Math.max(1, Number(config.deadMmPerSecAtTravelSpeed) || 1);
      const speed = command.speed ?? (((Number(command.leftSpeed) || 0) + (Number(command.rightSpeed) || 0)) / 2);
      return mmPerSec * ((Number(speed) || 0) / baseSpeed) * ((command.durationMs || 0) / 1000);
    }

    function deadDrawMmPerSec(config) {
      return Math.max(1, Number(config.deadMmPerSecAtDrawSpeed) || 30);
    }

    function drawCubePath(points) {
      if (!points.length) return;
      const displayPoints = points;
      if (!displayPoints.length) return;
      drawStroke(displayPoints, "rgba(37, 99, 235, 0.38)", 1.1, [8, 7]);
      const stride = Math.max(1, Math.ceil(displayPoints.length / 18));
      for (let i = 0; i < displayPoints.length; i += stride) {
        drawCubePose(displayPoints[i], COLORS.cubeGhost, 0.22, false);
      }
      drawCubePose(displayPoints[0], COLORS.cubeStart, 0.95, true);
      drawCubeLabel(displayPoints[0], "START", COLORS.cubeStart, -1);
      drawCubePose(displayPoints[displayPoints.length - 1], COLORS.cubeEnd, 0.95, true);
      drawCubeLabel(displayPoints[displayPoints.length - 1], "END", COLORS.cubeEnd, 1);
    }

    function drawCubeHeadingMarkers(points) {
      if (!points.length) return;
      const stride = Math.max(1, Math.ceil(points.length / 18));
      for (let i = 0; i < points.length; i += stride) {
        drawOffsetHeadingMarker(points[i], "rgba(124, 58, 237, 0.72)");
      }
      drawOffsetHeadingMarker(points[0], COLORS.cubeStart);
      drawOffsetHeadingMarker(points[points.length - 1], COLORS.cubeEnd);
    }

    function drawOffsetHeadingMarker(pose, color) {
      const dpr = root.devicePixelRatio || 1;
      const center = matToCanvas(pose);
      const theta = degToRad(pose.theta || 0);
      const offset = 18 * dpr;
      const length = 16 * dpr;
      const base = {
        x: center.x + Math.cos(theta + Math.PI / 2) * offset,
        y: center.y + Math.sin(theta + Math.PI / 2) * offset,
      };
      const tip = {
        x: base.x + Math.cos(theta) * length,
        y: base.y + Math.sin(theta) * length,
      };
      const wing = 5 * dpr;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255, 253, 248, 0.92)";
      ctx.lineWidth = 5 * dpr;
      drawHeadingMarkerPath(base, tip, theta, wing);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * dpr;
      drawHeadingMarkerPath(base, tip, theta, wing);
      ctx.stroke();
      ctx.restore();
    }

    function drawHeadingMarkerPath(base, tip, theta, wing) {
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(tip.x - Math.cos(theta - Math.PI / 5) * wing, tip.y - Math.sin(theta - Math.PI / 5) * wing);
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - Math.cos(theta + Math.PI / 5) * wing, tip.y - Math.sin(theta + Math.PI / 5) * wing);
    }

    function drawCubePose(pose, color, alpha = 1, filled = false) {
      const center = matToCanvas(pose);
      const size = 32 * 0.8 * getView().scale;
      const theta = degToRad(pose.theta || 0);
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(theta);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.5 * (root.devicePixelRatio || 1);
      if (filled) {
        ctx.globalAlpha = alpha * 0.16;
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.globalAlpha = alpha;
      }
      ctx.strokeRect(-size / 2, -size / 2, size, size);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(size / 2, 0);
      ctx.stroke();
      ctx.restore();
    }

    function drawCubeLabel(pose, label, color, side = 1) {
      const dpr = root.devicePixelRatio || 1;
      const point = matToCanvas(pose);
      ctx.save();
      ctx.font = `bold ${10 * dpr}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const textWidth = ctx.measureText(label).width;
      const padX = 5 * dpr;
      const width = textWidth + padX * 2;
      const height = 16 * dpr;
      const y = point.y + side * 24 * dpr;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 * dpr;
      ctx.fillRect(point.x - width / 2, y - height / 2, width, height);
      ctx.strokeRect(point.x - width / 2, y - height / 2, width, height);
      ctx.fillStyle = color;
      ctx.fillText(label, point.x, y);
      ctx.restore();
    }

    function drawPenEvent(event) {
      const dpr = root.devicePixelRatio || 1;
      const point = matToCanvas(event);
      const isDown = event.state === "down";
      const radius = 5 * dpr;
      ctx.save();
      ctx.fillStyle = isDown ? COLORS.penDownEvent : COLORS.penUpEvent;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${10 * dpr}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(isDown ? "D" : "U", point.x, point.y - 0.5 * dpr);
      ctx.restore();
    }

    function drawWaitPoint(point) {
      const dpr = root.devicePixelRatio || 1;
      const canvasPoint = matToCanvas(point);
      ctx.save();
      ctx.fillStyle = COLORS.penSimulation;
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, 4.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawLegend() {
      const dpr = root.devicePixelRatio || 1;
      const items = [
        ["pen down 描画", COLORS.penSimulation, "solid"],
        ["pen up 移動", COLORS.penTravel, "dash"],
        ["pen down/up", COLORS.penDownEvent, "event"],
        ["toio移動軌跡", COLORS.cubePath, "dash"],
        ["toio開始", COLORS.cubeStart, "box"],
        ["toio終了", COLORS.cubeEnd, "box"],
        ["実機toio", COLORS.liveCube, "box"],
      ];
      const x = canvas.width - 196 * dpr;
      const y = 50 * dpr;
      const lineH = 20 * dpr;
      const width = 178 * dpr;
      const height = items.length * lineH + 12 * dpr;

      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.strokeStyle = "#d8d3c8";
      ctx.lineWidth = 1 * dpr;
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.font = `${11 * dpr}px system-ui`;
      ctx.textBaseline = "middle";

      items.forEach(([label, color, kind], index) => {
        const itemY = y + 12 * dpr + index * lineH;
        const displayColor = color === COLORS.penTravel
          ? "rgba(107, 114, 128, 0.42)"
          : color === COLORS.cubePath
            ? "rgba(37, 99, 235, 0.38)"
            : color;
        ctx.strokeStyle = displayColor;
        ctx.fillStyle = displayColor;
        ctx.lineWidth = (kind === "solid" ? 3 : 2) * dpr;
        if (kind === "dash") ctx.setLineDash([6 * dpr, 5 * dpr]);
        if (kind === "event") {
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(x + 15 * dpr, itemY, 5 * dpr, 0, Math.PI * 2);
          ctx.fill();
        } else if (kind === "box") {
          ctx.setLineDash([]);
          ctx.strokeRect(x + 10 * dpr, itemY - 5 * dpr, 10 * dpr, 10 * dpr);
        } else {
          ctx.beginPath();
          ctx.moveTo(x + 8 * dpr, itemY);
          ctx.lineTo(x + 24 * dpr, itemY);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = "#43464a";
        ctx.fillText(label, x + 32 * dpr, itemY);
      });
      ctx.restore();
    }

    function drawAnimationCursor(commands) {
      const point = latestPenPoint(commands);
      const pose = latestCubePose(commands, point);
      const penState = latestPenState(commands);
      if (pose) drawCubePose(pose, COLORS.liveCube, 1, true);
      if (!point) return;
      const dpr = root.devicePixelRatio || 1;
      const canvasPoint = matToCanvas(point);
      ctx.save();
      ctx.fillStyle = penState === "down" ? COLORS.penDownEvent : COLORS.penUpEvent;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, 7 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawPenStateBadge(canvasPoint, penState);
      ctx.restore();
    }

    function drawAnimationCursorFromPreview(preview) {
      const pose = preview.finalCubePose;
      const point = preview.finalPenPoint;
      if (pose) drawCubePose(pose, COLORS.liveCube, 1, true);
      if (!point) return;
      const dpr = root.devicePixelRatio || 1;
      const canvasPoint = matToCanvas(point);
      ctx.save();
      ctx.fillStyle = preview.penState === "down" ? COLORS.penDownEvent : COLORS.penUpEvent;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, 7 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawPenStateBadge(canvasPoint, preview.penState);
      ctx.restore();
    }

    function drawPenStateBadge(canvasPoint, penState) {
      const dpr = root.devicePixelRatio || 1;
      const label = penState === "down" ? "DOWN" : "UP";
      ctx.font = `bold ${10 * dpr}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const width = ctx.measureText(label).width + 10 * dpr;
      const height = 16 * dpr;
      const x = canvasPoint.x;
      const y = canvasPoint.y - 18 * dpr;
      ctx.fillStyle = penState === "down" ? COLORS.penDownEvent : COLORS.penUpEvent;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 * dpr;
      ctx.fillRect(x - width / 2, y - height / 2, width, height);
      ctx.strokeRect(x - width / 2, y - height / 2, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x, y);
    }

    function latestPenPoint(commands) {
      for (let i = commands.length - 1; i >= 0; i -= 1) {
        const command = commands[i];
        if (command.penX != null) return { x: command.penX, y: command.penY };
      }
      return null;
    }

    function latestCubePose(commands, point) {
      const poseCommand = latestPoseCommand(commands);
      if (!poseCommand) return null;
      if (poseCommand.x != null && poseCommand.y != null) {
        return { x: poseCommand.x, y: poseCommand.y, theta: poseCommand.theta || 0 };
      }
      if (!point) return null;
      return { ...root.PlotterCore.penToCube(point, poseCommand.theta || 0, getConfig()), theta: poseCommand.theta || 0 };
    }

    function latestPenState(commands) {
      for (let i = commands.length - 1; i >= 0; i -= 1) {
        const command = commands[i];
        if (command.type === "pen") return command.state;
      }
      return "up";
    }

    function latestPoseCommand(commands) {
      for (let i = commands.length - 1; i >= 0; i -= 1) {
        const command = commands[i];
        if ((command.type === "move" || command.type === "rotate" || command.type === "motor" || command.type === "turn") && command.theta != null) return command;
      }
      return null;
    }

    function findClickedDrawSegment(event) {
      const simulation = getSimulation();
      if (!isDeadMode() || !simulation || simulation.errors?.length) return null;
      const rect = canvas.getBoundingClientRect();
      const dpr = root.devicePixelRatio || 1;
      const point = {
        x: (event.clientX - rect.left) * dpr,
        y: (event.clientY - rect.top) * dpr,
      };
      const threshold = 10 * dpr;
      let best = null;
      const deadPreview = buildDeadCommandPreview(getAnimatedCommands());
      for (const segment of getDeadSegments()) {
        const d = distanceToCanvasSegmentPath(point, segmentPenPoints(segment, deadPreview).map(matToCanvas));
        if (d <= threshold && (!best || d < best.distance)) best = { segment, distance: d };
      }
      return best?.segment || null;
    }

    function distanceToCanvasSegmentPath(point, points) {
      if (!points.length) return Infinity;
      if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y);
      let best = Infinity;
      for (let i = 0; i < points.length - 1; i += 1) {
        best = Math.min(best, distanceToCanvasSegment(point, points[i], points[i + 1]));
      }
      return best;
    }

    function distanceToCanvasSegment(point, start, end) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSq = dx * dx + dy * dy;
      if (!lengthSq) return Math.hypot(point.x - start.x, point.y - start.y);
      const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
      const closest = { x: start.x + dx * t, y: start.y + dy * t };
      return Math.hypot(point.x - closest.x, point.y - closest.y);
    }

    return {
      canvasToMat,
      draw,
      findClickedDrawSegment,
      __test: {
        buildDeadCommandPreview,
      },
    };
  }

  root.ToioPlotterCanvas = {
    createCanvasRenderer,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
