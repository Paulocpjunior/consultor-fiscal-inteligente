# Guia do Colaborador — XML de cliente entra pelo CFI (ponte com o IOB Sage)

> Fonte dupla: este arquivo e `public/guia-ponte-sage.html` DEVEM ser
> atualizados juntos (mesma regra dos demais guias).

## A regra da casa (Paulo, 10/08/2026)

**XML de cliente NUNCA entra direto no IOB Sage (e-Fiscal).** Todo arquivo
entra pelo CFI, e o e-Fiscal recebe o **.FML do Exportar SAGE**. Sem exceção —
inclusive quando "é só um zip pequeno".

## Por que a regra existe (o caso que a criou)

Em 10/08/2026 um cliente mandou um zip com **3.855 XMLs** de NF-e (mod 55).
A importação direta no Sage acusava "erros de schema", principalmente nas
notas canceladas, e a primeira leitura foi "cadastro sujo do cliente".

A análise mostrou o contrário: **os arquivos estavam limpos** (assinados,
campos válidos, itens completos). O problema era UM só, de FORMA: o ERP do
cliente exporta a nota cancelada no **formato legado (pré-2012)** — o
`nfeProc` sai com o protocolo de **cancelamento** (`cStat 101`) no lugar do
protocolo de autorização, e **sem o arquivo de evento** de cancelamento que o
padrão atual exige. O importador do Sage espera o padrão atual e recusa as
260 canceladas como "erro de schema".

O CFI lê o formato legado nativamente (`cStat 101` → status **cancelado**), e
o Exportar SAGE grava a nota cancelada como **situação 2** do layout .FML —
que não passa pela validação de schema de XML do Sage. O mesmo lote que
travava o Sage passou inteiro pela ponte.

## O rito, passo a passo

1. **Importar no CFI**: Central de Documentos Fiscais → **Importar →
   Manual & Cofre** → subir o zip do cliente. O CFI aceita, classifica,
   marca canceladas e acusa problema REAL com a ação ao lado.
2. **Conferir**: a lista de XMLs da competência deve bater com o volume
   esperado; canceladas aparecem com o selo próprio. Buraco de numeração se
   confere no relatório **🚫 Canceladas/Faltantes**.
3. **Exportar**: Central → **Integrações → SAGE → Exportar SAGE** →
   competência → gerar o **.FML** (o Nº Empresa sai do Cod.Cliente do
   cadastro, sozinho).
4. **Importar o .FML no e-Fiscal** e conferir o log da importação (o leitor
   de log do CFI traduz as ocorrências).

## O que NÃO fazer quando o Sage acusar erro no XML

- **Não corrigir lançamento à mão** por causa de erro de importação de XML —
  primeiro rode o lote pela ponte.
- **Não pedir "outro arquivo" ao cliente** — o ERP dele gera assim mesmo;
  reimportar o mesmo original dá o mesmo erro.
- Erro que persistir DEPOIS da ponte é caso real: abre com o admin, com o
  log do e-Fiscal em mãos.
