"use strict";

(function () {
  function createSimulationPlaybackController(deps) {
    const {
      getSimulationValid,
      getCommands,
      timelineTools,
      clamp,
      now,
      requestFrame,
      cancelFrame,
      onControlsChanged,
      onActiveCommandChanged,
      onDraw,
    } = deps;

    let animation = null;
    let activeCommandIndex = -1;

    function getAnimation() {
      return animation;
    }

    function getActiveCommandIndex() {
      return activeCommandIndex;
    }

    function getElapsedMs() {
      if (!animation) return Infinity;
      return animation.playing ? now() - animation.startedAt : animation.elapsedMs;
    }

    function getAnimatedCommands() {
      if (!animation) return getCommands();
      return timelineTools.commandsAtElapsed(animation.timeline, getElapsedMs());
    }

    function createAnimation(timeline, elapsedMs, playing) {
      return {
        startedAt: now() - elapsedMs,
        elapsedMs,
        durationMs: Math.max(600, timeline.durationMs),
        timeline,
        playing,
        frameId: null,
      };
    }

    function cancelPendingFrame() {
      if (animation?.frameId) cancelFrame(animation.frameId);
      if (animation) animation.frameId = null;
    }

    function notifyFrame() {
      onActiveCommandChanged();
      onDraw();
    }

    function finishAnimation() {
      if (!animation) return;
      activeCommandIndex = timelineTools.lastPlayableCommandIndex(animation.timeline);
      animation = null;
      onControlsChanged();
      notifyFrame();
    }

    function tick() {
      if (!animation) return;
      const elapsed = getElapsedMs();
      if (elapsed >= animation.durationMs) {
        finishAnimation();
        return;
      }
      activeCommandIndex = timelineTools.activeCommandIndexAtElapsed(animation.timeline, elapsed);
      notifyFrame();
      if (animation?.playing) animation.frameId = requestFrame(tick);
    }

    function start() {
      const commands = getCommands();
      if (!commands.length) return;
      const timeline = timelineTools.buildSimulationTimeline(commands);
      animation = createAnimation(timeline, 0, true);
      animation.frameId = requestFrame(tick);
      onControlsChanged();
    }

    function stop() {
      cancelPendingFrame();
      animation = null;
      activeCommandIndex = -1;
      onControlsChanged();
      onActiveCommandChanged();
    }

    function togglePause() {
      if (!animation) return;
      if (animation.playing) {
        animation.elapsedMs = getElapsedMs();
        animation.playing = false;
        cancelPendingFrame();
      } else {
        animation.playing = true;
        animation.startedAt = now() - animation.elapsedMs;
        animation.frameId = requestFrame(tick);
      }
      onControlsChanged();
      onDraw();
    }

    function step(delta) {
      if (!getSimulationValid()) return;
      const commands = getCommands();
      if (!commands.length) return;
      if (!animation) {
        const timeline = timelineTools.buildSimulationTimeline(commands);
        if (!timeline.items.length) return;
        animation = createAnimation(timeline, 0, false);
      }
      cancelPendingFrame();
      const current = activeCommandIndex < 0 ? -1 : activeCommandIndex;
      const currentItemIndex = animation.timeline.items.findIndex((item) => item.commandIndex === current);
      const nextItemIndex = clamp((currentItemIndex < 0 ? -1 : currentItemIndex) + delta, 0, animation.timeline.items.length - 1);
      const item = animation.timeline.items[nextItemIndex];
      if (!item) return;
      animation.elapsedMs = item.startMs + Math.min(1, Math.max(0, item.endMs - item.startMs) / 2);
      animation.startedAt = now() - animation.elapsedMs;
      animation.playing = false;
      animation.frameId = null;
      activeCommandIndex = item.commandIndex;
      onControlsChanged();
      notifyFrame();
    }

    function focusCommand(index, options = {}) {
      if (!getSimulationValid()) return false;
      const commands = getCommands();
      if (!commands.length) return false;
      cancelPendingFrame();
      const timeline = timelineTools.buildSimulationTimeline(commands);
      const item = timelineTools.timelineItemForCommand(timeline, index);
      if (!item && !options.allowMissing) return false;
      const elapsedMs = item ? item.startMs + Math.min(1, Math.max(0, item.endMs - item.startMs) / 2) : 0;
      animation = createAnimation(timeline, elapsedMs, false);
      activeCommandIndex = index;
      return true;
    }

    return {
      getAnimation,
      getActiveCommandIndex,
      getElapsedMs,
      getAnimatedCommands,
      start,
      stop,
      togglePause,
      step,
      focusCommand,
    };
  }

  window.ToioPlotterSimulationPlayer = {
    createSimulationPlaybackController,
  };
})();
