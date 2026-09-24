/**
 * Cairo Special Bikes — formulário de entrada e saída.
 *
 * App web, não barra lateral: barra lateral não abre no app do Google Sheets
 * no celular, e é no celular que a loja preenche.
 *
 * O que ele resolve:
 *
 *   Cadastrar uma bike hoje mexe em três abas — Proprietários, Bicicletas e
 *   Consignações — e exige digitar dois IDs à mão. Fechar uma venda exige
 *   mudar o status em dois lugares. Em 22/09/2026, 34 itens de 589 estavam
 *   com as duas versões do status divergentes.
 *
 *   Aqui a pessoa preenche uma tela só e o script escreve onde precisa.
 *
 * IMPORTANTE: o gatilho onEdit do Codigo.gs NÃO dispara em escrita por script.
 * Por isso a propagação de status está repetida aqui, de propósito.
 *
 * Implantação (Implantar → Nova implantação → App da Web):
 *   Executar como:      Usuário que acessa o app da Web
 *   Quem pode acessar:  Qualquer pessoa com Conta do Google
 *
 * Com "executar como usuário que acessa", quem abrir o link escreve com a
 * própria permissão. Quem não tem acesso de edição à planilha simplesmente não
 * consegue gravar. O controle de acesso é o compartilhamento da planilha, e não
 * uma lista de e-mails para alguém manter.
 */

var ABAS = {
  consignacoes: 'Consignações',
  bicicletas:   'Bicicletas',
  componentes:  'Componentes',
  proprietarios:'Proprietários'
};

var TIPO_BIKE = 'Bicicleta';
var TIPO_COMP = 'Componente/Acessório';


/**
 * O nome do arquivo HTML é digitado à mão na criação do projeto, e o Apps Script
 * não aceita dois arquivos com o mesmo nome-base — nem sendo um .gs e outro
 * .html. Então o HTML acaba ganhando um sufixo. Em vez de amarrar o código a
 * uma grafia, tenta as prováveis e, se nenhuma existir, diz o que fazer.
 *
 * Na instalação de 22/09 o arquivo ficou como "Formulário_visual".
 */
function doGet() {
  var candidatos = ['Formulário_visual', 'Formulario_visual',
                    'Formulario', 'Formulário', 'formulario', 'Form'];
  for (var i = 0; i < candidatos.length; i++) {
    try {
      return HtmlService.createHtmlOutputFromFile(candidatos[i])
        .setTitle('Cairo Special Bikes')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    } catch (e) {
      // não existe com esse nome, tenta o próximo
    }
  }
  return HtmlService.createHtmlOutput(
    '<p style="font-family:system-ui;padding:24px;line-height:1.6">' +
    'Falta o arquivo HTML. No editor do Apps Script: <b>+</b> ao lado de Arquivos ' +
    '&rarr; <b>HTML</b> &rarr; nome <b>Formulario</b> (sem acento) &rarr; cole o ' +
    'conteúdo de Formulario.html.</p>');
}


// ---------------------------------------------------------------- utilidades

function aba_(chave) {
  return SpreadsheetApp.getActive().getSheetByName(ABAS[chave]);
}

/** cabeçalho -> coluna (1-based). Lido por nome: inserir coluna não quebra. */
function colunas_(aba) {
  var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
  var m = {};
  for (var i = 0; i < cab.length; i++) {
    var n = String(cab[i]).trim();
    if (n) m[n] = i + 1;
  }
  return m;
}

function dados_(aba) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];
  return aba.getRange(2, 1, ultima - 1, aba.getLastColumn()).getValues();
}

function proximoId_(aba, colId) {
  var linhas = dados_(aba), maior = 0;
  for (var i = 0; i < linhas.length; i++) {
    var n = parseInt(linhas[i][colId - 1], 10);
    if (!isNaN(n) && n > maior) maior = n;
  }
  return maior + 1;
}

function acharLinhaPorId_(aba, colId, alvo) {
  var linhas = dados_(aba);
  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i][colId - 1]).trim() === String(alvo).trim()) return i + 2;
  }
  return null;
}

/** Data como data de verdade, exibida no formato que a planilha já usa. */
function gravarData_(aba, linha, col, texto) {
  if (!texto) return;
  var p = texto.split('-');               // o input date do navegador manda yyyy-mm-dd
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  var c = aba.getRange(linha, col);
  c.setValue(d);
  c.setNumberFormat('dd/MM/yyyy');
}

function gravarValor_(aba, linha, col, valor) {
  var c = aba.getRange(linha, col);
  c.setValue(Number(valor));
  c.setNumberFormat('R$ #,##0.00');
}

