# Cairo Special Bikes — Plataforma de Dados

Projeto de dados de ponta a ponta para uma loja de consignação de bicicletas em Uberlândia/MG: da planilha que a equipe preenche no balcão até um assistente que responde perguntas sobre o negócio em português.

> Consultoria real, entregue ao cliente. Os dashboards abaixo rodam sobre uma base fictícia — nenhum dado de cliente ou valor de venda está neste repositório.

---

## O problema

A loja controlava a operação em **doze planilhas separadas**, preenchidas à mão por pessoas diferentes. Não havia resposta confiável para perguntas básicas: quanto se vendeu no mês, o que está parado há mais tempo, quanto cada consignante gerou.

Consolidar isso em uma base única foi o começo. O que consumiu o projeto foi o que veio depois — descobrir **o que os dados consolidados não podiam responder**, e construir as camadas que impedem a pergunta errada de virar número errado.

## O que foi construído

```
                        ┌─→  Power BI  (4 páginas)
Google Sheets           │
      │                 │
      ├→ ETL em Python ─┴→ Supabase ──→ Camada de views ──→ Assistente de IA
      │  (a cada 2h)        (Postgres)   (regras de negócio)
      │
      └← App de preenchimento (roda no celular da loja)
```

| camada | o que resolve |
|---|---|
| **App de preenchimento** | cadastrar uma bike exigia mexer em 3 abas e digitar 2 IDs. Agora é uma tela |
| **ETL** | roda sozinho a cada 2h, com testes e verificação pós-carga |
| **Camada de views** | cada regra de negócio escrita **uma vez só** |
| **Assistente** | pergunta em português, resposta com número do banco |

## Dashboard

![Visão Geral](docs/Visao_Geral.png)
![Financeiro](docs/Financeiro.png)
![Segmentação](docs/Segmentacao_Produtos.png)
![Estoque](docs/Estoque.png)

---

# Três decisões que definiram o projeto

## 1. Descobrir que dois terços do histórico não podiam ser usados

Antes de entregar qualquer análise, fiz um teste barato: distribuir a receita pelo **dia do mês** da data de venda.

Venda real não se concentra no dia 1, 30 ou 31. Ali, dois terços de toda a receita histórica caíam exatamente nesses dias.

Não era fraude — eram **datas-marcador**, preenchidas em lote quando as doze planilhas foram consolidadas. O corte era nítido: até março de 2026, entre 63% e 100% da receita de cada mês caía em borda; de abril em diante, entre 0% e 29%, e cada caso restante tinha confirmação documental.

**A decisão:** recortar a janela de análise e declarar isso ao cliente, em vez de entregar uma curva mensal bonita e falsa. A regra virou uma coluna no banco — `confiavel` —, então quem consultar um mês antigo recebe o aviso junto com o número, sem depender de lembrar.

## 2. Encontrar a mesma regra escrita em quatro lugares

A comissão da loja segue faixas por valor. Essa regra estava no código do pipeline, em três medidas do Power BI e no texto do relatório.

Três concordavam. Uma não: as medidas que repartem a comissão por faixa **não tinham filtro de período**, e somavam o histórico inteiro enquanto o resto da página respeitava a janela. O total batia — só a repartição estava errada.

É o tipo de defeito que não aparece em revisão: o número grande fecha.

**A decisão:** criar uma camada de views onde cada definição existe **uma vez**, e reescrever o Power BI para ler dela. Mudar a comissão passou a ser editar uma linha de SQL, em vez de caçar quatro cópias.

## 3. Não deixar a IA escrever SQL

O assistente responde perguntas sobre o negócio. O desenho óbvio seria dar acesso ao banco e deixar o modelo consultar.

Não faz sentido aqui. Um modelo escrevendo consulta do zero decidiria sozinho o que o projeto levou meses fechando: calcularia giro pela média em vez da mediana, contaria item retirado como receita, leria um mês pré-abril como se fosse normal. **A regra certa não está na pergunta — está no histórico do projeto.**

**A decisão:** o modelo recebe sete ferramentas, cada uma uma consulta fixa sobre uma view. Ele escolhe qual usar; a resposta já vem calculada.

Duas coisas que só ficaram claras testando:

- **A ferramenta devolve a conta pronta, não a lista.** Na primeira versão o modelo contava as linhas e usou `> 90 dias` onde a regra é `>= 90`. O erro não foi dele: foi meu, por deixar a definição do limite escapar do banco
- **O gabarito do teste é calculado em tempo de execução.** Número fixo envelhece — "17 itens parados" vira 18 assim que uma peça cruza os 90 dias —, e um teste que reprova o comportamento certo ensina a ignorar o alerta

---

## O que mudou na operação

| antes | depois |
|---|---|
| 12 planilhas soltas | base única, sincronizada a cada 2 horas |
| cadastro em 3 abas, IDs digitados à mão | uma tela no celular, IDs automáticos |
| status divergente em 34 de 589 itens | sincronizado por gatilho |
| regra de negócio em 4 lugares | uma camada de views |
| banco protegido só por "ninguém tem a chave" | RLS, papel restrito e vitrine sem dado sensível |
| pipeline verde sem garantia | testes de parser e verificação pós-carga que falha alto |

O pipeline chegou a rodar **1.236 execuções verdes** gravando um valor mil vezes errado — um parser que dividia números em formato pt-BR por mil, numa coluna que misturava dois formatos. Foi isso que motivou a camada de testes: execução verde não é prova de dado certo.

## O que eu faria diferente

Documentado porque continua lá, e porque saber o que está torto vale mais que fingir que não está:

- **A imputação silenciosa de data.** O pipeline dá a todo item vendido sem data de saída uma data estimada, e ela chega ao banco indistinguível de uma real. Hoje o efeito é zero, e é por isso que é a hora de trocar por uma coluna que marque a estimativa
- **FK inválida some em silêncio.** Uma consignação com ID errado desaparece do faturamento sem rastro. O certo é carregar com a chave nula e denunciar
- **Validação só na saída.** Todo o custo de limpeza está no código, e todo erro não previsto vira número errado no dashboard. Fechar o domínio na origem elimina classes inteiras de bug em vez de remediá-las

## Stack

**Python** (pandas, gspread) · **PostgreSQL / Supabase** · **Power BI** (DAX, TMDL) · **Google Apps Script** · **GitHub Actions** · **API da Anthropic / NVIDIA NIM**

## Sobre os dados deste repositório

Os prints acima vêm de uma base fictícia gerada por [`demo/gerar_dados_demo.py`](demo/gerar_dados_demo.py), que preserva a estrutura real — contagens, distribuições, datas — e substitui nomes, contatos e valores.

Os parâmetros que controlam essa substituição não estão versionados, e o script recusa rodar sem eles. Publicados, tornariam a anonimização reversível.

---

<details>
<summary>Evolução do projeto</summary>

<br>

**v3.0** · set/2026 — Camada semântica, segurança do banco, app de preenchimento e assistente
**v2.1** · set/2026 — Testes de parser e verificação pós-carga
**v2.0** · set/2026 — Auditoria da fonte; correção da carga que deixava registro órfão no banco e da falha de lote que passava despercebida
**v1.4** · set/2026 — Tratamento de lacunas de preenchimento
**v1.3** · set/2026 — Robustez na leitura da planilha
**v1.2** · ago/2026 — Correção do corte de datas
**v1.1** · ago/2026 — Camada de consulta e modelo relacional
**v1.0** · abr/2026 — Pipeline inicial

</details>

---

📫 Meus outros projetos de dados em [github.com/pedrinvazzz-code](https://github.com/pedrinvazzz-code)
