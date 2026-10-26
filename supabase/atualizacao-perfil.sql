-- Atualização: foto de perfil, preferências de lançamento e meta de gastos do casal.
-- Cole no Supabase → SQL Editor → New query → Run. Pode rodar mais de uma vez.
alter table public.perfis add column if not exists foto text;
alter table public.perfis add column if not exists prefs jsonb not null default '{}'::jsonb;
alter table public.casais add column if not exists meta_mensal numeric(12,2);
notify pgrst, 'reload schema';
