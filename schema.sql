CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  cpf TEXT,
  whatsapp TEXT,
  nascimento TEXT,
  titulo TEXT,
  titulo_uf TEXT,
  zona TEXT,
  secao TEXT,
  uf TEXT,
  municipio TEXT,
  municipio_ibge TEXT,
  emissao TEXT,
  status TEXT NOT NULL,
  motivo TEXT,
  validacoes TEXT,
  criado_em TEXT NOT NULL,
  excluido_em TEXT
);
CREATE TABLE IF NOT EXISTS signatures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  nome TEXT, cpf TEXT, uf TEXT, municipio TEXT,
  em TEXT NOT NULL, excluida INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  uf TEXT, municipio TEXT,
  respostas TEXT NOT NULL,
  em TEXT NOT NULL, excluido INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expira TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  em TEXT NOT NULL,
  ator TEXT, acao TEXT, alvo TEXT, detalhe TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_uf ON users(uf);
