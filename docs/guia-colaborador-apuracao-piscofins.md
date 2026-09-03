# Apuração de PIS/COFINS — o que muda, e o que preciso saber de você

<!-- guia-id: piscofins · guia-revisao: 2026-09-04 -->
<!-- Mexeu aqui? mexa no par em public/ e suba a revisão nos DOIS. -->

> **Fonte dupla.** Este arquivo e `public/guia-apuracao-piscofins.html` são o
> MESMO documento — atualizar os dois juntos. O HTML é o que vai ao colaborador
> (servido pelo próprio app; link de artifact chega como "link inválido" pra ele).
>
> Caso: Cliente A (nome e valores ILUSTRATIVOS, arredondados — a aritmética
> é a mesma da planilha real), ano-calendário 2025. Documento de conversa, não de
> auditoria. O relatório técnico, com os níveis de prova, é o
> `docs/achados-apuracao-piscofins-planilha.md`.

## Antes de tudo: a planilha não tem erro de conta

A aritmética foi refeita mês a mês: somas da base, percentuais de 1,65% e 7,6% e
subtrações **fecham centavo a centavo nos seis meses**. Isso é o diagnóstico, não
consolo — o que precisa mudar não é a conta da pessoa, é que **planilha não olha
dentro da nota fiscal, não sabe quem é o fornecedor e não segura saldo de um mês
para o outro**.

## Ponto 1 — Em junho sobrou crédito, e ele não foi para julho

| | PIS | COFINS |
|---|---|---|
| Contribuição do mês | 26.400,00 | 121.600,00 |
| Crédito do mês | 66.000,00 | 304.000,00 |
| **Resultado** | **−39.600,00** | **−182.400,00** |

Contribuição a recolher não pode ser negativa: o excedente é **saldo credor**,
utilizável nos meses seguintes (Lei 10.637/2002 art. 3º §4º e Lei 10.833/2003
art. 3º §4º). São **R$ 222.000,00**.

As linhas "TOTAL CRÉDITO MÊS ANTERIOR", "CRÉDITOS UTILIZADOS" e "SALDO CRÉDITO
MÊS" existem na planilha e estão **em branco nos seis meses** — o controle existe
no arquivo e nunca foi usado. Falta de ferramenta, não de atenção.

**No CFI:** nunca mostra imposto negativo; converte em saldo credor e abate
sozinho no mês seguinte.

## Ponto 2 — O crédito sai da conta inteira de compras

```
COMPRAS MERCADORIAS      (1.1.4.02.0001)
+ DEVOLUÇÕES DE VENDAS   (3.2.1.01.0002)
+ FRETES                 (4.1.1.02.0013)
= BASE  →  × 1,65% e × 7,6%
```

O não-cumulativo **credita por operação, não por conta contábil** — quem decide é
o CST de PIS de cada item. Não geram crédito: fornecedor optante do Simples,
mercadoria monofásica, mercadoria com ST encerrada e CST 70-75. Todas estão
dentro de "COMPRAS MERCADORIAS". Só junho: **R$ 370.000,00** sem filtro.

Este é o ponto de risco para o escritório (crédito indevido = glosa) e empurra o
imposto no sentido **oposto** ao do ponto 1 — por isso "o total parece razoável"
não prova nada.

**No CFI:** base derivada item a item das notas capturadas, com o motivo ao lado
de cada valor. O colaborador **confere**, não digita.

## Ponto 3 — Onde o sistema vai dizer "não sei"

Notas capturadas antes de 08/2026 não têm o CST de PIS gravado. Para elas o CFI
mostra um terceiro grupo: **indefinido**. "Não sei" **nunca** vira "credita", e
enquanto houver valor ali o sistema avisa que o número não fecha a apuração —
tratar dúvida como crédito é o que a planilha fazia sem querer.

Resolve-se sozinho: o XML original está no Storage e é reprocessado. Não se pede
nada ao cliente.

## As 5 perguntas para o colaborador

1. **A receita da conta 3.1.1.01.0002 vem com ICMS ou já sem?** O cabeçalho diz
   "ICMS JÁ DEDUZIDO" e a linha "(−) ICMS" está preenchida todo mês. Se as duas
   coisas forem verdade, a base sai a MENOR — e o imposto também.
2. **Essa receita já vem líquida das devoluções de venda?** A devolução aparece
   somada à base de crédito; correto, desde que não tenha sido abatida da receita.
3. **O cliente tem receita isenta / não tributada / monofásica na saída?** As
   linhas de dedução estão em branco.
4. **As compras de junho foram mesmo 4× a média?** (jan-mai: 1.000.000,00 ·
   jun: 4.000.000,00). Foi esse volume que gerou todo o saldo credor do ponto 1 —
   estoque, compra específica, ou duplicidade no balancete?
5. **Fretes e combustível chegam como nota fiscal ou só no balancete?** Decide se
   a base sai inteira do CFI ou se parte vem do módulo Contábil.

## O que muda na rotina

| Hoje | No CFI |
|---|---|
| Montar a base somando contas do balancete | Base vem pronta das notas; confere e ajusta |
| Lembrar de transportar o saldo credor | O saldo anda sozinho |
| Saber de cabeça o que não dá crédito | O sistema separa e diz o motivo |
| Uma planilha por cliente, por ano | Apuração no cliente, com histórico |

**O que não muda:** ninguém precisa aprender regra fiscal nova. O objetivo é o
contrário — tirar do ombro da pessoa o que hoje depende de ela lembrar.
