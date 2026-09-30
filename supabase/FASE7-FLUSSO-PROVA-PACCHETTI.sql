-- ACS Fase 7 - Lezione di prova + Pacchetti unificati + Verifica ingressi
-- Eseguire UNA VOLTA nel SQL Editor Supabase dopo la Fase 6.

begin;

-- 1) Istruttore: gestione anagrafica + conferma presenze.
create or replace function public.acs_puo_gestire_anagrafica()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(public.acs_ruolo_corrente() in ('admin','istruttore'), false);
$$;
revoke all on function public.acs_puo_gestire_anagrafica() from public, anon;
grant execute on function public.acs_puo_gestire_anagrafica() to authenticated, service_role;

drop policy if exists anagrafica_auth_write on public.anagrafica;
create policy anagrafica_auth_write on public.anagrafica for all to authenticated
  using (public.acs_puo_gestire_anagrafica())
  with check (public.acs_puo_gestire_anagrafica());

drop policy if exists storico_auth_write on public.storico_addestramento;
create policy storico_auth_write on public.storico_addestramento for all to authenticated
  using (public.acs_puo_gestire_anagrafica())
  with check (public.acs_puo_gestire_anagrafica());

-- 2) Estensione della tabella acquisti: da ora rappresenta il PACCHETTO assegnato.
create sequence if not exists public.pacchetto_numero_seq start with 1000;

alter table public.acquisti add column if not exists numero_pacchetto bigint;
alter table public.acquisti alter column numero_pacchetto set default nextval('public.pacchetto_numero_seq');
alter table public.acquisti add column if not exists stato_pacchetto text;
alter table public.acquisti add column if not exists adesione_token text;
alter table public.acquisti add column if not exists adesione_accettata boolean not null default false;
alter table public.acquisti add column if not exists documento_url text;
alter table public.acquisti add column if not exists bonifico_url text;
alter table public.acquisti add column if not exists adesione_inviata_at timestamptz;
alter table public.acquisti add column if not exists email_pacchetto_inviata_at timestamptz;
alter table public.acquisti add column if not exists attivato_at timestamptz;

update public.acquisti
set numero_pacchetto = nextval('public.pacchetto_numero_seq')
where numero_pacchetto is null;

update public.acquisti
set stato_pacchetto = case when coalesce(pagato,false) then 'attivo' else 'assegnato' end
where stato_pacchetto is null;

update public.acquisti
set adesione_token = gen_random_uuid()::text
where adesione_token is null;

create unique index if not exists acquisti_numero_pacchetto_uidx on public.acquisti(numero_pacchetto);
create unique index if not exists acquisti_adesione_token_uidx on public.acquisti(adesione_token);

