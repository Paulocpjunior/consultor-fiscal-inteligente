# Inventário — menu Relatórios do E-Fiscal SAGE × cobertura do CFI

Fonte: Gravador de Passos do Windows enviado pelo Paulo em 01/08/2026
(`Recording_20260801_1005.mht`, empresa 1200 S&P ASSESSORIA CONTABIL S/S,
Office Fiscal Release R2026.07.22). A gravação capturou a árvore da janela
**Relatórios** do meio ao fim — o Gravador de Passos guarda só os **últimos
25 prints**, então o TOPO da árvore (livros fiscais/registros e o começo do
grupo de impostos retidos) ficou sem imagem. Falta regravar essa parte
(ver "Pendências de varredura" no fim).

A segunda gravação (`Recording_20260801_1001.mht`, módulo REINF) veio sem
conteúdo útil: o Gravador de Passos não fotografa menu suspenso aberto —
3 cliques na barra de menus e nenhuma tela do módulo. Precisa regravar
ABRINDO as telas do REINF (cada janela aberta = print capturado).

## O que a janela Relatórios oferece (recursos gerais)

- Escopo: empresa ativa ou fila de empresas; "Empr. selecionada" ou "Todas".
- Saída: impressão, Publicar, E-Mail, Vídeo (tela), Gráfico, Texto, Arquivo.
- Flags: "Gerar o relatório selecionado em Arquivo Texto", "Conforme modelo
  da Jucesp", botões "Dados dos Livros" e "Controle de Páginas".

Equivalente CFI: PDF com identidade SP (`services/relatorioPdf.ts`) por
empresa/competência. Não temos "rodar pra fila/todas as empresas" — os
relatórios de carteira (Faturamento, Impostos enviados) já são
multi-empresa por natureza.

## Árvore capturada (itens visíveis nos 25 frames)

### Fim do grupo de impostos retidos (começo cortado pelo limite do PSR)

| Relatório E-Fiscal | CFI |
|---|---|
| Demonstrativo dos Impostos Retidos – NF Saídas | ✅ COBRE — aba Retenções (prestados) |
| Demonstrativo dos Impostos Retidos (PIS, COFINS, CSLL, IRRF e Seg. Social) – NF ISS | ✅ COBRE — aba Retenções (NFSe; docs antigos sinalizam "ausente ≠ zero retido") |
| Demonstrativo dos Impostos Retidos – Entradas de Serviços | ✅ COBRE — aba Retenções (tomados) |

### Grupo "Diversos"

