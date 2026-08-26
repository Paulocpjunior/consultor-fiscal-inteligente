# Fontes oficiais do SPED — texto extraído

Paulo mandou os dois documentos em WORD em **20/08/2026**, depois de os links
não abrirem: a rede deste ambiente recusa qualquer domínio externo (gov.br,
Adobe, Drive — todos 403 no proxy de saída). Os `.txt` aqui são a **extração
mecânica** do texto dos `.docx`, para que a próxima sessão não dependa de ele
reenviar.

| Arquivo | O que é |
|---|---|
| `guia-pratico-efd-icms-ipi-3.2.3.txt` | **Guia Prático da EFD ICMS/IPI, versão 3.2.3** — a redação que manda hoje (mais nova que a 3.2.2 que estava no link). Traz, por registro, a descrição dos campos, a obrigatoriedade e as **Validações** — que é exatamente o que o PVA cobra. |
| `nota-tecnica-leiaute-020-2026.txt` | **Nota Técnica que institui o leiaute válido a partir de 01/01/2026** (leiaute **020**, Ato COTEPE, obrigatoriedade 01/01/2026). |

## O que estes documentos já responderam (20/08)

- ✅ **O leiaute 2026 é um não-evento para o CFI.** As mudanças do 020 são o
  `COD_DOC_IMP` do **C120** (inclusão da DUIMP) e o campo `CAP_TANQUE` no
  **1310** — dois registros que não geramos. E o `COD_VER` que o app já escreve
  (`020`) é o correto para o ano de 2026.
- ✅ **Confirmou, palavra por palavra, duas regras que eu tinha deduzido das
  recusas do PVA** (19/08): o **0150** não leva participante citado apenas em
  C100 de NFC-e, e o **C100 da NFC-e** não informa `COD_PART`,
  `VL_BC_ICMS_ST`, `VL_ICMS_ST`, `VL_IPI`, `VL_PIS`, `VL_COFINS`, `VL_PIS_ST`
  e `VL_COFINS_ST` (Exceção 9).
- 🐛 **E revelou quatro defeitos que ninguém tinha visto** — todos corrigidos
  no PR de 20/08: NFC-e escriturada na ENTRADA; C100 de nota CANCELADA saindo
  com os valores preenchidos (Exceção 1 manda os demais campos VAZIOS); `SER`
  sem as três posições (o PVA confere a série contra a que está na CHAVE); e
  a nota em substituição ao cupom fiscal (CFOP 5929/6929) saindo como
  `COD_SIT 00` em vez de **08** (Exceção 4) — com a ressalva do próprio manual
  de que o contribuinte do **Paraná** escritura por outra regra.
- 🐛 **E o quinto, achado no teste da PWR no mesmo dia: o `VL_OPR` do C190 não
  é a soma dos `vProd`.** Campo 05 do C190: ele soma frete, seguro, outras
  despesas acessórias, ICMS-ST, FCP-ST e o **IPI destacado**, menos o desconto
  incondicional. O livro do CFI dizia 71.960,81 e o relatório do PVA sobre o
  arquivo dizia 69.760,36 — a diferença era o IPI. E o Campo 12 do C100
  (`VL_DOC`) fecha a conta: em **2026** ele tem que ser igual à Σ `VL_OPR` dos
  C190 filhos. ⚠️ **O PVA não recusa por isso** — só imprime um total menor.

## Como usar

Regra nova entra em `sefaz-backend/sped-prevalidacao.js` (o "PVA de bolso") ou
no gerador, **sempre com a citação** — o item do Guia e o trecho literal. É a
mesma disciplina do catálogo de CFOP: regra sem fonte é chute com cara de
validação, e validação errada manda consertar o que está certo.

Para achar uma regra: `grep -n "Validação" guia-pratico-efd-icms-ipi-3.2.3.txt`
ou procure por `REGISTRO C100:` / `Campo 04 (COD_PART)`.

⚠️ **Estes arquivos são texto extraído, não o PDF oficial.** A formatação de
tabela virou ` | ` entre células, então a leitura é boa para as regras em prosa
(que é o que interessa) e imprecisa para contagem de campos. Onde a contagem
importar, o gabarito continua sendo **arquivo aceito pelo PVA**.

---

# EFD-Contribuições — as fontes chegaram em 25/08/2026

Paulo mandou os dois em WORD, depois de um dia inteiro no qual **eu citei o Guia
do EFD ICMS/IPI para argumentar sobre o EFD-Contribuições** — o erro do 1010 e
do 0500 (mesmo registro, arquivo diferente, leiaute diferente), desta vez meu.

| Arquivo | O que é |
|---|---|
| `guia-pratico-efd-contribuicoes-1.35.txt` | **Guia Prático da EFD-Contribuições, versão 1.35 (18/06/2021)** — PIS/Pasep, Cofins e CPRB. Por registro: descrição dos campos, obrigatoriedade e as **Validações**. |
| `manual-efd-contribuicoes-lucro-presumido-pva-2.04.txt` | **Manual de Escrituração para PJ do Lucro Presumido, PVA 2.04** — descreve como o PVA se comporta, que é a régua prática (Paulo: *"assim temos um parâmetro de como eles analisam, e usamos a mesma base do PVA dele"*). |

## O que estes documentos responderam no MESMO dia

- 🚨 **`VL_REC_BRT` do M210 é a Σ VL_ITEM dos C170.** Campo 03, *Validação*:
  *"o valor do campo será igual à soma dos seguintes campos … VL_ITEM dos
  registros C170 … [IND_OPER do C100 = 1]"*. Era a resposta dos **cinco dias**
  da PWR: o arquivo dizia 37.754,60 e o PVA insistia em 38.316,84 porque é esta
  a soma que ele valida.
- 🚨 **`VL_ITEM` (C170 campo 07) é BRUTO** — *"somente o valor das mercadorias
  (equivalente à quantidade vezes preço unitário)"* —, com a validação *"a soma
  de valores dos registros C170 deve ser igual ao valor informado no campo
  VL_MERC do registro C100"*. Isso **desmentiu** a correção que eu tinha
  acabado de subir (VL_ITEM líquido), e ela foi revertida.
- 🚨 **Seção 12 — onde entra cada exclusão**, em tabela: no **C170**, *exclusão
  do ICMS* → **campo 15 (VL_ICMS)** e *descontos incondicionais* → **campo 08
  (VL_DESC)**. É de lá que o PVA monta a base.
- ✅ **O `VL_BC_CONT` do M210 é RECUPERADO do `VL_BC_PIS`** dos blocos A/C/D/F
  com o mesmo CST — o que explica a base 30.958,77 na tela da Sandra.
- ✅ **O PVA gera o bloco M sozinho**: *"O PVA, versão 2.04, gera automaticamente
  os registros consolidadores do Bloco M: M200, M600, M400 e M800, bem como o
  P200"* (Manual do Lucro Presumido). Escrever outro valor no campo é escrever
  onde ele sobrescreve.
- ✅ **A contribuição sai da base × alíquota, nunca do destacado no documento**:
  *"O cálculo do valor da contribuição … é efetuado mediante a multiplicação dos
  campos de base de cálculo totalizados no bloco M e as respectivas alíquotas"*.

📌 **REGRA QUE FICA: antes de citar uma validação, conferir de QUAL família é o
Guia.** As duas famílias têm registros com o mesmo número e regras diferentes, e
agora as duas fontes estão aqui — não há mais desculpa para deduzir.
