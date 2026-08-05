# De-Para E-Fiscal → CFI (documento VIVO da migração)

> Pedido do Paulo (02/08): "sempre atualizando um de-para entre o CFI e o
> E-Fiscal". REGRA: toda entrega que fechar (ou abrir) uma lacuna atualiza
> ESTE arquivo no mesmo PR. Legenda: ✅ pronto no CFI · 🟡 parcial ·
> 🔴 falta · ⚫ não vale (extinto/desuso — decisão do Paulo).

## Escrituração / SPED Fiscal (EFD ICMS/IPI)

| Função | E-Fiscal | CFI | Status |
|---|---|---|---|
| Bloco 0 (cadastros, participantes, itens) | ✔ | card SPED Fiscal | ✅ |
| Bloco C (NF-e/NFC-e mod 55/65) | ✔ | idem | ✅ |
| Bloco C — SAT/CF-e mod 59 (C800/C860) | ✔ | — | ⚫ **DESCARTADO 03/08** (equipe): não há mais SAT na carteira — virou NFC-e mod 65, já coberta |
| Bloco D (CT-e) | ✔ | idem | ✅ |
| Bloco E — apuração ICMS (E100/E110/E116) + IPI (E200/E210) | ✔ | idem | ✅ |
| **Bloco E — ajustes de apuração (E111)** | ✔ | aba "Ajustes E111" do card SPED Fiscal (crédito outorgado, estornos, deduções, débitos especiais; tipo derivado do código 5.1.1) | ✅ **02/08** |
| Bloco E — ST (E200/E210/E220/E250) | ✔ | apuração por UF de destino a partir do ST retido nas saídas; ajustes de ST na mesma aba do E111 (código com '1' no 3º caractere) | ✅ **04/08** — validar no PVA. **E310/E316** (DIFAL/FCP da EC 87/15, venda a não contribuinte): a 🚦 Migração passou a DETECTAR quem faz a operação (CFOP 6107/6108 em saída própria, 05/08) — zero empresa marcada = bloco descartável como o SAT; uma que seja, vira alvo |
| Bloco G (CIAP — crédito de ativo) | ✔ | aba 🏭 CIAP do card SPED Fiscal (bens em 48 parcelas + índice das saídas tributadas; G001/G110/G125/G990) | ✅ **03/08** — régua conferida contra o CIAP real da EXPERTE 06/2026 (Σ parcelas 527,53 × índice 0,86032111 = 453,85). Falta: cadastrar os bens da EXPERTE e validar o arquivo no PVA |
| Bloco H (inventário) | ✔ | gera H005/H010 (qtd/valor a preencher) | 🟡 |
| Bloco K (produção) | ✔ | bloco vazio | 🔴 depende do F0 (quantas indústrias reais) |
| Bloco 1 — Registro 1400 (DIPAM) | lançamento manual | automático da aba 🌾 | ✅ (melhor que o E-Fiscal) |
| Conferências (PVA-espelho, cruzamentos) | — | Análise · SPED×Capturadas · SPED×Declarado · Conciliar faturamento | ✅ (só existe no CFI) |
| SPED Contribuições (PIS/COFINS) | ✔ | card SPED Fiscal → aba Contribuições | ✅ |
| Transmissão | PVA da Receita | PVA da Receita | — (nunca foi do E-Fiscal) |

## Relatórios

Inventário completo em `docs/inventario-relatorios-efiscal.md`. Resumo:
15 relatórios no card Relatórios ✅; candidatos restantes: Resumo por série
(🟡 baixo), Carta de correção (🟡 avaliar), Simples Paulista–DIFAL
(🔴 aguarda resposta), listagem de códigos de integração (🟡 se a equipe
pedir). DIPJ/fila/cadastros estáticos ⚫.

## Demais funções

