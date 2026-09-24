-- =====================================================================
-- Cairo Special Bikes — camada semântica
--
-- Cada regra de negócio é escrita UMA vez, aqui. Power BI e agente leem
-- destas views e param de reimplementar cálculo.
--
-- A regra de comissão vivia em quatro lugares (transform.py, três medidas
-- DAX e o texto do relatório). Três concordavam, uma não, e o painel passou
-- meses mostrando a repartição por faixa errada. É esse problema que esta
-- camada existe para não deixar acontecer de novo.
--
-- Rodar inteiro no SQL Editor do Supabase. É idempotente.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. vw_vendas — uma linha por venda, com faixa e comissão já aplicadas
--
-- Filtrar por status é obrigatório: somar tudo que tem data de saída
-- inclui item RETIRADO e infla o mês.
--
-- `confiavel` carrega a regra de abril/2026. Antes desse corte, 67% da
-- receita cai em dia 1, 30 ou 31 — são datas-marcador preenchidas em lote
-- na migração das 12 planilhas antigas, não venda real. A coluna existe
-- para que ninguém leia uma curva mensal antiga sem saber disso.
-- ---------------------------------------------------------------------
drop view if exists vw_vendas cascade;
create view vw_vendas as
select
    c.id_consignacao,
    c.id_bike,
    c.id_componente,
    c.item_produto,
    c.tipo,
    c.proprietario,
    c.valor,
    c.data_entrada,
    c.data_saida,
    date_trunc('month', c.data_saida)::date            as mes,
    case
        when c.valor >  30000 then '8%'
        when c.valor >= 10000 then '10%'
        else                       '12%'
    end                                                as faixa,
    c.valor * case
        when c.valor >  30000 then 0.08
        when c.valor >= 10000 then 0.10
        else                       0.12
    end                                                as comissao,
    (c.data_saida >= date '2026-04-01')                as confiavel
from consignacoes c
where c.status = 'Vendido'
  and c.data_saida is not null
  and c.valor is not null;

comment on view vw_vendas is
  'Vendas com faixa e comissao aplicadas. confiavel=false para saida anterior a abr/2026, quando a data e marcador de migracao e nao venda real.';


-- ---------------------------------------------------------------------
-- 2. vw_receita_mensal — uma linha por mês
-- ---------------------------------------------------------------------
drop view if exists vw_receita_mensal cascade;
create view vw_receita_mensal as
select
    mes,
    count(*)                                           as vendas,
    sum(valor)                                         as receita,
    sum(comissao)                                      as comissao,
    round(avg(valor), 2)                               as ticket_medio,
    percentile_cont(0.5) within group (order by valor) as ticket_mediano,
    bool_and(confiavel)                                as confiavel
from vw_vendas
group by mes;

comment on view vw_receita_mensal is
  'Receita, comissao e ticket por mes de saida. Ler a coluna confiavel antes de usar qualquer mes anterior a abr/2026.';


-- ---------------------------------------------------------------------
-- 3. vw_giro — dias entre entrada e saída, só da coorte mensurável
--
-- Usar MEDIANA, nunca média. A média mistura duas populações: item captado
-- na janela (mediana 14 dias) e estoque antigo que finalmente saiu (média
-- 187 dias). A média dá 59,8 dias e não descreve nem um nem outro.
--
-- Só entra item cuja ENTRADA também caiu na janela: é o único recorte em
-- que as duas datas são registro corrente. Em item anterior a maio/2026 a
-- data de entrada veio da consolidação, e mediria o arquivo, não a loja.
-- ---------------------------------------------------------------------
drop view if exists vw_giro cascade;
create view vw_giro as
select
    id_consignacao,
    item_produto,
    tipo,
    valor,
    data_entrada,
    data_saida,
    mes,
    (data_saida - data_entrada)                        as dias
from vw_vendas
where data_entrada is not null
  and data_entrada >= date '2026-05-01'
  and data_saida >= data_entrada;

comment on view vw_giro is
  'Coorte mensuravel de giro: entrou E saiu dentro da janela. Agregar com percentile_cont(0.5), nunca com avg.';


-- ---------------------------------------------------------------------
-- 4. vw_estoque_parado — o que está em loja, com idade
--
-- `dias_em_loja` fica nulo quando não há data de entrada registrada.
-- Hoje é o caso de uma bike do estoque: nenhuma fonte registra
-- quando ela chegou. Estimar uma data só para preencher a coluna criaria
-- exatamente o tipo de dado que este projeto passou a auditoria removendo.
-- ---------------------------------------------------------------------
drop view if exists vw_estoque_parado cascade;
create view vw_estoque_parado as
select
    c.id_consignacao,
    c.id_bike,
    c.id_componente,
    c.item_produto,
    c.tipo,
    c.proprietario,
    c.valor,
    c.data_entrada,
    (current_date - c.data_entrada)                    as dias_em_loja,
    case
        when c.data_entrada is null                then 'sem data de entrada'
        when current_date - c.data_entrada > 365   then 'mais de 1 ano'
        when current_date - c.data_entrada > 180   then '6 a 12 meses'
        when current_date - c.data_entrada >  90   then '3 a 6 meses'
        when current_date - c.data_entrada >  30   then '1 a 3 meses'
        else                                            'menos de 1 mes'
    end                                                as faixa_idade,
    (c.data_entrada is not null
     and current_date - c.data_entrada >= 90)          as parado_90d,
    -- mesma regra de faixa da vw_vendas, aplicada ao que ainda nao vendeu:
    -- quanto a loja ganharia se este item saisse pelo valor de hoje.
    c.valor * case
        when c.valor >  30000 then 0.08
        when c.valor >= 10000 then 0.10
        else                       0.12
    end                                                as comissao_se_vender
