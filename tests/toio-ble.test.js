const test = require("node:test");
const assert = require("node:assert/strict");
const toio = require("../toio-ble.js");

function view(bytes) {
  return new DataView(Uint8Array.from(bytes).buffer);
}

test("buildStopCommand creates a motor stop command", () => {
  assert.deepEqual([...toio.buildStopCommand()], [0x01, 0x01, 0x01, 0x00, 0x02, 0x01, 0x00]);
});

test("buildTimedMotorCommand creates forward timed motor command", () => {
  assert.deepEqual([...toio.buildTimedMotorCommand(50, 300)], [0x02, 0x01, 0x01, 50, 0x02, 0x01, 50, 30]);
});

test("buildTimedMotorCommand creates backward timed motor command and clamps duration", () => {
  assert.deepEqual([...toio.buildTimedMotorCommand(-999, 9999)], [0x02, 0x01, 0x02, 255, 0x02, 0x02, 255, 255]);
});

test("buildTimedMotorCommand can drive wheels in opposite directions", () => {
  assert.deepEqual([...toio.buildTimedMotorCommand(50, 300, 1)], [0x02, 0x01, 0x01, 50, 0x02, 0x02, 50, 30]);
});

test("buildTimedMotorCommand supports backward pen-up travel", () => {
  assert.deepEqual([...toio.buildTimedMotorCommand(-50, 300, 0)], [0x02, 0x01, 0x02, 50, 0x02, 0x02, 50, 30]);
});

test("buildTargetMoveCommand writes target fields little-endian", () => {
  const bytes = toio.buildTargetMoveCommand({
    id: 7,
    x: 300,
    y: 250,
    theta: 90,
    speed: 40,
    timeoutSec: 6,
  });

  assert.equal(bytes[0], 0x03);
  assert.equal(bytes[1], 7);
  assert.equal(bytes[2], 6);
  assert.equal(bytes[4], 40);
  assert.equal(bytes[7], 0x2c);
  assert.equal(bytes[8], 0x01);
  assert.equal(bytes[9], 0xfa);
  assert.equal(bytes[10], 0x00);
  assert.equal(bytes[11], 90);
  assert.equal(bytes[12], 0);
});

test("parseIdNotification parses Position ID", () => {
  const data = new Uint8Array(13);
  const dv = new DataView(data.buffer);
  data[0] = 0x01;
  dv.setUint16(1, 120, true);
  dv.setUint16(3, 130, true);
  dv.setUint16(5, 45, true);
  dv.setUint16(7, 121, true);
  dv.setUint16(9, 131, true);
  dv.setUint16(11, 46, true);

  assert.deepEqual(toio.parseIdNotification(dv), {
    type: "position",
    pose: {
      x: 120,
      y: 130,
      theta: 45,
      sensorX: 121,
      sensorY: 131,
      sensorTheta: 46,
    },
  });
});

test("parseIdNotification parses Position ID missed", () => {
  assert.deepEqual(toio.parseIdNotification(view([0x03])), { type: "missed" });
});

test("parseMotorTargetResponse parses target response", () => {
  assert.deepEqual(toio.parseMotorTargetResponse(view([0x83, 12, 0])), { id: 12, result: 0 });
  assert.equal(toio.parseMotorTargetResponse(view([0x01, 12, 0])), null);
});

test("describeTargetResult explains target errors", () => {
  assert.match(toio.describeTargetResult(0x02), /Position ID/);
});

test("normalizeBluetoothError explains globally disabled Web Bluetooth", () => {
  const error = toio.normalizeBluetoothError(new Error("Web Bluetooth API globally disabled."));

  assert.match(error.message, /Web Bluetooth/);
  assert.match(error.message, /無効/);
  assert.match(error.message, /flags/);
});
