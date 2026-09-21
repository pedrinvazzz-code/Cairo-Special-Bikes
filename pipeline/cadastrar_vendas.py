"""
Cadastra no Google Sheets os itens que existiam só no controle da loja —
vendas que nunca foram lançadas e, no caso da Corratec, estoque nunca cadastrado.

Uso:
    python cadastrar_vendas.py            # só mostra o que faria (dry run)
    python cadastrar_vendas.py --aplicar  # grava de verdade

Cada linha aqui foi confirmada com o cliente e cruzada com a planilha de
Excel da loja. Onde o cliente lembrava o mês mas não o dia, usamos o dia 15
e registramos isso na coluna de observações.
"""
import json
import os
import sys
from pathlib import Path

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv(Path(__file__).parent.parent / '.env')

SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
APLICAR = '--aplicar' in sys.argv

# ID_Bike, Nome/Descrição, Marca, Modelo, Ano, Categoria, Tamanho, Material, Status
BICICLETAS_NOVAS = [
    ['342', 'Bicicleta Cervelo P series', 'Cervelo', 'P series', '',
     'Triathlon', '', 'Carbono', 'Vendido', ''],
    # Espelha a ID_Bike 207 (a outra CCT EVO): Corratec / Speed / Carbono.
    # Ano e tamanho ficam em branco porque nao temos.
    ['343', 'Bicicleta Corratec CCT EVO Sram Force AXS 12v', 'Corratec',
     'CCT EVO Sram Force AXS 12v', '', 'Speed', '', 'Carbono', 'Em estoque', ''],
]

# ID_Consignação, ID_Bike, ID_Componente, ID_Cliente, Tipo, Item / Produto,
# Proprietário, Valor (R$), Loja, Status, Data Entrada, Data Saída, Observações
CONSIGNACOES_NOVAS = [
    ['623', '342', '', '', 'Bicicleta', 'Bicicleta Cervelo P series', '',
     '43900', '', 'Vendido', '22/06/2026', '28/07/2026',
     'cadastro retroativo: venda constava so no controle da loja; proprietario nao identificado'],
    ['624', '117', '', '87', 'Bicicleta', 'Bicicleta MTB Cannondale F-Si carbon 4',
     'Lucas Graboski', '11900', '', 'Vendido', '15/06/2025', '15/07/2026',
     'cadastro retroativo: 2a passagem da bike; mes confirmado pelo cliente, dia 15 estimado'],
    ['625', '223', '', '20', 'Bicicleta', 'Bicicleta para triathlon #felt IA FRD 2.0 Ultimate',
     'Cairo Henrique', '60000', '', 'Vendido', '01/08/2026', '25/08/2026',
     'cadastro retroativo: 2a passagem da bike; datas e valor conferidos na planilha da loja'],
    # Em estoque, nao venda. Nunca foi cadastrada: as tres Corratec da planilha
    # estao vendidas e nenhuma e esta (a 26 e Sram RED AXS, de 2025, do Cairo).
    # Duas fontes independentes dizem que esta na loja: o Excel lista em agosto e
    # setembro sem pintar de vermelho, e o site publica como disponivel.
    # Valor = R$35.900, o preco CHEIO. O anuncio do site diz "De: R$35.900,00
    # Por: R$31.900,00" -- os R$31.900 sao promocionais. Em item de estoque a
    # planilha guarda o preco de tabela (conferido em 4 bikes com De/Por).
    # Dono identificado pelo telefone 34 9860-4188 = ID 74 (Kaio carbono).
    ['626', '343', '', '74', 'Bicicleta', 'Bicicleta Corratec CCT EVO Sram Force AXS 12v',
     'Kaio carbono', '35900', 'Física', 'Em estoque', '15/06/2026', '',
     'cadastro retroativo: em estoque no controle da loja e publicado no site, sem registro na planilha'],
]


def main():
    creds = Credentials.from_service_account_info(
        json.loads(os.environ['GOOGLE_CREDENTIALS']), scopes=SCOPES)
    planilha = gspread.authorize(creds).open_by_key(os.environ['SHEET_ID'])

    for aba_nome, col_id, novas in [('Bicicletas', 'ID_Bike', BICICLETAS_NOVAS),
                                    ('Consignações', 'ID_Consignação', CONSIGNACOES_NOVAS)]:
        aba = planilha.worksheet(aba_nome)
        valores = aba.get_all_values()
        cabecalho = [c.strip() for c in valores[0]]
        col = cabecalho.index(col_id)
        existentes = {l[col].strip() for l in valores[1:] if l[col].strip()}

        print(f"\n{aba_nome} ({len(valores) - 1} linhas hoje)")
        for linha in novas:
            if linha[0] in existentes:
                print(f"  ✗ {col_id} {linha[0]} já existe, pulando")
                continue
            resumo = ' | '.join(x for x in linha[:8] if x)
            print(f"  + {resumo}")
            if APLICAR:
                aba.append_row(linha, value_input_option='USER_ENTERED')

    if not APLICAR:
        print("\nDry run. Rode com --aplicar para gravar.")


if __name__ == '__main__':
    main()