function valoresUnicos_(aba, nomeColuna) {
  var cols = colunas_(aba);
  if (!cols[nomeColuna]) return [];
  var i = cols[nomeColuna] - 1;
  var vistos = {}, saida = [];
  var linhas = dados_(aba);
  for (var k = 0; k < linhas.length; k++) {
    var v = String(linhas[k][i]).trim();
    if (v && !vistos[v]) { vistos[v] = true; saida.push(v); }
  }
  return saida.sort();
}


// ------------------------------------------------------- o que a tela carrega

function carregarOpcoes() {
  var abaCons = aba_('consignacoes');
  var colsCons = colunas_(abaCons);
  var linhas = dados_(abaCons);

  var donos = [];
  var abaProp = aba_('proprietarios');
  var colsProp = colunas_(abaProp);
  var linhasProp = dados_(abaProp);
  for (var i = 0; i < linhasProp.length; i++) {
    var id = String(linhasProp[i][colsProp['ID_Cliente'] - 1]).trim();
    var nome = String(linhasProp[i][colsProp['Nome'] - 1]).trim();
    if (id && nome) donos.push({ id: id, nome: nome });
  }
  donos.sort(function (a, b) { return a.nome.localeCompare(b.nome); });

  var estoque = [];
  for (var j = 0; j < linhas.length; j++) {
    if (String(linhas[j][colsCons['Status'] - 1]).trim() !== 'Em estoque') continue;
    estoque.push({
      id:    String(linhas[j][colsCons['ID_Consignação'] - 1]).trim(),
      item:  String(linhas[j][colsCons['Item / Produto'] - 1]).trim(),
      dono:  String(linhas[j][colsCons['Proprietário'] - 1]).trim(),
      valor: Number(linhas[j][colsCons['Valor (R$)'] - 1]) || 0
    });
  }
  estoque.sort(function (a, b) { return a.item.localeCompare(b.item); });

  return {
    donos: donos,
    estoque: estoque,
    marcas:         valoresUnicos_(aba_('bicicletas'), 'Marca')
                      .concat(valoresUnicos_(aba_('componentes'), 'Marca')).sort(),
    categoriasBike: valoresUnicos_(aba_('bicicletas'), 'Categoria'),
    materiais:      valoresUnicos_(aba_('bicicletas'), 'Material'),
    tamanhos:       valoresUnicos_(aba_('bicicletas'), 'Tamanho'),
    categoriasComp: valoresUnicos_(aba_('componentes'), 'Categoria'),
    hoje: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
}


// ------------------------------------------------------------- nova entrada

function registrarEntrada(f) {
  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(20000)) throw new Error('Planilha ocupada, tente de novo.');

  try {
    if (!f.descricao) throw new Error('Falta a descrição do item.');
    if (!f.valor)     throw new Error('Falta o valor.');
    if (!f.donoId && !f.donoNovo) throw new Error('Falta o proprietário.');

    // 1. o dono, se for novo
    var idCliente = f.donoId, nomeDono = '';
    var abaProp = aba_('proprietarios');
    var colsProp = colunas_(abaProp);

    if (!idCliente) {
      idCliente = String(proximoId_(abaProp, colsProp['ID_Cliente']));
      var linhaProp = abaProp.getLastRow() + 1;
      abaProp.getRange(linhaProp, colsProp['ID_Cliente']).setValue(idCliente);
      abaProp.getRange(linhaProp, colsProp['Nome']).setValue(f.donoNovo);
      if (colsProp['Contato'] && f.donoContato) {
        abaProp.getRange(linhaProp, colsProp['Contato']).setValue(f.donoContato);
      }
      if (colsProp['Cidade'] && f.donoCidade) {
        abaProp.getRange(linhaProp, colsProp['Cidade']).setValue(f.donoCidade);
      }
      nomeDono = f.donoNovo;
    } else {
      var l = acharLinhaPorId_(abaProp, colsProp['ID_Cliente'], idCliente);
      nomeDono = l ? String(abaProp.getRange(l, colsProp['Nome']).getValue()).trim() : '';
    }

    // 2. o item
    var ehBike = (f.tipo === TIPO_BIKE);
    var abaItem = ehBike ? aba_('bicicletas') : aba_('componentes');
    var colsItem = colunas_(abaItem);
    var colIdItem = ehBike ? colsItem['ID_Bike'] : colsItem['ID_Componente'];

    var idItem = String(proximoId_(abaItem, colIdItem));
    var linhaItem = abaItem.getLastRow() + 1;
    abaItem.getRange(linhaItem, colIdItem).setValue(idItem);
    abaItem.getRange(linhaItem, colsItem['Nome/Descrição']).setValue(f.descricao);
    if (f.marca) abaItem.getRange(linhaItem, colsItem['Marca']).setValue(f.marca);
    abaItem.getRange(linhaItem, colsItem['Status']).setValue('Em estoque');

    if (ehBike) {
      if (f.modelo)    abaItem.getRange(linhaItem, colsItem['Modelo']).setValue(f.modelo);
      if (f.ano)       abaItem.getRange(linhaItem, colsItem['Ano']).setValue(f.ano);
      if (f.categoria) abaItem.getRange(linhaItem, colsItem['Categoria']).setValue(f.categoria);
      if (f.tamanho)   abaItem.getRange(linhaItem, colsItem['Tamanho']).setValue(f.tamanho);
      if (f.material)  abaItem.getRange(linhaItem, colsItem['Material']).setValue(f.material);
    } else if (f.categoria) {
      abaItem.getRange(linhaItem, colsItem['Categoria']).setValue(f.categoria);
    }

    // 3. a consignação
    var abaCons = aba_('consignacoes');
    var colsCons = colunas_(abaCons);
    var idCons = String(proximoId_(abaCons, colsCons['ID_Consignação']));
    var linhaCons = abaCons.getLastRow() + 1;

    abaCons.getRange(linhaCons, colsCons['ID_Consignação']).setValue(idCons);
    abaCons.getRange(linhaCons, ehBike ? colsCons['ID_Bike'] : colsCons['ID_Componente'])
           .setValue(idItem);
    abaCons.getRange(linhaCons, colsCons['ID_Cliente']).setValue(idCliente);
    abaCons.getRange(linhaCons, colsCons['Tipo']).setValue(f.tipo);
    abaCons.getRange(linhaCons, colsCons['Item / Produto']).setValue(f.descricao);
    abaCons.getRange(linhaCons, colsCons['Proprietário']).setValue(nomeDono);
    abaCons.getRange(linhaCons, colsCons['Status']).setValue('Em estoque');
    gravarValor_(abaCons, linhaCons, colsCons['Valor (R$)'], f.valor);
    gravarData_(abaCons, linhaCons, colsCons['Data Entrada'], f.dataEntrada);
    if (f.observacoes) {
      abaCons.getRange(linhaCons, colsCons['Observações']).setValue(f.observacoes);
    }

    return 'Registrado. Consignação ' + idCons + ', ' +
           (ehBike ? 'bike' : 'componente') + ' ' + idItem + '.';
  } finally {
    trava.releaseLock();
  }
}


