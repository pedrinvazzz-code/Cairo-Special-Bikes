"""
Compara o Excel de controle da loja com o que esta no sistema, mes a mes.

Uso:
    python comparar_meses.py                 # todos os meses de 2026 com dados
    python comparar_meses.py maio junho      # so os meses pedidos
    python comparar_meses.py --excel "outro_arquivo.xlsx"

O Excel da loja tem uma aba "Vendas mensais 2026" com um par de colunas por mes
(item, valor). A ultima linha preenchida de cada mes e a soma, sem nome de item,
e por isso e descartada.

Por que esta aba e nao as abas por mes ("Agosto 2026 bikes" etc.): aquelas sao o
estoque acumulado, com o valor PEDIDO na entrada, e a loja pinta a linha de
vermelho quando o item sai. Vermelho nao quer dizer vendido -- retirada tambem e
pintada. Em agosto/2026, 2 das 21 linhas vermelhas eram retiradas (R$59.800).
"Vendas mensais 2026" e a unica aba com o valor REALIZADO da venda.

O pareamento e por valor primeiro; dentro do mesmo valor, por semelhanca de nome.
Item que so aparece de um lado vira uma linha do relatorio.
"""
import sys
import os
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

EXCEL_PADRAO = r'C:\Users\phenr\Downloads\Cadastro de clientes 2026.xlsx'
ABA = 'Vendas mensais 2026'

# coluna do item e coluna do valor, por mes, na aba de vendas mensais
COLUNAS = {
    'janeiro':   (0, 1),
    'fevereiro': (2, 3),
    'marco':     (4, 5),
    'abril':     (6, 7),
    'maio':      (8, 9),
    'junho':    (10, 11),
    'julho':    (12, 13),
    'agosto':   (14, 15),
    'setembro': (16, 17),
    'outubro':  (18, 19),
    'novembro': (20, 21),
    'dezembro': (22, 23),
}

NUM_MES = {m: i for i, m in enumerate(COLUNAS, start=1)}

# palavras que aparecem em quase todo item e nao ajudam a distinguir
RUIDO = re.compile(r'\b(bicicleta|bike|par|de|para|seminova|seminovo|usada|usado)\b')

# rotulos de somatorio no rodape das colunas -- nao sao itens vendidos.
# Em janeiro/2026 valiam R$291.381 de receita fantasma.
ROTULOS = re.compile(
    r'^(total|totais|soma|subtotal|meses|mes|qtd|quantidade|valor\s*total|'
    r'total\s*geral|valor\s*total\s*\(r\$\))\b')


