# Repository Notes

- Treat “simulation” as command generation from the drawing, not as merely
  animating a precomputed preview. The drawing-area lines are the input; the
  output must be a toio command sequence whose pen-down execution produces the
  pen-tip trajectory for those lines.
- “Command-faithful drawing” means deriving the pen-down path from the exact
  generated commands (including L/R speeds, durations, turns, cube pose, and
  pen offset), then rendering that executed pen-tip path. A nominal source
  stroke or planned `segment.penPreviewPoints` is not a substitute when it
  differs from the command execution path.
- Loading a sample must generate and display the completed command-derived
  simulation result without starting playback or running the toio commands.
  Playback starts only when the user explicitly runs the simulation.
- When a command result is wrong, investigate both sides separately: (1) why
  drawing geometry became incorrect during drawing-to-command generation, and
  (2) why rendering or timeline playback diverged from the generated commands.
- The measured dead zone applies to differential-drive wheel speeds for arc
  motion: absolute L/R values below 8 do not move the cube reliably, so arc
  commands should use absolute wheel speeds of at least 8 where a wheel is
  active. This rule does not apply to turn-in-place commands; a turn may use
  lower wheel speeds when the measured turn behavior supports them. Keep arc
  wheel speeds within the measured practical upper range of 20–24.

- Treat duration formula/calibration changes as code changes only. Do not add
  localStorage/config-version migration branches for calibration constant changes
  unless the user explicitly asks for existing saved UI settings to be rewritten.
- Keep generated drawing geometry separate from timing calibration. Changes to
  automatic `durationMs` calculation must not change segment start/end points,
  command `fromX/fromY/x/y`, or `penX/penY` unless the user asks for geometry
  recalculation.
- Keep straight-draw and arc-draw timing calibration independent. Use
  `deadMmPerSecAtDrawSpeed` for straight draw lines and
  `deadArcMmPerSecAtDrawSpeed` for draw arcs; do not apply straight-line
  calibration changes to arcs unless the user explicitly asks for it.
- UI command edits are different from formula changes. When the user edits a
  command in the UI, the current command list may be reinterpreted and redrawn;
  when the user asks to adjust the formula in code, existing UI state should not
  be migrated or rewritten.
- Treat every file under `data/` as read-only measurement evidence. Read and
  compare these JSON files when calibrating, but never edit, overwrite, or
  reformat them.
