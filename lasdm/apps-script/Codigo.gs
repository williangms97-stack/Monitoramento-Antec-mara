/**
 * LASDM · Rastreabilidade de amostras — banco de dados na Planilha Google (versão 1)
 * Cole em Extensões → Apps Script (planilha NOVA, só para o LASDM), salve e implante como "App da Web":
 *   Executar como: Eu · Quem pode acessar: Qualquer pessoa.
 * Abas criadas sozinhas: Movimentos · Prateleiras · Referência · Usuários · Log de usuários
 * Fotos das etiquetas vão para a pasta "LASDM - Fotos das etiquetas" no Google Drive.
 */
const VERSAO = 1;
const ABA_MOV = 'Movimentos', ABA_PRAT = 'Prateleiras', ABA_REF = 'Referência', ABA_USR = 'Usuários', ABA_LOGUSR = 'Log de usuários';
const CAB_MOV = ['ID', 'Data', 'Hora', 'Protocolo', 'Ação', 'Destino', 'Prateleira', 'Andar', 'Linha', 'Lado', 'Altura', 'Posição',
  'Embalagem', 'Classificação', 'Espécie', 'Cultivar', 'Lote/Origem', 'Produtor', 'Tipo de análise', 'Tipo de remessa', 'Tratamento', 'Categoria',
  'Validação', 'Lido na etiqueta', 'Usuário', 'Aparelho', 'Foto', 'TS', 'Situação', 'Recebido em', 'Obs'];
const CAB_PRAT = ['ID', 'Número', 'Embalagem', 'Situação', 'Obs', 'Atualizado em', 'Atualizado por'];
const CAB_REF = ['Protocolo', 'Data do recebimento', 'Espécie', 'Cultivar', 'Categoria', 'Peneira', 'Lote/Origem', 'Produtor', 'Tipo de análise',
  'Tipo de remessa', 'Tratamento', 'Safra', 'Representatividade', 'Análises abertas', 'Observação', 'Procedência', 'Planilha de origem', 'Data (AAAA-MM-DD)'];
const CAMPOS_REF = ['prot', 'data', 'especie', 'cultivar', 'categoria', 'peneira', 'lote', 'produtor', 'tipoAnalise', 'remessa', 'tratamento', 'safra', 'repres', 'abertas', 'obs', 'procedencia', 'origem'];
const CAB_USR = ['Usuário', 'Nome', 'Perfil', 'Situação', 'Sal', 'Hash', 'Criado em', 'Criado por', 'Atualizado em'];
const CAB_LOGUSR = ['Data/hora', 'Ação', 'Usuário', 'Feito por'];
const PASTA_FOTOS = 'LASDM - Fotos das etiquetas';
const TZ = () => Session.getScriptTimeZone();

function abaCom_(nome, cab) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);
  const atual = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (atual.length < cab.length || atual[0] === '') {
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#173f35').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
const resposta_ = obj => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
const txt_ = v => (v instanceof Date) ? Utilities.formatDate(v, TZ(), 'dd/MM/yyyy') : String(v === undefined || v === null ? '' : v);
const hor_ = v => (v instanceof Date) ? Utilities.formatDate(v, TZ(), 'HH:mm:ss') : String(v || '');
function pastaFotos_() { const it = DriveApp.getFoldersByName(PASTA_FOTOS); return it.hasNext() ? it.next() : DriveApp.createFolder(PASTA_FOTOS); }
const dataKey_ = d => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(txt_(d)); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };

/* ================== USUÁRIOS (senha guardada como SHA-256 de sal + senha) ================== */
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
  if (d.acao === 'criarAdmin') {
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
  if (d.acao === 'usuarios') {
    const adm = conferir_(lista, d.admin && d.admin.usuario, d.admin && d.admin.senha);
    if (!adm || adm.perfil !== 'Administrador') return { ok: false, erro: 'Acesso negado: usuário ou senha de administrador inválidos.' };
    const alvo = normUsr_(d.usuario), u = lista.find(x => x.usuario === alvo);
    if (d.op === 'zerar') {   // apaga movimentos (e, se pedido, prateleiras). Usuários e referência ficam.
      const ss = SpreadsheetApp.getActiveSpreadsheet(), apagadas = {};
      [ABA_MOV].concat(d.prateleiras ? [ABA_PRAT] : []).forEach(nome => { const s2 = ss.getSheetByName(nome); if (!s2) return; const n = s2.getLastRow(); apagadas[nome] = Math.max(0, n - 1); if (n > 1) s2.deleteRows(2, n - 1); });
      const props = PropertiesService.getScriptProperties();
      props.setProperty('RESET_TS', String(Date.now())); props.setProperty('RESET_PRAT', d.prateleiras ? '1' : '0');
      logUsr_('Dados zerados (' + Object.keys(apagadas).map(k => k + ': ' + apagadas[k]).join(', ') + ')', '-', adm.usuario);
      return { ok: true, apagadas };
    }
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
      criadoEm: x.criadoEm instanceof Date ? Utilities.formatDate(x.criadoEm, TZ(), 'dd/MM/yyyy HH:mm') : String(x.criadoEm) }));
    return { ok: true, usuarios: atual };
  }
  return null;
}

