# Escopo: o mês fiscal do colaborador — regras, travas e processos

> **Documento de governo.** Toda feature do departamento fiscal se justifica
> contra ele. Mudou uma regra ou uma trava aqui? Atualiza NO MESMO PR.
>
> Origem (Paulo, 11/08/2026): *"criar regras, processos, deixar claro o mês pro
> colaborador com base no tipo da empresa — Simples Nacional, Lucro Presumido ou
> Real — e na carteira de clientes do colaborador"*. E o diagnóstico do que
> havia antes: *"cada colaborador agia de uma forma, sem processos ou controles,
> cada um com um Excel diferente, ajustes de arquivos na mão, tratativas para
> fechamento do mês sem controle"*.

---

## 1. Os princípios (nesta ordem, e um vence o outro de baixo pra cima)

1. **O Excel não é ferramenta, é sintoma.** Cálculo fiscal em planilha não tem
   teste, não tem versão, não tem autor e não tem trilha. Onde a equipe abre o
   Excel, existe uma lacuna do app — e a lacuna entra neste escopo (§7), nunca
   um "modelo de planilha melhor". Isso vale também pra relatório: relatório sem
   padrão é planilha com outro nome (a casca única é `services/relatorioPdf.ts`).
2. **A estrutura do e-Fiscal é referência do que EXISTE, não prova de uso.** Os
   prints do menu dele são inventário válido de obrigação/relatório; não provam
   que alguém preenchia aquilo. Ver `de-para-efiscal-cfi.md` §abertura.
3. **Nada se marca como feito à mão.** Toda etapa fecha por **prova de dado
   real** (documento capturado, apuração gravada, tarefa baixada, envio
   auditado). Botão "concluir" sem prova reconstrói a colcha de retalhos com
   outro nome.
4. **Ausente ≠ zero.** Campo de valor/quantidade nunca recebe default. Zero só
   entra quando zero É a resposta.
5. **Cadastro errado ou faltando = ALERTA, nunca contorno.** O app acende, diz
   ONDE arrumar, e PARA.
6. **Farol honesto.** Verde só com prova; all-failed nunca é verde; contagem
   cortada diz "mostrando X de N".
7. **A ordem é a linha.** O colaborador não escolhe por onde começar: o
   `proximoPasso` é a primeira etapa não fechada.

---

## 2. A unidade de trabalho e a espinha

**Unidade: `cliente × competência`.** Não existe "tarefa solta" — tudo pendura
em um cliente e um mês.

**Espinha: as 5 etapas** (`sefaz-backend/rotina-fiscal.js`, já no ar):

| # | Etapa | Fecha com (prova) |
|---|---|---|
| 1 | Capturar notas | documentos do período + prova de captura (cursor NSU) |
| 2 | Validar as notas | sem resumo-sem-completa, sem cancelada contando, CC-e avaliada |
| 3 | Apurar impostos | ficha do mês (Lucro) ou faturamento lançado (Simples) |
| 4 | Entregar obrigações | tarefa baixada na aba Vencimentos |
| 5 | Emitir e enviar guias | rito completo: arquivo no SharePoint + gestor em cópia + baixa + auditoria |

**Onde o colaborador lê isso:** 🧭 Guia do mês, na Carteira — uma linha por
cliente, ordenada por cor e, dentro da cor, por quem vence antes. É o norte
diário; a Rotina do Mês é o detalhe de um cliente.

---

## 3. 🚨 O achado que trava tudo: TRÊS catálogos de obrigações, e o mês nasce do mais pobre

Hoje existem três listas do que um cliente deve, e elas **não concordam**:

| Onde | Quem consome | O que tem |
|---|---|---|
| `sefaz-backend/tarefas-orchestrator.js` | **o cron mensal do dia 1 — quem CRIA as tarefas do mês** | SIMPLES: DAS, FGTS · LUCRO_REAL: DCTFWeb, FGTS, SPED |
| `services/calendarioFiscal.ts` | Vencimentos (tela) e `tarefasAutoGerar` | SIMPLES (+DEFIS) · **LUCRO_PRESUMIDO** (DCTFWeb, FGTS, INSS, PIS/COFINS, EFD-Contribuições, SPED, IRPJ/CSLL trimestrais, ECF, ECD) · LUCRO_REAL |
| `sefaz-backend/calendario-obrigacoes.js` | `dctfweb-orchestrator` | 3º mapa, com `requireFolha` / `requireISS` / `requireUF` / `requireMunicipioIBGE` |

