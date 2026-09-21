"""
Cliente gspread compartilhado.

Antes, o bloco de autenticacao (ler GOOGLE_CREDENTIALS, montar Credentials,
chamar gspread.authorize) estava duplicado em extract.py, aplicar_correcoes.py,
cadastrar_vendas.py e deduplicar_proprietarios.py. Este modulo centraliza isso.
"""
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent.parent / '.env')

import json
import os

import gspread
from google.oauth2.service_account import Credentials

SCOPES_LEITURA = [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
]
SCOPES_ESCRITA = ['https://www.googleapis.com/auth/spreadsheets']


def get_client(scopes=SCOPES_ESCRITA):
    creds_json = json.loads(os.environ['GOOGLE_CREDENTIALS'])
    creds = Credentials.from_service_account_info(creds_json, scopes=scopes)
    return gspread.authorize(creds)
