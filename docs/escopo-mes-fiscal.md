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
8. **A qualificação da equipe é RESTRIÇÃO DE PROJETO, não problema a consertar
   com treinamento** (Paulo, 11/08: *"tem um ponto que breca isso: a
   qualificação profissional e pessoal de cada um"*). Consequência de desenho:
   **minimizar o número de julgamentos fiscais que o app EXIGE da pessoa**.
   Preferir sempre "o app calcula e a pessoa confirma com a evidência na tela" a
   "a pessoa informa". Onde informar é inevitável (IVA-ST, natureza do
   rendimento, `indAquis`, contagem do inventário), o valor entra **carimbado
   com a origem** e nunca vira verdade em silêncio. Tela que pede decisão que a
   pessoa não tem como tomar produz erro com cara de dado.
9. **O PRINT É EVIDÊNCIA, NÃO NARRATIVA — e por isso ele é essencial** (Paulo,
   11/08: *"o colaborador não sabe falar o que quer pq não sabe fazer e não sabe
   explicar"*). Campo de "descreva seu problema" produziria entrada PIOR que o
   print: a descrição errada de quem não sabe vira trabalho em cima de premissa
   falsa. É a mesma regra do XML-fonte — **a fonte não mente, o relato mente**.
   Logo: nunca trocar evidência por narração; o que se melhora é a evidência
   chegar com CONTEXTO automático (cliente, competência, tela, documento —
   como a `ErrorBoundary` que passou a dizer o módulo), nunca pedindo à pessoa
   que explique o que ela não sabe explicar.
10. **Regra com base legal se encoda COM a citação e COM teste.** O embasamento
    jurídico/técnico vem do Paulo e não é achismo — o trabalho do app é aplicá-lo
    de forma idêntica para sempre (art. 136 / RC 33068, LC 224/2025, IN RFB
    932/2009, LC 123 art. 13, Res. CGSN 140/2018 art. 26 já entraram assim).
    Tradução cirúrgica feita UMA vez e travada por teste é o único jeito de a
    precisão dele não depender do dia nem da pessoa.

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

## 5. As travas — o **mata-burro** (o que o sistema RECUSA fazer)

> Paulo (11/08): *"colaborador que não sabe até hoje não vai saber amanhã. O que
> muda o jogo são os freios que estamos criando — prazos, obrigações, entregas,
> quem faz e como faz. Eu chamo de mata-burro."*

A palavra manda no desenho: **mata-burro é barreira física no caminho, não aviso
que se lê.** Quem não sabe não é obrigado a saber — é obrigado a *não passar*.
Logo, trava não é texto de ajuda nem treinamento: é o app **parando** e dizendo
por quê. É o oposto do Excel, onde tudo é possível e nada avisa.

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

**No ar desde 11/08 — `sefaz-backend/catalogo-obrigacoes.js` (23 testes):**
- **T1 — cobertura incompleta não deixa o mês fechar.** `mesDoCliente()` devolve
  `coberturaIncompleta: true` quando o catálogo não cobre o cliente; a etapa 4
  não pode dar verde nesse caso.
- **T2 — competência inválida LANÇA.** Não devolve mês vazio em silêncio (a
  obrigação mensal passava batido antes de validar a competência).
- **T3 — regime não se adivinha.** `lucro_empresas` sem `regimePadrao` vira
  `INDEFINIDO`: recebe só o que os dois regimes do Lucro têm em comum, entra em
  `empresasSemRegime` no log do cron e acende com a ação ("defina o Regime
  padrão na ficha"). Adivinhar regime é adivinhar imposto.
- **T5 — obrigação com condição não avaliável não vira tarefa, mas é NOMEADA.**
  INSS patronal exige folha, e a folha mora no módulo de DP — gerar pra todos
  criaria "atrasada" falsa todo mês, que é como o farol morre.
- **T6 — prazo não se inventa.** Cada obrigação declara `baseLegal` e a direção
  do ajuste de dia não útil; o que não foi conferido sai em
  `pendenciasDeConfirmacao()`.

**A construir:**
- **T4 — fechamento do mês exige as 5 etapas com prova**; "mês fechado" vira
  carimbo com data e autor (é o que define **migrado** — §8).

---

## 5-B. O prazo vem do ÓRGÃO, por esfera — e a consulta é mensal

> Paulo (11/08): *"os vencimentos são datas definidas pelos órgãos
> governamentais, sempre separados por esferas: federal, estadual, municipal.
> Isso nunca se altera e é onde deve ser feita a consulta."*

A taxonomia é estável; a **data** é que se move (portaria de prorrogação,
feriado municipal, calendário estadual). Por isso catálogo estático envelhece —
e por isso a esfera virou campo de primeira classe (`esfera` + `abrangencia`).

**Estado hoje:** `federal` completo (vale igual pra todos) · `estadual` só o
prazo de **SP** (`UF:SP` — cliente de outra UF não tem prazo cadastrado, e a
abrangência denuncia isso) · `municipal` é o buraco: o **ISS** entrou como
pendência nomeada porque não existe "dia do ISS" nacional, e são 157 empresas de
serviço puro na carteira.

**Como a consulta mensal tem que ser feita** (o Gemini já está plugado com
grounding — `googleSearch` + `groundingChunks` devolvendo as URLs):

1. **A pergunta é por esfera e por abrangência**, porque é assim que o órgão
   publica: RFB/Caixa (federal), SEFAZ da UF (estadual), prefeitura (municipal).
2. **O resultado é PROPOSTA, com a fonte** — data + o ato que a define + a URL.
   Sem a origem carimbada não entra (é a regra do IVA-ST e do CST do IPI).
3. **Nenhuma data de pagamento muda sozinha.** O app compara o que veio com o
   catálogo e mostra a DIFERENÇA pra confirmação humana. Data errada em guia é
   multa de um lado ou "atrasada" falsa do outro — e alterar prazo é decisão com
   nome, não resultado de consulta. Modelo com busca reduz o chute, não elimina:
   ele pode citar um blog no lugar do ato.
4. **O que a consulta acha de novo vira cadastro**, não resposta de tela: prazo
   de UF e de município ficam gravados com vigência (a mesma régua do IVA-ST —
   resolução pela DATA do fato, nunca "o mais recente").

## 6. Os ritos (processos com ordem fixa)

- **Rito de envio de guia (#293):** 1) cópia na pasta IMPOSTOS do cliente no
  SharePoint · 2) gestor sempre em cópia · 3) baixa da obrigação em Vencimentos
  · 4) auditoria em `impostos_enviados`. Remetente = a caixa de **quem cuida da
  carteira**, não a institucional. Prova de envio só existe no canal
  `email-graph`; mailto/WhatsApp abrem a composição e **não provam nada**.
- **Rito de declaração (SERPRO/e-CAC):** payload não se deduz. Estrutura nova só
  entra com **declaração aceita** na mão (foi assim no ISS fixo código 9; é o
  que falta na isenção/imunidade).
- **Rito da DCTFWeb — a ORDEM DOS FATOS** (Paulo, 12/08/2026). Três fatos que
  estavam colados num só, e é colá-los que gera retrabalho:

  | fato | quem | quando | fecha a competência? |
  |---|---|---|---|
  | **alimentar** | cada depto no seu evento (eSocial · Reinf · MIT) | qualquer ordem | não |
  | **pagar** (DARF) | quem tem guia vencendo | na data do débito | **não** |
  | **transmitir** | **o fiscal** | até dia 15 do mês seguinte | **sim, para todos** |

  A guia sai com a declaração **EM ANDAMENTO** (`GERARGUIAANDAMENTO313`): quem
  tem guia vencendo cedo — IRRF de aluguéis, por exemplo — **não precisa
  transmitir para pagar**. Transmitir para "conseguir a guia" é o atalho que
  fecha a competência para os outros dois departamentos e obriga retificadora.
  Travas: T1 dono fiscal · T2 guia livre / transmitir atrás do semáforo ·
  T3 insumo pendente exige justificativa escrita e auditada · T4 insumo que
  chega depois da transmissão ACENDE "precisa de retificadora" · T5 retificar é
  transmitir de novo, com motivo obrigatório e auditoria antes×depois.
  O app **não** prevê o "depois" da retificadora: os débitos são montados pela
  Receita a partir do eSocial/Reinf/MIT.
- **Rito de migração de cliente:** captura provada + saída apta + Canceladas/
  Faltantes limpo → espelho contra o e-Fiscal (**corroboração**, não gabarito)
  → divergência explicada pelo XML-fonte → carimbo de migrado.

---

## 7. Onde ainda se faz na mão (backlog nomeado)

Cada linha aqui é uma promessa: enquanto existir, alguém está usando Excel ou
memória.

1. ~~Catálogo único de obrigações por regime~~ **FEITO 11/08**
   (`sefaz-backend/catalogo-obrigacoes.js`): o cron e o front leem do MESMO
   módulo, Presumido existe, e a divergência antecipa × prorroga virou campo
   explícito. **Pendente do Paulo/Alexandre**: rodar `pendenciasDeConfirmacao()`
   e confirmar (a) a direção do ajuste do FGTS/INSS/PIS-COFINS — o cron
   antecipava e a tela prorrogava, ficou PRORROGA que é o que a equipe vê;
   (b) a condição de folha do INSS patronal.
2. ~~**Carimbo de mês fechado / cliente migrado** (T4)~~ **FEITO 26/08** — o
   "DAR FIM DE MÊS" existe: coleção `fechamentos_competencia` (1 doc por
   empresa × competência, escrita SÓ pelo backend), núcleo
   `sefaz-backend/fim-de-mes.js`, bloco `components/FimDeMesBloco.tsx` na
   Rotina do Mês. Fecha o colaborador, reabre só admin com motivo; o carimbo
   congela acervo, valores e lastro, e o CCI importa dele pelo túnel.
3. **Fila de conferência no PVA** — E510 (+backfill jun/jul), H005, E250, G125
   estão 🟡 esperando prova humana e vivem em comentário de arquivo.
4. ~~**Bloco K**~~ **FEITO 29/08** (`sped-bloco-k.js` + aba 🏭 Bloco K no card
   SPED): espinha K001/K010/K100/K200/K220/K230/K235/K990 com prevalidação no
   mesmo PR; sem apontamento o bloco sai SEM DADOS e o gerador avisa. Vale
   para 3 empresas da carteira (contagem da 🚦), na onda final.
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