| Relatório E-Fiscal | CFI | Nota |
|---|---|---|
| Carta de correção | ⚠️ AVALIAR | CC-e capturada como evento; não temos listagem. Valor baixo até alguém pedir |
| Cadastro de Produtos | ⛔ NÃO VALE | CFI não mantém cadastro de produtos próprio (itens vêm do XML) |
| CFOP's | ⛔ NÃO VALE | tabela estática de CFOPs |
| Clientes e fornecedores completo / resumido | 🟡 FALTA (médio) | listagem de participantes derivável das notas; útil pra conferência de cadastro SAGE (De→Para) |
| Empresas completo / resumido | 🟡 PARCIAL | painéis Simples/Lucro listam; não há exportação-listagem em PDF |
| Entradas p/ Conferência Por Lançto | ✅ COBRE | Livro de Entradas (mesma alocação do Exportar SAGE) |
| Saídas p/ Conferência Por Lançto | ✅ COBRE | Livro de Saídas |
| Fila de empresas | ⛔ NÃO VALE | conceito interno do E-Fiscal (processamento em fila) |
| Lançamento dos Produtos – NF Entradas / NF Saídas | 🟡 FALTA (médio) | relatório POR ITEM (produto/NCM/CFOP); temos os itens gravados — é uma agregação nova |
| Listagem de Conf. do Regime de Apuração Federal / Paulista | 🟡 PARCIAL | regime está no cadastro; conferência em massa entraria no Resumo da Carteira |
| Listagem da última exportação p/ Contabilidade Off-Line ou Via Arquivo | ⛔ NÃO VALE | rastro da integração contábil do SAGE |
| Listagem dos Códigos de Integração Contábil (Entradas/Saídas · Serv. Prestados · Serv. Tomados · Fatura · Outras Receitas) | 🟡 PARCIAL | nosso De→Para (`sage_codigos_participantes`) é o análogo; listagem em PDF só se a equipe pedir |
| **NF Saídas Canceladas/Faltantes** | 🔴 **FALTA (ALTO)** | buracos de numeração + canceladas por série. Casa direto com a prova de captura e a Cobertura de Saída — é O relatório de completude que a equipe usa no SAGE |
| Periodicidade do IPI nas NFs Entradas / Saídas (Apuração Distintas) | ⛔ NÃO VALE (por ora) | nicho industrial c/ apuração decendial de IPI |
| Quantidade de Lançamentos por Usuário | ⛔ NÃO VALE | no CFI a captura é automática; produtividade por colaborador = Resumo da Carteira |
| Responsável | ✅ COBRE | Resumo da Carteira (#375) |
| **Resumo por alíquota** | 🟡 FALTA (médio-alto) | agregação Base/ICMS por alíquota; barata (mesma alocação CST) e usada na conferência da GIA |
| Resumo por série | 🟡 FALTA (baixo) | agregação por série/modelo; barata |
| Resumo por fornecedor – Modelo 1 / 2 | 🟡 FALTA (médio-alto) | ranking por participante (temos UF, falta por CNPJ) |
| Resumo por cliente – Modelo 1 / 2 | 🟡 FALTA (médio-alto) | idem, lado saídas |
| Resumo por fornecedor – **Produtor Rural** | ✅ COBRE (e melhor) | aba 🌾 DIPAM/Produtor rural: agrupa por município, calcula FUNRURAL com vigência e gera Registro 1400 — o SAGE só lista |
| Simples Paulista – Diferencial de Alíquotas/Apur. Imposto | 🟡 FALTA — perguntar ao Paulo | DIFAL/antecipação de compras interestaduais de cliente Simples paulista. Se a equipe apura isso hoje no SAGE, é candidato forte |

### Grupo "Método Permanente (Portaria CAT 17/99)"

Demonstrativo Modelo 1 · Modelo 2 · Modelo 3 (para conferência) · Modelo 3
(132 colunas) · Modelo 4 (132 colunas).

⛔ NÃO VALE (por ora) — apropriação de crédito de ICMS do ativo/insumo pelo
método permanente; só entra se algum cliente do Lucro trabalhar com crédito
acumulado. Confirmar com o Paulo se alguém usa.

### Grupo "DIPJ" (obrigação EXTINTA — substituída pela ECF)

Apuração do Saldo do IPI (Ficha 20) · Entradas e Créditos (21) · Saídas e
Débitos (22) · Remetentes de Insumos/Mercadorias (23) · Entradas de
Insumos/Mercadorias (24) · Destinatário de Prod./Mercadorias/Insumos (25) ·
Saídas de Prod./Mercadorias/Insumos (26) · Demonstr. IRRF, CSLL e Contrib.
Previdenciária Retidas na Fonte (Ficha 57).

⛔ NÃO VALE — a DIPJ acabou em 2014; são relatórios-legado que o SAGE nunca
removeu. O único conteúdo vivo (Ficha 57, retenções na fonte) o CFI já
cobre na aba Retenções.

## Resumo executivo

- **CFI já cobre**: livros de entrada/saída p/ conferência, retenções (3
  demonstrativos), responsável/carteira e produtor rural (com FUNRURAL e
  1400, que o SAGE não calcula).
- **Construídos em 01/08** (Paulo confirmou: extinto/desuso fica fora):
  1) ✅ **NF Saídas Canceladas/Faltantes**; 2) ✅ **Resumo por
  fornecedor/cliente** (a aba 👥 Por participante também cobre a listagem
  "Clientes e Fornecedores"); 3) ✅ **Resumo por alíquota**;
  4) ✅ **Lançamento por produto** (NCM+descrição). Todos no card
  Relatórios, grupo Movimento, PDF com identidade SP.
- **Perguntar ao Paulo**: Simples Paulista – DIFAL (a equipe usa?);
  Método Permanente CAT 17/99 (algum cliente usa?).
- **Não vale**: DIPJ (extinta), fila de empresas, cadastros estáticos,
  rastros da integração contábil própria do SAGE.

## Menu REINF (capturado 02/08 — gravação `Recording_20260802_0613.mht`)

Itens do menu suspenso REINF do E-Fiscal (Serviço de Comunicação REINF
"Ativo — Ambiente Produção" no rodapé da janela):

- **Configuração para Transmissão**
- **Carga Inicial – Dados do Contribuinte** → evento R-1000
- **Transmissão dos Processos Administrativos/Judiciais** → R-1070
- **Transmissão Entidades Ligadas**
- **Transmissão de Eventos Periódicos** → R-2010/R-2020/R-2099 (retenções
  de serviços e fechamento)
