"""
Funde proprietarios duplicados no Google Sheets.

Uso:
    python deduplicar_proprietarios.py            # dry run
    python deduplicar_proprietarios.py --aplicar  # grava

Para cada par, as consignacoes do ID duplicado passam para o ID canonico
(ID_Cliente e Proprietario) e a linha do duplicado sai da aba Proprietarios.

O criterio de cada par esta no comentario. Cinco dos seis tem telefone
identico, so mudando a formatacao (um cadastro com "34999999999" e o outro com "34 9999-9999"), o que
sozinho ja fecha. Os outros dois vieram do cruzamento com o Excel da loja.
"""
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

from sheets import get_client

APLICAR = '--aplicar' in sys.argv

# Remapear as consignacoes ja resolve a analise: contagem de clientes e ranking
# de concentracao saem do ID_Cliente das consignacoes, nao do numero de linhas
# da aba Proprietarios. Apagar a linha do duplicado e a unica parte irreversivel
# daqui, e nao acrescenta nada — entao so acontece se for pedida.
REMOVER_LINHAS = '--remover-duplicados' in sys.argv

# (canonico, duplicado, nome_final, criterio)
PARES = [
    (74, 215, 'ID 74',
     'o Excel grafa o mesmo nome de tres formas diferentes; o telefone do '
     'item que estava em duvida e o mesmo do ID 74'),
    (210, 213, 'ID 210', 'mesmo telefone nos dois cadastros'),
    (1, 201, 'ID 1', 'mesmo telefone nos dois cadastros'),
    (25, 202, 'ID 25', 'mesmo telefone nos dois cadastros'),
    (190, 199, 'ID 190', 'mesmo telefone nos dois cadastros'),
    (156, 221, 'ID 156',
     'nome identico incluindo o apelido entre parenteses; so o 156 tem telefone'),
]


def main():
    planilha = get_client().open_by_key(os.environ['SHEET_ID'])

    cons = planilha.worksheet('Consignações')
    valores = cons.get_all_values()
    cab = [c.strip() for c in valores[0]]
    col_cli = cab.index('ID_Cliente')
    col_nome = cab.index('Proprietário')

    total = 0
    for canonico, duplicado, nome, criterio in PARES:
        print(f"\n{duplicado} -> {canonico}  ({nome})")
        print(f"   criterio: {criterio}")
        achou = False
        for i, linha in enumerate(valores[1:], start=2):
            if linha[col_cli].strip() != str(duplicado):
                continue
            achou = True
            total += 1
            print(f"   consignacao linha {i}: ID_Cliente '{linha[col_cli]}' -> '{canonico}'"
                  f" | Proprietario '{linha[col_nome]}' -> '{nome}'")
            if APLICAR:
                cons.update_cell(i, col_cli + 1, str(canonico))
                time.sleep(1.2)
                cons.update_cell(i, col_nome + 1, nome)
                time.sleep(1.2)
        if not achou:
            print("   nenhuma consignacao apontando para o duplicado")

    # so depois de remapear as consignacoes e que a linha do duplicado sai
    props = planilha.worksheet('Proprietários')
    pvals = props.get_all_values()
    pcab = [c.strip() for c in pvals[0]]
    pcol = pcab.index('ID_Cliente')

    remover = []
    for i, linha in enumerate(pvals[1:], start=2):
        if linha[pcol].strip() in {str(d) for _, d, _, _ in PARES}:
            remover.append((i, linha[pcol].strip(), linha[1] if len(linha) > 1 else ''))

    if REMOVER_LINHAS:
        print(f"\nlinhas a remover da aba Proprietarios: {len(remover)}")
        for i, id_, nome in remover:
            print(f"   linha {i}: ID {id_} ({nome})")
        # de baixo para cima, senao as linhas seguintes deslocam
        if APLICAR:
            for i, id_, _ in sorted(remover, reverse=True):
                props.delete_rows(i)
                time.sleep(1.2)
    else:
        print(f"\n{len(remover)} linhas duplicadas ficam na aba Proprietarios, agora sem "
              f"nenhuma consignacao apontando para elas: "
              f"{', '.join(id_ for _, id_, _ in remover)}")
        print("   (passe --remover-duplicados para apaga-las; nao e preciso para a analise)")

    print(f"\n{total} consignacoes remapeadas"
          + (f", {len(remover)} proprietarios removidos" if REMOVER_LINHAS else ""))
    if not APLICAR:
        print("Dry run. Rode com --aplicar para gravar.")


if __name__ == '__main__':
    main()
