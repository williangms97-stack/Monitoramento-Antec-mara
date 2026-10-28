-- =====================================================================
-- Monitor de Antecâmara · banco de dados no Supabase (versão 6)
-- Cole TUDO no Supabase: SQL Editor → New query → Run.
-- Pode rodar de novo sem problema (não apaga dados).
--
-- Mesma lógica do script da planilha (versão 5):
--   api_get(p)  = antigo GET  ?acao=dados&desde=...
--   api_post(d) = antigo POST (bipagens, exclusões, checklists, locais, usuários)
-- As tabelas ficam FECHADAS (RLS sem políticas): só as duas funções
-- acima acessam os dados. A chave pública do app só consegue chamar as funções.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- tabelas (mesmas colunas das abas da planilha) ----------
create table if not exists bipagens (
  n            bigserial,
  id           text primary key,
  data         text, hora text, lote text, empresa text, local text, reincidente text,
  dia_seq      text, inicio text, tempo_fora text, horas_fora text,
  codigo       text, aparelho text,
  recebido_em  timestamptz default now(),
  situacao     text default 'Ativa',
  tipo         text default 'Lote',
  variedade text, categoria text, peso text, safra text, origem text, produzido text, obs text,
  foto         text, ts bigint, local_id text
);
create index if not exists bipagens_ts on bipagens (ts);
create index if not exists bipagens_lote on bipagens (upper(lote), data);

create table if not exists checklists (
  n bigserial, id text primary key,
  data text, hora text, acao text, aparelho text, conferidos text,
  finalizados int, lotes_finalizados text, recebido_em timestamptz default now(),
  ts bigint, dia text
);

create table if not exists finalizados (
  n bigserial primary key,
  finalizado_em text, tipo text, lote text, empresa text, primeira text, ultima text,
  ultimo_local text, tempo_fora text, horas_fora text, aparelho text, situacao text
);

create table if not exists locais (
  n bigserial, id text primary key,
  armazem text, posicao text, situacao text default 'Ativo', atualizado_em timestamptz default now()
);

create table if not exists usuarios (
  usuario text primary key, nome text, perfil text, situacao text,
  sal text, hash text, criado_em timestamptz default now(), criado_por text, atualizado_em timestamptz default now()
);

create table if not exists log_usuarios (
  n bigserial primary key, em timestamptz default now(), acao text, usuario text, feito_por text
);

create table if not exists repetidas (
  n bigserial primary key, registrado_em timestamptz default now(), tipo text, lote text, data text, local text,
  mantida_hora text, mantida_usuario text, mantida_id text,
  excluida_hora text, excluida_usuario text, excluida_id text, motivo text
);

create table if not exists config (chave text primary key, valor text);

