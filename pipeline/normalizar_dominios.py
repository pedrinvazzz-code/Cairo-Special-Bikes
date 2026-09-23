# -*- coding: utf-8 -*-
"""
Fecha o dominio das colunas categoricas do Google Sheets.

Antes de ligar a lista suspensa, os valores que ja estao la precisam caber no
dominio -- senao a validacao marca dezenas de celulas antigas como invalidas e a
loja passa a conviver com aviso vermelho, que e a melhor forma de ensinar todo
mundo a ignorar aviso.

Uso:
    python normalizar_dominios.py            # dry run, so mostra
    python normalizar_dominios.py --aplicar  # grava, com backup antes

Toda alteracao vai para normalizacoes.csv com aba, celula, valor antigo, valor
novo e motivo. Sem trilha nao se responde "de onde veio esse numero" depois.
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

# aba -> coluna -> {valor errado (minusculo, sem espaco): valor canonico}
DOMINIOS = {
    'Consignações': {
        'Status': {'vendido': 'Vendido', 'em estoque': 'Em estoque', 'retirado': 'Retirado'},
        'Loja':   {'on line': 'Online', 'online': 'Online', 'fisica': 'Física', 'física': 'Física'},
        'Tipo':   {'bicicleta': 'Bicicleta', 'componente/acessório': 'Componente/Acessório'},
    },
    'Bicicletas': {
        'Status':   {'vendido': 'Vendido', 'em estoque': 'Em estoque', 'retirado': 'Retirado'},
        'Material': {'carbono': 'Carbono', 'alumínio': 'Alumínio', 'aluminio': 'Alumínio', 'aço': 'Aço'},
    },
    'Componentes': {
        'Status': {'vendido': 'Vendido', 'em estoque': 'Em estoque', 'retirado': 'Retirado'},
    },
}

# valores que nao sao erro de grafia, e sim do dominio errado: nao se corrige
# sozinho, so se relata
FORA_DO_DOMINIO = {('Consignações', 'Loja'): {'retirada'}}


def col_letra(i):
    letra = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        letra = chr(65 + r) + letra
    return letra


def main():
    planilha = get_client().open_by_key(os.environ['SHEET_ID'])

    carimbo = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    destino = RAIZ.parent / 'backups' / carimbo
    destino.mkdir(parents=True, exist_ok=True)

    mudancas, relatar = [], []

    for aba in planilha.worksheets():
        valores = aba.get_all_values()
        if not valores:
            continue

        with open(destino / ('%s.csv' % aba.title), 'w', encoding='utf-8', newline='') as f:
            csv.writer(f).writerows(valores)

        regras = DOMINIOS.get(aba.title)
        if not regras:
            continue
        cabecalho = [c.strip() for c in valores[0]]

        for coluna, mapa in regras.items():
            if coluna not in cabecalho:
                print('  ! %s: coluna %s nao existe' % (aba.title, coluna))
                continue
            idx = cabecalho.index(coluna)
            suspeitos = FORA_DO_DOMINIO.get((aba.title, coluna), set())

            for n, linha in enumerate(valores[1:], start=2):
                if len(linha) <= idx:
                    continue
                bruto = linha[idx].strip()
                if not bruto:
                    continue
                chave = bruto.lower()
                if chave in suspeitos:
                    relatar.append((aba.title, n, coluna, bruto, linha))
                    continue
                canonico = mapa.get(chave)
                if canonico and canonico != bruto:
                    mudancas.append({
                        'aba': aba.title,
                        'celula': '%s%d' % (col_letra(idx), n),
                        'coluna': coluna,
                        'valor_antigo': bruto,
                        'valor_novo': canonico,
                        'motivo': 'normalizacao de dominio antes da lista suspensa',
                    })

    print('\nbackup das %d abas em %s' % (len(planilha.worksheets()), destino))

    print('\n--- %d celulas a normalizar ---' % len(mudancas))
    resumo = {}
    for m in mudancas:
        k = (m['aba'], m['coluna'], m['valor_antigo'], m['valor_novo'])
        resumo[k] = resumo.get(k, 0) + 1
    for (aba, coluna, antigo, novo), n in sorted(resumo.items()):
        print('  %-14s %-10s %-22r -> %-14r  %d celula(s)' % (aba, coluna, antigo, novo, n))

    if relatar:
        print('\n--- %d celulas com valor FORA do dominio (nao toco) ---' % len(relatar))
        for aba, n, coluna, bruto, linha in relatar:
            print('  %s linha %d  %s=%r   | id=%s status=%s item=%.40s'
                  % (aba, n, coluna, bruto, linha[0], linha[9], linha[5]))

    if not APLICAR:
        print('\nDry run. Rode com --aplicar para gravar.')
        return

    trilha = RAIZ / 'normalizacoes.csv'
    novo_arquivo = not trilha.exists()
    with open(trilha, 'a', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, ['data', 'aba', 'celula', 'coluna',
                               'valor_antigo', 'valor_novo', 'motivo'])
        if novo_arquivo:
            w.writeheader()
        hoje = datetime.date.today().isoformat()
        for m in mudancas:
            aba = planilha.worksheet(m['aba'])
            aba.update_acell(m['celula'], m['valor_novo'])
            w.writerow(dict(m, data=hoje))
            print('  gravado %s!%s = %s' % (m['aba'], m['celula'], m['valor_novo']))
            time.sleep(1.2)   # quota do gspread; ver engenharia.md

    print('\n%d celulas gravadas, trilha em %s' % (len(mudancas), trilha))


if __name__ == '__main__':
    main()
