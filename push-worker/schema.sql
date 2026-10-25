-- Nano push-worker D1 schema
-- 用法：wrangler d1 execute nano-db --file=schema.sql --remote
-- 说明：业务代码使用统一的 kv(key, value) 表，迁移期间不需要改任何 key 结构。

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- 不要给 expires_at 建二级索引：
-- D1 每次 put 更新 expires_at 时会多算 1 行写入，免费版 10 万行/天很容易翻倍。
-- 过期清理每天只跑一次，全表扫一次完全承受得起。
-- 如果之前执行过旧 schema，下面这行会顺手删掉旧索引。
DROP INDEX IF EXISTS idx_kv_expires;
