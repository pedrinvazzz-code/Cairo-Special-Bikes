# Cairo Special Bikes — Plataforma de Dados

Projeto completo de dados para uma loja de consignação de bicicletas: pipeline de ETL, camada semântica em SQL, dashboard em Power BI, aplicativo de preenchimento e um assistente que responde perguntas sobre o negócio em linguagem natural.

> 💡 Projeto de consultoria real, desenvolvido para a Cairo Special Bikes (Uberlândia, MG). Nenhum dado de cliente, valor de venda ou credencial está versionado aqui — os dashboards abaixo rodam sobre uma base fictícia gerada para demonstração.

## Sobre

A loja registrava suas operações — consignações de bicicletas e componentes, cadastro de proprietários, resumo mensal — manualmente em planilhas do Google Sheets, espalhadas em doze arquivos separados. O trabalho começou consolidando isso em uma base única e evoluiu para uma plataforma que vai do preenchimento à resposta.

O preenchimento continua sendo feito pela equipe da loja no dia a dia. Isso define o projeto inteiro: a maior parte do esforço não está em mover dado, e sim em **lidar com o que uma fonte preenchida à mão produz** — variação de digitação, data incompleta, formato monetário inconsistente, registro que existe em um controle e não no outro.

## Arquitetura

```
                        ┌─→  Power BI  (4 páginas)
Google Sheets           │
      │                 │
      ├→ ETL em Python ─┴→ Supabase ──→ Camada de views ──→ Assistente de IA
      │  (a cada 2h)        (Postgres)   (regras de negócio)   (ferramentas, não SQL livre)
      │
      └← App de preenchimento (Apps Script, roda no celular)
```

Quatro camadas, cada uma com uma responsabilidade:

| camada | o que faz |
|---|---|
| **Planilha** | único ponto de escrita. Domínio fechado por lista suspensa |
| **ETL** | extrai, limpa, valida e carrega. Roda sozinho a cada 2 horas |
| **Views** | onde cada regra de negócio é escrita **uma vez só** |
| **Consumo** | Power BI e assistente leem das views, nunca da tabela crua |

## Dashboard

Quatro páginas: visão geral, financeiro, segmentação e estoque.

> **Os números e nomes abaixo são fictícios.** Foram gerados por [`demo/gerar_dados_demo.py`](demo/gerar_dados_demo.py), que preserva a estrutura real (contagens, distribuições, datas) e substitui nomes, contatos e valores. O dashboard de demonstração roda sobre essa base e abre sem precisar de credencial.

**Visão Geral**
![Visão Geral](docs/Visao_Geral.png)

**Acompanhamento Financeiro**
![Financeiro](docs/Financeiro.png)

**Segmentação de Bikes e Componentes**
![Segmentação](docs/Segmentacao_Produtos.png)

**Controle de Estoque**
![Estoque](docs/Estoque.png)

---

## A parte mais interessante: o que os dados escondiam

Antes de entregar qualquer análise, a base passou por auditoria. Dois achados mudaram o escopo do trabalho.

### 67% da receita histórica caía em virada de mês

O teste é barato: distribuir a receita pelo **dia do mês** da data de saída. Venda real não se concentra no dia 1, 30 ou 31 — mas aqui, R$ 3,78 milhões de R$ 5,65 milhões caíam exatamente nesses dias.

Não era fraude nem erro de cálculo: eram **datas-marcador**, preenchidas em lote quando as doze planilhas antigas foram consolidadas. O corte é nítido — até março de 2026, entre 63% e 100% da receita de cada mês cai em borda; de abril em diante, entre 0% e 29%, e cada caso remanescente tem confirmação documental.

**Consequência:** faturamento mensal, giro e sazonalidade anteriores a abril de 2026 são artefato. A análise entregue ao cliente recortou a janela e declarou isso explicitamente, em vez de apresentar uma curva bonita e falsa.

### A mesma regra em quatro lugares, e uma delas errada

A comissão da loja segue faixas: 12% abaixo de R$ 10 mil, 10% entre R$ 10 e 30 mil, 8% acima. Essa regra estava escrita no código do pipeline, em três medidas do Power BI e no texto do relatório.

