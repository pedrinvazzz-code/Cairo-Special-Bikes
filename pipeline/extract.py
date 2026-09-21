from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent.parent / '.env')

import pandas as pd
import os

from sheets import get_client, SCOPES_LEITURA


ABAS = {
    'Consignações':  'consignacoes',
    'Proprietários': 'proprietarios',
    'Bicicletas':    'bicicletas',
    'Componentes':   'componentes',
    'Resumo Mensal': 'resumo_mensal',
}


def _linha_cabecalho(valores, marcador, max_linhas=5):
    """Acha a linha real de cabecalho procurando uma celula que bata com o
    marcador (case-insensitive), em vez de assumir que e sempre a linha 0.

    A aba Resumo Mensal tem a primeira linha do Sheets em branco/mesclada, com
    o cabecalho de verdade na linha seguinte — sem isso o pipeline lia o
    cabecalho errado e so funcionava porque o resto do codigo remontava as
    colunas por posicao fixa (que quebra se alguem reordenar uma coluna).
    """
    alvo = marcador.strip().lower()
    for i, linha in enumerate(valores[:max_linhas]):
        if any(str(c).strip().lower() == alvo for c in linha):
            return i
    return 0


def extract():
    client = get_client(SCOPES_LEITURA)
    sheet_id = os.environ['SHEET_ID']
    planilha = client.open_by_key(sheet_id)

    dados = {}
    for aba_nome, chave in ABAS.items():
        try:
            aba = planilha.worksheet(aba_nome)
            valores = aba.get_all_values()
            if not valores:
                dados[chave] = pd.DataFrame()
                continue
            idx = _linha_cabecalho(valores, 'mês') if aba_nome == 'Resumo Mensal' else 0
            cabecalho = [str(c).strip() for c in valores[idx]]
            linhas = valores[idx + 1:]
            dados[chave] = pd.DataFrame(linhas, columns=cabecalho)
            print(f"  ✓ {aba_nome}: {len(dados[chave])} linhas")
        except Exception as e:
            print(f"  ✗ Erro ao ler {aba_nome}: {e}")
            dados[chave] = pd.DataFrame()

    return dados
