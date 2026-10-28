"""
Testes do upsert de load.py, sem Supabase de verdade (roda com
`python test_load.py`). O requests.post é trocado por um falso que imita o
PostgREST: recusa o lote inteiro se um registro tiver nome vazio — foi o que
aconteceu com o proprietário 244 sem nome, que derrubou o lote dele e, em
cascata, as consignações do 245.
"""
import json
import os

os.environ.setdefault('SUPABASE_URL', 'http://falso')
os.environ.setdefault('SUPABASE_KEY', 'falsa')

import load


class Resposta:
    def __init__(self, status_code, corpo):
        self.status_code = status_code
        self.text = json.dumps(corpo)
        self._corpo = corpo

    def json(self):
        return self._corpo


class SupabaseFalso:
    """Guarda as chamadas e os registros aceitos; recusa o lote com nome vazio."""

    def __init__(self, status_fixo=None):
        self.chamadas = 0
        self.aceitos = []
        self.status_fixo = status_fixo

    def post(self, url, json, headers):
        self.chamadas += 1
        if self.status_fixo:
            return Resposta(self.status_fixo, {'message': 'fora do ar'})
        if any('nome' in r and r['nome'] is None for r in json):
            return Resposta(400, {
                'code': '23502',
                'details': 'Failing row contains (...)',
                'message': 'null value in column "nome" of relation "proprietarios"',
            })
        self.aceitos.extend(json)
        return Resposta(201, [])


def proprietarios(ids, sem_nome=()):
    return [{'id_cliente': i, 'nome': None if i in sem_nome else f'Cliente {i}',
             'contato': None, 'cidade': None} for i in ids]


def caso(nome, falso, tabela, registros, erros_esperados, aceitos_esperados, chamadas_esperadas):
    load.requests.post = falso.post
    erros = load.upsert(tabela, registros)
    chave = load.CHAVES.get(tabela, 'mes')
    aceitos = sorted(r[chave] for r in falso.aceitos)
    problemas = []
    if erros != erros_esperados:
        problemas.append(f"erros={erros}, esperado {erros_esperados}")
    if aceitos != sorted(aceitos_esperados):
        problemas.append(f"aceitos={aceitos}, esperado {sorted(aceitos_esperados)}")
    if falso.chamadas != chamadas_esperadas:
        problemas.append(f"chamadas={falso.chamadas}, esperado {chamadas_esperadas}")
    for p in problemas:
        print(f"  ✗ {nome}: {p}")
    return 1 if problemas else 0


def main():
    original = load.requests.post
    falhas = 0
    try:
        # lote inteiro bom: uma chamada só, nada reenviado
        falhas += caso('lote bom', SupabaseFalso(), 'proprietarios',
                       proprietarios(range(201, 214)), 0, range(201, 214), 1)

        # o caso real: 244 sem nome no meio do lote — os outros 12 entram,
        # só o 244 conta como erro (1 lote recusado + 13 reenvios)
        ids = range(233, 246)
        falso_244 = SupabaseFalso()
        falhas += caso('um registro ruim', falso_244, 'proprietarios',
                       proprietarios(ids, sem_nome={244}), 1,
                       [i for i in ids if i != 244], 1 + 13)

        # só o lote com problema é reenviado: 150 registros = 2 lotes,
        # o ruim está no segundo (1 + 1 recusado + 50 reenvios)
        ids = range(1, 151)
        falhas += caso('só o lote ruim é reenviado', SupabaseFalso(), 'proprietarios',
                       proprietarios(ids, sem_nome={120}), 1,
                       [i for i in ids if i != 120], 1 + 1 + 50)

        # erro que não é de dado (fora do ar): não reenvia linha por linha
        falhas += caso('fora do ar não reenvia', SupabaseFalso(status_fixo=503), 'proprietarios',
                       proprietarios(range(1, 11)), 1, [], 1)

        # tabela sem chave em CHAVES (resumo_mensal) não quebra a mensagem
        meses = [{'mes': f'2026-0{m}-01', 'nome': None if m == 2 else 'x'} for m in (1, 2, 3)]
        falhas += caso('tabela sem chave', SupabaseFalso(), 'resumo_mensal',
                       meses, 1, ['2026-01-01', '2026-03-01'], 1 + 3)
    finally:
        load.requests.post = original

    total = 5
    if falhas:
        print(f"\n❌ {falhas}/{total} testes do load falharam")
        exit(1)
    print(f"✅ {total}/{total} testes do load passaram")


if __name__ == '__main__':
    main()
