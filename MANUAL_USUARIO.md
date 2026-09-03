# Manual do Usuario — Consultor Fiscal Inteligente

> Versao: Setembro 2026 | SP Assessoria Contabil

---

## Acesso ao Sistema

**URL:** Acesse pelo navegador o endereco fornecido pela administracao (aplicacao web hospedada no Google Cloud Run; o Firebase e usado para login, banco de dados e arquivos).

**Login:**
1. Abra o sistema no navegador.
2. Informe seu e-mail corporativo (`@spassessoriacontabil.com.br`) e a senha cadastrada.
3. Clique em **Entrar**. Caso seja primeiro acesso, solicite o cadastro ao administrador.

**Perfis de acesso:**

| Perfil | Permissoes |
|---|---|
| **Admin** | Acesso total: todos os modulos, gestao de usuarios, carteira de clientes, consulta situacao fiscal (SERPRO), logs de acesso, agentes A3 |
| **Colaborador** | Acesso aos modulos operacionais. Nao visualiza Consulta Situacao Fiscal, Carteira de Clientes nem Agentes A3. Ve apenas as empresas da sua carteira (quando configurada) |

---

## Modulos do Sistema

### 1. Dashboard CEO

**O que faz:** Visao executiva unificada com KPIs de toda a carteira (Caixa Postal, DAS, NFS-e, apuracoes) e recomendacoes geradas por IA.

**Como usar:**
1. Clique no botao **Dashboard CEO** na barra de modulos.
2. O painel carrega automaticamente os KPIs consolidados de todas as empresas.
3. Revise os cards de indicadores (guias pendentes, mensagens criticas, faturamento).
4. Clique em **✨ Gerar** (bloco de insights) para obter recomendacoes automaticas.
5. Use os links rapidos para navegar direto ao modulo que precisa de atencao.

**Dicas:** Acesse diariamente como primeiro passo para priorizar demandas. Os alertas de urgencia indicam acoes que vencem nos proximos dias.

---

### 2. Simples Nacional

**O que faz:** Gestao completa de empresas do Simples Nacional — cadastro, calculo de DAS, Fator R, controle de notas e RBT12.

**Como usar:**
1. Clique em **Simples Nacional** na barra de modulos.
2. No dashboard, veja o resumo de todas as empresas (faturamento, anexo, aliquota efetiva).
3. Clique em uma empresa para acessar o **detalhe**: lancamento de notas, calculo de DAS, historico.
4. Para cadastrar nova empresa, clique no botao **+ Nova Empresa** e preencha CNPJ, razao social, anexo e atividades.
5. Na tela de detalhe, lance as notas do mes e o sistema calcula automaticamente o DAS com base no RBT12.

**Dicas:** Mantenha as notas lancadas em dia para que o calculo do Fator R e da aliquota efetiva estejam corretos. Use a visao **Cliente** para compartilhar resumos simplificados com o empresario.

---

### 3. Lucro Presumido / Real

**O que faz:** Ficha financeira e cadastro de empresas tributadas pelo Lucro Presumido ou Lucro Real, com calculo de IRPJ, CSLL, PIS e COFINS.

**Como usar:**
1. Clique em **Lucro Presumido/Real** na barra de modulos.
2. Cadastre a empresa informando CNPJ, regime (Presumido ou Real), atividades e aliquotas.
3. Na ficha financeira, lance o faturamento mensal por categoria (comercio, industria, servico, locacao, hospitalar).
4. O sistema calcula automaticamente os tributos do periodo (trimestral ou mensal conforme o regime).
5. Exporte o resumo em PDF ou utilize os valores para emissao de DARF.

**Dicas:** Preencha os **Dados Fiscais** (UF, codigo IBGE, IE) no header da empresa — sao obrigatorios para geracao de SPED e outras obrigacoes. Use a correlacao de CFOP para validar as operacoes lancadas.

---

### 4. Central de Documentos Fiscais

**O que faz:** Importacao, armazenamento e analise de XMLs de NF-e/NFC-e/CT-e e PDFs de NFS-e, com captura automatica via SEFAZ e integracao SharePoint.

