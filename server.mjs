import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'db.json');
const IBGE_CACHE = join(DATA_DIR, 'municipios-ibge.json');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@kpimobilidade.local').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TrocarEstaSenha#2026';

mkdirSync(DATA_DIR, { recursive: true });

const UFS = [
  ['AC', 'Acre', '24'], ['AL', 'Alagoas', '17'], ['AP', 'Amapá', '25'], ['AM', 'Amazonas', '22'],
  ['BA', 'Bahia', '05'], ['CE', 'Ceará', '07'], ['DF', 'Distrito Federal', '20'], ['ES', 'Espírito Santo', '14'],
  ['GO', 'Goiás', '10'], ['MA', 'Maranhão', '11'], ['MT', 'Mato Grosso', '18'], ['MS', 'Mato Grosso do Sul', '19'],
  ['MG', 'Minas Gerais', '02'], ['PA', 'Pará', '13'], ['PB', 'Paraíba', '12'], ['PR', 'Paraná', '06'],
  ['PE', 'Pernambuco', '08'], ['PI', 'Piauí', '15'], ['RJ', 'Rio de Janeiro', '03'], ['RN', 'Rio Grande do Norte', '16'],
  ['RS', 'Rio Grande do Sul', '04'], ['RO', 'Rondônia', '23'], ['RR', 'Roraima', '26'], ['SC', 'Santa Catarina', '09'],
  ['SP', 'São Paulo', '01'], ['SE', 'Sergipe', '21'], ['TO', 'Tocantins', '27']
];
const UF_POR_CODIGO = Object.fromEntries(UFS.map(([sigla, nome, cod]) => [cod, sigla]));
const UF_NOME = Object.fromEntries(UFS.map(([sigla, nome]) => [sigla, nome]));
const DDDS = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));

const PERGUNTAS = [
  {
    id: 'prioridade',
    texto: 'Qual prioridade de mobilidade deve receber recurso no seu município?',
    opcoes: ['Ônibus e BRT', 'Integração tarifária', 'Calçadas e acessibilidade', 'Ciclovias e segurança viária']
  },
  {
    id: 'pagamento_km',
    texto: 'Apoia pagamento de transporte por km com auditoria pública?',
    opcoes: ['Sim', 'Não', 'Abstenção']
  },
  {
    id: 'ia_visao',
    texto: 'Apoia IA de visão só com base legal e proteção de dados para faixa exclusiva?',
    opcoes: ['Sim', 'Não', 'Abstenção']
  }
];

