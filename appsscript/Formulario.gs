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
      // Ícone e título usados quando o app é adicionado à tela inicial do
      // celular: o mesmo ícone do site da loja.
      return HtmlService.createHtmlOutputFromFile(candidatos[i])
        .setTitle('Cairo Special Bikes')
        .setFaviconUrl('https://cairospecialbikes.com.br/cdn/shop/files/2_Sem_fundo.png?crop=center&height=192&v=1766172221&width=192')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .addMetaTag('apple-mobile-web-app-capable', 'yes')
        .addMetaTag('mobile-web-app-capable', 'yes')
        .addMetaTag('apple-mobile-web-app-title', 'Cairo');
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

// --------------------------------------------------------------- validação
//
// A tela já confere quase tudo, mas qualquer pessoa com acesso à planilha
// consegue chamar estas funções direto pelo console do navegador. O servidor
// é a última barreira, então confere de novo.

// Abaixo de R$ 10 o pipeline lê o valor como ausente (transform.fmt_valor),
// e uma venda "sem valor" derruba a verificação pós-carga.
var VALOR_MIN = 10, VALOR_MAX = 1000000;

function valorValido_(v, rotulo) {
  var n = Number(v);
  if (!isFinite(n) || n < VALOR_MIN || n > VALOR_MAX) {
    throw new Error((rotulo || 'O valor') + ' precisa estar entre R$ ' + VALOR_MIN +
                    ' e R$ 1.000.000. Digite só números, sem ponto de milhar: 24900.');
  }
  return n;
}

function hojeIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** yyyy-mm-dd válida, entre 2020 e hoje (o pipeline descarta fora de 2020–2030). */
function dataValida_(texto, rotulo) {
  var m = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  var d = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!m || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    throw new Error(rotulo + ' inválida.');
  }
  if (texto < '2020-01-01') throw new Error(rotulo + ' anterior a 2020.');
  if (texto > hojeIso_()) throw new Error(rotulo + ' no futuro.');
  return texto;
}

/**
 * Texto livre como TEXTO na planilha. setValue interpreta "=...", "+...",
 * "-..." e "@..." como fórmula: "- pago no pix" virava #ERROR!. O apóstrofo
 * no começo não aparece na célula nem na leitura.
 */
function texto_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** Telefone sempre como texto: "+55..." e "034..." perdiam o + e o zero. */
function telefone_(v) {
  var s = String(v || '').trim();
  return s ? "'" + s : '';
}

