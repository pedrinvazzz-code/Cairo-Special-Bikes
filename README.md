# Cairo Special Bikes — Plataforma de Dados

Plataforma de dados desenvolvida para uma loja de consignação de bicicletas: pipeline de ETL que sincroniza a planilha operacional com um banco PostgreSQL na nuvem, uma camada de views que concentra as regras de negócio, dashboards em Power BI, um aplicativo de preenchimento que roda no celular da loja e um assistente que responde perguntas sobre o negócio em português.

> 💡 Projeto de consultoria de dados real, desenvolvido para a Cairo Special Bikes (Uberlândia, MG). Este repositório contém apenas o código do pipeline — nenhum dado de clientes, valor de venda ou credencial está versionado aqui.

## Sobre

A loja registrava suas operações (consignações de bicicletas e componentes, cadastro de proprietários, resumo mensal de vendas) manualmente em planilhas do Google Sheets. Este pipeline automatiza a extração, limpeza e carga desses dados em um banco relacional, eliminando o retrabalho manual e viabilizando análises consistentes em Power BI.

O preenchimento da planilha é feito pela equipe da loja no dia a dia, o que torna a etapa de transformação tão importante quanto a de carga: boa parte do código existe para lidar com variações de digitação, datas incompletas e formatos monetários inconsistentes sem descartar o registro.

## Arquitetura

```
                            ┌─→  Power BI  (4 páginas)
Google Sheets               │
      │                     │
      ├→ Extract → Transform → Load → Supabase → Camada de views → Assistente
      │  (gspread) (pandas)   (REST)  (Postgres)  (regras de negócio)
      │
      └← Aplicativo de preenchimento (Apps Script, roda no celular)
```

O pipeline roda automaticamente a cada 2 horas via **GitHub Actions**, mantendo o banco sincronizado com a planilha sem intervenção manual.

A planilha continua sendo o **único ponto de escrita**: tudo o que vem depois é leitura. O aplicativo escreve nela, o pipeline lê dela, e as views e o assistente leem do banco.

## Estrutura