- **Comercialização – Produtor Rural PJ/Agroindústria** → R-2050
- **Informações Complementares ▸** (capturado 03/08, print direto): a série
  **R-4000** — retenções na fonte que substituíram a DIRF: **R-4010**
  (pagamentos a beneficiário PF, IRRF) · **R-4020** (beneficiário PJ —
  IR/CSLL/PIS/COFINS retidos) · **R-4040** (beneficiários não
  identificados) · **R-4080** (autorretenção — propaganda/comissões).
  Ponto de contato com o CFI: o relatório de Retenções (NFS-e tomados) já
  carrega IR/INSS/CSLL/PIS/COFINS por prestador — é a fonte natural do
  R-4020 no módulo do Consultor Contábil
- **Relatórios ▸** (capturado 03/08): **Recibos de Entrega** · **Relatório
  de Rendimentos Enviados – REINF** — os dois são pós-transmissão
  (comprovante e conferência do que foi enviado); no módulo do Consultor
  Contábil equivalem a guardar o recibo do evento e listar os enviados
- Exportação XML (IOB Auditor) · Analyzer

Decisão do Paulo (01/08): o achado REINF alimenta o módulo EFD-Reinf do
**Consultor Contábil** (app separado), não o CFI. Ponto de contato com o
CFI: a compra de produtor rural PF com FUNRURAL por sub-rogação (nossa aba
🌾) é declarada à Receita no evento **R-2055 (aquisição de produção
rural)** — quando o módulo Reinf do Consultor Contábil for atualizado, o
valor apurado pelo CFI é a fonte natural do R-2055.

Falta abrir: os dois submenus (Informações Complementares e Relatórios) —
gravar de novo ABRINDO cada um.

## Menus principais (prints diretos, 03/08)

Legenda: ✅ CFI cobre · 🟡 parcial/avaliar · 🔴 lacuna relevante ·
⚫ extinto/desuso/nicho (não vale) · ⚪ cinza no próprio E-Fiscal (desabilitado).

### Menu MOVIMENTOS (lançamento e apurações especiais)

| Item | × CFI |
|---|---|
| NF Entradas e Saídas · Saídas por Talão | ✅ captura automática + importações (digitação manual morre com a migração) |
| ISS ▸ | ✅ NFS-e capturada + apuração |
| Recálculo | ✅ apuração recalcula sozinha |
| **Controle de Crédito de ICMS do Ativo Permanente-CIAP** | 🔴 ATIVO no menu — reforça a lacuna do bloco G (pergunta CAT 17/99 em aberto) |
| **Controle da Produção e do Estoque (Bloco K)** | 🔴 ATIVO — lacuna do bloco K (F0 dirá quantas indústrias) |
| **DeSTDA** (ST/DIFAL/antecipação do Simples) | 🔴 avaliar — obrigação VIVA pra Simples com ST/DIFAL; casa com a pergunta do DIFAL |
| Apuração ref. Estoque ST · CAT 28/2020 | 🟡 eventos de inclusão/exclusão do regime ST — sob demanda |
| Movimentação de Combustíveis · Usinas (açúcar/álcool) | ⚫ nicho (só se houver posto/usina na carteira) |
| STDA | ⚫ anual antiga do Simples SP |
| Método Permanente/Anual ▸ · DIPI · Apuração ICMS ST Interestaduais · créditos PIS/COFINS especiais | ⚪ cinza no próprio E-Fiscal |

### Menu IMPOSTO (apurações)

| Item | × CFI |
|---|---|
| Digitações Sócios/Empresas · Valores Complementares · Recálculo Federais | ✅ cadastro + apuração do CFI |
| Simples Nacional ▸ · MEI | ✅ módulo Simples/DAS |
| **Diferencial de Alíquotas (nas aquisições)** · **Apuração DIFAL EC 87/15** | 🔴 mesma pergunta pendente do DIFAL — o E-Fiscal tem DOIS trilhos ativos disso |
| Módulo Imposto PIS/COFINS | ✅ SPED Contribuições + apuração Lucro |

### Menu RELATÓRIOS (o dropdown — a árvore interna já está mapeada acima)

