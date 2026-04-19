from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env')

import gspread, json, os
from google.oauth2.service_account import Credentials

creds = Credentials.from_service_account_info(
    json.loads(os.environ['GOOGLE_CREDENTIALS']),
    scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
)
client = gspread.authorize(creds)
aba = client.open_by_key(os.environ['SHEET_ID']).worksheet('Consignações')
dados = aba.get_all_values()
cabecalho = dados[0]

col_id   = cabecalho.index('ID_Consignação')
col_bike = cabecalho.index('ID_Bike')
col_comp = cabecalho.index('ID_Componente')
col_item = cabecalho.index('Item / Produto')

ids_buscar = {'120', '212', '235', '470'}

for linha in dados[1:]:
    if linha[col_id] in ids_buscar:
        print(f"ID {linha[col_id]} | Bike={linha[col_bike]} | Comp={linha[col_comp]} | {linha[col_item][:50]}")