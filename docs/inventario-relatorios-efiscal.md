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

## Pendências de varredura

1. **Topo da árvore de Relatórios** não capturado (limite de 25 prints do
   Gravador de Passos): regravar SÓ o começo — abrir Relatórios e rolar
   devagar até "Demonstrativo dos Impostos Retidos", parando ali. Em
   Configurações do Gravador dá pra subir "Número de capturas de tela
   recentes para armazenar" (padrão 25).
2. **REINF**: regravar ABRINDO cada tela do módulo (menu suspenso aberto
   não sai no print). O achado vai pro módulo EFD-Reinf do Consultor
   Contábil (decisão do Paulo, 01/08).
3. Demais menus do E-Fiscal (Movimentos, Imposto, Impressos, Diversos,
   Módulos Estaduais, Utilitários) — mesmas gravações, uma por menu.
