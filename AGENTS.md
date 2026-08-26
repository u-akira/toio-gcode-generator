# Repository Notes

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
