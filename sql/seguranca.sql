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
--   authenticated (usuário logado)       -> nada, por enquanto
--
-- Rodar no SQL Editor do Supabase. É idempotente.
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
-- 2. Tirar o acesso das views internas
--
-- View em Postgres roda, por padrão, com a permissão de quem a criou — e não
-- de quem consulta. Ou seja: a RLS do passo 1 NÃO protege a view sozinha.
-- Uma view interna acessível por anon seria um buraco pela porta dos fundos.
--
-- Por isso o revoke é explícito, e não uma consequência do passo anterior.
-- ---------------------------------------------------------------------
revoke all on vw_vendas          from anon, authenticated;
revoke all on vw_receita_mensal  from anon, authenticated;
revoke all on vw_giro            from anon, authenticated;
revoke all on vw_estoque_parado  from anon, authenticated;
revoke all on vw_proprietarios   from anon, authenticated;
revoke all on vw_estoque_atual   from anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Liberar só a vitrine
--
-- A vw_catalogo_publico não tem proprietário, não tem contato e não tem dias
-- em loja. Mesmo que a chave anon vaze, o que se alcança é o que já está
-- publicado no site da loja.
--
-- Ela roda com a permissão do dono (o padrão), então enxerga a tabela crua
-- apesar da RLS. Isso aqui é intencional: é o mecanismo que permite expor um
-- recorte seguro sem abrir a tabela.
-- ---------------------------------------------------------------------
grant select on vw_catalogo_publico to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Conferência
--
-- Rode isto depois. Toda tabela crua tem que aparecer com rls = true.
-- ---------------------------------------------------------------------
select
    c.relname                                    as objeto,
    case c.relkind when 'r' then 'tabela' when 'v' then 'view' end as tipo,
    c.relrowsecurity                             as rls,
    has_table_privilege('anon', c.oid, 'select') as anon_le
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'v')
order by tipo, objeto;

-- Esperado:
--   toda tabela      -> rls = true,  anon_le = false
--   toda vw_ interna -> anon_le = false
--   vw_catalogo_publico -> anon_le = true
