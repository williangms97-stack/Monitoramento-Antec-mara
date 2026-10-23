/* =====================================================================
   LASDM · Rastreabilidade de amostras — regras compartilhadas (app e painel)
   - Grupos de tipo de remessa (cores da tabela do prompt)
   - Perfil de prateleira (cultura, tratamento, produtor INOVA, embalagem, grupo)
   - Endereçamento: Prateleira · Andar · Linha · Lado · Altura
   - Estado atual das amostras a partir dos movimentos
   - Etiqueta de linha (faixas de protocolos por Trás / Frente)
   ===================================================================== */
(function (G) {
  'use strict';
  const up = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

  /* ---------- Protocolo (Número da Amostra) ---------- */
  // aceita "17215/2026", "Prot: 17215/2026", "17.215/2026", "17215" (ano atual)
  function normProt(s, anoPadrao) {
    const t = String(s == null ? '' : s);
    let m = /(\d{1,3}(?:[.\s]\d{3})+|\d{1,7})\s*\/\s*(20\d{2})/.exec(t);
    if (m) return m[1].replace(/[.\s]/g, '').replace(/^0+(?=\d)/, '') + '/' + m[2];
    m = /^\s*(\d{1,7})\s*$/.exec(t);
    if (m) return m[1].replace(/^0+(?=\d)/, '') + '/' + (anoPadrao || new Date().getFullYear());
    return '';
  }
  const protNum = p => Number(String(p).split('/')[0]) || 0;
  const protAno = p => Number(String(p).split('/')[1]) || 0;
  const milhar = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  /* ---------- Tipos de remessa → grupo de prateleira ---------- */
  const GRUPOS = {
    VERDE:      { nome: 'Lote / Teste / Devoluções / Entrada / Revalidação / Reembalagem', curto: 'Verde', cor: '#83E28E', tinta: '#0f3d17' },
    TSI:        { nome: 'TSI (não mistura)', curto: 'TSI', cor: '#F7C7AC', tinta: '#6b2c0b' },
    PRECOLHEITA:{ nome: 'Pré-colheita', curto: 'Pré-colheita', cor: '#FFFF00', tinta: '#4d4a00' },
    PRELOTE:    { nome: 'Pré-lote', curto: 'Pré-lote', cor: '#D86DCD', tinta: '#3d0b37' },
    CARREG:     { nome: 'Carregamentos', curto: 'Carregamentos', cor: '#4D93D9', tinta: '#ffffff' },
    INTERLAB:   { nome: 'Inter/Intralaboratorial', curto: 'Interlab.', cor: '#C9C9C9', tinta: '#1f1f1f' },
    MANUAL:     { nome: 'Amostras manuais', curto: 'Manual', cor: '#E8E2D0', tinta: '#3a3320' },
    NAO:        { nome: 'Não armazena no arquivo', curto: 'Não armazena', cor: '#BE5014', tinta: '#ffffff' },
    OUTROS:     { nome: 'Outros tipos', curto: 'Outros', cor: '#DDDDDD', tinta: '#1f1f1f' }
  };
  const REMESSA_GRUPO = {
    'LOTE': 'VERDE', 'TESTE': 'VERDE', 'DEVOLUCOES': 'VERDE', 'ENTRADA SEMENTE': 'VERDE', 'REVALIDACAO': 'VERDE', 'REEMBALAGEM': 'VERDE',
    'TSI': 'TSI', 'PRE COLHEITA': 'PRECOLHEITA', 'PRE LOTE': 'PRELOTE', 'CARREGAMENTOS': 'CARREG',
    'CARGAS CLASSIFICACAO': 'NAO', 'SECADOR': 'NAO'
  };
  const TIPOS_REMESSA = ['LOTE', 'TESTE', 'DEVOLUÇÕES', 'ENTRADA SEMENTE', 'REVALIDAÇÃO', 'REEMBALAGEM', 'TSI', 'PRE COLHEITA', 'PRE LOTE', 'CARREGAMENTOS', 'CARGAS CLASSIFICAÇÃO', 'SECADOR'];
  const CULTURAS_PROTOCOLO = ['SOJA', 'MILHO'];

  /* Classifica uma amostra (dados vindos das planilhas ou digitados) */
  function classificar(a) {
    const especie = up(a.especie);
    const protocolo = CULTURAS_PROTOCOLO.indexOf(especie) >= 0;
    const tipo = up(a.tipoAnalise);
    let grupo;
    if (!protocolo) grupo = 'MANUAL';
    else if (/INTER|INTRA/.test(tipo)) grupo = 'INTERLAB';
    else grupo = REMESSA_GRUPO[up(a.remessa)] || (a.remessa ? 'OUTROS' : 'OUTROS');
    const trat = up(a.tratamento);
    const tratada = grupo === 'TSI' || !!(trat && trat !== '-O-' && trat !== 'SEM TRATAMENTO' && trat !== 'NAO');
    const inova = /INOVA\s*GENETICA/.test(up(a.produtor));
    return {
      classificacao: protocolo ? 'Protocolo' : 'Entrada de amostra manual',
      cultura: especie || 'NÃO INFORMADA',
      grupo, tratada, inova,
      armazena: grupo !== 'NAO'
    };
  }
  // chave que define quem pode dividir a mesma prateleira (regras 1 a 4 + embalagem)
  function perfil(a, embalagem) {
    const c = classificar(a);
    return { cultura: c.cultura, tratada: c.tratada, inova: c.inova, grupo: c.grupo, embalagem: embalagem || a.embalagem || '' };
  }
  const chavePerfil = p => [p.cultura, p.tratada ? 'TRAT' : 'SEM', p.inova ? 'INOVA' : 'GERAL', p.grupo, p.embalagem].join('|');
  function textoPerfil(p) {
    if (!p) return 'Livre';
    return [p.cultura, p.tratada ? 'Tratada' : 'Sem tratamento', p.inova ? 'INOVA GENÉTICA' : 'Demais produtores', (GRUPOS[p.grupo] || {}).curto || p.grupo].join(' · ');
  }
  // explica por que a amostra não pode entrar numa prateleira com outro perfil
  function motivosIncompat(pa, pb) {
    const m = [];
    if (pa.embalagem !== pb.embalagem) m.push('embalagem diferente (' + nomeEmb(pb.embalagem) + ')');
    if (pa.cultura !== pb.cultura) m.push('cultura diferente (' + pb.cultura + ')');
    if (pa.tratada !== pb.tratada) m.push(pb.tratada ? 'prateleira de amostras tratadas' : 'prateleira de amostras sem tratamento');
    if (pa.inova !== pb.inova) m.push(pb.inova ? 'prateleira exclusiva INOVA GENÉTICA' : 'INOVA GENÉTICA não fica com os demais produtores');
    if (pa.grupo !== pb.grupo) m.push('tipo de remessa de outro grupo (' + ((GRUPOS[pb.grupo] || {}).curto || pb.grupo) + ')');
    return m;
  }

  /* ---------- Embalagens e endereçamento ---------- */
  const EMBALAGENS = {
    CX1:   { nome: 'Caixinha 1 kg', dim: '9 × 9 × 18 cm', linhas: 15, lados: ['T', 'F'], alturas: 5, letras: true },
    CX05:  { nome: 'Caixinha 0,5 kg', dim: '9 × 9 × 9 cm', linhas: 15, lados: ['T1', 'T2', 'F1', 'F2'], alturas: 5, letras: true },
    KRAFT: { nome: 'Saco kraft', dim: '17 × 38 cm', linhas: 7, lados: ['T', 'F'], alturas: 30, letras: false }
  };
  const ANDARES = 4;
  const nomeEmb = k => (EMBALAGENS[k] || {}).nome || k || '—';
  const capLinha = k => { const e = EMBALAGENS[k]; return e ? e.lados.length * e.alturas : 0; };
  const capAndar = k => { const e = EMBALAGENS[k]; return e ? e.linhas * capLinha(k) : 0; };
  const capPrateleira = k => capAndar(k) * ANDARES;
  const nomeLado = l => ({ T: 'Trás', F: 'Frente', T1: 'Trás 01', T2: 'Trás 02', F1: 'Frente 01', F2: 'Frente 02' })[l] || l;
  const nomeAltura = (k, h) => (EMBALAGENS[k] && EMBALAGENS[k].letras) ? String.fromCharCode(64 + h) : String(h).padStart(2, '0');
  const p2 = n => String(n).padStart(2, '0');
  const chaveSlot = s => [s.prateleira, s.andar, s.linha, s.lado, s.altura].join('-');
  function textoSlot(s, emb) {
    if (!s || !s.prateleira) return '';
    return 'P.' + p2(s.prateleira) + ' | A.' + p2(s.andar) + ' | L.' + p2(s.linha) + ' · ' + nomeLado(s.lado) + ' · ' + nomeAltura(emb, s.altura);
  }
  // ordem de preenchimento: andar 1→4, linha 1→N, Trás antes da Frente, de baixo para cima
  function* ordemSlots(prateleira, emb) {
    const e = EMBALAGENS[emb]; if (!e) return;
    for (let a = 1; a <= ANDARES; a++) for (let l = 1; l <= e.linhas; l++) for (const lado of e.lados) for (let h = 1; h <= e.alturas; h++)
      yield { prateleira: prateleira, andar: a, linha: l, lado: lado, altura: h };
  }

  /* ---------- Estado atual a partir dos movimentos ----------
     Ações: ARMAZENAR (entra/volta no arquivo), SALA (sai para uma sala; a posição fica reservada),
            RETORNO (volta para a posição reservada), REMANEJAR (muda de posição), BAIXA (sai do arquivo; libera),
            REGISTRO (só registra: amostra que não armazena) */
  const SALAS = ['Sala de análise', 'Sala de montagem', 'Sala de tratamento de sementes', 'Sala de homogeneização de sementes'];
  function estadoAtual(movs) {
    const est = {};
    movs.slice().sort((a, b) => a.ts - b.ts || String(a.id).localeCompare(String(b.id))).forEach(m => {
      if (m.situacao && /^Conflito|^Excluíd/.test(m.situacao)) return;
      const p = m.protocolo; if (!p) return;
      const e = est[p] || (est[p] = { protocolo: p, slot: null, local: '', primeiro: m.ts, historico: 0 });
      e.historico++;
      ['especie', 'cultivar', 'lote', 'produtor', 'tipoAnalise', 'remessa', 'tratamento', 'classificacao', 'embalagem', 'categoria'].forEach(k => { if (m[k]) e[k] = m[k]; });
      e.ultimo = m.ts; e.ultimoMov = m.acao; e.usuario = m.usuario; e.fotoUrl = m.fotoUrl || e.fotoUrl;
      if (m.acao === 'ARMAZENAR' || m.acao === 'REMANEJAR' || m.acao === 'RETORNO') {
        if (m.prateleira) e.slot = { prateleira: Number(m.prateleira), andar: Number(m.andar), linha: Number(m.linha), lado: m.lado, altura: Number(m.altura) };
        e.local = 'Arquivo refrigerado'; e.status = 'ARQUIVO'; e.desde = m.ts;
      } else if (m.acao === 'SALA') { e.local = m.destino; e.status = 'SALA'; e.desde = m.ts; }
      else if (m.acao === 'BAIXA') { e.local = 'Baixada'; e.status = 'BAIXA'; e.slot = null; e.desde = m.ts; }
      else if (m.acao === 'REGISTRO') { if (!e.status) { e.local = 'Registrada (não armazena)'; e.status = 'REGISTRO'; e.desde = m.ts; } }
    });
    return est;
  }
  // posições ocupadas (amostras no arquivo e reservadas por quem está em sala)
  function ocupacao(est) {
    const occ = {};
    Object.values(est).forEach(e => { if (e.slot && (e.status === 'ARQUIVO' || e.status === 'SALA')) occ[chaveSlot(e.slot)] = e; });
    return occ;
  }
  // perfil atual de cada prateleira = perfil das amostras que estão nela
  function perfisPrateleiras(est, prateleiras) {
    const r = {};
    (prateleiras || []).forEach(pr => { r[pr.numero] = { prateleira: pr, perfil: null, usadas: 0, amostras: [] }; });
    Object.values(est).forEach(e => {
      if (!e.slot || !(e.status === 'ARQUIVO' || e.status === 'SALA')) return;
      const k = e.slot.prateleira; const pr = r[k] || (r[k] = { prateleira: { numero: k, embalagem: e.embalagem, situacao: 'Ativa' }, perfil: null, usadas: 0, amostras: [] });
      if (!pr.perfil) pr.perfil = perfil(e, pr.prateleira.embalagem || e.embalagem);
      pr.usadas++; pr.amostras.push(e);
    });
    return r;
  }
  /* Sugere a posição para uma amostra respeitando as regras.
     Prioridade: prateleira já com o mesmo perfil (continua a sequência) → prateleira vazia da mesma embalagem. */
  function sugerirPosicao(amostra, embalagem, est, prateleiras, excetoProt) {
    const pa = perfil(amostra, embalagem), ka = chavePerfil(pa);
    const ests = Object.assign({}, est); if (excetoProt) delete ests[excetoProt];
    const occ = ocupacao(ests), pp = perfisPrateleiras(ests, prateleiras);
    const ativas = (prateleiras || []).filter(p => p.situacao !== 'Inativa' && p.embalagem === embalagem).sort((a, b) => a.numero - b.numero);
    const livre = num => { for (const s of ordemSlots(num, embalagem)) if (!occ[chaveSlot(s)]) return s; return null; };
    for (const pr of ativas) { const x = pp[pr.numero]; if (x && x.perfil && chavePerfil(x.perfil) === ka) { const s = livre(pr.numero); if (s) return { slot: s, motivo: 'Continua a sequência da prateleira ' + p2(pr.numero) }; } }
    for (const pr of ativas) { const x = pp[pr.numero]; if (!x || !x.perfil) { const s = livre(pr.numero); if (s) return { slot: s, motivo: 'Prateleira ' + p2(pr.numero) + ' livre (passa a ser deste perfil)' }; } }
    return { slot: null, motivo: ativas.length ? 'Nenhuma prateleira de ' + nomeEmb(embalagem) + ' livre para este perfil. Cadastre uma nova prateleira.' : 'Nenhuma prateleira de ' + nomeEmb(embalagem) + ' cadastrada.' };
  }
  // confere se uma posição escolhida à mão respeita as regras
  function validarPosicao(amostra, embalagem, slot, est, prateleiras, excetoProt) {
    const pr = (prateleiras || []).find(p => Number(p.numero) === Number(slot.prateleira));
    if (!pr) return ['Prateleira ' + slot.prateleira + ' não cadastrada.'];
    if (pr.situacao === 'Inativa') return ['Prateleira ' + p2(pr.numero) + ' está inativa.'];
    if (pr.embalagem !== embalagem) return ['A prateleira ' + p2(pr.numero) + ' é de ' + nomeEmb(pr.embalagem) + '.'];
    const e = EMBALAGENS[embalagem];
    if (!(slot.andar >= 1 && slot.andar <= ANDARES && slot.linha >= 1 && slot.linha <= e.linhas && e.lados.indexOf(slot.lado) >= 0 && slot.altura >= 1 && slot.altura <= e.alturas)) return ['Posição fora da capacidade da prateleira.'];
    const ests = Object.assign({}, est); if (excetoProt) delete ests[excetoProt];
    const ocup = ocupacao(ests)[chaveSlot(slot)];
    if (ocup) return ['Posição ocupada pela amostra ' + ocup.protocolo + '.'];
    const x = perfisPrateleiras(ests, prateleiras)[pr.numero];
    if (x && x.perfil) { const m = motivosIncompat(perfil(amostra, embalagem), x.perfil); if (m.length) return m.map(t => 'Não pode: ' + t + '.'); }
    return [];
  }

  /* ---------- Etiqueta da linha ---------- */
  // agrupa protocolos em faixas de sequência: [13931], [13961-13964]
  function faixas(prots) {
    const ps = prots.slice().sort((a, b) => protAno(a) - protAno(b) || protNum(a) - protNum(b));
    const out = []; let ini = null, ant = null;
    ps.forEach(p => {
      if (ant && protAno(p) === protAno(ant) && protNum(p) === protNum(ant) + 1) { ant = p; return; }
      if (ini) out.push([ini, ant]); ini = p; ant = p;
    });
    if (ini) out.push([ini, ant]);
    return out.map(([a, b]) => a === b ? milhar(protNum(a)) : milhar(protNum(a)) + ' - ' + milhar(protNum(b)));
  }
  function etiquetaLinha(est, prateleira, andar, linha) {
    const am = Object.values(est).filter(e => e.slot && (e.status === 'ARQUIVO' || e.status === 'SALA') && e.slot.prateleira === Number(prateleira) && e.slot.andar === Number(andar) && e.slot.linha === Number(linha));
    const titulo = [];
    am.slice().sort((a, b) => protNum(a.protocolo) - protNum(b.protocolo)).forEach(e => {
      const t = /DEFINITIVA/.test(up(e.tipoAnalise)) ? 'DEFINITIVA' : (String(e.remessa || '').toUpperCase().trim() || (e.classificacao === 'Protocolo' ? 'PROTOCOLO' : 'AMOSTRA MANUAL'));
      if (titulo.indexOf(t) < 0) titulo.push(t);
    });
    const tras = am.filter(e => /^T/.test(e.slot.lado)).map(e => e.protocolo);
    const frente = am.filter(e => /^F/.test(e.slot.lado)).map(e => e.protocolo);
    return { titulo: titulo.join(' / ') || '—', codigo: 'P. ' + p2(prateleira) + ' | A. ' + p2(andar) + ' | L. ' + p2(linha), tras: faixas(tras), frente: faixas(frente), total: am.length };
  }

  /* ---------- Planilhas de referência (sistema e manual) ---------- */
  const COLS_REF = {
    'NUMERO DA AMOSTRA': 'prot', 'DATA DO RECEBIMENTO': 'data', 'REMETENTE/SAFRA': 'safra', 'ESPECIE': 'especie', 'CULTIVAR': 'cultivar',
    'CATEGORIA': 'categoria', 'PENEIRA': 'peneira', 'REPRESENTATIVIDADE (SC OU KG/LOTE)': 'repres', 'LOTE/ORIGEM': 'lote', 'PRODUTOR': 'produtor',
    'OBSERVACAO': 'obs', 'TIPOANALISE': 'tipoAnalise', 'ANALISES_ABERTAS': 'abertas', 'TIPO REMESSA': 'remessa', 'TRATAMENTO': 'tratamento',
    'PROCEDENCIA/UF': 'procedencia'
  };
  const CAMPOS_REF = ['prot', 'data', 'especie', 'cultivar', 'categoria', 'peneira', 'lote', 'produtor', 'tipoAnalise', 'remessa', 'tratamento', 'safra', 'repres', 'abertas', 'obs', 'procedencia', 'origem'];
  // converte as linhas lidas da planilha (array de arrays, 1ª linha = cabeçalho)
  function lerPlanilhaRef(linhas, origem) {
    if (!linhas || !linhas.length) return [];
    let hi = linhas.findIndex(r => (r || []).some(c => up(c) === 'NUMERO DA AMOSTRA'));
    if (hi < 0) throw new Error('Não encontrei a coluna "Número da Amostra". Use a planilha exportada do sistema.');
    const cab = linhas[hi].map(c => COLS_REF[up(c)] || null);
    const out = [];
    for (let i = hi + 1; i < linhas.length; i++) {
      const r = linhas[i] || [], o = { origem: origem };
      cab.forEach((k, j) => { if (!k) return; let v = r[j]; if (v == null) v = ''; v = String(v).trim(); if (v === '-o-' || v === 'nan' || v === 'NaN') v = ''; o[k] = v; });
      o.prot = normProt(o.prot);
      if (!o.prot) continue;
      o.especie = up(o.especie);
      out.push(o);
    }
    return out;
  }
  // une referências: a mais nova (ou a manual) sobrescreve a anterior do mesmo protocolo
  function unirRef(listas) {
    const m = {};
    listas.forEach(l => (l || []).forEach(r => { m[r.prot] = Object.assign({}, m[r.prot] || {}, r); }));
    return Object.values(m).sort((a, b) => protAno(a.prot) - protAno(b.prot) || protNum(a.prot) - protNum(b.prot));
  }
  const dataRefKey = d => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(d || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };

  /* ---------- Leitura do texto da etiqueta (OCR) ----------
     Modelo: "Prot: 17215/2026 · Rem.: 7046 · O720 I2X · TESTE" (texto na vertical ao lado do QR) */
  function lerEtiquetaTexto(txt) {
    const t = String(txt || '').replace(/\r/g, '');
    const l = t.split('\n').map(s => s.trim()).filter(Boolean);
    const res = { prot: '', rem: '', cultivar: '', remessa: '' };
    const mp = /pr[o0]t\.?\s*[:;.]?\s*([\dOIlS.\s]{1,9}\s*\/\s*2[0O]\d{2})/i.exec(t) || /(\d{1,3}[.]?\d{0,3}\s*\/\s*20\d{2})/.exec(t);
    if (mp) res.prot = normProt(mp[1].replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5'));
    const mr = /rem\.?\s*[:;.]?\s*([\dOIl]{1,8})/i.exec(t); if (mr) res.rem = mr[1].replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
    // tipo de remessa: procura os nomes conhecidos
    const T = up(t).replace(/[^A-Z0-9 \n]/g, ' ');
    const achados = TIPOS_REMESSA.map(x => up(x)).filter(x => new RegExp('\\b' + x.replace(/ /g, '\\s*') + '\\b').test(T)).sort((a, b) => b.length - a.length);
    if (achados.length) res.remessa = achados[0];
    // cultivar: linha depois de "Rem." que não é o tipo de remessa
    const ir = l.findIndex(x => /rem\.?/i.test(x));
    if (ir >= 0) {
      const c = l.slice(ir + 1).find(x => !achados.some(a => up(x).indexOf(a) >= 0) && /[A-Z0-9]{3,}/i.test(x));
      if (c) { const tk = up(c).replace(/[|]/g, 'I').split(' '); while (tk.length > 1 && (tk[0].replace(/[^A-Z0-9]/g, '').length <= 2)) tk.shift(); res.cultivar = tk.join(' ').replace(/[^A-Z0-9 ]/g, '').trim(); }
    }
    return res;
  }
  // compara o que foi lido na etiqueta com a planilha (tolerante a erros típicos de OCR)
  const formaOcr = s => up(s).replace(/[^A-Z0-9]/g, '').replace(/[1L|I]/g, 'I').replace(/0/g, 'O').replace(/5/g, 'S').replace(/8/g, 'B').replace(/2/g, 'Z');
  function lev(a, b) { const m = a.length, n = b.length; if (!m || !n) return Math.max(m, n); let pr = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cu = [i]; for (let j = 1; j <= n; j++) cu[j] = Math.min(pr[j] + 1, cu[j - 1] + 1, pr[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); pr = cu; } return pr[n]; }
  // true = confere; false = diverge; null = sem leitura. Tolera até ~30% de caracteres trocados pelo OCR.
  function confere(lido, ref) { if (!lido || !ref) return null; const a = formaOcr(lido), b = formaOcr(ref); if (!a || !b) return null;
    if (a === b || b.indexOf(a) >= 0 || a.indexOf(b) >= 0) return true;
    let d = lev(a, b);
    // o OCR costuma trazer sujeira antes/depois: compara também com os trechos do tamanho da referência
    for (let w = Math.max(1, b.length - 1); w <= b.length + 1; w++) for (let i = 0; i + w <= a.length; i++) d = Math.min(d, lev(a.slice(i, i + w), b));
    return d / b.length <= 0.3; }
  // protocolos "vizinhos" de uma leitura (um dígito trocado ou dois dígitos invertidos): para corrigir erro do OCR
  function protVizinhos(prot) {
    const n = String(protNum(prot)), ano = protAno(prot), out = new Set();
    for (let i = 0; i < n.length; i++) for (let dgt = 0; dgt <= 9; dgt++) { const c = n.slice(0, i) + dgt + n.slice(i + 1); if (c !== n && !/^0/.test(c)) out.add(c + '/' + ano); }
    for (let i = 0; i < n.length - 1; i++) { const c = n.slice(0, i) + n[i + 1] + n[i] + n.slice(i + 2); if (c !== n && !/^0/.test(c)) out.add(c + '/' + ano); }
    return [...out];
  }
  // quão provável é o OCR ter lido "lido" no lugar de "cand" (trocas de dígitos parecidos pesam mais)
  const PARES_OCR = ['08', '06', '09', '17', '14', '27', '38', '39', '56', '58', '59', '68', '69', '89', '35', '23'];
  function chanceTroca(lido, cand) {
    const a = String(protNum(lido)), b = String(protNum(cand));
    if (a.length !== b.length) return 0;
    const dif = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dif.push(i);
    if (dif.length === 1) { const par = [a[dif[0]], b[dif[0]]].sort().join(''); return PARES_OCR.indexOf(par) >= 0 ? 2 : 1; }
    if (dif.length === 2 && dif[1] === dif[0] + 1 && a[dif[0]] === b[dif[1]] && a[dif[1]] === b[dif[0]]) return 1.5;
    return 0;
  }
  // a etiqueta "bate" com a referência? (2 = cultivar e remessa conferem, 1 = só uma, 0 = nenhuma, -1 = alguma diverge)
  function notaEtiqueta(lido, ref) { if (!lido || !ref) return 0; const c = confere(lido.cultivar, ref.cultivar), r = confere(lido.remessa, ref.remessa); if (c === false || r === false) return -1; return (c ? 1 : 0) + (r ? 1 : 0); }

  G.LASDM = {
    up, normProt, protNum, protAno, milhar, GRUPOS, REMESSA_GRUPO, TIPOS_REMESSA, CULTURAS_PROTOCOLO, classificar, perfil, chavePerfil, textoPerfil, motivosIncompat,
    EMBALAGENS, ANDARES, nomeEmb, capLinha, capAndar, capPrateleira, nomeLado, nomeAltura, chaveSlot, textoSlot, ordemSlots, p2,
    SALAS, estadoAtual, ocupacao, perfisPrateleiras, sugerirPosicao, validarPosicao, faixas, etiquetaLinha,
    lerPlanilhaRef, unirRef, CAMPOS_REF, dataRefKey, lerEtiquetaTexto, confere, protVizinhos, notaEtiqueta, chanceTroca
  };
})(typeof window !== 'undefined' ? window : globalThis);