-- ---------- segurança: ninguém acessa as tabelas direto ----------
do $$ declare t text; begin
  foreach t in array array['bipagens','checklists','finalizados','locais','usuarios','log_usuarios','repetidas','config'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- auxiliares ----------
create or replace function _hash(sal text, senha text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(convert_to(sal || ':' || senha, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function _cfg(k text) returns text language sql stable set search_path = public as $$
  select valor from config where chave = k
$$;

create or replace function _log(acao text, usuario text, por text) returns void language sql set search_path = public as $$
  insert into log_usuarios (acao, usuario, feito_por) values (acao, usuario, coalesce(por, ''))
$$;

create or replace function _conferir(u text, s text) returns usuarios
language sql stable set search_path = public as $$
  select * from usuarios
   where usuario = lower(trim(coalesce(u, ''))) and situacao = 'Ativo' and hash = _hash(sal, coalesce(s, ''))
$$;

create or replace function _norm_local(s text) returns text language sql immutable as $$
  select upper(trim(regexp_replace(coalesce(s, ''), '\s+', ' ', 'g')))
$$;

-- horário da bipagem (TS do aparelho; se não houver, data + hora)
create or replace function _ts_linha(b bipagens) returns bigint language sql stable as $$
  select coalesce(nullif(b.ts, 0),
    case when b.data ~ '^\d{2}/\d{2}/\d{4}$'
      then (extract(epoch from to_timestamp(b.data || ' ' || coalesce(nullif(b.hora, ''), '00:00:00'), 'DD/MM/YYYY HH24:MI:SS')) * 1000)::bigint
      else 0 end)
$$;

-- ---------- usuários (login, primeiro acesso, área do administrador) ----------
create or replace function _usuarios(d jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  qtd int; tem_admin boolean; u usuarios; adm usuarios; alvo text; s text; nova text; v_sal text;
  apagadas jsonb := '{}'::jsonb; c int;
begin
  select count(*), bool_or(perfil = 'Administrador' and situacao = 'Ativo') into qtd, tem_admin from usuarios;
  if d->>'acao' = 'statusUsuarios' then return jsonb_build_object('ok', true, 'temAdmin', coalesce(tem_admin, false)); end if;

  if d->>'acao' = 'criarAdmin' then
    if qtd > 0 then return jsonb_build_object('ok', false, 'erro', 'O administrador já foi criado. Entre com usuário e senha.'); end if;
    alvo := lower(trim(coalesce(d->>'usuario', ''))); s := coalesce(d->>'senha', '');
    if alvo = '' or length(s) < 4 then return jsonb_build_object('ok', false, 'erro', 'Informe usuário e uma senha com pelo menos 4 caracteres.'); end if;
    v_sal := gen_random_uuid()::text;
    insert into usuarios values (alvo, coalesce(nullif(d->>'nome', ''), alvo), 'Administrador', 'Ativo', v_sal, _hash(v_sal, s), now(), '(primeiro acesso)', now());
    perform _log('Administrador criado', alvo, '(primeiro acesso)');
    return jsonb_build_object('ok', true);
  end if;

  if d->>'acao' = 'login' then
    u := _conferir(d->>'usuario', d->>'senha');
    if u.usuario is null then return jsonb_build_object('ok', false, 'erro', 'Usuário ou senha inválidos.'); end if;
    perform _log('Login', u.usuario, coalesce(d->>'aparelho', ''));
    return jsonb_build_object('ok', true, 'usuario', jsonb_build_object('usuario', u.usuario, 'nome', u.nome, 'perfil', u.perfil), 'sal', u.sal, 'hash', u.hash);
  end if;

  if d->>'acao' = 'usuarios' then
    adm := _conferir(d->'admin'->>'usuario', d->'admin'->>'senha');
    if adm.usuario is null or adm.perfil <> 'Administrador' then
      return jsonb_build_object('ok', false, 'erro', 'Acesso negado: usuário ou senha de administrador inválidos.'); end if;
    alvo := lower(trim(coalesce(d->>'usuario', '')));
    select * into u from usuarios where usuario = alvo;

    if d->>'op' = 'zerar' then
      select count(*) into c from bipagens;    apagadas := apagadas || jsonb_build_object('Bipagens', c);          delete from bipagens;
      select count(*) into c from checklists;  apagadas := apagadas || jsonb_build_object('Checklists', c);        delete from checklists;
      select count(*) into c from finalizados; apagadas := apagadas || jsonb_build_object('Finalizados', c);       delete from finalizados;
      select count(*) into c from repetidas;   apagadas := apagadas || jsonb_build_object('Repetidas offline', c); delete from repetidas;
      if coalesce((d->>'locais')::boolean, false) then
        select count(*) into c from locais; apagadas := apagadas || jsonb_build_object('Locais', c); delete from locais; end if;
      insert into config values ('RESET_TS', (extract(epoch from now()) * 1000)::bigint::text) on conflict (chave) do update set valor = excluded.valor;
      insert into config values ('RESET_LOCAIS', case when coalesce((d->>'locais')::boolean, false) then '1' else '0' end) on conflict (chave) do update set valor = excluded.valor;
      perform _log('Dados zerados (' || (select string_agg(key || ': ' || value, ', ') from jsonb_each_text(apagadas)) || ')', '-', adm.usuario);
      return jsonb_build_object('ok', true, 'apagadas', apagadas);
    end if;

    if d->>'op' = 'salvar' then
      s := coalesce(d->>'senha', '');
      if alvo = '' or alvo !~ '^[a-z0-9._-]{2,30}$' then
        return jsonb_build_object('ok', false, 'erro', 'Usuário inválido: use letras, números, ponto, hífen ou sublinhado (sem espaços).'); end if;
      if u.usuario is not null then return jsonb_build_object('ok', false, 'erro', 'Este usuário já existe.'); end if;
      if length(s) < 4 then return jsonb_build_object('ok', false, 'erro', 'A senha precisa ter pelo menos 4 caracteres.'); end if;
      nova := case when d->>'perfil' = 'Administrador' then 'Administrador' else 'Operador' end;
      v_sal := gen_random_uuid()::text;
      insert into usuarios values (alvo, coalesce(nullif(d->>'nome', ''), alvo), nova, 'Ativo', v_sal, _hash(v_sal, s), now(), adm.usuario, now());
      perform _log('Usuário cadastrado (' || nova || ')', alvo, adm.usuario);
    elsif d->>'op' = 'senha' then
      if u.usuario is null then return jsonb_build_object('ok', false, 'erro', 'Usuário não encontrado.'); end if;
      if length(coalesce(d->>'senha', '')) < 4 then return jsonb_build_object('ok', false, 'erro', 'A senha precisa ter pelo menos 4 caracteres.'); end if;
      v_sal := gen_random_uuid()::text;
      update usuarios set sal = v_sal, hash = _hash(v_sal, d->>'senha'), atualizado_em = now() where usuario = u.usuario;
      perform _log('Senha alterada', u.usuario, adm.usuario);
    elsif d->>'op' = 'situacao' then
      if u.usuario is null then return jsonb_build_object('ok', false, 'erro', 'Usuário não encontrado.'); end if;
      if u.usuario = adm.usuario then return jsonb_build_object('ok', false, 'erro', 'Você não pode desativar o próprio usuário.'); end if;
      nova := case when u.situacao = 'Ativo' then 'Inativo' else 'Ativo' end;
      update usuarios set situacao = nova, atualizado_em = now() where usuario = u.usuario;
      perform _log(case when nova = 'Ativo' then 'Usuário reativado' else 'Usuário desativado' end, u.usuario, adm.usuario);
    end if;

    return jsonb_build_object('ok', true, 'usuarios', coalesce((select jsonb_agg(jsonb_build_object(
      'usuario', x.usuario, 'nome', x.nome, 'perfil', x.perfil, 'situacao', x.situacao, 'criadoPor', x.criado_por,
      'criadoEm', to_char(x.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')) order by x.criado_em) from usuarios x), '[]'::jsonb));
  end if;
  return null;
end $$;

-- ---------- bipagens repetidas offline: mesmo lote, mesmo dia, mesmo local → mantém a mais antiga ----------
create or replace function _resolver_repetidas(ids text[]) returns text[]
language plpgsql set search_path = public as $$
declare nova bipagens; grupo bipagens[]; mantida bipagens; x bipagens; excl text[] := '{}'; i int;
begin
  for nova in select * from bipagens where id = any(ids) and situacao not like 'Excluída%' order by n loop
    if nova.id = any(excl) then continue; end if;
    select array_agg(b order by _ts_linha(b), b.n) into grupo from bipagens b
     where b.situacao not like 'Excluída%' and not (b.id = any(excl))
       and coalesce(nullif(b.tipo, ''), 'Lote') = coalesce(nullif(nova.tipo, ''), 'Lote')
       and upper(b.lote) = upper(nova.lote) and b.data = nova.data
       and ((coalesce(b.local_id, '') <> '' and b.local_id = nova.local_id) or _norm_local(b.local) = _norm_local(nova.local));
    if coalesce(array_length(grupo, 1), 0) < 2 then continue; end if;
    mantida := grupo[1];
    for i in 2 .. array_length(grupo, 1) loop
      x := grupo[i];
      update bipagens set situacao = 'Excluída (repetida offline)' where id = x.id;
      insert into repetidas (tipo, lote, data, local, mantida_hora, mantida_usuario, mantida_id, excluida_hora, excluida_usuario, excluida_id, motivo)
      values (coalesce(nullif(x.tipo, ''), 'Lote'), x.lote, x.data, x.local, mantida.hora, mantida.aparelho, mantida.id, x.hora, x.aparelho, x.id,
              'Mesmo lote no mesmo local no mesmo dia (bipagem feita sem internet). Mantida a mais antiga.');
      excl := excl || x.id;
    end loop;
  end loop;
  return excl;
end $$;

-- =====================================================================
-- API pública (o app e o painel chamam só estas duas)
-- =====================================================================
create or replace function api_get(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare desde bigint := coalesce(nullif(p->>'desde', '')::bigint, 0);
begin
  if coalesce(p->>'acao', '') <> 'dados' then return jsonb_build_object('ok', true, 'msg', 'Banco conectado (Supabase)', 'versao', 6); end if;
  return jsonb_build_object('ok', true,
    'registros', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', b.id, 'data', b.data, 'hora', b.hora, 'lote', b.lote, 'empresa', coalesce(b.empresa, ''), 'local', coalesce(b.local, ''),
        'codigo', coalesce(b.codigo, ''), 'aparelho', coalesce(b.aparelho, ''), 'situacao', coalesce(b.situacao, ''), 'tipo', coalesce(nullif(b.tipo, ''), 'Lote'),
        'dados', nullif(jsonb_strip_nulls(jsonb_build_object('variedade', nullif(b.variedade, ''), 'categoria', nullif(b.categoria, ''), 'peso', nullif(b.peso, ''),
                   'safra', nullif(b.safra, ''), 'origem', nullif(b.origem, ''), 'produzido', nullif(b.produzido, ''), 'obs', nullif(b.obs, ''))), '{}'::jsonb),
        'fotoUrl', coalesce(b.foto, ''), 'ts', coalesce(b.ts, 0), 'localId', coalesce(b.local_id, ''))) order by b.n)
      from bipagens b where coalesce(b.ts, 0) = 0 or b.ts >= desde), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'ts', c.ts, 'data', c.dia, 'acao', c.acao, 'aparelho', coalesce(c.aparelho, '')) order by c.n)
      from checklists c where c.id <> '' and coalesce(c.ts, 0) <> 0), '[]'::jsonb),
    'locais', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'armazem', coalesce(l.armazem, ''), 'posicao', coalesce(l.posicao, ''), 'situacao', coalesce(nullif(l.situacao, ''), 'Ativo')) order by l.n)
      from locais l), '[]'::jsonb),
    'reset', coalesce(_cfg('RESET_TS')::bigint, 0),
    'resetLocais', coalesce(_cfg('RESET_LOCAIS'), '0') = '1');