O comentário do backend diz *"Mesmo mapa do services/calendarioFiscal.ts
(mantido em sync manual)"* — **e não é o mesmo mapa.** Pior: o orquestrador
mapeia `lucro_empresas → LUCRO_REAL` sempre, então

> **LUCRO PRESUMIDO NÃO EXISTE PARA O CRON QUE GERA O MÊS.**

Consequência em cadeia, que é exatamente o sintoma que o Paulo descreve: a
obrigação não vira tarefa ⇒ não aparece em Vencimentos ⇒ não aparece no Guia do
mês ⇒ o farol diz "mês fechado" com PIS/COFINS, EFD-Contribuições e IRPJ/CSLL
trimestral **nunca listados**. O colaborador que sabia, fazia por fora (Excel);
o que não sabia, não fazia. O sistema não estava mentindo por bug — estava
reproduzindo a colcha.

**REGRA Nº 1 DESTE ESCOPO: um catálogo só.** Fonte única, no backend, puro e
testado; o front lê dele. Três cópias divergem sem ninguém ver — é a mesma
lição da série R-2000 e do ISS por painel.

---

## 4. O mês por regime

Base: o que `calendarioFiscal.ts` já encoda (entendimento da equipe) + o que a
apuração do app já sabe fazer. **A lista definitiva é decisão do Paulo/Alexandre**
— o que este escopo trava é que ela exista em UM lugar e que o cron use ELA.

### 4.1 Simples Nacional
- **Mensal:** DAS (dia 20) · FGTS Digital (20) · DCTFWeb quando houver fato gerador.
- **Sem movimento:** a **declaração** continua devida — PGDAS-D sem movimento,
  sob as 4 travas (§5). Não entregar custa MAED R$ 50/competência.
- **Anual:** DEFIS.
- **Particularidades que o app já trata:** Fator R por série mensal de 12 meses
  (folha inclui CPP+FGTS); ISS próprio JÁ ESTÁ no DAS (cobrar guia do município
  é cobrar duas vezes) — exceto ISS retido, ISS fixo/SUP e impedimento por
  sublimite; ISS(SUP) é atividade própria, não retenção.
- **Aberto:** isenção/imunidade por tributo no PGDAS-D (espera o extrato bruto).

### 4.2 Lucro Presumido
- **Mensal:** PIS/COFINS · DCTFWeb · INSS/CPP · FGTS · SPED Fiscal · EFD-Contribuições.
- **Trimestral (3/6/9/12):** IRPJ e CSLL.
- **A trava que já existe e não pode se perder:** mês que **não** encerra
  trimestre não apura IRPJ/CSLL — a linha sai zerada, a receita vai pro
  "Acumulado do Trimestre", e o MIT só recebe os mensais. Fechar no mês errado
  duplica o débito em setembro. `mesEncerraTrimestre` / `avisoPeriodoApuracao`.
- **Anual:** ECF, ECD.

### 4.3 Lucro Real
- **Mensal:** mesma base do Presumido + estimativa quando aplicável
  (`LIMITE_ADICIONAL_MENSAL` só vale aqui).
- **Anual:** ECF, ECD.

### 4.4 Transversal (qualquer regime, quando o cliente tem o fato)
ICMS próprio e **DIFAL de aquisição** · **ICMS-ST / GNRE por UF de destino** ·
**ISS** (próprio e retido — guias separadas) · **DIPAM/1400 e FUNRURAL
sub-rogado** (compra de produtor rural) · **EFD-Reinf** (R-4020 retenções,
R-2055 FUNRURAL — apura aqui, declara no 📊 Contábil) · **CIAP/Bloco G** ·
**Bloco K** (indústria) · **inventário/Bloco H** (dezembro).

