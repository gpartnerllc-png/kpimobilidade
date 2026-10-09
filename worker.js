const UFS = [["AC","Acre","24"],["AL","Alagoas","17"],["AP","Amapá","25"],["AM","Amazonas","22"],["BA","Bahia","05"],["CE","Ceará","07"],["DF","Distrito Federal","20"],["ES","Espírito Santo","14"],["GO","Goiás","10"],["MA","Maranhão","11"],["MT","Mato Grosso","18"],["MS","Mato Grosso do Sul","19"],["MG","Minas Gerais","02"],["PA","Pará","13"],["PB","Paraíba","12"],["PR","Paraná","06"],["PE","Pernambuco","08"],["PI","Piauí","15"],["RJ","Rio de Janeiro","03"],["RN","Rio Grande do Norte","16"],["RS","Rio Grande do Sul","04"],["RO","Rondônia","23"],["RR","Roraima","26"],["SC","Santa Catarina","09"],["SP","São Paulo","01"],["SE","Sergipe","21"],["TO","Tocantins","27"]];
const UF_POR_CODIGO = Object.fromEntries(UFS.map(([s,,c]) => [c,s]));
const UF_NOME = Object.fromEntries(UFS.map(([s,n]) => [s,n]));
const DDDS = new Set("11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(" "));
const PERGUNTAS = [
  { id:"prioridade", texto:"Qual prioridade de mobilidade deve receber recurso no seu município?", opcoes:["Ônibus e BRT","Integração tarifária","Calçadas e acessibilidade","Ciclovias e segurança viária"] },
  { id:"pagamento_km", texto:"Apoia pagamento de transporte por km com auditoria pública?", opcoes:["Sim","Não","Abstenção"] },
  { id:"ia_visao", texto:"Apoia IA de visão só com base legal e proteção de dados para faixa exclusiva?", opcoes:["Sim","Não","Abstenção"] }
];
let municipios = [];

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type":"application/json; charset=utf-8", ...extra } });
}
function nid(p) { return p + crypto.randomUUID().replace(/-/g,"").slice(0,16); }
function agora() { return new Date().toISOString(); }
function soDigitos(s) { return String(s || "").replace(/\D/g,""); }
function norm(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim().toUpperCase(); }
async function hashSenha(senha, salt = crypto.randomUUID()) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt: enc.encode(salt), iterations: 100000, hash:"SHA-256" }, key, 256);
  const hex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,"0")).join("");
  return salt + ":" + hex;
}
async function senhaOk(senha, armazenada) {
  const [salt, hex] = String(armazenada || "").split(":");
  if (!salt || !hex) return false;
  const calc = (await hashSenha(senha, salt)).split(":")[1];
  return calc === hex;
}
function validarCpf(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return { ok:false, motivo:"CPF inválido" };
  const calc = (base, fator) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (fator - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  if (calc(d.slice(0,9), 10) !== Number(d[9]) || calc(d.slice(0,10), 11) !== Number(d[10])) return { ok:false, motivo:"Dígito do CPF não confere" };
  return { ok:true, cpf:d };
}
function validarTitulo(titulo) {
  const t = soDigitos(titulo);
  if (t.length !== 12) return { ok:false, motivo:"Título deve ter 12 dígitos" };
  const ufCod = t.slice(8,10);
  const uf = UF_POR_CODIGO[ufCod];
  if (!uf) return { ok:false, motivo:"Código de UF do título inexistente" };
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(t[i]) * (i + 2);
  const resto = soma % 11;
  let dv1 = resto >= 10 ? 0 : resto;
  if ((ufCod === "01" || ufCod === "02") && resto === 0) dv1 = 1;
  const base2 = ufCod + String(dv1);
  let soma2 = 0;
  [7,8,9].forEach((p,i) => soma2 += Number(base2[i]) * p);
  const resto2 = soma2 % 11;
  let dv2 = resto2 >= 10 ? 0 : resto2;
  if ((ufCod === "01" || ufCod === "02") && resto2 === 0) dv2 = 1;
  if (t.slice(10) !== String(dv1) + String(dv2)) return { ok:false, motivo:"Dígito verificador do título não confere", uf };
  return { ok:true, titulo:t, uf };
}
function validarTelefone(tel) {
  const d = soDigitos(tel);
  if (d.length !== 11 || !DDDS.has(d.slice(0,2)) || d[2] !== "9") return { ok:false, motivo:"WhatsApp inválido: DDD + 9 dígitos" };
  return { ok:true, telefone:d };
}
function idade(iso) {
  const n = new Date(iso + "T00:00:00");
  if (Number.isNaN(n.getTime())) return -1;
  const h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
  return a;
}
async function carregarMunicipios() {
  if (municipios.length) return;
  const resp = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome");
  if (!resp.ok) throw new Error("IBGE indisponível");
  const lista = await resp.json();
  municipios = lista.flatMap(m => {
    const uf = m.microrregiao && m.microrregiao.mesorregiao && m.microrregiao.mesorregiao.UF && m.microrregiao.mesorregiao.UF.sigla;
    return uf ? [{ id:m.id, nome:m.nome, uf }] : [];
  });
}
function publico(u) { if (!u) return null; const { senha_hash, ...resto } = u; return resto; }
async function auditar(db, ator, acao, alvo, detalhe) {
  await db.prepare("INSERT INTO audit (id,em,ator,acao,alvo,detalhe) VALUES (?,?,?,?,?,?)").bind(nid("a_"), agora(), ator, acao, alvo, detalhe || "").run();
}
async function garantirAdmin(env) {
  const tem = await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
  if (tem) return;
  const email = (env.ADMIN_EMAIL || "admin@kpimobilidade.local").toLowerCase();
  const senha = env.ADMIN_PASSWORD || "TrocarEstaSenha#2026";
  await env.DB.prepare(`INSERT INTO users (id,role,nome,email,senha_hash,uf,municipio,status,motivo,validacoes,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(nid("u_"), "admin", "Administrador KPI Mobilidade", email, await hashSenha(senha), "DF", "Brasília", "conferido", "Troque a senha nas variáveis do Cloudflare.", "{}", agora()).run();
}
async function usuarioDaSessao(request, db) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)kpi_session=([^;]+)/);
  if (!m) return null;
  const s = await db.prepare("SELECT * FROM sessions WHERE token=? AND expira>?").bind(m[1], agora()).first();
  if (!s) return null;
  const user = await db.prepare("SELECT * FROM users WHERE id=? AND status!='excluido'").bind(s.user_id).first();
  return user ? { token:s.token, user } : null;
}
function cookie(token) { return `kpi_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`; }
async function totais(db) {
  const rows = await db.prepare("SELECT uf,status,COUNT(*) n FROM users WHERE role='cidadao' AND status!='excluido' GROUP BY uf,status").all();
  const ass = await db.prepare("SELECT uf,COUNT(*) n FROM signatures WHERE excluida=0 GROUP BY uf").all();
  const votos = await db.prepare("SELECT respostas FROM votes WHERE excluido=0").all();
  const porUf = UFS.map(([sigla,nome]) => ({ uf:sigla, nome, cadastrados:0, conferidos:0, pendentes:0, rejeitados:0, assinaturas:0 }));
  const mapa = Object.fromEntries(porUf.map(r => [r.uf, r]));
  for (const r of rows.results || []) {
    if (!mapa[r.uf]) continue;
    mapa[r.uf].cadastrados += r.n;
    if (r.status === "conferido") mapa[r.uf].conferidos += r.n;
    if (r.status === "pendente") mapa[r.uf].pendentes += r.n;
    if (r.status === "rejeitado") mapa[r.uf].rejeitados += r.n;
  }
  for (const r of ass.results || []) if (mapa[r.uf]) mapa[r.uf].assinaturas = r.n;
  const votosPorPergunta = {};
  for (const p of PERGUNTAS) votosPorPergunta[p.id] = Object.fromEntries(p.opcoes.map(o => [o,0]));
  for (const v of votos.results || []) {
    const resp = JSON.parse(v.respostas || "{}");
    for (const p of PERGUNTAS) if (votosPorPergunta[p.id][resp[p.id]] !== undefined) votosPorPergunta[p.id][resp[p.id]]++;
  }
  return {
    cadastrados: porUf.reduce((s,r) => s+r.cadastrados, 0),
    conferidos: porUf.reduce((s,r) => s+r.conferidos, 0),
    pendentes: porUf.reduce((s,r) => s+r.pendentes, 0),
    rejeitados: porUf.reduce((s,r) => s+r.rejeitados, 0),
    assinaturas: porUf.reduce((s,r) => s+r.assinaturas, 0),
    votos: (votos.results || []).length,
    porUf, votosPorPergunta
  };
}
function pdfDe(linhas) {
  const paginas = [];
  for (let i = 0; i < linhas.length; i += 46) paginas.push(linhas.slice(i, i + 46));
  const esc = (t) => String(t).replace(/[^\x20-\x7E]/g, "?").replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
  let objetos = ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageIds = [];
  for (const pagina of paginas) {
    const cmds = ["BT /F1 9 Tf 40 800 Td 14 TL", ...pagina.map((l,i) => `(${esc(l)}) Tj` + (i < pagina.length-1 ? " T*" : "")), "ET"].join("\n");
    objetos.push(`<< /Length ${cmds.length} >>\nstream\n${cmds}\nendstream`);
    pageIds.push(objetos.length + 1);
    objetos.push(`<< /Type /Page /Parent PAGES 0 R /MediaBox [0 0 595 842] /Contents ${objetos.length} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`);
  }
  const kids = pageIds.map(n => `${n} 0 R`).join(" ");
  objetos.push(`<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`);
  const pagesId = objetos.length;
  objetos.push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objetos.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i+1} 0 obj\n${obj.replace("Parent PAGES 0 R", `Parent ${pagesId} 0 R`)}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length+1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10,"0")} 00000 n \n`;
  pdf += `trailer << /Size ${objetos.length+1} /Root ${objetos.length} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  if (!env.DB) return json({ erro:"Banco D1 não está ligado. No Pages, crie o binding DB." }, 500);
  try {
    await garantirAdmin(env);
    const db = env.DB;
    const auth = await usuarioDaSessao(request, db);
    if (path === "/api/meta" && request.method === "GET") return json({ ufs: UFS.map(([sigla,nome]) => ({sigla,nome})), perguntas: PERGUNTAS, banco:"d1" });
    if (path === "/api/municipios" && request.method === "GET") {
      await carregarMunicipios();
      const uf = (url.searchParams.get("uf") || "").toUpperCase();
      const q = norm(url.searchParams.get("q") || "");
      return json(municipios.filter(m => m.uf === uf && (!q || norm(m.nome).includes(q))).slice(0,30));
    }
    if (path === "/api/publico" && request.method === "GET") return json(await totais(db));
    if (path === "/api/cadastro" && request.method === "POST") {
      await carregarMunicipios();
      const b = await request.json();
      const cpf = validarCpf(b.cpf), tel = validarTelefone(b.whatsapp), titulo = validarTitulo(b.titulo);
      const email = String(b.email || "").trim().toLowerCase();
      const uf = String(b.uf || "").toUpperCase();
      const mun = municipios.find(m => m.uf === uf && norm(m.nome) === norm(b.municipio));
      const erros = [];
      if (String(b.nome || "").trim().split(/\s+/).length < 2) erros.push("Informe nome e sobrenome");
      if (!cpf.ok) erros.push(cpf.motivo);
      if (!tel.ok) erros.push(tel.motivo);
      if (!titulo.ok) erros.push(titulo.motivo);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erros.push("E-mail inválido");
      if (!UF_NOME[uf]) erros.push("UF inválida");
      if (!mun) erros.push("Município não existe nessa UF na base do IBGE");
      if (idade(b.nascimento) < 16) erros.push("Idade mínima de 16 anos");
      if (!b.emissao || b.emissao > new Date().toISOString().slice(0,10) || b.emissao < b.nascimento) erros.push("Data de emissão inválida");
      if (!/^\d{1,4}$/.test(soDigitos(b.zona)) || !/^\d{1,4}$/.test(soDigitos(b.secao))) erros.push("Zona ou seção inválida");
      if (!b.termo) erros.push("Declare a veracidade");
      if (String(b.senha || "").length < 8) erros.push("Senha mínima de 8 caracteres");
      if (cpf.ok && await db.prepare("SELECT id FROM users WHERE cpf=? AND status!='excluido'").bind(cpf.cpf).first()) erros.push("CPF já cadastrado");
      if (await db.prepare("SELECT id FROM users WHERE email=? AND status!='excluido'").bind(email).first()) erros.push("E-mail já cadastrado");
      if (titulo.ok && await db.prepare("SELECT id FROM users WHERE titulo=? AND status!='excluido'").bind(titulo.titulo).first()) erros.push("Título já cadastrado");
      if (erros.length) return json({ ok:false, erros }, 422);
      const id = nid("u_");
      const transferencia = titulo.ok && titulo.uf !== uf;
      const motivo = transferencia ? `Título emitido em ${titulo.uf}; domicílio informado ${mun.nome}/${uf}. Zona e seção são as atuais.` : "";
      await db.prepare(`INSERT INTO users (id,role,nome,email,senha_hash,cpf,whatsapp,nascimento,titulo,titulo_uf,zona,secao,uf,municipio,municipio_ibge,emissao,status,motivo,validacoes,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id,"cidadao",b.nome.trim(),email,await hashSenha(b.senha),cpf.cpf,tel.telefone,b.nascimento,titulo.titulo,titulo.uf,soDigitos(b.zona),soDigitos(b.secao),uf,mun.nome,String(mun.id),b.emissao,"pendente",motivo,JSON.stringify({cpf:true,tituloFormato:true,municipioIbge:true,transferencia,consultaTse:false,consultaReceita:false}),agora()).run();
      await auditar(db, id, "cadastro", id, mun.nome + "/" + uf);
      return json({ ok:true, mensagem:"Cadastro gravado no D1 e pendente de conferência.", id }, 201);
    }
    if (path === "/api/login" && request.method === "POST") {
      const b = await request.json();
      const user = await db.prepare("SELECT * FROM users WHERE email=? AND status!='excluido'").bind(String(b.email||"").toLowerCase()).first();
      if (!user || !(await senhaOk(b.senha || "", user.senha_hash))) return json({ ok:false, erro:"E-mail ou senha incorretos" }, 401);
      if (user.status === "rejeitado") return json({ ok:false, erro:"Cadastro rejeitado: " + (user.motivo || "dados não conferem") }, 403);
      const token = crypto.randomUUID().replace(/-/g,"");
      await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id).run();
      await db.prepare("INSERT INTO sessions (token,user_id,expira) VALUES (?,?,?)").bind(token, user.id, new Date(Date.now()+12*3600*1000).toISOString()).run();
      return json({ ok:true, user: publico(user) }, 200, { "Set-Cookie": cookie(token) });
    }
    if (path === "/api/logout" && request.method === "POST") {
      if (auth) await db.prepare("DELETE FROM sessions WHERE token=?").bind(auth.token).run();
      return json({ ok:true }, 200, { "Set-Cookie":"kpi_session=; HttpOnly; Secure; Path=/; Max-Age=0" });
    }
    if (path === "/api/me" && request.method === "GET") return json({ user: auth ? publico(auth.user) : null });
    if (!auth) return json({ erro:"Entre na sua conta" }, 401);
    if (path === "/api/assinar" && request.method === "POST") {
      if (auth.user.status !== "conferido") return json({ erro:"Assinatura liberada após conferência" }, 403);
      if (await db.prepare("SELECT id FROM signatures WHERE user_id=? AND excluida=0").bind(auth.user.id).first()) return json({ erro:"Você já assinou" }, 409);
      await db.prepare("INSERT INTO signatures (id,user_id,nome,cpf,uf,municipio,em,excluida) VALUES (?,?,?,?,?,?,?,0)").bind(nid("s_"), auth.user.id, auth.user.nome, auth.user.cpf, auth.user.uf, auth.user.municipio, agora()).run();
      return json({ ok:true }, 201);
    }
    if (path === "/api/votar" && request.method === "POST") {
      if (auth.user.status !== "conferido") return json({ erro:"Voto liberado após conferência" }, 403);
      if (await db.prepare("SELECT id FROM votes WHERE user_id=? AND excluido=0").bind(auth.user.id).first()) return json({ erro:"Você já votou" }, 409);
      const b = await request.json();
      const respostas = {};
      for (const p of PERGUNTAS) {
        if (!p.opcoes.includes(b.respostas?.[p.id])) return json({ erro:"Resposta inválida" }, 422);
        respostas[p.id] = b.respostas[p.id];
      }
      await db.prepare("INSERT INTO votes (id,user_id,uf,municipio,respostas,em,excluido) VALUES (?,?,?,?,?,?,0)").bind(nid("v_"), auth.user.id, auth.user.uf, auth.user.municipio, JSON.stringify(respostas), agora()).run();
      return json({ ok:true }, 201);
    }
    if (auth.user.role !== "admin") return json({ erro:"Somente admin" }, 403);
    if (path === "/api/admin/painel") return json({ totais: await totais(db), auditoria: (await db.prepare("SELECT * FROM audit ORDER BY em DESC LIMIT 40").all()).results });
    if (path === "/api/admin/usuarios" && request.method === "GET") {
      const uf = (url.searchParams.get("uf") || "").toUpperCase();
      const status = url.searchParams.get("status") || "";
      const q = norm(url.searchParams.get("q") || "");
      let lista = (await db.prepare("SELECT * FROM users WHERE role='cidadao' ORDER BY criado_em DESC").all()).results;
      if (uf) lista = lista.filter(u => u.uf === uf);
      if (status) lista = lista.filter(u => u.status === status);
      if (q) lista = lista.filter(u => norm(u.nome + u.cpf + u.municipio + u.email).includes(q));
      return json(lista.map(publico));
    }
    const acao = path.match(/^\/api\/admin\/usuarios\/([^/]+)(?:\/(conferir|rejeitar|excluir|restaurar))?$/);
    if (acao && request.method === "POST") {
      const user = await db.prepare("SELECT * FROM users WHERE id=? AND role='cidadao'").bind(acao[1]).first();
      if (!user) return json({ erro:"Cadastro não encontrado" }, 404);
      const b = await request.json().catch(() => ({}));
      const tipo = acao[2];
      let status = user.status, motivo = user.motivo || "", excluido = user.excluido_em;
      if (tipo === "conferir") { status = "conferido"; motivo = ""; }
      if (tipo === "rejeitar") { status = "rejeitado"; motivo = String(b.motivo || "Dados não conferem").slice(0,240); }
      if (tipo === "excluir") { status = "excluido"; motivo = String(b.motivo || "Excluído pelo admin").slice(0,240); excluido = agora(); }
      if (tipo === "restaurar") { status = "pendente"; excluido = null; }
      await db.prepare("UPDATE users SET status=?, motivo=?, excluido_em=? WHERE id=?").bind(status, motivo, excluido, user.id).run();
      await auditar(db, auth.user.id, tipo, user.id, motivo);
      return json({ ok:true });
    }
    if (acao && request.method === "DELETE") {
      await db.prepare("DELETE FROM users WHERE id=? AND role='cidadao'").bind(acao[1]).run();
      await db.prepare("UPDATE signatures SET excluida=1 WHERE user_id=?").bind(acao[1]).run();
      await db.prepare("UPDATE votes SET excluido=1 WHERE user_id=?").bind(acao[1]).run();
      await auditar(db, auth.user.id, "deletar_permanente", acao[1], "");
      return json({ ok:true });
    }
    if (path === "/api/admin/relatorio.pdf") {
      const t = await totais(db);
      const uf = (url.searchParams.get("uf") || "").toUpperCase();
      const pessoas = (await db.prepare("SELECT nome,cpf,municipio,uf,titulo,zona,secao FROM users WHERE role='cidadao' AND status='conferido'").all()).results.filter(u => !uf || u.uf === uf);
      const linhas = ["MANIFESTO KPI MOBILIDADE — protocolo nacional", "Nao e documento do TSE nem do governo.", "Gerado em " + new Date().toLocaleString("pt-BR"), "", `Cadastrados ${t.cadastrados} | Conferidos ${t.conferidos} | Assinaturas ${t.assinaturas} | Votos ${t.votos}`, ""];
      for (const row of t.porUf) if (!uf || row.uf === uf) linhas.push(`${row.uf}: cad ${row.cadastrados} | conf ${row.conferidos} | ass ${row.assinaturas}`);
      linhas.push("", "Relacao conferida");
      pessoas.forEach((u,i) => linhas.push(`${i+1}. ${u.nome} | ${u.municipio}/${u.uf} | titulo ${u.titulo} | zona ${u.zona} secao ${u.secao}`));
      return new Response(pdfDe(linhas), { headers:{ "Content-Type":"application/pdf", "Content-Disposition":`attachment; filename="protocolo-kpi-${uf || "brasil"}.pdf"` } });
    }
    if (path === "/api/admin/export.csv") {
      const lista = (await db.prepare("SELECT nome,cpf,email,whatsapp,titulo,municipio,uf,status,criado_em FROM users WHERE role='cidadao'").all()).results;
      const csv = "nome,cpf,email,whatsapp,titulo,municipio,uf,status,criado_em\n" + lista.map(u => [u.nome,u.cpf,u.email,u.whatsapp,u.titulo,u.municipio,u.uf,u.status,u.criado_em].map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
      return new Response("\uFEFF" + csv, { headers:{ "Content-Type":"text/csv; charset=utf-8", "Content-Disposition":"attachment; filename=kpi-cadastros.csv" } });
    }
    return json({ erro:"Rota não encontrada" }, 404);
  } catch (err) {
    return json({ erro: err.message || "Erro interno" }, 500);
  }
}


