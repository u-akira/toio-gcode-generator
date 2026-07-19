(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ToioBle = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const UUIDS = {
    service: "10b20100-5b3b-4571-9508-cf3efcd7bbae",
    id: "10b20101-5b3b-4571-9508-cf3efcd7bbae",
    motor: "10b20102-5b3b-4571-9508-cf3efcd7bbae",
  };

  class ToioCube {
    constructor(role, options = {}) {
      this.role = role;
      this.bluetooth = options.bluetooth || globalThis.navigator?.bluetooth;
      this.onStatus = options.onStatus || (() => {});
      this.onPose = options.onPose || (() => {});
      this.onLog = options.onLog || (() => {});
      this.onPositionMissed = options.onPositionMissed || (() => {});
      this.device = null;
      this.server = null;
      this.idChar = null;
      this.motorChar = null;
      this.pose = null;
      this.nextTargetId = 1;
      this.pendingTargets = new Map();
    }

    async connect() {
      if (!this.bluetooth) {
        throw new Error("このブラウザは Web Bluetooth に対応していません。PC の Chrome / Edge を使ってください。");
      }

      try {
        this.device = await this.bluetooth.requestDevice({
          filters: [{ services: [UUIDS.service] }],
          optionalServices: [UUIDS.service],
        });
      } catch (error) {
        throw normalizeBluetoothError(error);
      }

      this.device.addEventListener("gattserverdisconnected", () => {
        this.onStatus("切断");
        this.pose = null;
      });

      this.server = await this.device.gatt.connect();
      const service = await this.server.getPrimaryService(UUIDS.service);
      this.idChar = await service.getCharacteristic(UUIDS.id);
      this.motorChar = await service.getCharacteristic(UUIDS.motor);

      await this.idChar.startNotifications();
      this.idChar.addEventListener("characteristicvaluechanged", (event) => this.handleId(event.target.value));

      await this.motorChar.startNotifications();
      this.motorChar.addEventListener("characteristicvaluechanged", (event) => this.handleMotor(event.target.value));

      this.onStatus(this.device.name || "接続済み");
      this.onLog(`${this.role} toio を接続しました`);
    }

    handleId(value) {
      const parsed = parseIdNotification(value);
      if (parsed.type === "position") {
        this.pose = parsed.pose;
        this.onPose(parsed.pose);
      } else if (parsed.type === "missed") {
        this.onPositionMissed();
      }
    }

    handleMotor(value) {
      const parsed = parseMotorTargetResponse(value);
      if (!parsed) return;
      const pending = this.pendingTargets.get(parsed.id);
      if (!pending) return;
      this.pendingTargets.delete(parsed.id);
      if (parsed.result === 0x00) {
        pending.resolve();
      } else {
        pending.reject(new Error(`toio target ${parsed.id} failed: ${describeTargetResult(parsed.result)}`));
      }
    }

    async write(bytes) {
      if (!this.motorChar) throw new Error(`${this.role} toio が未接続です。`);
      await this.motorChar.writeValueWithoutResponse(Uint8Array.from(bytes));
    }

    async stop() {
      if (!this.motorChar) return;
      await this.write(buildStopCommand());
    }

    async timedMotor(speed, durationMs, mode = 0) {
      await this.write(buildTimedMotorCommand(speed, durationMs, mode));
    }

    async moveTo(x, y, theta, speed, timeoutSec) {
      const id = this.nextTargetId;
      this.nextTargetId = (this.nextTargetId + 1) & 0xff;
      const bytes = buildTargetMoveCommand({ id, x, y, theta, speed, timeoutSec });

      const promise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingTargets.delete(id);
          reject(new Error(`toio target ${id} response timeout`));
        }, (timeoutSec + 3) * 1000);
        this.pendingTargets.set(id, {
          resolve: () => {
            clearTimeout(timeout);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
      });

      await this.motorChar.writeValueWithoutResponse(bytes);
      return promise;
    }
  }

  function parseIdNotification(value) {
    if (value.getUint8(0) === 0x01 && value.byteLength >= 13) {
      return {
        type: "position",
        pose: {
          x: value.getUint16(1, true),
          y: value.getUint16(3, true),
          theta: value.getUint16(5, true),
          sensorX: value.getUint16(7, true),
          sensorY: value.getUint16(9, true),
          sensorTheta: value.getUint16(11, true),
        },
      };
    }
    if (value.getUint8(0) === 0x03) return { type: "missed" };
    return { type: "unknown" };
  }

  function parseMotorTargetResponse(value) {
    if (value.getUint8(0) !== 0x83 || value.byteLength < 3) return null;
    return {
      id: value.getUint8(1),
      result: value.getUint8(2),
    };
  }

  function describeTargetResult(result) {
    const hex = `0x${result.toString(16).padStart(2, "0")}`;
    if (result === 0x00) return `${hex} 成功`;
    if (result === 0x01) return `${hex} タイムアウト`;
    if (result === 0x02) return `${hex} Position ID 未取得または目標に到達できません`;
    if (result === 0x03) return `${hex} 指定パラメータが不正です`;
    return `${hex} 不明なエラー`;
  }

  function normalizeBluetoothError(error) {
    const message = String(error?.message || error || "");
    if (message.includes("globally disabled")) {
      return new Error(
        "Web Bluetooth がブラウザ全体で無効です。PC版 Chrome/Edge の設定、chrome://flags/#enable-web-bluetooth、管理ポリシー、HTTPS/localhost で開いているかを確認してください。",
      );
    }
    if (message.includes("User cancelled") || message.includes("cancelled")) {
      return new Error("toio の選択がキャンセルされました。接続ボタンからもう一度選択してください。");
    }
    if (message.includes("Bluetooth adapter not available") || message.includes("Bluetooth adapter")) {
      return new Error("Bluetooth アダプターが利用できません。PC の Bluetooth がオンか確認してください。");
    }
    return error instanceof Error ? error : new Error(message || "Web Bluetooth 接続に失敗しました。");
  }

  function buildStopCommand() {
    return Uint8Array.from([0x01, 0x01, 0x01, 0x00, 0x02, 0x01, 0x00]);
  }

  function buildTimedMotorCommand(speed, durationMs, mode = 0) {
    const duration = clamp(Math.round(durationMs / 10), 1, 255);
    const direction = speed >= 0 ? 0x01 : 0x02;
    const rightDirection = mode === 1 ? oppositeDirection(direction) : direction;
    const amount = clamp(Math.abs(Math.round(speed)), 0, 255);
    return Uint8Array.from([0x02, 0x01, direction, amount, 0x02, rightDirection, amount, duration]);
  }

  function oppositeDirection(direction) {
    return direction === 0x01 ? 0x02 : 0x01;
  }

  function buildTargetMoveCommand({ id, x, y, theta, speed, timeoutSec, movementType = 1 }) {
    const bytes = new Uint8Array(13);
    bytes[0] = 0x03;
    bytes[1] = clamp(Math.round(id), 0, 255);
    bytes[2] = clamp(Math.round(timeoutSec), 1, 255);
    bytes[3] = clamp(Math.round(movementType), 0, 2);
    bytes[4] = clamp(Math.round(speed), 10, 255);
    bytes[5] = 0x00;
    bytes[6] = 0x00;
    writeU16(bytes, 7, clamp(Math.round(x), 0, 0xffff));
    writeU16(bytes, 9, clamp(Math.round(y), 0, 0xffff));
    writeU16(bytes, 11, clamp(Math.round(theta) % 360, 0, 0x1fff));
    return bytes;
  }

  function writeU16(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  return {
    UUIDS,
    ToioCube,
    parseIdNotification,
    parseMotorTargetResponse,
    describeTargetResult,
    normalizeBluetoothError,
    buildStopCommand,
    buildTimedMotorCommand,
    buildTargetMoveCommand,
  };
});
