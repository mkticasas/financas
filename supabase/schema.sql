-- =====================================================================
-- Finanças a Dois — estrutura do banco
-- Cole TUDO no Supabase → SQL Editor → New query → Run.
-- Pode rodar de novo sem problema (é idempotente).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Casal e pessoas ----------
create table if not exists public.casais (
  id uuid primary key default gen_random_uuid(),
  nome text not null default 'Nosso casal',
  codigo text unique not null default upper(substr(md5(random()::text), 1, 6)),
  meta_mensal numeric(12,2),
  created_at timestamptz not null default now()
);

create table if not exists public.perfis (
  id uuid primary key references auth.users on delete cascade,
  casal_id uuid references public.casais on delete cascade,
  nome text not null,
  cor text not null default '#5c8de0',
  renda_mensal numeric(12,2),
  foto text,
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- casal da pessoa logada (usado em todas as regras de acesso)
create or replace function public.meu_casal() returns uuid
language sql stable security definer set search_path = public as $$
  select casal_id from public.perfis where id = auth.uid()
$$;

-- ---------- Cadastros ----------
create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  casal_id uuid not null default public.meu_casal() references public.casais on delete cascade,
  nome text not null,
  tipo text not null default 'despesa' check (tipo in ('despesa','receita')),
  cor text not null default '#a09880',
  ordem int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.contas (
  id uuid primary key default gen_random_uuid(),
  casal_id uuid not null default public.meu_casal() references public.casais on delete cascade,
  nome text not null,
  tipo text not null default 'corrente' check (tipo in ('corrente','poupanca','carteira','investimento','digital')),
  banco text,
  pessoa_id uuid references public.perfis on delete set null,   -- null = do casal
  saldo_inicial numeric(12,2) not null default 0,
  saldo_data date not null default current_date,
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cartoes (
  id uuid primary key default gen_random_uuid(),
  casal_id uuid not null default public.meu_casal() references public.casais on delete cascade,
  nome text not null,
  pessoa_id uuid references public.perfis on delete set null,
  final text,
  fechamento int check (fechamento between 1 and 31),
  vencimento int check (vencimento between 1 and 31),
  cor text not null default '#d4a84b',
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Lançamentos ----------
create table if not exists public.transacoes (
  id uuid primary key default gen_random_uuid(),
  casal_id uuid not null default public.meu_casal() references public.casais on delete cascade,
  tipo text not null check (tipo in ('despesa','receita','transferencia')),
  descricao text not null,
  valor numeric(12,2) not null check (valor >= 0),
  data date not null,
  categoria_id uuid references public.categorias on delete set null,
  pessoa_id uuid references public.perfis on delete set null,   -- null = casal / juntos
  forma text,
  conta_id uuid references public.contas on delete set null,
  conta_destino_id uuid references public.contas on delete set null,  -- transferência
  cartao_id uuid references public.cartoes on delete set null,
  parcela int,
  parcelas int,
  grupo uuid,
  valor_total numeric(12,2),
  obs text,
  comprovante text,
  origem text default 'site',
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists transacoes_casal_data on public.transacoes (casal_id, data);
create index if not exists transacoes_grupo on public.transacoes (grupo);

-- gastos fixos e entradas que repetem todo mês
create table if not exists public.recorrentes (
  id uuid primary key default gen_random_uuid(),
  casal_id uuid not null default public.meu_casal() references public.casais on delete cascade,
  tipo text not null check (tipo in ('despesa','receita')),
  descricao text not null,
  valor numeric(12,2) not null check (valor >= 0),
  dia int not null check (dia between 1 and 31),
  categoria_id uuid references public.categorias on delete set null,
  pessoa_id uuid references public.perfis on delete set null,
  forma text,
  conta_id uuid references public.contas on delete set null,
  cartao_id uuid references public.cartoes on delete set null,
  inicio date not null,          -- primeiro dia do mês de início
  fim date,                      -- primeiro dia do último mês (null = sem fim)
  created_at timestamptz not null default now()
);

create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  casal_id uuid not null default public.meu_casal() references public.casais on delete cascade,
  nome text not null,
  pego boolean not null default false,
  qtd numeric(10,3) not null default 1,
  preco numeric(12,2) not null default 0,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- usado pelo GitHub Actions para o projeto não pausar
create table if not exists public.ping (id int primary key, at timestamptz not null default now());
insert into public.ping (id) values (1) on conflict (id) do nothing;

-- ---------- Segurança (cada casal só vê o que é seu) ----------
alter table public.casais      enable row level security;
alter table public.perfis      enable row level security;
alter table public.categorias  enable row level security;
alter table public.contas      enable row level security;
alter table public.cartoes     enable row level security;
alter table public.transacoes  enable row level security;
alter table public.recorrentes enable row level security;
alter table public.compras     enable row level security;
alter table public.ping        enable row level security;

drop policy if exists casal_ver on public.casais;
create policy casal_ver on public.casais for select to authenticated using (id = public.meu_casal());
drop policy if exists casal_editar on public.casais;
create policy casal_editar on public.casais for update to authenticated using (id = public.meu_casal()) with check (id = public.meu_casal());

drop policy if exists perfis_ver on public.perfis;
create policy perfis_ver on public.perfis for select to authenticated using (id = auth.uid() or casal_id = public.meu_casal());
drop policy if exists perfis_editar on public.perfis;
create policy perfis_editar on public.perfis for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['categorias','contas','cartoes','transacoes','recorrentes','compras'] loop
    execute format('drop policy if exists do_casal on public.%I', t);
    execute format('create policy do_casal on public.%I for all to authenticated using (casal_id = public.meu_casal()) with check (casal_id = public.meu_casal())', t);
  end loop;
end $$;

drop policy if exists ping_ler on public.ping;
create policy ping_ler on public.ping for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.categorias, public.contas, public.cartoes, public.transacoes, public.recorrentes, public.compras to authenticated;
grant select, update on public.casais, public.perfis to authenticated;
grant select on public.ping to anon, authenticated;

-- ---------- Criar casal / entrar com código ----------
create or replace function public.criar_casal(p_nome text, p_nome_casal text default 'Nosso casal')
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.'; end if;
  if exists (select 1 from perfis where id = auth.uid() and casal_id is not null) then
    raise exception 'Você já faz parte de um casal.';
  end if;
  insert into casais (nome) values (coalesce(nullif(trim(p_nome_casal), ''), 'Nosso casal')) returning id into cid;
  insert into perfis (id, casal_id, nome, cor) values (auth.uid(), cid, trim(p_nome), '#5c8de0')
    on conflict (id) do update set casal_id = excluded.casal_id, nome = excluded.nome;
  insert into categorias (casal_id, nome, tipo, cor, ordem) values
    (cid,'Mercado','despesa','#5cb87a',1),
    (cid,'Alimentação fora','despesa','#e0915c',2),
    (cid,'Moradia','despesa','#5c8de0',3),
    (cid,'Contas da casa','despesa','#4fb0b0',4),
    (cid,'Transporte','despesa','#c9a14a',5),
    (cid,'Saúde','despesa','#e05c5c',6),
    (cid,'Lazer','despesa','#9b7fe0',7),
    (cid,'Compras','despesa','#d07fb0',8),
    (cid,'Assinaturas','despesa','#7f8fa6',9),
    (cid,'Casamento','despesa','#e8c97a',10),
    (cid,'Educação','despesa','#6fa36f',11),
    (cid,'Outros','despesa','#8a8370',99),
    (cid,'Salário','receita','#5cb87a',1),
    (cid,'Freela / Serviço','receita','#4fb0b0',2),
    (cid,'Vendas','receita','#c9a14a',3),
    (cid,'Reembolso','receita','#7f8fa6',4),
    (cid,'Outras receitas','receita','#8a8370',99);
  return cid;
end $$;

create or replace function public.entrar_casal(p_codigo text, p_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.'; end if;
  if exists (select 1 from perfis where id = auth.uid() and casal_id is not null) then
    raise exception 'Você já faz parte de um casal.';
  end if;
  select id into cid from casais where codigo = upper(trim(p_codigo));
  if cid is null then raise exception 'Código não encontrado. Confira com quem criou o casal.'; end if;
  if (select count(*) from perfis where casal_id = cid) >= 2 then
    raise exception 'Este casal já tem duas pessoas.';
  end if;
  insert into perfis (id, casal_id, nome, cor) values (auth.uid(), cid, trim(p_nome), '#9b7fe0')
    on conflict (id) do update set casal_id = excluded.casal_id, nome = excluded.nome;
  return cid;
end $$;

revoke all on function public.criar_casal(text, text) from public, anon;
revoke all on function public.entrar_casal(text, text) from public, anon;
grant execute on function public.criar_casal(text, text) to authenticated;
grant execute on function public.entrar_casal(text, text) to authenticated;
grant execute on function public.meu_casal() to authenticated;

-- ---------- Fotos dos comprovantes ----------
insert into storage.buckets (id, name, public) values ('comprovantes', 'comprovantes', false)
  on conflict (id) do nothing;

drop policy if exists comprovantes_casal on storage.objects;
create policy comprovantes_casal on storage.objects for all to authenticated
  using (bucket_id = 'comprovantes' and (storage.foldername(name))[1] = public.meu_casal()::text)
  with check (bucket_id = 'comprovantes' and (storage.foldername(name))[1] = public.meu_casal()::text);

-- ---------- Tempo real (o que um lança aparece na tela do outro) ----------
do $$
declare t text;
begin
  foreach t in array array['transacoes','recorrentes','compras','contas','cartoes','categorias','perfis'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