/* ================== MOVIMENTOS ================== */
function movDeLinha_(v) {
  return { id: String(v[0]), data: txt_(v[1]), hora: hor_(v[2]), protocolo: String(v[3]), acao: String(v[4]), destino: String(v[5]),
    prateleira: v[6] === '' ? '' : Number(v[6]), andar: v[7] === '' ? '' : Number(v[7]), linha: v[8] === '' ? '' : Number(v[8]), lado: String(v[9]), altura: v[10] === '' ? '' : Number(v[10]),
    posicao: String(v[11]), embalagem: String(v[12]), classificacao: String(v[13]), especie: String(v[14]), cultivar: String(v[15]), lote: String(v[16]),
    produtor: String(v[17]), tipoAnalise: String(v[18]), remessa: String(v[19]), tratamento: String(v[20]), categoria: String(v[21]),
    validacao: String(v[22]), lido: String(v[23]), usuario: String(v[24]), aparelho: String(v[25]), fotoUrl: String(v[26]), ts: Number(v[27]) || 0, situacao: String(v[28]), obs: String(v[30] || '') };
}
function lerMovimentos_() {
  const sh = abaCom_(ABA_MOV, CAB_MOV), n = sh.getLastRow();
  return { sh, vals: n > 1 ? sh.getRange(2, 1, n - 1, CAB_MOV.length).getValues() : [] };
}
// estado atual de cada amostra (mesma lógica do app): última posição ocupada por quem está no arquivo ou em sala
function ocupadas_(movs) {
  const est = {};
  movs.slice().sort((a, b) => a.ts - b.ts).forEach(m => {
    if (/^Conflito|^Excluíd/.test(m.situacao || '')) return;
    const e = est[m.protocolo] || (est[m.protocolo] = { slot: '', status: '' });
    if (m.acao === 'ARMAZENAR' || m.acao === 'REMANEJAR' || m.acao === 'RETORNO') { if (m.prateleira !== '') e.slot = [m.prateleira, m.andar, m.linha, m.lado, m.altura].join('-'); e.status = 'ARQUIVO'; }
    else if (m.acao === 'SALA') e.status = 'SALA';
    else if (m.acao === 'BAIXA') { e.status = 'BAIXA'; e.slot = ''; }
  });
  const occ = {};
  Object.keys(est).forEach(p => { const e = est[p]; if (e.slot && (e.status === 'ARQUIVO' || e.status === 'SALA')) occ[e.slot] = p; });
  return occ;
}

