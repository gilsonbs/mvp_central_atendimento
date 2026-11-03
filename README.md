# WhatsApp Central · MVP 0.1

Backend de uma central de atendimento com fila e distribuição híbrida. Criado em Node.js, TypeScript e PostgreSQL. Esta é uma reconstrução do MVP descrito no planejamento, pois o ZIP original não estava disponível.

## O que funciona

- Login por e-mail e senha, tokens JWT de 8 horas e perfis de administrador e vendedor.
- Cadastro de usuários e clientes pelo administrador.
- Fila ordenada por prioridade (10 primeiro) e depois por antiguidade.
- Sugestão de vendedor disponível com menos atendimentos. Empates favorecem quem recebeu atendimento há mais tempo.
- Confirmação manual: vendedores assumem o primeiro cliente da fila; o administrador pode direcionar qualquer posição.
- Máximo de dois atendimentos ativos por vendedor, inclusive em atribuições e transferências administrativas.
- Finalização, transferência e histórico de movimentações.

Não inclui interface gráfica, mensagens, anexos, webhook nem conexão com a API do WhatsApp. `src/whatsapp.ts` define apenas o contrato da futura integração. Os clientes entram manualmente pela API administrativa nesta etapa.

## Executar localmente

Requisitos: Node.js 22 ou superior, npm e Docker com suporte a contêineres Linux.

1. Clone este repositório e entre na pasta.
2. Copie `.env.example` para `.env`.
3. Gere dois valores diferentes com o comando abaixo. Use um em `POSTGRES_PASSWORD` e outro em `JWT_SECRET`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

4. Configure `DATABASE_URL` no `.env` como `postgresql://central:SUA_SENHA_GERADA@127.0.0.1:5432/central`. Substitua `SUA_SENHA_GERADA` pelo valor de `POSTGRES_PASSWORD`. Para senhas com caracteres especiais, use codificação de URL.
5. Execute:

```sh
npm ci
docker compose up -d --wait
npm run db:migrate
```

6. Preencha `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` no `.env`. A senha deve ter entre 12 e 128 caracteres. Execute `npm run admin:create` e remova `ADMIN_PASSWORD` do arquivo em seguida.
7. Inicie com `npm run dev`. A API escuta em `http://127.0.0.1:3000`.

O comando de migração pode ser executado novamente sem recriar tabelas. O cadastro administrativo não substitui contas existentes. O volume do Docker preserva os dados; `docker compose down` para o banco sem apagá-los.

Para compilar e executar sem o observador de arquivos:

```sh
npm run build
npm start
```

## Fluxo de uso da API

Envie JSON e `Content-Type: application/json`. Faça `POST /auth/login` com `email` e `password`. Use o `token` retornado no cabeçalho `Authorization: Bearer SEU_TOKEN` nas demais rotas.

| Método e rota | Acesso | Corpo ou função |
| --- | --- | --- |
| `GET /health` | Público | Verifica conexão com o banco |
| `POST /auth/login` | Público | `{ "email": "...", "password": "..." }` |
| `GET /me` | Autenticado | Usuário atual |
| `POST /users` | Admin | `name`, `email`, `password`, `role` (`seller` ou `admin`) |
| `GET /users` | Admin | Usuários, sem hashes de senha |
| `PATCH /me/availability` | Vendedor | `{ "available": true }` |
| `POST /customers` | Admin | `name`, `phone` em formato internacional, como `+5511999999999` |
| `POST /queue` | Admin | `customerId`, `priority` opcional de 0 a 10 |
| `GET /queue` | Autenticado | Clientes aguardando, sem telefone |
| `GET /queue/suggestion` | Autenticado | Próximo cliente e vendedor sugerido; não reserva vaga |
| `GET /attendances` | Autenticado | Ativos próprios; admin vê todos |
| `POST /attendances/:id/claim` | Autenticado | `{}` para assumir; admin informa `sellerId` |
| `POST /attendances/:id/close` | Responsável ou admin | Finaliza e libera vaga |
| `POST /attendances/:id/transfer` | Admin | `sellerId` de destino |
| `GET /attendances/:id/events` | Admin | Histórico de movimentações |

Um vendedor novo começa indisponível e precisa ativar sua disponibilidade. Ficar indisponível bloqueia novas atribuições, mas preserva os atendimentos em andamento. Um cliente só pode ter um atendimento aberto; a entrada repetida retorna o existente. A prioridade não é alterada nessa repetição.

Erros usam `{ "error": "mensagem" }`. Dados inválidos retornam 400; autenticação, 401; acesso negado, 403; recurso ausente, 404; conflito de estado/vaga, 409. Após conflito, consulte novamente a fila e a sugestão antes de confirmar.

## Testes e segurança

```sh
npm run build
npm test
npm audit
```

`npm test` inicia um PostgreSQL descartável em porta local aleatória, executa os testes e remove apenas esse contêiner. Não usa o banco do `.env`. Na primeira execução pode baixar a imagem `postgres:17-alpine`.

A suíte verifica concorrência, disputa pelo mesmo cliente, transferências, liberação de vaga, prioridade, autorização e restrições no banco. As duas vagas são representadas por slots 1 e 2 com índice único por vendedor. As mutações do motor também usam uma trava transacional compartilhada entre instâncias. Essa serialização é simples para o MVP; deve ser reavaliada se o volume crescer.

Senhas usam scrypt com salt aleatório. JWTs são validados com algoritmo, emissor e destinatário fixos; o usuário é consultado a cada chamada. Não há senha administrativa padrão. `.env`, chaves privadas, dependências e arquivos compilados ficam fora do Git. `.env.example` contém campos vazios para os segredos.

Referências técnicas: [bloqueios transacionais no PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html) e [criptografia do Node.js](https://nodejs.org/api/crypto.html).

## Limites desta entrega

As listagens retornam até 200 registros e ainda não têm paginação. A disponibilidade é manual, sem detecção de desconexão. Não há recuperação de senha, revogação individual de JWT, edição/desativação de usuários pela API ou atualização em tempo real. O limite de tentativas de login fica na memória de cada instância.

Antes de operar com clientes reais, faltam interface, integração oficial do WhatsApp com validação e deduplicação de webhooks, HTTPS, recuperação de acesso, gestão de usuários, política de retenção e backups. Por padrão, API e banco escutam somente no computador local. Publicar o código no GitHub não coloca o serviço em produção.
