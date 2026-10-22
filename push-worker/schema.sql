-- Nano push-worker D1 schema
-- 用法：wrangler d1 execute nano-db --file=schema.sql --remote
-- 说明：业务代码使用统一的 kv(key, value) 表，迁移期间不需要改任何 key 结构。

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv(expires_at);