Três concordavam. Uma não: as medidas que repartem a comissão por faixa **não tinham filtro de período**, então somavam o histórico inteiro enquanto todos os outros indicadores da página respeitavam a janela. O total estava certo — R$ 78.619 — e só a repartição estava errada, o que é exatamente o tipo de defeito que passa despercebido.

Foi esse bug que motivou a camada de views: **a regra passou a existir em um lugar só**, e Power BI e assistente leem dali.

### Reconciliação entre controles paralelos

A loja mantinha, além da planilha, um controle local em Excel. O cruzamento item a item das duas fontes produziu uma taxonomia de divergência — e a distinção entre elas importa, porque misturar "diferença" com "problema" infla a percepção de caos:

| classe | é dado faltando? |
|---|---|
| Fronteira de mês (item lançado em meses diferentes nos dois controles) | não — deslocamento, o total do período não muda |
| Promoção "De/Por" (um controle guarda o preço de tabela, o outro o fechado) | não |
| Aba defasada (o arquivo foi salvo antes da venda acontecer) | não |
| Publicação não retirada (site mantém item vendido como disponível) | não |
| Artefato de migração | não |
| **Nunca cadastrado** | **sim** |

Cada correção decidida com o cliente fica versionada em [`pipeline/correcoes.csv`](pipeline/correcoes.csv), no formato `id, campo, valor_novo, motivo`. Como o Google Sheets não versiona histórico, esse arquivo é o que permite responder "de onde veio esse número" meses depois.

---

## Estrutura

```
pipeline/                      ETL e manutenção da fonte
├── extract.py                 → lê as 5 abas (Google Sheets API)
├── transform.py               → limpa, valida e padroniza
├── load.py                    → carga no Supabase, com trava de deleção
├── verificar.py               → verificação pós-carga que falha alto
├── test_transform.py          → testes dos parsers com os formatos que já quebraram
├── main.py                    → orquestra
├── correcoes.csv              → trilha de auditoria das correções na fonte
├── normalizacoes.csv          → trilha das normalizações de domínio
├── aplicar_correcoes.py       → aplica correções na planilha (dry run por padrão)
├── normalizar_dominios.py     → fecha o domínio das colunas categóricas
├── sincronizar_status.py      → alinha o status entre as abas
└── comparar_meses.py          → reconcilia a planilha com o controle local

sql/
├── views.sql                  → a camada semântica: 7 views
└── seguranca.sql              → RLS, revogações e o papel do assistente

appsscript/                    aplicativo que roda no celular da loja
├── Codigo.gs                  → ID automático e sincronismo de status
├── Formulario.gs              → servidor do formulário de entrada e saída
├── Formulario.html            → a interface
└── Agente.gs                  → o assistente

demo/
└── gerar_dados_demo.py        → gera a base fictícia deste README

.github/workflows/sync.yml     → cron a cada 2h, com os testes antes do pipeline
```

## A camada semântica

Sete views em [`sql/views.sql`](sql/views.sql). Cada uma carrega uma decisão que custou caro para ser tomada:

**`vw_vendas`** — vendas com faixa e comissão já aplicadas. Tem uma coluna `confiavel`, que é a regra de abril de 2026 virando **dado** em vez de comentário perdido num documento. Quem consultar um mês antigo recebe o aviso junto com o número.

**`vw_giro`** — dias entre entrada e saída, restrito à coorte em que **as duas datas são registro corrente**. A média dessa base mistura a operação do dia a dia com peças encalhadas há mais de um ano e não descreve nem uma nem outra; por isso o indicador publicado é a mediana.

**`vw_estoque_parado`** — estoque com idade. `dias_em_loja` vem nulo quando a data de entrada nunca foi registrada, em vez de estimada. Estimar para preencher a coluna criaria exatamente o tipo de dado que a auditoria existe para detectar.

**`vw_catalogo_publico`** — a vitrine. Não tem proprietário, não tem contato, não tem dias parados. A proteção não é um filtro que alguém pode esquecer de aplicar: **as colunas não existem**.

Mais `vw_receita_mensal`, `vw_proprietarios` e `vw_vendas_segmento`.

## O aplicativo de preenchimento