/* ================== GET ==================
   ?acao=dados&desde=TS  → movimentos (todos os que ainda definem a posição + os recentes), prateleiras
   ?acao=ref&desde=AAAA-MM-DD → referência recebida a partir da data · ?acao=ref&prot=17215/2026 → uma amostra */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.acao === 'dados') {
    const desde = Number(p.desde || 0);
    const { vals } = lerMovimentos_();
    const todos = vals.map(movDeLinha_).filter(m => m.id);
    // mantém sempre o último movimento de cada amostra (para o estado atual), mais todos a partir de "desde"
    const ultimo = {}; todos.forEach(m => { if (!ultimo[m.protocolo] || m.ts >= ultimo[m.protocolo].ts) ultimo[m.protocolo] = m; });
    const ultArm = {}; todos.forEach(m => { if ((m.acao === 'ARMAZENAR' || m.acao === 'REMANEJAR' || m.acao === 'RETORNO') && !/^Conflito/.test(m.situacao)) { if (!ultArm[m.protocolo] || m.ts >= ultArm[m.protocolo].ts) ultArm[m.protocolo] = m; } });
    const manter = {}; Object.keys(ultimo).forEach(k => { manter[ultimo[k].id] = 1; }); Object.keys(ultArm).forEach(k => { manter[ultArm[k].id] = 1; });
    const movimentos = todos.filter(m => manter[m.id] || !desde || m.ts >= desde);
    const shp = abaCom_(ABA_PRAT, CAB_PRAT), np = shp.getLastRow();
    const prateleiras = np > 1 ? shp.getRange(2, 1, np - 1, CAB_PRAT.length).getValues().filter(v => v[0]).map(v => ({ id: String(v[0]), numero: Number(v[1]), embalagem: String(v[2]), situacao: String(v[3] || 'Ativa'), obs: String(v[4] || '') })) : [];
    const props = PropertiesService.getScriptProperties();
    const shr = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_REF);
    return resposta_({ ok: true, versao: VERSAO, movimentos, prateleiras, reset: Number(props.getProperty('RESET_TS') || 0), resetPrat: props.getProperty('RESET_PRAT') === '1',
      refInfo: { linhas: shr ? Math.max(0, shr.getLastRow() - 1) : 0, atualizada: props.getProperty('REF_EM') || '' } });
  }
  if (p.acao === 'ref') {
    const sh = abaCom_(ABA_REF, CAB_REF), n = sh.getLastRow();
    if (n < 2) return resposta_({ ok: true, ref: [] });
    const vals = sh.getRange(2, 1, n - 1, CAB_REF.length).getValues();
    const conv = v => { const o = {}; CAMPOS_REF.forEach((k, i) => { o[k] = k === 'data' ? txt_(v[i]) : String(v[i] === null ? '' : v[i]); }); return o; };
    if (p.prot) { const v = vals.find(x => String(x[0]) === String(p.prot)); return resposta_({ ok: true, ref: v ? [conv(v)] : [] }); }
    if (p.prots) { const quer = {}; String(p.prots).split(',').forEach(x => quer[x] = 1); return resposta_({ ok: true, ref: vals.filter(x => quer[String(x[0])]).map(conv) }); }
    const desde = String(p.desde || '');
    return resposta_({ ok: true, ref: vals.filter(v => v[0] && (!desde || String(v[17] || dataKey_(v[1])) >= desde)).map(conv) });
  }
  return resposta_({ ok: true, msg: 'Planilha LASDM conectada', versao: VERSAO });
}