**Como usar:**
1. Clique em **Importa XML/PDF** na barra de modulos (segundo bloco, abaixo da grid principal).
2. Use a aba **Dashboard** para ver o resumo geral (total de documentos, entradas x saidas, por empresa).
3. No grupo **📥 Importar**, sub-aba **📥 Manual & Cofre (saída 55)**, arraste XMLs ou clique para selecionar arquivos. Para NFS-e em PDF, use a sub-aba **NFSe (PDF)**.
4. Configure empresas na aba **Empresas Monitoradas** para captura automatica via certificado digital.
5. Na aba **SharePoint**, configure a sincronizacao automatica com pastas do SharePoint da sua organizacao.

**Dicas:** Use a aba **Relatorios** para gerar resumos por periodo e a sub-aba **📤 Exportar SAGE (IOB)** (grupo 🔗 Integracoes) para integrar com o sistema contabil. Verifique a aba **Erros & Logs** periodicamente para identificar XMLs com problema.

---

### 5. SPED Fiscal

**O que faz:** Geracao do arquivo SPED Fiscal (EFD ICMS/IPI) a partir dos XMLs capturados, conforme Leiaute 020 (vigente 01/01/2026).

**Como usar:**
1. Clique em **SPED Fiscal** na barra de modulos (segundo bloco).
2. Selecione a empresa e o periodo de apuracao (mes/ano).
3. O sistema monta automaticamente os blocos (0, C, D, E, G, H, K, 1 e 9) com base nos XMLs importados — H (inventario) e K (producao/estoque) so saem com os apontamentos cadastrados nas abas 🏭 CIAP / 🏭 Bloco K, e o registro 1900 (EFD-Contribuicoes consolidado) so com os codigos do cadastro; sem o dado, o bloco sai vazio e o gerador AVISA, nunca inventa.
4. Revise o resumo de registros e clique em **Gerar Arquivo** para baixar o TXT.
5. Use a aba **Analise e Conferencia** para validar o conteudo antes de transmitir.

**Dicas:** Os **Dados Fiscais** da empresa (UF, IBGE, IE) devem estar preenchidos — caso contrario, o sistema exibira o alerta "Dados Fiscais incompletos". Importe todos os XMLs do periodo antes de gerar o arquivo.

---

### 6. Consulta Situacao Fiscal (somente Admin)

**O que faz:** Consulta completa de compliance tributario — debitos, certidoes, obrigacoes, parcelamentos, acoes judiciais e plano de acao, com analise via IA.

**Como usar:**
1. Este modulo aparece apenas para usuarios **Admin** (icone com cadeado).
2. Clique em **Consulta Situacao Fiscal** na barra de modulos.
3. Selecione a empresa ou informe o CNPJ para consulta prospect.
4. Navegue pelas abas: Dashboard, Debitos, Obrigacoes, Certidoes, Parcelamentos, Acoes Judiciais, Plano de Acao, Analise.
5. Na aba **Analise**, a IA gera um perfil tributario completo com recomendacoes.

**Dicas:** Utilize este modulo para onboarding de novos clientes — a visao consolidada permite identificar rapidamente riscos e pendencias. O plano de acao gerado pode ser exportado e compartilhado com o cliente.

---

### 7. DCTFWeb

**O que faz:** Gestao da DCTFWeb (Declaracao de Debitos e Creditos Tributarios Federais Previdenciarios) para empresas do Lucro Presumido e Real.

**Como usar:**
1. Clique em **DCTFWeb** na barra de modulos.
2. Veja o resumo geral: declaracoes pendentes, transmitidas, por categoria.
3. Clique em **Sincronizar** para buscar as declaracoes atualizadas da empresa.
4. Para cada declaracao, voce pode **Transmitir** (enviar ao e-CAC) ou **Gerar DARF** (emitir a guia de pagamento).
5. Use o **MIT Apuracao** para detalhar valores por rubrica.

**Dicas:** Sincronize as declaracoes no inicio de cada mes para manter o painel atualizado. Fique atento as declaracoes com situacao "Em atraso".

---

