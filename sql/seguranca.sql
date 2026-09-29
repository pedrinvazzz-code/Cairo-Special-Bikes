-- =====================================================================
-- Cairo Special Bikes — fechar o acesso ao banco
--
-- Hoje a única proteção é "ninguém tem a chave". A chave que o pipeline usa
-- é a service_role, que ignora qualquer regra e lê e escreve tudo.
--
-- O problema não é essa chave, que fica no servidor. É a chave `anon`, que
-- por natureza é pública — ela vai embutida em qualquer front-end. Sem RLS
-- ligada, quem tiver a anon lê a base inteira, incluindo o telefone de cada
-- proprietário na tabela `proprietarios`.
--
-- Este script deixa assim:
--
--   service_role  (pipeline, Power BI)   -> tudo, como hoje
--   anon          (qualquer um)          -> SÓ a vitrine pública
--   authenticated (usuário do agente)    -> as views internas, nenhuma tabela
--
-- Os grants e revokes das VIEWS ficam no fim do sql/views.sql, não aqui:
-- recriar uma view devolve o acesso padrão, então quem recria é quem fecha.
-- Este arquivo cuida do que não muda quando as views mudam.
--
-- Rodar no SQL Editor do Supabase, depois do views.sql. É idempotente.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ligar RLS nas tabelas cruas
--
-- Tabela com RLS ligada e SEM policy não devolve nada para anon nem para
-- authenticated. O service_role continua passando por cima, que é o que
-- mantém o pipeline funcionando.
--
-- "Sem policy" é a configuração segura aqui: não existe caso de uso em que
-- alguém de fora deva ler consignação ou proprietário.
-- ---------------------------------------------------------------------
alter table consignacoes   enable row level security;
alter table bicicletas     enable row level security;
alter table componentes    enable row level security;
alter table proprietarios  enable row level security;
alter table resumo_mensal  enable row level security;


-- ---------------------------------------------------------------------
-- 2. Objeto novo nasce fechado
--
-- O Supabase vem configurado para dar acesso a anon e authenticated em tudo
-- que for criado em `public`. Foi assim que a vw_vendas_segmento ficou
-- legível pela chave pública: ficou fora da lista de revoke, e o padrão
-- liberou.
--
-- Com isto, tabela ou view nova não é lida por ninguém de fora até receber
-- um grant explícito. Vale para objetos criados pelo papel que rodar este
-- script (o `postgres`, no SQL Editor).
-- ---------------------------------------------------------------------
alter default privileges in schema public
    revoke all on tables from anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Remover o papel agente_leitura
--
-- Sobrou da primeira versão do agente, que assinava o próprio token com esse
-- papel. Deixou de funcionar quando o projeto migrou para chave assimétrica
-- (ver appsscript/Agente.gs), e o agente passou a entrar como `authenticated`.
-- Papel sem uso, com membership no authenticator, é superfície à toa.
-- ---------------------------------------------------------------------
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
        revoke all on all tables in schema public from agente_leitura;
        revoke usage on schema public from agente_leitura;
        revoke agente_leitura from authenticator;
        begin
            drop role agente_leitura;
        exception when dependent_objects_still_exist then
            -- sobrou algum privilégio fora das tabelas de `public`. O papel
            -- já não loga nem é assumido pelo authenticator, então segue sem
            -- derrubar o resto do script.
            raise notice 'agente_leitura ainda tem dependências, não foi removido: %', sqlerrm;
        end;
    end if;
end
$$;


-- ---------------------------------------------------------------------
-- 4. Conferência
--
-- Rode isto depois. Toda tabela crua tem que aparecer com rls = true.
-- ---------------------------------------------------------------------
select
    c.relname                                    as objeto,
    case c.relkind when 'r' then 'tabela' when 'v' then 'view' end as tipo,
    c.relrowsecurity                             as rls,
    has_table_privilege('anon', c.oid, 'select') as anon_le,
    has_table_privilege('authenticated', c.oid, 'select') as agente_le
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'v')
order by tipo, objeto;

-- Esperado:
--   toda tabela         -> rls = true, anon_le = false, agente_le = false
--   toda vw_ interna    -> anon_le = false, agente_le = true
--   vw_catalogo_publico -> anon_le = true,  agente_le = true