| Função | Status | Nota |
|---|---|---|
| GIA | ⚫ DESUSO (Paulo, 02/08) | não gastar feature |
| DIRF | ⚫ EXTINTA | substituída pela série R-4000 do REINF |
| DCTF/MIT · DARF · GARE→DARE · DAS | ✅ | DCTFWeb+MIT (#292), SERPRO, API DARE-SP |
| DIFAL de aquisição — consolidado mensal do Simples | ✅ **FASE 1 no ar 03/08** | desenho do Alexandre: aba 🧭 DIFAL aquisição (Central XMLs) — varredura da carteira + apuração por cliente (interna 18% editável/nota, interestadual da nota ou derivada UF/origem, clamp ≥0); guia sai pelo trilho DARE existente |
| Antecipação art. 426-A (mercadoria com ST) | ✅ **03/08** | individual POR DOCUMENTO (Alexandre): IA = VA × (1+IVA-ST) × ALQ − IC, com IVA ajustado pela interestadual. IVA-ST é INFORMADO (vem da Portaria CAT) — documento sem ele fica PENDENTE e fora do total. Guia DARE **por documento** no ar 05/08 (botão 🧾 na linha da nota, só com todos os itens calculados; a chave da NF-e fica amarrada na auditoria). **Falta o CÓDIGO DE SERVIÇO da antecipação** — é rubrica própria (não é o 04602/DIFAL) e vem da lista real da SEFAZ: admin cadastra 1× em `dare_codigos_servico`; sem ele a tela avisa e recusa |
| DIFAL uso/consumo do Lucro (EC 87/15) no SPED | ✔ | C195/C197 por documento a partir das entradas interestaduais de uso/consumo e ativo (CFOP 2551/2552/2555/2556/2557); interna 18% editável por nota, interestadual da nota ou derivada. **Só sai com o COD_AJ da tabela 5.3 do estado cadastrado** — sem ele vira aviso (código de ajuste não se inventa). O DÉBITO na apuração continua vindo do E111: o C197 é a origem documental, não a conta | ✅ **04/08** — validar no PVA |
| Regime de caixa do Lucro | ⚫ **DESCARTADO 03/08** (equipe) | nenhum cliente optante |
| e-CredAc/crédito acumulado SP (CAT 207/2009 + 17/99) | 🟡 | junto com a decisão do CIAP |
| PER/DCOMP · ressarcimento ST (CAT 42/18) | 🟡 | sob demanda; hoje e-CAC/manual |
| SINTEGRA · IN 86/01 · DNF · REDF · DES · DMED · CPRB · STDA | ⚫ | legados/nichos |
| REINF | 🔴 fora do CFI | módulo em construção no Consultor Contábil; menu mapeado (faltam 2 submenus); FUNRURAL do 🌾 = fonte do R-2055 |
| Histórico de escrituração (PG12, 89,5 GB, 1.735 schemas) | ⚫ **FORA DO PLANO 05/08** | Paulo: "não me preocuparia com o passado, o e-fiscal continua ativo e servirá para consultas". O E-Fiscal NÃO será desligado — vira sistema de consulta do histórico. Migra-se só a operação corrente |
| Importação Folhamatic (.FML) | — ponte | Exportar SAGE + leitor de log — existe PARA a transição; morre com ela |
| NFC-e de balcão no .FML (participante CONSUMIDOR) | ✅ **04/08** | cupom **sem** documento e cupom **com o CPF** do comprador vão os DOIS pro participante genérico "Consumidor" do E-Fiscal (o CPF da NF Paulista vem sem endereço — viraria E010 sem UF e derrubaria a nota). Código do participante fica no cadastro da empresa (`dadosFiscais.codigoParticipanteConsumidor`), digitado uma vez. NFC-e contra CNPJ continua participante de verdade |

## Chave da migração: Cod.Cliente ↔ CNPJ (Paulo, 04/08)

"Todas as empresas no E-Fiscal trabalham com código da empresa antes do nome,
os códigos devem permanecer OS MESMOS ... toda amarração será pelo CNPJ, esse
será o ponto de confronto." Campo **Cod.Cliente** no cadastro do CFI
(`dadosFiscais.codCliente`, modal Dados Fiscais → 🔢 Código no E-Fiscal):
TEXTO de 4 dígitos com zero à esquerda, faixa 0001–9999, ÚNICO na carteira
(duplicado é recusado na gravação com o nome de quem já usa). Núcleo puro
`sefaz-backend/cod-cliente.js` (`normalizarCodCliente`/`schemaDoCodCliente` —
e{código} é o schema do PG12). O MESMO código é o "Nº Empresa no E-Fiscal"
(E001): o Exportar SAGE passou a preenchê-lo sozinho a partir do cadastro.
A F2 saiu do plano em 05/08 (o E-Fiscal fica de consulta), mas o campo NÃO
virou trabalho perdido: é ele que faz a busca por código funcionar em todas
as telas e o Exportar SAGE preencher o Nº Empresa sozinho — a ponte diária
com o E-Fiscal, que segue viva enquanto houver cliente não migrado.

## Pré-requisito transversal: completude de captura

Migrar cliente = prova de captura OK + cofre de saída ativo (hoje 0/388) +
Canceladas/Faltantes limpo. Cliente com buraco de captura NÃO migra.

## Caminho fechado do plano (F0–F3, execução com ordem do Paulo)

F0 inventário por cliente (SAT? CIAP? bloco K? ajustes? quem entrega EFD?)
→ F1 dois pilotos com conferência-espelho no PVA → F3 ondas.
**F2 (extração do PG12) saiu do plano em 05/08** (Paulo): o E-Fiscal fica
ativo como consulta do histórico, então migra-se só a operação corrente. O
gargalo das ondas passou a ser a COMPLETUDE DE CAPTURA (abaixo), não o
histórico. **E111 (02/08) era o bloqueio técnico nº 1 e está fechado**; o Bloco G
(CIAP) fechou em 03/08 com o relatório real da EXPERTE — próximo alvo
técnico: E220/ST ou bloco K, conforme a 🚦 apontar.

**F0 AUTOMÁTICO no ar (03/08)**: aba 🚦 Migração do card SPED Fiscal
(`migracao-prontidao.js` puro + rota `/api/admin/sped/prontidao-migracao`)
varre as notas da competência e classifica cada empresa — ST em saída
(bloqueio: E220), IPI/indústria (bloqueio: bloco K/CIAP), compra
interestadual (atenção: DIFAL), ST em entrada (coberto) — e aponta as
🟢 **candidatas a piloto** (Lucro + movimento + zero bloqueio).

**F0 HUMANO RESPONDIDO (equipe, 03/08)**: SAT NÃO (virou NFC-e 65 —
descartado) · regime de caixa NÃO (descartado) · CIAP só a EXPERTE (onda
final) · DIFAL de aquisição SIM (lacuna confirmada). Com isso o quadro de
lacunas encolheu pra: **DIFAL de aquisição** (próximo alvo), **E220/ST**
(substitutos que a 🚦 apontar), **bloco K** (indústrias que a 🚦 apontar)
e **bloco G** (um cliente, onda final). Pilotos: escolher da lista 🟢.
