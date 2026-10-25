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
    extractRules: extractRules
  };
})();
