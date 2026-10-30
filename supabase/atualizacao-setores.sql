-- Atualização: setor dos itens da lista de compras (escolhido pela IA ou à mão).
-- Cole no Supabase → SQL Editor → New query → Run.
alter table public.compras add column if not exists setor text;
notify pgrst, 'reload schema';
