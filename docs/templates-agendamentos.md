# Comunicações: modelos, lotes e convites de vencimento

## Onde operar

CFI → Configurações do Admin → Templates e agendamentos. Os atalhos dos outros apps abrem o mesmo painel, no departamento escolhido. A administração continua sendo validada pelo serviço central; abrir o atalho não concede permissão.

## Enviar para a base de clientes

1. Escolha o departamento e cadastre ou selecione um modelo ativo.
2. Em **Agendamento em lote**, carregue empresas e contatos cadastrados, importe Excel/CSV ou cole e-mails separados por vírgula, ponto e vírgula ou linha.
3. Planilha: colunas `empresa`, `cnpj`, `contato`, `email` (ou `telefone` para WhatsApp). É possível informar vários e-mails na célula. Telefones devem conter código do país e dígitos.
4. Filtre a carteira e clique **Selecionar somente visíveis**, ou marque individualmente. Corrija os destinatários inválidos. Há limite de 400 contatos por lote.
5. Opcionalmente salve os contatos selecionados na base de comunicação para reutilizar. Isso não modifica o cadastro fiscal.
6. Escolha data/hora de Brasília e repetição. Recorrência exige fim, limitado a um ano. Valores de competência e outras variáveis permanecem fixos nas repetições; use mensagem apropriada.
7. Clique **Conferir mensagens do lote**. Revise cada destinatário e texto. Cliente, empresa, CNPJ e contato vêm de cada linha; as outras variáveis são comuns ao lote.
8. **Salvar lote pausado**. Somente depois clique **Ativar lote** e confirme. Os envios são processados gradualmente a partir do horário marcado, não todos no mesmo segundo.
9. Acompanhe cada destinatário no histórico. Aceitação pelo provedor não confirma leitura nem entrega na caixa de entrada.

Não é necessário substituir e-mails manualmente. Um destinatário continua correspondendo a um agendamento individual; o lote cria esses registros em uma única operação. E-mails iguais da mesma empresa são unificados; contatos compartilhados por empresas distintas recebem mensagens separadas.

Lotes sem ocorrências iniciadas podem ser pausados ou cancelados em conjunto. Se houver ocorrências em execução/encerradas, confira e trate os agendamentos individualmente. Alterar um modelo invalida a revisão anterior. Horário passado exige nova agenda.

WhatsApp mantém templates UTILITY aprovados e as regras existentes de fila, canal e bloqueio. Agendamentos atuais são mensagens sem anexos; a tela não deve ser usada para simular envio de documentos.

## Convite de vencimento no e-mail

O provedor inclui `vencimentos-sp.ics` junto ao documento quando há vencimento informado no envio ou imediatamente identificado como “Vencimento” no texto legível de um PDF. O assunto vira o título do evento. Emissão e competência não são usadas como vencimento.

O evento ocupa a data do vencimento e tem lembrete na véspera às 9h no fuso da agenda do destinatário. O cliente abre/adiciona o arquivo à agenda; não se cria reunião nem se grava automaticamente no calendário dele. O comportamento do alarme depende do aplicativo de calendário.

PDF digitalizado sem texto, arquivos protegidos e datas não identificadas precisam de conferência e informação da data no envio. Não há OCR universal nesta implementação. Relatórios sem vencimento continuam sem convite. O documento original é preservado.

## Administração e rastreabilidade

API `/api/admin/comunicacao` com controle administrativo. Coleções: `comunicacao_modelos`, `comunicacao_modelos_revisoes`, `comunicacao_agendas`, `comunicacao_agendas_historico`, `comunicacao_execucoes`, `comunicacao_lotes`, `comunicacao_contatos`. Nenhum acesso direto ao Firestore é liberado.

O executor reserva a ocorrência em transação, reconfere autorização e revisão e não repete automaticamente resultado incerto. Não reative um envio incerto sem conferir o provedor. O tick existente processa até 25 ocorrências a cada execução; acompanhe fila e heartbeat.

Validação desta alteração: testes com provedor simulado, sem enviar mensagens reais nem ativar campanhas de clientes. Estado de publicação deve ser conferido na versão/esteira da entrega.

## WhatsApp — documentos no SP Connect

Informe opcionalmente o vencimento acima da mensagem e anexe o documento. Quando há data informada ou identificada em PDF textual, a legenda recebe um link Google Agenda, seguindo o padrão do DP. O link respeita a data civil; o cliente confirma a inclusão e configura o lembrete. Não é enviada uma segunda mensagem. Legenda acima de 1.024 caracteres exige reduzir texto/documentos antes de enviar. A janela de 24h, fila e condução da conversa permanecem obrigatórias.

Padrão de formatos de mídia: https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/document/ . O .ics acompanha o e-mail; no WhatsApp usa-se link, sem presumir suporte a text/calendar.
