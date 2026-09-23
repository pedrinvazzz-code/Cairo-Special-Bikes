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
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

from sheets import get_client

APLICAR = '--aplicar' in sys.argv

# ID_Bike, Nome/Descrição, Marca, Modelo, Ano, Categoria, Tamanho, Material, Status
BICICLETAS_NOVAS = [
    ['342', 'Bicicleta Cervelo P series', 'Cervelo', 'P series', '',
     'Triathlon', '', 'Carbono', 'Vendido', ''],
    # A Corratec CCT EVO Sram Force AXS chegou a ser preparada aqui, porque o Excel
    # e o site a listavam em estoque. Em 21/09 o cliente confirmou que ela foi
    # RETIRADA. A linha saiu de proposito: cadastrar criaria estoque fantasma de
    # R$35.900. E o exemplo de por que duas fontes concordando nao bastam quando as
    # duas compartilham o mesmo defeito (nenhuma e limpa quando o item sai).
    ['343', 'Bicicleta Specialized Roubaix Carbono SRAM Apex', 'Specialized',
     'Roubaix SL4 Sram Apex 2x10v', '2013', 'Speed', '56', 'Carbono', 'Em estoque', ''],
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
    # Em estoque, nao venda. Presenca fisica CONFIRMADA pelo cliente em 21/09.
    # Nunca foi cadastrada: as seis Roubaix da planilha estao todas vendidas, e a
    # mais proxima em valor (#194, R$7.500) faz parte do trio #192/#193/#194, a
    # mesma bike fisica contada tres vezes.
    # Valor = R$7.500, o preco CHEIO: o anuncio do site diz "De: R$7.500,00
    # Por: R$6.500,00", e o Excel registra 7500 em todas as abas de jan a set.
    # Em item de estoque a planilha guarda o preco de tabela, nao o promocional.
    # Dono: ID 105. O Excel traz um telefone que o cadastro desse ID ainda nao
    # tem -- vale acrescentar.
    # Data de entrada fica em branco: nenhuma fonte registra. Aparece sem vermelho
    # desde a aba de janeiro, entao entrou antes de 2026. Chutar 01/01 criaria
    # justamente a data-marcador que este projeto passou a auditoria inteira
    # tentando eliminar.
    ['626', '343', '', '105', 'Bicicleta', 'Bicicleta Specialized Roubaix Carbono SRAM Apex',
     'Mauricio', '7500', 'Física', 'Em estoque', '', '',
     'cadastro retroativo: em estoque no controle da loja e publicado no site; presenca confirmada pelo cliente em 21/09; data de entrada nao registrada em nenhuma fonte'],
]


def main():
    planilha = get_client().open_by_key(os.environ['SHEET_ID'])

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