from consignacoes c
where c.status = 'Em estoque';

comment on view vw_estoque_parado is
  'Estoque atual com idade. dias_em_loja nulo = entrada nao registrada em nenhuma fonte; nao estimar.';


-- ---------------------------------------------------------------------
-- 4b. vw_vendas_segmento — a venda com os atributos da bike junto
--
-- Para responder "o que mais sai", "qual marca vende melhor", "que tamanho
-- gira". A vw_vendas sozinha não serve: marca, categoria, tamanho e material
-- moram na tabela `bicicletas`, que o agente não alcança e nem deve alcançar.
--
-- Componente entra com esses campos nulos: componente não tem tamanho nem
-- material cadastrado nesta base.
-- ---------------------------------------------------------------------
drop view if exists vw_vendas_segmento cascade;
create view vw_vendas_segmento as
select
    v.id_consignacao,
    v.item_produto,
    v.tipo,
    v.valor,
    v.data_saida,
    v.mes,
    v.confiavel,
    b.marca,
    b.modelo,
    b.categoria,
    b.tamanho,
    b.material
from vw_vendas v
left join bicicletas b on b.id_bike = v.id_bike;

comment on view vw_vendas_segmento is
  'Vendas com marca, categoria, tamanho e material da bike. Componentes vem com esses campos nulos.';


-- ---------------------------------------------------------------------
-- 5. vw_proprietarios — receita e volume por dono
--
-- O estoque próprio da casa aparece aqui como se fosse um consignante.
-- São duas operações com economias diferentes: na venda própria a loja fica
-- com a margem inteira, na consignação fica com a comissão. A coluna
-- estoque_proprio existe para permitir separar as duas.
-- ---------------------------------------------------------------------
drop view if exists vw_proprietarios cascade;
create view vw_proprietarios as
select
    v.proprietario,
    count(*)                                           as vendas,
    sum(v.valor)                                       as receita,
    sum(v.comissao)                                    as comissao,
    min(v.data_saida)                                  as primeira_venda,
    max(v.data_saida)                                  as ultima_venda,
    (v.proprietario in ('Estoque Próprio', 'Cairo Special Bikes', 'Cliente 020')) as estoque_proprio
from vw_vendas v
where v.proprietario is not null
  and v.proprietario <> ''
group by v.proprietario;

comment on view vw_proprietarios is
  'Receita por proprietario. estoque_proprio marca a propria loja, que nao e consignacao de terceiro.';


-- ---------------------------------------------------------------------
-- 6. vw_catalogo_publico — o que pode sair da loja
--
-- Esta é a única view que um dia pode ser lida por alguém de fora.
-- Não tem proprietário, não tem contato, não tem dias parados. A proteção
-- não é um filtro que alguém pode esquecer de aplicar: as colunas
-- simplesmente não existem aqui.
-- ---------------------------------------------------------------------
drop view if exists vw_catalogo_publico cascade;
create view vw_catalogo_publico as
select
    c.id_consignacao                                   as ref,
    c.item_produto                                     as item,
    c.tipo,
    b.marca,
    b.modelo,
    b.ano,
    b.categoria,
    b.tamanho,
    b.material,
    c.valor
from consignacoes c
left join bicicletas b on b.id_bike = c.id_bike
where c.status = 'Em estoque'
  and c.valor is not null;

comment on view vw_catalogo_publico is
  'Vitrine. Sem nome de proprietario, sem contato e sem dias em loja, por construcao.';


-- ---------------------------------------------------------------------
-- 7. O usuário do agente
--
-- Só SELECT, e só nas views. Ele não enxerga consignacoes nem proprietarios,
-- que são onde moram nome e telefone de terceiro.
-- ---------------------------------------------------------------------
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'agente_leitura') then
        create role agente_leitura nologin;
    end if;
end
$$;

grant usage on schema public to agente_leitura;

-- Sem isto o PostgREST não consegue assumir o papel: quem atende a requisição
-- é o `authenticator`, e ele só troca para um papel do qual é membro.
grant agente_leitura to authenticator;

grant select on
    vw_vendas,
    vw_receita_mensal,
    vw_giro,
    vw_estoque_parado,
    vw_proprietarios,
    vw_catalogo_publico
to agente_leitura;

-- deliberadamente ausente: grant nas tabelas cruas.
