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
    'Proprietários': [['ID_Cliente','Nome'], [1,'Beatriz Almeida'], [2,'Caio Barbosa'], [3,'Daniela Carvalho']],
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
  const f = new Function(...Object.keys(ctx), codigo + '\nreturn { carregarOpcoes, corrigirRegistro };');
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
  falha(() => g.corrigirRegistro({ id: '102', antes: a, depois: Object.assign({}, a, { valor: '0' }) }), 'maior que zero');
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

console.log(falhas ? '\n❌ ' + falhas + ' falha(s)' : '\n✅ todos passaram');
process.exit(falhas ? 1 : 0);
