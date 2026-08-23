--BUSCA NOME CLIENTE

SELECT id_cliente, nome
FROM proprietarios
WHERE nome ILIKE '%gustavo%';

--BUSCA CLIENTE E CONSIGNAÇÃO
SELECT c.id_cliente AS id_cliente, 
    c.proprietario AS Cliente,
    c.id_consignacao AS Id_Consig, 
    c.item_produto AS Consignacao,
    c.valor AS valor
FROM consignacoes AS c
INNER JOIN proprietarios AS p
ON p.id_cliente = c.id_cliente
WHERE c.proprietario ILIKE '%%'
ORDER BY c.id_cliente ASC;

--CLIENTES COM MAIS CONSIGNAÇÕES

SELECT id_cliente, proprietario, COUNT(DISTINCT id_consignacao) AS total_consig
FROM consignacoes
GROUP BY id_cliente, proprietario
ORDER BY total_consig DESC;

--MAIOR VALOR DE CONSIGNAÇÃO
SELECT c.id_consignacao, p.nome, c.item_produto , MAX(c.valor) AS maior_valor
FROM consignacoes AS c
INNER JOIN proprietarios AS p
ON c.id_cliente = p.id_cliente
GROUP BY c.id_consignacao, p.nome, c.item_produto
ORDER BY maior_valor DESC;

--CONSIGNAÇÕES EM ESTOQUE

SELECT id_consignacao,
  id_bike,
  id_componente,
  tipo,
  item_produto,
  proprietario,
  valor
FROM consignacoes
WHERE 1= 1
AND status LIKE 'Em estoque'
AND item_produto LIKE 'agile sport';



--BUSCA BIKE POR NOME

SELECT 
    b.id_bike, 
    b.nome_descricao AS nome, 
    c.proprietario, 
    c.valor
FROM bicicletas b
LEFT JOIN consignacoes c 
    ON b.id_bike = c.id_bike
WHERE b.nome_descricao ILIKE '%agile sport%'
ORDER BY b.id_bike ASC;

--BUSCA BIKE POR ID 
SELECT 
    b.id_bike, 
    b.nome_descricao AS nome, 
    c.proprietario, 
    c.valor
    b.tamanho
FROM bicicletas b
LEFT JOIN consignacoes c 
    ON b.id_bike = c.id_bike
WHERE b.id_bike = 7
ORDER BY b.id_bike ASC; 

--BUSCA BIKE LEFT JOIN 
SELECT 
    b.id_bike, 
    b.nome_descricao AS nome, 
    c.proprietario, 
    c.valor
FROM bicicletas b
LEFT JOIN consignacoes c 
    ON b.id_bike = c.id_bike
WHERE b.nome_descricao ILIKE '%roubaix%'
ORDER BY b.id_bike ASC;

--BUSCA COMPONENTE LEFT JOIN
SELECT 
    'Componente' AS tipo,
    comp.id_componente AS id,
    comp.nome_descricao AS nome,
    c.proprietario,
    c.valor
FROM componentes comp
LEFT JOIN consignacoes c 
    ON comp.id_componente = c.id_componente
WHERE comp.nome_descricao ILIKE '%amira%'
ORDER BY tipo, id ASC;

--MEDIA POR ANO

SELECT AVG(c.valor) AS media_valor
FROM consignacoes AS c
JOIN bicicletas AS b
ON c.id_bike = b.id_bike
WHERE ano = 2018;

--MEDIA POR CATEGORIA

SELECT AVG(c.valor) AS media_valor
FROM consignacoes AS c
JOIN bicicletas AS b
ON c.id_bike = b.id_bike
WHERE categoria  ILIKE '';

--MEDIA POR MARCA

SELECT AVG(c.valor) AS media_valor
FROM consignacoes AS c
JOIN bicicletas AS b
ON b.id_bike = c.id_bike
WHERE marca ILIKE '%felt%';

--MEDIA COMPONENTES POR TIPO

SELECT AVG(c.valor) AS media_preco
FROM consignacoes AS c
JOIN componentes AS cp 
ON cp.id_componente = c.id_componente
WHERE cp.categoria ILIKE '%rodas%'


--TOTAL RECEITA

SELECT SUM(c.valor) AS total_receita
FROM consignacoes AS c
WHERE c.status ILIKE '%Vendido%';


--Total Receita Mensal 

SELECT 
    DATE_TRUNC('month', data_saida) AS mes,
    SUM(valor) AS receita_bruta
FROM consignacoes
WHERE LOWER(status) = '%Vendido%'
  AND data_saida IS NOT NULL
GROUP BY mes
ORDER BY mes;


--Media Receita Mensal

SELECT 
    DATE_TRUNC('month', data_saida) AS mes,
    AVG(valor) AS media_receita
FROM consignacoes
WHERE LOWER(status) = '%Vendido%'
  AND data_saida IS NOT NULL
GROUP BY mes
ORDER BY mes;


SELECT 
    id_consignacao,
    item_produto,
    proprietario,
    valor,
    data_entrada,
    data_saida
FROM consignacoes
WHERE LOWER(status) = 'vendido'
  AND DATE_TRUNC('month', data_saida) = '2026-07-01'
ORDER BY id_consignacao;


SELECT 
    item_produto,
    data_entrada,
    data_saida,
    status,
    CURRENT_DATE - data_entrada::date AS dias_em_estoque
FROM consignacoes
WHERE status = 'Em estoque'
  AND data_entrada IS NOT NULL
ORDER BY dias_em_estoque DESC
LIMIT 10;

--Media ticket mensal

SELECT 
    TO_CHAR(data_entrada, 'YYYY-MM') AS mes,
    ROUND(AVG(valor), 2) AS ticket_medio,
    COUNT(*) AS total_consignações
FROM consignacoes
WHERE tipo = 'Bicicleta'
  AND ativo = TRUE
  AND data_entrada IS NOT NULL
GROUP BY TO_CHAR(data_entrada, 'YYYY-MM')
ORDER BY mes;
