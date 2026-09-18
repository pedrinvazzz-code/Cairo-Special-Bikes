# Cairo Special Bikes — Pipeline de Dados

Pipeline de ETL (Extract, Transform, Load) desenvolvido para uma loja de consignação de bicicletas, automatizando a sincronização de dados operacionais de uma planilha do Google Sheets para um banco de dados PostgreSQL na nuvem (Supabase), servindo de base para dashboards em Power BI.

> 💡 Projeto de consultoria de dados real, desenvolvido para a Cairo Special Bikes (Uberlândia, MG). Este repositório contém apenas o código do pipeline — nenhum dado de clientes, valor de venda ou credencial está versionado aqui.

## Sobre

A loja registrava suas operações (consignações de bicicletas e componentes, cadastro de proprietários, resumo mensal de vendas) manualmente em planilhas do Google Sheets. Este pipeline automatiza a extração, limpeza e carga desses dados em um banco relacional, eliminando o retrabalho manual e viabilizando análises consistentes em Power BI.

O preenchimento da planilha é feito pela equipe da loja no dia a dia, o que torna a etapa de transformação tão importante quanto a de carga: boa parte do código existe para lidar com variações de digitação, datas incompletas e formatos monetários inconsistentes sem descartar o registro.

## Arquitetura

```
Google Sheets  →  Extract  →  Transform  →  Load  →  Supabase      →  Power BI
                  (gspread)   (pandas)      (REST)   (PostgreSQL)
```

O pipeline roda automaticamente a cada 2 horas via **GitHub Actions**, mantendo o banco sincronizado com a planilha sem intervenção manual.

## Estrutura

```
pipeline/
├── extract.py              → lê as 5 abas da planilha (Google Sheets API)
├── transform.py            → limpa, valida e padroniza os dados
├── load.py                 → envia para o Supabase e remove o que saiu da planilha
├── main.py                 → orquestra as 3 etapas
├── correcoes.csv           → registro de auditoria das correções aplicadas na fonte
└── aplicar_correcoes.py    → aplica as correções na planilha (dry run por padrão)

.github/workflows/
└── sync.yml                → agenda a execução automática (cron a cada 2h)
```

## O que o pipeline faz

**Extract** (`extract.py`)
Conecta à planilha via API (`gspread`) com credencial de conta de serviço em escopo somente-leitura e lê as 5 abas: Consignações, Proprietários, Bicicletas, Componentes e Resumo Mensal. Falha na leitura de uma aba não derruba as outras.

**Transform** (`transform.py`)

- Padroniza status e canal de venda (variações como `on line`, `on-line` e `online` viram um valor único)
- Converte e valida datas, descartando as que caem fora da faixa 2020–2030 e reportando o ID e o campo de origem
- Imputa a data de saída de itens vendidos sem data preenchida (entrada + 15 dias), contabilizando quantos registros foram estimados
- Avisa quando a data de saída é anterior ou igual à de entrada, sem alterar o dado
- Normaliza valores monetários em formatos diferentes (`R$ 1.234,56`, `1,234.56`, `1234.56`) para `float`
- Valida integridade referencial: descarta consignações que apontam para bicicletas ou componentes inexistentes
- Reporta no console quantos registros foram validados, descartados ou estimados em cada tabela

**Load** (`load.py`)
Envia os dados tratados para o Supabase via REST API, em lotes de 100 registros, com `upsert` (insere ou atualiza sem duplicar). Depois da carga, remove do banco os registros que não existem mais na planilha — a planilha é a fonte da verdade, então exclusão lá precisa se refletir aqui. A limpeza roda na ordem inversa das tabelas por causa das chaves estrangeiras e tem uma trava de segurança: acima de 50 exclusões em uma rodada, ela avisa e não apaga, partindo do princípio de que isso indica leitura incompleta da planilha e não exclusão real.

Qualquer lote que falhe interrompe o pipeline com código de saída diferente de zero, para que a execução apareça vermelha no GitHub Actions em vez de passar despercebida.

## Qualidade de dados e auditoria

Como a fonte é preenchida manualmente, o projeto inclui uma etapa de reconciliação entre a planilha operacional e os controles paralelos mantidos pela loja. O cruzamento identificou três classes de divergência, todas legítimas do ponto de vista do negócio:

- **Data de saída** registrada na planilha anterior à data real em que o comprador levou o item
- **Preço de tabela x preço fechado** — a planilha guardava o valor anunciado, não o negociado
- **Itens de balcão e oficina** que circulam fora do fluxo de consignação e, por definição, não entram na planilha

As correções decididas com o cliente ficam versionadas em `pipeline/correcoes.csv`, no formato `id, campo, valor_novo, motivo`, e são aplicadas na planilha por `pipeline/aplicar_correcoes.py`. O script roda em modo de simulação por padrão, mostrando valor atual e valor novo de cada célula, e só grava com a flag `--aplicar`. Como o Google Sheets não versiona histórico, esse par de arquivos é o que permite reconstruir o que mudou na fonte, quando e por quê.

## Dashboard

Os dados carregados no Supabase alimentam um dashboard em Power BI com 4 páginas: visão geral, financeiro, estoque e segmentação de produtos.

> *Nomes de clientes ocultados por privacidade. Capturas de tela ilustrativas de um dos dashboards produzidos no projeto.*

**Visão Geral**
![Visão Geral](docs/Visao_Geral.png)