```
pipeline/
├── extract.py              → lê as 5 abas da planilha (Google Sheets API)
├── transform.py            → limpa, valida e padroniza os dados
├── load.py                 → envia para o Supabase e remove o que saiu da planilha
├── verificar.py            → confere a carga e falha alto em divergência
├── test_transform.py       → testes dos parsers com os formatos que já quebraram a base
├── main.py                 → orquestra as etapas
├── correcoes.csv           → registro de auditoria das correções aplicadas na fonte
├── normalizacoes.csv       → registro das normalizações de domínio
├── aplicar_correcoes.py    → aplica as correções na planilha (dry run por padrão)
├── normalizar_dominios.py  → padroniza as colunas categóricas antes da lista suspensa
├── sincronizar_status.py   → alinha o status do item entre as abas
└── comparar_meses.py       → reconcilia a planilha com o controle paralelo da loja

sql/
├── views.sql               → a camada semântica: 7 views com as regras de negócio
└── seguranca.sql           → RLS, revogações e o papel de leitura do assistente

appsscript/
├── Codigo.gs               → ID automático e sincronismo de status na planilha
├── Formulario.gs           → servidor do formulário de entrada e saída
├── Formulario.html         → a interface, feita para o celular
└── Agente.gs               → o assistente e suas ferramentas

demo/
└── gerar_dados_demo.py     → gera a base fictícia usada nas capturas deste README

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

## A camada de views

Sete views no Supabase (`sql/views.sql`) concentram as definições que antes viviam espalhadas pelo código, pelas medidas do Power BI e pelos relatórios. Power BI e assistente passaram a ler delas.

A necessidade apareceu de um defeito concreto: a regra de comissão da loja estava escrita em quatro lugares diferentes. Três concordavam; um não — as medidas que repartem a comissão por faixa não tinham filtro de período e somavam o histórico inteiro, enquanto o resto da página respeitava a janela. O total fechava e só a repartição estava errada, que é o tipo de defeito que passa despercebido em revisão.

As principais:

- **`vw_vendas`** — vendas com faixa e comissão já aplicadas, e uma coluna `confiavel` que marca se aquele período tem data de saída em que se possa confiar
- **`vw_giro`** — dias entre entrada e saída, restrito aos itens em que **as duas datas são registro corrente**; é o recorte em que o giro é mensurável
- **`vw_estoque_parado`** — estoque com idade e faixa de tempo parado. `dias_em_loja` fica nulo quando a data de entrada nunca foi registrada, em vez de estimada
- **`vw_catalogo_publico`** — a vitrine, sem proprietário, sem contato e sem dias parados. A proteção não é um filtro que se possa esquecer de aplicar: as colunas não existem

Completam a camada `vw_receita_mensal`, `vw_proprietarios` e `vw_vendas_segmento`.

## O aplicativo de preenchimento

Cadastrar uma bicicleta exigia mexer em três abas da planilha — criar o proprietário, criar o item, criar a consignação — e digitar dois IDs à mão. Fechar uma venda exigia mudar o status em dois lugares, e em setembro de 2026 havia 34 itens de 589 com as duas versões divergentes.

O aplicativo (`appsscript/`) resolve isso em uma tela só, aberta no navegador do celular:

- IDs gerados automaticamente nas quatro abas
- Proprietário escolhido de uma lista, com opção de cadastrar novo — o que elimina a duplicação por variação de grafia
- Venda e retirada como movimentos **separados**; em retirada, o campo de canal nem aparece
- Trava contra preenchimento simultâneo e recusa de fechar item que já saiu

É publicado como app da Web do Apps Script, executando **na conta de quem acessa**: o controle de acesso passa a ser o próprio compartilhamento da planilha, e não uma lista de e-mails mantida no código.

## O assistente

Dentro do mesmo aplicativo, uma aba responde perguntas em português: quanto se vendeu num mês, o que está parado há mais tempo, qual categoria mais sai.

O modelo **não escreve SQL**. Recebe sete ferramentas, cada uma uma consulta fixa sobre uma view, e escolhe qual usar. A razão é direta: escrevendo consulta do zero, ele decidiria sozinho o que o projeto levou meses fechando — calcularia giro pela média em vez da mediana, contaria item retirado como receita, leria um mês anterior ao corte de confiabilidade como se fosse normal. A regra certa não está na pergunta, está no histórico do projeto.

As ferramentas devolvem a conta pronta, não a lista de linhas. Na primeira versão, a de estoque devolvia os registros e o modelo contava — usou `> 90 dias` onde a regra é `>= 90`. O erro não foi dele: foi da definição do limite ter escapado do banco.

O provedor do modelo é trocável em uma linha, e a configuração de teste (`testarConfiguracao`) calcula o gabarito chamando as próprias ferramentas, em vez de comparar com números fixos que envelheceriam.

## Qualidade de dados e auditoria

### A janela de análise confiável

Consolidar as doze planilhas exigiu decidir o que fazer com registro sem data utilizável, e havia muito: 109 consignações carregavam a data de criação do arquivo original em vez da data real de entrada, e 250 tinham saída anterior ou igual à entrada.

Apagar esses registros descartaria o histórico da loja. O critério adotado, e documentado na época, foi estimar:

- entradas concentradas na data de criação do arquivo, **redistribuídas** ao longo dos meses correspondentes
- saídas inconsistentes, **ajustadas para o último dia do mês** quando o mês era conhecido
- saídas sem mês confiável, **zeradas** para confirmação posterior com o cliente

A decisão manteve a base utilizável, e deixou um rastro previsível: a data estimada cai em borda de mês. Meses depois, quantificar esse rastro virou o teste mais revelador da auditoria — distribuir a receita pelo **dia do mês** mostra dois terços de toda a receita histórica no dia 1, 30 ou 31.

O corte é nítido: até março de 2026, entre 63% e 100% da receita de cada mês cai em borda; de abril em diante, entre 0% e 29%, e cada caso remanescente tem confirmação documental — é a partir dali que a data passou a ser registrada no momento da venda.

**A consequência foi assumida na entrega:** faturamento mensal, giro e sazonalidade anteriores a abril de 2026 descrevem o método de estimativa, não o comportamento de venda. A análise recortou a janela e explicou isso ao cliente, e a regra virou a coluna `confiavel` no banco — assim o aviso viaja junto com o número, em vez de depender de alguém lembrar.

### Reconciliação com os controles paralelos

A loja mantinha, além da planilha, um controle local em Excel. O cruzamento item a item identificou classes de divergência que são legítimas do ponto de vista do negócio, e distingui-las importa: misturar "diferença" com "problema" infla a percepção de caos e faz o cliente desconfiar de tudo.

- **Fronteira de mês** — o mesmo item lançado em meses diferentes nos dois controles. Não é dinheiro sumido: é deslocamento, e o total do período não muda
- **Preço de tabela x preço fechado** — um controle guardava o valor anunciado, o outro o negociado
- **Aba defasada** — o arquivo local foi salvo antes de a venda acontecer
- **Publicação não retirada** — o site mantinha como disponível um item que já tinha saído
- **Artefato de migração** — datas de borda herdadas da consolidação
- **Itens de balcão e oficina**, que circulam fora do fluxo de consignação e, por definição, não entram na planilha
- **Nunca cadastrado** — a única classe em que há, de fato, dado faltando

As correções decididas com o cliente ficam versionadas em `pipeline/correcoes.csv`, no formato `id, campo, valor_novo, motivo`, e são aplicadas na planilha por `pipeline/aplicar_correcoes.py`. O script roda em modo de simulação por padrão, mostrando valor atual e valor novo de cada célula, e só grava com a flag `--aplicar`. Como o Google Sheets não versiona histórico, esse par de arquivos é o que permite reconstruir o que mudou na fonte, quando e por quê.

## Dashboard

Os dados carregados no Supabase alimentam um dashboard em Power BI com 4 páginas: visão geral, financeiro, estoque e segmentação de produtos.

> *Os números e nomes abaixo são fictícios.* As capturas vêm de um dashboard de demonstração ligado a uma base gerada por `demo/gerar_dados_demo.py`, que preserva a estrutura real — contagens, distribuições e datas — e substitui nomes, contatos e valores. Os parâmetros dessa substituição não são versionados, e o script recusa rodar sem eles: publicados, tornariam a anonimização reversível.

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

O arquivo `.github/workflows/sync.yml` configura uma **GitHub Action** que executa o pipeline a cada 2 horas (`cron: '0 */2 * * *'`), além de permitir disparo manual. As credenciais ficam armazenadas como *Secrets* do GitHub, nunca expostas no código.

Antes do pipeline, o workflow roda `test_transform.py`, que exercita os parsers com os formatos reais que já quebraram a base. Depois da carga, `verificar.py` confere se a contagem no banco bate com a planilha e se não há venda sem valor ou sem data, falhando alto em qualquer divergência.

O motivo dessas duas camadas: o pipeline chegou a acumular **1.236 execuções verdes** gravando um valor mil vezes errado — um parser que dividia números em formato pt-BR por mil, numa coluna que misturava dois formatos. Execução verde não é prova de dado certo.

## Segurança

**No repositório**

- Credenciais nunca são commitadas: variáveis de ambiente (`.env`, ignorado via `.gitignore`) em desenvolvimento local e *GitHub Secrets* em produção
- A conta de serviço usada pelo pipeline tem escopo somente-leitura sobre a planilha
- Nenhum dado de cliente ou valor de venda está presente aqui — apenas o código e uma base de demonstração fictícia

**No banco** (`sql/seguranca.sql`)

- **RLS ligada em todas as tabelas, sem policy.** É a configuração segura neste caso: não existe cenário em que alguém de fora deva ler consignação ou proprietário
- **Revogação explícita nas views internas.** Esse passo costuma ser esquecido: view em Postgres roda com a permissão de quem a criou, então ligar RLS na tabela **não** protege a view. Sem o revoke, a view de proprietários seria uma porta dos fundos para a tabela protegida
- **Papel dedicado para o assistente**, com `SELECT` nas views e em nenhuma tabela. Se o código tiver um defeito, ou se alguém escrever um comando disfarçado num campo de observação da planilha, o limite é o que o banco permite àquele papel

## Tecnologias

- **Python** — pandas, gspread, google-auth, requests
- **Google Sheets API** — fonte de dados operacional
- **Supabase (PostgreSQL)** — banco de dados na nuvem, com RLS e views
- **Power BI** — camada de visualização, com o modelo lendo das views (DAX, TMDL)
- **Google Apps Script** — aplicativo de preenchimento e assistente
- **GitHub Actions** — orquestração e agendamento automático
- **API da Anthropic / NVIDIA NIM** — modelo do assistente, trocável por configuração

---

## Histórico de versões

### v3.0 — setembro/2026 · Camada semântica, aplicativo e assistente

- **Sete views** concentrando as regras de negócio, e o Power BI reescrito para ler delas. Motivadas por um defeito em que a mesma regra existia em quatro lugares e um deles divergia
- **Segurança do banco**: RLS em todas as tabelas, revogação das views internas, papel dedicado para o assistente e uma view pública sem colunas sensíveis
- **Aplicativo de preenchimento** em Apps Script, com ID automático, sincronismo de status e domínio fechado nas colunas categóricas
- **Assistente de dados** com ferramentas parametrizadas sobre as views, em vez de consulta livre
- **Normalização da fonte**: 63 células corrigidas com trilha de auditoria, incluindo 34 itens cujo status divergia entre abas
- Base fictícia para a demonstração pública dos dashboards

### v2.1 — setembro/2026 · Testes e verificação pós-carga

- Testes dos parsers com os formatos reais que quebraram a base, rodando antes do pipeline
- Verificação pós-carga que falha alto em divergência de contagem, valor implausível ou venda incompleta
- Leitura de cabeçalho por nome em vez de posição, e autenticação centralizada

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