Cadastrar uma bike exigia mexer em três abas e digitar dois IDs à mão. Fechar uma venda exigia mudar o status em dois lugares — e em setembro de 2026, 34 itens de 589 estavam com as duas versões divergentes.

O app resolve numa tela só, e roda no navegador do celular:

- IDs gerados automaticamente nas quatro abas
- Proprietário escolhido de uma lista, com opção de cadastrar novo — o que mata a duplicação por grafia
- "Vendeu" e "o dono retirou" são movimentos **separados**, e em retirada o campo de canal nem aparece. Foi digitar `retirada` na coluna do canal que produziu seis registros com o movimento no lugar errado
- Trava de concorrência e recusa de fechar item que já saiu

Roda como app da Web do Apps Script, executando **na conta de quem acessa** — então o controle de acesso é o próprio compartilhamento da planilha, e não uma lista de e-mails dentro do código.

## O assistente

Responde em português, dentro do mesmo app. A decisão de arquitetura que define ele: **o modelo não escreve SQL.**

Recebe um menu de sete ferramentas, cada uma uma consulta fixa a uma view. Um modelo escrevendo consulta do zero decidiria sozinho o que este projeto levou meses fechando — calcularia giro por média, contaria item retirado como receita, leria janeiro de 2026 como mês normal. A regra certa não está na pergunta; está no histórico do projeto.

Duas consequências desse desenho:

**As ferramentas devolvem a conta pronta, não a lista.** Na primeira versão, a ferramenta de estoque devolvia as linhas e o modelo contava. Ele usou `> 90 dias` onde a regra é `>= 90` e respondeu 16 em vez de 17. O erro não foi do modelo: foi meu, por deixar a definição do limite escapar do banco.

**O teste tem gabarito calculado na hora.** `testarConfiguracao()` chama a ferramenta primeiro e usa o resultado como resposta esperada. Número fixo no teste envelheceria — "17 itens parados" vira 18 assim que uma peça cruzar os 90 dias — e um teste que reprova o comportamento certo ensina a ignorar o alerta.

O provedor do modelo é trocável numa linha: usa o endpoint gratuito da NVIDIA por padrão, com a API da Anthropic como alternativa.

## Segurança

O banco tinha uma única proteção: ninguém ter a chave. Hoje tem camadas.

- **RLS ligada** em todas as tabelas, **sem policy** — que é a configuração segura: não existe caso de uso em que alguém de fora deva ler consignação ou proprietário
- **`revoke` explícito nas views internas.** Esse passo é o que quase todo mundo esquece: view em Postgres roda com a permissão de quem a criou, então ligar RLS na tabela **não** protege a view. Sem o revoke, a view de proprietários seria porta dos fundos para a tabela protegida
- **Papel dedicado para o assistente**, com `SELECT` nas views e em nenhuma tabela. Se o código tiver um bug, ou se alguém esconder um comando num campo de observação da planilha, o teto não é a atenção de quem programou — é o que o banco permite
- Credenciais em `.env` (ignorado) e *GitHub Secrets*; conta de serviço somente-leitura na planilha

## Qualidade: o pipeline verifica a si mesmo

Um pipeline verde não quer dizer dado certo. Este ficou verde **1.236 execuções** gravando um valor mil vezes errado — um parser que dividia valores em formato pt-BR por mil, numa coluna que misturava dois formatos.

O que entrou depois disso:

- **`test_transform.py`** — testes dos parsers com os formatos reais que já quebraram a base, rodando no workflow **antes** do pipeline
- **`verificar.py`** — verificação pós-carga que falha alto se a contagem no banco não bater com a planilha, se algum total mensal vier abaixo de um piso plausível, ou se alguma venda estiver sem valor ou data

## Fragilidades conhecidas

Documentadas porque continuam lá:

- **`transform.py` imputa a data de saída** de itens vendidos sem data (entrada + 15 dias), e essa data chega ao banco indistinguível de uma data real. Hoje o efeito é zero — nenhum registro está nessa situação —, e é justamente por isso que é a hora de trocar por uma coluna que marque a estimativa
- **FK inválida descarta a consignação em silêncio.** Uma consignação com ID digitado errado some do faturamento sem deixar rastro. O certo é carregar com a FK nula e denunciar os IDs afetados
- **Validação só na saída.** Todo o custo de limpeza está no `transform.py`, e todo erro que ele não prevê vira número errado no dashboard. Fechar o domínio na planilha elimina classes inteiras de bug em vez de remediá-las