---

## 5. As travas (o que o sistema RECUSA fazer)

Trava = o app **para** e diz por quê. É o oposto do Excel, onde tudo é possível.

**Já no ar — não afrouxar:**
- **Guia em lote pela API: proibido.** Imposto sai uma a uma, com preview.
- **DAS < R$ 10,00** não emite; **DARE de homologação** nunca vai ao cliente.
- **PGDAS sem movimento** recusa em 4 casos: receita lançada · nota capturada
  sem receita · captura incerta · sem confirmação humana nominal.
- **ISS fixo (SUP) sem código cadastrado**: emissão recusada.
- **Falha de REDE em POST de emissão** = `indeterminado`, nunca "falha"
  (reenviar duplica cobrança).
- **Auditoria de saída do SPED** roda em todo arquivo gerado (coluna zerada,
  total que não bate, bloco vazio com IND_MOV=1).
- **Inventário/valor sem informação** ⇒ bloco vazio + alerta, nunca zero.
- **Departamento desconhecido** é recusado na gravação, nunca descartado.

**A construir (deste escopo):**
- **T1 — Obrigação não listada não deixa o mês fechar.** Enquanto o catálogo
  único (§3) não cobrir o regime do cliente, a etapa 4 não pode dar verde: hoje
  ela dá.
- **T2 — Competência sem catálogo aplicável = âmbar nomeado**, nunca silêncio.
- **T3 — Cliente sem regime definido não entra na carteira como "ok"**: sem
  regime não há mês, e adivinhar regime é adivinhar imposto.
- **T4 — Fechamento do mês exige as 5 etapas com prova**; "mês fechado" vira um
  carimbo com data e autor (é o que define **migrado** — §8).

---

## 6. Os ritos (processos com ordem fixa)

- **Rito de envio de guia (#293):** 1) cópia na pasta IMPOSTOS do cliente no
  SharePoint · 2) gestor sempre em cópia · 3) baixa da obrigação em Vencimentos
  · 4) auditoria em `impostos_enviados`. Remetente = a caixa de **quem cuida da
  carteira**, não a institucional. Prova de envio só existe no canal
  `email-graph`; mailto/WhatsApp abrem a composição e **não provam nada**.
- **Rito de declaração (SERPRO/e-CAC):** payload não se deduz. Estrutura nova só
  entra com **declaração aceita** na mão (foi assim no ISS fixo código 9; é o
  que falta na isenção/imunidade).
- **Rito de migração de cliente:** captura provada + saída apta + Canceladas/
  Faltantes limpo → espelho contra o e-Fiscal (**corroboração**, não gabarito)
  → divergência explicada pelo XML-fonte → carimbo de migrado.

---

## 7. Onde ainda se faz na mão (backlog nomeado)

Cada linha aqui é uma promessa: enquanto existir, alguém está usando Excel ou
memória.

1. **Catálogo único de obrigações por regime** (§3) — o maior, e o que destrava
   o "mês claro". Inclui Presumido existir.
2. **Carimbo de mês fechado / cliente migrado** (T4) — hoje não existe estado.
3. **Fila de conferência no PVA** — E510 (+backfill jun/jul), H005, E250, G125
   estão 🟡 esperando prova humana e vivem em comentário de arquivo.
4. **Bloco K** — ninguém leu ainda o número da 🚦.
5. **Isenção/imunidade no PGDAS-D** — espera o extrato bruto.
6. **DIFAL: IVA-ST por NCM** — hoje digitado competência a competência quando o
   cadastro NCM não cobre.

---

## 8. O placar (como se sabe que funcionou)

Não é bloco construído. É:

- **% da carteira com o mês fechado pelas 5 etapas** (por colaborador e por regime);
- **nº de clientes carimbados como migrados** — "o mês deste cliente fecha
  inteiro dentro do CFI", não "os dados foram transferidos";
- **nº de guias com prova de envio pelo servidor** (`email-graph`) sobre o total;
- **zero obrigação descoberta fora do sistema** — se apareceu por Excel ou
  WhatsApp, o catálogo falhou e vira linha no §7.
