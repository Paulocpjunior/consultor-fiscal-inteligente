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
| Bloco C — SAT/CF-e mod 59 (C800/C860) | ✔ | não captura nem gera | 🔴 depende do F0 (quantos clientes têm SAT?) |
| Bloco D (CT-e) | ✔ | idem | ✅ |
| Bloco E — apuração ICMS (E100/E110/E116) + IPI (E200/E210) | ✔ | idem | ✅ |
| **Bloco E — ajustes de apuração (E111)** | ✔ | aba "Ajustes E111" do card SPED Fiscal (crédito outorgado, estornos, deduções, débitos especiais; tipo derivado do código 5.1.1) | ✅ **02/08** |
| Bloco E — ST/DIFAL (E200-ST/E220/E310) | ✔ | não gera — código de ST é recusado na aba com aviso | 🔴 |
| Bloco G (CIAP — crédito de ativo) | ✔ | bloco vazio | 🔴 aguarda resposta do Paulo (alguém usa CAT 17/99?) |
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
| DeSTDA (Simples ST/DIFAL) + DIFAL aquisições + EC 87/15 | 🔴 | 3 trilhos ATIVOS no E-Fiscal (menus 03/08) — a pergunta do DIFAL ficou mais urgente |
| Regime de caixa do Lucro (recebidos/a receber) | 🟡 NOVO (03/08) | CFI apura por emissão; presumido por caixa precisa do controle de recebimento — avaliar com o Paulo |
| e-CredAc/crédito acumulado SP (CAT 207/2009 + 17/99) | 🟡 | junto com a decisão do CIAP |
| PER/DCOMP · ressarcimento ST (CAT 42/18) | 🟡 | sob demanda; hoje e-CAC/manual |
| SINTEGRA · IN 86/01 · DNF · REDF · DES · DMED · CPRB · STDA | ⚫ | legados/nichos |
| REINF | 🔴 fora do CFI | módulo em construção no Consultor Contábil; menu mapeado (faltam 2 submenus); FUNRURAL do 🌾 = fonte do R-2055 |
| Histórico de escrituração (PG12, 84 GB, 1.735 empresas) | 🔴 | extração = fase F2 do plano (aguarda 3 arquivos do Paulo); até lá o E-Fiscal fica vivo de consulta |
| Importação Folhamatic (.FML) | — ponte | Exportar SAGE + leitor de log — existe PARA a transição; morre com ela |

## Pré-requisito transversal: completude de captura

Migrar cliente = prova de captura OK + cofre de saída ativo (hoje 0/388) +
Canceladas/Faltantes limpo. Cliente com buraco de captura NÃO migra.

## Caminho fechado do plano (F0–F3, execução com ordem do Paulo)

F0 inventário por cliente (SAT? CIAP? bloco K? ajustes? quem entrega EFD?)
→ F1 dois pilotos com conferência-espelho no PVA → F2 extração do PG12 →
F3 ondas. **E111 (02/08) era o bloqueio técnico nº 1 e está fechado** —
próximo alvo técnico: E220/ST ou C800/SAT, conforme o F0 disser qual dói.

**F0 AUTOMÁTICO no ar (03/08)**: aba 🚦 Migração do card SPED Fiscal
(`migracao-prontidao.js` puro + rota `/api/admin/sped/prontidao-migracao`)
varre as notas da competência e classifica cada empresa — ST em saída
(bloqueio: E220), IPI/indústria (bloqueio: bloco K/CIAP), compra
interestadual (atenção: DIFAL), ST em entrada (coberto) — e aponta as
🟢 **candidatas a piloto** (Lucro + movimento + zero bloqueio). O que os
dados não respondem fica listado na própria aba como pergunta à equipe:
SAT, regime de caixa, CIAP, DeSTDA.
