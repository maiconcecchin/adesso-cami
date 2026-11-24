-- AI PRO Cami: o que o banco precisa além da estrutura, aplicado pelo instalador depois do
-- banco/01-estrutura.sql (como supabase_admin). Pode rodar de novo sem duplicar nada.

-- 1. Extensões: pg_net (o banco chama o motor do app) e pg_cron (o relógio de manutenção).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- 2. O lugar das mídias (áudios, imagens e documentos das conversas), privado.
insert into storage.buckets (id, name, public)
values ('midias', 'midias', false)
on conflict (id) do nothing;

-- 3. Quem pode ler e gravar as mídias: só membros da equipe, e só na pasta de uma conversa.
drop policy if exists midias_membro_le on storage.objects;
create policy midias_membro_le on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'midias'::text) and (select public.eh_membro() as eh_membro));

drop policy if exists midias_membro_grava on storage.objects;
create policy midias_membro_grava on storage.objects as permissive for insert to authenticated
  with check (
    (bucket_id = 'midias'::text)
    and (select public.eh_membro() as eh_membro)
    and (coalesce(array_length(storage.foldername(name), 1), 0) = 1)
    and (storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)
    and (exists (select 1 from public.conversas c where (c.id)::text = (storage.foldername(objects.name))[1]))
  );

-- 4. Dados iniciais (etapas do funil, configuração, preços), o gatilho que faz da 1ª conta a
-- dona do app, as tabelas do tempo real e o relógio: tudo pela função do próprio banco.
select public.preparar_copia();

-- 5. Preço da voz eleven_v4 (a voz padrão das respostas em áudio).
insert into public.ia_precos (provedor, modelo, vigente_desde, a_partir_de_tokens, por_mil_caracteres, fonte)
select 'elevenlabs', 'eleven_v4', current_date, 0, 0.08, 'https://elevenlabs.io/pricing/api'
where not exists (select 1 from public.ia_precos where provedor = 'elevenlabs' and modelo = 'eleven_v4');

-- 6. Pausa geral da Cami. O botão "Pausar" liga configuracao.pausada; enquanto estiver ligada, a
-- Cami não responde ninguém (e não gasta IA), mas as mensagens continuam chegando no Chat. A função
-- abaixo é a pegar_rodadas de banco/01-estrutura.sql com uma checagem a mais; fica aqui para
-- chegar também nos bancos que já existem (o instalador só reaplica este arquivo).
alter table public.configuracao add column if not exists pausada boolean not null default false;

CREATE OR REPLACE FUNCTION public.pegar_rodadas(p_limite integer) RETURNS SETOF public.rodadas
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_velha  uuid;
  v_ctx    bigint;
  v_prov   public.ia_provedor;
  v_modelo text;
  v_ids    uuid[];
begin
  for v_velha in
    select r.id from public.rodadas r
    where r.status = 'rodando' and r.iniciada_em < now() - interval '5 minutes'
    order by r.iniciada_em
    for update skip locked
  loop
    perform public.falhar_rodada(v_velha, 'erro_provedor', true);
  end loop;

  -- novo
  if not exists (select 1 from public.configuracao cf
                 where cf.id = 1 and cf.onboarding_concluido_em is not null) then
    return;
  end if;

  -- pausa geral (botão "Pausar" do app): a Cami não responde e a fila do período é
  -- descartada, então ao religar ela não responde mensagens antigas. As mensagens continuam
  -- chegando e aparecem no Chat para a equipe.
  if exists (select 1 from public.configuracao cf where cf.id = 1 and cf.pausada) then
    update public.conversas c set responder_apos = null where c.responder_apos is not null;
    return;
  end if;

  select max(cv.id) into v_ctx from public.contexto_versoes cv;
  select k.provedor, k.modelo into v_prov, v_modelo
  from public.ia_chaves k where k.finalidade = 'resposta';

  -- instrucao unica: trava (SKIP LOCKED), limpa responder_apos e cria a rodada
  with alvo as (
    select c.id
    from public.conversas c
    where c.responder_apos <= now()
      and c.modo = 'janete'
      and not exists (select 1 from public.rodadas r
                      where r.conversa_id = c.id and r.status = 'rodando')
      and not exists (select 1 from public.mensagens m
                      where m.conversa_id = c.id and m.direcao = 'entrada'
                        and m.midia_status = 'pendente'
                        and m.criado_em > now() - interval '2 minutes')
      and exists (select 1 from public.conexoes cx
                  where cx.ativa
                    and (not cx.oficial
                         or (c.ultima_do_lead_em is not null
                             and c.ultima_do_lead_em + interval '24 hours' > now())))
    order by c.responder_apos, c.id
    limit greatest(coalesce(p_limite, 0), 0)
    for update of c skip locked
  ), limpa as (
    update public.conversas c
       set responder_apos = null
      from alvo a
     where c.id = a.id
    returning c.id
  ), nova as (
    insert into public.rodadas (conversa_id, status, contexto_versao_id, provedor, modelo,
                                passos, tentativa, passou_humano, iniciada_em)
    select l.id, 'rodando', v_ctx, v_prov, v_modelo, 0,
           1 + (select count(*) from public.rodadas f
                where f.conversa_id = l.id and f.status = 'falhou'
                  and f.criado_em > greatest(
                        coalesce((select max(k.criado_em) from public.rodadas k
                                  where k.conversa_id = l.id and k.status = 'concluida'),
                                 '-infinity'::timestamptz),
                        coalesce((select cv.devolvida_em from public.conversas cv where cv.id = l.id),
                                 '-infinity'::timestamptz))),
           false, now()
    from limpa l
    returning id
  )
  select array_agg(n.id) into v_ids from nova n;

  if v_ids is null then
    return;
  end if;

  -- liga as entradas ainda nao lidas a rodada
  update public.mensagens m
     set rodada_id = r.id
    from public.rodadas r
   where r.id = any (v_ids)
     and m.conversa_id = r.conversa_id
     and m.direcao = 'entrada'
     and m.rodada_id is null;

  return query
    select r.* from public.rodadas r where r.id = any (v_ids) order by r.criado_em, r.id;
end;
$$;
