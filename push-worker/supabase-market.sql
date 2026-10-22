-- Nano 共享集市 Supabase schema
-- 在 Supabase Dashboard → SQL Editor 里整段执行。
-- 说明：
--   1. 表只允许 Worker 的 service_role key 访问，前端不直连 Supabase。
--   2. RLS 开启但不建 policy，anon key 无法读写；service_role 绕过 RLS。
--   3. 图片/文件仍以 dataURL 存在 item JSON 里；单条建议不超过 24MB。

create table if not exists public.market_items (
  id text primary key,
  summary jsonb not null default '{}'::jsonb,
  item jsonb not null default '{}'::jsonb,
  token text not null default '',
  likes integer not null default 0,
  downloads integer not null default 0,
  imports integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_market_items_created on public.market_items (created_at desc);

alter table public.market_items enable row level security;

-- 原子计数：点赞 / 下载 / 导入，避免并发覆盖
create or replace function public.market_increment(p_id text, p_field text, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
begin
  if p_field not in ('likes', 'downloads', 'imports') then
    return -1;
  end if;
  update public.market_items
     set likes     = greatest(0, likes     + case when p_field = 'likes'     then coalesce(p_delta, 0) else 0 end),
         downloads = greatest(0, downloads + case when p_field = 'downloads' then coalesce(p_delta, 0) else 0 end),
         imports   = greatest(0, imports   + case when p_field = 'imports'   then coalesce(p_delta, 0) else 0 end),
         updated_at = now()
   where id = p_id
   returning case p_field
               when 'likes' then likes
               when 'downloads' then downloads
               else imports
             end
     into v;
  return coalesce(v, 0);
end;
$$;

revoke all on function public.market_increment(text, text, integer) from public, anon, authenticated;
