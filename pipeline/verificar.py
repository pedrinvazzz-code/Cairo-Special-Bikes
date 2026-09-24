"""
Verificacao pos-carga: confere invariantes no Supabase depois do load, para
nao deixar uma carga "verde" com dado errado passar em silencio.

Foi exatamente isso que faltou no bug do fmt_rm_valor: 1.236 execucoes do
pipeline terminaram "com sucesso" gravando total_vendas_real 1000x menor que
o real em 30 meses, porque nada conferia o numero depois de gravar.
"""
import os

import requests

from load import CHAVES, get_headers, listar_ids

# Abaixo disso, total_vendas_real cheira ao bug de escala pt_BR (a mesma
# familia do fmt_rm_valor): um valor real da loja nunca fica abaixo de R$1.000.
LIMIAR_TOTAL_VENDAS_MIN = 1000


def _get(tabela, select, filtro=''):
    url = f"{os.environ['SUPABASE_URL']}/rest/v1/{tabela}?select={select}{filtro}"
    resp = requests.get(url, headers=get_headers())
    resp.raise_for_status()
    return resp.json()


def verificar(dados):
    problemas = []

    # 1) contagem no banco bate com a planilha, tabela a tabela — pega upsert
    #    parcial, leitura incompleta da planilha ou apagar_sumidos zerando algo
    for tabela, chave in CHAVES.items():
        registros = dados.get(tabela) or []
        if not registros:
            continue
        esperado = {r.get(chave) for r in registros if r.get(chave) is not None}
        atual = listar_ids(tabela, chave)
        if atual is None:
            problemas.append(f"{tabela}: não consegui contar os registros no banco")
        elif atual != esperado:
            faltando = esperado - atual
            sobrando = atual - esperado
            detalhe = []
            if faltando:
                detalhe.append(f"{len(faltando)} da planilha não estão no banco")
            if sobrando:
                detalhe.append(f"{len(sobrando)} no banco não estão na planilha")
            problemas.append(f"{tabela}: banco e planilha divergem ({', '.join(detalhe)})")

    # 2) sinal direto do bug de escala pt_BR voltando no resumo mensal
    linhas = _get(
        'resumo_mensal', 'mes,total_vendas_real',
        f'&total_vendas_real=lt.{LIMIAR_TOTAL_VENDAS_MIN}&total_vendas_real=not.is.null',
    )
    if linhas:
        meses = ', '.join(f"{l['mes']} (R${l['total_vendas_real']})" for l in linhas)
        problemas.append(
            f"{len(linhas)} mês(es) em resumo_mensal com total_vendas_real < "
            f"R${LIMIAR_TOTAL_VENDAS_MIN} — sinal do bug de escala pt_BR: {meses}"
        )

    # 3) consignação Vendido sem valor ou sem data de saída
    linhas = _get(
        'consignacoes', 'id_consignacao,valor,data_saida',
        '&status=eq.Vendido&or=(valor.is.null,data_saida.is.null)',
    )
    if linhas:
        ids = ', '.join(str(l['id_consignacao']) for l in linhas)
        problemas.append(f"{len(linhas)} consignação(ões) Vendido sem valor ou data_saida: {ids}")

    if problemas:
        for p in problemas:
            print(f"  ✗ {p}")
        raise RuntimeError(f"{len(problemas)} invariante(s) pós-carga falharam — veja acima")

    print("  ✓ verificação pós-carga: invariantes ok")
