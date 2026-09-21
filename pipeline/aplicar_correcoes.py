"""
Aplica as correções de correcoes.csv na aba Consignações do Google Sheets.

Uso:
    python aplicar_correcoes.py            # só mostra o que faria (dry run)
    python aplicar_correcoes.py --aplicar  # grava de verdade

Precisa das mesmas variáveis do pipeline (.env): GOOGLE_CREDENTIALS e SHEET_ID.
A conta de serviço precisa ter permissão de EDITOR na planilha.
"""
import csv
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

from sheets import get_client

ABA = 'Consignações'
COL_ID = 'ID_Consignação'
APLICAR = '--aplicar' in sys.argv


def main():
    aba = get_client().open_by_key(os.environ['SHEET_ID']).worksheet(ABA)

    valores = aba.get_all_values()
    cabecalho = [c.strip() for c in valores[0]]
    col_id = cabecalho.index(COL_ID)

    # id -> número da linha na planilha (1-based, cabeçalho é a linha 1)
    linha_do_id = {}
    for i, linha in enumerate(valores[1:], start=2):
        if linha[col_id].strip():
            linha_do_id[linha[col_id].strip()] = i

    with open(Path(__file__).parent / 'correcoes.csv', encoding='utf-8') as f:
        correcoes = list(csv.DictReader(f))

    apagar = []
    for c in correcoes:
        id_ = c['id'].strip()
        if id_ not in linha_do_id:
            print(f"  ✗ ID {id_} não encontrado, pulando")
            continue
        linha = linha_do_id[id_]

        if c['campo'] == 'APAGAR':
            apagar.append((linha, id_))
            continue

        if c['campo'] not in cabecalho:
            print(f"  ✗ coluna '{c['campo']}' não existe na aba, pulando ID {id_}")
            continue
        col = cabecalho.index(c['campo']) + 1
        atual = valores[linha - 1][col - 1]
        novo = c['valor_novo']
        if atual.strip() == novo.strip():
            continue  # já está correto, pula sem imprimir
        print(f"  ID {id_:>4} | {c['campo']:<16} | '{atual}' -> '{novo}'")
        if APLICAR:
            aba.update_cell(linha, col, novo)
            time.sleep(1.2)

    # apaga de baixo para cima para não deslocar as linhas ainda não apagadas
    for linha, id_ in sorted(apagar, reverse=True):
        print(f"  APAGAR linha {linha} (ID {id_})")
        if APLICAR:
            aba.delete_rows(linha)

    if not APLICAR:
        print("\nDry run. Rode com --aplicar para gravar.")


if __name__ == '__main__':
    main()
