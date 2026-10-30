-- Atualização: histórico de preços dos produtos da lista de compras.
-- Cole no Supabase → SQL Editor → New query → Run. Pode rodar mais de uma vez.
create table if not exists public.precos (
  id uuid primary key default gen_random_uuid(),
  casal_id uuid not null default public.meu_casal() references public.casais on delete cascade,
  produto text not null,      -- nome normalizado, para comparar
  nome text not null,         -- nome como foi escrito
  preco numeric(12,2) not null check (preco >= 0),
  qtd numeric(10,3) not null default 1,
  data date not null default current_date,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists precos_casal_produto on public.precos (casal_id, produto, data desc);
alter table public.precos enable row level security;
drop policy if exists do_casal on public.precos;
create policy do_casal on public.precos for all to authenticated
  using (casal_id = public.meu_casal()) with check (casal_id = public.meu_casal());
grant select, insert, update, delete on public.precos to authenticated;
alter table public.compras add column if not exists setor text;
notify pgrst, 'reload schema';