// --------------------------------------------------------- fechar saída

/**
 * Fecha a consignação como Vendido ou Retirado.
 *
 * Canal só faz sentido em venda. Em retirada a coluna Loja fica VAZIA — foi
 * justamente digitar "retirada" ali que produziu os 6 registros com o
 * movimento na coluna do canal.
 */
function registrarSaida(f) {
  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(20000)) throw new Error('Planilha ocupada, tente de novo.');

  try {
    if (!f.idCons)    throw new Error('Escolha o item.');
    if (!f.dataSaida) throw new Error('Falta a data.');
    if (f.status === 'Vendido' && !f.canal) throw new Error('Falta o canal da venda.');

    var abaCons = aba_('consignacoes');
    var cols = colunas_(abaCons);
    var linha = acharLinhaPorId_(abaCons, cols['ID_Consignação'], f.idCons);
    if (!linha) throw new Error('Consignação ' + f.idCons + ' não encontrada.');

    var atual = String(abaCons.getRange(linha, cols['Status']).getValue()).trim();
    if (atual !== 'Em estoque') {
      throw new Error('A consignação ' + f.idCons + ' já está como "' + atual + '".');
    }

    abaCons.getRange(linha, cols['Status']).setValue(f.status);
    gravarData_(abaCons, linha, cols['Data Saída'], f.dataSaida);
    if (f.valor) gravarValor_(abaCons, linha, cols['Valor (R$)'], f.valor);
    abaCons.getRange(linha, cols['Loja']).setValue(f.status === 'Vendido' ? f.canal : '');
    if (f.observacoes) {
      abaCons.getRange(linha, cols['Observações']).setValue(f.observacoes);
    }

    // o onEdit não dispara em escrita por script: propaga aqui
    propagar_(abaCons, cols, linha, f.status);

    return f.status + ' registrado na consignação ' + f.idCons + '.';
  } finally {
    trava.releaseLock();
  }
}

function propagar_(abaCons, cols, linha, status) {
  var destinos = [
    { colFk: 'ID_Bike',       aba: 'bicicletas',  colId: 'ID_Bike' },
    { colFk: 'ID_Componente', aba: 'componentes', colId: 'ID_Componente' }
  ];
  for (var i = 0; i < destinos.length; i++) {
    var d = destinos[i];
    var idItem = String(abaCons.getRange(linha, cols[d.colFk]).getValue()).trim();
    if (!idItem) continue;
    var abaItem = aba_(d.aba);
    var colsItem = colunas_(abaItem);
    var linhaItem = acharLinhaPorId_(abaItem, colsItem[d.colId], idItem);
    if (linhaItem) abaItem.getRange(linhaItem, colsItem['Status']).setValue(status);
  }
}
