-- ACS Fase 4 - Operazioni Supabase complete
-- Eseguire una sola volta nel SQL Editor DOPO schema.sql e fase3_iscrizione_pubblica.sql.

-- Riconoscimento pubblico del socio, senza esporre l'anagrafica.
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
declare
  v_count integer := 0;
  v_cane text;
  v_residue integer := 0;
  v_tel text := regexp_replace(coalesce(p_cliente_telefono,''), '[^0-9]', '', 'g');
  v_cane_norm text := lower(regexp_replace(coalesce(p_cane_nome,''), '[^[:alnum:]]', '', 'g'));
  v_nome_norm text := lower(regexp_replace(coalesce(p_cliente_nome,''), '[^[:alnum:]]', '', 'g'));
begin
  if length(v_tel) > 10 and left(v_tel,2) = '39' then v_tel := substr(v_tel,3); end if;
  if trim(coalesce(p_cliente_nome,'')) = '' or v_tel = '' or trim(coalesce(p_cane_nome,'')) = '' then
    return jsonb_build_object('ok', true, 'riconosciuto', false, 'ambiguo', false, 'metodo', '');
  end if;

  select count(*), min(a.cane_nome)
  into v_count, v_cane
  from public.anagrafica a
  where lower(regexp_replace(coalesce(a.cane_nome,''), '[^[:alnum:]]', '', 'g')) = v_cane_norm
    and regexp_replace(coalesce(a.proprietario_telefono,''), '[^0-9]', '', 'g') in (v_tel, '39'||v_tel);

  if v_count = 1 then
    select coalesce(sum(lezioni_residue),0) into v_residue from public.acquisti where cane_nome = v_cane;
    return jsonb_build_object('ok', true, 'riconosciuto', true, 'ambiguo', false, 'metodo', 'telefono_cane',
      'lezioni_residue', v_residue, 'lezioni_dopo_prenotazione', greatest(0,v_residue-1));
  elsif v_count > 1 then
    return jsonb_build_object('ok', true, 'riconosciuto', false, 'ambiguo', true, 'metodo', 'telefono_cane');
  end if;

  -- Fallback semplice nome/cognome + cane.
  select count(*), min(a.cane_nome)
  into v_count, v_cane
  from public.anagrafica a
  where lower(regexp_replace(coalesce(a.cane_nome,''), '[^[:alnum:]]', '', 'g')) = v_cane_norm
    and (
      lower(regexp_replace(coalesce(a.proprietario_nome,''), '[^[:alnum:]]', '', 'g')) like '%'||v_nome_norm||'%'
      or v_nome_norm like '%'||lower(regexp_replace(coalesce(a.proprietario_nome,''), '[^[:alnum:]]', '', 'g'))||'%'
    );

  if v_count = 1 then
    select coalesce(sum(lezioni_residue),0) into v_residue from public.acquisti where cane_nome = v_cane;
    return jsonb_build_object('ok', true, 'riconosciuto', true, 'ambiguo', false, 'metodo', 'nome_o_cognome_cane',
      'lezioni_residue', v_residue, 'lezioni_dopo_prenotazione', greatest(0,v_residue-1));
  elsif v_count > 1 then
    return jsonb_build_object('ok', true, 'riconosciuto', false, 'ambiguo', true, 'metodo', 'nome_o_cognome_cane');
  end if;

  return jsonb_build_object('ok', true, 'riconosciuto', false, 'ambiguo', false, 'metodo', '');
end;
$$;

grant execute on function public.riconosci_utente_pubblico(text,text,text) to anon, authenticated;

-- Prenotazione pubblica: decide lato DB se il soggetto è già in anagrafica.
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
  v_stato text;
