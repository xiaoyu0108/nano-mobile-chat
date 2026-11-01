/* 从 PNG 的 tEXt / zTXt / iTXt 文本块中提取 JSON。
   用于导入内嵌 JSON 的世界书 / 线下规则 PNG；普通 JSON 文件可直接导入。 */
(function () {
  'use strict';
  if (window.NanoPngJson) return;

  async function inflate(bytes) {
    if (window.pako && window.pako.inflate) return window.pako.inflate(bytes);
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('当前浏览器不支持解压 PNG 文本块');
  }

  function decodeUtf8(bytes) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function parseValue(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) {}
    try {
      const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      const padded = clean + '='.repeat((4 - clean.length % 4) % 4);
      const bin = atob(padded);
      const bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
      return JSON.parse(decodeUtf8(bytes));
    } catch (e2) {}
    return null;
  }

  async function readChunks(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.byteLength < 8 || view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
      throw new Error('不是有效的 PNG 文件');
    }
    let offset = 8;
    const chunks = {};
    while (offset + 8 <= arrayBuffer.byteLength) {
      const length = view.getUint32(offset);
      let type = '';
      for (let i = 0; i < 4; i++) type += String.fromCharCode(view.getUint8(offset + 4 + i));
      const dataStart = offset + 8;
      if (dataStart + length > arrayBuffer.byteLength) break;
      try {
        if (type === 'tEXt') {
          let sep = -1;
          for (let i = 0; i < length; i++) {
            if (view.getUint8(dataStart + i) === 0) { sep = i; break; }
          }
          if (sep !== -1) {
            const key = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer, dataStart, sep));
            const val = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer, dataStart + sep + 1, length - sep - 1));
            chunks[key] = (chunks[key] || '') + val;
          }
        } else if (type === 'zTXt') {
          let sep = -1;
          for (let i = 0; i < length; i++) {
            if (view.getUint8(dataStart + i) === 0) { sep = i; break; }
          }
          if (sep !== -1 && sep + 2 <= length) {
            const key = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer, dataStart, sep));
            const raw = new Uint8Array(arrayBuffer, dataStart + sep + 2, length - sep - 2);
            const out = await inflate(raw);
            chunks[key] = (chunks[key] || '') + decodeUtf8(out);
          }
        } else if (type === 'iTXt') {
          const u8 = new Uint8Array(arrayBuffer, dataStart, length);
          let pos = 0;
          while (pos < length && u8[pos] !== 0) pos++;
          const key = decodeUtf8(u8.subarray(0, pos));
          pos++;
          const compFlag = u8[pos++];
          pos++; // compression method
          while (pos < length && u8[pos] !== 0) pos++; pos++;
          while (pos < length && u8[pos] !== 0) pos++; pos++;
          let valBytes = u8.subarray(pos);
          if (compFlag === 1) valBytes = await inflate(valBytes);
          chunks[key] = (chunks[key] || '') + decodeUtf8(valBytes);
        }
      } catch (e) {}
      offset += 12 + length;
    }
    return chunks;
  }

  function unwrapCard(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.data && typeof obj.data === 'object' && (obj.data.name || obj.data.character_book || obj.data.extensions || obj.data.char_name)) return obj.data;
    return obj;
  }

  async function extractJson(arrayBuffer, preferredKeys) {
    const chunks = await readChunks(arrayBuffer);
    const keys = (preferredKeys || []).concat(Object.keys(chunks));
    const seen = {};
    for (const key of keys) {
      if (!key || seen[key] || !chunks[key]) continue;
      seen[key] = true;
      const value = parseValue(chunks[key]);
      if (value) return { key: key, value: value, chunks: chunks };
    }
    return null;
  }

  async function extractWorldbook(arrayBuffer) {
    const found = await extractJson(arrayBuffer, ['worldbook', 'lorebook', 'nano_worldbook', 'chara', 'ccv3', 'character', 'json']);
    if (!found) return null;
    const root = unwrapCard(found.value) || found.value;
    const book = root.character_book || root.characterBook || root.worldbook || root.lorebook ||
      (root.extensions && (root.extensions.world || root.extensions.worldbook || root.extensions.lorebook));
    if (book && Array.isArray(book.entries) && book.entries.length) {
      return { name: book.name || root.name || root.char_name || '', entries: book.entries };
    }
    if (Array.isArray(root.entries) && root.entries.length) {
      return { name: root.name || root.char_name || '', entries: root.entries };
    }
    return null;
  }

  // ===== 写入：把 JSON 以 base64 塞进 tEXt 块（读取端会自动尝试 base64 解码）=====
  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeChunk(type, dataBytes) {
    const data = dataBytes instanceof Uint8Array ? dataBytes : new Uint8Array(dataBytes);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i) & 0xFF;
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  function findIend(png) {
    // IEND 固定是最后 12 字节：length(4)=0 + "IEND"(4) + crc(4)
    if (png.length >= 12) {
      const off = png.length - 12;
      if (png[off] === 0 && png[off + 1] === 0 && png[off + 2] === 0 && png[off + 3] === 0 &&
          png[off + 4] === 0x49 && png[off + 5] === 0x45 && png[off + 6] === 0x4E && png[off + 7] === 0x44) {
        return off;
      }
    }
    // 少数编码器末尾带额外字节：从后往前找 IEND chunk
    for (let i = png.length - 12; i >= 8; i--) {
      if (png[i + 4] === 0x49 && png[i + 5] === 0x45 && png[i + 6] === 0x4E && png[i + 7] === 0x44) return i;
    }
    return -1;
  }

  function bytesToBase64(bytes) {
    let s = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(s);
  }

  function embedText(arrayBuffer, key, value) {
    const png = new Uint8Array(arrayBuffer);
    const iend = findIend(png);
    if (iend < 0) throw new Error('PNG 文件不完整，找不到 IEND');
    const textBytes = new TextEncoder().encode(String(key || 'nano_card') + '\u0000' + String(value == null ? '' : value));
    const chunk = makeChunk('tEXt', textBytes);
    const out = new Uint8Array(png.length + chunk.length);
    out.set(png.subarray(0, iend), 0);
    out.set(chunk, iend);
    out.set(png.subarray(iend), iend + chunk.length);
    return out.buffer;
  }

  function embedJson(arrayBuffer, key, obj) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    return embedText(arrayBuffer, key || 'nano_card', bytesToBase64(bytes));
  }

  async function extractNanoCard(arrayBuffer) {
    try {
      const chunks = await readChunks(arrayBuffer);
      const keys = ['nano_card', 'nano_character', 'nano_user', 'chara', 'ccv3', 'character', 'json'];
      for (const key of keys.concat(Object.keys(chunks))) {
        if (!chunks[key]) continue;
        const value = parseValue(chunks[key]);
        if (value && (value.nano || (value.data && value.data.nano))) return value;
      }
    } catch (e) {}
    return null;
  }

  async function extractRules(arrayBuffer) {
    const found = await extractJson(arrayBuffer, ['nano_rules', 'rules', 'nano-offline-rules', 'json', 'chara', 'ccv3']);
    if (!found) return null;
    let value = found.value;
    const root = unwrapCard(value) || value;
    if (root && root.extensions) {
      if (root.extensions.nano_rules) value = root.extensions.nano_rules;
      else if (root.extensions.rules) value = root.extensions.rules;
    }
    return value;
  }

  window.NanoPngJson = {
    readChunks: readChunks,
    parseValue: parseValue,
    extractJson: extractJson,
    extractWorldbook: extractWorldbook,
    extractRules: extractRules,
    embedText: embedText,
    embedJson: embedJson,
    extractNanoCard: extractNanoCard
  };
})();
