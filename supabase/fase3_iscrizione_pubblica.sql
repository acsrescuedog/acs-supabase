-- ACS Fase 3 - Iscrizione pubblica su Supabase
-- Eseguire una sola volta nel SQL Editor del progetto Supabase.

create or replace function public.crea_iscrizione_pubblica(
  p_nome text,
  p_cognome text,
  p_email text,
  p_telefono text,
  p_cane_nome text,
  p_cane_razza text,
  p_data_nascita_cane date,
  p_sesso_cane text,
  p_microchip text,
  p_corso_id text,
  p_ricevuta_url text default null,
  p_ricevuta_drive_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corso public.corsi%rowtype;
  v_id text := gen_random_uuid()::text;
begin
  if nullif(trim(coalesce(p_nome, '')), '') is null
     or nullif(trim(coalesce(p_cognome, '')), '') is null
     or nullif(trim(coalesce(p_cane_nome, '')), '') is null then
    raise exception 'Campi obbligatori mancanti';
  end if;

  select * into v_corso
  from public.corsi
  where id = p_corso_id and attivo = true
  limit 1;

  if not found then
    raise exception 'Corso non valido o non attivo';
  end if;

  if coalesce(v_corso.prezzo, 0) > 0
     and (nullif(trim(coalesce(p_ricevuta_url, '')), '') is null
          or nullif(trim(coalesce(p_ricevuta_drive_id, '')), '') is null) then
    raise exception 'Ricevuta obbligatoria per il corso selezionato';
  end if;

  insert into public.iscrizioni (
    id, data_iscrizione, nome, cognome, email, telefono,
    cane_nome, cane_razza, data_nascita_cane, microchip, sesso_cane,
    corso_selezionato, costo, ricevuta_url, ricevuta_drive_id,
    stato
  ) values (
    v_id, current_date,
    trim(p_nome), trim(p_cognome), nullif(trim(coalesce(p_email, '')), ''), nullif(trim(coalesce(p_telefono, '')), ''),
    trim(p_cane_nome), nullif(trim(coalesce(p_cane_razza, '')), ''), p_data_nascita_cane,
    nullif(trim(coalesce(p_microchip, '')), ''), nullif(trim(coalesce(p_sesso_cane, '')), ''),
    v_corso.nome, v_corso.prezzo,
    nullif(trim(coalesce(p_ricevuta_url, '')), ''), nullif(trim(coalesce(p_ricevuta_drive_id, '')), ''),
    'in attesa approvazione'
  );

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'messaggio', 'Iscrizione inviata. In attesa di approvazione.'
  );
end;
$$;

revoke all on function public.crea_iscrizione_pubblica(
  text,text,text,text,text,text,date,text,text,text,text,text
) from public;

grant execute on function public.crea_iscrizione_pubblica(
  text,text,text,text,text,text,date,text,text,text,text,text
) to anon, authenticated;
