# O que faz o mobilis.droppfy.com funcionar

O 404 e o 405 acontecem porque o domínio só tem o HTML. Cadastro, login, admin e PDF precisam de API e banco. O banco certo aqui é o D1, da Cloudflare, no mesmo projeto da página.

## No painel Cloudflare

1. Workers e Pages → D1 → Criar banco `kpimobilidade`.
2. Aba Console desse banco → colar e rodar o arquivo `schema.sql`.
3. Copiar o ID do banco e colocar em `wrangler.toml` no lugar de `COLE_O_ID_DO_D1_AQUI`.
4. No projeto Pages de `mobilis.droppfy.com`: Settings → Bindings → D1.
   - Nome da variável: `DB`
   - Banco: `kpimobilidade`
5. Settings → Variables:
   - `ADMIN_EMAIL` = o e-mail do admin
   - `ADMIN_PASSWORD` = uma senha forte, mínimo 8
6. Enviar o projeto inteiro, com as pastas `public` e `functions`. Não enviar só o `index.html`.
7. Root do Pages: a pasta do projeto. Diretório de saída: `public`.

Pelo terminal, se o Wrangler já estiver logado:

```bash
npx wrangler d1 execute kpimobilidade --remote --file=schema.sql
npx wrangler pages deploy public --project-name=mobilis
```

O binding `DB` ainda precisa existir no projeto Pages. Sem ele, a função sobe e responde que o banco não está ligado.

## Como saber que deu certo

Abrir `https://mobilis.droppfy.com/api/meta`. Tem de voltar JSON com as UFs, não 404. Aí o cadastro grava e o admin entra com o e-mail definido em `ADMIN_EMAIL`.
