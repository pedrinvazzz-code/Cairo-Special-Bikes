import pandas as pd
import re


STATUS_MAP = {
    'vendido':    'Vendido',
    'em estoque': 'Em estoque',
    'retirado':   'Retirado',
}


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


def fmt_date(v):
    try:
        d = pd.to_datetime(v, dayfirst=True)
        if pd.isna(d):
            return None
        if d.year > 2026: # Vamos permitir o ano todo de 2026
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
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip().replace('R$', '').replace(',', '').replace(' ', '')
    if s in ('A confirmar', 'confirmar', 'nan', 'None', ''):
        return None
    try:
        return float(s)
    except:
        return None


def transform(dados):
    resultado = {}

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
        resultado['consignacoes'].append({
            'id_consignacao': id_,
            'id_bike':        id_bike,
            'id_componente':  id_comp,
            'id_cliente':     safe_int(row.get('ID_Cliente')),
            'tipo':           fmt_val(row.get('Tipo')),
            'item_produto':   fmt_val(row.get('Item / Produto')),
            'proprietario':   fmt_val(row.get('Proprietário')),
            'valor':          fmt_valor(row.get('Valor (R$)')),
            'loja':           fmt_val(row.get('Loja')),
            'status':         fmt_status(row.get('Status')),
            'data_entrada':   fmt_date(row.get('Data Entrada')),
            'data_saida':     fmt_date(row.get('Data Saída')),
            'observacoes':    fmt_val(row.get('Observações')),
        })
    if skipped:
        print(f"  ⚠ {skipped} consignações ignoradas por FK inválida")

    # Resumo Mensal
    df = dados['resumo_mensal'].copy()
    if len(df.columns) >= 7:
        df.columns = ['Mes','Bikes','Comps','Total_Entradas','Val_Bikes','Val_Comps','Total_Vendas'] + list(df.columns[7:])
    df = df[df['Mes'].astype(str).str.match(r'\d{4}-\d{2}')]  
    resultado['resumo_mensal'] = []
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
