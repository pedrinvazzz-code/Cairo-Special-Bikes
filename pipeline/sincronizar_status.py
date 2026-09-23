# -*- coding: utf-8 -*-
"""
Alinha o Status das abas Bicicletas e Componentes ao da aba Consignações.

Decisao do cliente (22/09): a aba Consignações e a fonte de verdade para status.
Ela e a unica que tem disciplina de preenchimento e a unica que o pipeline usa
para faturamento -- as outras duas guardam uma copia que so se desatualiza.

Um item pode ter mais de uma consignacao (2a passagem). Vale a MAIS RECENTE,
ordenada por data de saida, depois data de entrada, depois ID.

Uso:
    python sincronizar_status.py            # dry run
    python sincronizar_status.py --aplicar  # grava, com trilha
"""
import csv
import datetime
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

from sheets import get_client

APLICAR = '--aplicar' in sys.argv
RAIZ = Path(__file__).parent

# aba do item -> (coluna da FK na aba Consignações, coluna de Status na aba do item)
DESTINOS = {
    'Bicicletas':  ('ID_Bike', 'Status'),
    'Componentes': ('ID_Componente', 'Status'),
}


def data(s):
    s = (s or '').strip()
    for f in ('%d/%m/%Y', '%Y-%m-%d'):
        try:
            return datetime.datetime.strptime(s, f).date()
        except ValueError:
            pass
    return datetime.date(1900, 1, 1)


def col_letra(i):
    letra, i = '', i + 1
    while i:
        i, r = divmod(i - 1, 26)
        letra = chr(65 + r) + letra
    return letra


def main():
    planilha = get_client().open_by_key(os.environ['SHEET_ID'])

    aba_cons = planilha.worksheet('Consignações')
    vals = aba_cons.get_all_values()
    cab = [c.strip() for c in vals[0]]
    idx = {n: cab.index(n) for n in
           ('ID_Consignação', 'ID_Bike', 'ID_Componente', 'Status', 'Item / Produto',
            'Data Entrada', 'Data Saída')}

    # (coluna_fk, id_item) -> consignacao mais recente
    ultima = {}
    for linha in vals[1:]:
        for col_fk in ('ID_Bike', 'ID_Componente'):
            fk = linha[idx[col_fk]].strip()
            if not fk:
                continue
            ordem = (data(linha[idx['Data Saída']]),
                     data(linha[idx['Data Entrada']]),
                     int(linha[idx['ID_Consignação']] or 0))
            chave = (col_fk, fk)
            if chave not in ultima or ordem > ultima[chave][0]:
                ultima[chave] = (ordem, linha)

    mudancas = []
    cabecalho_quebrado = []

    for nome_aba, (col_fk, col_status) in DESTINOS.items():
        aba = planilha.worksheet(nome_aba)
        v = aba.get_all_values()
        cabeca = [c.strip() for c in v[0]]

        # a aba Bicicletas tem o cabecalho da coluna A como #N/A (formula quebrada)
        if cabeca[0] in ('#N/A', '', '#REF!'):
            cabecalho_quebrado.append((nome_aba, cabeca[0], col_fk))
            cabeca[0] = col_fk

        ci = cabeca.index(col_status)

        for n, linha in enumerate(v[1:], start=2):
            id_item = linha[0].strip()
            if not id_item:
                continue
            reg = ultima.get((col_fk, id_item))
            if not reg:
                continue
            certo = reg[1][idx['Status']].strip()
            atual = linha[ci].strip() if len(linha) > ci else ''
            if certo and certo.lower() != atual.lower():
                mudancas.append({
                    'aba': nome_aba,
                    'celula': '%s%d' % (col_letra(ci), n),
                    'coluna': col_status,
                    'valor_antigo': atual,
                    'valor_novo': certo,
                    'motivo': 'status alinhado a consignacao %s (fonte de verdade)'
                              % reg[1][idx['ID_Consignação']],
                })

    if cabecalho_quebrado:
        print('--- cabecalho quebrado ---')
        for nome_aba, atual, certo in cabecalho_quebrado:
            print('  %s!A1 = %r  ->  %r' % (nome_aba, atual, certo))

    print('\n--- %d status a alinhar ---' % len(mudancas))
    for m in mudancas:
        print('  %-12s %-6s  %-11s -> %-11s  (%s)'
              % (m['aba'], m['celula'], m['valor_antigo'] or '(vazio)',
                 m['valor_novo'], m['motivo']))

    if not APLICAR:
        print('\nDry run. Rode com --aplicar para gravar.')
        return

    trilha = RAIZ / 'normalizacoes.csv'
    with open(trilha, 'a', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, ['data', 'aba', 'celula', 'coluna',
                               'valor_antigo', 'valor_novo', 'motivo'])
        hoje = datetime.date.today().isoformat()

        for nome_aba, _, certo in cabecalho_quebrado:
            planilha.worksheet(nome_aba).update_acell('A1', certo)
            w.writerow({'data': hoje, 'aba': nome_aba, 'celula': 'A1', 'coluna': 'cabecalho',
                        'valor_antigo': '#N/A', 'valor_novo': certo,
                        'motivo': 'formula quebrada no cabecalho'})
            print('  gravado %s!A1 = %s' % (nome_aba, certo))
            time.sleep(1.2)

        for m in mudancas:
            planilha.worksheet(m['aba']).update_acell(m['celula'], m['valor_novo'])
            w.writerow(dict(m, data=hoje))
            print('  gravado %s!%s = %s' % (m['aba'], m['celula'], m['valor_novo']))
            time.sleep(1.2)

    print('\n%d celulas gravadas' % (len(mudancas) + len(cabecalho_quebrado)))


if __name__ == '__main__':
    main()
