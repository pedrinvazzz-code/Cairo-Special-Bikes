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

/** Data da planilha como yyyy-mm-dd, ou '' se vazia ou ilegível. */
function dataIso_(v) {
  if (v instanceof Date && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[0];
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  return '';
}

/**
 * Uma linha da aba Consignações no formato que a tela usa.
 *
 * O mesmo formato serve para listar (aba Estoque) e para conferir, na hora de
 * gravar uma correção, se a linha ainda é a que a pessoa viu.
 */
function registro_(linha, cols) {
  function v(nome) { return cols[nome] ? linha[cols[nome] - 1] : ''; }
  return {
    id:      String(v('ID_Consignação')).trim(),
    tipo:    String(v('Tipo')).trim(),
    item:    String(v('Item / Produto')).trim(),
    dono:    String(v('Proprietário')).trim(),
    donoId:  String(v('ID_Cliente')).trim(),
    valor:   Number(v('Valor (R$)')) || 0,
    status:  String(v('Status')).trim(),
    entrada: dataIso_(v('Data Entrada')),
    saida:   dataIso_(v('Data Saída')),
    loja:    String(v('Loja')).trim(),
    obs:     String(v('Observações')).trim()
  };
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

  // Todas as consignações, da mais recente para a mais antiga. A tela tira
  // daqui o estoque (aba Fechar e aba Estoque) e o que pode ser corrigido.
  // Lido da planilha e não do banco: o banco só sincroniza a cada 2h, e quem
  // acabou de cadastrar espera ver o item na hora.
  var registros = [];
  for (var j = linhas.length - 1; j >= 0; j--) {
    var r = registro_(linhas[j], colsCons);
    if (r.id) registros.push(r);
  }

  return {
    donos: donos,
    registros: registros,
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


// ------------------------------------------------------------ correção

var CAMPOS_CORRIGIVEIS = {
  item:    'Item / Produto',
  valor:   'Valor (R$)',
  entrada: 'Data Entrada',
  saida:   'Data Saída',
  loja:    'Loja',
  obs:     'Observações',
  status:  'Status',
  donoId:  'ID_Cliente'
};
var STATUS_VALIDOS = ['Em estoque', 'Vendido', 'Retirado'];
var CANAIS_VALIDOS = ['Física', 'Online'];

/**
 * Corrige uma consignação já gravada.
 *
 * Recebe o registro como a pessoa o viu (`antes`) e como ela quer que fique
 * (`depois`). Antes de gravar, confere campo a campo se a planilha ainda está
 * como `antes`: se alguém mudou a mesma linha nesse meio-tempo, recusa em vez
 * de sobrescrever calado.
 *
 * Toda alteração vai para a aba "Histórico de correções". A planilha não
 * guarda versões, e foi a falta de rastro que tornou a auditoria de setembro
 * tão trabalhosa.
 */
function corrigirRegistro(f) {
  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(20000)) throw new Error('Planilha ocupada, tente de novo.');

  try {
    var abaCons = aba_('consignacoes');
    var cols = colunas_(abaCons);
    var linha = acharLinhaPorId_(abaCons, cols['ID_Consignação'], f.id);
    if (!linha) throw new Error('Consignação ' + f.id + ' não encontrada.');

    var valores = abaCons.getRange(linha, 1, 1, abaCons.getLastColumn()).getValues()[0];
    var atual = registro_(valores, cols);

    var mudancas = [];
    for (var campo in CAMPOS_CORRIGIVEIS) {
      if (!(campo in f.depois)) continue;
      var antes = normalizar_(campo, f.antes[campo]);
      var depois = normalizar_(campo, f.depois[campo]);
      if (antes === depois) continue;
      if (normalizar_(campo, atual[campo]) !== antes) {
        throw new Error('Este registro foi alterado por outra pessoa enquanto você corrigia. ' +
                        'Feche e abra de novo para ver a versão atual.');
      }
      mudancas.push({ campo: campo, antes: antes, depois: depois });
    }
    if (!mudancas.length) return 'Nada mudou.';

    // o estado final, para validar o conjunto e não só cada campo
    var fim = {};
    for (var k in atual) fim[k] = normalizar_(k, atual[k]);
    for (var i = 0; i < mudancas.length; i++) fim[mudancas[i].campo] = mudancas[i].depois;

    // Em estoque não tem saída nem canal; retirada não tem canal. Limpar aqui
    // evita reabrir um item e deixar a data de saída antiga para trás.
    if (fim.status === 'Em estoque') { fim.saida = ''; fim.loja = ''; }
    if (fim.status === 'Retirado') fim.loja = '';
    acrescentarLimpeza_(mudancas, atual, fim, ['saida', 'loja']);

    if (STATUS_VALIDOS.indexOf(fim.status) < 0) throw new Error('Status inválido: ' + fim.status);
    if (!fim.item) throw new Error('A descrição não pode ficar vazia.');
    if (!(Number(fim.valor) > 0)) throw new Error('O valor precisa ser maior que zero.');
    if (fim.status !== 'Em estoque' && !fim.saida) throw new Error('Falta a data de saída.');
    if (fim.status === 'Vendido' && CANAIS_VALIDOS.indexOf(fim.loja) < 0) {
      throw new Error('Falta o canal da venda.');
    }
    if (fim.entrada && fim.saida && fim.saida < fim.entrada) {
      throw new Error('A data de saída ficou antes da data de entrada.');
    }

    var nomeDono = null;
    if (fim.donoId !== normalizar_('donoId', atual.donoId)) {
      var abaProp = aba_('proprietarios');
      var colsProp = colunas_(abaProp);
      var lp = acharLinhaPorId_(abaProp, colsProp['ID_Cliente'], fim.donoId);
      if (!lp) throw new Error('Proprietário ' + fim.donoId + ' não encontrado.');
      nomeDono = String(abaProp.getRange(lp, colsProp['Nome']).getValue()).trim();
    }

    // grava
    for (var m = 0; m < mudancas.length; m++) {
      var c = mudancas[m], col = cols[CAMPOS_CORRIGIVEIS[c.campo]];
      if (!col) throw new Error('A coluna ' + CAMPOS_CORRIGIVEIS[c.campo] + ' não existe.');
      if (c.campo === 'valor') gravarValor_(abaCons, linha, col, c.depois);
      else if ((c.campo === 'entrada' || c.campo === 'saida') && c.depois) {
        gravarData_(abaCons, linha, col, c.depois);
      } else abaCons.getRange(linha, col).setValue(c.depois);
    }
    if (nomeDono !== null) {
      abaCons.getRange(linha, cols['Proprietário']).setValue(nomeDono);
      mudancas.push({ campo: 'dono', antes: atual.dono, depois: nomeDono });
    }

    // a descrição e o status vivem também na aba do item
    for (var n = 0; n < mudancas.length; n++) {
      if (mudancas[n].campo === 'item') atualizarItem_(abaCons, cols, linha, 'Nome/Descrição', fim.item);
    }
    if (fim.status !== atual.status) propagar_(abaCons, cols, linha, fim.status);

    registrarHistorico_(f.id, mudancas);
    return 'Consignação ' + f.id + ' corrigida (' + mudancas.length +
           (mudancas.length === 1 ? ' alteração).' : ' alterações).');
  } finally {
    trava.releaseLock();
  }
}

/** Mesmo valor, mesma forma: sem isto "24900" e 24900 contariam como mudança. */
function normalizar_(campo, v) {
  if (v === null || v === undefined) return '';
  if (campo === 'valor') return String(Number(v) || 0);
  if (campo === 'entrada' || campo === 'saida') return dataIso_(v);
  return String(v).trim();
}

/** Registra como mudança os campos que a regra de status limpou. */
function acrescentarLimpeza_(mudancas, atual, fim, campos) {
  for (var i = 0; i < campos.length; i++) {
    var c = campos[i], antes = normalizar_(c, atual[c]);
    var ja = mudancas.some(function (m) { return m.campo === c; });
    if (ja) {
      mudancas.forEach(function (m) { if (m.campo === c) m.depois = fim[c]; });
    } else if (antes !== fim[c]) {
      mudancas.push({ campo: c, antes: antes, depois: fim[c] });
    }
  }
  for (var j = mudancas.length - 1; j >= 0; j--) {
    if (mudancas[j].antes === mudancas[j].depois) mudancas.splice(j, 1);
  }
}

function atualizarItem_(abaCons, cols, linha, coluna, valor) {
  var destinos = [
    { colFk: 'ID_Bike',       aba: 'bicicletas',  colId: 'ID_Bike' },
    { colFk: 'ID_Componente', aba: 'componentes', colId: 'ID_Componente' }
  ];
  for (var i = 0; i < destinos.length; i++) {
    var d = destinos[i];
    if (!cols[d.colFk]) continue;
    var idItem = String(abaCons.getRange(linha, cols[d.colFk]).getValue()).trim();
    if (!idItem) continue;
    var abaItem = aba_(d.aba);
    var colsItem = colunas_(abaItem);
    var linhaItem = acharLinhaPorId_(abaItem, colsItem[d.colId], idItem);
    if (linhaItem && colsItem[coluna]) abaItem.getRange(linhaItem, colsItem[coluna]).setValue(valor);
  }
}

function registrarHistorico_(idCons, mudancas) {
  var ss = SpreadsheetApp.getActive();
  var aba = ss.getSheetByName('Histórico de correções');
  if (!aba) {
    aba = ss.insertSheet('Histórico de correções');
    aba.appendRow(['Quando', 'Quem', 'ID_Consignação', 'Campo', 'Antes', 'Depois']);
    aba.setFrozenRows(1);
  }
  var quem = Session.getActiveUser().getEmail() || '';
  var agora = new Date();
  var linhas = mudancas.map(function (m) {
    return [agora, quem, idCons, m.campo, m.antes, m.depois];
  });
  aba.getRange(aba.getLastRow() + 1, 1, linhas.length, 6).setValues(linhas);
}