/* ================== POST ================== */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(28000);
  try {
    const d = JSON.parse(e.postData.contents || '{}');
    if (d.acao && d.acao !== 'ref') { const r = usuarios_(d); if (r) return resposta_(r); }
    if (d.acao === 'ref') return resposta_(referencia_(d));
    const props = PropertiesService.getScriptProperties();
    const resetTs = Number(props.getProperty('RESET_TS') || 0);

    // prateleiras (cadastro / alteração)
    const pratOk = [];
    if ((d.prateleiras || []).length) {
      const shp = abaCom_(ABA_PRAT, CAB_PRAT), np = shp.getLastRow(), lin = {};
      if (np > 1) shp.getRange(2, 1, np - 1, 1).getValues().forEach((v, i) => lin[String(v[0])] = i + 2);
      d.prateleiras.forEach(p => {
        const row = [p.id, Number(p.numero), p.embalagem, p.situacao || 'Ativa', p.obs || '', new Date(), d.usuario || ''];
        if (lin[p.id]) shp.getRange(lin[p.id], 1, 1, CAB_PRAT.length).setValues([row]); else { shp.appendRow(row); lin[p.id] = shp.getLastRow(); }
        pratOk.push(p.id + '|' + (p.situacao || 'Ativa') + '|' + p.numero);
      });
    }

    // movimentos
    const { sh, vals } = lerMovimentos_();
    const existentes = {}; vals.forEach((v, i) => existentes[String(v[0])] = i + 2);
    const movs = vals.map(movDeLinha_);
    const recebidos = [], fotos = {}, conflitos = [], novas = [];
    (d.movimentos || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(m => {
      if (existentes[m.id]) { recebidos.push(m.id); return; }
      if (resetTs && Number(m.ts || 0) && Number(m.ts) < resetTs) { recebidos.push(m.id); return; }
      let situacao = 'Ativo';
      if ((m.acao === 'ARMAZENAR' || m.acao === 'REMANEJAR' || m.acao === 'RETORNO') && m.prateleira !== '' && m.prateleira != null) {
        const occ = ocupadas_(movs), k = [Number(m.prateleira), Number(m.andar), Number(m.linha), m.lado, Number(m.altura)].join('-');
        if (occ[k] && occ[k] !== m.protocolo) { situacao = 'Conflito: posição ocupada por ' + occ[k]; conflitos.push({ id: m.id, protocolo: m.protocolo, ocupante: occ[k] }); }
      }
      let urlFoto = '';
      if (m.foto) {
        try {
          const blob = Utilities.newBlob(Utilities.base64Decode(m.foto), 'image/jpeg', String(m.protocolo).replace(/\//g, '-') + '_' + String(m.data).replace(/\//g, '-') + '_' + String(m.hora).replace(/:/g, '') + '.jpg');
          const arq = pastaFotos_().createFile(blob);
          arq.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          urlFoto = arq.getUrl(); fotos[m.id] = urlFoto;
        } catch (err) { urlFoto = 'Erro ao salvar foto: ' + err; }
      }
      const linha = [m.id, m.data, m.hora, m.protocolo, m.acao, m.destino || '', m.prateleira === undefined ? '' : m.prateleira, m.andar === undefined ? '' : m.andar,
        m.linha === undefined ? '' : m.linha, m.lado || '', m.altura === undefined ? '' : m.altura, m.posicao || '', m.embalagem || '', m.classificacao || '',
        m.especie || '', m.cultivar || '', m.lote || '', m.produtor || '', m.tipoAnalise || '', m.remessa || '', m.tratamento || '', m.categoria || '',
        m.validacao || '', m.lido || '', m.usuario || '', m.aparelho || '', urlFoto, m.ts || '', situacao, new Date(), m.obs || ''];
      novas.push(linha); movs.push(movDeLinha_(linha)); recebidos.push(m.id);
    });
    if (novas.length) {
      const ini = sh.getLastRow() + 1;
      sh.getRange(ini, 1, novas.length, 4).setNumberFormat('@');
      sh.getRange(ini, 1, novas.length, CAB_MOV.length).setValues(novas);
      novas.forEach((r, i) => { if (/^Conflito/.test(r[28])) sh.getRange(ini + i, 1, 1, CAB_MOV.length).setFontColor('#b3261e'); });
    }
    return resposta_({ ok: true, recebidos, fotos, conflitos, prateleiras: pratOk });
  } catch (err) {
    return resposta_({ ok: false, erro: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ================== REFERÊNCIA (planilhas do sistema e manual, enviadas pelo painel) ==================
   op 'inicio' limpa a aba · op 'parte' acrescenta linhas · op 'fim' registra a data da atualização. Exige administrador. */
function referencia_(d) {
  const { lista } = lerUsuarios_();
  const adm = conferir_(lista, d.admin && d.admin.usuario, d.admin && d.admin.senha);
  if (!adm || adm.perfil !== 'Administrador') return { ok: false, erro: 'Acesso negado: só administradores atualizam as planilhas de referência.' };
  const sh = abaCom_(ABA_REF, CAB_REF);
  if (d.op === 'inicio') { const n = sh.getLastRow(); if (n > 1) sh.getRange(2, 1, n - 1, CAB_REF.length).clearContent(); return { ok: true }; }
  if (d.op === 'parte') {
    const linhas = (d.linhas || []).map(r => CAMPOS_REF.map(k => r[k] || '').concat([dataKeyTxt_(r.data)]));
    if (linhas.length) { const ini = sh.getLastRow() + 1; const rg = sh.getRange(ini, 1, linhas.length, CAB_REF.length); rg.setNumberFormat('@'); rg.setValues(linhas); }
    return { ok: true, gravadas: linhas.length };
  }
  if (d.op === 'fim') {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('REF_EM', Utilities.formatDate(new Date(), TZ(), 'dd/MM/yyyy HH:mm') + ' por ' + adm.usuario + (d.resumo ? ' (' + d.resumo + ')' : ''));
    logUsr_('Planilhas de referência atualizadas: ' + (d.resumo || ''), '-', adm.usuario);
    return { ok: true, linhas: sh.getLastRow() - 1 };
  }
  return { ok: false, erro: 'Operação inválida.' };
}
function dataKeyTxt_(s) { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; }
