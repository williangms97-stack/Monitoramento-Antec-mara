/**
 * Monitor de Antecâmara — banco de dados central na Planilha Google (versão 4: vários aparelhos, usuários e duplicadas offline)
 * Cole em Extensões → Apps Script, salve e implante como "App da Web".
 * Abas: Bipagens · Checklists · Finalizados · Locais · Usuários · Log de usuários · Repetidas offline. Fotos dos pré-lotes vão para uma pasta no Google Drive.
 * Cada celular envia o que fez (POST) e baixa o que os outros fizeram (GET ?acao=dados).
 */
const ABA = 'Bipagens';
const CABECALHO = [
  'ID', 'Data', 'Hora', 'Lote / Pré-lote', 'Empresa', 'Local', 'Reincidente',
  'Dia na sequência', 'Início da sequência', 'Tempo fora', 'Tempo fora (horas)',
  'Código QR', 'Aparelho', 'Recebido em', 'Situação',
  'Tipo', 'Variedade', 'Categoria', 'Peso', 'Safra', 'Origem', 'Produzido', 'Obs', 'Foto', 'TS', 'Local ID'
];
const CAB_CHECK = ['Data', 'Hora', 'Ação', 'Aparelho', 'Reincidentes conferidos', 'Finalizados', 'Lotes finalizados', 'Recebido em', 'ID', 'TS', 'Dia'];
const CAB_LOCAIS = ['ID', 'Armazém / antecâmara', 'Posição', 'Situação', 'Atualizado em'];
const CAB_FIN = ['Finalizado em', 'Tipo', 'Lote / Pré-lote', 'Empresa', 'Primeira bipagem', 'Última bipagem', 'Último local', 'Tempo fora', 'Tempo fora (horas)', 'Aparelho', 'Situação'];
const CAB_DUP = ['Registrado em', 'Tipo', 'Lote / Pré-lote', 'Data', 'Local', 'Mantida: hora', 'Mantida: usuário', 'Mantida: ID', 'Excluída: hora', 'Excluída: usuário', 'Excluída: ID', 'Motivo'];
const CAB_USR = ['Usuário', 'Nome', 'Perfil', 'Situação', 'Sal', 'Hash', 'Criado em', 'Criado por', 'Atualizado em'];
const CAB_LOGUSR = ['Data/hora', 'Ação', 'Usuário', 'Feito por'];
const ABA_DUP = 'Repetidas offline', ABA_USR = 'Usuários', ABA_LOGUSR = 'Log de usuários';
const PASTA_FOTOS = 'Monitor Antecâmara - Fotos';

