/* =========================================================
   Nano 云端备份 Worker（部署到你自己的 Cloudflare 账号）
   - 优先使用 R2：单个备份不再受 24MB 限制（建议绑定 BACKUP_R2）
   - 没绑 R2 时自动回退到 Workers KV（BACKUP_KV，单个仍限 24MB）
   - 密码放在 BACKUP_TOKEN（Secret）
   - 路由：
        GET    /list?prefix=nano-backup-   → 备份列表
        GET    /get?key=...               → 下载备份（原始字节）
        PUT    /put?key=...&meta={...}     → 上传/覆盖备份
        DELETE /del?key=...               → 删除备份
   - R2 绑定名：BACKUP_R2；KV 绑定名：BACKUP_KV
   ========================================================= */

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Nano-Metadata',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function metaStrings(meta) {
  const out = {};
  Object.keys(meta || {}).forEach((k) => {
    if (meta[k] != null) out[k] = String(meta[k]);
  });
  return out;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status,
      headers: Object.assign({}, cors, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    });

    try {
      const token = String(env.BACKUP_TOKEN || '').trim();
      if (!token) return json({ ok: false, error: '服务器未设置 BACKUP_TOKEN，请按教程添加变量' }, 500);
      const auth = request.headers.get('Authorization') || '';
      if (auth !== 'Bearer ' + token) return json({ ok: false, error: '密码错误' }, 401);

      const r2 = env.BACKUP_R2 || null;
      const kv = env.BACKUP_KV || null;
      if (!r2 && !kv) return json({ ok: false, error: '未绑定 R2（BACKUP_R2）或 KV（BACKUP_KV），请按教程添加绑定' }, 500);

      const url = new URL(request.url);
      const key = url.searchParams.get('key') || '';
      const prefix = url.searchParams.get('prefix') || 'nano-backup-';

      if (request.method === 'GET' && url.pathname.endsWith('/list')) {
        if (r2) {
          const out = await r2.list({ prefix, limit: 1000, include: ['customMetadata'] });
          const keys = (out.objects || []).map((o) => ({
            name: o.key,
            size: o.size || 0,
            uploadedAt: (o.customMetadata && o.customMetadata.uploadedAt) || (o.uploaded && o.uploaded.toISOString()) || '',
            createdAt: (o.customMetadata && o.customMetadata.createdAt) || '',
            metadata: o.customMetadata || {}
          }));
          return json({ ok: true, store: 'r2', keys: keys });
        }
        const out = await kv.list({ prefix: prefix, limit: 100 });
        return json({
          ok: true,
          store: 'kv',
          keys: out.keys.map((k) => ({ name: k.name, metadata: k.metadata || {} }))
        });
      }

      if (request.method === 'GET' && url.pathname.endsWith('/get')) {
        if (!key) return json({ ok: false, error: '缺少 key' }, 400);
        if (r2) {
          const obj = await r2.get(key);
          if (!obj) return json({ ok: false, error: '备份不存在' }, 404);
          return new Response(await obj.arrayBuffer(), {
            headers: Object.assign({}, cors, {
              'Content-Type': 'application/octet-stream',
              'X-Nano-Metadata': encodeURIComponent(JSON.stringify(obj.customMetadata || {}))
            })
          });
        }
        const got = await kv.getWithMetadata(key, { type: 'arrayBuffer' });
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
        let meta = {};
        try { meta = JSON.parse(url.searchParams.get('meta') || '{}'); } catch (e) {}
        const fullMeta = Object.assign({}, meta, { size: size, uploadedAt: new Date().toISOString() });

        if (r2) {
          // R2 不限制 24MB；实际对象上限远高于手机能生成的备份。
          await r2.put(key, body, { customMetadata: metaStrings(fullMeta) });
          return json({ ok: true, store: 'r2', key: key, size: size });
        }

        if (size > 24 * 1024 * 1024) return json({ ok: false, error: '当前使用 KV，单个备份不能超过 24MB；绑定 R2（BACKUP_R2）后即可取消该限制' }, 413);
        await kv.put(key, body, { metadata: fullMeta });
        return json({ ok: true, store: 'kv', key: key, size: size });
      }

      if (request.method === 'DELETE' && url.pathname.endsWith('/del')) {
        if (!key) return json({ ok: false, error: '缺少 key' }, 400);
        if (r2) await r2.delete(key);
        else await kv.delete(key);
        return json({ ok: true });
      }

      return json({ ok: true, name: 'nano-backup', version: 2, store: r2 ? 'r2' : 'kv' });
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e || 'unknown error') }, 500);
    }
  }
};
