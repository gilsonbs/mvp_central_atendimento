# Roadmap varejo

- 0.5: envio e recebimento de mídias.
- 0.5.1: captura mobile por QR temporário, vinculado ao atendimento, com revisão antes do envio; HTTPS e autorização obrigatórios.
- 0.5.2: catálogo reutilizável de fotos, nome, código de barras, fabricante, categoria e apresentação. Sem preço fixo ou estoque. Preço opcional informado pelo vendedor no momento do envio, preservado no histórico da mensagem.
- 0.5.3: orçamento com múltiplos produtos, quantidades, preços unitários informados no atendimento e total calculado. Revisão antes do envio.

Não armazenar preços como atributos do catálogo. Integração futura com ValidaFácil é possibilidade, não dependência.

## Continuidade comercial e confiabilidade

- 0.4.2: monitoramento da Evolution, distinguir conexão declarada de recebimento comprovado, alertas, diagnóstico e recuperação idempotente quando possível. Reconexão automática somente quando segura; logout/QR exige operador.
- 0.4.3: preferência pelo último vendedor por 24 horas corridas após encerramento. Respeitar disponibilidade, limite de dois atendimentos ativos e ordem da fila; sem reserva de vaga. Caso indisponível, fila normal com identificação do último vendedor e horário. Após 24 horas expira a preferência, não o histórico. Novo atendimento vinculado ao mesmo cliente; atribuição transacional.
- 0.4.4: WhatsApp Guardian: monitoramento em segundo plano a cada 30 segundos após cada consulta; registrar mudanças de estado sem dados de clientes. Etapa inicial somente observação, logs de processo; persistência, alertas e recuperação controlada em etapas posteriores. Sessão aberta não comprova recebimento; inatividade não autoriza reinício.
- 0.4.5: histórico de conversas anteriores acessível ao vendedor autorizado no atendimento atual; motivo de encerramento e observação. Motivos: venda concluída, orçamento enviado, dúvida esclarecida, produto indisponível, sem resposta, venda não realizada, outros. Orçamento pendente não ocupa vaga.
- 0.5.4: histórico de preços por cliente, produto, quantidade, valor unitário, data, vendedor e orçamento. Preservar versões enviadas, sem sobrescrever preços históricos; indicar validade e condições quando informadas. Registrar vendedor de origem e de fechamento separadamente. Não presumir comissão nem preço vigente.
- 0.6: gestão avançada.
- 0.7: IA.
- 0.8: dashboard gerencial.
- 0.9: segurança e produção.
- 1.0: versão comercial.

## Critérios de aceite

Retorno em duas horas com vendedor disponível e fila elegível; retorno com vendedor lotado ou offline; retorno após 24 horas; mensagens duplicadas e concorrentes; liberação de vaga ao finalizar orçamento; histórico acessível somente a perfis autorizados; preço anterior preservado após novo orçamento. Definir retenção, auditoria e minimização de dados conforme LGPD antes da produção.

A preferência não autoriza ultrapassar a fila; detalhes de disponibilidade e distribuição automática devem ser validados na implementação. Nenhuma mudança de produção nesta etapa.
