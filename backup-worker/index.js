/* =========================================================
   Nano 云端备份 Worker（部署到你自己的 Cloudflare 账号）
   - 只用 Workers KV：免费、无需信用卡
   - 绑定名必须是 BACKUP_KV；密码放在 BACKUP_TOKEN（Secret）
   - 路由：
       GET    /list?prefix=nano-backup-   → 备份列表
       GET    /get?key=...               → 下载备份（原始字节）
       PUT    /put?key=...&meta={...}     → 上传/覆盖备份
       DELETE /del?key=...               → 删除备份
   - 单个备份上限 24MB（KV 单值上限 25MB，留一点余量）
   ========================================================= */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status,
      headers: Object.assign({}, cors, { 'Content-Type': 'application/json; charset=utf-8' })
    });

    try {
      const token = String(env.BACKUP_TOKEN || '').trim();
      if (!token) return json({ ok: false, error: '服务器未设置 BACKUP_TOKEN，请按教程添加变量' }, 500);

      const auth = request.headers.get('Authorization') || '';
      if (auth !== 'Bearer ' + token) return json({ ok: false, error: '密码错误' }, 401);

      if (!env.BACKUP_KV) return json({ ok: false, error: '未绑定 KV，请添加绑定 BACKUP_KV' }, 500);

      const url = new URL(request.url);
      const key = url.searchParams.get('key') || '';
      const prefix = url.searchParams.get('prefix') || 'nano-backup-';

      if (request.method === 'GET' && url.pathname.endsWith('/list')) {
        const out = await env.BACKUP_KV.list({ prefix: prefix, limit: 100 });
        return json({
          ok: true,
          keys: out.keys.map((k) => ({ name: k.name, metadata: k.metadata || {} }))
        });
      }

      if (request.method === 'GET' && url.pathname.endsWith('/get')) {
        if (!key) return json({ ok: false, error: '缺少 key' }, 400);
        const got = await env.BACKUP_KV.getWithMetadata(key, { type: 'arrayBuffer' });
        if (!got || !got.value) return json({ ok: false, error: '备份不存在' }, 404);
        return new Response(got.value, {
          headers: Object.assign({}, cors, {
            'Content-Type': 'application/octet-stream',
            'X-Nano-Metadata': encodeURIComponent(JSON.stringify(got.metadata || {}))
          })
        });
      }

      if (request.method === 'PUT' && url.pathname.endsWith('/put')) {
        if (!/^[A-Za-z0-9._-]{1,200}$/.test(key)) return json({ ok: false, error: 'key 不合法' }, 400);
        const body = await request.arrayBuffer();
        const size = body.byteLength;
        if (!size) return json({ ok: false, error: '备份内容为空' }, 400);
        if (size > 24 * 1024 * 1024) return json({ ok: false, error: '单个备份不能超过 24MB' }, 413);
        let meta = {};
        try { meta = JSON.parse(url.searchParams.get('meta') || '{}'); } catch (e) {}
        await env.BACKUP_KV.put(key, body, {
          metadata: Object.assign({}, meta, {
            size: size,
            uploadedAt: new Date().toISOString()
          })
        });
        return json({ ok: true, key: key, size: size });
      }

      if (request.method === 'DELETE' && url.pathname.endsWith('/del')) {
        if (!key) return json({ ok: false, error: '缺少 key' }, 400);
        await env.BACKUP_KV.delete(key);
        return json({ ok: true });
      }

      return json({ ok: true, name: 'nano-backup', version: 1 });
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e || 'unknown error') }, 500);
    }
  }
};
