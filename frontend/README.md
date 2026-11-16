# Frontend — MVP 0.2

Stack proposta: React, TypeScript e Vite. Esta pasta inicia o planejamento; ainda não contém uma aplicação executável.

## Critérios de aceite

- Validar build e testes do backend antes da integração.
- Login via POST /auth/login e identificação via GET /me.
- Administrador: cadastro de vendedores e clientes, fila, sugestão, atribuição, transferência e encerramento.
- Vendedor: disponibilidade, fila, assumir primeiro cliente e finalizar atendimento próprio.
- Preservar limite de dois atendimentos no servidor; tratar HTTP 409 e atualizar a fila.
- Proxy local para API em 127.0.0.1:3000; não expor segredos no frontend.
- Estados de carregamento, erro, sessão expirada e listas vazias.
- Atualização periódica da fila inicialmente; mensagens e WhatsApp ficam fora desta etapa.
- Testar permissões, concorrência e fluxos de ponta a ponta antes de mesclar na main.

Referência: README.md na raiz, contrato atual da API.
