-- Atualização: transferência entre contas.
-- Cole no Supabase → SQL Editor → New query → Run. Pode rodar mais de uma vez.
alter table public.transacoes drop constraint if exists transacoes_tipo_check;
alter table public.transacoes add constraint transacoes_tipo_check check (tipo in ('despesa','receita','transferencia'));
alter table public.transacoes add column if not exists conta_destino_id uuid references public.contas on delete set null;

-- transferência não gera notificação no celular
create or replace function public.avisar_lancamento() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.tipo <> 'transferencia' and (new.parcela is null or new.parcela = 1) then
    perform net.http_post(
      url := 'https://clefxqpoxwdflvwukbcb.supabase.co/functions/v1/notificar',
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsZWZ4cXBveHdkZmx2d3VrYmNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NjE3NzcsImV4cCI6MjEwODMzNzc3N30.CzbXAywxIxR5FSdBu4LsVru_tmUJ0KoSNj1qkdgk07Q'
      )
    );
  end if;
  return new;
exception when others then
  return new;
end $$;

notify pgrst, 'reload schema';
