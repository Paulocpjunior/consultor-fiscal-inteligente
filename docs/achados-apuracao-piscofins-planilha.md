# Achados — apuração de PIS/COFINS em planilha (Cliente A (nome omitido), AC 2025)

> **Origem:** planilha de controle **feita pelo colaborador** que apura este
> cliente — encaminhada pelo Paulo em 12/08/2026 para análise, não de autoria
> dele. Abas `PIS E COFINS 2023`,
> `LUCRO REAL_2023`, `PIS_COFINS(2024)`, `LUCRO REAL_2024`, `PIS_COFINS(2025)`,
> `LUCRO REAL_2025`. Analisada a aba do ano-calendário **2025**, meses de
> **janeiro a junho** (os demais estão em branco).
>
> **Documento de trabalho.** Serve para (a) decidir se há retificação a fazer e
> (b) dimensionar o que a apuração dentro do CFI precisa cobrir.

---

## ⚠️ Limite desta análise — leia antes de agir

Analisei **um print da planilha**, não o arquivo. Refiz toda a aritmética a
partir dos números visíveis, o que permite separar duas coisas:

- **CONFIRMADO** — deriva dos próprios números e não depende de mais nada.
- **A CONFERIR** — depende do arquivo, do balancete ou do plano de contas.

**Nenhum achado "A CONFERIR" deve virar retificação antes de ser conferido
contra a fonte.** Um deles aponta imposto pago a MENOR; errar o diagnóstico nos
dois sentidos é caro.

A aritmética interna da planilha **está correta**: as somas de base, os
percentuais (1,65% / 7,6%) e as subtrações fecham centavo a centavo em todos os
seis meses. **Os problemas são estruturais, não de conta.** É importante dizer
isso: quem montou a planilha não errou continha — errou o modelo, que é
justamente o que uma planilha não protege.

---

## Sumário — o que preocupa, em números

| # | Achado | Sentido do erro | Valor identificado |
|---|---|---|---|
| 1 | Saldo credor de junho tratado como imposto negativo | cliente paga **a mais** | **R$ 296.741,18** |
| 2 | Mecanismo de transporte de saldo vazio o ano inteiro | cliente paga **a mais** | estrutural |
| 3 | Crédito sobre a conta INTEIRA de compras, sem filtro de CST | risco de **crédito indevido** | **R$ 451.611,87** só em junho |
| 4 | "ICMS já deduzido" × linha de dedução de ICMS preenchida | possível **a menor** | a conferir |
| 5 | Deduções da base em branco (isentas, IPI, outras) | possível **a mais** | a conferir |
| 6 | Compras de junho 4,83× a média dos 5 meses anteriores | origem desconhecida | a conferir |
| 7 | Crédito presumido, estoque 1/12 e ajustes: linhas vazias | possível **a mais** | a conferir |

---

## CONFIRMADOS

### 1. O saldo credor de junho vira "imposto negativo" e não é transportado

A planilha calcula, em junho:

```
PIS      contribuição 27.625,58 − crédito  80.557,79 =  −52.932,21
COFINS   contribuição 127.245,10 − crédito 371.054,07 = −243.808,97
                                                TOTAL   296.741,18
```

Os dois valores aparecem na linha **"CONTR. P/ PIS A RECOLHER"** e **"CONTR.
P/COFINS A RECOLHER"**, em vermelho, como número negativo.

**Isso não existe.** Contribuição a recolher tem piso zero. Quando o crédito
supera o débito, o excedente é **saldo credor**, e ele pode ser usado nos meses
seguintes — Lei 10.637/2002 art. 3º §4º (PIS) e Lei 10.833/2003 art. 3º §4º
(COFINS).

**Consequência:** se esses R$ 296.741,18 não foram transportados para julho, o
cliente **pagou a mais** nos meses seguintes exatamente nesse valor, até o limite
dos débitos de cada mês. É dinheiro dele.

### 2. O mecanismo de transporte existe na planilha e está vazio

As linhas abaixo estão **em branco nos seis meses**:

- `TOTAL CRÉDITO MÊS ANTERIOR (1,65%)` e `(7,6%)`
- `CRÉDITOS UTILIZADOS`
- `SALDO CRÉDITO MÊS PIS` e `SALDO CRÉDITO MÊS COFINS`

Ou seja: **o controle de saldo credor foi desenhado e nunca operado.** Isso não é
um problema de junho — é do ano inteiro, e provavelmente dos anos anteriores
(as abas de 2023 e 2024 têm o mesmo layout).

O achado nº 1 é consequência direta deste: sem a linha de transporte preenchida,
não há para onde o crédito de junho ir.

### 3. O crédito é calculado sobre a conta contábil inteira, sem olhar o documento

A base de crédito é montada assim:

```
COMPRAS MERCADORIAS      (conta 1.1.4.02.0001)
+ DEVOLUÇÕES DE VENDAS   (conta 3.2.1.01.0002)
+ FRETES                 (conta 4.1.1.02.0013)
= BASE  →  × 1,65% (PIS)  e  × 7,6% (COFINS)
```

**O regime não-cumulativo não credita por conta contábil — credita por
operação.** Quem decide é o **CST de PIS/COFINS de cada item** da nota de
entrada: 50 a 56 dão direito a crédito, 70 a 75 **não dão**, 98/99 são outras
operações. Ficam de fora, entre outros:

- compras de fornecedor **optante do Simples Nacional**;
- mercadorias **monofásicas** (combustíveis, bebidas frias, autopeças, higiene);
- mercadorias com **substituição tributária** já encerrada;
- itens com CST de aquisição **sem direito a crédito**.

