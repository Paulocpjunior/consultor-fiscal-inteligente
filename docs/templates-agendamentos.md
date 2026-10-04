# Templates e agendamentos de comunicação

Implementação local em 04/10/2026. Ainda sem publicação ou envios reais.

## Uso

Acesso administrativo em CFI → Config Admin → Templates e agendamentos.
CCI, Financeiro, DP/Folha, Legalização e SP Connect ganham um atalho para essa administração central, em nova aba, com o departamento selecionado. O acesso exige uma conta com role admin no CFI; ser admin apenas de um sistema irmão não concede novas permissões automaticamente.

Criar, editar, duplicar, visualizar e desativar modelos por departamento. E-mails usam a casca visual existente (marca, logo inline, cabeçalho e rodapé), texto escapado e variáveis nomeadas. Templates WhatsApp reutilizam o cadastro e a submissão à Meta existentes no mesmo modal. Para esta agenda, são aceitos modelos UTILITY aprovados, sem anexos; campanhas de marketing permanecem no fluxo próprio.

Agendamento único, diário, semanal ou mensal, com horário explícito de Brasília. Um destinatário por registro. Recorrência exige data final, limitada a um ano. Dia 31 vira último dia de fevereiro, voltando ao dia original em março. Ocorrências perdidas não são disparadas em rajada. Os valores são fixados na criação: não existe resolução automática de competência, vencimento, pendência documental ou destinatários de uma carteira. Modelos existentes em outras telas não são migrados nem substituídos.

O registro nasce pausado. O admin confere destinatário, revisão e parâmetros e ativa o envio. Pode pausar ou cancelar antes da reserva. Para mudar datas/destinatário, cancela e cria outro; agendas com horário passado não são reativadas. Alteração da revisão do modelo interrompe agendas antigas para revisão, preservando a cópia e o histórico.

## Execução e rastreabilidade

Coleções novas: comunicacao_modelos, comunicacao_modelos_revisoes, comunicacao_agendas, comunicacao_agendas_historico e comunicacao_execucoes. Escrita/leitura somente pela API administrativa; regras existentes negam acesso direto a coleções não listadas. Catálogo de coleções atualizado.

Endpoint POST /api/admin/comunicacao/tick, protegido por segredo de cron ou requireAdmin. O job comunicacao-templates-tick está declarado em scripts/setup-cloud-schedulers.sh, a cada cinco minutos. Não foi criado ou executado na nuvem nesta entrega. Não depende do agendador do SP Connect, que possui processo próprio.

Reserva transacional de cada ocorrência antes de chamar o provedor; dois workers não enviam a mesma ocorrência. Nenhuma repetição automática após timeout/resultado incerto. Interrupção do processo pode deixar estado processando: exige conferência do provedor antes de criar outro agendamento. Não há recuperação automática desses casos.

Na execução são reconferidos o papel administrativo do criador, a revisão e a atividade do modelo, o bloqueio do destinatário WhatsApp, a fila da conversa, o canal e o template aprovado. E-mails saem da caixa do administrador criador, com o logo existente. Aceito significa aceitação pelo provedor, não entrega/leitura. WhatsApp registra também a mensagem na conversa; o protocolo fica no histórico da ocorrência.

## Validação realizada

- 9 testes do domínio e do executor, zero pulados, inclusive concorrência, timeout, mês curto, ano bissexto, expiração e modelo alterado. Repetidos com TZ=Pacific/Honolulu.
- Seis rotas, incluindo tick, recusam pedidos sem credencial com HTTP 401.
- CFI: typecheck, lint, lint:strict e build.
- Interface em navegador local com API/Firebase simulados: cadastro de modelo, prévia, agendamento pausado, departamento correto, desktop e celular sem transbordamento. Não houve comunicação com clientes.
- Financeiro: build. CCI: sintaxe dos 29 blocos de JavaScript embutidos.
- Legalização e SP Connect: lint e build; SP Connect também lint:strict.
- DP/Folha: build passou; tsc --noEmit falhou com erros em arquivos não alterados, como AccessLogsModal, tipos de folha/ponto, geminiService e dependências de functions. O atalho foi compilado pelo Vite, mas o gate geral de tipos permanece pendente.

## Publicação pendente

Revisar os patches de cada repositório, cumprir os gates e autorizações locais e publicar primeiro o backend/painel do CFI; depois os atalhos. Configurar o job exclusivo e verificar heartbeat. Homologar um destinatário controlado antes de ativar agendas de clientes. Esta entrega não realizou commits, push, PR, deploy, alterações de dados de clientes ou submissões de templates à Meta.
