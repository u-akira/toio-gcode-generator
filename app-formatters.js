(function (root) {
  "use strict";

  function formatSeconds(ms) {
    return `${(Math.max(0, ms || 0) / 1000).toFixed(2).replace(/\.00$/, "")}s`;
  }

  function formatAngle(angle) {
    return `${angle >= 0 ? "+" : ""}${Number(angle || 0).toFixed(0)}°`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  root.ToioPlotterFormatters = {
    formatSeconds,
    formatAngle,
    escapeHtml,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