function agora() { return new Date().toISOString(); }
function id(prefix) { return prefix + randomBytes(8).toString('hex'); }
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}
function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }
function hashSenha(senha, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(senha, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function senhaOk(senha, armazenada) {
  const [salt, hash] = String(armazenada).split(':');
  if (!salt || !hash) return false;
  const calc = scryptSync(senha, salt, 32);
  const alvo = Buffer.from(hash, 'hex');
  return calc.length === alvo.length && timingSafeEqual(calc, alvo);
}
function lerDb() {
  if (!existsSync(DB_PATH)) {
    const vazio = { users: [], signatures: [], votes: [], audit: [], sessions: [] };
    writeFileSync(DB_PATH, JSON.stringify(vazio, null, 2));
    return vazio;
  }
  return JSON.parse(readFileSync(DB_PATH, 'utf8'));
}
function salvarDb(db) {
  const tmp = DB_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_PATH);
}
function auditar(db, ator, acao, alvo, detalhe) {
  db.audit.unshift({ id: id('a_'), em: agora(), ator, acao, alvo, detalhe });
  db.audit = db.audit.slice(0, 5000);
}
function seedAdmin() {
  const db = lerDb();
  if (!db.users.some(u => u.role === 'admin')) {
    db.users.push({
      id: id('u_'),
      role: 'admin',
      nome: 'Administrador KPI Mobilidade',
      email: ADMIN_EMAIL,
      senhaHash: hashSenha(ADMIN_PASSWORD),
      cpf: '',
      whatsapp: '',
      nascimento: '',
      titulo: '',
      tituloUf: '',
      zona: '',
      secao: '',
      uf: 'DF',
      municipio: 'Brasília',
      municipioIbge: '',
      emissao: '',
      status: 'conferido',
      motivo: 'Conta técnica inicial. Troque a senha.',
      validacoes: { origem: 'seed' },
      criadoEm: agora(),
      excluidoEm: null,
      mustChange: true
    });
    auditar(db, 'sistema', 'seed_admin', ADMIN_EMAIL, 'Conta admin inicial criada');
    salvarDb(db);
  }
}
seedAdmin();

function validarCpf(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return { ok: false, motivo: 'CPF inválido' };
  const calc = (base, fator) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (fator - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const dv1 = calc(d.slice(0, 9), 10);
  const dv2 = calc(d.slice(0, 10), 11);
  if (dv1 !== Number(d[9]) || dv2 !== Number(d[10])) return { ok: false, motivo: 'Dígito do CPF não confere' };
  return { ok: true, cpf: d };
}
function validarTitulo(titulo) {
  const t = soDigitos(titulo);
  if (t.length !== 12) return { ok: false, motivo: 'Título deve ter 12 dígitos' };
  if (/^(\d)\1{11}$/.test(t)) return { ok: false, motivo: 'Título com sequência inválida' };
  const ufCod = t.slice(8, 10);
  const uf = UF_POR_CODIGO[ufCod];
  if (!uf) return { ok: false, motivo: 'Código de UF do título inexistente' };
  const seq = t.slice(0, 8);
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(seq[i]) * (i + 2);
  const resto = soma % 11;
  let dv1 = resto >= 10 ? 0 : resto;
  if ((ufCod === '01' || ufCod === '02') && resto === 0) dv1 = 1;
  const base2 = ufCod + String(dv1);
  let soma2 = 0;
  const pesos = [7, 8, 9];
  for (let i = 0; i < 3; i++) soma2 += Number(base2[i]) * pesos[i];
  const resto2 = soma2 % 11;
  let dv2 = resto2 >= 10 ? 0 : resto2;
  if ((ufCod === '01' || ufCod === '02') && resto2 === 0) dv2 = 1;
  if (t.slice(10) !== String(dv1) + String(dv2)) {
    return { ok: false, motivo: 'Dígito verificador do título não confere', uf };
  }
  return { ok: true, titulo: t, uf, ufCod, aviso: 'Valida formato e DV. Não consulta a base do TSE.' };
}
function validarTelefone(tel) {
  const d = soDigitos(tel);
  if (d.length !== 11) return { ok: false, motivo: 'WhatsApp deve ter DDD + 9 dígitos' };
  if (!DDDS.has(d.slice(0, 2))) return { ok: false, motivo: 'DDD inexistente no Brasil' };
  if (d[2] !== '9') return { ok: false, motivo: 'Celular brasileiro começa com 9 após o DDD' };
  return { ok: true, telefone: d };
}
function idade(iso) {
  const n = new Date(iso + 'T00:00:00');
  if (Number.isNaN(n.getTime())) return -1;
  const hoje = new Date();
  let anos = hoje.getFullYear() - n.getFullYear();
  const m = hoje.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < n.getDate())) anos--;
  return anos;
}
function validarNome(nome) {
  const limpo = String(nome || '').trim().replace(/\s+/g, ' ');
  if (limpo.length < 5 || limpo.split(' ').length < 2) return { ok: false, motivo: 'Informe nome e sobrenome' };
  if (!/^[\p{L}\s'.-]+$/u.test(limpo)) return { ok: false, motivo: 'Nome contém caractere inválido' };
  return { ok: true, nome: limpo };
}

let municipios = [];
async function carregarMunicipios() {
  if (existsSync(IBGE_CACHE)) {
    municipios = JSON.parse(readFileSync(IBGE_CACHE, 'utf8'));
    return;
  }
  const resp = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome');
  if (!resp.ok) throw new Error('IBGE indisponível');
  const lista = await resp.json();
  municipios = lista.map(m => ({
    id: m.id,
    nome: m.nome,
    uf: m.microrregiao.mesorregiao.UF.sigla
  }));
  writeFileSync(IBGE_CACHE, JSON.stringify(municipios));
}
function municipioOficial(uf, nome) {
  const alvo = norm(nome);
  return municipios.find(m => m.uf === uf && norm(m.nome) === alvo) || null;
}

function publicoUser(u) {
  if (!u) return null;
  const { senhaHash, ...resto } = u;
  return resto;
}
function sessaoDe(req, db) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)kpi_session=([^;]+)/);
  if (!m) return null;
  const s = db.sessions.find(x => x.token === m[1] && new Date(x.expira) > new Date());
  if (!s) return null;
  const user = db.users.find(u => u.id === s.userId && u.status !== 'excluido');
  return user ? { sessao: s, user } : null;
}
function json(res, code, body, extra = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', ...extra };
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
}
function lerBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}
function cookie(token) {
  return `kpi_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`;
}

