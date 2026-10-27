-- Atualização: lembretes diários de contas a vencer (fora do cartão).
-- Pré-requisito: notificações já ativadas (atualizacao-notificacoes.sql) e função "lembretes" publicada.
-- Cole no Supabase → SQL Editor → New query → Run. Pode rodar mais de uma vez.

-- evita mandar o mesmo lembrete duas vezes no dia
create table if not exists public.lembretes_enviados (
  casal_id uuid not null references public.casais on delete cascade,
  dia date not null,
  primary key (casal_id, dia)
);
alter table public.lembretes_enviados enable row level security;  -- só a função acessa

-- agenda: todo dia às 8h (horário de Brasília = 11h UTC)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'lembretes-contas';
select cron.schedule('lembretes-contas', '0 11 * * *', $$
  select net.http_post(
    url := 'https://clefxqpoxwdflvwukbcb.supabase.co/functions/v1/lembretes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsZWZ4cXBveHdkZmx2d3VrYmNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NjE3NzcsImV4cCI6MjEwODMzNzc3N30.CzbXAywxIxR5FSdBu4LsVru_tmUJ0KoSNj1qkdgk07Q'
    ),
    body := '{}'::jsonb
  );
$$);
