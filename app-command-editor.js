"use strict";

(function () {
  function createCommandEditor(deps) {
    const {
      outputEl,
      getSimulation,
      getSimulationValid,
      getConfig,
      getCommandOverrides,
      isDeadMode,
      formatDeadToioCommand,
      formatPositionToioCommand,
      escapeHtml,
      commandDurationMs,
      roundToMotorDurationMs,
      clamp,
      minTurnDurationMs,
      turnWheelSpeeds,
      turnMsPer90,
      cubeToPen,
      normalizeDegrees,
      syncSimulationControls,
      focusCommand,
      updateAfterEdit,
      draw,
    } = deps;

    let lastScrolledCommandIndex = -1;

    function captureCommandOverrides() {
      const simulation = getSimulation();
      const commandOverrides = getCommandOverrides();
      if (!simulation?.commands?.length) return;
      for (const [index, command] of simulation.commands.entries()) {
        const key = commandOverrideKey(command, index, simulation.commands);
        if (!key) continue;
        const override = commandOverrideFromCommand(command);
        if (override) commandOverrides.set(key, override);
      }
    }

    function applyCommandOverrides() {
      const simulation = getSimulation();
      const commandOverrides = getCommandOverrides();
      if (!simulation?.commands?.length || !commandOverrides.size) return;
      for (const [index, command] of simulation.commands.entries()) {
        const key = commandOverrideKey(command, index, simulation.commands);
        const override = key ? commandOverrides.get(key) : null;
        if (!override) continue;
        if (command.type === "motor") {
          if (command.geometry === "arc") {
            if (override.leftSpeed != null) command.leftSpeed = override.leftSpeed;
            if (override.rightSpeed != null) command.rightSpeed = override.rightSpeed;
            if (override.durationMs != null) command.durationMs = override.durationMs;
            command.manualWheelSpeeds = true;
          } else {
            ensureMotorBaseline(command);
            if (override.speed != null) command.speed = override.speed;
            if (override.durationMs != null) command.durationMs = override.durationMs;
            if (override.distanceScale != null) {
              command.distanceScale = override.distanceScale;
              command.durationMs = roundToMotorDurationMs(Math.max(10, command.baseMotion.durationMs * command.distanceScale));
            } else if (override.durationMs != null) {
              command.distanceScale = motorDistanceScale(command);
            }
            command.leftSpeed = command.speed;
            command.rightSpeed = command.speed;
            updateStraightMotorPose(command);
          }
        } else if (command.type === "turn") {
          if (override.leftSpeed != null) command.leftSpeed = override.leftSpeed;
          if (override.rightSpeed != null) command.rightSpeed = override.rightSpeed;
          if (override.durationMs != null) command.durationMs = override.durationMs;
          command.manualWheelSpeeds = true;
          updateManualTurnPose(command, index);
        } else if (command.type === "wait") {
          if (override.ms != null) command.ms = override.ms;
        }
      }
    }

    function commandOverrideFromCommand(command) {
      if (command.type === "motor" && command.geometry === "arc" && command.manualWheelSpeeds) {
        return {
          leftSpeed: command.leftSpeed,
          rightSpeed: command.rightSpeed,
          durationMs: command.durationMs,
        };
      }
      if (command.type === "motor" && command.baseMotion) {
        return {
          speed: command.speed,
          durationMs: command.durationMs,
          distanceScale: command.distanceScale,
        };
      }
      if (command.type === "turn" && command.manualWheelSpeeds) {
        return {
          leftSpeed: command.leftSpeed,
          rightSpeed: command.rightSpeed,
          durationMs: command.durationMs,
        };
      }
      if (command.type === "wait") {
        return {
          ms: command.ms,
        };
      }
      return null;
    }

    function commandOverrideKey(command, index, commands) {
      if (!command || (command.type !== "motor" && command.type !== "turn" && command.type !== "wait")) return null;
      const role = command.role || "";
      const segmentId = command.segmentId || "";
      const kind = command.kind || "";
      const occurrence = commands
        .slice(0, index + 1)
        .filter((item) => item.type === command.type && (item.role || "") === role && (item.segmentId || "") === segmentId && (item.kind || "") === kind)
        .length;
      return [command.type, kind, role, segmentId, occurrence].join("|");
    }

    function renderToioCommandOutput() {
      const simulation = getSimulation();
      if (!outputEl) return;
      if (!getSimulationValid() || !simulation) {
        outputEl.textContent = "Simulate after drawing to show commands.";
        lastScrolledCommandIndex = -1;
        syncSimulationControls();
        return;
      }
      outputEl.innerHTML = simulation.commands.map((command, index) => commandRowTemplate(command, index)).filter(Boolean).join("");
      lastScrolledCommandIndex = -1;
      syncSimulationControls();
      updateActiveCommandRow();
    }

    function commandRowTemplate(command, index) {
      const label = isDeadMode() ? formatDeadToioCommand(command) : formatPositionToioCommand(command);
      if (!label) return "";
      const controls = commandControlsTemplate(command, index);
      const step = String(index + 1).padStart(2, "0");
      const stepControl = controls
        ? `<button class="command-step-button" type="button" data-command-step="${index}">${step}</button>`
        : `<span class="command-step-static" aria-hidden="true">${step}</span>`;
      return `
    <div class="command-row" data-command-index="${index}">
      ${stepControl}
      <div class="command-main">
        <div class="command-label">${escapeHtml(label)}</div>
        ${controls}
      </div>
    </div>
  `;
    }

    function commandControlsTemplate(command, index) {
      if (command.type === "pen") {
        return "";
      }
      if (command.type === "move" || command.type === "rotate") {
        return `
      <div class="command-fields">
        ${commandInputTemplate(index, "speed", "speed", command.speed, 1, 10, 255)}
        ${commandInputTemplate(index, "durationMs", "sim ms", displayCommandDurationMs(index), 10, 80, 10000)}
      </div>
    `;
      }
      if (command.type === "motor") {
        if (command.geometry === "arc") {
          return `
      <div class="command-fields">
        ${commandInputTemplate(index, "leftSpeed", "L", command.leftSpeed, 1, -255, 255)}
        ${commandInputTemplate(index, "rightSpeed", "R", command.rightSpeed, 1, -255, 255)}
        ${commandInputTemplate(index, "durationMs", "ms", command.durationMs || 10, 10, 10, 60000)}
      </div>
    `;
        }
        const distanceInput =
          command.kind === "travel" ? commandInputTemplate(index, "distanceScale", "distance", motorDistanceScale(command), 0.05, 0.1, 2) : "";
        return `
      <div class="command-fields">
        ${commandInputTemplate(index, "speed", "speed", motorStraightSpeed(command), 1, -255, 255)}
        ${commandInputTemplate(index, "durationMs", "ms", command.durationMs || 10, 10, 10, 2550)}
        ${distanceInput}
      </div>
    `;
      }
      if (command.type === "turn") {
        const speeds = turnWheelSpeeds(command);
        return `
      <div class="command-fields">
        ${commandInputTemplate(index, "leftSpeed", "L", speeds.left, 1, -255, 255)}
        ${commandInputTemplate(index, "rightSpeed", "R", speeds.right, 1, -255, 255)}
        ${commandInputTemplate(index, "durationMs", "ms", command.durationMs || 0, 10, 0, 2550)}
      </div>
    `;
      }
      if (command.type === "wait") {
        return `
      <div class="command-fields command-fields-wait">
        <label class="command-unit-field">
          <input data-command-index="${index}" data-command-key="ms" type="number" min="0" max="10000" step="10" value="${Number(command.ms || 0).toFixed(0)}" />
          <span>ms</span>
        </label>
      </div>
    `;
      }
      return "";
    }

    function motorStraightSpeed(command) {
      if (command.speed != null) return command.speed;
      return Math.round(((command.leftSpeed || 0) + (command.rightSpeed || 0)) / 2);
    }

    function motorDistanceScale(command) {
      if (command.distanceScale != null) return command.distanceScale;
      if (command.baseMotion?.durationMs) return (command.durationMs || 0) / Math.max(1, command.baseMotion.durationMs);
      return 1;
    }

    function displayCommandDurationMs(index) {
      const simulation = getSimulation();
      const command = simulation?.commands?.[index];
      if (!command) return 0;
      if (command.durationMs != null) return command.durationMs;
      let lastPenPoint = null;
      for (let i = 0; i < index; i += 1) {
        const previous = simulation.commands[i];
        if ((previous.type === "move" || previous.type === "motor") && previous.penX != null) {
          lastPenPoint = { x: previous.penX, y: previous.penY };
        }
        if (previous.type === "pen" && previous.penX != null) {
          lastPenPoint = { x: previous.penX, y: previous.penY };
        }
      }
      return commandDurationMs(command, lastPenPoint);
    }

    function commandInputTemplate(index, key, label, value, step, min, max) {
      const rounded = Number(value || 0).toFixed(step < 1 ? 2 : 0);
      return `<label>${label}<input data-command-index="${index}" data-command-key="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${rounded}" /></label>`;
    }

    function getPenCommandSpeed(command) {
      const config = getConfig();
      if (command.speed != null) return command.speed;
      return command.state === "up" ? config.upMotorSpeed : config.downMotorSpeed;
    }

    function getPenCommandDuration(command) {
      const config = getConfig();
      if (command.durationMs != null) return command.durationMs;
      return command.state === "up" ? config.upDurationMs : config.downDurationMs;
    }

    function updateActiveCommandRow() {
      if (!outputEl?.querySelectorAll) return;
      const activeCommandIndex = deps.getActiveCommandIndex();
      let activeRow = null;
      for (const row of outputEl.querySelectorAll(".command-row")) {
        const isActive = Number(row.dataset.commandIndex) === activeCommandIndex;
        row.classList.toggle("active", isActive);
        if (isActive) activeRow = row;
      }
      if (activeCommandIndex < 0) {
        lastScrolledCommandIndex = -1;
        return;
      }
      if (activeRow && activeCommandIndex !== lastScrolledCommandIndex) {
        scrollCommandRowIntoView(activeRow);
        lastScrolledCommandIndex = activeCommandIndex;
      }
    }

    function scrollCommandRowIntoView(row) {
      if (!outputEl || !row.getBoundingClientRect || !outputEl.getBoundingClientRect) return;
      const targetOffset = 36;
      const rowTop = row.getBoundingClientRect().top - outputEl.getBoundingClientRect().top + outputEl.scrollTop;
      outputEl.scrollTop = Math.max(0, rowTop - targetOffset);
    }

    function updateCommandEdit(input, { render = true } = {}) {
      const simulation = getSimulation();
      if (!simulation?.commands) return;
      const index = Number(input.dataset.commandIndex);
      const key = input.dataset.commandKey;
      const command = simulation.commands[index];
      if (!command || !key) return;
      if (input.value === "" || input.value === "-") return;
      if (command.type === "motor" && command.geometry !== "arc" && (key === "speed" || key === "durationMs" || key === "distanceScale")) {
        ensureMotorBaseline(command);
      }
      if (command.type === "turn" && (key === "leftSpeed" || key === "rightSpeed" || key === "durationMs") && !command.manualWheelSpeeds) {
        const speeds = turnWheelSpeeds(command);
        command.leftSpeed = speeds.left;
        command.rightSpeed = speeds.right;
      }
      let value = Number(input.value);
      if ((command.type === "turn" || command.type === "motor") && key === "durationMs") {
        const minMs = command.type === "turn" ? minTurnDurationMs : 10;
        value = command.type === "motor" && command.geometry === "arc" ? Math.round(Math.max(minMs, value) / 10) * 10 : roundToMotorDurationMs(Math.max(minMs, value));
      }
      if (command.type === "motor" && key === "distanceScale") {
        value = clamp(value, 0.1, 2);
        command.durationMs = roundToMotorDurationMs(Math.max(10, command.baseMotion.durationMs * value));
      }
      command[key] = value;
      if (command.type === "motor" && command.geometry === "arc") {
        if (key === "leftSpeed" || key === "rightSpeed") command[key] = clamp(value, -255, 255);
        if (key === "leftSpeed" || key === "rightSpeed" || key === "durationMs") command.manualWheelSpeeds = true;
      } else if (command.type === "motor" && (key === "speed" || key === "durationMs" || key === "distanceScale")) {
        if (key !== "distanceScale") command.distanceScale = motorDistanceScale(command);
        command.leftSpeed = command.speed;
        command.rightSpeed = command.speed;
        updateStraightMotorPose(command);
      }
      if (command.type === "turn" && (key === "leftSpeed" || key === "rightSpeed" || key === "durationMs")) {
        command.manualWheelSpeeds = true;
        updateManualTurnPose(command, index);
      }
      const overrideKey = commandOverrideKey(command, index, simulation.commands);
      const override = commandOverrideFromCommand(command);
      if (overrideKey && override) getCommandOverrides().set(overrideKey, override);
      focusCommand(index, { allowMissing: true });
      if (render) {
        renderToioCommandOutput();
      } else {
        syncSimulationControls();
        updateActiveCommandRow();
      }
      draw();
      if (updateAfterEdit) updateAfterEdit(command, index);
    }

    function ensureMotorBaseline(command) {
      if (command.baseMotion) return;
      command.speed = motorStraightSpeed(command);
      command.baseMotion = {
        speed: command.speed || 1,
        durationMs: command.durationMs || 1,
        fromX: command.fromX,
        fromY: command.fromY,
        x: command.x,
        y: command.y,
        theta: command.theta,
      };
    }

    function updateStraightMotorPose(command) {
      const config = getConfig();
      const base = command.baseMotion;
      if (!base || base.fromX == null || base.fromY == null || base.x == null || base.y == null) return;
      const speedScale = (command.speed || 0) / (Math.abs(base.speed || 1) < 1 ? 1 : base.speed);
      const durationScale = (command.durationMs || 0) / Math.max(1, base.durationMs || 1);
      const scale = speedScale * durationScale;
      command.leftSpeed = command.speed;
      command.rightSpeed = command.speed;
      command.fromX = base.fromX;
      command.fromY = base.fromY;
      command.x = base.fromX + (base.x - base.fromX) * scale;
      command.y = base.fromY + (base.y - base.fromY) * scale;
      command.theta = base.theta;
      const penPoint = cubeToPen({ x: command.x, y: command.y }, command.theta || 0, config);
      command.penX = penPoint.x;
      command.penY = penPoint.y;
    }

    function updateManualTurnPose(command, index) {
      const config = getConfig();
      const fromTheta = turnStartThetaAtCommand(index, command);
      const angle = manualTurnAngle(command);
      command.angle = angle;
      command.theta = normalizeDegrees(fromTheta + angle);
      const penPoint = command.x != null && command.y != null ? cubeToPen({ x: command.x, y: command.y }, command.theta, config) : null;
      if (penPoint) {
        command.penX = penPoint.x;
        command.penY = penPoint.y;
      }
    }

    function turnStartThetaAtCommand(index, command) {
      const simulation = getSimulation();
      let lastTheta = null;
      for (let i = 0; i < index; i += 1) {
        const previous = simulation.commands[i];
        if (previous.theta != null) lastTheta = previous.theta;
      }
      if (lastTheta != null) return lastTheta;
      return command.theta - (command.angle || 0);
    }

    function manualTurnAngle(command) {
      const config = getConfig();
      const speeds = turnWheelSpeeds(command);
      const direction = speeds.left - speeds.right >= 0 ? 1 : -1;
      const speedRatio = Math.abs((speeds.left - speeds.right) / 2) / Math.max(1, Math.abs(config.deadTurnSpeed));
      const angularSpeedDegPerSec = (90 / (turnMsPer90() / 1000)) * speedRatio * direction;
      return angularSpeedDegPerSec * ((command.durationMs || 0) / 1000);
    }

    return {
      captureCommandOverrides,
      applyCommandOverrides,
      commandOverrideFromCommand,
      commandOverrideKey,
      renderToioCommandOutput,
      commandRowTemplate,
      commandControlsTemplate,
      motorStraightSpeed,
      motorDistanceScale,
      displayCommandDurationMs,
      commandInputTemplate,
      getPenCommandSpeed,
      getPenCommandDuration,
      updateActiveCommandRow,
      updateCommandEdit,
      ensureMotorBaseline,
      updateStraightMotorPose,
      updateManualTurnPose,
      turnStartThetaAtCommand,
      manualTurnAngle,
    };
  }

  window.ToioPlotterCommandEditor = {
    createCommandEditor,
  };
})();
