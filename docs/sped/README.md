# Fontes oficiais do EFD ICMS/IPI — texto extraído

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