function totais(db) {
  const ativos = db.users.filter(u => u.role === 'cidadao' && u.status !== 'excluido');
  const porUf = UFS.map(([sigla, nome]) => ({
    uf: sigla,
    nome,
    cadastrados: ativos.filter(u => u.uf === sigla).length,
    conferidos: ativos.filter(u => u.uf === sigla && u.status === 'conferido').length,
    pendentes: ativos.filter(u => u.uf === sigla && u.status === 'pendente').length,
    rejeitados: ativos.filter(u => u.uf === sigla && u.status === 'rejeitado').length,
    assinaturas: db.signatures.filter(s => s.uf === sigla && !s.excluida).length
  }));
  const votos = {};
  for (const p of PERGUNTAS) {
    votos[p.id] = Object.fromEntries(p.opcoes.map(o => [o, db.votes.filter(v => !v.excluido && v.respostas?.[p.id] === o).length]));
  }
  return {
    cadastrados: ativos.length,
    conferidos: ativos.filter(u => u.status === 'conferido').length,
    pendentes: ativos.filter(u => u.status === 'pendente').length,
    rejeitados: ativos.filter(u => u.status === 'rejeitado').length,
    assinaturas: db.signatures.filter(s => !s.excluida).length,
    votos: db.votes.filter(v => !v.excluido).length,
    porUf,
    votosPorPergunta: votos
  };
}

