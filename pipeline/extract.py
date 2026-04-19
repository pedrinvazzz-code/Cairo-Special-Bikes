from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent.parent / '.env')

import gspread
import pandas as pd
from google.oauth2.service_account import Credentials
import json
import os


SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
]

ABAS = {
    'Consignações':  'consignacoes',
    'Proprietários': 'proprietarios',
    'Bicicletas':    'bicicletas',
    'Componentes':   'componentes',
    'Resumo Mensal': 'resumo_mensal',
}


def get_client():
    creds_json = json.loads(os.environ['GOOGLE_CREDENTIALS'])
    creds = Credentials.from_service_account_info(creds_json, scopes=SCOPES)
    return gspread.authorize(creds)


def extract():
    client = get_client()
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
            cabecalho = valores[0]
            linhas = valores[1:]
            dados[chave] = pd.DataFrame(linhas, columns=cabecalho)
            print(f"  ✓ {aba_nome}: {len(dados[chave])} linhas")
        except Exception as e:
            print(f"  ✗ Erro ao ler {aba_nome}: {e}")
            dados[chave] = pd.DataFrame()

    return dados