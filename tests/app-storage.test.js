const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    entries: () => Object.fromEntries(store.entries()),
  };
}

function loadStorage({ navigationType = "navigate", initialStorage = {} } = {}) {
  const context = {
    PlotterCore: {
      DEFAULT_CONFIG: {
        configVersion: 29,
        deadMmPerSecAtDrawSpeed: 56,
      },
    },
    localStorage: createLocalStorage(initialStorage),
    performance: {
      getEntriesByType: (type) => (type === "navigation" ? [{ type: navigationType }] : []),
    },
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "app-storage.js"), "utf8");
  vm.runInContext(source, context);
  return context;
}

test("app local storage is cleared on browser reload", () => {
  const context = loadStorage({
    navigationType: "reload",
    initialStorage: {
      toioPlotterConfig: JSON.stringify({ deadMmPerSecAtDrawSpeed: 30 }),
      toioPlotterDeadSegmentSettings: "{}",
      toioPlotterTurnCalibrationLog: "{}",
      toioPlotterLegendVisible: "false",
      unrelated: "keep",
    },
  });

  context.ToioPlotterStorage.clearAppLocalStorageOnReload();

  assert.deepEqual(context.localStorage.entries(), { unrelated: "keep" });
});

test("app local storage is kept on normal navigation", () => {
  const context = loadStorage({
    navigationType: "navigate",
    initialStorage: {
      toioPlotterConfig: JSON.stringify({ deadMmPerSecAtDrawSpeed: 30 }),
    },
  });

  context.ToioPlotterStorage.clearAppLocalStorageOnReload();

  assert.deepEqual(context.localStorage.entries(), {
    toioPlotterConfig: JSON.stringify({ deadMmPerSecAtDrawSpeed: 30 }),
  });
});
