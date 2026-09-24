import pandas as pd
import re


STATUS_MAP = {
    'vendido':    'Vendido',
    'em estoque': 'Em estoque',
    'retirado':   'Retirado',
}

LOJA_MAP = {
    'fisica':   'Física',
    'física':   'Física',
    'online':   'Online',
    'on line':  'Online',
    'on-line':  'Online',
    'retirada': 'Retirada',
}

DIAS_IMPUTACAO_SAIDA = 15


def safe_int(v):
    try:
        s = str(v).strip()
        if not s or s in ('nan', 'None', '', ' '):
            return None
        i = int(float(s))
        return i if i > 0 else None
    except:
        return None


def fmt_val(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    return None if s in ('nan', 'None', '') else s


def fmt_status(v):
    val = fmt_val(v)
    if not val:
        return None
    return STATUS_MAP.get(val.lower(), val)


def fmt_loja(v):
    val = fmt_val(v)
    if not val:
        return None
    return LOJA_MAP.get(val.lower(), val)


def fmt_date(v, id_ref=None, campo=''):
    try:
        d = pd.to_datetime(v, dayfirst=True)
        if pd.isna(d):
            return None
        if d.year > 2030 or d.year < 2020:
            print(f"  ⚠ Data fora da faixa em {campo} (ID {id_ref}): {v}")
            return None
        return d.strftime('%Y-%m-%d')
    except:
        return None


def fmt_valor(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        if isinstance(v, (int, float)):
            f = float(v)
            return None if f < 10 else f
        s = str(v).strip().replace('R$', '').replace(' ', '')
        if re.match(r'^\d{1,3}(,\d{3})*(\.\d+)?$', s):
            s = s.replace(',', '')
        elif re.match(r'^\d{1,3}(\.\d{3})*(,\d+)?$', s):
            s = s.replace('.', '').replace(',', '.')
        f = float(s)
        return None if f < 10 else f
    except:
        return None


def fmt_rm_valor(v):
    # A aba Resumo Mensal mistura os dois formatos: "R$123.456,00" (pt_BR) nas
    # linhas antigas e "R$98,765.00" (en_US) a partir de fev/2026. Tratar só a
    # vírgula como separador transformava 144.100,00 em 144.1 — mil vezes menor.
    # fmt_valor já distingue os dois formatos, então reaproveitamos.
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if str(v).strip().lower() in ('a confirmar', 'confirmar', 'nan', 'none', ''):
        return None
    return fmt_valor(v)


def transform(dados):
    resultado = {}

    for k in dados:
        if isinstance(dados[k], pd.DataFrame) and not dados[k].empty:
            dados[k].columns = [str(c).strip() for c in dados[k].columns]

    # Proprietários
    df = dados['proprietarios'].copy()
    resultado['proprietarios'] = []
    for _, row in df.iterrows():
        id_ = safe_int(row.get('ID_Cliente'))
        if not id_:
            continue
        resultado['proprietarios'].append({
            'id_cliente': id_,
            'nome':       fmt_val(row.get('Nome')),
            'contato':    fmt_val(row.get('Contato')),
            'cidade':     fmt_val(row.get('Cidade')),
        })

    # Bicicletas
    df = dados['bicicletas'].copy()
    resultado['bicicletas'] = []
    for _, row in df.iterrows():
        id_ = safe_int(row.get('ID_Bike'))
        if not id_:
            continue
        try:
            ano = int(float(row.get('Ano'))) if row.get('Ano') else None
        except:
            ano = None
        resultado['bicicletas'].append({
            'id_bike':        id_,
            'nome_descricao': fmt_val(row.get('Nome/Descrição')),
            'marca':          fmt_val(row.get('Marca')),
            'modelo':         fmt_val(row.get('Modelo')),
            'ano':            ano,
            'categoria':      fmt_val(row.get('Categoria')),
            'tamanho':        fmt_val(row.get('Tamanho')),
            'material':       fmt_val(row.get('Material')),
            'status':         fmt_status(row.get('Status')),
        })

    # Componentes
    df = dados['componentes'].copy()
    resultado['componentes'] = []
    for _, row in df.iterrows():
        id_ = safe_int(row.get('ID_Componente'))
        if not id_:
            continue
        resultado['componentes'].append({
            'id_componente':  id_,
            'nome_descricao': fmt_val(row.get('Nome/Descrição')),
            'marca':          fmt_val(row.get('Marca')),
            'categoria':      fmt_val(row.get('Categoria')),
            'status':         fmt_status(row.get('Status')),
        })

    # Consignações
    df = dados['consignacoes'].copy()
    ids_bikes = {r['id_bike'] for r in resultado['bicicletas']}
    ids_comps = {r['id_componente'] for r in resultado['componentes']}
    resultado['consignacoes'] = []
    skipped = 0
    imputadas = 0
    for _, row in df.iterrows():
        id_ = safe_int(row.get('ID_Consignação'))
        if not id_:
            continue
        id_bike = safe_int(row.get('ID_Bike'))
        id_comp = safe_int(row.get('ID_Componente'))
        # Validar FK
        if id_bike and id_bike not in ids_bikes:
            skipped += 1
            continue
        if id_comp and id_comp not in ids_comps:
            skipped += 1
            continue
        # Obter valor com fallback flexivel
        val_raw = row.get('Valor (R$)')
        if val_raw is None:
            for col_name in row.index:
                if 'valor' in str(col_name).lower():
                    val_raw = row[col_name]
                    break

        status = fmt_status(row.get('Status'))
        data_entrada = fmt_date(row.get('Data Entrada'), id_, 'Data Entrada')
        data_saida = fmt_date(row.get('Data Saída'), id_, 'Data Saída')

        # Vendido sem data de saída: imputa entrada + 15 dias (regra do relatório)
        if status == 'Vendido' and data_saida is None and data_entrada:
            data_saida = (pd.to_datetime(data_entrada) + pd.Timedelta(days=DIAS_IMPUTACAO_SAIDA)).strftime('%Y-%m-%d')
            imputadas += 1

        # Saída antes ou igual à entrada: só avisa, não altera
        if data_entrada and data_saida and data_saida <= data_entrada:
            print(f"  ⚠ Saída <= entrada (ID {id_}): {data_entrada} -> {data_saida}")

        resultado['consignacoes'].append({
            'id_consignacao': id_,
            'id_bike':        id_bike,
            'id_componente':  id_comp,
            'id_cliente':     safe_int(row.get('ID_Cliente')),
            'tipo':           fmt_val(row.get('Tipo')),
            'item_produto':   fmt_val(row.get('Item / Produto')),
            'proprietario':   fmt_val(row.get('Proprietário')),
            'valor':          fmt_valor(val_raw),
            'loja':           fmt_loja(row.get('Loja')),
            'status':         status,
            'data_entrada':   data_entrada,
            'data_saida':     data_saida,
            'observacoes':    fmt_val(row.get('Observações')),
        })
    if skipped:
        print(f"  ⚠ {skipped} consignações ignoradas por FK inválida")
    if imputadas:
        print(f"  ℹ {imputadas} vendidos sem Data Saída receberam entrada + {DIAS_IMPUTACAO_SAIDA} dias")

    # Resumo Mensal
    df = dados['resumo_mensal'].copy()
    resultado['resumo_mensal'] = []
    if df.empty:
        print("  ⚠ Resumo Mensal vazio, pulando")
        df = df.iloc[0:0]
    else:
        # Ancora pelo nome real da coluna "Mês" em vez de assumir que ela é
        # sempre a coluna 0 — protege contra reordenação de colunas na aba.
        cols = list(df.columns)
        idx_mes = next((i for i, c in enumerate(cols) if str(c).strip().lower() in ('mês', 'mes')), None)
        if idx_mes is None or idx_mes + 6 >= len(cols):
            print("  ⚠ Resumo Mensal: coluna 'Mês' não encontrada ou faltam colunas depois dela, pulando")
            df = df.iloc[0:0]
        else:
            df = df[cols[idx_mes:idx_mes + 7]].copy()
            df.columns = ['Mes', 'Bikes', 'Comps', 'Total_Entradas', 'Val_Bikes', 'Val_Comps', 'Total_Vendas']
            df = df[df['Mes'].astype(str).str.match(r'\d{4}-\d{2}')]
    for _, row in df.iterrows():
        mes = str(row.get('Mes', '')).strip()[:7]
        if not mes or mes == 'nan':
            continue
        try:
            bikes = int(float(row.get('Bikes', 0))) if row.get('Bikes') else None
            comps = int(float(row.get('Comps', 0))) if row.get('Comps') else None
            total = int(float(row.get('Total_Entradas', 0))) if row.get('Total_Entradas') else None
        except:
            bikes = comps = total = None
        resultado['resumo_mensal'].append({
            'mes':                  mes + '-01',
            'bikes_entrada':        bikes,
            'comps_entrada':        comps,
            'total_entradas':       total,
            'valor_vendido_bikes':  fmt_rm_valor(row.get('Val_Bikes')),
            'valor_vendido_comps':  fmt_rm_valor(row.get('Val_Comps')),
            'total_vendas_real':    fmt_rm_valor(row.get('Total_Vendas')),
        })

    # Sumário
    for tabela, registros in resultado.items():
        print(f"  ✓ {tabela}: {len(registros)} registros válidos")

    return resultado
