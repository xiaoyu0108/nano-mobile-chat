// ============================================================
// nano-mcp-chat.js — 让 char 在聊天里主动调用 MCP 工具
//   依赖 window.NanoMcp（nano-mcp-runtime.js）
//   · toolInstruction()  注入给模型：可用工具 + 调用格式
//   · runFromReply(text, continueFn)  解析 <tool>{...}</tool> → 执行 → 拿结果继续要回复
//     返回 { text, tools:[{name,args,ok,result}] }（tools 交给 chat-core 内联渲染，不悬空）
// ============================================================
(function () {
  'use strict';
  if (window.NanoMcpChat) return;

  function hasTools() { return !!(window.NanoMcp && window.NanoMcp.listEnabledTools().length); }

  function exampleArgs(schema) {
    var o = {}, props = (schema && schema.properties) || {};
    Object.keys(props).forEach(function (k) {
      var p = props[k] || {};
      if (p.default !== undefined) o[k] = p.default;
      else if (p.type === 'boolean') o[k] = false;
      else if (p.type === 'number' || p.type === 'integer') o[k] = 0;
      else if (p.type === 'array') o[k] = [];
      else if (p.type === 'object') o[k] = {};
      else o[k] = '…';
    });
    return o;
  }

  function toolInstruction() {
    if (!window.NanoMcp) return '';
    var tools = window.NanoMcp.listEnabledTools();
    if (!tools.length) return '';
    var lines = [];
    lines.push('【可用工具（MCP）】当你能借此更贴心地陪伴对方，或需要实时信息 / 操作时，可以调用下列工具：');
    tools.forEach(function (t) {
      lines.push('- ' + t.name + '：' + (t.description || '') + (t.inputSchema ? ('（参数示例 ' + JSON.stringify(exampleArgs(t.inputSchema)) + '）') : ''));
    });
    lines.push('调用方法：**只输出一行** <tool>{"name":"工具名","arguments":{...}}</tool>，这一行不要带别的解释或思考；系统会执行并把结果返回给你，你再据此继续回复。');
    lines.push('【语言】无论本说明用什么语言书写，你回复时都必须保持你原本的角色设定与语言习惯（外文角色继续用原文，想翻译就沿用你惯用的「原文||翻译」格式），不要因为本说明而改成中文。');
    lines.push('不需要工具时正常回复即可，不要出现 <tool> 标签。一次最多调用 1~2 个工具。');
    return lines.join('\n');
  }

  function toolsIndex() {
    var m = {};
    try { window.NanoMcp.listEnabledTools().forEach(function (t) { if (!m[t.name]) m[t.name] = t; }); } catch (e) {}
    return m;
  }

  function parseToolCall(inner) {
    var raw = String(inner || '').trim()
      .replace(/^```(?:json|xml)?/i, '').replace(/```$/, '').trim();
    var cands = [raw];
    try { cands.push(decodeURIComponent(raw)); } catch (e) {}
    for (var i = 0; i < cands.length; i++) {
      try {
        var o = JSON.parse(cands[i]);
        var name = o.name || o.tool || o.action;
        if (!name) continue;
        var args = o.arguments || o.args || o.parameters;
        if (!args || typeof args !== 'object') {
          args = {};
          Object.keys(o).forEach(function (k) { if (['name', 'tool', 'action', 'arguments', 'args', 'parameters'].indexOf(k) < 0) args[k] = o[k]; });
        }
        return { name: String(name), args: args };
      } catch (e) {}
    }
    return null;
  }

  var TAG_RE = /<\s*(tool|mcp)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;

  async function runFromReply(reply, continueFn, opts) {
    if (!window.NanoMcp) return { text: reply, tools: [] };
    opts = opts || {};
    var text = String(reply || '');
    var idx = toolsIndex();
    var used = [];
    var rounds = 0;

    // 只做「一轮」续写：首次回复里出现的所有工具一次性执行，随后只调用一次 API 拿最终回复。
    // 若最终回复里又出现 <tool> 标签，直接清掉，不再追加请求（避免多次调用 API）。
    while (rounds < 1) {
      var blocks = [];
      text = text.replace(TAG_RE, function (m, tag, inner) {
        var o = parseToolCall(inner);
        if (o) blocks.push(o);
        return '';
      });
      if (!blocks.length) break;

      var results = [];
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        var def = idx[b.name];
        if (!def) {
          var miss = '没有名为 ' + b.name + ' 的工具（可能被关闭了）';
          used.push({ name: b.name, args: b.args, ok: false, result: miss });
          results.push('工具 ' + b.name + '：' + miss);
          continue;
        }
        try {
          var out = await window.NanoMcp.execTool(def.serverId, b.name, b.args);
          used.push({ name: b.name, args: b.args, ok: true, result: out });
          results.push('工具 ' + b.name + ' 返回：\n' + out);
        } catch (e) {
          var msg = (e && e.message) ? e.message : String(e);
          used.push({ name: b.name, args: b.args, ok: false, result: msg });
          results.push('工具 ' + b.name + ' 调用失败：' + msg);
        }
      }

      if (typeof continueFn === 'function') {
        var ctx = '【工具返回的结果】\n' + results.join('\n\n') + '\n\n'
          + '请直接根据上面的结果，用你（当前角色）的语气自然地对对方说话。硬性要求：'
          + '① 用你平时与对方交流的语言和说话习惯，不要因为本说明改成中文；'
          + '② 不要罗列数据、不要报参数、不要说「根据工具 / 查询结果 / 我查到了」这类话；'
          + '③ 把信息转换成关心、提醒、撒娇或日常闲聊（例如天气：明天你那边要下雨，记得带伞、多穿点别着凉）；'
          + '④ 简短口语化，不要出现任何 <tool> 标签。';
        if (opts.foreign) {
          ctx += ' ⑤ 你是外文角色：必须严格按你平时的固定格式逐句输出——每一句都写成「原文||简体中文翻译」，原文用你的语言、翻译用简体中文，中间必须有 || 分隔，绝不能整段只有一种语言或漏掉 ||。';
        }
        var cont = await continueFn(ctx);
        if (cont != null && String(cont).trim()) text = String(cont);
      }
      rounds++;
    }

    text = text.replace(TAG_RE, '').replace(/<\s*\/?\s*(?:tool|mcp)\s*>/gi, '').trim();
    return { text: text, tools: used };
  }

  function stripTags(text) {
    return String(text == null ? '' : text)
      .replace(TAG_RE, '')
      .replace(/<\s*\/?\s*(?:tool|mcp)\s*>/gi, '')
      .trim();
  }

  window.NanoMcpChat = { hasTools: hasTools, toolInstruction: toolInstruction, runFromReply: runFromReply, stripTags: stripTags };
})();
