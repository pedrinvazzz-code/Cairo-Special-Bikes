// Testes do Formulario.gs contra uma planilha falsa em memória. Rodar: node appsscript/teste_formulario.js
const fs = require('fs');
const codigo = fs.readFileSync(require('path').join(__dirname, 'Formulario.gs'), 'utf8');

function novaPlanilha() {
  const abas = {
    'Consignações': [
      ['ID_Consignação','ID_Bike','ID_Componente','ID_Cliente','Tipo','Item / Produto','Proprietário','Valor (R$)','Loja','Status','Data Entrada','Data Saída','Observações'],
      [101, 11, '', 1, 'Bicicleta', 'Tarmac SL7', 'Beatriz Almeida', 24900, 'Física', 'Vendido', new Date(2026,6,1), new Date(2026,8,10), ''],
      [102, 12, '', 2, 'Bicicleta', 'Trek Madone', 'Caio Barbosa', 31500, '', 'Em estoque', new Date(2026,7,5), '', 'risco no quadro'],
    ],
    'Bicicletas': [['ID_Bike','Nome/Descrição','Status'], [11,'Tarmac SL7','Vendido'], [12,'Trek Madone','Em estoque']],
    'Componentes': [['ID_Componente','Nome/Descrição','Status']],
    'Proprietários': [['ID_Cliente','Nome','Contato'], [1,'Beatriz Almeida',''], [2,'Caio Barbosa',''], [3,'Daniela Carvalho','']],
  };
  const formatos = {};
  function aba(nome) {
    const m = abas[nome];
    return {
      getLastRow: () => m.length,
      getLastColumn: () => Math.max(...m.map(r => r.length)),
      getRange(r, c, nr = 1, nc = 1) {
        return {
          getValues: () => Array.from({length: nr}, (_, i) => Array.from({length: nc}, (_, j) => (m[r-1+i] || [])[c-1+j] ?? '')),
          getValue: () => (m[r-1] || [])[c-1] ?? '',
          setValue(v) { while (m.length < r) m.push([]); m[r-1][c-1] = v; },
          setValues(vs) { vs.forEach((row, i) => row.forEach((v, j) => { while (m.length < r+i) m.push([]); m[r-1+i][c-1+j] = v; })); },
          setNumberFormat(f) { formatos[nome + r + ',' + c] = f; },
        };
      },
      appendRow(row) { m.push(row); },
      deleteRow(r) { m.splice(r - 1, 1); },
      setFrozenRows() {},
    };
  }
  return {
    abas,
    ss: {
      getName: () => 'Cairo Bikes (teste)',
      getSheetByName: n => abas[n] ? aba(n) : null,
      insertSheet: n => { abas[n] = []; return aba(n); },
    },
  };
}

