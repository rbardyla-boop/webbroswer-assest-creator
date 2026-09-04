-- RUG organism: append-only hash-linked ledger. Projections are folded at read.
create table if not exists worlds (
  id text primary key,
  code text not null unique,
  name text not null,
  created_by text not null,
  seq bigint not null default 0,
  head_hash text not null default '0',
  created_at timestamptz not null default now()
);

create table if not exists world_members (
  world_id text not null references worlds(id) on delete cascade,
  user_id text not null,
  display_name text not null default '',
  role text not null default 'hand',
  hue integer not null default 0,
  joined_at timestamptz not null default now(),
  primary key (world_id, user_id)
);
create index if not exists world_members_user_idx on world_members (user_id);

create table if not exists ledger (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  event_type text not null,
  actor_id text not null,
  actor_kind text not null,
  actor_name text not null,
  target text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (world_id, seq)
);
create index if not exists ledger_world_idx on ledger (world_id, seq);

create table if not exists agent_minds (
  world_id text not null references worlds(id) on delete cascade,
  agent_id text not null,
  name text not null,
  model text not null default 'grok-4.5',
  brief text not null default '',
  online boolean not null default true,
  primary key (world_id, agent_id)
);

create table if not exists rejects (
  id text primary key,
  world_id text not null references worlds(id) on delete cascade,
  actor_id text not null,
  actor_name text not null,
  event_type text not null,
  target text not null default '',
  base_hash text not null,
  current_head text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists rejects_world_idx on rejects (world_id, created_at desc);