### 8. DAS (Simples Nacional)

**O que faz:** Central de DAS — consulta de guias emitidas, controle de pagamento e emissao de DAS avulso.

**Como usar:**
1. Clique em **DAS Simples Nacional** na barra de modulos.
2. Veja o resumo consolidado: total emitido, pago, pendente, em atraso.
3. Filtre por empresa ou status de pagamento.
4. Para marcar como pago, clique no DAS e selecione **Marcar como Pago**.
5. Para emissao avulsa (fora do PGDAS-D), clique em **Emitir DAS Avulso**, selecione a empresa, competencia e valor.

**Dicas:** Acompanhe os DAS pendentes diariamente para evitar multas. Use o filtro "Em atraso" para priorizar regularizacoes.

---

### 9. Central de Emissoes (DARF)

**O que faz:** Emissao unificada de guias DAS (Simples) e DARF (IRPJ, CSLL, PIS, COFINS para Presumido e Real) com controle de pagamento.

**Como usar:**
1. Clique em **Central de Emissoes** na barra de modulos.
2. Veja o resumo consolidado de todas as guias (DAS + DARF).
3. Para emitir um DARF, selecione a empresa, o tributo, a competencia e o valor calculado.
4. Copie o codigo de barras ou exporte a guia.
5. Marque como pago apos a confirmacao bancaria.

**Dicas:** Os valores de DARF podem ser pre-calculados automaticamente a partir da ficha financeira do Lucro Presumido/Real — mantenha os lancamentos em dia.

---

### 10. Caixa Postal (e-CAC)

**O que faz:** Exibe as mensagens da Caixa Postal do e-CAC por empresa — intimacoes, malha fiscal, comunicados e avisos da Receita Federal.

**Como usar:**
1. Clique em **Caixa Postal** na barra de modulos.
2. Veja o resumo: total de mensagens, nao lidas, criticas.
3. Use os filtros por categoria (intimacao, malha fiscal, comunicado) e o toggle **Apenas nao lidas**.
4. Clique em uma mensagem para ler o conteudo completo.
5. Clique em **Sincronizar Todas** para buscar mensagens novas de todas as empresas.

**Dicas:** Mensagens criticas (intimacoes e malha fiscal) disparam alertas automaticos no topo do sistema — nao as ignore. O sistema classifica automaticamente por gravidade.

---

### 11. NFS-e Nacional

**O que faz:** Gestao de Notas Fiscais de Servico eletronicas no padrao nacional (CGSN 189/2026), obrigatorio a partir de setembro/2026.

**Como usar:**
1. Clique em **NFS-e Nacional** na barra de modulos.
2. Veja o resumo: notas emitidas, canceladas, valor total.
3. Filtre por empresa ou status (emitida, cancelada, rejeitada).
4. Para cancelar uma nota, selecione-a e clique em **Cancelar NFS-e**.
5. Baixe o DANFSe (PDF) clicando no icone de download.

**Dicas:** A emissao de novas NFS-e e feita dentro da tela de detalhe de cada empresa no modulo Simples Nacional. Aqui voce gerencia e acompanha todas as notas ja emitidas.

---

### 12. Calendario Fiscal

**O que faz:** Calendario mensal com todos os vencimentos de obrigacoes fiscais das empresas (DAS, DARF, DCTF, eSocial, EFD, etc).

**Como usar:**
1. Clique em **Calendario Fiscal** na barra de modulos.
2. Selecione o mes e ano desejados.
3. Filtre por tipo de obrigacao se necessario.
4. Veja as obrigacoes organizadas por data de vencimento, com destaque para as que estao proximas ou vencidas.

**Dicas:** Consulte o calendario no inicio de cada semana para planejar suas entregas. Obrigacoes com menos de 3 dias para o vencimento aparecem destacadas em vermelho.

---

### 13. Tarefas

**O que faz:** Gestao de tarefas e prazos das obrigacoes acessorias (DAS, DCTFWeb, FGTS, SPED) por empresa, com atribuicao a colaboradores.