## Como rodar

```bash
pip install -r requirements.txt
cp .env.example .env          # preencha SUPABASE_URL, SUPABASE_KEY, SHEET_ID, GOOGLE_CREDENTIALS
cd pipeline && python main.py
```

Todo script que escreve na planilha roda em **dry run por padrão** e só grava com `--aplicar`. São dados de produção de um cliente, e a planilha é editada por outras pessoas ao mesmo tempo.

## Estrutura dos dados

Planilha de exemplo com a mesma arquitetura em [`docs/dados_exemplo.xlsx`](docs/dados_exemplo.xlsx), anonimizada.

![Diagrama do Banco de Dados](docs/diagrama_banco.png)

- **Proprietários** — cadastro de clientes consignantes
- **Bicicletas** / **Componentes** — itens em consignação
- **Consignações** — tabela central, ligando cliente + item + valor + status

[`consultas.sql`](consultas.sql) traz queries de negócio, estoque e métricas financeiras.

## Tecnologias

**Python** (pandas, gspread, requests) · **PostgreSQL / Supabase** · **Power BI** (DAX, TMDL) · **Google Apps Script** · **GitHub Actions** · **API da Anthropic / NVIDIA NIM**

---

## Histórico de versões

### v3.0 — setembro/2026 · Camada semântica, app de preenchimento e assistente

- **7 views no Supabase** concentrando as regras de negócio; Power BI reescrito para ler delas, eliminando a duplicação que causou o bug da comissão por faixa
- **Segurança do banco**: RLS em todas as tabelas, revogação das views internas, papel dedicado para o assistente e uma view pública sem colunas sensíveis
- **App de preenchimento** em Apps Script, com ID automático, sincronismo de status e domínio fechado
- **Assistente de dados** com ferramentas parametrizadas sobre as views, e gabarito calculado em tempo de execução
- **Normalização da fonte**: 63 células corrigidas com trilha de auditoria, incluindo 34 itens cujo status divergia entre abas
- Base fictícia para demonstração pública do dashboard

### v2.1 — setembro/2026 · Testes e verificação pós-carga

- Testes dos parsers com os formatos reais que quebraram a base
- Verificação pós-carga que falha alto em divergência de contagem, valor implausível ou venda incompleta
- Leitura de cabeçalho por nome em vez de posição
- Autenticação centralizada

### v2.0 — setembro/2026 · Auditoria da fonte e correção da carga

- A carga era `upsert` puro, então registro apagado na planilha permanecia no banco. O `load.py` passou a remover o que saiu da fonte, com trava contra exclusão em massa por leitura incompleta
- Chave primária repetida fazia o PostgreSQL recusar o lote inteiro, e o erro só era impresso: as execuções apareciam verdes enquanto os registros mais recentes nunca chegavam. O `upsert` passou a deduplicar por chave, e falha de lote passou a interromper o pipeline
- `correcoes.csv` e `aplicar_correcoes.py` como registro auditável

### v1.4 — setembro/2026 · Tratamento de lacunas de preenchimento

- Padronização do canal de venda e imputação de data de saída, com contagem no resumo
- Avisos de data fora da faixa e de saída anterior à entrada

### v1.3 — setembro/2026 · Robustez na leitura

- Faixa de datas ampliada, limpeza de cabeçalhos, busca flexível da coluna de valor

### v1.2 — agosto/2026 · Correção do corte de datas

- Remoção da trava que descartava datas posteriores a abril de 2026

### v1.1 — agosto/2026 · Camada de consulta e documentação

- `consultas.sql`, diagrama do modelo relacional, licença MIT

### v1.0 — abril/2026 · Pipeline inicial

- Extração das 5 abas, transformação, carga no Supabase e agendamento no GitHub Actions

---

📫 Meus outros projetos de dados em [github.com/pedrinvazzz-code](https://github.com/pedrinvazzz-code)
