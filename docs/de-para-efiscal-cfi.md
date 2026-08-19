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
| Bloco D (CT-e) | ✔ | idem | 🟡 **RESSALVA 18/08** — o gerador escritura certo o que ESTÁ no banco, mas até hoje o CT-e só entrava por cofre/importação manual (captura automática nunca existiu, ver "Captura automática de CT-e" em Demais funções). Cliente que recebe CT-e sem ninguém importar à mão tinha o Bloco D INCOMPLETO em silêncio — não é defeito do gerador, é buraco de captura anterior a ele |
| Bloco E — apuração ICMS (E100/E110/E116) | ✔ | idem | ✅ |
| **Bloco E — IPI (E500/E510/E520)** | ✔ | `sped-bloco-e-st.js`/`buildE500E520` (período+apuração) + `sped-bloco-ipi-e510.js` para a consolidação por CFOP+CST_IPI | 🟡 **E510 no ar 11/08, EM VALIDAÇÃO** — era o `🔴` que travava indústria com IPI. Provado contra SPED jun/2026 do e-Fiscal aceito no PVA: (1) **`VL_CONT_IPI` INCLUI o IPI** (`Σ vProd + Σ IPI`) — o C170 provou (CFOP 1101: 138.396,70 + 4.389,15 = 142.785,85); a 1ª versão saiu a MENOR por somar só vProd, corrigida 11/08. (2) `VL_BC_IPI` = Σ base do IPI = Σ VL_BC_IPI do C170 (bate). (3) Σ `VL_IPI` de saída = `VL_DEB` do E520 (11.742,05 cravado). O E510 é o C190 re-agregado, reaproveita `convertCfopParaEntrada`. Captura de `cstIpi`/`vBcIpi` no importer. **CST-IPI DE ESCRITURAÇÃO (resolvido 11/08 com 4 XMLs-fonte × E510 aceito):** o CST do E510 NÃO é o CST cru do XML — é o de escrituração. Na ENTRADA, o CST de saída do fornecedor converte pelo dígito da unidade (IN RFB 932/09): 50→00, 55→05, 99→49 (provado: ACOS 50→EXPERTE 00; Galvanização 55→05; outras 99→49). Na SAÍDA fica o CST da própria nota — o app NÃO normaliza 99→55 (seria corrigir a nota do cliente): saída 99 ACENDE alerta "confira na origem". Item com IPI mas SEM bloco de IPI no XML fica fora (combustível 5929 etc. não têm IPI e não entram — confere com o arquivo aceito). **Falta:** a prova final — reproduzir um E510 aceito a partir dos XMLs-fonte completos de um mês (mais forte que o PVA, que nem confere VL_CONT/CST). ⚠️ **CORRIGIDO 15/08: o backfill NÃO exige re-captura.** Esta linha dizia que o doc guarda só o `xmlHash` — ERRADO: o **XML cru está no Cloud Storage** (`storagePath`, gravado em toda captura), então campo novo de item se recupera REPROCESSANDO o arquivo guardado, sem tocar na SEFAZ e sem pedir nada ao cliente. Botão **♻️ Reler CST dos itens** na linha da 🏭 Varredura de IPI (empresa ativa), com o resultado respondendo POR CAUSA (já relidas · XML não traz o campo · sem arquivo guardado · itens que não pareiam, deixados INTACTOS de propósito). **CST não se chuta** |
| **Bloco E — ajustes de apuração (E111)** | ✔ | aba "Ajustes E111" do card SPED Fiscal (crédito outorgado, estornos, deduções, débitos especiais; tipo derivado do código 5.1.1) | ✅ **02/08** |
| Bloco E — ST (E200/E210/E220/E250) | ✔ | apuração por UF de destino a partir do ST retido nas saídas; ajustes de ST na mesma aba do E111 (código com '1' no 3º caractere) | ✅ **04/08** — validar no PVA. **E310/E316** (DIFAL/FCP da EC 87/15, venda a não contribuinte): a 🚦 Migração passou a DETECTAR quem faz a operação (CFOP 6107/6108 em saída própria, 05/08) — zero empresa marcada = bloco descartável como o SAT; uma que seja, vira alvo |
| Bloco G (CIAP — crédito de ativo) | ✔ | aba 🏭 CIAP do card SPED Fiscal (bens em 48 parcelas + índice das saídas tributadas; G001/G110/G125/G990) | ✅ **03/08** — régua conferida contra o CIAP real da EXPERTE 06/2026 (Σ parcelas 527,53 × índice 0,86032111 = 453,85). Falta: cadastrar os bens da EXPERTE e validar o arquivo no PVA |
| Bloco H (inventário) | ✔ | H001/H005/H010/H990 com a régua do `sped-bloco-h.js` (16 testes) | 🟡 **CORREÇÃO GRAVE 06/08** — o gerador montava H010 pra TODOS os itens do 0200 com qtd/valor default ZERO, e não existe UM lugar no app que grave esses campos: em dezembro sairia um INVENTÁRIO INTEIRO ZERADO, estruturalmente válido, que o PVA aceita e a fiscalização lê como "declarei que não tinha estoque". Ninguém gerou bloco H ainda (mesma sorte do IPI em E200/E210). Agora: contagem não informada ⇒ bloco VAZIO + alerta (regra do Paulo 06/08 — falta de informação nunca vira zero); contagem parcial ⇒ sai só o contado, dizendo quantos ficaram de fora; H005 leva **VL_INV** (o total que o gerador somava e DESCARTAVA) no lugar do VL_AJ_PERDA/VL_AJ_GANHO que ele punha ali. Tela **📦 Inventário (Bloco H)** no card SPED (06/08): contagem por item, motivo (MOT_INV), propriedade e participante; grava em `sped_inventario` (1 doc por empresa × data) e o gerador lê de lá. Linha sem quantidade/valor NÃO é gravada — fica de fora do arquivo em vez de virar zero. Leiaute do H005 a CONFERIR NO PVA |
| Bloco K (produção) | ✔ | bloco vazio | 🔴 **F0 AUTOMÁTICO 06/08**: a 🚦 Migração passou a DETECTAR produção pelos CFOPs (5101/6101 venda de produção do estabelecimento; 5124/5125/6124/6125 e 5901/5902/6901/6902 industrialização por encomenda) e conta em `comProducaoParaBlocoK`. IPI destacado NÃO serve de sinal — comércio equiparado destaca IPI sem industrializar, e ficava marcado à toa. Zero empresa = bloco descartável como o SAT; uma que seja = alvo nomeado. Sem `itens` lidos não afirma nada (ausente ≠ zero) |
| Bloco 1 — Registro 1400 (DIPAM) | lançamento manual | automático da aba 🌾 | ✅ (melhor que o E-Fiscal) |
| **Fila de migração (quem pode migrar hoje)** | — | aba 🏁 Fila de migração do card SPED Fiscal | ✅ **07/08** — junta as TRÊS provas que já existiam em telas separadas: entrada completa contra a SEFAZ (cursor do DistDFe), saída ligada pelo cliente (autXML/cofre) e blocos do SPED que o perfil exige. Uma fila ordenada por ESFORÇO, com UM próximo passo por cliente. Ausência de sinal NUNCA vira prontidão. Onda de serviço puro (sem IE) não é bloqueada por bloco de ICMS — misturar fazia a fila parecer travada com metade dela pronta |
| **Carta de correção (CC-e) na escrituração** | — | avisos da geração do SPED + etapa de VALIDAÇÃO da Rotina do mês | ✅ **07/08** — a CC-e já era capturada (`documentos_fiscais.eventos[]`, com `xCorrecao`) e aparecia na lista de XMLs, mas NENHUM ponto da escrituração lia: nem o gerador do SPED, nem o Exportar SAGE. Pelo Ajuste SINIEF 07/05 (cl. 14-A §1º) a CC-e corrige **natureza da operação e CFOP** — e o CFOP manda no C190, no DIFAL e na DIPAM; o livro sai do XML ORIGINAL. `cce-escrituracao.js` (21 testes) classifica pelo texto em `muda-escrituracao` (CFOP/natureza/NCM/CST ⇒ conferir), `indevida-suspeita` (fala em valor/quantidade/partes/data — coisas que a CC-e NÃO PODE corrigir ⇒ a nota provavelmente precisava de cancelamento e reemissão) e `sem-efeito-fiscal`. **O app NÃO aplica a correção**: `xCorrecao` é texto livre e deduzir o campo seria inventar dado fiscal — ALERTA, nunca contorno |
| Conferências (PVA-espelho, cruzamentos) | — | Análise · SPED×Capturadas · SPED×Declarado · Conciliar faturamento · **🪞 CFI × E-Fiscal** | ✅ (só existe no CFI) |
| Conferência ARQUIVO × ARQUIVO (espelho da onda) | — | aba 🪞 CFI × E-Fiscal do card SPED Fiscal: sobe os dois .txt e compara documento a documento + E110 | ✅ **06/08** — casa pela CHAVE da NF-e (COD_PART não entra: é interno de cada sistema e daria 100% de divergência num arquivo idêntico). CNPJ/período diferentes = RECUSA, não relatório de divergência falsa. Modelo fora da ponte .FML (≠55/65) e CT-e do bloco D contam como ausência ESPERADA |
| SPED Contribuições (PIS/COFINS) | ✔ | card SPED Fiscal → aba Contribuições | 🟡 **F600 CONSTRUÍDO 19/08, aguardando prova no PVA** — Paulo mandou o EFD antigo do E-Fiscal da própria HS (0304, 05/2026, assinado) com 5 F600 reais, e ele destravou tudo de uma vez: `IND_NAT_RET=03` (PJ direito privado), `COD_REC=5952` (CSRF), `IND_NAT_REC=1` (cumulativa), `VL_RET` = SÓ PIS+COFINS (CSLL fica fora desta escrituração), e os totais fechando com o `VL_RET_CUM` do M200/M600 centavo a centavo (PIS 114,40 · COFINS 528,00). No caminho o arquivo aceito também desmentiu o leiaute DEDUZIDO do nosso M200/M600: a contribuição do regime cumulativo mora nos campos 8-12 (o gerador punha a base no campo 1 e a contribuição na seção do não-cumulativo — o PVA aceitava, mas sem `VL_RET_CUM` a retenção não abateria nada e o arquivo declararia a recolher MAIOR que o devido). Corrigidos os dois; a régua do R-4020 (assinatura de alíquota) barra nota cujos campos são o tributo da OPERAÇÃO. **Falta a prova**: regerar o EFD da HS no CFI e validar no PVA |
| Transmissão | PVA da Receita | PVA da Receita | — (nunca foi do E-Fiscal) |

