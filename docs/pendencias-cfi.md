# Pendências do CFI — o que falta e quem resolve

<!-- guia-id: pendencias-cfi · guia-revisao: 2026-09-11 -->
<!-- Mexeu aqui? mexa no par em public/pendencias-cfi.html e suba a revisão nos DOIS. -->

> Fonte dupla: este arquivo e `public/pendencias-cfi.html` DEVEM ser atualizados
> juntos. Material da equipe NUNCA vai como link de chat — o link é privado de
> quem publicou, e o colaborador recebe "link inválido". O trilho é HTML
> estático em `public/`, servido pelo próprio app.

**Medido em 11/09/2026**, contra o código, não contra anotação antiga.
A ordem é por **quem resolve**, porque é isso que decide a próxima ação.

Estado da árvore no dia: 516 suítes e 7.755 testes verdes, lint e build limpos,
zero vulnerabilidade em 412 dependências de produção.

---

## 🔴 Só o Paulo resolve

- **SPED da distribuidora: regerar e reconferir no PVA.** Os 493 erros de
  código de participante nas entradas eram do gerador (C100 da nota capturada
  pela SEFAZ saía sem o CNPJ do fornecedor). Corrigido em 11/09; informar os
  itens das notas mistas (✂️ por item), regerar e validar. Se sobrar COD_MUN
  no 0150, rodar ♻️ Reler participante dos XMLs.

Nenhum é trabalho de código: são leituras de painel, cliques em produção ou
acessos que o desenvolvimento não tem.

| Item | Por que importa |
|---|---|
| **SPED entregue com nota tirada do livro** (03/09 a 10/09) | A retirada valia na tela e não no arquivo. Regerar e conferir competência por competência — o app não sabe quais foram transmitidas. |
| **NOVA ERA: 6 produtores fora do FUNRURAL** | Foram tirados por engano; eram notas próprias de entrada, que devem gerar sub-rogação. O FUNRURAL sai a menor até voltarem. |
| **EXPERTE: captura bloqueada** | Zero documento com IPI apurado na ficha. Segura a prova final do E510. |
| **PS VIDROS: contribuinte de IPI = Não** | Sem isso o E500/E520 sai num comércio e o PVA recusa. |
| **VINATEX 08/2026: evento no e-CAC** | O `MS1028` diz que o evento já existe. Só o recibo responde. |
| **JOAO EVANGELISTA: cadastro duplicado** | Conferir que a exclusão aguenta recarregar e outro navegador. |
| **Rotação do segredo do cron** (desde 27/07) | O valor vazou duas vezes em colagem. ⚠️ Variável trocada nasce a 0% de tráfego neste serviço. |
| **Bloco K: ler o número da fila de migração** | Zero empresa e o bloco é descartável; uma que seja e vira alvo. |
| **DeRE: 3 pré-requisitos e 4 schemas** | Piloto, procuração e credencial. Primeira competência 10/2026, entrega 13/11. |

## 🟠 Decisão do Paulo

- **Converter os outros CST na correlação de CFOP.** Hoje a régua converte `00`
  e `20` e preserva `40`, `41`, `50`, `51`, `60` e `70` de propósito: cada um
  declara um fato que o `90` apagaria. *A pergunta: existe fornecedor em que o
  certo é converter um desses?*
- **Dívida técnica de junho: atacar ou deixar.** Refatorações de dias num app
  fiscal em produção. Medidas e piorando, mas nenhuma quebrando nada hoje.

## ⚪ Com o desenvolvimento, já nomeado no código

Nenhum é esquecimento: cada um está escrito dentro do módulo, com o motivo.
**O app não afirma o que não sabe em nenhum deles.**

- **Robô de auditoria travado** — o GitHub não dá à automação a permissão de
  abrir pedido de alteração. Re-medido em 04/09: a configuração de agosto não
  está em vigor. Uma sonda mede isso sob demanda.
- **Código de ISS retido de Barueri** — a coluna vem `"2"` e o significado não
  está provado. O app guarda o valor cru. Fecha com uma nota que tenha retenção.
- **TXT de lote de Barueri** — largura fixa, amostra pequena, campos sem
  significado provado. A recusa manda usar o CSV do mesmo portal.
- **Tamanho do campo de observação do R-2010** — o teto de 97 é piso *provado*
  por evento aceito, não o número do leiaute. Acima disso vira dedução, e
  dedução ali devolve o lote inteiro.
- **Três partes do SPED sem recibo** — bloco D do EFD-Contribuições, E510 de IPI
  e E200/E210 de ST. Gerados e conferidos internamente; prova só vem do recibo.

## ✅ Fechado em 11/09

- **CFOP e CST por ITEM** — a nota mista (item com ST e item sem) recebe um
  CFOP/CST por produto no ✂️ do detalhe da nota. O item vence a nota; vale no
  Livro, no Resumo, no SPED e no SAGE.
- **C100 sem COD_PART nas entradas capturadas** — o dono da contraparte passou
  a ler a forma achatada; regra nova na prevalidação das duas famílias.

- **Nota gravada no mês errado** agora tem correção: Central de Documentos →
  XMLs → **📅 Competência do acervo**. Uma nota por clique, com motivo escrito,
  e a consequência dita antes: corrigir muda os DOIS meses.
- **A direção do documento** parou de sair do campo gravado em cinco leitores
  que decidiam livro, imposto ou farol.

## 📊 Tendência medida

| Medida | Antes | Hoje |
|---|---:|---:|
| Erros de acesso a índice sem checagem | 1.031 | 1.102 |
| Telas acima de 800 linhas | 11 | 15 |
| Leituras cruas da direção do documento | 60 | 0 |

A última estava nomeada desde agosto com o número escrito, e em vinte dias
cresceu de 60 para 97 sem ninguém reabrir. **Pendência nomeada e não travada
cresce** — por isso ela agora tem varredura que impede a volta.
