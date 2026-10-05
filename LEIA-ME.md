# KPI Mobilidade — análise e versão corrigida

Repositório analisado: https://github.com/gpartnerllc-png/kpimobilidade

Arquivos atuais: `CNAME` e `index.html`. Não há backend, banco, login, admin, votação nem PDF gerado.

## O que o código faz hoje

Página estática de manifesto. O botão abre um formulário com nome, CPF, WhatsApp, título, nascimento, zona, seção, município/UF livre e emissão. O envio vai para a API do Telegram com token e chat id escritos no HTML. Os PDFs são links fixos, um deles placeholder. O favicon é o do gov.br.

## Falhas que impedem o uso nacional

1. Token do bot está público no GitHub. Revogue no BotFather agora. Não recoloque segredo no frontend.
2. Telegram não é banco. Não dá para listar, excluir, auditar nem gerar PDF fiel.
3. Não existe login de cidadão nem de admin.
4. CPF só tem tamanho. Título só exige 12 caracteres, aceita letra. Município é texto livre.
5. Não há duplicidade, idade, DDD, conferência de UF do título nem status pendente/conferido/rejeitado.
6. Favicon do gov.br faz o site parecer órgão público. Isso é representação indevida. Marca oficial não se altera e também não se usa sem autorização.
7. PDF não nasce dos cadastros e não cobre as 27 UFs.
8. GitHub Pages não executa servidor. Sem hospedar o Node, o admin de outro computador não vê os dados.
9. Mensagem de erro fala em banco, mas não há banco.
10. LGPD: CPF e título em texto puro no Telegram, sem exclusão, sem base de consentimento operacional.

## O que esta versão já faz

- Aba Entrar única para cidadão e admin. O papel vem da conta.
- Cadastro recusado se CPF, título, DDD, idade, zona, seção, e-mail ou município falharem.
- Município só entra se o nome for o oficial do IBGE, sem abreviação inventada.
- Título: 12 dígitos, UF 01–27 e dígito verificador, com exceção de resto zero em SP e MG. A UF do título tem de ser a UF informada.
- Duplicidade de CPF, e-mail e título bloqueada.
- Admin: conferir, rejeitar, excluir, restaurar, deletar permanente, filtrar por UF e status, auditoria.
- Votação única por cadastro conferido.
- PDF nacional e PDF por UF para protocolo, mais CSV.
- Assinatura só conta depois da conferência humana.
- Marca própria. Sem brasão e sem favicon do governo.

## O que ainda não é e não pode ser prometido

- Não consulta a base do TSE nem a Receita. Ninguém fora desses órgãos confirma existência real do título ou do CPF por este site.
- Não é iniciativa popular formal. A Constituição exige 1% do eleitorado nacional, distribuído em pelo menos 5 estados, com não menos de 0,3% dos eleitores de cada um, em papel com assinatura e endereçamento ao Congresso, conferido pela Justiça Eleitoral.
- Zona e seção não têm base pública completa para cruzar com o município. O admin confere isso na revisão.
- JSON local serve para operar e protocolar um piloto. Para o Brasil inteiro em produção, troque por PostgreSQL, HTTPS, backup e política de retenção.

## Como rodar

```bash
cd kpimobilidade
node server.mjs
```

Abra http://localhost:3000

Admin inicial, troque antes de publicar:

- e-mail: admin@kpimobilidade.local
- senha: TrocarEstaSenha#2026

Ou defina `ADMIN_EMAIL` e `ADMIN_PASSWORD`.

Para o país inteiro, hospede este processo com HTTPS em VPS, Railway ou Render. Não publique só o HTML.

## Fluxo para levar às autoridades

1. Cidadão cadastra. Sistema recusa dado malformado.
2. Admin confere pendentes e só marca conferido se nome, título, zona, seção e município baterem com o documento apresentado.
3. Cidadão conferido assina e vota uma vez.
4. Admin baixa PDF Brasil ou PDF da UF e CSV.
5. Protocolo leva o PDF como abaixo-assinado cidadão, com o aviso de que não é certidão do TSE.