begin
  if p_consenso_privacy is not true then raise exception 'Privacy obbligatoria'; end if;
  if trim(coalesce(p_cliente_nome,'')) = '' or trim(coalesce(p_cliente_telefono,'')) = '' or trim(coalesce(p_cane_nome,'')) = '' then
    raise exception 'Campi obbligatori mancanti';
  end if;

  select * into v_slot from public.disponibilita where id = p_disponibilita_id and stato = 'aperta' for update;
  if not found then raise exception 'Lezione non disponibile'; end if;

  v_rec := public.riconosci_utente_pubblico(p_cliente_nome,p_cliente_telefono,p_cane_nome);
  v_riconosciuto := coalesce((v_rec->>'riconosciuto')::boolean,false);
  v_stato := case when v_riconosciuto then 'in attesa' else 'in sospeso' end;

  if v_riconosciuto and v_slot.posti_occupati >= v_slot.posti_totali then raise exception 'Posti esauriti'; end if;

  insert into public.prenotazioni(
    id, disponibilita_id, cliente_nome, cliente_email, cliente_telefono, cane_nome, stato,
    consenso_privacy, data_consenso_privacy, consenso_foto_video, data_consenso_foto_video,
    versione_informativa, razza, eta, sesso, sterilizzato, motivo_richiesta, salute_terapie, comportamento, microchip
  ) values (
    v_id, p_disponibilita_id, trim(p_cliente_nome), nullif(trim(coalesce(p_cliente_email,'')),''), trim(p_cliente_telefono), trim(p_cane_nome), v_stato,
    true, now(), coalesce(p_consenso_foto_video,false), case when p_consenso_foto_video then now() else null end,
    p_versione_informativa, nullif(trim(coalesce(p_razza,'')),''), nullif(trim(coalesce(p_eta,'')),''), nullif(trim(coalesce(p_sesso,'')),''),
    nullif(trim(coalesce(p_sterilizzato,'')),''), nullif(trim(coalesce(p_motivo_richiesta,'')),''), nullif(trim(coalesce(p_salute_terapie,'')),''),
    nullif(trim(coalesce(p_comportamento,'')),''), nullif(trim(coalesce(p_microchip,'')),'')
  );

  if v_riconosciuto then
    update public.disponibilita set posti_occupati = posti_occupati + 1 where id = p_disponibilita_id;
  end if;

  return jsonb_build_object('ok',true,'id',v_id,'stato',v_stato,'riconosciuto',v_riconosciuto);
end;
$$;

grant execute on function public.crea_prenotazione_pubblica(text,text,text,text,text,boolean,boolean,text,text,text,text,text,text,text,text,text) to anon, authenticated;