function winAnsi(texto) {
  const mapa = { 'á':'\\341','à':'\\340','ã':'\\343','â':'\\342','é':'\\351','ê':'\\352','í':'\\355','ó':'\\363','õ':'\\365','ô':'\\364','ú':'\\372','ç':'\\347','Á':'\\301','À':'\\300','Ã':'\\303','Â':'\\302','É':'\\311','Ê':'\\312','Í':'\\315','Ó':'\\323','Õ':'\\325','Ô':'\\324','Ú':'\\332','Ç':'\\307','º':'\\272','ª':'\\252','–':'-','—':'-','’':"'" };
  return String(texto).split('').map(ch => mapa[ch] || (ch.charCodeAt(0) < 128 ? ch.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') : '?')).join('');
}
function pdfRelatorio(db, { ufFiltro = '', mascarar = false } = {}) {
  const t = totais(db);
  const linhas = [];
  const add = (s = '') => linhas.push(s);
  add('MANIFESTO POPULAR KPI MOBILIDADE');
  add('Relatorio nacional para protocolo — iniciativa cidada');
  add('NAO e documento oficial do TSE, do gov.br ou de qualquer orgao publico.');
  add('Gerado em ' + new Date().toLocaleString('pt-BR'));
  add('');
  add('1. Objeto');
  add('Apoio ao Plano de Mobilidade Urbana do Projeto SandxCDD: eficiencia,');
  add('pagamento auditavel e uso de IA somente com base legal e LGPD.');
  add('');
  add('2. Metodologia de conferencia');
  add('- CPF: digitos verificadores (modulo 11). Nao consulta a Receita Federal.');
  add('- Titulo: 12 digitos, UF 01-27 e digito verificador. Nao consulta o TSE.');
  add('- Municipio: nome oficial da malha IBGE, sem alteracao.');
  add('- Duplicidade de CPF, e-mail e titulo bloqueada.');
  add('- Status conferido = revisao humana do admin, nao homologacao eleitoral.');
  add('');
  add('3. Totais nacionais');
  add(`Cadastrados ${t.cadastrados} | Conferidos ${t.conferidos} | Pendentes ${t.pendentes} | Rejeitados ${t.rejeitados}`);
  add(`Assinaturas ${t.assinaturas} | Votos ${t.votos}`);
  add('');
  add('4. Por unidade da federacao');
  for (const row of t.porUf) {
    if (ufFiltro && row.uf !== ufFiltro) continue;
    add(`${row.uf} ${row.nome}: cad ${row.cadastrados} | conf ${row.conferidos} | pend ${row.pendentes} | ass ${row.assinaturas}`);
  }
  add('');
  add('5. Votacao das prioridades');
  for (const p of PERGUNTAS) {
    add(p.texto);
    for (const [op, n] of Object.entries(t.votosPorPergunta[p.id])) add(`  ${op}: ${n}`);
  }
  add('');
  add('6. Relacao para protocolo');
  const pessoas = db.users.filter(u => u.role === 'cidadao' && u.status === 'conferido' && (!ufFiltro || u.uf === ufFiltro));
  if (!pessoas.length) add('Nenhum cadastro conferido neste recorte.');
  pessoas.forEach((u, i) => {
    const cpf = mascarar ? u.cpf.replace(/(\d{3})\d{6}(\d{2})/, '$1******$2') : u.cpf;
    add(`${i + 1}. ${u.nome} | CPF ${cpf} | ${u.municipio}/${u.uf} | titulo ${u.titulo} | zona ${u.zona} secao ${u.secao}`);
  });
  add('');
  add('Declaracao: os dados acima sao os informados pelo cidadao e conferidos');
  add('pelas regras deste sistema. Nao substituem certidao do TSE ou da Receita.');
  add('Local e data para protocolo: ________________________________');
  add('Responsavel: _______________________________________________');

  const paginas = [];
  for (let i = 0; i < linhas.length; i += 46) paginas.push(linhas.slice(i, i + 46));
  if (!paginas.length) paginas.push(['Sem dados']);
  const objetos = [];
  const adicionar = (conteudo) => { objetos.push(conteudo); return objetos.length; };
  const font = adicionar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  for (const pagina of paginas) {
    const comandos = ['BT', '/F1 9 Tf', '40 800 Td', '14 TL'];
    pagina.forEach((linha, idx) => {
      comandos.push(`(${winAnsi(linha)}) Tj`);
      if (idx < pagina.length - 1) comandos.push('T*');
    });
    comandos.push('ET');
    const stream = comandos.join('\n');
    const conteudoId = adicionar(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    pageIds.push(adicionar(`<< /Type /Page /Parent PAGES 0 R /MediaBox [0 0 595 842] /Contents ${conteudoId} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  const kids = pageIds.map(n => `${n} 0 R`).join(' ');
  const pagesId = adicionar(`<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`);
  const catalogo = adicionar(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objetos.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj.replace('Parent PAGES 0 R', `Parent ${pagesId} 0 R`)}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer << /Size ${objetos.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function api(req, res, url) {
  const db = lerDb();
  const auth = sessaoDe(req, db);
  if (url.pathname === '/api/meta' && req.method === 'GET') {
    return json(res, 200, { ufs: UFS.map(([sigla, nome]) => ({ sigla, nome })), perguntas: PERGUNTAS, ibge: municipios.length });
  }
  if (url.pathname === '/api/municipios' && req.method === 'GET') {
    const uf = (url.searchParams.get('uf') || '').toUpperCase();
    const q = norm(url.searchParams.get('q') || '');
    let lista = municipios.filter(m => m.uf === uf);
    if (q) lista = lista.filter(m => norm(m.nome).includes(q));
    return json(res, 200, lista.slice(0, 30).map(m => ({ id: m.id, nome: m.nome, uf: m.uf })));
  }
  if (url.pathname === '/api/publico' && req.method === 'GET') return json(res, 200, totais(db));
  if (url.pathname === '/api/cadastro' && req.method === 'POST') {
    const b = await lerBody(req);
    const nome = validarNome(b.nome);
    const cpf = validarCpf(b.cpf);
    const tel = validarTelefone(b.whatsapp);
    const titulo = validarTitulo(b.titulo);
    const email = String(b.email || '').trim().toLowerCase();
    const uf = String(b.uf || '').toUpperCase();
    const mun = municipioOficial(uf, b.municipio);
    const nasc = String(b.nascimento || '');
    const emissao = String(b.emissao || '');
    const zona = soDigitos(b.zona);
    const secao = soDigitos(b.secao);
    const erros = [];
    if (!nome.ok) erros.push(nome.motivo);
    if (!cpf.ok) erros.push(cpf.motivo);
    if (!tel.ok) erros.push(tel.motivo);
    if (!titulo.ok) erros.push(titulo.motivo);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erros.push('E-mail inválido');
    if (!UF_NOME[uf]) erros.push('UF inválida');
    if (titulo.ok && titulo.uf !== uf) erros.push(`UF do título (${titulo.uf}) não confere com a UF informada (${uf})`);
    if (!mun) erros.push('Município não existe nessa UF na base oficial do IBGE');
    if (idade(nasc) < 16) erros.push('Idade mínima de 16 anos');
    if (!emissao || emissao > new Date().toISOString().slice(0, 10)) erros.push('Data de emissão inválida');
    if (emissao && nasc && emissao < nasc) erros.push('Emissão não pode ser anterior ao nascimento');
    if (!/^\d{1,4}$/.test(zona)) erros.push('Zona inválida');
    if (!/^\d{1,4}$/.test(secao)) erros.push('Seção inválida');
    if (!b.termo) erros.push('É obrigatório declarar a veracidade');
    if (String(b.senha || '').length < 8) erros.push('Senha mínima de 8 caracteres');
    if (db.users.some(u => u.cpf === cpf.cpf && u.status !== 'excluido')) erros.push('CPF já cadastrado');
    if (db.users.some(u => u.email === email && u.status !== 'excluido')) erros.push('E-mail já cadastrado');
    if (db.users.some(u => u.titulo === titulo.titulo && u.status !== 'excluido')) erros.push('Título já cadastrado');
    if (erros.length) return json(res, 422, { ok: false, erros });
    const user = {
      id: id('u_'), role: 'cidadao', nome: nome.nome, email, senhaHash: hashSenha(b.senha),
      cpf: cpf.cpf, whatsapp: tel.telefone, nascimento: nasc, titulo: titulo.titulo, tituloUf: titulo.uf,
      zona, secao, uf, municipio: mun.nome, municipioIbge: mun.id, emissao, status: 'pendente',
      motivo: '', validacoes: { cpf: true, tituloFormato: true, municipioIbge: true, telefone: true, termo: true, consultaTse: false, consultaReceita: false },
      criadoEm: agora(), excluidoEm: null, mustChange: false
    };
    db.users.push(user);
    auditar(db, user.id, 'cadastro', user.id, `${user.municipio}/${user.uf}`);
    salvarDb(db);
    return json(res, 201, { ok: true, mensagem: 'Cadastro recebido e pendente de conferência do admin.', id: user.id });
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const b = await lerBody(req);
    const email = String(b.email || '').trim().toLowerCase();
    const user = db.users.find(u => u.email === email && u.status !== 'excluido');
    if (!user || !senhaOk(b.senha || '', user.senhaHash)) return json(res, 401, { ok: false, erro: 'E-mail ou senha incorretos' });
    if (user.status === 'rejeitado') return json(res, 403, { ok: false, erro: 'Cadastro rejeitado: ' + (user.motivo || 'dados não conferem') });
    const token = randomBytes(24).toString('hex');
    db.sessions = db.sessions.filter(s => s.userId !== user.id);
    db.sessions.push({ token, userId: user.id, expira: new Date(Date.now() + 12 * 3600 * 1000).toISOString() });
    auditar(db, user.id, 'login', user.id, user.role);
    salvarDb(db);
    return json(res, 200, { ok: true, user: publicoUser(user) }, { 'Set-Cookie': cookie(token) });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    if (auth) db.sessions = db.sessions.filter(s => s.token !== auth.sessao.token);
    salvarDb(db);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'kpi_session=; HttpOnly; Path=/; Max-Age=0' });
  }
  if (url.pathname === '/api/me' && req.method === 'GET') return json(res, 200, { user: auth ? publicoUser(auth.user) : null });
  if (!auth) return json(res, 401, { ok: false, erro: 'Entre na sua conta' });
  if (url.pathname === '/api/assinar' && req.method === 'POST') {
    if (auth.user.role !== 'cidadao') return json(res, 403, { erro: 'Somente cidadão assina' });
    if (auth.user.status !== 'conferido') return json(res, 403, { erro: 'Assinatura liberada após conferência do admin' });
    if (db.signatures.some(s => s.userId === auth.user.id && !s.excluida)) return json(res, 409, { erro: 'Você já assinou' });
    const b = await lerBody(req);
    if (!b.termo) return json(res, 422, { erro: 'Aceite a declaração de veracidade' });
    db.signatures.push({ id: id('s_'), userId: auth.user.id, nome: auth.user.nome, cpf: auth.user.cpf, uf: auth.user.uf, municipio: auth.user.municipio, em: agora(), excluida: false });
    auditar(db, auth.user.id, 'assinatura', auth.user.id, auth.user.uf);
    salvarDb(db);
    return json(res, 201, { ok: true });
  }
  if (url.pathname === '/api/votar' && req.method === 'POST') {
    if (auth.user.role !== 'cidadao' || auth.user.status !== 'conferido') return json(res, 403, { erro: 'Voto liberado após conferência' });
    if (db.votes.some(v => v.userId === auth.user.id && !v.excluido)) return json(res, 409, { erro: 'Você já votou' });
    const b = await lerBody(req);
    const respostas = {};
    for (const p of PERGUNTAS) {
      if (!p.opcoes.includes(b.respostas?.[p.id])) return json(res, 422, { erro: 'Resposta inválida em ' + p.id });
      respostas[p.id] = b.respostas[p.id];
    }
    db.votes.push({ id: id('v_'), userId: auth.user.id, uf: auth.user.uf, municipio: auth.user.municipio, respostas, em: agora(), excluido: false });
    auditar(db, auth.user.id, 'voto', auth.user.id, auth.user.uf);
    salvarDb(db);
    return json(res, 201, { ok: true });
  }
  if (url.pathname === '/api/comprovante.pdf' && req.method === 'GET') {
    const pdf = pdfRelatorio({ ...db, users: [auth.user], signatures: db.signatures.filter(s => s.userId === auth.user.id), votes: db.votes.filter(v => v.userId === auth.user.id) }, { ufFiltro: auth.user.uf, mascarar: false });
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="comprovante-kpi.pdf"' });
    return res.end(pdf);
  }
  if (auth.user.role !== 'admin') return json(res, 403, { erro: 'Somente admin' });
  if (url.pathname === '/api/admin/painel' && req.method === 'GET') {
    return json(res, 200, { totais: totais(db), auditoria: db.audit.slice(0, 40) });
  }
  if (url.pathname === '/api/admin/usuarios' && req.method === 'GET') {
    const uf = (url.searchParams.get('uf') || '').toUpperCase();
    const status = url.searchParams.get('status') || '';
    const q = norm(url.searchParams.get('q') || '');
    let lista = db.users.filter(u => u.role === 'cidadao');
    if (uf) lista = lista.filter(u => u.uf === uf);
    if (status) lista = lista.filter(u => u.status === status);
    if (q) lista = lista.filter(u => norm(u.nome + u.cpf + u.municipio + u.email).includes(q));
    return json(res, 200, lista.map(publicoUser));
  }
  const acao = url.pathname.match(/^\/api\/admin\/usuarios\/([^/]+)(?:\/(conferir|rejeitar|excluir|restaurar))?$/);
  if (acao && req.method === 'POST') {
    const user = db.users.find(u => u.id === acao[1] && u.role === 'cidadao');
    if (!user) return json(res, 404, { erro: 'Cadastro não encontrado' });
    const b = await lerBody(req);
    const tipo = acao[2];
    if (tipo === 'conferir') { user.status = 'conferido'; user.motivo = ''; }
    if (tipo === 'rejeitar') { user.status = 'rejeitado'; user.motivo = String(b.motivo || 'Dados não conferem').slice(0, 240); }
    if (tipo === 'excluir') { user.status = 'excluido'; user.excluidoEm = agora(); user.motivo = String(b.motivo || 'Excluído pelo admin').slice(0, 240); }
    if (tipo === 'restaurar') { user.status = 'pendente'; user.excluidoEm = null; }
    auditar(db, auth.user.id, tipo, user.id, user.motivo || user.status);
    salvarDb(db);
    return json(res, 200, { ok: true, user: publicoUser(user) });
  }
  if (acao && req.method === 'DELETE') {
    const idx = db.users.findIndex(u => u.id === acao[1] && u.role === 'cidadao');
    if (idx < 0) return json(res, 404, { erro: 'Cadastro não encontrado' });
    const alvo = db.users[idx];
    db.users.splice(idx, 1);
    db.signatures.forEach(s => { if (s.userId === alvo.id) s.excluida = true; });
    db.votes.forEach(v => { if (v.userId === alvo.id) v.excluido = true; });
    auditar(db, auth.user.id, 'deletar_permanente', alvo.id, alvo.cpf);
    salvarDb(db);
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/admin/relatorio.pdf' && req.method === 'GET') {
    const uf = (url.searchParams.get('uf') || '').toUpperCase();
    const mascarar = url.searchParams.get('mascarar') === '1';
    const pdf = pdfRelatorio(db, { ufFiltro: uf, mascarar });
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="protocolo-kpi-${uf || 'brasil'}.pdf"` });
    return res.end(pdf);
  }
  if (url.pathname === '/api/admin/export.csv' && req.method === 'GET') {
    const header = 'nome,cpf,email,whatsapp,nascimento,titulo,titulo_uf,zona,secao,municipio,uf,ibge,emissao,status,criado_em\n';
    const linhas = db.users.filter(u => u.role === 'cidadao').map(u => [u.nome, u.cpf, u.email, u.whatsapp, u.nascimento, u.titulo, u.tituloUf, u.zona, u.secao, u.municipio, u.uf, u.municipioIbge, u.emissao, u.status, u.criadoEm].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="kpi-cadastros.csv"' });
    return res.end('\uFEFF' + header + linhas.join('\n'));
  }
  return json(res, 404, { erro: 'Rota não encontrada' });
}

function estatico(req, res, url) {
  let caminho = url.pathname === '/' ? '/index.html' : url.pathname;
  if (caminho.includes('..')) { res.writeHead(400); return res.end('caminho inválido'); }
  const arquivo = join(PUBLIC, caminho);
  if (!existsSync(arquivo)) { res.writeHead(404); return res.end('não encontrado'); }
  const tipos = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': tipos[extname(arquivo)] || 'application/octet-stream' });
  res.end(readFileSync(arquivo));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return estatico(req, res, url);
  } catch (err) {
    json(res, 500, { erro: err.message || 'Erro interno' });
  }
});

carregarMunicipios().then(() => {
  server.listen(PORT, () => console.log(`KPI Mobilidade em http://localhost:${PORT}`));
}).catch(err => {
  console.error('Falha ao carregar IBGE:', err.message);
  process.exit(1);
});
