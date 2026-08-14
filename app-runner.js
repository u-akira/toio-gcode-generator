"use strict";

(function () {
  function createToioRunner(deps) {
    const {
      MAT,
      getConfig,
      getSimulation,
      getSimulationValid,
      getMoveCube,
      getPenCube,
      isDeadMode,
      hasFreshMovePose,
      getLastMovePoseAt,
      matToNativePoint,
      pointInBounds,
      getPenCommandSpeed,
      getPenCommandDuration,
      motorStraightSpeed,
      turnWheelSpeeds,
      turnMsPer90,
      roundToMotorDurationMs,
      clamp,
      minTurnDurationMs,
      positionFreshMs,
      positionRunTimeoutMs,
      positionRetryWaitMs,
      positionRetryPollMs,
      positionTargetRetryCount,
      setPill,
      runStatusEl,
      runButtonEl,
      log,
      syncRunButton,
      renderToioCommandOutput,
    } = deps;

    let running = false;
    let abortRun = false;

    function isRunning() {
      return running;
    }

    function requestAbort() {
      abortRun = true;
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function playRunSound(kind) {
      const moveCube = getMoveCube();
      if (!moveCube?.playMidiNotes) return;
      const notes =
        kind === "start"
          ? [
              { durationMs: 100, note: 60 },
              { durationMs: 140, note: 67 },
            ]
          : [
              { durationMs: 100, note: 72 },
              { durationMs: 160, note: 64 },
            ];
      try {
        await moveCube.playMidiNotes(notes, 1);
      } catch (error) {
        log(`toio sound skipped: ${error.message}`);
      }
    }

    async function runToio() {
      const simulation = getSimulation();
      const config = getConfig();
      if (!getSimulationValid() || !simulation) {
        log("Run simulation before executing toio.");
        return;
      }
      if (isDeadMode()) {
        await runDeadReckoningToio();
        return;
      }
      const moveCube = getMoveCube();
      const penCube = getPenCube();
      if (!moveCube || !penCube) {
        log("Connect both move and pen toio cubes.");
        return;
      }
      if (!hasFreshMovePose(positionFreshMs)) {
        log("Move toio Position ID is not fresh.");
        setPill(runStatusEl, "Position ID missing", "error");
        return;
      }
      running = true;
      abortRun = false;
      runButtonEl.disabled = true;
      setPill(runStatusEl, "Running", "warn");

      try {
        await playRunSound("start");
        for (const command of simulation.commands) {
          if (abortRun) throw new Error("Emergency stop");
          if (command.type === "pen") {
            if (command.state === "down") {
              await ensureFreshPositionOrRetry("before pen down");
            }
            await setPen(command.state, command);
            await ensureFreshPositionAfterPen(command.state, Date.now());
          } else if (command.type === "move" || command.type === "rotate") {
            const nativePoint = matToNativePoint(command);
            if (!pointInBounds(nativePoint, MAT)) {
              throw new Error(`toio target is outside mat: x=${nativePoint.x.toFixed(1)} y=${nativePoint.y.toFixed(1)}`);
            }
            await runMoveCommandWithPositionRetry(command, nativePoint);
          } else if (command.type === "wait") {
            await sleep(command.ms);
          }
        }
        await playRunSound("end");
        setPill(runStatusEl, "Done", "ok");
        log("toio run completed.");
      } catch (error) {
        setPill(runStatusEl, "Stopped", "error");
        log(`toio run stopped: ${error.message}`);
        await emergencyStop();
      } finally {
        running = false;
        syncRunButton();
      }
    }

    async function setPen(state, command = null) {
      const config = getConfig();
      const penCube = getPenCube();
      if (!penCube) throw new Error("Pen toio is not connected.");
      const speed = command ? getPenCommandSpeed(command) : state === "up" ? config.upMotorSpeed : config.downMotorSpeed;
      const durationMs = command ? getPenCommandDuration(command) : state === "up" ? config.upDurationMs : config.downDurationMs;
      await penCube.timedMotor(speed, durationMs, config.penMotorMode);
      await sleep(config.settleMs);
    }

    async function runMoveCommandWithPositionRetry(command, nativePoint) {
      const config = getConfig();
      const moveCube = getMoveCube();
      for (let attempt = 0; attempt <= positionTargetRetryCount; attempt += 1) {
        if (attempt > 0) log(`Position ID retry: ${attempt}/${positionTargetRetryCount}`);
        log(
          `toio ${command.type}: x=${nativePoint.x.toFixed(1)} y=${nativePoint.y.toFixed(1)} ` +
            `theta=${command.theta.toFixed(0)} speed=${command.speed}`,
        );
        try {
          await moveCube.moveTo(nativePoint.x, nativePoint.y, command.theta, command.speed, config.targetTimeout);
          return;
        } catch (error) {
          if (attempt >= positionTargetRetryCount || !isPositionRetryableError(error)) throw error;
          log(`Position ID retry: ${error.message}`);
          await recoverPositionForRetry();
        }
      }
    }

    async function ensureFreshPositionOrRetry(context) {
      if (hasFreshMovePose(positionRunTimeoutMs)) return;
      log(`Position ID retry: lost Position ID ${context}.`);
      await recoverPositionForRetry();
    }

    async function ensureFreshPositionAfterPen(state, sinceMs) {
      const recovered = await waitForFreshMovePoseAfter(sinceMs, positionRunTimeoutMs);
      if (recovered) return;
      log(`Position ID retry: pen ${state} aftershock, waiting for stable Position ID.`);
      await recoverPositionForRetry();
    }

    async function recoverPositionForRetry() {
      await setPen("up");
      await getMoveCube()?.stop();
      log("Position ID retry: waiting for recovery...");
      const recovered = await waitForFreshMovePose(positionRetryWaitMs);
      if (!recovered) throw new Error("Could not recover move toio Position ID.");
      log("Position ID retry: recovered.");
    }

    async function waitForFreshMovePose(timeoutMs) {
      const start = Date.now();
      while (Date.now() - start <= timeoutMs) {
        if (hasFreshMovePose(positionFreshMs)) return true;
        await sleep(positionRetryPollMs);
      }
      return false;
    }

    async function waitForFreshMovePoseAfter(sinceMs, timeoutMs) {
      const start = Date.now();
      while (Date.now() - start <= timeoutMs) {
        if (getLastMovePoseAt() >= sinceMs && hasFreshMovePose(positionFreshMs)) return true;
        await sleep(positionRetryPollMs);
      }
      return false;
    }

    function isPositionRetryableError(error) {
      return String(error?.message || "").includes("0x02");
    }

    async function emergencyStop() {
      abortRun = true;
      await Promise.allSettled([getMoveCube()?.stop(), getPenCube()?.stop()]);
      setPill(runStatusEl, "Stopped", "error");
    }

    async function runDeadReckoningToio() {
      const simulation = getSimulation();
      if (!getMoveCube() || !getPenCube()) {
        log("Connect both move and pen toio cubes.");
        return;
      }
      log("Dead reckoning: place the pen tip at START and align the toio heading with the first segment.");

      running = true;
      abortRun = false;
      runButtonEl.disabled = true;
      setPill(runStatusEl, "Dead reckoning running", "warn");

      try {
        await playRunSound("start");
        for (const command of simulation.commands) {
          if (abortRun) throw new Error("Emergency stop");
          if (command.type === "pen") {
            await setPen(command.state, command);
          } else if (command.type === "turn") {
            await runDeadTurn(command);
          } else if (command.type === "motor") {
            await runDeadMotor(command);
          } else if (command.type === "wait") {
            await sleep(command.ms);
          }
        }
        await playRunSound("end");
        setPill(runStatusEl, "Done", "ok");
        log("Dead reckoning run completed.");
      } catch (error) {
        setPill(runStatusEl, "Stopped", "error");
        log(`Dead reckoning run stopped: ${error.message}`);
        await emergencyStop();
      } finally {
        running = false;
        syncRunButton();
      }
    }

    async function runDeadTurn(command) {
      if (!command.durationMs) return;
      const durationMs = deadTurnDurationMsForRun(command);
      const speeds = turnWheelSpeeds(command);
      const leftSpeed = speeds.left;
      const rightSpeed = speeds.right;
      log(`turn ${command.angle.toFixed(0)}deg: L=${leftSpeed} R=${rightSpeed} ${durationMs}ms`);
      if (durationMs !== command.durationMs && !command.manualWheelSpeeds) {
        command.durationMs = durationMs;
        renderToioCommandOutput();
      }
      await getMoveCube().timedMotorPair(leftSpeed, rightSpeed, durationMs);
      await sleep(durationMs);
    }

    function deadTurnDurationMsForRun(command) {
      const durationMs = Math.max(minTurnDurationMs, command.durationMs || 0);
      if (command.manualWheelSpeeds) return durationMs;
      return plannedTurnDurationMs(command.angle || 0);
    }

    function plannedTurnDurationMs(angleDeg) {
      if (Math.abs(angleDeg) < 0.1) return 0;
      return roundToMotorDurationMs(Math.max(minTurnDurationMs, (Math.abs(angleDeg) / 90) * turnMsPer90()));
    }

    async function runDeadMotor(command) {
      const leftSpeed = clamp(command.leftSpeed ?? command.speed ?? motorStraightSpeed(command), -255, 255);
      const rightSpeed = clamp(command.rightSpeed ?? command.speed ?? motorStraightSpeed(command), -255, 255);
      log(`${command.kind}: L=${leftSpeed} R=${rightSpeed} ${command.durationMs}ms`);
      await runTimedMotorPairForDuration(leftSpeed, rightSpeed, command.durationMs);
    }

    async function runTimedMotorPairForDuration(leftSpeed, rightSpeed, durationMs) {
      let remaining = Math.max(0, durationMs || 0);
      while (remaining > 0) {
        if (abortRun) throw new Error("Emergency stop");
        const chunkMs = Math.min(2550, remaining);
        await getMoveCube().timedMotorPair(leftSpeed, rightSpeed, chunkMs);
        await sleep(chunkMs);
        remaining -= chunkMs;
      }
    }

    return {
      isRunning,
      requestAbort,
      sleep,
      playRunSound,
      runToio,
      setPen,
      runMoveCommandWithPositionRetry,
      ensureFreshPositionOrRetry,
      ensureFreshPositionAfterPen,
      recoverPositionForRetry,
      waitForFreshMovePose,
      waitForFreshMovePoseAfter,
      isPositionRetryableError,
      emergencyStop,
      runDeadReckoningToio,
      runDeadTurn,
      deadTurnDurationMsForRun,
      plannedTurnDurationMs,
      runDeadMotor,
      runTimedMotorPairForDuration,
    };
  }

  window.ToioPlotterRunner = {
    createToioRunner,
  };
})();