| Item | × CFI |
|---|---|
| Relatórios (janela/árvore) | ✅ card Relatórios (15) — topo da árvore ainda pendente de print |
| Clientes e Fornecedores · Produtos (a partir de 2009) | ✅ Por participante · Por produto |
| E-Mails Enviados | ✅ auditorias das_envios_cliente/impostos_enviados |
| Cadastro de empresas | ✅ painéis + listagem |
| **Regime de Caixa — Valores Recebidos/À Receber** | 🟡 avaliar: Lucro Presumido por regime de caixa precisa do controle de recebimento — hoje o CFI apura por emissão |
| Relatórios para Conferência ▸ | 🟡 submenu não aberto |
| Config. de Datas · Controle de Acesso | ⚫ internos do E-Fiscal |

### Menu IMPRESSOS (guias)

| Item | × CFI |
|---|---|
| Guia ICMS/GARE | ✅ DARE-SP pela API credenciada (a GARE virou DARE) |
| Emissão de DARF's | ✅ DARF SERPRO |
| Emissão da Guia de ISS | 🟡 guia municipal varia por prefeitura — CFI registra envio; emissão é no portal |
| Impostos Retidos ▸ | 🟡 DARF de retenções — conferir se o trilho DARF cobre os códigos |
| CPRB (desoneração) | ⚫ nicho |
| Recibos ▸ · Guias em Branco ▸ | ⚫ |
| Simples Paulista · GRPR · ICMS RS · ICMS ST | ⚪ cinza |

### Menu DIVERSOS (arquivos e declarações — o coração da migração)

| Item | × CFI |
|---|---|
| **EFD - ICMS/IPI ▸ · EFD - Contribuições ▸** | ✅ card SPED Fiscal (a prova do piloto pendente) |
| Exportação de dados p/ contabilidade | 🟡 ponte pro contábil — mapear quando o Consultor Contábil precisar |
| **DCTF ▸ · Módulo de Inclusão de Tributos - MIT** | ✅ DCTFWeb + MIT do CFI (retificação #292) |
| PER/DCOMP | 🟡 compensações — hoje e-CAC manual |
| Gias ▸ | ⚫ DESUSO (Paulo 02/08) |
| **DIRF** | ⚫ EXTINTA — substituída pela série R-4000 do REINF (já mapeada) |
| Comprovante de Rendimentos ▸ | 🟡 ligado à DIRF/R-4000 — avaliar no módulo Reinf |
| e-CredAc (CAT 207/2009) · Arquivo Digital CAT 156/2010 | 🟡 crédito acumulado SP — junto com a decisão do CAT 17/99 |
| Ressarcimento/Complemento ICMS-ST (CAT 42/18) | 🟡 ressarcimento ST — nicho, sob demanda |
| SINTEGRA · IN 86/01 · DNF · REDF · DES · Simples Paulista | ⚫ legados |
| DSN São Paulo · DMED ▸ · Geração PJ ▸ | ⚫ nichos/legados |
| Encerramento/Reabertura de Mês · Digitação Turbo · Exclusão em Lote · Ajustes ▸ | ⚫ operação interna do E-Fiscal |

**Resumo do achado (03/08):** os menus confirmam o de-para — as lacunas
reais continuam sendo as MESMAS cinco: CIAP (bloco G), bloco K, DeSTDA +
DIFAL (a pergunta pendente virou mais urgente: são 3 trilhos ativos disso
no E-Fiscal), SAT (não apareceu nos menus — segue só na árvore de
relatórios) e regime de caixa do Lucro (novidade desta leva — avaliar).
Todo o resto ou o CFI cobre, ou está cinza/extinto no próprio E-Fiscal.

## Pendências de varredura

1. **Topo da árvore de Relatórios** não capturado (limite de 25 prints do
   Gravador de Passos): regravar SÓ o começo — abrir Relatórios e rolar
   devagar até "Demonstrativo dos Impostos Retidos", parando ali. Em
   Configurações do Gravador dá pra subir "Número de capturas de tela
   recentes para armazenar" (padrão 25).
2. ~~REINF~~ **CAPÍTULO COMPLETO 03/08**: menu principal (02/08) + submenu
   Relatórios (Recibos de Entrega · Rendimentos Enviados) + submenu
   Informações Complementares (série R-4000: R-4010/4020/4040/4080).
   Mapa inteiro pronto pro módulo EFD-Reinf do Consultor Contábil.
3. ~~Movimentos, Imposto, Relatórios (dropdown), Impressos, Diversos~~
   **FEITO 03/08** (prints diretos — seção "Menus principais"). Restam:
   **Módulos Estaduais** e **Utilitários** + submenus que interessarem
   (ISS ▸, Relatórios p/ Conferência ▸, EFD ▸, Impostos Retidos ▸).