end $$;

create or replace function api_post(d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; c jsonb; f jsonb; l jsonb; ex text; x jsonb;
  reset_ts bigint := coalesce(_cfg('RESET_TS')::bigint, 0);
  reset_loc boolean := coalesce(_cfg('RESET_LOCAIS'), '0') = '1';
  recebidos text[] := '{}'; novos text[] := '{}'; excluidos text[] := '{}'; checks text[] := '{}'; locs text[] := '{}';
  fotos jsonb := '{}'::jsonb; repet text[];
begin
  perform pg_advisory_xact_lock(4242);   -- um envio por vez (como o bloqueio do script da planilha)

  if d ? 'acao' then x := _usuarios(d); if x is not null then return x; end if; end if;

  -- bipagens
  for r in select * from jsonb_array_elements(coalesce(d->'registros', '[]'::jsonb)) loop
    if exists (select 1 from bipagens where id = r->>'id') then recebidos := recebidos || (r->>'id'); continue; end if;
    if reset_ts > 0 and coalesce(nullif(r->>'ts', '')::bigint, 0) > 0 and (r->>'ts')::bigint < reset_ts then recebidos := recebidos || (r->>'id'); continue; end if;
    insert into bipagens (id, data, hora, lote, empresa, local, reincidente, dia_seq, inicio, tempo_fora, horas_fora, codigo, aparelho, situacao, tipo,
                          variedade, categoria, peso, safra, origem, produzido, obs, foto, ts, local_id)
    values (r->>'id', r->>'data', r->>'hora', r->>'lote', coalesce(r->>'empresa', r->>'modelo'), r->>'local', r->>'reincidente',
            r->>'diaSeq', r->>'inicio', r->>'tempoFora', r->>'horasFora', r->>'codigo', r->>'aparelho', 'Ativa', coalesce(nullif(r->>'tipo', ''), 'Lote'),
            coalesce(r->'dados'->>'variedade', ''), coalesce(r->'dados'->>'categoria', ''), coalesce(r->'dados'->>'peso', ''), coalesce(r->'dados'->>'safra', ''),
            coalesce(r->'dados'->>'origem', ''), coalesce(r->'dados'->>'produzido', ''), coalesce(r->'dados'->>'obs', ''),
            coalesce(r->>'fotoUrl', ''), nullif(r->>'ts', '')::bigint, coalesce(r->>'localId', ''));
    if coalesce(r->>'fotoUrl', '') <> '' then fotos := fotos || jsonb_build_object(r->>'id', r->>'fotoUrl'); end if;
    recebidos := recebidos || (r->>'id'); novos := novos || (r->>'id');
  end loop;

  -- exclusões
  for ex in select jsonb_array_elements_text(coalesce(d->'excluir', '[]'::jsonb)) loop
    update bipagens set situacao = 'Excluída' || case when coalesce(d->>'usuario', '') <> '' then ' por ' || (d->>'usuario') else '' end where id = ex;
    excluidos := excluidos || ex;
  end loop;

  repet := _resolver_repetidas(novos);

  -- checklists e finalizados
  for c in select * from jsonb_array_elements(coalesce(d->'checklists', '[]'::jsonb)) loop
    if reset_ts > 0 and coalesce(nullif(c->>'ts', '')::bigint, 0) > 0 and (c->>'ts')::bigint < reset_ts then checks := checks || (c->>'id'); continue; end if;
    if not exists (select 1 from checklists where id = c->>'id') then
      insert into checklists (id, data, hora, acao, aparelho, conferidos, finalizados, lotes_finalizados, ts, dia)
      values (c->>'id', c->>'data', c->>'hora', c->>'acao', c->>'aparelho', c->>'conferidos', jsonb_array_length(coalesce(c->'finalizados', '[]'::jsonb)),
              (select string_agg(e->>'lote', ', ') from jsonb_array_elements(coalesce(c->'finalizados', '[]'::jsonb)) e),
              nullif(c->>'ts', '')::bigint, coalesce(c->>'dataKey', ''));
      if c->>'acao' = 'Reaberto' then   -- cancela as finalizações daquele dia feitas por este aparelho
        update finalizados set situacao = 'Cancelado (checklist reaberto)'
         where finalizado_em = c->>'data' and aparelho = c->>'aparelho' and situacao = 'Finalizado';
      end if;
      for f in select * from jsonb_array_elements(coalesce(c->'finalizados', '[]'::jsonb)) loop
        insert into finalizados (finalizado_em, tipo, lote, empresa, primeira, ultima, ultimo_local, tempo_fora, horas_fora, aparelho, situacao)
        values (c->>'data', f->>'tipo', f->>'lote', f->>'empresa', f->>'inicio', f->>'ultima', f->>'local', f->>'tempoFora', f->>'horasFora', c->>'aparelho', 'Finalizado');
      end loop;
    end if;
    checks := checks || (c->>'id');
  end loop;

  -- locais (cadastro / remoção)
  for l in select * from jsonb_array_elements(coalesce(d->'locais', '[]'::jsonb)) loop
    if not (reset_ts > 0 and reset_loc and coalesce(nullif(l->>'ts', '')::bigint, 0) < reset_ts) then
      insert into locais (id, armazem, posicao, situacao, atualizado_em)
      values (l->>'id', coalesce(l->>'armazem', ''), coalesce(l->>'posicao', ''), coalesce(nullif(l->>'situacao', ''), 'Ativo'), now())
      on conflict (id) do update set armazem = excluded.armazem, posicao = excluded.posicao, situacao = excluded.situacao, atualizado_em = now();
    end if;
    locs := locs || ((l->>'id') || '|' || coalesce(nullif(l->>'situacao', ''), 'Ativo'));
  end loop;

  return jsonb_build_object('ok', true, 'recebidos', to_jsonb(recebidos), 'excluidos', to_jsonb(excluidos), 'checklists', to_jsonb(checks),
                            'fotos', fotos, 'locais', to_jsonb(locs), 'repetidas', to_jsonb(coalesce(repet, '{}')));
exception when others then
  return jsonb_build_object('ok', false, 'erro', SQLERRM);
end $$;

revoke all on function api_get(jsonb), api_post(jsonb) from public;
grant execute on function api_get(jsonb), api_post(jsonb) to anon, authenticated;
-- as auxiliares não ficam expostas
do $$ declare fn text; begin
  foreach fn in array array['_hash(text,text)','_cfg(text)','_log(text,text,text)','_conferir(text,text)','_norm_local(text)','_ts_linha(bipagens)','_usuarios(jsonb)','_resolver_repetidas(text[])'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

-- ---------- fotos dos pré-lotes: pasta pública "fotos" (o app só consegue ENVIAR; não apaga nem lista) ----------
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true) on conflict (id) do nothing;
do $$ begin
  drop policy if exists "app envia fotos" on storage.objects;
  create policy "app envia fotos" on storage.objects for insert to anon, authenticated with check (bucket_id = 'fotos');
exception when others then raise notice 'Política das fotos não criada (%). Crie pelo painel: Storage → fotos → Policies.', SQLERRM;
end $$;

select 'Pronto: estrutura do Monitor de Antecâmara criada (versão 6).' as resultado;