**Como usar:**
1. Clique em **Tarefas** na barra de modulos.
2. Veja a lista de tarefas pendentes, organizadas por status e prazo.
3. Crie tarefas manuais clicando em **Nova Tarefa** (informe empresa, tipo, prazo, responsavel).
4. Marque tarefas como concluidas ou altere o status (pendente, em andamento, concluida).
5. Reatribua tarefas a outros colaboradores conforme necessario.

**Dicas:** Tarefas geradas automaticamente pelo sistema (ex: DAS pendente) aparecem com o tipo da obrigacao pre-preenchido. Use os filtros por empresa e colaborador para organizar a demanda da equipe.

---

### 14. Carteira de Clientes (somente Admin)

**O que faz:** Atribuicao de empresas a colaboradores responsaveis, definindo quem cuida de cada cliente.

**Como usar:**
1. Este modulo esta disponivel apenas para **Admin**.
2. Clique em **Carteira de Clientes** na barra de modulos.
3. Veja a lista de todas as empresas cadastradas e os colaboradores disponiveis.
4. Clique em **Atribuir** para vincular uma empresa a um colaborador (com papel: responsavel, auxiliar, etc).
5. Para remover um vinculo, clique em **Remover** ao lado da atribuicao.

**Dicas:** Mantenha a carteira atualizada — os colaboradores so visualizam as empresas atribuidas a eles. Use esta tela para redistribuir a carga quando houver mudancas na equipe.

---

### 15. Recuperacao Tributaria

**O que faz:** Identifica impostos pagos a maior e oportunidades de restituicao ou compensacao, com parecer gerado por IA.

**Como usar:**
1. Clique em **Recuperacao Tributaria** na barra de modulos.
2. O sistema analisa automaticamente as teses aplicaveis a cada empresa.
3. Clique em **Analisar Todas** para rodar a verificacao em lote.
4. Expanda cada tese para ver o detalhamento (base legal, valor estimado, risco).
5. Clique em **Gerar Parecer IA** para obter uma analise fundamentada com sugestao de acao.

**Dicas:** As teses com maior potencial de recuperacao aparecem primeiro. Utilize o parecer da IA como ponto de partida, sempre validando com a legislacao vigente.

---

### 16. Simulador Reforma Tributaria (IBS/CBS)

**O que faz:** Projeta a carga tributaria de 2026 a 2033 sob a Reforma Tributaria (LC 214/2025), comparando o cenario atual com o novo modelo IBS/CBS.

**Como usar:**
1. Clique em **Simulador IBS/CBS** na barra de modulos.
2. Informe o faturamento anual, o regime tributario atual e (opcionalmente) o nome da empresa.
3. Clique em **Simular** para ver a projecao ano a ano.
4. Clique em **Explicar com IA** para obter uma analise detalhada do impacto.

**Dicas:** Utilize este simulador para conversas estrategicas com clientes sobre planejamento tributario. A projecao considera a transicao gradual prevista na legislacao.

---

### 17. Analise de Credito PIS/COFINS

**O que faz:** Analise de creditos PIS/COFINS com conciliacao bancaria e mapeamento por categoria fiscal, incluindo tabela de aliquotas ICMS por UF.

**Como usar:**
1. Clique em **Analise de Creditos** na barra de modulos.
2. Selecione a empresa e informe o regime (Lucro Real Industria, Servicos, Comercio, Presumido ou Simples).
3. Lance as notas ou importe o extrato bancario para conciliacao.
4. O sistema calcula automaticamente os creditos aproveitaveis com base no regime e tipo de nota (produto ou servico).
5. Revise o resultado: Aprovado, Parcial, Negado ou Revisar.

**Dicas:** As aliquotas internas de ICMS por UF (2026) sao carregadas automaticamente, mas devem ser revisadas — alguns estados possuem excecoes por NCM. Sempre valide os creditos com a legislacao especifica.

---

### 18. Anomalias DAS

**O que faz:** Detector de anomalias estatisticas no DAS — identifica irregularidades como valores fora do padrao, picos inesperados e inconsistencias por empresa.