def normalizar(texto):
    """Minusculas, sem acento e sem pontuacao, para comparar nomes de item."""
    t = unicodedata.normalize('NFKD', str(texto))
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r'[^a-z0-9 ]', ' ', t.lower())
    t = RUIDO.sub(' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def parecido(a, b):
    return SequenceMatcher(None, normalizar(a), normalizar(b)).ratio()


def ler_loja(caminho, mes):
    """Itens do mes no Excel da loja, ja sem a linha de total."""
    col_item, col_valor = COLUNAS[mes]
    df = pd.read_excel(caminho, sheet_name=ABA, header=None)
    if col_item >= df.shape[1] or col_valor >= df.shape[1]:
        return []
    itens = []
    for i in range(1, len(df)):
        nome, valor = df.iat[i, col_item], df.iat[i, col_valor]
        if pd.isna(valor):
            continue
        if pd.isna(nome) or str(nome).strip().lower() in ('', 'nan'):
            # linha de soma no fim da coluna: nao e um item
            continue
        nome = str(nome).strip()
        if not re.search(r'[A-Za-zÀ-ÿ]', nome):
            # nome so com digitos: sobra de contagem/somatorio, nao e um item.
            # Sem isso maio e junho ganham dezenas de milhares de reais fantasma.
            continue
        if ROTULOS.match(nome.lower()):
            continue
        itens.append({'nome': nome, 'valor': float(valor)})
    return itens


def ler_sistema(mes, ano=2026):
    url = os.environ['SUPABASE_URL'].rstrip('/')
    key = os.environ['SUPABASE_KEY']
    h = {'apikey': key, 'Authorization': f'Bearer {key}'}
    n = NUM_MES[mes]
    ini = f'{ano}-{n:02d}-01'
    fim = f'{ano + 1}-01-01' if n == 12 else f'{ano}-{n + 1:02d}-01'
    r = requests.get(
        f'{url}/rest/v1/consignacoes'
        f'?select=id_consignacao,item_produto,valor,status,data_saida'
        f'&status=eq.Vendido&data_saida=gte.{ini}&data_saida=lt.{fim}',
        headers=h, timeout=60)
    r.raise_for_status()
    return [{'id': x['id_consignacao'], 'nome': x['item_produto'],
             'valor': float(x['valor'] or 0), 'data': x['data_saida']}
            for x in r.json()]


def parear(loja, sistema):
    """Casa os dois lados: valor exato primeiro, depois nome muito parecido."""
    pares, so_loja = [], []
    livres = list(sistema)

    for item in loja:
        iguais = [s for s in livres if abs(s['valor'] - item['valor']) < 0.01]
        if iguais:
            melhor = max(iguais, key=lambda s: parecido(item['nome'], s['nome']))
            livres.remove(melhor)
            pares.append((item, melhor, 'valor igual'))
            continue
        # sem valor igual: tenta nome parecido e reporta a diferenca de preco
        candidatos = [(s, parecido(item['nome'], s['nome'])) for s in livres]
        candidatos = [(s, r) for s, r in candidatos if r >= 0.75]
        if candidatos:
            melhor = max(candidatos, key=lambda t: t[1])[0]
            livres.remove(melhor)
            pares.append((item, melhor, 'valor diferente'))
            continue
        so_loja.append(item)

    return pares, so_loja, livres


def brl(v):
    return 'R$' + f'{v:,.2f}'.replace(',', '_').replace('.', ',').replace('_', '.')


def comparar(caminho, mes):
    loja = ler_loja(caminho, mes)
    sistema = ler_sistema(mes)
    pares, so_loja, so_sistema = parear(loja, sistema)

    t_loja = sum(i['valor'] for i in loja)
    t_sis = sum(i['valor'] for i in sistema)

    print('\n' + '=' * 78)
    print(f'{mes.upper()}/2026   loja {brl(t_loja)} ({len(loja)} itens)'
          f'   x   sistema {brl(t_sis)} ({len(sistema)} itens)')
    print(f'{"DIFERENCA: " + brl(t_sis - t_loja):>78}')
    print('=' * 78)

    divergentes = [p for p in pares if p[2] == 'valor diferente']
    if divergentes:
        print('\n-- mesmo item, valor diferente --')
        for item, s, _ in divergentes:
            print(f'  #{s["id"]:<4} {item["nome"][:40]:<40} '
                  f'loja {brl(item["valor"]):>13}  sistema {brl(s["valor"]):>13}  '
                  f'({brl(s["valor"] - item["valor"])})')

    if so_loja:
        total = sum(i['valor'] for i in so_loja)
        print(f'\n-- so na LOJA ({len(so_loja)} itens, {brl(total)}) --')
        print('   venda nao cadastrada, ou lancada em outro mes no sistema')
        for i in sorted(so_loja, key=lambda x: -x['valor']):
            print(f'  {brl(i["valor"]):>14}  {i["nome"][:56]}')

    if so_sistema:
        total = sum(s['valor'] for s in so_sistema)
        print(f'\n-- so no SISTEMA ({len(so_sistema)} itens, {brl(total)}) --')
        print('   item que a loja lancou em outro mes, ou nao lancou')
        for s in sorted(so_sistema, key=lambda x: -x['valor']):
            print(f'  #{s["id"]:<4} {brl(s["valor"]):>14}  {s["nome"][:48]}  (saida {s["data"]})')

    if not divergentes and not so_loja and not so_sistema:
        print('\n  Mes fechado: todos os itens batem.')

    return {'mes': mes, 'loja': t_loja, 'sistema': t_sis,
            'so_loja': so_loja, 'so_sistema': so_sistema, 'divergentes': divergentes}


def main():
    args = list(sys.argv[1:])
    caminho = EXCEL_PADRAO
    if '--excel' in args:
        i = args.index('--excel')
        caminho = args[i + 1]
        del args[i:i + 2]

    meses = [a.lower() for a in args]
    if meses:
        invalidos = [m for m in meses if m not in COLUNAS]
        if invalidos:
            print(f'Mes invalido: {", ".join(invalidos)}')
            print(f'Validos: {", ".join(COLUNAS)}')
            return 1
    else:
        meses = [m for m in COLUNAS if ler_loja(caminho, m)]

    resumos = [comparar(caminho, m) for m in meses]

    print('\n' + '=' * 78)
    print(f'{"RESUMO":<14}{"loja":>18}{"sistema":>18}{"diferenca":>18}')
    print('-' * 78)
    for r in resumos:
        print(f'{r["mes"]:<14}{brl(r["loja"]):>18}{brl(r["sistema"]):>18}'
              f'{brl(r["sistema"] - r["loja"]):>18}')
    tl = sum(r['loja'] for r in resumos)
    ts = sum(r['sistema'] for r in resumos)
    print('-' * 78)
    print(f'{"TOTAL":<14}{brl(tl):>18}{brl(ts):>18}{brl(ts - tl):>18}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
