# Guia do Colaborador — CFOP por nota e o cérebro do fornecedor

<!-- guia-id: cfop-por-nota · guia-revisao: 2026-08-18 -->

> **PAR OBRIGATÓRIO.** Este arquivo e `public/guia-cfop-por-nota.html` se
> atualizam JUNTOS — o teste `guiaParDuplo` barra o build se as revisões
> divergirem. Metade órfã é o pior desfecho: ou o texto que ninguém acha, ou o
> procedimento que a equipe nunca vê.

---

## O que o colaborador precisa saber antes de tudo

**O XML da compra traz o CFOP do FORNECEDOR, não o nosso.** Quando a Kalunga
vende papel, ela emite `5102` — *para ela* é venda de mercadoria. O que o nosso
cliente vai fazer com aquele papel (uso e consumo) **não está escrito em campo
nenhum da nota**.

Por isso o CFI aplica uma régua automática pelo **ramo da empresa** (comércio
compra para revender, indústria para industrializar) e **acerta na maioria**.
Onde ela erra, quem corrige é a pessoa — e agora dá para ensinar o sistema.

**Onde a régua erra com mais frequência:** material de escritório, combustível,
peças, produto de limpeza e computador. Tudo isso o fornecedor vende como
mercadoria, e o cliente usa ou imobiliza.

## Onde fica

**Relatórios → ✏️ CFOP por nota** — competência + empresa. Uma linha por nota,
com o CFOP que a régua escreveu, o que aquele CFOP significa, e o campo para
corrigir.

A mesma lista aparece em **Simples → detalhe da empresa → 🔄 Correlação de CFOP
→ aba 🧠 Por fornecedor**. É o mesmo painel nos dois lugares (componente único —
duas cópias fariam uma tela listar parâmetro que a outra não conhece).

## Corrigir uma nota

1. Abrir **Relatórios → ✏️ CFOP por nota**.
2. Achar a nota. A coluna **"O que esse CFOP é"** mostra a descrição oficial do
   que a régua escreveu — é ali que o erro aparece (*"1101 — Compra para
   industrialização"* numa nota de material de escritório salta aos olhos).
3. Digitar o CFOP certo em **CFOP informado** e sair do campo (ou Enter). Grava
   na hora.
4. O CFI pergunta se deve aplicar às próximas notas do fornecedor.

**Para desfazer:** apagar o campo e sair dele — a nota volta para a régua
automática, e o carimbo de quem informou sai junto.

⚠️ O CFOP informado vale para **TODOS os itens daquela nota** (decisão do Paulo
em 17/08: *"é por NF"*). Nota com itens de CFOPs diferentes aparece marcada
**⚠ mista**, listando o que o carimbo vai colapsar — a consequência é dita
ANTES do clique.

## O cérebro

Depois de corrigir, o CFI oferece guardar aquilo como **parâmetro do
fornecedor**. As **próximas** notas daquele fornecedor já chegam com o CFOP
certo.

| Responde | Quando |
|---|---|
| **Sim, aprender** | Tudo daquele fornecedor tem o mesmo destino — posto, papelaria, autopeças, limpeza. É quase sempre o caso. |
| **Só nesta nota** | Foi exceção. |

Também dá para cadastrar **sem esperar uma nota**: no modal 🔄 → aba 🧠, a lista
de fornecedores vem das notas reais da empresa, ordenada por volume.

Se o fornecedor manda coisas com destinos diferentes, escolher também o **CFOP
de origem** — o parâmetro só vale quando ele emitir *aquele* CFOP. Deixando
"qualquer CFOP", vale para tudo dele.

## Três coisas que o parâmetro NÃO faz

- **Não mexe no passado.** Vale da competência de início em diante. Mês já
  entregue não muda de CFOP sozinho — o SPED daquele mês já foi transmitido.
- **Não passa por cima da nota.** Precedência: **NF > cérebro > override da
  empresa > régua automática**. Quem olhou a nota foi a pessoa.
- **Não aprende sozinho.** Só grava o que alguém mandou gravar. O CFI não
  adivinha destino por produto nem por NCM — acertaria na maioria e erraria em
  silêncio na minoria, e num livro fiscal o erro silencioso é o caro.

**Desligar não apaga**: o parâmetro fica riscado na lista, porque ainda explica
por que as notas dos meses anteriores saíram daquele jeito.

## Quando aparecer "NÃO CONSTA na tabela em vigor"

O CFOP escrito **não existe** na tabela oficial (Ajuste SINIEF 03/24). Acontece
porque a conversão automática, em algumas famílias, produz código sem par na
entrada.

**O que fazer:** informar o CFOP certo nota a nota, ou cadastrar o parâmetro do
fornecedor. O CFI **não escolhe o substituto** — escolher seria inventar, e é
inventar que gera esses códigos.

Se for muita coisa, avisar o time antes: pode ser uma família inteira, e aí o
conserto é no sistema, não na unha.

## A coluna Origem

| Origem | Quer dizer |
|---|---|
| informado nesta NF | Alguém digitou nesta nota. Mostra quem. |
| parâmetro do fornecedor | Veio do cérebro. Mostra o escopo e desde quando. |
| override da empresa | Veio do mapa CFOP→CFOP da aba 🔄. |
| correlação automática | A régua padrão, pelo ramo. |

## Onde a correção aparece depois

Em **todos** os lugares que geram documento:

- Livro de Entradas/Saídas
- Resumo por CFOP e Por produto
- **SPED Fiscal** (C170 e C190) e o E510 do IPI
- **Exportar SAGE** — o `.FML` e a planilha

Ou seja: **o que se confere aqui é o que vai no arquivo.** Não existe "corrigir
na tela e o SPED sair com o antigo" — está travado por varredura em
`cfopPorNota.test.ts`.

## Dúvidas que vão aparecer

**Preciso corrigir nota por nota todo mês?** Não. Corrige uma vez e manda
aprender. Em um cliente real, **10 fornecedores respondiam por dois terços** das
notas que precisavam de correção.

**Corrigi e o número não mudou.** Recarregar a aba; conferir a competência — o
parâmetro só vale da competência de início em diante.

**E se errar o parâmetro?** Desligar na lista e criar o certo.

**Vale para saída?** Não. Na saída o CFOP é o da nota que o próprio cliente
emitiu — o CFI não mexe.

⚠️ Na dúvida sobre **qual** CFOP é o certo, não chutar: falar com o responsável
pela carteira. Errar o CFOP não trava nada na hora — aparece na fiscalização.