## Relatórios

Inventário completo em `docs/inventario-relatorios-efiscal.md`. Resumo:
15 relatórios no card Relatórios ✅; candidatos restantes: Resumo por série
(🟡 baixo), Carta de correção ✅ **07/08** (não era relatório, era buraco: a CC-e é capturada e NENHUM ponto da escrituração lia — ver linha própria abaixo), Simples Paulista–DIFAL
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
| e-CredAc/crédito acumulado SP (CAT 207/2009 + 17/99) | 🟡 **F0 AUTOMÁTICO 07/08** | aba 🏦 Crédito acumulado do card SPED Fiscal: varre a carteira do LUCRO e separa quem ACUMULA (saldo credor recorrente **+** hipótese do art. 71 do RICMS — exportação, saída isenta com manutenção, redução de base, alíquota de saída menor que a de entrada) de quem só PARECE acumular. Saldo credor sozinho não é crédito acumulado: credor todo mês SEM hipótese é quase sempre **saída faltando na captura** (Rejeição 641), e mandar abrir processo no e-CredAc em cima de livro incompleto seria pior que não ter a ferramenta. A conta do saldo é a MESMA do E110 (`somarIcmsPorDirecao`, exportada do gerador) e é SINAL, não apuração — não inclui ajustes do E111 nem saldo de meses anteriores, e a tela diz isso. ZERO gerador recorrente ⇒ o arquivo é descartável como o SAT; um que seja ⇒ alvo nomeado. Optante do Simples fica fora (não apura ICMS por conta gráfica) |
| PER/DCOMP · ressarcimento ST (CAT 42/18) | 🟡 | sob demanda; hoje e-CAC/manual |
| SINTEGRA · IN 86/01 · DNF · REDF · DES · DMED · CPRB · STDA | ⚫ | legados/nichos |
| REINF | 🔴 fora do CFI | módulo em construção no Consultor Contábil; menu mapeado (faltam 2 submenus); FUNRURAL do 🌾 = fonte do R-2055 |
| Histórico de escrituração (PG12, 89,5 GB, 1.735 schemas) | ⚫ **FORA DO PLANO 05/08** | Paulo: "não me preocuparia com o passado, o e-fiscal continua ativo e servirá para consultas". O E-Fiscal NÃO será desligado — vira sistema de consulta do histórico. Migra-se só a operação corrente |
| Importação Folhamatic (.FML) | — ponte | Exportar SAGE + leitor de log — existe PARA a transição; morre com ela |
| NFC-e de balcão no .FML (participante CONSUMIDOR) | ✅ **04/08** | cupom **sem** documento e cupom **com o CPF** do comprador vão os DOIS pro participante genérico "Consumidor" do E-Fiscal (o CPF da NF Paulista vem sem endereço — viraria E010 sem UF e derrubaria a nota). Código do participante fica no cadastro da empresa (`dadosFiscais.codigoParticipanteConsumidor`), digitado uma vez. NFC-e contra CNPJ continua participante de verdade |
| Captura automática de CT-e (webservice `CTeDistribuicaoDFe`) | ⚫ **NUNCA EXISTIU** | 🟡 **F0 no ar 18/08, EM VALIDAÇÃO** — caso EDUARDO GUERRA (tomadora de frete, 0 CT-e capturado). O NFe DistDFe nunca perguntou por CT-e — é webservice de distribuição PRÓPRIO, nunca chamado neste projeto (busca em todo o git confirma). `cte-client.js` espelha o `NFeDistribuicaoDFe` já em produção; `sync-orchestrator-cte.js` espelha `sincronizarEmpresa` com cursor/lock em coleções PRÓPRIAS (`sefaz_state_cte`/`sefaz_locks_cte` — nunca as do NF-e, mesma armadilha das "duas formas"). Botão `🚚 CT-e (beta)` (Empresas Monitoradas, admin) chama `POST /sync-cte-one` pra provar numa empresa real antes do cron noturno. **Isso muda a linha "Bloco D (CT-e)" acima**: aquele ✅ escritura o que já está no banco — se a captura automática nunca existiu, o Bloco D de quem só recebe CT-e por e-mail/importação manual estava escriturando MENOS do que deveria, sem ninguém saber. Escopo desta rodada: só ENTRADA (tomadora); emissão própria e Manifestação do Destinatário de CT-e ficam de fora. **19/08 — host e envelope PROVADOS em produção**: a SEFAZ respondeu com cStat 239 estruturado (versão do XML não suportada), não erro de rede — o `distDFeInt` estava com a versão da NF-e (`1.01`) em vez da versão PRÓPRIA do CT-e (NT 2015.002, `1.00`, corroborada por múltiplas implementações independentes já que a rede da SEFAZ segue bloqueada deste ambiente). Corrigido; falta a prova de uma rodada `ok:true` |

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