-- 3) Verifica pubblica stretta: nome/cognome + telefono + cane.
create or replace function public.verifica_ingressi_pubblici(
  p_cliente_nome text,
  p_cliente_telefono text,
  p_cane_nome text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_cane text;
  v_nome text;
  v_residue integer := 0;
  v_totali integer := 0;
  v_pacchetto text;
  v_tel text := regexp_replace(coalesce(p_cliente_telefono,''), '[^0-9]', '', 'g');
  v_cane_norm text := lower(regexp_replace(coalesce(p_cane_nome,''), '[^[:alnum:]]', '', 'g'));
  v_nome_norm text := lower(regexp_replace(coalesce(p_cliente_nome,''), '[^[:alnum:]]', '', 'g'));
begin
  if length(v_tel) > 10 and left(v_tel,2) = '39' then v_tel := substr(v_tel,3); end if;
  if v_tel = '' or v_cane_norm = '' or v_nome_norm = '' then
    return jsonb_build_object('ok',false,'riconosciuto',false,'errore','Compila nome e cognome, telefono e nome del cane');
  end if;

  select count(*), min(a.cane_nome), min(a.proprietario_nome)
  into v_count, v_cane, v_nome
  from public.anagrafica a
  where lower(regexp_replace(coalesce(a.cane_nome,''), '[^[:alnum:]]', '', 'g')) = v_cane_norm
    and regexp_replace(coalesce(a.proprietario_telefono,''), '[^0-9]', '', 'g') in (v_tel, '39'||v_tel)
    and (
      lower(regexp_replace(coalesce(a.proprietario_nome,''), '[^[:alnum:]]', '', 'g')) = v_nome_norm
      or lower(regexp_replace(coalesce(a.proprietario_nome,''), '[^[:alnum:]]', '', 'g')) like '%'||v_nome_norm||'%'
      or v_nome_norm like '%'||lower(regexp_replace(coalesce(a.proprietario_nome,''), '[^[:alnum:]]', '', 'g'))||'%'
    );

  if v_count <> 1 then
    return jsonb_build_object('ok',true,'riconosciuto',false,'ambiguo',v_count>1);
  end if;

  select coalesce(sum(aq.lezioni_residue),0), coalesce(sum(aq.lezioni_totali),0)
  into v_residue, v_totali
  from public.acquisti aq
  where aq.cane_nome = v_cane
    and coalesce(aq.stato_pacchetto, case when aq.pagato then 'attivo' else 'assegnato' end) = 'attivo';

  select c.nome into v_pacchetto
  from public.acquisti aq
  left join public.carnet c on c.id = aq.carnet_id
  where aq.cane_nome = v_cane
    and coalesce(aq.stato_pacchetto, case when aq.pagato then 'attivo' else 'assegnato' end) = 'attivo'
  order by aq.data_acquisto desc, aq.id desc
  limit 1;

  return jsonb_build_object(
    'ok',true,'riconosciuto',true,'cane_nome',v_cane,'cliente_nome',v_nome,
    'pacchetto_nome',v_pacchetto,'lezioni_residue',v_residue,'lezioni_totali',v_totali
  );
end;
$$;
revoke all on function public.verifica_ingressi_pubblici(text,text,text) from public;
grant execute on function public.verifica_ingressi_pubblici(text,text,text) to anon, authenticated, service_role;

-- Mantiene la compatibilità con il frontend esistente, ma usa lo stesso controllo.
create or replace function public.riconosci_utente_pubblico(
  p_cliente_nome text,
  p_cliente_telefono text,
  p_cane_nome text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  v := public.verifica_ingressi_pubblici(p_cliente_nome,p_cliente_telefono,p_cane_nome);
  if coalesce((v->>'riconosciuto')::boolean,false) then
    return v || jsonb_build_object('metodo','nome_telefono_cane','lezioni_dopo_prenotazione',coalesce((v->>'lezioni_residue')::int,0));
  end if;
  return v || jsonb_build_object('metodo','');
end;
$$;
revoke all on function public.riconosci_utente_pubblico(text,text,text) from public;
grant execute on function public.riconosci_utente_pubblico(text,text,text) to anon, authenticated, service_role;

-- 4) Prenotazione pubblica.
-- Lezione di prova: consentita anche a un nuovo utente e NON richiede pacchetto.
-- Lezione ordinaria: richiede anagrafica riconosciuta e almeno 1 ingresso attivo.
create or replace function public.crea_prenotazione_pubblica(
  p_disponibilita_id text,
  p_cliente_nome text,
  p_cliente_email text,
  p_cliente_telefono text,
  p_cane_nome text,
  p_consenso_privacy boolean,
  p_consenso_foto_video boolean,
  p_razza text,
  p_eta text,
  p_sesso text,
  p_sterilizzato text,
  p_motivo_richiesta text,
  p_salute_terapie text,
  p_comportamento text,
  p_microchip text,
  p_versione_informativa text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := gen_random_uuid()::text;
  v_slot public.disponibilita%rowtype;
  v_rec jsonb;
  v_riconosciuto boolean := false;
  v_residue integer := 0;
  v_prova boolean := false;
begin
  if p_consenso_privacy is not true then raise exception 'Privacy obbligatoria'; end if;
  if trim(coalesce(p_cliente_nome,'')) = '' or trim(coalesce(p_cliente_telefono,'')) = '' or trim(coalesce(p_cane_nome,'')) = '' then
    raise exception 'Campi obbligatori mancanti';
  end if;

  select * into v_slot from public.disponibilita where id = p_disponibilita_id and stato = 'aperta' for update;
  if not found then raise exception 'Lezione non disponibile'; end if;
  v_prova := lower(coalesce(v_slot.tipo_lezione,'')) like '%prova%' or lower(coalesce(v_slot.tipo_lezione,'')) like '%prima lezione%';
  if v_prova and nullif(trim(coalesce(p_cliente_email,'')),'') is null then
    raise exception 'Email obbligatoria per la lezione di prova';
  end if;

  v_rec := public.verifica_ingressi_pubblici(p_cliente_nome,p_cliente_telefono,p_cane_nome);
  v_riconosciuto := coalesce((v_rec->>'riconosciuto')::boolean,false);
  v_residue := coalesce((v_rec->>'lezioni_residue')::integer,0);

  if not v_prova and not v_riconosciuto then
    raise exception 'Utente non riconosciuto. Per la prima volta prenota la lezione di prova';
  end if;
  if not v_prova and v_residue <= 0 then
    raise exception 'Nessun ingresso disponibile sul pacchetto';
  end if;
  if v_slot.posti_occupati >= v_slot.posti_totali then raise exception 'Posti esauriti'; end if;

  if v_prova and not v_riconosciuto then
    insert into public.anagrafica(
      cane_nome, proprietario_nome, proprietario_email, proprietario_telefono,
      razza, eta, sesso, sterilizzato, motivo_richiesta, salute_terapie, comportamento, microchip,
      consenso_privacy, data_consenso_privacy, consenso_foto_video, data_consenso_foto_video, versione_informativa
    ) values (
      trim(p_cane_nome), trim(p_cliente_nome), nullif(trim(coalesce(p_cliente_email,'')),''), trim(p_cliente_telefono),
      nullif(trim(coalesce(p_razza,'')),''), nullif(trim(coalesce(p_eta,'')),''), nullif(trim(coalesce(p_sesso,'')),''),
      nullif(trim(coalesce(p_sterilizzato,'')),''), nullif(trim(coalesce(p_motivo_richiesta,'')),''),
      nullif(trim(coalesce(p_salute_terapie,'')),''), nullif(trim(coalesce(p_comportamento,'')),''), nullif(trim(coalesce(p_microchip,'')),''),
      true, now(), coalesce(p_consenso_foto_video,false), case when p_consenso_foto_video then now() else null end, p_versione_informativa
    ) on conflict(cane_nome) do update set
      proprietario_nome=excluded.proprietario_nome,
      proprietario_email=coalesce(excluded.proprietario_email,public.anagrafica.proprietario_email),
      proprietario_telefono=excluded.proprietario_telefono,
      razza=coalesce(excluded.razza,public.anagrafica.razza), eta=coalesce(excluded.eta,public.anagrafica.eta),
      sesso=coalesce(excluded.sesso,public.anagrafica.sesso), sterilizzato=coalesce(excluded.sterilizzato,public.anagrafica.sterilizzato),
      motivo_richiesta=coalesce(excluded.motivo_richiesta,public.anagrafica.motivo_richiesta),
      salute_terapie=coalesce(excluded.salute_terapie,public.anagrafica.salute_terapie),
      comportamento=coalesce(excluded.comportamento,public.anagrafica.comportamento), microchip=coalesce(excluded.microchip,public.anagrafica.microchip);
  end if;

  insert into public.prenotazioni(
    id, disponibilita_id, cliente_nome, cliente_email, cliente_telefono, cane_nome, stato,
    consenso_privacy, data_consenso_privacy, consenso_foto_video, data_consenso_foto_video,
    versione_informativa, razza, eta, sesso, sterilizzato, motivo_richiesta, salute_terapie, comportamento, microchip
  ) values (
    v_id, p_disponibilita_id, trim(p_cliente_nome), nullif(trim(coalesce(p_cliente_email,'')),''), trim(p_cliente_telefono), trim(p_cane_nome), 'in attesa',
    true, now(), coalesce(p_consenso_foto_video,false), case when p_consenso_foto_video then now() else null end,
    p_versione_informativa, nullif(trim(coalesce(p_razza,'')),''), nullif(trim(coalesce(p_eta,'')),''), nullif(trim(coalesce(p_sesso,'')),''),
    nullif(trim(coalesce(p_sterilizzato,'')),''), nullif(trim(coalesce(p_motivo_richiesta,'')),''), nullif(trim(coalesce(p_salute_terapie,'')),''),
    nullif(trim(coalesce(p_comportamento,'')),''), nullif(trim(coalesce(p_microchip,'')),'')
  );
  update public.disponibilita set posti_occupati = posti_occupati + 1 where id = p_disponibilita_id;

  return jsonb_build_object('ok',true,'id',v_id,'stato','in attesa','riconosciuto',v_riconosciuto,'prova',v_prova);
end;
$$;
revoke all on function public.crea_prenotazione_pubblica(text,text,text,text,text,boolean,boolean,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.crea_prenotazione_pubblica(text,text,text,text,text,boolean,boolean,text,text,text,text,text,text,text,text,text) to anon, authenticated, service_role;

-- 5) Assegnazione pacchetto: solo Admin. Non attiva ancora gli ingressi.
create or replace function public.acs_assegna_pacchetto(p_cane_nome text, p_carnet_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_c public.carnet%rowtype;
  v_a public.anagrafica%rowtype;
  v_id text := gen_random_uuid()::text;
  v_num bigint;
  v_token text := gen_random_uuid()::text;
begin
  if not public.acs_e_admin() then raise exception 'Non autorizzato'; end if;
  select * into v_c from public.carnet where id::text=p_carnet_id and attivo=true;
  if not found then raise exception 'Pacchetto non trovato'; end if;
  select * into v_a from public.anagrafica where cane_nome=p_cane_nome limit 1;
  if not found then raise exception 'Scheda anagrafica non trovata'; end if;
  if nullif(trim(coalesce(v_a.proprietario_email,'')),'') is null then raise exception 'Email del cliente mancante in anagrafica'; end if;

  v_num := nextval('public.pacchetto_numero_seq');
  insert into public.acquisti(
    id,cliente_nome,cliente_email,cliente_telefono,cane_nome,carnet_id,data_acquisto,
    lezioni_totali,lezioni_residue,pagato,numero_pacchetto,stato_pacchetto,adesione_token
  ) values (
    v_id,v_a.proprietario_nome,v_a.proprietario_email,v_a.proprietario_telefono,v_a.cane_nome,v_c.id,current_date,
    v_c.numero_lezioni,0,false,v_num,'assegnato',v_token
  );
  return jsonb_build_object('ok',true,'acquisto_id',v_id,'numero_pacchetto',v_num,'adesione_token',v_token);
end;
$$;
revoke all on function public.acs_assegna_pacchetto(text,text) from public, anon;
grant execute on function public.acs_assegna_pacchetto(text,text) to authenticated, service_role;

-- Dati visibili dal link personale ricevuto via email.
create or replace function public.get_pacchetto_pubblico(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select aq.id,aq.numero_pacchetto,aq.cane_nome,aq.cliente_nome,aq.lezioni_totali,aq.stato_pacchetto,c.nome pacchetto_nome,c.prezzo
  into r
  from public.acquisti aq left join public.carnet c on c.id=aq.carnet_id
  where aq.adesione_token=p_token limit 1;
  if not found then return jsonb_build_object('ok',false,'errore','Link non valido o pacchetto non trovato'); end if;
  return jsonb_build_object('ok',true,'numero_pacchetto',r.numero_pacchetto,'cane_nome',r.cane_nome,'cliente_nome',r.cliente_nome,
    'lezioni_totali',r.lezioni_totali,'stato',r.stato_pacchetto,'pacchetto_nome',r.pacchetto_nome,'prezzo',r.prezzo);
end;
$$;
revoke all on function public.get_pacchetto_pubblico(text) from public;
grant execute on function public.get_pacchetto_pubblico(text) to anon, authenticated, service_role;

create or replace function public.conferma_adesione_pacchetto(
  p_token text, p_documento_url text, p_bonifico_url text, p_accetta boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_accetta is not true then raise exception 'Accettazione obbligatoria'; end if;
  if nullif(trim(coalesce(p_documento_url,'')),'') is null then raise exception 'Modulo di adesione mancante'; end if;
  if nullif(trim(coalesce(p_bonifico_url,'')),'') is null then raise exception 'Ricevuta bonifico mancante'; end if;
  update public.acquisti set adesione_accettata=true,documento_url=p_documento_url,bonifico_url=p_bonifico_url,
    adesione_inviata_at=now(),stato_pacchetto='documenti_ricevuti'
  where adesione_token=p_token and stato_pacchetto in ('assegnato','in_attesa_adesione');
  if not found then raise exception 'Pacchetto non disponibile per l''adesione'; end if;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.conferma_adesione_pacchetto(text,text,text,boolean) from public;
grant execute on function public.conferma_adesione_pacchetto(text,text,text,boolean) to anon, authenticated, service_role;

create or replace function public.acs_attiva_pacchetto(p_acquisto_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v public.acquisti%rowtype;
begin
  if not public.acs_e_admin() then raise exception 'Non autorizzato'; end if;
  select * into v from public.acquisti where id=p_acquisto_id for update;
  if not found then raise exception 'Pacchetto non trovato'; end if;
  if v.stato_pacchetto='attivo' then return jsonb_build_object('ok',true,'lezioni_residue',v.lezioni_residue,'gia_attivo',true); end if;
  if v.stato_pacchetto <> 'documenti_ricevuti' or not coalesce(v.adesione_accettata,false) or v.documento_url is null or v.bonifico_url is null then
    raise exception 'Adesione o documentazione non completa';
  end if;
  update public.acquisti set stato_pacchetto='attivo',pagato=true,lezioni_residue=lezioni_totali,attivato_at=now() where id=p_acquisto_id;
  return jsonb_build_object('ok',true,'lezioni_residue',v.lezioni_totali);
end;
$$;
revoke all on function public.acs_attiva_pacchetto(text) from public, anon;
grant execute on function public.acs_attiva_pacchetto(text) to authenticated, service_role;

-- 6) Presenza: la PROVA non scala ingressi; le lezioni ordinarie sì, una sola volta.
create or replace function public.acs_conferma_presenza(p_prenotazione_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_p public.prenotazioni%rowtype;
  v_a public.acquisti%rowtype;
  v_nome text;
  v_tipo text;
  v_prova boolean := false;
  v_prima integer := 0;
  v_dopo integer := 0;
  v_scalato boolean := false;
begin
  if not public.acs_puo_confermare_presenza() then raise exception 'Non autorizzato'; end if;
  select nome into v_nome from public.istruttori where auth_user_id=auth.uid() and attivo=true limit 1;
  select * into v_p from public.prenotazioni where id=p_prenotazione_id for update;
  if not found then raise exception 'Prenotazione non trovata'; end if;
  if v_p.stato='annullata' then raise exception 'Prenotazione annullata'; end if;
  if v_p.stato='presente' then return jsonb_build_object('ok',true,'credito_scalato',v_p.acquisto_id is not null,'gia_presente',true); end if;

  select tipo_lezione into v_tipo from public.disponibilita where id=v_p.disponibilita_id;
  v_prova := lower(coalesce(v_tipo,'')) like '%prova%' or lower(coalesce(v_tipo,'')) like '%prima lezione%';

  select coalesce(sum(lezioni_residue),0) into v_prima from public.acquisti
  where cane_nome=v_p.cane_nome and coalesce(stato_pacchetto,case when pagato then 'attivo' else 'assegnato' end)='attivo';

  if not v_prova then
    select * into v_a from public.acquisti
    where cane_nome=v_p.cane_nome and lezioni_residue>0
      and coalesce(stato_pacchetto,case when pagato then 'attivo' else 'assegnato' end)='attivo'
    order by data_acquisto,id limit 1 for update skip locked;
    if not found then raise exception 'Nessun ingresso disponibile'; end if;
    update public.acquisti set lezioni_residue=lezioni_residue-1 where id=v_a.id;
    v_scalato := true;
  end if;

  select coalesce(sum(lezioni_residue),0) into v_dopo from public.acquisti
  where cane_nome=v_p.cane_nome and coalesce(stato_pacchetto,case when pagato then 'attivo' else 'assegnato' end)='attivo';

  update public.prenotazioni set stato='presente',confermato_da=v_nome,
    acquisto_id=case when v_scalato then v_a.id else null end,
    carnet_prima=v_prima,carnet_dopo=v_dopo,movimento_carnet=case when v_scalato then -1 else 0 end
  where id=p_prenotazione_id;

  return jsonb_build_object('ok',true,'credito_scalato',v_scalato,'prova',v_prova,'carnet_prima',v_prima,'carnet_dopo',v_dopo);
end;
$$;
revoke all on function public.acs_conferma_presenza(text) from public, anon;
grant execute on function public.acs_conferma_presenza(text) to authenticated, service_role;

-- Servizi server-side Vercel.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

notify pgrst, 'reload schema';
commit;

-- Verifica rapida
select id,cane_nome,numero_pacchetto,stato_pacchetto,lezioni_totali,lezioni_residue
from public.acquisti order by data_acquisto desc nulls last limit 20;
