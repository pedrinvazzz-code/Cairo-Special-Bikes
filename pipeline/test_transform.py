"""
Testes dos parsers de transform.py, sem dependencia externa (roda com
`python test_transform.py`). Cobre os formatos que ja apareceram de verdade
na planilha, incluindo os que ja causaram bug: fmt_rm_valor misturando
"R$144.100,00" (pt_BR) e "R$56,190.00" (en_US) na mesma coluna foi o que
gerou 30 meses de total_vendas_real 1000x menor no Supabase.

Os valores esperados foram conferidos rodando as funcoes reais, nao
inventados — servem de trava de regressao, nao de especificacao ideal.
"""
import math

from transform import fmt_valor, fmt_rm_valor, fmt_status, fmt_loja, safe_int

# (entrada, esperado) — comparação especial para NaN feita à parte
CASOS_FMT_VALOR = [
    ('R$144.100,00', 144100.0),   # pt_BR, o formato antigo da planilha
    ('R$56,190.00', 56190.0),     # en_US, passou a aparecer a partir de fev/2026
    ('R$ 25.000,00', 25000.0),    # com espaço depois do R$
    ('1.234.567,89', 1234567.89),  # pt_BR com mais de um separador de milhar
    ('18500', 18500.0),
    (18500, 18500.0),
    (None, None),
    ('', None),
    ('abc', None),
    (5, None),                    # abaixo do mínimo de 10 — tratado como ausência
]

CASOS_FMT_RM_VALOR = [
    ('R$144.100,00', 144100.0),
    ('R$56,190.00', 56190.0),
    ('A confirmar', None),
    ('confirmar', None),
    ('Confirmar ', None),
    ('', None),
    (None, None),
]

CASOS_FMT_STATUS = [
    ('vendido', 'Vendido'),
    ('Vendido', 'Vendido'),
    ('em estoque', 'Em estoque'),
    ('retirado', 'Retirado'),
    ('Outro', 'Outro'),  # valor não mapeado passa como veio
    (None, None),
]

CASOS_FMT_LOJA = [
    ('fisica', 'Física'),
    ('física', 'Física'),
    ('on line', 'Online'),
    ('on-line', 'Online'),
    ('Online', 'Online'),
    (None, None),
]

CASOS_SAFE_INT = [
    ('618', 618),
    ('0', None),   # zero não é um ID válido
    ('', None),
    (None, None),
    ('abc', None),
    (42.0, 42),
    ('-5', None),  # negativo também não é ID válido
]


def rodar(nome, fn, casos):
    falhas = 0
    for entrada, esperado in casos:
        obtido = fn(entrada)
        ok = (obtido == esperado) or (isinstance(obtido, float) and isinstance(esperado, float)
                                       and math.isnan(obtido) and math.isnan(esperado))
        if not ok:
            print(f"  ✗ {nome}({entrada!r}) = {obtido!r}, esperado {esperado!r}")
            falhas += 1
    return falhas


def main():
    falhas = 0
    falhas += rodar('fmt_valor', fmt_valor, CASOS_FMT_VALOR)
    falhas += rodar('fmt_rm_valor', fmt_rm_valor, CASOS_FMT_RM_VALOR)
    falhas += rodar('fmt_status', fmt_status, CASOS_FMT_STATUS)
    falhas += rodar('fmt_loja', fmt_loja, CASOS_FMT_LOJA)
    falhas += rodar('safe_int', safe_int, CASOS_SAFE_INT)

    total = sum(len(c) for c in (
        CASOS_FMT_VALOR, CASOS_FMT_RM_VALOR, CASOS_FMT_STATUS, CASOS_FMT_LOJA, CASOS_SAFE_INT,
    ))
    if falhas:
        print(f"\n❌ {falhas}/{total} testes falharam")
        exit(1)
    print(f"✅ {total}/{total} testes passaram")


if __name__ == '__main__':
    main()
