# -*- coding: utf-8 -*-
"""
Gera uma base fictícia com a mesma estrutura da real, para o dashboard de
demonstração do portfólio.

O que muda e o que fica:

  NOME e CONTATO de proprietário  -> trocados por nomes gerados. O mapa é
      consistente: o mesmo dono real vira sempre o mesmo dono fictício, senão
      o ranking de proprietários e a concentração de receita se desfazem.

  VALOR  -> embaralhado em até ±18%, com semente fixa. Preserva a forma da
      distribuição (ticket médio, faixas de comissão, a cauda de bikes caras)
      sem expor o faturamento real, que é informação do negócio do cliente.

  DATA, STATUS, MARCA, MODELO, CATEGORIA  -> ficam como estão. Marca e modelo
      são catálogo público, e as datas são o que sustenta a parte mais
      interessante da análise: a concentração em borda de mês antes de
      abril/2026. Sem elas o dashboard de demonstração perde o assunto.

Uso:
    python gerar_dados_demo.py
"""
import os
import random
import unicodedata
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

SEMENTE = 20260922            # fixa: rodar duas vezes dá o mesmo resultado

# Os valores são reduzidos e embaralhados. A primeira versão só variava ±18%, e
# R$ 855 mil contra os R$ 840 mil reais não engana ninguém que abra o relatório
# ao lado. ESCALA derruba o porte do negócio; VARIACAO desfaz a proporção entre
# os itens, para não bastar multiplicar de volta.
ESCALA = 0.34
VARIACAO = 0.30
SAIDA = Path(__file__).parent / 'dados_demo.xlsx'

# Tabelas e views que o modelo do Power BI consome.
RELACOES = ['consignacoes', 'bicicletas', 'componentes', 'proprietarios',
            'resumo_mensal', 'vw_estoque_atual', 'vw_vendas',
            'vw_estoque_parado', 'vw_vendas_segmento', 'vw_receita_mensal',
            'vw_giro', 'vw_proprietarios', 'vw_catalogo_publico']

PRIMEIROS = ['Adriano', 'Beatriz', 'Caio', 'Daniela', 'Eduardo', 'Fernanda',
             'Gustavo', 'Helena', 'Ícaro', 'Juliana', 'Kléber', 'Larissa',
             'Marcelo', 'Natália', 'Otávio', 'Patrícia', 'Rafael', 'Simone',
             'Thiago', 'Úrsula', 'Vinícius', 'Yara', 'Bruno', 'Carla',
             'Diego', 'Elaine', 'Felipe', 'Gabriela', 'Henrique', 'Isabela']

SOBRENOMES = ['Almeida', 'Barbosa', 'Carvalho', 'Dias', 'Esteves', 'Freitas',
              'Gonçalves', 'Henriques', 'Imbassahy', 'Jardim', 'Klein',
              'Lacerda', 'Marques', 'Nogueira', 'Oliveira', 'Pacheco',
              'Queiroz', 'Rezende', 'Siqueira', 'Tavares', 'Vasconcelos',
              'Xavier', 'Zanetti', 'Moreira', 'Peixoto', 'Ramalho']

CIDADES = ['Uberlândia', 'Uberaba', 'Araguari', 'Patos de Minas',
           'Ituiutaba', 'Monte Carmelo', 'Araxá']


def ler(rel):
    """Lê uma relação inteira do Supabase, paginando."""
    url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/' + rel
    chave = os.environ['SUPABASE_KEY']
    cabecalho = {'apikey': chave, 'Authorization': 'Bearer ' + chave}
    linhas, passo, inicio = [], 1000, 0
    while True:
        r = requests.get(url, headers=dict(cabecalho, Range='%d-%d' % (inicio, inicio + passo - 1)),
                         params={'select': '*'}, timeout=60)
        r.raise_for_status()
        lote = r.json()
        linhas.extend(lote)
        if len(lote) < passo:
            break
        inicio += passo
    return pd.DataFrame(linhas)


def montar_nomes(reais, rnd):
    """Mapa estável de nome real -> nome fictício, um para um."""
    combinacoes = [(p, s) for p in PRIMEIROS for s in SOBRENOMES]
    rnd.shuffle(combinacoes)
    mapa = {}
    for i, real in enumerate(sorted(x for x in reais if x)):
        p, s = combinacoes[i % len(combinacoes)]
        # se acabarem as combinações, acrescenta inicial para não repetir
        nome = '%s %s' % (p, s) if i < len(combinacoes) else '%s %s %s' % (p, chr(65 + i % 26), s)
        mapa[real] = nome
    return mapa


