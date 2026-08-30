# Cairo Special Bikes Pipeline de Dados

Pipeline de ETL (Extract, Transform, Load) desenvolvido para uma loja de consignaÃ§Ã£o de bicicletas, automatizando a sincronizaÃ§Ã£o de dados operacionais de uma planilha do Google Sheets para um banco de dados PostgreSQL na nuvem (Supabase), servindo de base para dashboards em Power BI.

> ðŸ’¡ Projeto de consultoria de dados real, desenvolvido para a Cairo Special Bikes (UberlÃ¢ndia, MG). Este repositÃ³rio contÃ©m apenas o cÃ³digo do pipeline â€” nenhum dado de clientes ou credencial estÃ¡ versionado aqui.

## Sobre

A loja registrava suas operaÃ§Ãµes (consignaÃ§Ãµes de bicicletas e componentes, cadastro de proprietÃ¡rios, resumo mensal de vendas) manualmente em planilhas do Google Sheets. Este pipeline automatiza a extraÃ§Ã£o, limpeza e carga desses dados em um banco relacional, eliminando o retrabalho manual e viabilizando anÃ¡lises consistentes em Power BI.

## Arquitetura

```
Google Sheets  â†’  Extract  â†’  Transform  â†’  Load  â†’  Supabase (PostgreSQL)  â†’  Power BI
                 (gspread)   (pandas)     (REST API)
```

O pipeline roda automaticamente a cada 2 horas via **GitHub Actions**, mantendo o banco sempre sincronizado com a planilha sem intervenÃ§Ã£o manual.

## Estrutura

```
pipeline/
â”œâ”€â”€ extract.py     â†’ lÃª as 5 abas da planilha (Google Sheets API)
â”œâ”€â”€ transform.py   â†’ limpa, valida e padroniza os dados
â”œâ”€â”€ load.py        â†’ envia os dados para o Supabase via REST API (upsert)
â””â”€â”€ main.py         â†’ orquestra as 3 etapas do pipeline

.github/workflows/
â””â”€â”€ sync.yml         â†’ agenda a execuÃ§Ã£o automÃ¡tica (cron a cada 2h)
```

## O que o pipeline faz

**Extract** (`extract.py`)
Conecta Ã  planilha do Google Sheets via API (`gspread`) e lÃª as 5 abas: ConsignaÃ§Ãµes, ProprietÃ¡rios, Bicicletas, Componentes e Resumo Mensal.

**Transform** (`transform.py`)
- Padroniza valores de status (ex: variaÃ§Ãµes de "vendido" e "em estoque" viram um valor Ãºnico)
- Converte e valida datas, descartando datas inconsistentes
- Normaliza valores monetÃ¡rios em diferentes formatos (`R$ 1.234,56`, `1234.56`, etc.) para `float`
- Valida integridade referencial: descarta consignaÃ§Ãµes que apontam para bicicletas ou componentes inexistentes
- Reporta no console quantos registros foram validados ou descartados em cada tabela

**Load** (`load.py`)
Envia os dados tratados para o Supabase via REST API, usando `upsert` (insere ou atualiza sem duplicar) em lotes de 100 registros por requisiÃ§Ã£o.

## Dashboard

Os dados carregados no Supabase alimentam um dashboard em Power BI com 4 pÃ¡ginas: visÃ£o geral, financeiro, estoque e segmentaÃ§Ã£o de produtos.

> *Nomes de clientes ocultados por privacidade. Capturas de tela ilustrativas de um dos dashboards produzidos no projeto.*

**VisÃ£o Geral**
![VisÃ£o Geral](docs/Visao_Geral.png)

**Acompanhamento Financeiro**
![Financeiro](docs/Financeiro.png)

**Controle de Estoque**
![Estoque](docs/Estoque.png)

**SegmentaÃ§Ã£o de Bikes e Componentes**
![SegmentaÃ§Ã£o](docs/Segmentacao_Produtos.png)

## Estrutura dos dados

Uma planilha de exemplo com a mesma arquitetura de dados estÃ¡ disponÃ­vel em [`docs/dados_exemplo.xlsx`](docs/dados_exemplo.xlsx) â€” nomes de clientes e valores foram anonimizados/embaralhados, mantendo a estrutura de tabelas e relacionamentos.

