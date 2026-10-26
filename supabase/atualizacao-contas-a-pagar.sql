-- Atualização: contas a pagar (boletos, financiamento, fixos fora do cartão).
-- Cole no Supabase → SQL Editor → New query → Run. Pode rodar mais de uma vez.
alter table public.transacoes add column if not exists pago boolean;
alter table public.transacoes add column if not exists rec_id uuid references public.recorrentes on delete set null;
alter table public.transacoes add column if not exists referencia text;

-- contas fora do cartão com data futura ficam pendentes até alguém pagar
update public.transacoes set pago = false
 where tipo = 'despesa' and coalesce(forma, '') <> 'Crédito' and data > current_date and pago is null;

notify pgrst, 'reload schema';