-- Approvazione iscrizione corso: aggiorna iscrizione, anagrafica e acquisto in una transazione.
create or replace function public.acs_approva_iscrizione(p_iscrizione_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_i public.iscrizioni%rowtype;
  v_c public.corsi%rowtype;
  v_nome_istruttore text;
  v_acquisto_id text := gen_random_uuid()::text;
begin
  if not public.acs_puo_modificare() then raise exception 'Non autorizzato'; end if;
  select nome into v_nome_istruttore from public.istruttori where auth_user_id=auth.uid() and attivo=true limit 1;
  select * into v_i from public.iscrizioni where id=p_iscrizione_id for update;
  if not found then raise exception 'Iscrizione non trovata'; end if;
  if lower(v_i.stato) not like '%attesa%' then raise exception 'Iscrizione già gestita'; end if;
  select * into v_c from public.corsi where nome=v_i.corso_selezionato limit 1;
  if not found then raise exception 'Corso non trovato'; end if;

  update public.iscrizioni set stato='approvato', data_approvazione=current_date, approvato_da=v_nome_istruttore where id=p_iscrizione_id;

  insert into public.anagrafica(cane_nome, proprietario_nome, proprietario_email, proprietario_telefono, razza, sesso, microchip, consenso_privacy, data_consenso_privacy)
  values(v_i.cane_nome, trim(v_i.nome||' '||v_i.cognome), v_i.email, v_i.telefono, v_i.cane_razza, v_i.sesso_cane, v_i.microchip, true, now())
  on conflict(cane_nome) do nothing;

  insert into public.acquisti(id,cliente_nome,cliente_email,cliente_telefono,cane_nome,carnet_id,data_acquisto,lezioni_totali,lezioni_residue,pagato)
  values(v_acquisto_id,trim(v_i.nome||' '||v_i.cognome),v_i.email,v_i.telefono,v_i.cane_nome,v_c.id,current_date,v_c.numero_lezioni,v_c.numero_lezioni,true);

  return jsonb_build_object('ok',true,'acquisto_id',v_acquisto_id);
end; $$;
revoke all on function public.acs_approva_iscrizione(text) from public;
grant execute on function public.acs_approva_iscrizione(text) to authenticated;

create or replace function public.acs_rifiuta_iscrizione(p_iscrizione_id text,p_motivo text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_nome text;
begin
  if not public.acs_puo_modificare() then raise exception 'Non autorizzato'; end if;
  select nome into v_nome from public.istruttori where auth_user_id=auth.uid() and attivo=true limit 1;
  update public.iscrizioni set stato='rifiutato', motivo_rifiuto=nullif(trim(coalesce(p_motivo,'')),''), approvato_da=v_nome where id=p_iscrizione_id;
  if not found then raise exception 'Iscrizione non trovata'; end if;
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.acs_rifiuta_iscrizione(text,text) from public;
grant execute on function public.acs_rifiuta_iscrizione(text,text) to authenticated;

create or replace function public.acs_conferma_presenza(p_prenotazione_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_p public.prenotazioni%rowtype;
  v_a public.acquisti%rowtype;
  v_nome text;
  v_prima integer := 0;
  v_dopo integer := 0;
  v_scalato boolean := false;
begin
  if not public.acs_puo_modificare() then raise exception 'Non autorizzato'; end if;
  select nome into v_nome from public.istruttori where auth_user_id=auth.uid() and attivo=true limit 1;
  select * into v_p from public.prenotazioni where id=p_prenotazione_id for update;
  if not found then raise exception 'Prenotazione non trovata'; end if;
  if v_p.stato='annullata' then raise exception 'Prenotazione annullata'; end if;
  if v_p.stato='presente' then return jsonb_build_object('ok',true,'credito_scalato',v_p.acquisto_id is not null); end if;

  select coalesce(sum(lezioni_residue),0) into v_prima from public.acquisti where cane_nome=v_p.cane_nome;
  select * into v_a from public.acquisti where cane_nome=v_p.cane_nome and lezioni_residue>0 order by data_acquisto,id limit 1 for update skip locked;
  if found then
    update public.acquisti set lezioni_residue=lezioni_residue-1 where id=v_a.id;
    v_scalato := true;
  end if;
  select coalesce(sum(lezioni_residue),0) into v_dopo from public.acquisti where cane_nome=v_p.cane_nome;
  update public.prenotazioni set stato='presente', confermato_da=v_nome, acquisto_id=case when v_scalato then v_a.id else acquisto_id end,
    carnet_prima=v_prima,carnet_dopo=v_dopo,movimento_carnet=case when v_scalato then -1 else 0 end where id=p_prenotazione_id;
  return jsonb_build_object('ok',true,'credito_scalato',v_scalato,'carnet_prima',v_prima,'carnet_dopo',v_dopo);
end; $$;
revoke all on function public.acs_conferma_presenza(text) from public;
grant execute on function public.acs_conferma_presenza(text) to authenticated;

create or replace function public.acs_annulla_prenotazione(p_prenotazione_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_p public.prenotazioni%rowtype;
  v_a public.acquisti%rowtype;
  v_nome text;
  v_prima integer := 0;
  v_dopo integer := 0;
  v_restituito boolean := false;
begin
  if not public.acs_puo_modificare() then raise exception 'Non autorizzato'; end if;
  select nome into v_nome from public.istruttori where auth_user_id=auth.uid() and attivo=true limit 1;
  select * into v_p from public.prenotazioni where id=p_prenotazione_id for update;
  if not found then raise exception 'Prenotazione non trovata'; end if;
  if v_p.stato='annullata' then return jsonb_build_object('ok',true,'gia_annullata',true,'credito_restituito',false); end if;

  select coalesce(sum(lezioni_residue),0) into v_prima from public.acquisti where cane_nome=v_p.cane_nome;
  if v_p.stato='presente' then
    v_a := null;
    if v_p.acquisto_id is not null then
      select * into v_a from public.acquisti where id=v_p.acquisto_id for update;
    end if;
    if v_a.id is null then
      select * into v_a from public.acquisti where cane_nome=v_p.cane_nome and lezioni_residue<lezioni_totali order by data_acquisto desc,id desc limit 1 for update;
    end if;
    if v_a.id is not null and v_a.lezioni_residue < v_a.lezioni_totali then
      update public.acquisti set lezioni_residue=lezioni_residue+1 where id=v_a.id;
      v_restituito := true;
    end if;
  end if;
  select coalesce(sum(lezioni_residue),0) into v_dopo from public.acquisti where cane_nome=v_p.cane_nome;
  update public.prenotazioni set stato='annullata', annullato_da=v_nome, data_annullamento=now(), credito_restituito=v_restituito,
    carnet_prima=v_prima,carnet_dopo=v_dopo,movimento_carnet=case when v_restituito then 1 else 0 end where id=p_prenotazione_id;
  if v_p.stato <> 'in sospeso' then
    update public.disponibilita set posti_occupati=greatest(0,posti_occupati-1) where id=v_p.disponibilita_id;
  end if;
  return jsonb_build_object('ok',true,'credito_restituito',v_restituito,'carnet_prima',v_prima,'carnet_dopo',v_dopo);
end; $$;
revoke all on function public.acs_annulla_prenotazione(text) from public;
grant execute on function public.acs_annulla_prenotazione(text) to authenticated;

create or replace function public.acs_approva_richiesta(p_prenotazione_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_p public.prenotazioni%rowtype;
begin
  if not public.acs_puo_modificare() then raise exception 'Non autorizzato'; end if;
  select * into v_p from public.prenotazioni where id=p_prenotazione_id for update;
  if not found then raise exception 'Richiesta non trovata'; end if;
  if v_p.stato <> 'in sospeso' then raise exception 'Richiesta già gestita'; end if;
  insert into public.anagrafica(cane_nome,proprietario_nome,proprietario_email,proprietario_telefono,razza,eta,sesso,sterilizzato,motivo_richiesta,salute_terapie,comportamento,microchip,
    consenso_privacy,data_consenso_privacy,consenso_foto_video,data_consenso_foto_video,versione_informativa)
  values(v_p.cane_nome,v_p.cliente_nome,v_p.cliente_email,v_p.cliente_telefono,v_p.razza,v_p.eta,v_p.sesso,v_p.sterilizzato,v_p.motivo_richiesta,v_p.salute_terapie,v_p.comportamento,v_p.microchip,
    v_p.consenso_privacy,v_p.data_consenso_privacy,v_p.consenso_foto_video,v_p.data_consenso_foto_video,v_p.versione_informativa)
  on conflict(cane_nome) do nothing;
  update public.prenotazioni set stato='in attesa' where id=p_prenotazione_id;
  update public.disponibilita set posti_occupati=posti_occupati+1 where id=v_p.disponibilita_id and posti_occupati<posti_totali;
  if not found then raise exception 'Nessun posto disponibile'; end if;
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.acs_approva_richiesta(text) from public;
grant execute on function public.acs_approva_richiesta(text) to authenticated;

create or replace function public.acs_rifiuta_richiesta(p_prenotazione_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.acs_puo_modificare() then raise exception 'Non autorizzato'; end if;
  delete from public.prenotazioni where id=p_prenotazione_id and stato='in sospeso';
  if not found then raise exception 'Richiesta non trovata o già gestita'; end if;
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.acs_rifiuta_richiesta(text) from public;
grant execute on function public.acs_rifiuta_richiesta(text) to authenticated;