> A aba "Resumo Mensal" (indicadores financeiros consolidados da loja) nÃ£o foi incluÃ­da, por conter informaÃ§Ãµes sensÃ­veis do negÃ³cio.

As tabelas principais sÃ£o:

- **ProprietÃ¡rios** â€” cadastro de clientes consignantes
- **Bicicletas** / **Componentes** â€” itens em consignaÃ§Ã£o (marca, modelo, categoria, status)
- **ConsignaÃ§Ãµes** â€” tabela central, ligando cliente + item + valor + status (vendido, em estoque, retirado)

## Banco de Dados e Consultas

O modelo de dados relacional foi desenhado para suportar as anÃ¡lises e dashboards do projeto.

![Diagrama do Banco de Dados](docs/diagrama_banco.png)

AlÃ©m do pipeline, o projeto conta com um arquivo de consultas SQL (`consultas.sql`) na raiz do repositÃ³rio. Esse arquivo contÃ©m *queries* Ãºteis para extraÃ§Ã£o rÃ¡pida de informaÃ§Ãµes diretamente do banco de dados (Supabase/PostgreSQL), tais como:

- Buscas especÃ­ficas (por nome de cliente, bicicleta, componente ou ID)
- AnÃ¡lises de clientes (clientes com mais consignaÃ§Ãµes, maiores valores)
- Consultas de estoque (itens disponÃ­veis, tempo em estoque)
- MÃ©tricas financeiras e de ticket mÃ©dio (por categoria, marca, ano, receita mensal)

Essas *queries* servem de base para validaÃ§Ã£o dos dados e criaÃ§Ã£o de mÃ©tricas avanÃ§adas.

## AutomaÃ§Ã£o

O arquivo `.github/workflows/sync.yml` configura uma **GitHub Action** que executa o pipeline automaticamente a cada 2 horas (`cron: '0 */2 * * *'`), alÃ©m de permitir disparo manual. As credenciais (chaves do Supabase, credenciais do Google e ID da planilha) ficam armazenadas como *Secrets* do GitHub, nunca expostas no cÃ³digo.

## SeguranÃ§a

- Credenciais nunca sÃ£o commitadas: uso de variÃ¡veis de ambiente (`.env`, ignorado via `.gitignore`) em desenvolvimento local e *GitHub Secrets* em produÃ§Ã£o
- Nenhum dado de cliente estÃ¡ presente neste repositÃ³rio â€” apenas o cÃ³digo do pipeline

## Tecnologias

- **Python** â€” pandas, gspread, google-auth, requests
- **Google Sheets API** â€” fonte de dados operacional
- **Supabase (PostgreSQL)** â€” banco de dados na nuvem
- **GitHub Actions** â€” orquestraÃ§Ã£o e agendamento automÃ¡tico
- **Power BI** â€” camada de visualizaÃ§Ã£o (dashboards consumindo o Supabase)

---

ðŸ“« Encontre meus outros projetos de dados em [github.com/pedrinvazzz-code](https://github.com/pedrinvazzz-code)

## Atualizações Recentes (Polimento do Dashboard)

Em alinhamento desde a estruturação dos dados, o dashboard passou por um polimento focado em uma **visão temporal mais precisa**, concentrando a análise financeira e de giro de estoque na fase atual do projeto (últimos meses de operação real). As principais melhorias incluíram:

- **Fonte Única de Verdade:** Substituição da antiga rotina manual de 'Resumo Mensal' por agregações dinâmicas em SQL (via consultas.sql) conectadas diretamente à tabela de consignacoes. Isso garantiu 100% de integridade entre o faturamento e as entradas de estoque.
- **Tratamento Inteligente de Datas:** Ajuste nas fórmulas DAX para lidar com lacunas de preenchimento e erros de digitação do usuário final. O cálculo de *Dias em Estoque* e *Tempo Médio de Giro* agora utiliza inteligência de fallback (mesclando a data_entrada com a created_at gerada pelo banco) para calcular o giro perfeitamente, isolando anomalias.
- **Contexto de Filtro Aprimorado:** Refinamento dos indicadores financeiros (Receita, Ticket Médio e Metas) para contabilizarem estritamente as movimentações com status 'Vendido', além da padronização dos visuais para refletirem lacunas mensais de faturamento com precisão (evitando falsas linhas contínuas).