function abaCom_(nome, cab) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);
  // cria ou completa o cabeçalho (mantém planilhas da versão anterior)
  const atual = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (atual.length < cab.length || atual[0] === '') {
    sh.getRange(1, 1, 1, cab.length).setValues([cab])
      .setFontWeight('bold').setBackground('#0f2a3d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function pastaFotos_() {
  const it = DriveApp.getFoldersByName(PASTA_FOTOS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PASTA_FOTOS);
}

function resposta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

const txt_ = v => (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy') : String(v === undefined || v === null ? '' : v);
const hor_ = v => (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm:ss') : String(v || '');

/* ================== USUÁRIOS ==================
   Senhas nunca ficam em texto: guardamos SHA-256(sal + ':' + senha). */
const hex_ = bytes => bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
const hashSenha_ = (sal, senha) => hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + ':' + senha, Utilities.Charset.UTF_8));
const normUsr_ = u => String(u || '').trim().toLowerCase();
function lerUsuarios_() {
  const sh = abaCom_(ABA_USR, CAB_USR), n = sh.getLastRow();
  const lista = n > 1 ? sh.getRange(2, 1, n - 1, CAB_USR.length).getValues() : [];
  return { sh, lista: lista.map((v, i) => ({ linha: i + 2, usuario: String(v[0]), nome: String(v[1]), perfil: String(v[2]), situacao: String(v[3]), sal: String(v[4]), hash: String(v[5]), criadoEm: v[6], criadoPor: String(v[7]) })).filter(u => u.usuario) };
}
function logUsr_(acao, usuario, por) { abaCom_(ABA_LOGUSR, CAB_LOGUSR).appendRow([new Date(), acao, usuario, por || '']); }
function conferir_(lista, usuario, senha) {
  const u = lista.find(x => x.usuario === normUsr_(usuario));
  if (!u || u.situacao !== 'Ativo' || hashSenha_(u.sal, String(senha || '')) !== u.hash) return null;
  return u;
}
function usuarios_(d) {
  const { sh, lista } = lerUsuarios_();
  const temAdmin = lista.some(u => u.perfil === 'Administrador' && u.situacao === 'Ativo');
  if (d.acao === 'statusUsuarios') return { ok: true, temAdmin };
  if (d.acao === 'criarAdmin') {   // só funciona com a lista de usuários vazia (primeiro acesso)
    if (lista.length) return { ok: false, erro: 'O administrador já foi criado. Entre com usuário e senha.' };
    const usr = normUsr_(d.usuario), senha = String(d.senha || '');
    if (!usr || senha.length < 4) return { ok: false, erro: 'Informe usuário e uma senha com pelo menos 4 caracteres.' };
    const sal = Utilities.getUuid();
    sh.appendRow([usr, d.nome || usr, 'Administrador', 'Ativo', sal, hashSenha_(sal, senha), new Date(), '(primeiro acesso)', new Date()]);
    logUsr_('Administrador criado', usr, '(primeiro acesso)');
    return { ok: true };
  }
  if (d.acao === 'login') {
    const u = conferir_(lista, d.usuario, d.senha);
    if (!u) return { ok: false, erro: 'Usuário ou senha inválidos.' };
    logUsr_('Login', u.usuario, d.aparelho || '');
    return { ok: true, usuario: { usuario: u.usuario, nome: u.nome, perfil: u.perfil }, sal: u.sal, hash: u.hash };
  }
  if (d.acao === 'usuarios') {   // área do administrador: exige usuário e senha de um Administrador
    const adm = conferir_(lista, d.admin && d.admin.usuario, d.admin && d.admin.senha);
    if (!adm || adm.perfil !== 'Administrador') return { ok: false, erro: 'Acesso negado: usuário ou senha de administrador inválidos.' };
    const alvo = normUsr_(d.usuario), u = lista.find(x => x.usuario === alvo);
    if (d.op === 'salvar') {
      const senha = String(d.senha || '');
      if (!alvo || !/^[a-z0-9._-]{2,30}$/.test(alvo)) return { ok: false, erro: 'Usuário inválido: use letras, números, ponto, hífen ou sublinhado (sem espaços).' };
      if (u) return { ok: false, erro: 'Este usuário já existe.' };
      if (senha.length < 4) return { ok: false, erro: 'A senha precisa ter pelo menos 4 caracteres.' };
      const sal = Utilities.getUuid();
      sh.appendRow([alvo, d.nome || alvo, d.perfil === 'Administrador' ? 'Administrador' : 'Operador', 'Ativo', sal, hashSenha_(sal, senha), new Date(), adm.usuario, new Date()]);
      logUsr_('Usuário cadastrado (' + (d.perfil === 'Administrador' ? 'Administrador' : 'Operador') + ')', alvo, adm.usuario);
    } else if (d.op === 'senha') {
      if (!u) return { ok: false, erro: 'Usuário não encontrado.' };
      if (String(d.senha || '').length < 4) return { ok: false, erro: 'A senha precisa ter pelo menos 4 caracteres.' };
      const sal = Utilities.getUuid();
      sh.getRange(u.linha, 5, 1, 2).setValues([[sal, hashSenha_(sal, String(d.senha))]]); sh.getRange(u.linha, 9).setValue(new Date());
      logUsr_('Senha alterada', u.usuario, adm.usuario);
    } else if (d.op === 'situacao') {
      if (!u) return { ok: false, erro: 'Usuário não encontrado.' };
      if (u.usuario === adm.usuario) return { ok: false, erro: 'Você não pode desativar o próprio usuário.' };
      const nova = u.situacao === 'Ativo' ? 'Inativo' : 'Ativo';
      sh.getRange(u.linha, 4).setValue(nova); sh.getRange(u.linha, 9).setValue(new Date());
      logUsr_(nova === 'Ativo' ? 'Usuário reativado' : 'Usuário desativado', u.usuario, adm.usuario);
    }
    const atual = lerUsuarios_().lista.map(x => ({ usuario: x.usuario, nome: x.nome, perfil: x.perfil, situacao: x.situacao, criadoPor: x.criadoPor,
      criadoEm: x.criadoEm instanceof Date ? Utilities.formatDate(x.criadoEm, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : String(x.criadoEm) }));
    return { ok: true, usuarios: atual };
  }
  return null;
}

/* ================== BIPAGENS REPETIDAS (offline) ==================
   Mesmo lote/pré-lote, mesmo dia e mesmo local em mais de uma bipagem ativa: mantém a mais antiga,
   exclui as demais e registra o histórico na aba "Repetidas offline". */
const normLocal_ = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
function tsLinha_(v) {
  const t = Number(v[24]); if (t) return t;
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(txt_(v[1])), h = hor_(v[2]) || '00:00:00';
  return m ? new Date(m[3] + '-' + m[2] + '-' + m[1] + 'T' + h).getTime() : 0;
}
function resolverRepetidas_(sh, idsNovos) {
  const n = sh.getLastRow(); if (n < 2 || !idsNovos.length) return [];
  const vals = sh.getRange(2, 1, n - 1, CABECALHO.length).getValues();
  const ativas = vals.map((v, i) => ({ v, linha: i + 2, id: String(v[0]), ts: tsLinha_(v) })).filter(x => String(x.v[14]).indexOf('Excluída') !== 0);
  const novos = new Set(idsNovos), excluidas = [];
  const mesmo = (a, b) => String(a.v[15] || 'Lote') === String(b.v[15] || 'Lote') && String(a.v[3]).toUpperCase() === String(b.v[3]).toUpperCase()
    && txt_(a.v[1]) === txt_(b.v[1]) && ((a.v[25] && a.v[25] === b.v[25]) || normLocal_(a.v[5]) === normLocal_(b.v[5]));
  ativas.filter(x => novos.has(x.id)).forEach(nova => {
    if (excluidas.indexOf(nova.id) >= 0) return;
    const grupo = ativas.filter(x => excluidas.indexOf(x.id) < 0 && mesmo(x, nova)).sort((a, b) => a.ts - b.ts);
    if (grupo.length < 2) return;
    const mantida = grupo[0], log = abaCom_(ABA_DUP, CAB_DUP);
    grupo.slice(1).forEach(x => {
      sh.getRange(x.linha, 15).setValue('Excluída (repetida offline)');
      sh.getRange(x.linha, 1, 1, CABECALHO.length).setFontLine('line-through').setFontColor('#999999');
      log.appendRow([new Date(), x.v[15] || 'Lote', x.v[3], txt_(x.v[1]), x.v[5], hor_(mantida.v[2]), mantida.v[12], mantida.id, hor_(x.v[2]), x.v[12], x.id,
        'Mesmo lote no mesmo local no mesmo dia (bipagem feita sem internet). Mantida a mais antiga.']);
      excluidas.push(x.id);
    });
  });
  return excluidas;
}

function doGet(e) {
  const sh = abaCom_(ABA, CABECALHO);
  if (!e || !e.parameter || e.parameter.acao !== 'dados') return resposta_({ ok: true, msg: 'Planilha conectada' });
  const desde = Number(e.parameter.desde || 0);
  const n = sh.getLastRow();
  const registros = [];
  if (n > 1) {
    sh.getRange(2, 1, n - 1, CABECALHO.length).getValues().forEach(v => {
      const ts = Number(v[24]) || 0;
      if (ts && ts < desde) return;
      const dados = {};
      [['variedade',16],['categoria',17],['peso',18],['safra',19],['origem',20],['produzido',21],['obs',22]].forEach(([k,i]) => { if (v[i] !== '') dados[k] = txt_(v[i]); });
      registros.push({
        id: String(v[0]), data: txt_(v[1]), hora: hor_(v[2]), lote: String(v[3]), empresa: String(v[4]), local: String(v[5]),
        codigo: String(v[11]), aparelho: String(v[12]), situacao: String(v[14]), tipo: String(v[15] || 'Lote'),
        dados: Object.keys(dados).length ? dados : undefined, fotoUrl: String(v[23] || ''), ts: ts, localId: String(v[25] || '')
      });
    });
  }
  const eventos = [];
  const shc = abaCom_('Checklists', CAB_CHECK), nc = shc.getLastRow();
  if (nc > 1) shc.getRange(2, 1, nc - 1, CAB_CHECK.length).getValues().forEach(v => {
    if (v[8] && v[9]) eventos.push({ id: String(v[8]), ts: Number(v[9]), data: String(v[10]), acao: String(v[2]), aparelho: String(v[3]) });
  });
  const locais = [];
  const shl = abaCom_('Locais', CAB_LOCAIS), nl = shl.getLastRow();
  if (nl > 1) shl.getRange(2, 1, nl - 1, CAB_LOCAIS.length).getValues().forEach(v => {
    if (v[0]) locais.push({ id: String(v[0]), armazem: String(v[1]), posicao: String(v[2]), situacao: String(v[3] || 'Ativo') });
  });
  return resposta_({ ok: true, registros, eventos, locais });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const dados = JSON.parse(e.postData.contents || '{}');
    if (dados.acao) { const r = usuarios_(dados); if (r) return resposta_(r); }
    const sh = abaCom_(ABA, CABECALHO);
    const ultima = sh.getLastRow();
    const ids = ultima > 1 ? sh.getRange(2, 1, ultima - 1, 1).getValues().map(r => String(r[0])) : [];
    const pos = {};
    ids.forEach((id, i) => pos[id] = i + 2);

    const recebidos = [], fotos = {}, novas = [];
    (dados.registros || []).forEach(r => {
      if (pos[r.id]) { recebidos.push(r.id); return; }   // já existe: não duplica
      let urlFoto = '';
      if (r.foto) {
        try {
          const blob = Utilities.newBlob(Utilities.base64Decode(r.foto), 'image/jpeg',
            (r.tipo || 'Lote') + '_' + r.lote + '_' + r.data.replace(/\//g, '-') + '_' + r.hora.replace(/:/g, '') + '.jpg');
          const arq = pastaFotos_().createFile(blob);
          arq.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          urlFoto = arq.getUrl();
          fotos[r.id] = urlFoto;
        } catch (err) { urlFoto = 'Erro ao salvar foto: ' + err; }
      }
      const d = r.dados || {};
      novas.push([
        r.id, r.data, r.hora, r.lote, r.empresa || r.modelo, r.local, r.reincidente,
        r.diaSeq, r.inicio, r.tempoFora, r.horasFora, r.codigo, r.aparelho,
        new Date(), 'Ativa',
        r.tipo || 'Lote', d.variedade || '', d.categoria || '', d.peso || '', d.safra || '',
        d.origem || '', d.produzido || '', d.obs || '', urlFoto, r.ts || '', r.localId || ''
      ]);
      recebidos.push(r.id);
    });
    if (novas.length) {
      const ini = sh.getLastRow() + 1;
      sh.getRange(ini, 2, novas.length, 3).setNumberFormat('@');   // data, hora e lote como texto
      sh.getRange(ini, 12, novas.length, 1).setNumberFormat('@');  // código QR como texto
      sh.getRange(ini, 1, novas.length, CABECALHO.length).setValues(novas);
    }

    const excluidos = [];
    (dados.excluir || []).forEach(id => {
      if (pos[id]) {
        sh.getRange(pos[id], 15).setValue('Excluída' + (dados.usuario ? ' por ' + dados.usuario : ''));
        sh.getRange(pos[id], 1, 1, CABECALHO.length).setFontLine('line-through').setFontColor('#999999');
      }
      excluidos.push(id);
    });

    const repetidas = resolverRepetidas_(sh, novas.map(x => String(x[0])));

    const checklists = [];
    (dados.checklists || []).forEach(c => {
      const shc = abaCom_('Checklists', CAB_CHECK);
      const shf = abaCom_('Finalizados', CAB_FIN);
      const fin = c.finalizados || [];
      shc.getRange(shc.getLastRow() + 1, 1, 1, 1).setNumberFormat('@');
      shc.getRange(shc.getLastRow() + 1, 11, 1, 1).setNumberFormat('@');
      shc.appendRow([c.data, c.hora, c.acao, c.aparelho, c.conferidos, fin.length, fin.map(f => f.lote).join(', '), new Date(), c.id, c.ts || '', c.dataKey || '']);
      if (c.acao === 'Reaberto') {
        // cancela as finalizações daquele dia feitas por este aparelho
        const n = shf.getLastRow();
        if (n > 1) {
          const vals = shf.getRange(2, 1, n - 1, CAB_FIN.length).getValues();
          vals.forEach((v, i) => {
            if (String(v[0]) === c.data && String(v[9]) === c.aparelho && v[10] === 'Finalizado') {
              shf.getRange(i + 2, 11).setValue('Cancelado (checklist reaberto)');
              shf.getRange(i + 2, 1, 1, CAB_FIN.length).setFontColor('#999999');
            }
          });
        }
      }
      if (fin.length) {
        const ini = shf.getLastRow() + 1;
        shf.getRange(ini, 1, fin.length, 3).setNumberFormat('@');
        shf.getRange(ini, 1, fin.length, CAB_FIN.length).setValues(fin.map(f => [
          c.data, f.tipo, f.lote, f.empresa, f.inicio, f.ultima, f.local, f.tempoFora, f.horasFora, c.aparelho, 'Finalizado'
        ]));
      }
      checklists.push(c.id);
    });

    const locaisOk = [];
    if ((dados.locais || []).length) {
      const shl = abaCom_('Locais', CAB_LOCAIS), nl = shl.getLastRow();
      const lin = {};
      if (nl > 1) shl.getRange(2, 1, nl - 1, 1).getValues().forEach((v, i) => lin[String(v[0])] = i + 2);
      dados.locais.forEach(l => {
        const row = [l.id, l.armazem || '', l.posicao || '', l.situacao || 'Ativo', new Date()];
        if (lin[l.id]) shl.getRange(lin[l.id], 1, 1, CAB_LOCAIS.length).setValues([row]);
        else { shl.appendRow(row); lin[l.id] = shl.getLastRow(); }
        locaisOk.push(l.id + '|' + (l.situacao || 'Ativo'));
      });
    }

    return resposta_({ ok: true, recebidos, excluidos, checklists, fotos, locais: locaisOk, repetidas });
  } catch (err) {
    return resposta_({ ok: false, erro: String(err) });
  } finally {
    lock.releaseLock();
  }
}
