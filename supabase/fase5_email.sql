-- ACS Fase 5 - registro invii email (anti-duplicazione)
create table if not exists public.email_eventi (
  id uuid primary key default gen_random_uuid(),
  iscrizione_id text not null references public.iscrizioni(id) on delete cascade,
  tipo text not null check (tipo in ('iscrizione_ricevuta','iscrizione_approvata','iscrizione_rifiutata')),
  destinatario text not null,
  created_at timestamptz not null default now(),
  unique (iscrizione_id, tipo)
);

alter table public.email_eventi enable row level security;
revoke all on table public.email_eventi from anon, authenticated;