const PAGINA = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SandxCDD | Mobilidade Inteligente & IA</title>
  <link rel="icon" href="/marca.svg">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    :root { --primary:#1a237e; --accent:#ffd600; --dark:#121212; --light:#f4f4f4; --erro:#b71c1c; --ok:#2e7d32; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif; background:var(--light); color:var(--dark); line-height:1.6; }
    header {
      background: linear-gradient(rgba(26,35,126,.9), rgba(26,35,126,.9)), url("https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&q=80");
      background-size:cover; background-position:center; color:#fff; text-align:center; padding:90px 20px 70px;
    }
    h1 { font-size:clamp(2.4rem,6vw,3.5rem); margin:0 0 10px; }
    .tagline { font-size:1.35rem; margin:0 0 8px; opacity:.95; }
    .btn { border:0; cursor:pointer; background:var(--accent); color:var(--dark); padding:15px 35px; font-weight:bold; border-radius:50px; font-size:1.15rem; }
    .btn:hover { transform:scale(1.04); }
    .btn.azul { background:var(--primary); color:#fff; border-radius:8px; padding:10px 16px; font-size:.95rem; }
    .container { max-width:1100px; margin:auto; padding:20px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:20px; margin-top:-40px; }
    .card { background:#fff; padding:30px; border-radius:10px; box-shadow:0 10px 20px rgba(0,0,0,.1); text-align:center; }
    .card i { font-size:2.6rem; color:var(--primary); }
    .laws { background:#fff; padding:48px 28px; margin-top:36px; border-radius:10px; }
    .law-item { border-left:5px solid var(--primary); padding-left:16px; margin:0 0 18px; text-align:left; }
    .kpi-box { background:#e3f2fd; padding:16px; border-radius:8px; color:var(--primary); font-weight:bold; }
    footer { background:var(--primary); color:#fff; text-align:center; padding:32px 16px; margin-top:40px; }
    label { display:block; font-size:.8rem; margin:8px 0 4px; }
    input, select { width:100%; padding:10px; border:1px solid #ccc; border-radius:6px; font:inherit; }
    .modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,.8); z-index:20; overflow:auto; padding:20px; }
    .modal.aberto { display:flex; justify-content:center; }
    .caixa { background:#fff; border-radius:15px; max-width:760px; width:100%; margin:auto; padding:28px; position:relative; }
    .fechar { position:absolute; top:10px; right:12px; border:0; background:none; font-size:28px; cursor:pointer; }
    .erro { color:var(--erro); } .ok { color:var(--ok); }
    #dash { display:none; min-height:100vh; background:#eef1f6; }
    #dash.aberto { display:block; }
    .topbar { background:#1a237e; color:#fff; display:flex; justify-content:space-between; align-items:center; padding:16px 28px; }
    .topbar button { background:#ffd600; color:#121212; border:0; border-radius:8px; padding:8px 14px; font-weight:bold; cursor:pointer; }
    .topo-acoes { display:flex; gap:8px; align-items:center; }
    .topo-acoes a { color:#fff; text-decoration:none; border:1px solid rgba(255,255,255,.35); border-radius:8px; padding:8px 12px; }
    .miolo { max-width:1200px; margin:auto; padding:24px; }
    .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-top:0; }
    .kpi { background:#fff; border-radius:12px; padding:16px; box-shadow:0 4px 14px rgba(0,0,0,.06); }
    .kpi strong { display:block; font-size:1.7rem; color:#1a237e; }
    .painel { background:#fff; border-radius:12px; padding:18px; margin-top:16px; box-shadow:0 4px 14px rgba(0,0,0,.06); }
    table { width:100%; border-collapse:collapse; font-size:.86rem; }
    th, td { border-bottom:1px solid #eee; text-align:left; padding:8px; vertical-align:top; }
    .acoes button { margin:2px; border:1px solid #ccc; background:#fff; border-radius:6px; padding:4px 8px; cursor:pointer; }
    .login-box { max-width:420px; margin:80px auto; background:#fff; padding:28px; border-radius:14px; box-shadow:0 10px 24px rgba(0,0,0,.08); }
  </style>
</head>
<body>
<div id="publico">
<header>
  <div class="container">
    <h1>SANDXCDD</h1>
    <p class="tagline">Tecnologia para o transporte da nossa cidade.</p>
    <p>Pagamento por percurso, segurança via IA e transparência.</p>
    <p><button class="btn" id="abrirAssinar">ASSINAR O MANIFESTO POPULAR</button></p>
  </div>
</header>
<div class="container">
  <div class="grid">
    <article class="card"><i class="fas fa-microchip"></i><h3>IA de visão</h3><p>Monitorar a frota e a faixa exclusiva com base legal e proteção de dados.</p></article>
    <article class="card"><i class="fas fa-route"></i><h3>Pagamento por km</h3><p>Pagar pelo trecho percorrido, com auditoria pública do que rodou e do que foi pago.</p></article>
    <article class="card"><i class="fas fa-balance-scale"></i><h3>Poder jurídico</h3><p>Abaixo-assinado cidadão para protocolar. Não substitui voto do TSE nem iniciativa popular formal.</p></article>
  </div>
  <section class="laws" id="manifesto">
    <h2>Nosso embasamento</h2>
    <div class="law-item"><strong>Constituição, art. 37:</strong> eficiência da administração. Se existe meio de melhorar o transporte, o gestor deve avaliar.</div>
    <div class="law-item"><strong>Lei 14.129/2021:</strong> serviços públicos digitais e redução de custo para o cidadão.</div>
    <div class="law-item"><strong>Lei 8.429/1992:</strong> citada como contexto de responsabilidade do gestor, não como julgamento deste site.</div>
    <div class="law-item"><strong>Lei 13.709/2018:</strong> os dados servem só a este manifesto, com conferência e exclusão pelo admin.</div>
    <div class="kpi-box" id="totais">Protocolo cidadão. Aguardando assinaturas conferidas.</div>
  </section>
</div>
<footer>
  <p>Projeto SandxCDD. Iniciativa cidadã, não é site oficial.</p>
</footer>
</div>

<div class="modal" id="modalCadastro">
  <div class="caixa">
    <button class="fechar" data-fecha="modalCadastro">&times;</button>
    <h2 style="color:var(--primary);margin-top:0">Assinar manifesto</h2>
    <p>O município é o domicílio atual. O número do título não muda na transferência; zona e seção são as de agora.</p>
    <div class="grid" style="margin-top:0">
      <div><label>Nome completo</label><input id="nome"></div>
      <div><label>E-mail</label><input id="email" type="email"></div>
      <div><label>Senha</label><input id="senha" type="password"></div>
      <div><label>CPF</label><input id="cpf" maxlength="14"></div>
      <div><label>WhatsApp com DDD</label><input id="whatsapp"></div>
      <div><label>Nascimento</label><input id="nascimento" type="date"></div>
      <div><label>Título (12 dígitos)</label><input id="titulo" maxlength="12"></div>
      <div><label>Zona</label><input id="zona"></div>
      <div><label>Seção</label><input id="secao"></div>
      <div><label>UF atual</label><select id="uf"><option value="">Selecione</option></select></div>
      <div><label>Município atual</label><input id="municipio" list="listaMun" placeholder="Brasília"><datalist id="listaMun"></datalist></div>
      <div><label>Emissão do título</label><input id="emissao" type="date"></div>
    </div>
    <label><input type="checkbox" id="termo"> Declaro que os dados são verdadeiros e autorizo o uso neste manifesto.</label>
    <p><button class="btn" id="btnCadastro">Confirmar e assinar</button></p>
    <p id="cadastroMsg"></p>
  </div>
</div>

<div id="dash">
  <div class="topbar">
    <strong>SandxCDD · Controle nacional</strong>
    <div class="topo-acoes">
      <a href="/api/admin/relatorio.pdf">PDF Brasil</a>
      <a id="pdfUf" href="/api/admin/relatorio.pdf">PDF da UF</a>
      <a href="/api/admin/export.csv">CSV</a>
      <button id="btnSair">Sair</button>
    </div>
  </div>
  <div class="miolo">
    <div class="login-box" id="loginBox">
      <h2 style="color:#1a237e;margin-top:0">Acesso interno</h2>
      <label>E-mail</label><input id="loginEmail" type="email">
      <label>Senha</label><input id="loginSenha" type="password">
      <p><button class="btn" id="btnLogin">Entrar</button></p>
      <p id="loginMsg"></p>
    </div>
    <div id="board" class="hidden">
      <div class="kpis" id="kpis"></div>
      <div class="painel">
        <div class="kpis">
          <div><label>Busca</label><input id="filtroQ" placeholder="Nome, CPF, cidade"></div>
          <div><label>UF</label><select id="filtroUf"><option value="">Todas</option></select></div>
          <div><label>Status</label><select id="filtroStatus"><option value="">Todos</option><option>pendente</option><option>conferido</option><option>rejeitado</option><option>excluido</option></select></div>
        </div>
        <p><button class="btn azul" id="btnFiltrar">Atualizar visão</button></p>
        <div style="overflow:auto"><table id="tabela"></table></div>
      </div>
      <div class="painel"><h3 style="margin-top:0">Auditoria</h3><div id="auditoria"></div></div>
    </div>
  </div>
</div>

<script>
const $ = (s) => document.querySelector(s);
const UFS = [["AC","Acre"],["AL","Alagoas"],["AP","Amapá"],["AM","Amazonas"],["BA","Bahia"],["CE","Ceará"],["DF","Distrito Federal"],["ES","Espírito Santo"],["GO","Goiás"],["MA","Maranhão"],["MT","Mato Grosso"],["MS","Mato Grosso do Sul"],["MG","Minas Gerais"],["PA","Pará"],["PB","Paraíba"],["PR","Paraná"],["PE","Pernambuco"],["PI","Piauí"],["RJ","Rio de Janeiro"],["RN","Rio Grande do Norte"],["RS","Rio Grande do Sul"],["RO","Rondônia"],["RR","Roraima"],["SC","Santa Catarina"],["SP","São Paulo"],["SE","Sergipe"],["TO","Tocantins"]];
let me = null;
function abrir(id) { document.getElementById(id).classList.add("aberto"); }
function fechar(id) { document.getElementById(id).classList.remove("aberto"); }
document.querySelectorAll("[data-fecha]").forEach(b => b.onclick = () => fechar(b.dataset.fecha));
$("#abrirAssinar").onclick = () => abrir("modalCadastro");
$("#uf").innerHTML += UFS.map(([s,n]) => \`<option value="\${s}">\${s} — \${n}</option>\`).join("");
$("#filtroUf").innerHTML += UFS.map(([s]) => \`<option value="\${s}">\${s}</option>\`).join("");
async function api(url, opt = {}) {
  const r = await fetch(url, { headers:{ "Content-Type":"application/json" }, ...opt });
  const tipo = r.headers.get("content-type") || "";
  if (tipo.includes("pdf") || tipo.includes("csv")) return r;
  const data = await r.json().catch(() => null);
  if (!r.ok) throw data || { erro:\`A API respondeu \${r.status}.\` };
  return data;
}
function mostrarDash() {
  $("#publico").style.display = "none";
  $("#dash").classList.add("aberto");
  if (me && me.role === "admin") { $("#loginBox").style.display = "none"; $("#board").classList.remove("hidden"); pintarPainel(); }
}
async function boot() {
  try {
    const t = await api("/api/publico");
    $("#totais").textContent = \`Brasil: \${t.cadastrados} cadastros, \${t.conferidos} conferidos, \${t.assinaturas} assinaturas, \${t.votos} votos.\`;
    me = (await api("/api/me")).user;
  } catch (e) {
    $("#totais").textContent = e.erro || "Abra este manifesto no endereço do Worker.";
  }
  if (location.hash === "#admin" || location.pathname === "/admin") mostrarDash();
}
window.addEventListener("hashchange", () => location.hash === "#admin" ? mostrarDash() : ($("#publico").style.display = "", $("#dash").classList.remove("aberto")));
$("#uf").onchange = buscarMun; $("#municipio").oninput = buscarMun;
async function buscarMun() {
  if (!$("#uf").value) return;
  const lista = await api("/api/municipios?uf=" + $("#uf").value + "&q=" + encodeURIComponent($("#municipio").value));
  $("#listaMun").innerHTML = lista.map(m => \`<option value="\${m.nome}"></option>\`).join("");
}
$("#btnCadastro").onclick = async () => {
  const body = ["nome","email","senha","cpf","whatsapp","nascimento","titulo","zona","secao","uf","municipio","emissao"].reduce((o,k) => (o[k] = $("#"+k).value, o), { termo:$("#termo").checked });
  try {
    const r = await api("/api/cadastro", { method:"POST", body:JSON.stringify(body) });
    $("#cadastroMsg").innerHTML = \`<span class="ok">\${r.mensagem} Protocolo \${r.id}.</span>\`;
  } catch (e) {
    $("#cadastroMsg").innerHTML = \`<span class="erro">\${(e.erros || [e.erro || "Falha ao gravar"]).join("<br>")}</span>\`;
  }
};
$("#btnLogin").onclick = async () => {
  try {
    me = (await api("/api/login", { method:"POST", body:JSON.stringify({ email:$("#loginEmail").value, senha:$("#loginSenha").value }) })).user;
    if (me.role !== "admin") { $("#loginMsg").innerHTML = \`<span class="erro">Esta entrada é só do admin.</span>\`; return; }
    $("#loginMsg").innerHTML = "";
    mostrarDash();
  } catch (e) { $("#loginMsg").innerHTML = \`<span class="erro">\${e.erro || "Falha no login"}</span>\`; }
};
$("#btnSair").onclick = async () => { await api("/api/logout", { method:"POST", body:"{}" }); location.href = "/"; };
$("#btnFiltrar").onclick = pintarPainel;
$("#filtroUf").onchange = () => { $("#pdfUf").href = "/api/admin/relatorio.pdf?uf=" + $("#filtroUf").value; };
async function pintarPainel() {
  const q = encodeURIComponent($("#filtroQ").value || "");
  const [painel, usuarios] = await Promise.all([api("/api/admin/painel"), api(\`/api/admin/usuarios?q=\${q}&uf=\${$("#filtroUf").value}&status=\${$("#filtroStatus").value}\`)]);
  const t = painel.totais;
  $("#kpis").innerHTML = [["Cadastrados", t.cadastrados],["Conferidos", t.conferidos],["Pendentes", t.pendentes],["Assinaturas", t.assinaturas],["Votos", t.votos]].map(([k,v]) => \`<div class="kpi"><strong>\${v}</strong>\${k}</div>\`).join("");
  $("#tabela").innerHTML = "<tr><th>Nome</th><th>Documentos</th><th>Domicílio atual</th><th>Status</th><th>Ações</th></tr>" + usuarios.map(u => \`<tr><td>\${u.nome}<br><small>\${u.email}</small></td><td>CPF \${u.cpf}<br>Título \${u.titulo}<br><small>emissão \${u.titulo_uf || "—"}</small></td><td>\${u.municipio}/\${u.uf}<br>zona \${u.zona} · seção \${u.secao}</td><td>\${u.status}<br><small>\${u.motivo || ""}</small></td><td class="acoes"><button data-id="\${u.id}" data-acao="conferir">Conferir</button><button data-id="\${u.id}" data-acao="rejeitar">Rejeitar</button><button data-id="\${u.id}" data-acao="excluir">Excluir</button><button data-id="\${u.id}" data-acao="restaurar">Restaurar</button><button data-id="\${u.id}" data-acao="deletar">Deletar</button></td></tr>\`).join("");
  $("#tabela").querySelectorAll("button").forEach(b => b.onclick = acaoAdmin);
  $("#auditoria").innerHTML = (painel.auditoria || []).map(a => \`<div><small>\${a.em} · \${a.acao} · \${a.detalhe || ""}</small></div>\`).join("") || "<small>Sem movimentos.</small>";
}
async function acaoAdmin(ev) {
  const { id, acao } = ev.target.dataset;
  if (acao === "deletar") { if (!confirm("Deletar permanente?")) return; await api("/api/admin/usuarios/"+id, { method:"DELETE" }); }
  else await api("/api/admin/usuarios/"+id+"/"+acao, { method:"POST", body:JSON.stringify({ motivo: acao === "rejeitar" || acao === "excluir" ? (prompt("Motivo") || "") : "" }) });
  pintarPainel();
}
boot();
</script>
</body>
</html>
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/admin") return new Response(PAGINA, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (url.pathname === "/marca.svg") return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#1a237e"/><circle cx="32" cy="32" r="18" fill="none" stroke="#ffd600" stroke-width="3"/></svg>', { headers: { "Content-Type": "image/svg+xml" } });
    if (url.pathname.startsWith("/api/")) return onRequest({ request, env, ctx });
    return new Response("Nao encontrado", { status: 404 });
  }
};
