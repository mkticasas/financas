-- Atualização: notificações no celular quando o outro fizer um lançamento.
-- Cole no Supabase → SQL Editor → New query → Run. Pode rodar mais de uma vez.

-- aparelhos que ativaram notificação
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null default auth.uid() references public.perfis on delete cascade,
  casal_id uuid not null default public.meu_casal() references public.casais on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists push_proprios on public.push_subs;
create policy push_proprios on public.push_subs for all to authenticated
  using (perfil_id = auth.uid()) with check (perfil_id = auth.uid() and casal_id = public.meu_casal());
grant select, insert, update, delete on public.push_subs to authenticated;

-- marca para não notificar duas vezes
alter table public.transacoes add column if not exists notificado boolean not null default false;

-- a cada lançamento novo, chama a função "notificar"
create extension if not exists pg_net with schema extensions;

create or replace function public.avisar_lancamento() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.parcela is null or new.parcela = 1 then
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
  return new;   -- notificação nunca impede o lançamento de ser salvo
end $$;

drop trigger if exists trg_avisar_lancamento on public.transacoes;
create trigger trg_avisar_lancamento after insert on public.transacoes
  for each row execute function public.avisar_lancamento();

notify pgrst, 'reload schema';
