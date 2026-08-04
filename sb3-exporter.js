(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Sb3Exporter = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TEMPLATE_URL = "templates/toio-do-two-cubes.sb3";
  const EXPORT_FILENAME = "toio-plotter-do.sb3";
  const MOVE_FOR_OPCODE_SUFFIX = "moveFor";
  const MOVE_OPCODE_SUFFIX = "moveWheelsFor";
  const STOP_OPCODE_SUFFIX = "stopWheels";
  const MAX_SPRITE_MOVE_STEP = 10;
  const MAX_SPRITE_TURN_STEP = 10;
  const SCRATCH_STAGE = { minX: -240, maxX: 240, minY: -180, maxY: 180 };
  const TEXT_DECODER = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  const TEXT_ENCODER = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const CRC_TABLE = makeCrcTable();

  async function exportProject({ templateBytes, commands, segments = [], mat = null, config, turnWheelSpeeds, getPenCommandSpeed, getPenCommandDuration }) {
    if (!commands?.length) throw new Error("コマンドがありません。");
    const zip = await readZipAsync(templateBytes);
    const projectEntry = zip.find((entry) => entry.name === "project.json");
    if (!projectEntry) throw new Error("テンプレートに project.json がありません。");

    const project = JSON.parse(decodeUtf8(projectEntry.data));
    const prototypes = findToioPrototypes(project);
    const operations = buildOperations(commands, config, { turnWheelSpeeds, getPenCommandSpeed, getPenCommandDuration });
    const spriteOperations = buildSpriteOperations(segments, mat);
    injectProgram(project, prototypes, operations, spriteOperations);
    ensurePenExtension(project);

    projectEntry.data = encodeUtf8(JSON.stringify(project));
    return writeZip(zip);
  }

  function buildOperations(commands, config, helpers) {
    const operations = [
      { kind: "stop", cube: 1 },
      { kind: "stop", cube: 2 },
    ];

    for (const command of commands) {
      if (command.type === "pen") {
        const speed = scaleSpeed(helpers.getPenCommandSpeed(command));
        const duration = seconds(helpers.getPenCommandDuration(command));
        operations.push({ kind: "wheels", cube: 2, leftSpeed: speed, rightSpeed: speed, duration });
        operations.push({ kind: "stop", cube: 2 });
        if (config.settleMs > 0) operations.push({ kind: "wait", duration: seconds(config.settleMs) });
      } else if (command.type === "turn") {
        const speeds = helpers.turnWheelSpeeds(command);
        operations.push({
          kind: "wheels",
          cube: 1,
          leftSpeed: scaleSpeed(speeds.left),
          rightSpeed: scaleSpeed(speeds.right),
          duration: seconds(Math.max(100, command.durationMs || 0)),
        });
        operations.push({ kind: "stop", cube: 1 });
      } else if (command.type === "motor") {
        operations.push({
          kind: "wheels",
          cube: 1,
          leftSpeed: scaleSpeed(command.leftSpeed ?? command.speed ?? 0),
          rightSpeed: scaleSpeed(command.rightSpeed ?? command.speed ?? 0),
          duration: seconds(command.durationMs || 0),
        });
        operations.push({ kind: "stop", cube: 1 });
      } else if (command.type === "wait" && command.ms > 0) {
        operations.push({ kind: "wait", duration: seconds(command.ms) });
      }
    }

    return operations.filter((operation) => operation.kind !== "wheels" || operation.duration > 0);
  }

  function scaleSpeed(value) {
    const scaled = Math.round((Number(value) || 0) * 100 / 255);
    return clamp(scaled, -100, 100);
  }

  function seconds(ms) {
    return Math.round((Math.max(0, Number(ms) || 0) / 1000) * 1000) / 1000;
  }

  function findToioPrototypes(project) {
    const result = {
      move: {},
      moveFor: {},
      stop: {},
      unknownMoves: [],
      unknownMoveFors: [],
      unknownStops: [],
      wait: null,
      flag: null,
      target: null,
    };

    for (const target of project.targets || []) {
      const blocks = target.blocks || {};
      for (const [id, block] of Object.entries(blocks)) {
        const opcode = String(block.opcode || "");
        const cube = cubeNumberForBlock(id, block);
        if (opcode.endsWith(MOVE_OPCODE_SUFFIX) && cube) result.move[cube] = cloneBlock(block);
        if (opcode.endsWith(MOVE_OPCODE_SUFFIX) && !cube) result.unknownMoves.push(cloneBlock(block));
        if (opcode.endsWith(MOVE_FOR_OPCODE_SUFFIX) && !opcode.endsWith(MOVE_OPCODE_SUFFIX) && cube) result.moveFor[cube] = cloneBlock(block);
        if (opcode.endsWith(MOVE_FOR_OPCODE_SUFFIX) && !opcode.endsWith(MOVE_OPCODE_SUFFIX) && !cube) result.unknownMoveFors.push(cloneBlock(block));
        if (opcode.endsWith(STOP_OPCODE_SUFFIX) && cube) result.stop[cube] = cloneBlock(block);
        if (opcode.endsWith(STOP_OPCODE_SUFFIX) && !cube) result.unknownStops.push(cloneBlock(block));
        if (opcode === "control_wait") result.wait = cloneBlock(block);
        if (opcode === "event_whenflagclicked") {
          result.flag = cloneBlock(block);
          result.target = target;
        }
      }
    }

    result.target = result.target || firstEditableTarget(project);
    if (!result.target) throw new Error("テンプレートに編集可能なターゲットがありません。");
    if (!result.flag) result.flag = { opcode: "event_whenflagclicked", next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 80 };
    if (!result.wait) result.wait = { opcode: "control_wait", next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: false };

    for (const cube of [1, 2]) {
      if (!result.move[cube] && result.unknownMoves.length) result.move[cube] = result.unknownMoves.shift();
      if (!result.moveFor[cube] && result.unknownMoveFors.length) result.moveFor[cube] = result.unknownMoveFors.shift();
      if (!result.move[cube] && result.moveFor[cube]) result.move[cube] = moveWheelsPrototypeFromMoveFor(result.moveFor[cube]);
      if (!result.stop[cube] && result.unknownStops.length) result.stop[cube] = result.unknownStops.shift();
      if (!result.move[cube]) throw new Error(`テンプレートに toio #${cube} の左右タイヤブロックが見つかりません。`);
      if (!result.stop[cube]) result.stop[cube] = { ...result.move[cube], opcode: stopOpcodeFromMove(result.move[cube].opcode), inputs: {}, fields: {} };
    }

    return result;
  }

  function cubeNumberForBlock(id, block) {
    const text = `${id} ${block.opcode || ""} ${JSON.stringify(block.fields || {})} ${JSON.stringify(block.mutation || {})}`;
    const explicit = text.match(/(?:toio|cube|#)\s*#?\s*([12])|([12])\s*(?:toio|cube)/i);
    if (explicit) return Number(explicit[1] || explicit[2]);
    if (String(block.opcode || "").includes("2")) return 2;
    if (String(block.opcode || "").includes("1")) return 1;
    return null;
  }

  function stopOpcodeFromMove(opcode) {
    return String(opcode || "").replace(MOVE_OPCODE_SUFFIX, STOP_OPCODE_SUFFIX);
  }

  function moveWheelsPrototypeFromMoveFor(block) {
    const result = cloneBlock(block);
    result.opcode = String(result.opcode || "").replace(MOVE_FOR_OPCODE_SUFFIX, MOVE_OPCODE_SUFFIX);
    result.inputs = {};
    result.fields = {};
    return result;
  }

  function buildSpriteOperations(segments, mat) {
    const drawableSegments = (segments || []).filter((segment) => segment?.start && segment?.end && Number.isFinite(segment.lengthMm));
    const operations = [
      { kind: "clear" },
      { kind: "setColor", color: "#000000" },
      { kind: "penUp" },
    ];
    if (!drawableSegments.length) return operations;

    const mapper = createScratchMapper(mat, drawableSegments);
    const first = drawableSegments[0];
    const start = mapper.toScratch(first.start);
    let currentDirection = scratchDirection(first.heading);
    operations.push({ kind: "goto", x: start.x, y: start.y });
    operations.push({ kind: "point", direction: currentDirection });

    for (const segment of drawableSegments) {
      const nextDirection = scratchDirection(segment.heading);
      const delta = signedAngleDelta(currentDirection, nextDirection);
      operations.push(...repeatTurnOperations(delta));
      currentDirection = normalizeScratchDirection(currentDirection + delta);
      operations.push(segment.kind === "draw" ? { kind: "penDown" } : { kind: "penUp" });
      operations.push(...repeatMoveOperations(segment.lengthMm * mapper.scale));
      if (segment.kind === "draw") operations.push({ kind: "penUp" });
    }

    return operations;
  }

  function createScratchMapper(mat, segments) {
    const bounds = mat || boundsForSegments(segments);
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min((SCRATCH_STAGE.maxX - SCRATCH_STAGE.minX) / width, (SCRATCH_STAGE.maxY - SCRATCH_STAGE.minY) / height) * 0.9;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    return {
      scale,
      toScratch(point) {
        return {
          x: roundNumber((point.x - centerX) * scale),
          y: roundNumber((centerY - point.y) * scale),
        };
      },
    };
  }

  function boundsForSegments(segments) {
    const points = segments.flatMap((segment) => [segment.start, segment.end]);
    return {
      minX: Math.min(...points.map((point) => point.x)),
      maxX: Math.max(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxY: Math.max(...points.map((point) => point.y)),
    };
  }

  function repeatMoveOperations(totalSteps) {
    const count = Math.max(1, Math.ceil(Math.abs(totalSteps) / MAX_SPRITE_MOVE_STEP));
    return [{ kind: "repeatMove", count, steps: roundNumber(totalSteps / count) }];
  }

  function repeatTurnOperations(totalDegrees) {
    if (Math.abs(totalDegrees) < 0.001) return [];
    const count = Math.max(1, Math.ceil(Math.abs(totalDegrees) / MAX_SPRITE_TURN_STEP));
    return [{ kind: "repeatTurn", count, degrees: roundNumber(Math.abs(totalDegrees) / count), direction: totalDegrees >= 0 ? "right" : "left" }];
  }

  function scratchDirection(heading) {
    return normalizeScratchDirection(90 + (Number(heading) || 0));
  }

  function normalizeScratchDirection(degrees) {
    let normalized = ((((degrees + 180) % 360) + 360) % 360) - 180;
    if (normalized === -180) normalized = 180;
    return roundNumber(normalized);
  }

  function signedAngleDelta(fromDeg, toDeg) {
    return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
  }

  function injectProgram(project, prototypes, operations, spriteOperations) {
    const target = prototypes.target;
    target.blocks = {};
    const generated = {};
    const flagId = makeId("plotter_flag", 0);
    const chainIds = operations.map((_, index) => makeId("plotter_cmd", index));
    generated[flagId] = {
      ...cloneBlock(prototypes.flag),
      next: chainIds[0] || null,
      parent: null,
      topLevel: true,
      x: 80,
      y: 80,
    };

    operations.forEach((operation, index) => {
      const id = chainIds[index];
      const next = chainIds[index + 1] || null;
      const parent = index === 0 ? flagId : chainIds[index - 1];
      generated[id] = blockForOperation(operation, prototypes, id, parent, next, index);
    });

    const spriteFlagId = makeId("plotter_sprite_flag", 0);
    const spriteIds = spriteOperations.map((_, index) => makeId("plotter_sprite", index));
    generated[spriteFlagId] = {
      opcode: "event_whenflagclicked",
      next: spriteIds[0] || null,
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 360,
      y: 80,
    };

    spriteOperations.forEach((operation, index) => {
      const id = spriteIds[index];
      const next = spriteIds[index + 1] || null;
      const parent = index === 0 ? spriteFlagId : spriteIds[index - 1];
      Object.assign(generated, spriteBlocksForOperation(operation, id, parent, next));
    });

    Object.assign(target.blocks, generated);
  }

  function spriteBlocksForOperation(operation, id, parent, next) {
    if (operation.kind === "clear") return { [id]: commandBlock("pen_clear", parent, next) };
    if (operation.kind === "setColor") {
      return {
        [id]: commandBlock("pen_setPenColorToColor", parent, next, {
          COLOR: [1, [9, operation.color]],
        }),
      };
    }
    if (operation.kind === "penUp") return { [id]: commandBlock("pen_penUp", parent, next) };
    if (operation.kind === "penDown") return { [id]: commandBlock("pen_penDown", parent, next) };
    if (operation.kind === "goto") {
      return {
        [id]: commandBlock("motion_gotoxy", parent, next, {
          X: numberInput(id, "x", operation.x),
          Y: numberInput(id, "y", operation.y),
        }),
      };
    }
    if (operation.kind === "point") {
      return {
        [id]: commandBlock("motion_pointindirection", parent, next, {
          DIRECTION: numberInput(id, "direction", operation.direction),
        }),
      };
    }
    if (operation.kind === "repeatMove") {
      const childId = `${id}_move`;
      return {
        [id]: repeatBlock(parent, next, operation.count, childId),
        [childId]: commandBlock("motion_movesteps", id, null, {
          STEPS: numberInput(childId, "steps", operation.steps),
        }),
      };
    }
    if (operation.kind === "repeatTurn") {
      const childId = `${id}_turn`;
      return {
        [id]: repeatBlock(parent, next, operation.count, childId),
        [childId]: commandBlock(operation.direction === "right" ? "motion_turnright" : "motion_turnleft", id, null, {
          DEGREES: numberInput(childId, "degrees", operation.degrees),
        }),
      };
    }
    throw new Error(`未対応のスプライト操作です: ${operation.kind}`);
  }

  function commandBlock(opcode, parent, next, inputs = {}) {
    return {
      opcode,
      next,
      parent,
      inputs,
      fields: {},
      shadow: false,
      topLevel: false,
    };
  }

  function repeatBlock(parent, next, count, childId) {
    return commandBlock("control_repeat", parent, next, {
      TIMES: [1, [6, String(Math.max(1, Math.round(count)))]],
      SUBSTACK: [2, childId],
    });
  }

  function blockForOperation(operation, prototypes, id, parent, next, index) {
    if (operation.kind === "wait") {
      const block = cloneBlock(prototypes.wait);
      return finishCommandBlock(block, parent, next, {
        DURATION: numberInput(id, "duration", operation.duration),
      });
    }

    if (operation.kind === "stop") {
      const block = cloneBlock(prototypes.stop[operation.cube]);
      return finishCommandBlock(block, parent, next, {});
    }

    const block = cloneBlock(prototypes.move[operation.cube]);
    return finishCommandBlock(block, parent, next, {
      LEFT_SPEED: numberInput(id, "left", operation.leftSpeed),
      RIGHT_SPEED: numberInput(id, "right", operation.rightSpeed),
      DURATION: numberInput(id, "duration", operation.duration),
    }, index);
  }

  function finishCommandBlock(block, parent, next, inputs, index = 0) {
    block.parent = parent;
    block.next = next;
    block.topLevel = false;
    block.shadow = false;
    block.inputs = { ...(block.inputs || {}), ...inputs };
    block.fields = block.fields || {};
    delete block.x;
    delete block.y;
    return block;
  }

  function numberInput(parentId, key, value) {
    const id = `${parentId}_${key}`;
    return [1, [4, String(value)]];
  }

  function ensurePenExtension(project) {
    project.extensions = Array.isArray(project.extensions) ? project.extensions : [];
    if (!project.extensions.includes("pen")) project.extensions.push("pen");
  }

  function firstEditableTarget(project) {
    return (project.targets || []).find((target) => !target.isStage) || (project.targets || [])[0] || null;
  }

  function cloneBlock(block) {
    return JSON.parse(JSON.stringify(block));
  }

  function makeId(prefix, index) {
    return `${prefix}_${String(index).padStart(4, "0")}`;
  }

  function roundNumber(value) {
    return Math.round((Number(value) || 0) * 1000) / 1000;
  }

  function readZip(bytesInput) {
    const bytes = bytesInput instanceof Uint8Array ? bytesInput : new Uint8Array(bytesInput);
    const entries = [];
    let offset = 0;
    while (offset + 4 <= bytes.length) {
      const signature = readU32(bytes, offset);
      if (signature === 0x02014b50 || signature === 0x06054b50) break;
      if (signature !== 0x04034b50) throw new Error("テンプレートSB3のZIP形式を読めません。");
      const flags = readU16(bytes, offset + 6);
      const method = readU16(bytes, offset + 8);
      const compressedSize = readU32(bytes, offset + 18);
      const uncompressedSize = readU32(bytes, offset + 22);
      const nameLength = readU16(bytes, offset + 26);
      const extraLength = readU16(bytes, offset + 28);
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (flags & 0x08) throw new Error("データ記述子付きZIPは未対応です。");
      if (method !== 0) throw new Error("圧縮済みZIPは未対応です。テンプレートを無圧縮ZIPで保存してください。");
      if (dataEnd > bytes.length) throw new Error("テンプレートSB3が壊れています。");
      entries.push({
        name: decodeUtf8(bytes.slice(nameStart, nameStart + nameLength)),
        data: bytes.slice(dataStart, dataEnd),
        modifiedTime: readU16(bytes, offset + 10),
        modifiedDate: readU16(bytes, offset + 12),
        externalAttributes: 0,
        uncompressedSize,
      });
      offset = dataEnd;
    }
    return entries;
  }

  async function readZipAsync(bytesInput) {
    const bytes = bytesInput instanceof Uint8Array ? bytesInput : new Uint8Array(bytesInput);
    const entries = [];
    let offset = 0;
    while (offset + 4 <= bytes.length) {
      const signature = readU32(bytes, offset);
      if (signature === 0x02014b50 || signature === 0x06054b50) break;
      if (signature !== 0x04034b50) throw new Error("テンプレートSB3のZIP形式を読めません。");
      const flags = readU16(bytes, offset + 6);
      const method = readU16(bytes, offset + 8);
      const compressedSize = readU32(bytes, offset + 18);
      const uncompressedSize = readU32(bytes, offset + 22);
      const nameLength = readU16(bytes, offset + 26);
      const extraLength = readU16(bytes, offset + 28);
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (flags & 0x08) throw new Error("データ記述子付きZIPは未対応です。");
      if (dataEnd > bytes.length) throw new Error("テンプレートSB3が壊れています。");
      let data = bytes.slice(dataStart, dataEnd);
      if (method === 8) data = await inflateRaw(data);
      if (method !== 0 && method !== 8) throw new Error(`未対応のZIP圧縮方式です: ${method}`);
      entries.push({
        name: decodeUtf8(bytes.slice(nameStart, nameStart + nameLength)),
        data,
        modifiedTime: readU16(bytes, offset + 10),
        modifiedDate: readU16(bytes, offset + 12),
        externalAttributes: 0,
        uncompressedSize,
      });
      offset = dataEnd;
    }
    return entries;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream !== "undefined" && typeof Blob !== "undefined" && typeof Response !== "undefined") {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (typeof require === "function") {
      return new Uint8Array(require("node:zlib").inflateRawSync(data));
    }
    throw new Error("圧縮済みテンプレートSB3を展開できません。Chrome/Edge の最新版で開いてください。");
  }

  function writeZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const name = encodeUtf8(entry.name);
      const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length + data.length);
      writeU32(local, 0, 0x04034b50);
      writeU16(local, 4, 20);
      writeU16(local, 6, 0);
      writeU16(local, 8, 0);
      writeU16(local, 10, entry.modifiedTime || 0);
      writeU16(local, 12, entry.modifiedDate || 0);
      writeU32(local, 14, crc);
      writeU32(local, 18, data.length);
      writeU32(local, 22, data.length);
      writeU16(local, 26, name.length);
      writeU16(local, 28, 0);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      localParts.push(local);

      const central = new Uint8Array(46 + name.length);
      writeU32(central, 0, 0x02014b50);
      writeU16(central, 4, 20);
      writeU16(central, 6, 20);
      writeU16(central, 8, 0);
      writeU16(central, 10, 0);
      writeU16(central, 12, entry.modifiedTime || 0);
      writeU16(central, 14, entry.modifiedDate || 0);
      writeU32(central, 16, crc);
      writeU32(central, 20, data.length);
      writeU32(central, 24, data.length);
      writeU16(central, 28, name.length);
      writeU16(central, 30, 0);
      writeU16(central, 32, 0);
      writeU16(central, 34, 0);
      writeU16(central, 36, 0);
      writeU32(central, 38, entry.externalAttributes || 0);
      writeU32(central, 42, offset);
      central.set(name, 46);
      centralParts.push(central);
      offset += local.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    writeU32(end, 0, 0x06054b50);
    writeU16(end, 8, entries.length);
    writeU16(end, 10, entries.length);
    writeU32(end, 12, centralSize);
    writeU32(end, 16, offset);
    writeU16(end, 20, 0);

    return concatUint8Arrays([...localParts, ...centralParts, end]);
  }

  function concatUint8Arrays(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function encodeUtf8(text) {
    if (TEXT_ENCODER) return TEXT_ENCODER.encode(text);
    return Uint8Array.from(Buffer.from(text, "utf8"));
  }

  function decodeUtf8(bytes) {
    if (TEXT_DECODER) return TEXT_DECODER.decode(bytes);
    return Buffer.from(bytes).toString("utf8");
  }

  function readU16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readU32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function writeU16(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function writeU32(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[i] = value >>> 0;
    }
    return table;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  return {
    TEMPLATE_URL,
    EXPORT_FILENAME,
    buildOperations,
    exportProject,
    readZip,
    readZipAsync,
    writeZip,
    scaleSpeed,
  };
});