Todos esses estão dentro da conta "COMPRAS MERCADORIAS" e, do jeito atual,
**todos geraram crédito**. Em junho isso representa **R$ 451.611,87** de crédito
tomado sobre R$ 4.882.290,45 de base, sem nenhum filtro.

Este é o achado mais sério em termos de risco: crédito indevido é **glosa**, com
multa e juros — e o sentido do erro aqui é o oposto dos achados 1 e 2.

---

## A CONFERIR (não retificar antes de checar)

### 4. "ICMS JÁ DEDUZIDO" no cabeçalho, e a linha "(−) ICMS" preenchida

No topo da planilha está escrito **"ICMS JÁ DEDUZIDO"**. Ao mesmo tempo, a linha
`(−) ICMS` da Ficha 5 está preenchida todos os meses (janeiro: 61.883,28).

Se a receita registrada em `VENDA DE MERCADORIAS` **já vem líquida de ICMS** e o
ICMS é deduzido de novo, a base sai **a menor** e o imposto também — risco de
autuação. Se a receita vem bruta, está correto e a nota do cabeçalho é que está
desatualizada.

**Como conferir:** comparar `VENDA DE MERCADORIAS` (3.1.1.01.0002) de um mês com
o faturamento bruto do mesmo mês no livro de saídas.

### 5. Deduções da base em branco

Existem e estão vazias: `(−) RECEITAS ISENTAS`, `(−) IPI`, `(−) OUTRAS DEDUÇÕES`.

Se o cliente tem receita isenta, não-incidência ou monofásica na saída e ela não
foi excluída, o imposto foi pago **a maior**. Se não tem, está correto.

### 6. Compras de junho são 4,83× a média

```
jan 939.244,17 · fev 771.778,31 · mar 1.127.136,41 · abr 661.870,66 · mai 1.546.768,70
média jan-mai: 1.009.359,65
junho: 4.873.059,98   →   4,83× a média
```

Foi esse volume que produziu o saldo credor do achado nº 1. Pode ser real
(formação de estoque, compra sazonal) ou pode ser lançamento em duplicidade no
balancete. **Enquanto não se souber a origem, nem o crédito nem o saldo credor
estão confirmados** — e é por isso que o achado nº 1 não deve virar
compensação/retificação sem esta checagem.

### 7. Crédito presumido, estoque de abertura 1/12 e ajustes

Linhas `APURAÇÃO CRÉDITOS PRESUMIDO`, `ESTOQUES DE ABERTURA 1/12`,
`AJUSTE POSITIVO` e `AJUSTE NEGATIVO (COMPRAS ISENTA)`: todas vazias.

Se algum se aplica a este cliente, há crédito não aproveitado.

### 8. Devolução de vendas entrando na base de crédito

`DEVOLUÇÕES DE VENDAS` é conta do grupo 3 (dedução de receita) e está somada à
base de crédito. O tratamento tem amparo (Lei 10.833/03 art. 3º, VIII), **mas
não pode acontecer duas vezes**: se `VENDA DE MERCADORIAS` já vem líquida das
devoluções, creditar de novo é duplicidade — a mesma dúvida do achado nº 4.

---

## Onde cada erro empurra o imposto

| Sentido | Achados | Risco |
|---|---|---|
| **Paga a MAIS** (dinheiro do cliente parado) | 1, 2, 5, 7 | crédito perdido; recuperável por retificação |
| **Paga a MENOS** (exposição) | 3, 4 | glosa/autuação com multa e juros |

Os dois sentidos convivem na mesma planilha. É por isso que "o total parece
razoável" não prova nada: os erros se compensam sem se anular.

---

## Alcance provável

A planilha tem abas para **2023, 2024 e 2025** com o mesmo layout, e as linhas de
transporte de saldo estão vazias em todas as que dá para ver. Os achados 2, 3, 5
e 7 são **de modelo**, não de mês — então valem para todos os períodos em que
essa planilha foi usada, e possivelmente para **outros clientes** cujo
colaborador use o mesmo arquivo como base.

**Isto não é um caso isolado a corrigir: é a medida do que a centralização no CFI
tem que resolver.**

---

## O que muda quando a apuração roda dentro do CFI

| Achado | Como o CFI trata |
|---|---|
| 1 e 2 | O `lucroService` **já** nunca produz imposto negativo: converte em saldo credor e abate no mês seguinte. Falta apenas **encadear automaticamente** (hoje o saldo anterior é digitado). |
| 3 | O CST de PIS/COFINS **passou a ser capturado** do XML em 12/08. A base de crédito deixa de ser a conta contábil e passa a ser derivada **item a item**, pelo CST, com as notas de origem carimbadas. |
| 4 e 8 | Base e deduções calculadas **uma vez**, a partir de fonte definida — "já deduzido" e "deduzir" não podem coexistir. |
| 5 e 7 | Viram **parâmetros do cliente** (cadastro), não linhas que alguém lembra ou esquece de preencher. |
| 6 | Compra fora de padrão vira **alerta** contra o histórico do próprio cliente. |

---

## Para fechar este relatório preciso de

1. **O arquivo .xlsx** (não o print) — confirma os achados 4, 5, 6, 7 e 8 e
   permite ver 2023 e 2024.
2. **O balancete** de um mês qualquer de 2025 — resolve o achado 4 (receita
   bruta × líquida de ICMS) em cinco minutos.
3. **Sua decisão** sobre retificação, caso os achados 1 e 2 se confirmem: é
   competência a competência e é sua, nunca automática.