## O E-Fiscal é REFERÊNCIA, não GABARITO (Paulo, 11/08)

Antes de ler qualquer linha deste de-para: o E-Fiscal era usado como **colcha
de retalhos** — nem todo campo/função era usado, cada colaborador tinha o seu
jeito e o seu Excel, e havia **ajuste à mão em Excel, dentro do PVA e no
próprio SPED**, sem processo nem coordenação. Logo:

- **Arquivo aceito prova que a Receita aceitou, não que está certo.** Lição
  ESTRUTURAL de arquivo aceito continua valendo (leiaute, ordem de campo,
  CST de escrituração — ajuste manual mexe em VALOR, não inventa leiaute);
  **VALOR de lá não é verdade**.
- **"Migração 100% dos dados" é meta falsa** — paridade com a colcha é
  importar a colcha. O alvo é estar certo contra o **XML-fonte** e a lei.
- Uma linha `🟡`/`🔴` aqui mede distância pra **escriturar certo**, não
  distância pro que o E-Fiscal fazia. Coisa que o E-Fiscal NÃO fazia (rotina,
  faróis, prova de captura) não entra como lacuna — entra como produto novo.

## Pré-requisito transversal: completude de captura

Migrar cliente = prova de captura OK + cofre de saída ativo + Canceladas/
Faltantes limpo. Cliente com buraco de captura NÃO migra. O NÚMERO de quem
está pronto se lê na aba 🏁 Fila de migração (e a adoção do autXML no painel
✅ "O cliente fez certo?") — nunca deste arquivo: número carimbado em texto
envelhece e vira o erro do "0/388" (regra de 07/08).

## Caminho fechado do plano (F0–F3, execução com ordem do Paulo)

F0 inventário por cliente (SAT? CIAP? bloco K? ajustes? quem entrega EFD?)
→ F1 dois pilotos com conferência-espelho no PVA → F3 ondas.
**A ferramenta do espelho da F1 ficou pronta em 06/08** (aba 🪞 CFI × E-Fiscal):
sem ela, comparar dois arquivos de milhares de linhas na mão não acontece e a
"conferência" vira olhar o total e confiar.
**A ORDEM das ondas está decidida em `docs/plano-migracao-ondas.md`** (05/08,
Paulo: "essa ordem quem traz é você"), a partir da varredura REAL de 07/2026:
começa por SERVIÇO PURO (157 empresas — não passam por nenhuma pendência de
ICMS e o E-Fiscal já não recebe nada delas), depois comércio, depois DIFAL
(36) e por último os nichos (3 indústria/IPI, 2 E310, 1 CIAP).
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
