from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent.parent / '.env')

import requests
import os


# coluna que é a chave primária de cada tabela, usada na limpeza
CHAVES = {
    'proprietarios': 'id_cliente',
    'bicicletas':    'id_bike',
    'componentes':   'id_componente',
    'consignacoes':  'id_consignacao',
}

# se aparecer mais que isso para apagar, provavelmente a leitura da planilha
# veio incompleta — melhor avisar do que apagar o banco por engano
LIMITE_DELECAO = 50


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
        return 0

    url = f"{os.environ['SUPABASE_URL']}/rest/v1/{tabela}"
    headers = get_headers()
    total = 0
    erros = 0

    # Garantir que todos os registros do lote têm as mesmas chaves
    todas_chaves = set()
    for r in registros:
        todas_chaves.update(r.keys())

    # o Postgres recusa o upsert se a mesma PK vier duas vezes no lote, e isso
    # derruba o lote inteiro — então avisa e manda só a última ocorrência
    chave = CHAVES.get(tabela)
    if chave:
        unicos = {}
        for r in registros:
            unicos[r.get(chave)] = r
        if len(unicos) < len(registros):
            repetidos = len(registros) - len(unicos)
            print(f"  ⚠ {tabela}: {repetidos} registro(s) com {chave} repetido na planilha, "
                  f"mandando só a última ocorrência de cada")
            registros = list(unicos.values())

    for i in range(0, len(registros), chunk_size):
        chunk = registros[i:i + chunk_size]
        # Normalizar: todos os registros devem ter as mesmas chaves (None para ausentes)
        chunk_normalizado = [{k: r.get(k, None) for k in todas_chaves} for r in chunk]

        resp = requests.post(url, json=chunk_normalizado, headers=headers)

        if resp.status_code in (200, 201):
            total += len(chunk)
        else:
            print(f"  ✗ Erro em {tabela} (lote {i//chunk_size + 1}): {resp.status_code} — {resp.text[:200]}")
            erros += 1

    print(f"  ✓ {tabela}: {total} registros enviados")
    return erros


def listar_ids(tabela, chave):
    """Lê todos os IDs que existem hoje no banco (paginado, o padrão corta em 1000)."""
    ids = set()
    passo = 1000
    offset = 0
    while True:
        url = (f"{os.environ['SUPABASE_URL']}/rest/v1/{tabela}"
               f"?select={chave}&order={chave}&limit={passo}&offset={offset}")
        resp = requests.get(url, headers=get_headers())
        if resp.status_code != 200:
            print(f"  ✗ Não consegui listar {tabela}: {resp.status_code} — {resp.text[:200]}")
            return None
        lote = resp.json()
        ids.update(r[chave] for r in lote if r[chave] is not None)
        if len(lote) < passo:
            return ids
        offset += passo


def apagar_sumidos(tabela, registros):
    """Apaga do banco o que não existe mais na planilha (a planilha é a fonte da verdade)."""
    chave = CHAVES.get(tabela)
    if not chave or not registros:
        return 0

    ids_banco = listar_ids(tabela, chave)
    if ids_banco is None:
        return 1

    ids_planilha = {r.get(chave) for r in registros if r.get(chave) is not None}
    sobrando = sorted(ids_banco - ids_planilha)
    if not sobrando:
        return 0

    if len(sobrando) > LIMITE_DELECAO:
        print(f"  ⚠ {tabela}: {len(sobrando)} registros sobrando, acima do limite de "
              f"{LIMITE_DELECAO} — não vou apagar, confira a planilha")
        return 1

    lista = ','.join(str(i) for i in sobrando)
    url = f"{os.environ['SUPABASE_URL']}/rest/v1/{tabela}?{chave}=in.({lista})"
    resp = requests.delete(url, headers=get_headers())
    if resp.status_code in (200, 204):
        print(f"  ✓ {tabela}: {len(sobrando)} apagados (não estão mais na planilha): {lista}")
        return 0

    print(f"  ✗ Erro ao apagar em {tabela}: {resp.status_code} — {resp.text[:200]}")
    return 1


def load(dados):
    ordem = ['proprietarios', 'bicicletas', 'componentes', 'consignacoes', 'resumo_mensal']
    erros = 0

    for tabela in ordem:
        if tabela in dados:
            erros += upsert(tabela, dados[tabela])

    # limpeza na ordem inversa por causa das chaves estrangeiras:
    # consignacoes aponta para as outras, então sai primeiro
    for tabela in reversed(ordem):
        if tabela in dados:
            erros += apagar_sumidos(tabela, dados[tabela])

    if erros:
        raise RuntimeError(f"{erros} falha(s) na carga — veja os erros acima")