function semAcento_(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
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

/**
 * Quem está usando o app. Com "executar como o usuário que acessa", é a conta
 * Google com que o link foi aberto — e no celular, com várias contas logadas,
 * nem sempre é a que a pessoa acha. Mostrar o e-mail tira a dúvida.
 */
function usuario_() {
  var email = '', url = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  return { email: email, planilha: SpreadsheetApp.getActive().getName(), url: url };
}

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
    usuario: usuario_(),
    agora: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm"),
    conferencias: conferencias_(),
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
    if (!String(f.descricao || '').trim()) throw new Error('Falta a descrição do item.');
    if (f.tipo !== TIPO_BIKE && f.tipo !== TIPO_COMP) throw new Error('Tipo inválido: ' + f.tipo);
    valorValido_(f.valor);
    dataValida_(f.dataEntrada, 'Data de entrada');
    if (!f.donoId && !String(f.donoNovo || '').trim()) throw new Error('Falta o proprietário.');

    // 1. o dono, se for novo
    var idCliente = f.donoId, nomeDono = '';
    var abaProp = aba_('proprietarios');
    var colsProp = colunas_(abaProp);

    if (!idCliente) {
      // mesmo nome, ignorando maiúsculas, acentos e espaços: é a mesma pessoa
      var nomes = dados_(abaProp);
      for (var n = 0; n < nomes.length; n++) {
        if (semAcento_(nomes[n][colsProp['Nome'] - 1]) === semAcento_(f.donoNovo)) {
          throw new Error('Já existe o proprietário "' + String(nomes[n][colsProp['Nome'] - 1]).trim() +
                          '". Escolha na lista em vez de cadastrar de novo.');
        }
      }
      idCliente = String(proximoId_(abaProp, colsProp['ID_Cliente']));
      var linhaProp = abaProp.getLastRow() + 1;
      abaProp.getRange(linhaProp, colsProp['ID_Cliente']).setValue(idCliente);
      abaProp.getRange(linhaProp, colsProp['Nome']).setValue(texto_(f.donoNovo));
      if (colsProp['Contato'] && f.donoContato) {
        abaProp.getRange(linhaProp, colsProp['Contato']).setValue(telefone_(f.donoContato));
      }
      if (colsProp['Cidade'] && f.donoCidade) {
        abaProp.getRange(linhaProp, colsProp['Cidade']).setValue(texto_(f.donoCidade));
      }
      nomeDono = String(f.donoNovo).trim();
    } else {
      var l = acharLinhaPorId_(abaProp, colsProp['ID_Cliente'], idCliente);
      if (!l) throw new Error('Proprietário ' + idCliente + ' não encontrado. Recarregue o app.');
      nomeDono = String(abaProp.getRange(l, colsProp['Nome']).getValue()).trim();
    }

    // 2. o item
    var ehBike = (f.tipo === TIPO_BIKE);
    var abaItem = ehBike ? aba_('bicicletas') : aba_('componentes');
    var colsItem = colunas_(abaItem);
    var colIdItem = ehBike ? colsItem['ID_Bike'] : colsItem['ID_Componente'];

    var idItem = String(proximoId_(abaItem, colIdItem));
    var linhaItem = abaItem.getLastRow() + 1;
    abaItem.getRange(linhaItem, colIdItem).setValue(idItem);
    abaItem.getRange(linhaItem, colsItem['Nome/Descrição']).setValue(texto_(f.descricao));
    if (f.marca) abaItem.getRange(linhaItem, colsItem['Marca']).setValue(texto_(f.marca));
    abaItem.getRange(linhaItem, colsItem['Status']).setValue('Em estoque');

    if (ehBike) {
      if (f.modelo)    abaItem.getRange(linhaItem, colsItem['Modelo']).setValue(texto_(f.modelo));
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
    abaCons.getRange(linhaCons, colsCons['Item / Produto']).setValue(texto_(f.descricao));
    abaCons.getRange(linhaCons, colsCons['Proprietário']).setValue(texto_(nomeDono));
    abaCons.getRange(linhaCons, colsCons['Status']).setValue('Em estoque');
    gravarValor_(abaCons, linhaCons, colsCons['Valor (R$)'], f.valor);
    gravarData_(abaCons, linhaCons, colsCons['Data Entrada'], f.dataEntrada);
    if (f.observacoes) {
      abaCons.getRange(linhaCons, colsCons['Observações']).setValue(texto_(f.observacoes));
    }

    // Os IDs voltam para a tela poder oferecer "Desfazer" (desfazerEntrada).
    return {
      msg: 'Registrado. Consignação ' + idCons + ', ' + (ehBike ? 'bike' : 'componente') + ' ' + idItem + '.',
      id: idCons, idItem: idItem, bike: ehBike, idCliente: String(idCliente), donoNovo: !f.donoId
    };
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
    if (f.status !== 'Vendido' && f.status !== 'Retirado') throw new Error('Situação inválida: ' + f.status);
    dataValida_(f.dataSaida, 'Data de saída');
    if (f.status === 'Vendido' && CANAIS_VALIDOS.indexOf(f.canal) < 0) throw new Error('Falta o canal da venda.');
    if (f.valor !== undefined && f.valor !== null && String(f.valor) !== '') valorValido_(f.valor);

    var abaCons = aba_('consignacoes');
    var cols = colunas_(abaCons);
    var linha = acharLinhaPorId_(abaCons, cols['ID_Consignação'], f.idCons);
    if (!linha) throw new Error('Consignação ' + f.idCons + ' não encontrada.');

    var atual = String(abaCons.getRange(linha, cols['Status']).getValue()).trim();
    if (atual !== 'Em estoque') {
      throw new Error('A consignação ' + f.idCons + ' já está como "' + atual + '".');
    }
    var entrada = dataIso_(abaCons.getRange(linha, cols['Data Entrada']).getValue());
    if (entrada && f.dataSaida < entrada) {
      throw new Error('A data de saída é anterior à entrada (' + entrada.split('-').reverse().join('/') + ').');
    }

    abaCons.getRange(linha, cols['Status']).setValue(f.status);
    gravarData_(abaCons, linha, cols['Data Saída'], f.dataSaida);
    if (f.valor) gravarValor_(abaCons, linha, cols['Valor (R$)'], f.valor);
    abaCons.getRange(linha, cols['Loja']).setValue(f.status === 'Vendido' ? f.canal : '');
    if (f.observacoes) {
      abaCons.getRange(linha, cols['Observações']).setValue(texto_(f.observacoes));
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
    valorValido_(fim.valor);
    // data mudada precisa ser válida; vazia só para saída de item em estoque
    if (mudancas.some(function (m) { return m.campo === 'entrada'; })) dataValida_(fim.entrada, 'Data de entrada');
    if (fim.saida && mudancas.some(function (m) { return m.campo === 'saida'; })) dataValida_(fim.saida, 'Data de saída');
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
      } else if (c.campo === 'item' || c.campo === 'obs') abaCons.getRange(linha, col).setValue(texto_(c.depois));
      else abaCons.getRange(linha, col).setValue(c.depois);
    }
    if (nomeDono !== null) {
      abaCons.getRange(linha, cols['Proprietário']).setValue(texto_(nomeDono));
      mudancas.push({ campo: 'dono', antes: atual.dono, depois: nomeDono });
    }

    // a descrição e o status vivem também na aba do item
    for (var n = 0; n < mudancas.length; n++) {
      if (mudancas[n].campo === 'item') atualizarItem_(abaCons, cols, linha, 'Nome/Descrição', texto_(fim.item));
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
  if (campo === 'entrada' || campo === 'saida') return v === '' ? '' : (dataIso_(v) || String(v).trim());
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


// ------------------------------------------------------- desfazer e conferir

/**
 * Desfaz uma entrada recém-registrada: apaga a consignação, o item e, se o
 * dono foi cadastrado nessa mesma entrada e não tem mais nada, o dono.
 *
 * Só apaga se a consignação ainda estiver exatamente como foi criada (Em
 * estoque, apontando para o mesmo item). Se alguém já fechou ou mexeu, recusa:
 * aí o caminho é a correção, que deixa rastro campo a campo.
 */
function desfazerEntrada(f) {
  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(20000)) throw new Error('Planilha ocupada, tente de novo.');
  try {
    var abaCons = aba_('consignacoes'), cols = colunas_(abaCons);
    var linha = acharLinhaPorId_(abaCons, cols['ID_Consignação'], f.id);
    if (!linha) throw new Error('Consignação ' + f.id + ' não encontrada.');
    var r = registro_(abaCons.getRange(linha, 1, 1, abaCons.getLastColumn()).getValues()[0], cols);
    var colFk = f.bike ? 'ID_Bike' : 'ID_Componente';
    var idItemNaLinha = String(abaCons.getRange(linha, cols[colFk]).getValue()).trim();
    if (r.status !== 'Em estoque' || idItemNaLinha !== String(f.idItem)) {
      throw new Error('A consignação ' + f.id + ' já mudou desde a entrada. Use "Corrigir registro".');
    }
    // Desfazer é para a entrada que acabou de ser feita: ela é a de maior ID.
    // Sem isto, chamar com o ID de qualquer consignação em estoque a apagava.
    if (Number(f.id) !== proximoId_(abaCons, cols['ID_Consignação']) - 1) {
      throw new Error('Só dá para desfazer a entrada mais recente. Para as outras, use "Corrigir registro".');
    }

    abaCons.deleteRow(linha);

    var abaItem = aba_(f.bike ? 'bicicletas' : 'componentes'), colsItem = colunas_(abaItem);
    var linhaItem = acharLinhaPorId_(abaItem, colsItem[f.bike ? 'ID_Bike' : 'ID_Componente'], f.idItem);
    if (linhaItem) abaItem.deleteRow(linhaItem);

    var donoApagado = false;
    var abaPropD = aba_('proprietarios'), colsPropD = colunas_(abaPropD);
    var donoEhONovo = f.donoNovo && Number(f.idCliente) === proximoId_(abaPropD, colsPropD['ID_Cliente']) - 1;
    if (donoEhONovo) {
      var outras = dados_(abaCons).some(function (l) {
        return String(l[cols['ID_Cliente'] - 1]).trim() === String(f.idCliente);
      });
      if (!outras) {
        var abaProp = aba_('proprietarios'), colsProp = colunas_(abaProp);
        var lp = acharLinhaPorId_(abaProp, colsProp['ID_Cliente'], f.idCliente);
        if (lp) { abaProp.deleteRow(lp); donoApagado = true; }
      }
    }

    registrarHistorico_(f.id, [{ campo: 'entrada desfeita', antes: r.item + ' · ' + r.dono, depois: '' }]);
    return 'Entrada desfeita: consignação ' + f.id + ' removida' + (donoApagado ? ', com o proprietário novo.' : '.');
  } finally {
    trava.releaseLock();
  }
}

/**
 * Desfaz um fechamento recém-registrado: volta a Em estoque e restaura o
 * valor e as observações que a tela guardou de antes da saída.
 */
function desfazerSaida(f) {
  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(20000)) throw new Error('Planilha ocupada, tente de novo.');
  try {
    var abaCons = aba_('consignacoes'), cols = colunas_(abaCons);
    var linha = acharLinhaPorId_(abaCons, cols['ID_Consignação'], f.id);
    if (!linha) throw new Error('Consignação ' + f.id + ' não encontrada.');
    var r = registro_(abaCons.getRange(linha, 1, 1, abaCons.getLastColumn()).getValues()[0], cols);
    if (f.status !== 'Vendido' && f.status !== 'Retirado') throw new Error('Situação inválida: ' + f.status);
    if (r.status !== f.status) {
      throw new Error('A consignação ' + f.id + ' já não está como "' + f.status + '". Use "Corrigir registro".');
    }

    abaCons.getRange(linha, cols['Status']).setValue('Em estoque');
    abaCons.getRange(linha, cols['Data Saída']).setValue('');
    abaCons.getRange(linha, cols['Loja']).setValue('');
    if (f.valor) gravarValor_(abaCons, linha, cols['Valor (R$)'], valorValido_(f.valor));
    if (cols['Observações']) abaCons.getRange(linha, cols['Observações']).setValue(texto_(f.obs));
    propagar_(abaCons, cols, linha, 'Em estoque');

    registrarHistorico_(f.id, [
      { campo: 'saída desfeita', antes: r.status + ' em ' + r.saida, depois: 'Em estoque' }
    ]);
    return 'Fechamento desfeito: a consignação ' + f.id + ' voltou para o estoque.';
  } finally {
    trava.releaseLock();
  }
}