def telefone(rnd):
    return '34 9%04d-%04d' % (rnd.randint(1000, 9999), rnd.randint(1000, 9999))


def main():
    rnd = random.Random(SEMENTE)

    print('lendo do Supabase...')
    tabelas = {}
    for rel in RELACOES:
        try:
            tabelas[rel] = ler(rel)
            print('  %-22s %5d linhas' % (rel, len(tabelas[rel])))
        except Exception as e:
            print('  %-22s pulada (%s)' % (rel, str(e)[:60]))

    # --- o mapa de nomes sai da tabela de proprietários, que é a fonte
    reais = set()
    if 'proprietarios' in tabelas and 'nome' in tabelas['proprietarios']:
        reais |= set(tabelas['proprietarios']['nome'].dropna())
    for t in tabelas.values():
        if 'proprietario' in t.columns:
            reais |= set(t['proprietario'].dropna())
    reais = {str(x).strip() for x in reais if str(x).strip()}
    mapa = montar_nomes(reais, rnd)
    print('\n%d proprietários trocados' % len(mapa))

    # --- fator de variação por item, estável: o mesmo item mantém o mesmo
    #     valor em todas as tabelas onde aparece, senão os totais não fecham
    fatores = {}

    def fator(chave):
        if chave not in fatores:
            fatores[chave] = ESCALA * (1 + rnd.uniform(-VARIACAO, VARIACAO))
        return fatores[chave]

    for nome, df in tabelas.items():
        if df.empty:
            continue

        for col in ('proprietario', 'nome'):
            if col in df.columns:
                df[col] = df[col].map(lambda v: mapa.get(str(v).strip(), v)
                                      if pd.notna(v) else v)

        if 'contato' in df.columns:
            df['contato'] = [telefone(rnd) if pd.notna(v) else v for v in df['contato']]
        if 'cidade' in df.columns:
            df['cidade'] = [rnd.choice(CIDADES) if pd.notna(v) else v for v in df['cidade']]

        # a chave do fator é o id da consignação quando existe; senão a linha
        chaves = (df['id_consignacao'] if 'id_consignacao' in df.columns
                  else pd.Series(range(len(df)), index=df.index))
        for col in df.columns:
            if col in ('valor', 'receita', 'comissao', 'ticket_medio', 'ticket_mediano',
                       'valor_vendido_bikes', 'valor_vendido_comps', 'total_vendas_real',
                       'comissao_se_vender'):
                if pd.api.types.is_numeric_dtype(df[col]):
                    df[col] = [round(v * fator('%s_%s' % (nome if col != 'valor' else 'v', k)))
                               if pd.notna(v) else v
                               for v, k in zip(df[col], chaves)]

        tabelas[nome] = df

    # --- datas como DATA, não como texto
    #
    # O Supabase devolve data em JSON, que é string. Escrever assim no Excel faz
    # o Power BI carregar a coluna como texto, e aí toda medida que compara
    # `data_saida >= Ini` quebra com "não é possível comparar Text com Date".
    # Custou uma rodada inteira de diagnóstico; converter aqui é o lugar certo.
    COLUNAS_DATA = ('data_entrada', 'data_saida', 'created_at', 'updated_at',
                    'mes', 'primeira_venda', 'ultima_venda')
    for nome, df in tabelas.items():
        for col in df.columns:
            if col in COLUNAS_DATA:
                df[col] = pd.to_datetime(df[col], errors='coerce')
                # o Excel não guarda fuso; sem isto o openpyxl recusa a coluna
                if getattr(df[col].dtype, 'tz', None) is not None:
                    df[col] = df[col].dt.tz_localize(None)
        tabelas[nome] = df

    SAIDA.parent.mkdir(exist_ok=True)
    with pd.ExcelWriter(SAIDA, engine='openpyxl', datetime_format='yyyy-mm-dd') as w:
        for nome, df in tabelas.items():
            df.to_excel(w, sheet_name=nome[:31], index=False)

    print('\ngravado em %s (%.0f KB)' % (SAIDA, SAIDA.stat().st_size / 1024))

    # --- conferência: nenhum nome real pode ter sobrado
    import io
    bruto = io.open(SAIDA, 'rb').read()
    vazou = [r for r in list(reais)[:400]
             if len(r) > 5 and r.encode('utf-8') in bruto]
    print('nomes reais encontrados no arquivo: %d %s'
          % (len(vazou), vazou[:5] if vazou else '(nenhum)'))


if __name__ == '__main__':
    main()
