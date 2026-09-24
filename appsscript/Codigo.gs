/**
 * Cairo Special Bikes — automações de preenchimento da planilha.
 *
 * Duas coisas que a pessoa não precisa mais fazer à mão:
 *
 *   1. Digitar ID. Linha nova ganha o próximo número sozinha, nas quatro abas.
 *   2. Atualizar o status em dois lugares. Mudou em Consignações, desce
 *      sozinho para a aba do item.
 *
 * A decisão que sustenta o item 2: a aba Consignações é a fonte de verdade
 * para status. As abas Bicicletas e Componentes guardam uma cópia de leitura.
 * Em 22/09/2026, 34 itens de 589 estavam com as duas versões divergentes.
 *
 * As colunas são localizadas PELO NOME no cabeçalho, nunca pela posição — se
 * alguém inserir uma coluna no meio, isto continua funcionando. É a mesma
 * regra do extract.py do pipeline.
 *
 * Instalação: Extensões → Apps Script → cola este arquivo → Salvar.
 * O gatilho onEdit é automático, não precisa configurar nada.
 */

var ABA_CONSIGNACOES = 'Consignações';

/** aba -> coluna do ID, e as colunas que indicam "esta linha começou a ser preenchida" */
var ABAS_COM_ID = {
  'Consignações': { id: 'ID_Consignação', gatilhos: ['Tipo', 'Item / Produto', 'Proprietário'] },
  'Bicicletas':   { id: 'ID_Bike',        gatilhos: ['Nome/Descrição', 'Marca'] },
  'Componentes':  { id: 'ID_Componente',  gatilhos: ['Nome/Descrição', 'Marca'] },
  'Proprietários':{ id: 'ID_Cliente',     gatilhos: ['Nome', 'Contato'] }
};

/** coluna de FK em Consignações -> aba do item que recebe a cópia do status */
var DESTINOS_STATUS = {
  'ID_Bike':       'Bicicletas',
  'ID_Componente': 'Componentes'
};


function onEdit(e) {
  if (!e || !e.range) return;
  var aba = e.range.getSheet();
  var nome = aba.getName();

  try {
    if (ABAS_COM_ID[nome]) preencherId_(aba, nome, e.range);
    if (nome === ABA_CONSIGNACOES) propagarStatus_(aba, e.range);
  } catch (err) {
    // onEdit silencioso é pior que onEdit que reclama: sem isto, um erro aqui
    // faz a automação parar de funcionar sem ninguém perceber.
    aba.getRange(e.range.getRow(), 1).setNote('Erro na automação: ' + err.message);
  }
}


/** cabeçalho -> índice da coluna (1-based), lido da linha 1 */
function colunas_(aba) {
  var cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
  var mapa = {};
  for (var i = 0; i < cabecalho.length; i++) {
    var nome = String(cabecalho[i]).trim();
    if (nome) mapa[nome] = i + 1;
  }
  return mapa;
}


/** Preenche o ID da linha editada, se ela já tem conteúdo e ainda não tem ID. */
function preencherId_(aba, nomeAba, range) {
  var config = ABAS_COM_ID[nomeAba];
  var cols = colunas_(aba);
  var colId = cols[config.id];
  if (!colId) return;

  var linha = range.getRow();
  if (linha === 1) return;

  var celulaId = aba.getRange(linha, colId);
  if (String(celulaId.getValue()).trim() !== '') return;

  // só gera ID depois que a linha tem algum conteúdo de verdade
  var temConteudo = false;
  for (var i = 0; i < config.gatilhos.length; i++) {
    var c = cols[config.gatilhos[i]];
    if (c && String(aba.getRange(linha, c).getValue()).trim() !== '') temConteudo = true;
  }
  if (!temConteudo) return;

  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(5000)) return;
  try {
    celulaId.setValue(proximoId_(aba, colId));
  } finally {
    trava.releaseLock();
  }
}


/** Maior ID numérico da coluna, mais um. */
function proximoId_(aba, colId) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return 1;
  var valores = aba.getRange(2, colId, ultima - 1, 1).getValues();
  var maior = 0;
  for (var i = 0; i < valores.length; i++) {
    var n = parseInt(valores[i][0], 10);
    if (!isNaN(n) && n > maior) maior = n;
  }
  return maior + 1;
}


/**
 * Status mudou em Consignações: copia para a aba do item.
 *
 * Só desce quando esta é a consignação mais recente do item — senão corrigir
 * uma consignação antiga de um item que já teve segunda passagem sobrescreveria
 * o status atual com o antigo.
 */
function propagarStatus_(abaCons, range) {
  var cols = colunas_(abaCons);
  if (range.getColumn() !== cols['Status']) return;

  var linha = range.getRow();
  if (linha === 1) return;

  var status = String(range.getValue()).trim();
  if (!status) return;

  var idCons = parseInt(abaCons.getRange(linha, cols['ID_Consignação']).getValue(), 10);

  for (var colFk in DESTINOS_STATUS) {
    var idItem = String(abaCons.getRange(linha, cols[colFk]).getValue()).trim();
    if (!idItem) continue;

    if (!ehMaisRecente_(abaCons, cols, colFk, idItem, idCons)) continue;

    var abaItem = SpreadsheetApp.getActive().getSheetByName(DESTINOS_STATUS[colFk]);
    if (!abaItem) continue;

    var colsItem = colunas_(abaItem);
    var colStatusItem = colsItem['Status'];
    if (!colStatusItem) continue;

    var linhaItem = acharLinha_(abaItem, 1, idItem);
    if (linhaItem) abaItem.getRange(linhaItem, colStatusItem).setValue(status);
  }
}


/** Esta consignação é a de maior ID entre as do mesmo item? */
function ehMaisRecente_(abaCons, cols, colFk, idItem, idCons) {
  var ultima = abaCons.getLastRow();
  var dados = abaCons.getRange(2, 1, ultima - 1, abaCons.getLastColumn()).getValues();
  var maior = 0;
  for (var i = 0; i < dados.length; i++) {
    if (String(dados[i][cols[colFk] - 1]).trim() !== idItem) continue;
    var n = parseInt(dados[i][cols['ID_Consignação'] - 1], 10);
    if (!isNaN(n) && n > maior) maior = n;
  }
  return maior === 0 || idCons >= maior;
}


/** Número da linha cujo valor na coluna `col` é `alvo`. */
function acharLinha_(aba, col, alvo) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return null;
  var valores = aba.getRange(2, col, ultima - 1, 1).getValues();
  for (var i = 0; i < valores.length; i++) {
    if (String(valores[i][0]).trim() === String(alvo).trim()) return i + 2;
  }
  return null;
}