**Como usar:**
1. Clique em **Detector de Anomalias** na barra de modulos.
2. O sistema carrega automaticamente as anomalias detectadas em todas as empresas.
3. Filtre por severidade (alta, media) para priorizar.
4. Clique em uma empresa para ver as anomalias detalhadas.
5. Clique em **Explicar com IA** para obter uma analise da causa provavel e sugestao de acao.

**Dicas:** Anomalias de severidade alta podem indicar erro de calculo ou lancamento incorreto — investigue antes do vencimento do DAS.

---

### 19. Consultas Fiscais (CFOP, NCM, Servico)

**O que faz:** Consulta inteligente via IA sobre codigos CFOP, classificacao NCM e analise de servicos (ISS, retencoes, local de incidencia).

**Como usar:**
1. Na barra de modulos, selecione **CFOP**, **NCM** ou **Servico** conforme o tipo de consulta.
2. Digite o codigo ou a descricao da sua duvida no campo de busca.
3. (Opcional) Preencha o contexto adicional: aliquotas de ICMS, PIS/COFINS, ISS, municipio, regime.
4. Clique em **Consultar IA** para obter a analise completa.
5. Use o modo **Comparar Topicos** para analisar dois codigos ou situacoes lado a lado.

**Dicas:** Quanto mais contexto voce fornecer (municipio, regime, notas da operacao), mais precisa sera a resposta da IA. As fontes e fundamentacao legal aparecem abaixo da resposta para conferencia.

---

## Modulos ainda sem capitulo neste manual

Os cards abaixo existem na barra de modulos (o nome e o que aparece no card) e
ainda nao tem passo a passo aqui. A linha diz so ONDE fica; o comportamento
esta descrito nas 📣 Novidades e nos guias em `/guia-*.html`.

| Card | Onde fica |
|---|---|
| **Rotina do Mes** | 1º card do menu — as 5 etapas do mes por cliente, com o botao "Dar fim de mes" |
| **Reforma Tributaria** (consulta) | barra de consultas, ao lado de CFOP/NCM/Servico — pergunta a IA sobre IBS/CBS |
| **Obrigacoes & Tarefas** | hub com as sub-abas ⏰ Proximos Vencimentos · 🏢 Por Empresa · 📋 Tarefas (Kanban) · 📅 Calendario (o capitulo "Tarefas" acima cobre so o Kanban) |
| **Analise Relatorio SAGE** | card proprio — le o relatorio exportado do e-Fiscal |
| **Regime Tributario** (analisador) | card proprio |
| **NFTS Sao Paulo** | card proprio — declaracao de servicos TOMADOS de fora de SP |
| **EFD-Reinf × DCTFWeb** | sub-abas do card DCTFWeb: 🔀 EFD-Reinf × DCTFWeb · 🧰 R-2010 servicos tomados · 🧾 Fechamento EFD-Reinf |
| **Cobertura ADN (NFS-e Nac.)**, **Cobertura PGDAS-D**, **Cobertura DCTFWeb** | atalhos que abrem a aba de cobertura do hub correspondente (NFS-e Nacional, DAS, DCTFWeb) |
| **Radar fiscal (e-CAC)** | atalho para a aba de radar do card Caixa Postal |
| **Minha Agenda Fiscal**, **Vencimentos da Semana** | cards de prazos derivados do cadastro/regime — abrem o hub Obrigacoes & Tarefas no recorte certo |
| **Prazos de Prescricao** | abre o hub Recuperacao Tributaria na aba de prazos |
| **Diagnostico Docs Fiscais**, **Cadastros Incompletos**, **Certificados Digitais**, **Configuracoes Operacionais**, **Saude Geral** | sub-abas do hub Diagnostico & Saude (Cadastros Incompletos tambem tem card proprio, admin) |
| **Sublimite Simples** | abre o hub DAS Simples Nacional na aba do sublimite estadual |
| **Agentes A3** (admin) | card proprio — status do agente local `cfi-a3` que captura por certificado A3 |
| **GIA-ST** | card proprio — guia do ICMS-ST a partir do Livro de ICMS Substituto |
| **Relatorios** | card proprio (grupo Gestao) — livros, resumos por CFOP/UF/produto/participante, retencoes, ✏️ CFOP por nota; tudo em PDF com identidade SP |
| **Central de XMLs → sub-abas novas** | 🌾 DIPAM / Produtor rural · 🧭 DIFAL aquisicao · 🏷️ Cadastro NCM · 🏛️ ISS SP (guia) · 🔎 Prova de captura · ✅ O cliente fez certo? |
| **SPED Fiscal → sub-abas novas** | Ajustes E111 · 🏭 CIAP · 🏭 Bloco K · 🏦 Credito acumulado · 🧮 Saldo de abertura · 🏁 Fila de migracao · 🪞 CFI × E-Fiscal |
| **⚙️ Config Admin** (admin) | topo do app — templates do WhatsApp, horarios, 🏛️ Calendario municipal, 🏦 DeRE, modelo Gemini |
| **SP Connect** | app proprio em `/connect` (atendimento WhatsApp) — manual dentro do ℹ️ Sobre dele |

