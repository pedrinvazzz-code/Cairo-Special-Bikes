from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent.parent / '.env')

import requests
import os


def get_headers():
    return {
        'apikey':        os.environ['SUPABASE_KEY'],
        'Authorization': f"Bearer {os.environ['SUPABASE_KEY']}",
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
    }


def upsert(tabela, registros, chunk_size=100):
    if not registros:
        print(f"  - {tabela}: nenhum registro para enviar")
        return

    url = f"{os.environ['SUPABASE_URL']}/rest/v1/{tabela}"
    headers = get_headers()
    total = 0

    # Garantir que todos os registros do lote têm as mesmas chaves
    todas_chaves = set()
    for r in registros:
        todas_chaves.update(r.keys())

    for i in range(0, len(registros), chunk_size):
        chunk = registros[i:i + chunk_size]
        # Normalizar: todos os registros devem ter as mesmas chaves (None para ausentes)
        chunk_normalizado = [{k: r.get(k, None) for k in todas_chaves} for r in chunk]

        resp = requests.post(url, json=chunk_normalizado, headers=headers)

        if resp.status_code in (200, 201):
            total += len(chunk)
        else:
            print(f"  ✗ Erro em {tabela} (lote {i//chunk_size + 1}): {resp.status_code} — {resp.text[:200]}")

    print(f"  ✓ {tabela}: {total} registros enviados")


def load(dados):
    ordem = ['proprietarios', 'bicicletas', 'componentes', 'consignacoes', 'resumo_mensal']
    for tabela in ordem:
        if tabela in dados:
            upsert(tabela, dados[tabela])