/**
 * "Ainda está na loja": a revisão dos parados confirma que o item existe sem
 * mudar a consignação. Fica só no histórico, que a tela lê de volta para não
 * pedir a mesma conferência todo dia.
 */
function registrarConferencia(id) {
  var abaCons = aba_('consignacoes'), cols = colunas_(abaCons);
  var linha = acharLinhaPorId_(abaCons, cols['ID_Consignação'], id);
  if (!linha) throw new Error('Consignação ' + id + ' não encontrada.');
  var status = String(abaCons.getRange(linha, cols['Status']).getValue()).trim();
  if (status !== 'Em estoque') throw new Error('A consignação ' + id + ' não está em estoque.');
  if (conferencias_()[String(id)] === hojeIso_()) return 'Já conferido hoje.';
  registrarHistorico_(String(id), [{ campo: 'conferência', antes: '', depois: 'ainda na loja' }]);
  return 'Conferido.';
}

/** id da consignação -> data (yyyy-mm-dd) da última conferência. */
function conferencias_() {
  var aba = SpreadsheetApp.getActive().getSheetByName('Histórico de correções');
  var mapa = {};
  if (!aba || aba.getLastRow() < 2) return mapa;
  var linhas = aba.getRange(2, 1, aba.getLastRow() - 1, 4).getValues();
  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i][3]).trim() !== 'conferência') continue;
    var id = String(linhas[i][2]).trim(), quando = dataIso_(linhas[i][0]);
    if (quando && (!mapa[id] || quando > mapa[id])) mapa[id] = quando;
  }
  return mapa;
}