**Acompanhamento Financeiro**
![Financeiro](docs/Financeiro.png)

**Controle de Estoque**
![Estoque](docs/Estoque.png)

**Segmentação de Bikes e Componentes**
![Segmentação](docs/Segmentacao_Produtos.png)

## Estrutura dos dados

Uma planilha de exemplo com a mesma arquitetura de dados está disponível em [`docs/dados_exemplo.xlsx`](docs/dados_exemplo.xlsx) — nomes de clientes e valores foram anonimizados/embaralhados, mantendo a estrutura de tabelas e relacionamentos.

> A aba "Resumo Mensal" (indicadores financeiros consolidados da loja) não foi incluída, por conter informações sensíveis do negócio.

As tabelas principais são:

- **Proprietários** — cadastro de clientes consignantes
- **Bicicletas** / **Componentes** — itens em consignação (marca, modelo, categoria, status)
- **Consignações** — tabela central, ligando cliente + item + valor + status (vendido, em estoque, retirado)

## Banco de Dados e Consultas

O modelo de dados relacional foi desenhado para suportar as análises e dashboards do projeto.

![Diagrama do Banco de Dados](docs/diagrama_banco.png)

Além do pipeline, o projeto conta com um arquivo de consultas SQL (`consultas.sql`) na raiz do repositório, com *queries* úteis para extração rápida de informações direto do banco:

- Buscas específicas (por nome de cliente, bicicleta, componente ou ID)
- Análises de clientes (clientes com mais consignações, maiores valores)
- Consultas de estoque (itens disponíveis, tempo em estoque)
- Métricas financeiras e de ticket médio (por categoria, marca, ano, receita mensal)

Essas *queries* servem de base para validação dos dados e criação de métricas avançadas.

## Automação

O arquivo `.github/workflows/sync.yml` configura uma **GitHub Action** que executa o pipeline a cada 2 horas (`cron: '0 */2 * * *'`), além de permitir disparo manual. As credenciais (chaves do Supabase, credenciais do Google e ID da planilha) ficam armazenadas como *Secrets* do GitHub, nunca expostas no código.

## Segurança

- Credenciais nunca são commitadas: variáveis de ambiente (`.env`, ignorado via `.gitignore`) em desenvolvimento local e *GitHub Secrets* em produção
- A conta de serviço usada pelo pipeline tem escopo somente-leitura sobre a planilha
- Nenhum dado de cliente ou valor de venda está presente neste repositório — apenas o código

## Tecnologias

- **Python** — pandas, gspread, google-auth, requests
- **Google Sheets API** — fonte de dados operacional
- **Supabase (PostgreSQL)** — banco de dados na nuvem
- **GitHub Actions** — orquestração e agendamento automático
- **Power BI** — camada de visualização (dashboards consumindo o Supabase)

---

## Histórico de versões

### v2.0 — setembro/2026 · Auditoria da fonte e correção da carga

Rodada de reconciliação entre a planilha e os controles paralelos da loja, seguida da correção de uma falha silenciosa na etapa de carga.

- A carga era `upsert` puro, então registro apagado na planilha permanecia no banco indefinidamente. O `load.py` passou a remover o que saiu da fonte, com trava de segurança contra exclusão em massa causada por leitura incompleta.
- Uma chave primária repetida na planilha fazia o PostgreSQL recusar o lote inteiro (`ON CONFLICT DO UPDATE` não pode afetar a mesma linha duas vezes). Como o erro só era impresso e o processo seguia com código de saída zero, as execuções apareciam verdes enquanto os registros mais recentes nunca chegavam ao banco. O `upsert` passou a deduplicar por chave antes de enviar, e falha de lote agora interrompe o pipeline.
- Proteção para a aba Resumo Mensal vazia, que antes derrubava a execução inteira.
- Inclusão de `correcoes.csv` e `aplicar_correcoes.py` como registro auditável das correções aplicadas na fonte.

### v1.4 — setembro/2026 · Tratamento de lacunas de preenchimento

- Padronização do canal de venda (`física`, `online`, `on line`, `on-line`, `retirada`)
- Imputação da data de saída em itens vendidos sem data (entrada + 15 dias), com contagem no resumo da execução
- Avisos de data fora da faixa e de saída anterior à entrada, identificando ID e campo

### v1.3 — setembro/2026 · Robustez na leitura da planilha

- Faixa de datas válidas ampliada para 2020–2030, substituindo o corte fixo por ano
- Limpeza de espaços em branco nos cabeçalhos das abas
- Busca flexível da coluna de valor, tolerando variações no nome do cabeçalho

### v1.2 — agosto/2026 · Correção do corte de datas

- Remoção da trava que descartava qualquer data posterior a abril de 2026, o que vinha apagando entradas recentes de estoque

### v1.1 — agosto/2026 · Camada de consulta e documentação

- `consultas.sql` com queries de negócio, estoque e métricas financeiras
- Diagrama do modelo relacional
- Licença MIT

### v1.0 — abril/2026 · Pipeline inicial

- Extração das 5 abas da planilha via Google Sheets API
- Transformação com padronização de status, datas e valores monetários, e validação de integridade referencial
- Carga no Supabase via REST API em lotes
- Agendamento automático no GitHub Actions a cada 2 horas

---

📫 Encontre meus outros projetos de dados em [github.com/pedrinvazzz-code](https://github.com/pedrinvazzz-code)