function carregar() {
  const p = novaPlanilha();
  const ctx = {
    SpreadsheetApp: { getActive: () => p.ss },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo', getActiveUser: () => ({ getEmail: () => 'cairo@loja.com' }) },
    Utilities: { formatDate: (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') },
    HtmlService: {},
  };
  const f = new Function(...Object.keys(ctx), codigo + '\nreturn { carregarOpcoes, corrigirRegistro, registrarEntrada, registrarSaida, desfazerEntrada, desfazerSaida, registrarConferencia };');
  return Object.assign(f(...Object.values(ctx)), { abas: p.abas });
}

let falhas = 0;
function caso(nome, fn) {
  try { fn(); console.log('  ✓ ' + nome); } catch (e) { falhas++; console.log('  ✗ ' + nome + ': ' + e.message); }
}
function igual(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
function falha(fn, trecho) {
  try { fn(); } catch (e) { if (!e.message.includes(trecho)) throw new Error('erro errado: ' + e.message); return; }
  throw new Error('deveria ter recusado');
}
const reg = (g, id) => g.carregarOpcoes().registros.find(r => r.id === String(id));

caso('carregarOpcoes lista registros do mais recente ao mais antigo, com datas ISO', () => {
  const g = carregar(), rs = g.carregarOpcoes().registros;
  igual(rs.map(r => r.id), ['102', '101']);
  igual(rs[1].entrada, '2026-07-01'); igual(rs[1].saida, '2026-09-10'); igual(rs[0].saida, '');
});

caso('carregarOpcoes diz qual conta está usando o app', () => {
  const u = carregar().carregarOpcoes().usuario;
  igual(u.email, 'cairo@loja.com'); igual(u.planilha, 'Cairo Bikes (teste)');
});

caso('corrige o valor e registra no histórico', () => {
  const g = carregar(), a = reg(g, 102);
  const msg = g.corrigirRegistro({ id: '102', antes: a, depois: Object.assign({}, a, { valor: '29900' }) });
  igual(msg, 'Consignação 102 corrigida (1 alteração).');
  igual(g.abas['Consignações'][2][7], 29900);
  const h = g.abas['Histórico de correções'];
  igual(h[0], ['Quando','Quem','ID_Consignação','Campo','Antes','Depois']);
  igual(h.slice(1).map(r => [r[1], r[2], r[3], r[4], r[5]]), [['cairo@loja.com', '102', 'valor', '31500', '29900']]);
});

caso('reabrir venda limpa saída e canal e devolve o status à aba Bicicletas', () => {
  const g = carregar(), a = reg(g, 101);
  g.corrigirRegistro({ id: '101', antes: a, depois: Object.assign({}, a, { status: 'Em estoque', saida: '', loja: '' }) });
  const l = g.abas['Consignações'][1];
  igual([l[9], l[8], l[11]], ['Em estoque', '', '']);
  igual(g.abas['Bicicletas'][1][2], 'Em estoque');
  const campos = g.abas['Histórico de correções'].slice(1).map(r => r[3]).sort();
  igual(campos, ['loja', 'saida', 'status']);
});

caso('reabrir mesmo se a tela mandar a data de saída antiga ainda preenchida', () => {
  const g = carregar(), a = reg(g, 101);
  g.corrigirRegistro({ id: '101', antes: a, depois: Object.assign({}, a, { status: 'Em estoque' }) });
  const l = g.abas['Consignações'][1];
  igual([l[9], l[8], l[11]], ['Em estoque', '', '']);
});

caso('recusa se outra pessoa mudou o campo enquanto a tela estava aberta', () => {
  const g = carregar(), a = reg(g, 102);
  g.abas['Consignações'][2][7] = 30000;  // alguém editou direto na planilha
  falha(() => g.corrigirRegistro({ id: '102', antes: a, depois: Object.assign({}, a, { valor: '29900' }) }), 'alterado por outra pessoa');
  igual(g.abas['Consignações'][2][7], 30000);
});

caso('mudança em OUTRO campo por outra pessoa não bloqueia', () => {
  const g = carregar(), a = reg(g, 102);
  g.abas['Consignações'][2][12] = 'obs nova';
  g.corrigirRegistro({ id: '102', antes: a, depois: Object.assign({}, a, { valor: '29900' }) });
  igual(g.abas['Consignações'][2][12], 'obs nova');
});

caso('venda sem canal é recusada', () => {
  const g = carregar(), a = reg(g, 102);
  falha(() => g.corrigirRegistro({ id: '102', antes: a, depois: Object.assign({}, a, { status: 'Vendido', saida: '2026-09-20', loja: '' }) }), 'canal');
});

caso('saída antes da entrada é recusada', () => {
  const g = carregar(), a = reg(g, 101);
  falha(() => g.corrigirRegistro({ id: '101', antes: a, depois: Object.assign({}, a, { saida: '2026-06-01' }) }), 'antes da data de entrada');
});

caso('valor zero é recusado', () => {
  const g = carregar(), a = reg(g, 102);
  falha(() => g.corrigirRegistro({ id: '102', antes: a, depois: Object.assign({}, a, { valor: '0' }) }), 'entre R$ 10');
});

caso('trocar o dono grava ID_Cliente e o nome em Proprietário', () => {
  const g = carregar(), a = reg(g, 102);
  g.corrigirRegistro({ id: '102', antes: a, depois: Object.assign({}, a, { donoId: '3' }) });
  const l = g.abas['Consignações'][2];
  igual([String(l[3]), l[6]], ['3', 'Daniela Carvalho']);
});

caso('descrição corrigida também muda na aba Bicicletas', () => {
  const g = carregar(), a = reg(g, 102);
  g.corrigirRegistro({ id: '102', antes: a, depois: Object.assign({}, a, { item: 'Trek Madone SLR 7' }) });
  igual(g.abas['Consignações'][2][5], 'Trek Madone SLR 7');
  igual(g.abas['Bicicletas'][2][1], 'Trek Madone SLR 7');
});

caso('sem mudança real ("31500" vs 31500) não grava nada', () => {
  const g = carregar(), a = reg(g, 102);
  igual(g.corrigirRegistro({ id: '102', antes: a, depois: Object.assign({}, a, { valor: '31500.00' }) }), 'Nada mudou.');
  igual(g.abas['Histórico de correções'], undefined);
});

caso('Vendido para Retirado limpa o canal', () => {
  const g = carregar(), a = reg(g, 101);
  g.corrigirRegistro({ id: '101', antes: a, depois: Object.assign({}, a, { status: 'Retirado' }) });
  const l = g.abas['Consignações'][1];
  igual([l[9], l[8]], ['Retirado', '']);
  igual(g.abas['Bicicletas'][1][2], 'Retirado');
});

const ENTRADA = { tipo: 'Bicicleta', descricao: 'Cervélo S5', valor: '26400', dataEntrada: '2026-09-30' };

caso('entrada devolve os IDs criados para poder desfazer', () => {
  const g = carregar();
  const r = g.registrarEntrada(Object.assign({ donoNovo: 'Gabriela Nunes' }, ENTRADA));
  igual([r.id, r.idItem, r.bike, r.idCliente, r.donoNovo], ['103', '13', true, '4', true]);
  igual(g.abas['Consignações'].length, 4);
});

caso('desfazer entrada apaga consignação, item e o dono criado junto', () => {
  const g = carregar();
  const r = g.registrarEntrada(Object.assign({ donoNovo: 'Gabriela Nunes' }, ENTRADA));
  g.desfazerEntrada(r);
  igual(g.abas['Consignações'].length, 3);
  igual(g.abas['Bicicletas'].map(l => l[0]), ['ID_Bike', 11, 12]);
  igual(g.abas['Proprietários'].map(l => l[1]), ['Nome', 'Beatriz Almeida', 'Caio Barbosa', 'Daniela Carvalho']);
  igual(g.abas['Histórico de correções'][1][3], 'entrada desfeita');
});

caso('desfazer entrada de dono existente não apaga o dono', () => {
  const g = carregar();
  const r = g.registrarEntrada(Object.assign({ donoId: '3' }, ENTRADA));
  g.desfazerEntrada(r);
  igual(g.abas['Proprietários'].length, 4);
});

caso('desfazer entrada recusa se o item já foi fechado', () => {
  const g = carregar();
  const r = g.registrarEntrada(Object.assign({ donoId: '3' }, ENTRADA));
  g.registrarSaida({ idCons: r.id, status: 'Vendido', canal: 'Física', dataSaida: '2026-09-30' });
  falha(() => g.desfazerEntrada(r), 'já mudou');
  igual(g.abas['Consignações'].length, 4);
});

caso('desfazer saída volta ao estoque e restaura valor e observação', () => {
  const g = carregar();
  g.registrarSaida({ idCons: '102', status: 'Vendido', canal: 'Online', valor: '29000', dataSaida: '2026-09-30', observacoes: 'pix' });
  g.desfazerSaida({ id: '102', status: 'Vendido', valor: 31500, obs: 'risco no quadro' });
  const l = g.abas['Consignações'][2];
  igual([l[9], l[8], l[11], l[7], l[12]], ['Em estoque', '', '', 31500, 'risco no quadro']);
  igual(g.abas['Bicicletas'][2][2], 'Em estoque');
});

caso('desfazer saída recusa se o status já é outro', () => {
  const g = carregar();
  falha(() => g.desfazerSaida({ id: '101', status: 'Retirado', valor: 1, obs: '' }), 'já não está');
});

caso('conferência fica no histórico e volta no carregarOpcoes', () => {
  const g = carregar();
  g.registrarConferencia('102');
  const hoje = new Date(), iso = hoje.getFullYear() + '-' + String(hoje.getMonth()+1).padStart(2,'0') + '-' + String(hoje.getDate()).padStart(2,'0');
  igual(g.carregarOpcoes().conferencias, { '102': iso });
  igual(g.abas['Consignações'][2][9], 'Em estoque');
});

caso('conferência só vale para item em estoque', () => {
  const g = carregar();
  falha(() => g.registrarConferencia('101'), 'não está em estoque');
});

// ---- QA: entradas malformadas que o servidor aceitava (cada uma era um bug)
const BASE = { tipo: 'Bicicleta', descricao: 'Teste', valor: '1000', dataEntrada: '2026-09-30', donoId: '1' };
[
  ['valor "0"', { valor: '0' }, 'entre R$ 10'],
  ['valor "abc"', { valor: 'abc' }, 'entre R$ 10'],
  ['valor negativo', { valor: '-500' }, 'entre R$ 10'],
  ['valor "24.9" (era "24.900" digitado com ponto)', { valor: '24.9' }, null],
  ['valor acima de 1 milhão', { valor: '1e9' }, 'entre R$ 10'],
  ['data "ontem"', { dataEntrada: 'ontem' }, 'inválida'],
  ['data 31/02', { dataEntrada: '2026-02-31' }, 'inválida'],
  ['data no futuro', { dataEntrada: '2031-05-01' }, 'no futuro'],
  ['data antes de 2020', { dataEntrada: '2019-12-31' }, 'anterior a 2020'],
  ['tipo inexistente', { tipo: 'Patinete' }, 'Tipo inválido'],
  ['dono inexistente', { donoId: '999' }, 'não encontrado'],
  ['dono novo com nome já cadastrado (sem acento, minúsculo)', { donoId: '', donoNovo: '  beatriz   ALMEIDA ' }, 'Já existe'],
].forEach(([nome, mud, erro]) => caso('entrada recusa ' + nome, () => {
  const g = carregar();
  if (erro) falha(() => g.registrarEntrada(Object.assign({}, BASE, mud)), erro);
  else g.registrarEntrada(Object.assign({}, BASE, mud));   // 24.9 é válido no servidor; quem pega "24.900" é a tela
  igual(g.abas['Consignações'].length, erro ? 3 : 4);
}));

[
  ['situação "Em estoque"', { status: 'Em estoque' }, 'Situação inválida'],
  ['situação "Doado"', { status: 'Doado' }, 'Situação inválida'],
  ['canal "Feira"', { canal: 'Feira' }, 'canal'],
  ['saída antes da entrada', { dataSaida: '2026-01-01' }, 'anterior à entrada'],
  ['data "amanhã"', { dataSaida: 'amanhã' }, 'inválida'],
  ['valor "0"', { valor: '0' }, 'entre R$ 10'],
].forEach(([nome, mud, erro]) => caso('saída recusa ' + nome, () => {
  const g = carregar();
  falha(() => g.registrarSaida(Object.assign({ idCons: '102', status: 'Vendido', canal: 'Física', dataSaida: '2026-09-30' }, mud)), erro);
  igual(g.abas['Consignações'][2][9], 'Em estoque');
}));

caso('correção recusa data de entrada ilegível em vez de apagá-la', () => {
  const g = carregar(), a = reg(g, 102);
  falha(() => g.corrigirRegistro({ id: '102', antes: a, depois: Object.assign({}, a, { entrada: 'xx' }) }), 'inválida');
  igual(g.abas['Consignações'][2][10] instanceof Date, true);
});

caso('desfazer recusa consignação que não é a entrada mais recente', () => {
  const g = carregar();
  g.registrarEntrada(Object.assign({}, BASE));   // a 103 passa a ser a mais recente
  falha(() => g.desfazerEntrada({ id: '102', idItem: '12', bike: true, idCliente: '2', donoNovo: true }), 'mais recente');
  igual(g.abas['Consignações'].length, 4);
  igual(g.abas['Proprietários'].length, 4);
});

caso('desfazer não apaga dono antigo mesmo se a tela disser que era novo', () => {
  const g = carregar();
  const r = g.registrarEntrada(Object.assign({}, BASE, { donoId: '1' }));
  g.desfazerEntrada(Object.assign({}, r, { donoNovo: true, idCliente: '1' }));
  igual(g.abas['Proprietários'].map(l => l[1]).includes('Beatriz Almeida'), true);
});

caso('texto que começa com = + - @ é gravado como texto, não fórmula', () => {
  const g = carregar();
  g.registrarEntrada(Object.assign({}, BASE, { descricao: '=IMPORTRANGE("x")', observacoes: '- pago no pix' }));
  const l = g.abas['Consignações'].slice(-1)[0];
  igual([l[5], l[12]], ["'=IMPORTRANGE(\"x\")", "'- pago no pix"]);
});

caso('telefone do dono novo vai como texto (mantém + e zero)', () => {
  const g = carregar();
  g.registrarEntrada(Object.assign({}, BASE, { donoId: '', donoNovo: 'Gabriela Nunes', donoContato: '+55 034 99999-0000' }));
  igual(g.abas['Proprietários'].slice(-1)[0][2], "'+55 034 99999-0000");
});

caso('conferir duas vezes no mesmo dia grava uma linha só', () => {
  const g = carregar();
  g.registrarConferencia('102'); g.registrarConferencia('102');
  igual(g.abas['Histórico de correções'].length, 2);
});

console.log(falhas ? '\n❌ ' + falhas + ' falha(s)' : '\n✅ todos passaram');
process.exit(falhas ? 1 : 0);