---

## Configuracoes Importantes

### SharePoint Auto-Sync

A Central de Documentos Fiscais permite sincronizacao automatica com pastas do SharePoint.

1. Acesse o modulo **Importa XML/PDF** > aba **SharePoint**.
2. Configure a conexao informando as credenciais e a URL do SharePoint da organizacao.
3. Mapeie as pastas de cada empresa para que os XMLs sejam importados automaticamente.
4. O sistema verifica periodicamente por novos arquivos e importa automaticamente.

### Certificado Digital (Upload A1)

Necessario para captura automatica de XMLs via SEFAZ e para operacoes no e-CAC.

1. Acesse o modulo **Importa XML/PDF** > aba **Configuracoes**.
2. Arraste o arquivo `.pfx` (certificado A1) ou clique para selecionar (maximo 5 MB).
3. Informe a senha do certificado e clique em **Enviar**.
4. O sistema valida o certificado e exibe os dados (CNPJ, titular, validade).

**Importante:** O certificado e armazenado de forma segura no Secret Manager. Mantenha-o atualizado antes do vencimento.

### Dados Fiscais da Empresa

Obrigatorios para geracao de SPED Fiscal e outras obrigacoes acessorias.

1. Na tela de detalhe da empresa (Simples ou Lucro Presumido/Real), clique no icone de **Dados Fiscais** (engrenagem / predinho) no header.
2. Preencha: **UF**, **Codigo IBGE do Municipio**, **Inscricao Estadual (IE)**.
3. Salve. Sem esses dados, o sistema bloqueia a geracao do SPED Fiscal.

---

## FAQ — Perguntas Frequentes

**"Missing or insufficient permissions"**
> Esse erro geralmente ocorre quando a sessao expirou. Faca logout e login novamente. Se persistir, solicite ao administrador que verifique suas permissoes no painel de usuarios.

**"Dados Fiscais incompletos"**
> O modulo SPED Fiscal exige que UF, codigo IBGE e Inscricao Estadual estejam preenchidos. Acesse o detalhe da empresa, clique em Dados Fiscais e complete as informacoes.

**Como exportar PDF?**
> Na maioria dos modulos (DAS, DARF, NFS-e, fichas financeiras), procure o botao de **Download** ou **Exportar PDF** (icone de seta para baixo). O arquivo e gerado e baixado automaticamente pelo navegador.

**Como adicionar uma categoria customizada?**
> Na Central de Documentos Fiscais, acesse a aba **Configuracoes**. La voce pode criar categorias personalizadas para organizar os documentos conforme a necessidade do escritorio.

**O sistema esta lento ou nao carrega os dados**
> Verifique sua conexao com a internet. O sistema depende de acesso ao Firebase e aos servicos do backend. Limpe o cache do navegador se o problema persistir.

**Como alterar minha senha?**
> Use a opcao de recuperacao de senha na tela de login ou solicite ao administrador a redefinicao.

---

## Contato

Para duvidas, suporte tecnico ou solicitacao de novos acessos:

- **Administrador:** junior@spassessoriacontabil.com.br

---

*Consultor Fiscal Inteligente — SP Assessoria Contabil*
