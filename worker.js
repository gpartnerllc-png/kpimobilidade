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
  municipios = lista.map(m => ({ id:m.id, nome:m.nome, uf:m.microrregiao.mesorregiao.UF.sigla }));
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
      if (titulo.ok && titulo.uf !== uf) erros.push(`UF do título (${titulo.uf}) não confere com ${uf}`);
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
      await db.prepare(`INSERT INTO users (id,role,nome,email,senha_hash,cpf,whatsapp,nascimento,titulo,titulo_uf,zona,secao,uf,municipio,municipio_ibge,emissao,status,motivo,validacoes,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id,"cidadao",b.nome.trim(),email,await hashSenha(b.senha),cpf.cpf,tel.telefone,b.nascimento,titulo.titulo,titulo.uf,soDigitos(b.zona),soDigitos(b.secao),uf,mun.nome,String(mun.id),b.emissao,"pendente","",JSON.stringify({cpf:true,tituloFormato:true,municipioIbge:true,consultaTse:false}),agora()).run();
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
  <title>KPI´s | Mobilidade Inteligente & IA</title>
  <link rel="icon" href="/marca.svg">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    :root { --primary:#1a237e; --accent:#ffd600; --dark:#121212; --light:#f4f4f4; --success:#2e7d32; --erro:#b71c1c; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif; background:var(--light); color:var(--dark); line-height:1.6; }
    header {
      background: linear-gradient(rgba(26,35,126,.9), rgba(26,35,126,.9)), url("https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&q=80");
      background-size:cover; background-position:center; color:#fff; text-align:center; padding:78px 20px 36px;
    }
    header h1 { font-size:clamp(2rem,5vw,3.4rem); margin:0 0 8px; }
    .tagline { font-size:1.15rem; opacity:.92; margin:0 0 22px; }
    .nav { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
    .btn, nav button, .nav button {
      border:0; cursor:pointer; background:#fff; color:var(--primary); font-weight:700; border-radius:50px; padding:10px 18px;
    }
    .btn.primario, .nav button.ativo { background:var(--accent); color:var(--dark); }
    .btn.azul { background:var(--primary); color:#fff; }
    .btn:hover { transform:translateY(-1px); }
    .container { max-width:1100px; margin:auto; padding:20px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; }
    .card { background:#fff; border-radius:14px; padding:22px; box-shadow:0 4px 16px rgba(0,0,0,.06); margin-bottom:16px; }
    .card h3 { margin:8px 0; color:var(--primary); }
    .icone { width:54px; height:54px; border-radius:50%; background:var(--accent); color:var(--dark); display:grid; place-items:center; font-size:1.3rem; }
    label { display:block; font-size:.82rem; margin:10px 0 4px; color:#333; }
    input, select { width:100%; padding:10px 12px; border:1px solid #d0d0d0; border-radius:8px; font:inherit; }
    .erro { color:var(--erro); } .ok { color:var(--success); }
    table { width:100%; border-collapse:collapse; font-size:.86rem; }
    th, td { border-bottom:1px solid #eee; text-align:left; padding:7px; vertical-align:top; }
    .acoes button { margin:2px; border:1px solid #ccc; background:#fff; border-radius:6px; padding:4px 8px; cursor:pointer; }
    .hidden { display:none; }
    footer { text-align:center; padding:24px; color:#555; font-size:.85rem; }
    .status-bar { background:#fff8e1; color:#5d4037; padding:10px 16px; text-align:center; font-size:.9rem; }
  </style>
</head>
<body>
  <header>
    <h1>KPI´s | Mobilidade Inteligente & IA</h1>
    <p class="tagline">Plano de Mobilidade Urbana · Projeto SandxCDD</p>
    <div class="nav">
      <button data-aba="manifesto" class="ativo">Manifesto</button>
      <button data-aba="entrar">Entrar</button>
      <button data-aba="cadastrar">Cadastrar</button>
      <button data-aba="painel">Meu painel</button>
      <button data-aba="admin" id="abaAdmin" class="hidden">Admin</button>
    </div>
  </header>
  <div id="statusBar" class="status-bar hidden"></div>
  <main class="container">
    <section id="manifesto">
      <div class="grid">
        <article class="card"><div class="icone"><i class="fas fa-eye"></i></div><h3>IA de visão</h3><p>Fiscalização de faixa exclusiva só com base legal e proteção de dados.</p></article>
        <article class="card"><div class="icone"><i class="fas fa-route"></i></div><h3>Pagamento por km</h3><p>Tarifa auditável, com rastro público do que foi pago e do que rodou.</p></article>
        <article class="card"><div class="icone"><i class="fas fa-balance-scale"></i></div><h3>Protocolo popular</h3><p>Assinatura conferida, votação e PDF nacional para levar à autoridade.</p></article>
      </div>
      <div class="card">
        <h2 style="color:var(--primary);margin-top:0">Plano de mobilidade urbana</h2>
        <p>Abaixo-assinado cidadão para eficiência da mobilidade no município, com rastreio pelas 27 UFs. Não substitui iniciativa popular da Constituição nem voto do TSE.</p>
        <div class="grid" id="totais"></div>
      </div>
      <div class="card">
        <h2 style="color:var(--primary);margin-top:0">Embasamento citado</h2>
        <ul>
          <li>Constituição, art. 14, III, e art. 61, §2º — iniciativa popular tem rito próprio.</li>
          <li>Lei 14.129/2021 — governo digital, como referência.</li>
          <li>Lei 13.709/2018 — LGPD: consentimento, exclusão e minimização.</li>
          <li>Lei 8.429/1992 — citada só como contexto do manifesto.</li>
        </ul>
      </div>
    </section>

    <section id="entrar" class="hidden">
      <div class="card" style="max-width:520px;margin:0 auto">
        <h2 style="color:var(--primary);margin-top:0">Entrar</h2>
        <p>Cidadão e admin usam a mesma aba. O papel vem da conta.</p>
        <label>E-mail</label><input id="loginEmail" type="email" autocomplete="username">
        <label>Senha</label><input id="loginSenha" type="password" autocomplete="current-password">
        <p><button class="btn primario" id="btnLogin">Entrar</button></p>
        <p id="loginMsg"></p>
      </div>
    </section>

    <section id="cadastrar" class="hidden">
      <div class="card">
        <h2 style="color:var(--primary);margin-top:0">Cadastro do cidadão</h2>
        <p>Nome do município tem de ser o oficial do IBGE. Brasília pode ir sem acento. A UF é obrigatória.</p>
        <div class="grid">
          <div><label>Nome completo</label><input id="nome"></div>
          <div><label>E-mail</label><input id="email" type="email"></div>
          <div><label>Senha</label><input id="senha" type="password"></div>
          <div><label>CPF</label><input id="cpf" inputmode="numeric" maxlength="14"></div>
          <div><label>WhatsApp com DDD</label><input id="whatsapp" placeholder="61999999999"></div>
          <div><label>Nascimento</label><input id="nascimento" type="date"></div>
          <div><label>Título (12 dígitos)</label><input id="titulo" inputmode="numeric" maxlength="12"></div>
          <div><label>Zona</label><input id="zona"></div>
          <div><label>Seção</label><input id="secao"></div>
          <div><label>UF</label><select id="uf"><option value="">Selecione</option></select></div>
          <div><label>Município oficial</label><input id="municipio" list="listaMun" placeholder="Brasília"><datalist id="listaMun"></datalist></div>
          <div><label>Emissão do título</label><input id="emissao" type="date"></div>
        </div>
        <label><input type="checkbox" id="termo"> Declaro, sob as penas da lei, que os dados são verdadeiros e autorizo o tratamento para este manifesto.</label>
        <p><button class="btn primario" id="btnCadastro">Enviar para conferência</button></p>
        <div id="cadastroMsg"></div>
      </div>
    </section>

    <section id="painel" class="hidden"><div class="card" id="painelConteudo">Entre na aba Entrar.</div></section>
    <section id="admin" class="hidden">
      <div class="card">
        <h2 style="color:var(--primary);margin-top:0">Admin — Brasil</h2>
        <p>
          <button class="btn azul" id="btnPdfBrasil">PDF Brasil</button>
          <button class="btn azul" id="btnPdfUf">PDF da UF</button>
          <button class="btn" id="btnCsv">CSV</button>
        </p>
        <div class="grid">
          <div><label>Busca</label><input id="filtroQ"></div>
          <div><label>UF</label><select id="filtroUf"><option value="">Todas</option></select></div>
          <div><label>Status</label><select id="filtroStatus"><option value="">Todos</option><option>pendente</option><option>conferido</option><option>rejeitado</option><option>excluido</option></select></div>
        </div>
        <p><button class="btn primario" id="btnFiltrar">Atualizar</button></p>
        <div id="adminResumo"></div>
        <div style="overflow:auto"><table id="tabela"></table></div>
        <h3>Auditoria</h3><div id="auditoria"></div>
      </div>
    </section>
  </main>
  <footer>Projeto SandxCDD · iniciativa cidadã, não é site oficial. CPF e título são conferidos por dígito; não há consulta à Receita nem ao TSE. Marca própria, sem brasão do governo.</footer>
  <script>
    const $ = (s) => document.querySelector(s);
    const UFS = [["AC","Acre"],["AL","Alagoas"],["AP","Amapá"],["AM","Amazonas"],["BA","Bahia"],["CE","Ceará"],["DF","Distrito Federal"],["ES","Espírito Santo"],["GO","Goiás"],["MA","Maranhão"],["MT","Mato Grosso"],["MS","Mato Grosso do Sul"],["MG","Minas Gerais"],["PA","Pará"],["PB","Paraíba"],["PR","Paraná"],["PE","Pernambuco"],["PI","Piauí"],["RJ","Rio de Janeiro"],["RN","Rio Grande do Norte"],["RS","Rio Grande do Sul"],["RO","Rondônia"],["RR","Roraima"],["SC","Santa Catarina"],["SP","São Paulo"],["SE","Sergipe"],["TO","Tocantins"]];
    let me = null, apiOk = false;
    function aba(nome) {
      document.querySelectorAll("main > section").forEach(s => s.classList.add("hidden"));
      document.getElementById(nome).classList.remove("hidden");
      document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("ativo", b.dataset.aba === nome));
      if (nome === "painel") pintarPainel();
      if (nome === "admin") carregarAdmin();
    }
    document.querySelectorAll(".nav button").forEach(b => b.onclick = () => aba(b.dataset.aba));
    function preencherUfs() {
      const opts = UFS.map(([s,n]) => \`<option value="\${s}">\${s} — \${n}</option>\`).join("");
      $("#uf").insertAdjacentHTML("beforeend", opts);
      $("#filtroUf").insertAdjacentHTML("beforeend", UFS.map(([s]) => \`<option value="\${s}">\${s}</option>\`).join(""));
    }
    async function api(url, opt = {}) {
      let r;
      try { r = await fetch(url, { headers:{ "Content-Type":"application/json" }, credentials:"same-origin", ...opt }); }
      catch { throw { erro:"Sem conexão com a API. mobilis.droppfy.com está só com a página. Publique o server.mjs no mesmo domínio." }; }
      const tipo = r.headers.get("content-type") || "";
      if (tipo.includes("pdf") || tipo.includes("csv")) return r;
      const data = await r.json().catch(() => null);
      if (!r.ok) throw data || { erro:\`A API respondeu \${r.status}. O HTML foi publicado sem o servidor Node.\` };
      return data;
    }
    function aviso(msg) {
      const bar = $("#statusBar");
      bar.textContent = msg;
      bar.classList.remove("hidden");
    }
    async function boot() {
      preencherUfs();
      try {
        await api("/api/meta");
        apiOk = true;
        me = (await api("/api/me")).user;
        $("#abaAdmin").classList.toggle("hidden", !me || me.role !== "admin");
        carregarPublico();
      } catch (e) {
        aviso(e.erro || "Servidor de cadastro indisponível. A página abriu, mas /api/meta não existe neste domínio.");
      }
    }
    async function carregarPublico() {
      const t = await api("/api/publico");
      $("#totais").innerHTML = [["Cadastrados",t.cadastrados],["Conferidos",t.conferidos],["Assinaturas",t.assinaturas],["Votos",t.votos]]
        .map(([k,v]) => \`<div class="card"><strong style="font-size:1.6rem;color:var(--primary)">\${v}</strong><br>\${k}</div>\`).join("");
    }
    $("#uf").onchange = buscarMun;
    $("#municipio").oninput = buscarMun;
    async function buscarMun() {
      if (!apiOk || !$("#uf").value) return;
      const lista = await api("/api/municipios?uf=" + $("#uf").value + "&q=" + encodeURIComponent($("#municipio").value));
      $("#listaMun").innerHTML = lista.map(m => \`<option value="\${m.nome}"></option>\`).join("");
    }
    function validarAntes() {
      const erros = [];
      if ($("#nome").value.trim().split(" ").length < 2) erros.push("Informe nome e sobrenome.");
      if ($("#senha").value.length < 8) erros.push("Senha mínima de 8 caracteres.");
      if ($("#cpf").value.replace(/\\D/g,"").length !== 11) erros.push("CPF precisa ter 11 dígitos.");
      if ($("#whatsapp").value.replace(/\\D/g,"").length !== 11) erros.push("WhatsApp precisa ter DDD + 9 dígitos.");
      if ($("#titulo").value.replace(/\\D/g,"").length !== 12) erros.push("Título precisa ter 12 dígitos.");
      if (!$("#uf").value) erros.push("Selecione a UF. Sem isso o município não confere.");
      if (!$("#municipio").value.trim()) erros.push("Informe o município oficial.");
      if (!$("#termo").checked) erros.push("Marque a declaração de veracidade.");
      return erros;
    }
    $("#btnCadastro").onclick = async () => {
      const locais = validarAntes();
      if (locais.length) { $("#cadastroMsg").innerHTML = \`<p class="erro">\${locais.join("<br>")}</p>\`; return; }
      if (!apiOk) { $("#cadastroMsg").innerHTML = \`<p class="erro">Cadastro não enviado: a API não está no ar em mobilis.droppfy.com. Subir só o HTML não grava ninguém.</p>\`; return; }
      $("#cadastroMsg").textContent = "Enviando...";
      try {
        const body = ["nome","email","senha","cpf","whatsapp","nascimento","titulo","zona","secao","uf","municipio","emissao"].reduce((o,k) => (o[k] = $("#"+k).value, o), { termo:$("#termo").checked });
        const r = await api("/api/cadastro", { method:"POST", body:JSON.stringify(body) });
        $("#cadastroMsg").innerHTML = \`<p class="ok">\${r.mensagem} Protocolo \${r.id}.</p>\`;
      } catch (e) {
        $("#cadastroMsg").innerHTML = \`<p class="erro">\${(e.erros || [e.erro || "Falha ao gravar"]).join("<br>")}</p>\`;
      }
    };
    $("#btnLogin").onclick = async () => {
      try {
        const r = await api("/api/login", { method:"POST", body:JSON.stringify({ email:$("#loginEmail").value, senha:$("#loginSenha").value }) });
        me = r.user; apiOk = true;
        $("#abaAdmin").classList.toggle("hidden", me.role !== "admin");
        $("#loginMsg").innerHTML = \`<p class="ok">Entrou como \${me.role}.</p>\`;
        aba(me.role === "admin" ? "admin" : "painel");
      } catch (e) { $("#loginMsg").innerHTML = \`<p class="erro">\${e.erro || "Falha no login"}</p>\`; }
    };
    function pintarPainel() {
      const el = $("#painelConteudo");
      if (!me) { el.innerHTML = "<h2>Meu painel</h2><p>Entre na aba Entrar.</p>"; return; }
      if (me.role === "admin") { el.innerHTML = "<h2>Meu painel</h2><p>Conta admin. Use a aba Admin.</p>"; return; }
      el.innerHTML = \`<h2 style="color:var(--primary)">Meu painel</h2><p><strong>\${me.nome}</strong> — \${me.municipio}/\${me.uf} — \${me.status}</p><p>\${me.motivo || ""}</p><p><button class="btn primario" id="btnAssinar">Assinar manifesto</button> <a class="btn azul" href="/api/comprovante.pdf">Comprovante</a></p><form id="formVoto"><h3>Votação</h3><label>Prioridade</label><select name="prioridade"><option>Ônibus e BRT</option><option>Integração tarifária</option><option>Calçadas e acessibilidade</option><option>Ciclovias e segurança viária</option></select><label>Pagamento por km</label><select name="pagamento_km"><option>Sim</option><option>Não</option><option>Abstenção</option></select><label>IA com base legal</label><select name="ia_visao"><option>Sim</option><option>Não</option><option>Abstenção</option></select><p><button class="btn primario">Registrar voto</button></p></form><p><button class="btn" id="btnSair">Sair</button></p><div id="painelMsg"></div>\`;
      $("#btnSair").onclick = sair;
      $("#btnAssinar").onclick = async () => {
        try { await api("/api/assinar", { method:"POST", body:JSON.stringify({ termo:true }) }); $("#painelMsg").innerHTML = "<p class='ok'>Assinatura registrada.</p>"; }
        catch (e) { $("#painelMsg").innerHTML = \`<p class="erro">\${e.erro}</p>\`; }
      };
      $("#formVoto").onsubmit = async (ev) => {
        ev.preventDefault();
        try { await api("/api/votar", { method:"POST", body:JSON.stringify({ respostas:Object.fromEntries(new FormData(ev.target).entries()) }) }); $("#painelMsg").innerHTML = "<p class='ok'>Voto registrado.</p>"; }
        catch (e) { $("#painelMsg").innerHTML = \`<p class="erro">\${e.erro}</p>\`; }
      };
    }
    async function sair() { await api("/api/logout", { method:"POST", body:"{}" }); me = null; $("#abaAdmin").classList.add("hidden"); aba("entrar"); }
    async function carregarAdmin() {
      if (!me || me.role !== "admin") { $("#adminResumo").innerHTML = "<p class='erro'>Somente admin.</p>"; return; }
      const q = encodeURIComponent($("#filtroQ").value || "");
      const [painel, usuarios] = await Promise.all([api("/api/admin/painel"), api(\`/api/admin/usuarios?q=\${q}&uf=\${$("#filtroUf").value}&status=\${$("#filtroStatus").value}\`)]);
      $("#adminResumo").innerHTML = \`<p>Brasil: \${painel.totais.cadastrados} cadastros, \${painel.totais.conferidos} conferidos, \${painel.totais.assinaturas} assinaturas, \${painel.totais.votos} votos.</p>\`;
      $("#tabela").innerHTML = "<tr><th>Nome</th><th>Docs</th><th>Local</th><th>Status</th><th>Ações</th></tr>" + usuarios.map(u => \`<tr><td>\${u.nome}<br><small>\${u.email}</small></td><td>CPF \${u.cpf}<br>Título \${u.titulo}</td><td>\${u.municipio}/\${u.uf}</td><td>\${u.status}<br><small>\${u.motivo||""}</small></td><td class="acoes"><button data-id="\${u.id}" data-acao="conferir">Conferir</button><button data-id="\${u.id}" data-acao="rejeitar">Rejeitar</button><button data-id="\${u.id}" data-acao="excluir">Excluir</button><button data-id="\${u.id}" data-acao="restaurar">Restaurar</button><button data-id="\${u.id}" data-acao="deletar">Deletar</button></td></tr>\`).join("");
      $("#tabela").querySelectorAll("button").forEach(b => b.onclick = acaoAdmin);
      $("#auditoria").innerHTML = painel.auditoria.map(a => \`<div><small>\${a.em} · \${a.acao} · \${a.detalhe||""}</small></div>\`).join("");
    }
    async function acaoAdmin(ev) {
      const { id, acao } = ev.target.dataset;
      if (acao === "deletar") { if (!confirm("Deletar permanente?")) return; await api("/api/admin/usuarios/"+id, { method:"DELETE" }); }
      else await api("/api/admin/usuarios/"+id+"/"+acao, { method:"POST", body:JSON.stringify({ motivo: acao==="rejeitar"||acao==="excluir" ? (prompt("Motivo")||"") : "" }) });
      carregarAdmin();
    }
    $("#btnFiltrar").onclick = carregarAdmin;
    $("#btnPdfBrasil").onclick = () => location = "/api/admin/relatorio.pdf";
    $("#btnPdfUf").onclick = () => location = "/api/admin/relatorio.pdf?uf=" + $("#filtroUf").value;
    $("#btnCsv").onclick = () => location = "/api/admin/export.csv";
    boot();
  </script>
</body>
</html>
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(PAGINA, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/marca.svg") {
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#1a237e"/><circle cx="32" cy="32" r="18" fill="none" stroke="#ffd600" stroke-width="3"/></svg>', { headers: { "Content-Type": "image/svg+xml" } });
    }
    if (url.pathname.startsWith("/api/")) return onRequest({ request, env, ctx });
    return new Response("Nao encontrado", { status: 404 });
  }
};
