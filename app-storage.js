(function (root) {
  "use strict";

  const CONFIG_KEY = "toioPlotterConfig";
  const DEAD_SEGMENT_SETTINGS_KEY = "toioPlotterDeadSegmentSettings";
  const TURN_CALIBRATION_LOG_KEY = "toioPlotterTurnCalibrationLog";

  function defaultConfig() {
    return root.PlotterCore.DEFAULT_CONFIG;
  }

  function loadConfig() {
    const DEFAULT_CONFIG = defaultConfig();
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
      const savedVersion = saved.configVersion || 0;
      let changed = false;
      if (!saved.configVersion && saved.penOffsetX === 0 && saved.penOffsetY === 48) {
        saved.penOffsetX = DEFAULT_CONFIG.penOffsetX;
        saved.penOffsetY = DEFAULT_CONFIG.penOffsetY;
        changed = true;
      }
      if (savedVersion < 3) {
        saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
        saved.downMotorSpeed = DEFAULT_CONFIG.downMotorSpeed;
        saved.penMotorMode = DEFAULT_CONFIG.penMotorMode;
        changed = true;
      }
      if (savedVersion < 4) {
        saved.travelSpeed = DEFAULT_CONFIG.travelSpeed;
        saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
        saved.downMotorSpeed = DEFAULT_CONFIG.downMotorSpeed;
        changed = true;
      }
      if (savedVersion < 5) {
        saved.drawSpeed = DEFAULT_CONFIG.drawSpeed;
        saved.travelSpeed = DEFAULT_CONFIG.travelSpeed;
        changed = true;
      }
      if (savedVersion < 6) {
        saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
        changed = true;
      }
      if (savedVersion < 7) {
        saved.upMotorSpeed = DEFAULT_CONFIG.upMotorSpeed;
        changed = true;
      }
      if (savedVersion < 8) {
        saved.deadTurnSpeed = DEFAULT_CONFIG.deadTurnSpeed;
        saved.deadTurnBalanceTrim = DEFAULT_CONFIG.deadTurnBalanceTrim;
        saved.deadMmPerSecAtDrawSpeed = DEFAULT_CONFIG.deadMmPerSecAtDrawSpeed;
        saved.deadMmPerSecAtTravelSpeed = DEFAULT_CONFIG.deadMmPerSecAtTravelSpeed;
        changed = true;
      }
      if (savedVersion < 11) {
        changed = true;
      }
      if (savedVersion < 12 && saved.deadTurnSpeed === 30) {
        saved.deadTurnSpeed = DEFAULT_CONFIG.deadTurnSpeed;
        changed = true;
      }
      if (savedVersion < 16) {
        saved.deadMmPerSecAtTravelSpeed = DEFAULT_CONFIG.deadMmPerSecAtTravelSpeed;
        changed = true;
      }
      if (savedVersion < 24) {
        saved.deadTurnSpeed = DEFAULT_CONFIG.deadTurnSpeed;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(saved, "deadTurnDurationScale")) {
        delete saved.deadTurnDurationScale;
        changed = true;
      }
      if (savedVersion < 24) {
        saved.deadTurnMsPer90 = DEFAULT_CONFIG.deadTurnMsPer90;
        changed = true;
      }
      if (savedVersion < 25) {
        saved.deadTravelDistanceScale = DEFAULT_CONFIG.deadTravelDistanceScale;
        changed = true;
      }
      if (savedVersion < 26) {
        saved.deadWheelBaseMm = DEFAULT_CONFIG.deadWheelBaseMm;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(saved, "runMode")) {
        delete saved.runMode;
        changed = true;
      }
      const loaded = { ...DEFAULT_CONFIG, ...saved, configVersion: DEFAULT_CONFIG.configVersion };
      delete loaded.runMode;
      if (changed || saved.configVersion !== DEFAULT_CONFIG.configVersion) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(loaded));
      }
      return loaded;
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveConfig(config) {
    const saved = { ...config };
    delete saved.runMode;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(saved));
  }

  function loadDeadSegmentSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem(DEAD_SEGMENT_SETTINGS_KEY) || "{}");
      let changed = false;
      for (const setting of Object.values(settings)) {
        if (setting && Object.prototype.hasOwnProperty.call(setting, "turnDurationScale")) {
          delete setting.turnDurationScale;
          changed = true;
        }
      }
      if (changed) localStorage.setItem(DEAD_SEGMENT_SETTINGS_KEY, JSON.stringify(settings));
      return settings;
    } catch {
      return {};
    }
  }

  function saveDeadSegmentSettings(settings) {
    localStorage.setItem(DEAD_SEGMENT_SETTINGS_KEY, JSON.stringify(settings));
  }

  function serializeCommandOverrides(commandOverrides) {
    return Object.fromEntries(commandOverrides.entries());
  }

  function loadCommandOverrides(value) {
    if (Array.isArray(value)) return new Map(value);
    if (value && typeof value === "object") return new Map(Object.entries(value));
    return new Map();
  }

  function loadTurnCalibrationLog({ resetOnLoad = false } = {}) {
    if (resetOnLoad) {
      localStorage.removeItem(TURN_CALIBRATION_LOG_KEY);
      return {};
    }
    try {
      return JSON.parse(localStorage.getItem(TURN_CALIBRATION_LOG_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveTurnCalibrationLog(turnCalibrationLog) {
    localStorage.setItem(TURN_CALIBRATION_LOG_KEY, JSON.stringify(turnCalibrationLog));
  }

  function clearTurnCalibrationLog() {
    localStorage.removeItem(TURN_CALIBRATION_LOG_KEY);
  }

  root.ToioPlotterStorage = {
    loadConfig,
    saveConfig,
    loadDeadSegmentSettings,
    saveDeadSegmentSettings,
    serializeCommandOverrides,
    loadCommandOverrides,
    loadTurnCalibrationLog,
    saveTurnCalibrationLog,
    clearTurnCalibrationLog,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
