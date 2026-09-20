-- Order Scanner — Supabase schema
-- Run this in the Supabase SQL editor for your project, then put the project
-- URL + anon key into web/.env.local and mobile/.env.

create table if not exists products (
  id         text primary key,
  name       text not null,
  code       text,
  unit       text,
  category   text,
  price      numeric,
  prices     jsonb,
  aliases    text[] default '{}',
  created_at timestamptz default now()
);

create table if not exists orders (
  id          text primary key,
  created_at  timestamptz default now(),
  reference   text,
  customer    text,
  location    text,
  note        text,
  image_count int default 0,
  total       numeric default 0
);

create table if not exists order_items (
  id           text primary key,
  order_id     text references orders(id) on delete cascade,
  product_id   text,
  product_name text not null,
  product_code text,
  unit         text,
  quantity     numeric default 0,
  unit_price   numeric default 0,
  line_total   numeric default 0,
  raw_text     text
);

create index if not exists order_items_order_id_idx on order_items(order_id);
create index if not exists orders_created_at_idx on orders(created_at desc);

-- Row Level Security.
-- These policies allow the anon key full access, which suits a small internal
-- tool. Tighten to authenticated users if you add sign-in later.
alter table products    enable row level security;
alter table orders      enable row level security;
alter table order_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='products' and policyname='anon_all_products') then
    create policy anon_all_products on products for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='orders' and policyname='anon_all_orders') then
    create policy anon_all_orders on orders for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='order_items' and policyname='anon_all_items') then
    create policy anon_all_items on order_items for all using (true) with check (true);
  end if;
end $$;
