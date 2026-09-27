# Guia do Colaborador — DeRE: testar o plano de contas e o balancete

<!-- guia-id: dere-planilha · guia-revisao: 2026-09-27 -->

> **PAR OBRIGATÓRIO.** Este arquivo e `public/guia-dere-planilha.html` se
> atualizam JUNTOS — o teste `guiaParDuplo` barra o build se as revisões
> divergirem. Metade órfã é o pior desfecho: ou o texto que ninguém acha, ou o
> procedimento que a equipe nunca vê.

---

## O que o colaborador precisa saber antes de tudo

A DeRE declara **plano de contas e balancete**, não retenções. O D-1011 é o
plano de contas comentado (PGCC) e o D-1101 é o balancete do mês. O CFI monta
os dois a partir da **planilha que a contabilidade exporta** e confere o XML
contra o schema oficial. **Nada é transmitido** — é prévia. A planilha é lida no
navegador; só as linhas vão ao servidor, que não as guarda. O bloco é só para
**admin** (⚙️ Config Admin → 🏦 DeRE).

## Passo a passo do teste

Onde: ⚙️ Config Admin → 🏦 DeRE → Consultar → **📥 Prévia do D-1011 (PGCC) e do
D-1101 (Balancete)**.

1. Escolha a declaração (raiz do CNPJ).
2. Plano referencial **2 — ANS** para operadora de saúde (outros regimes: o
   contador afirma).
3. Encerramento das contas de resultado: comece por **A — Anual**.
4. Início da validade do PGCC: **01/10/2026**.
5. Suba o plano de contas (Conta Contábil · Descrição · Conta de Lançamento S/N ·
   Tipo C/D) e o balancete analítico (Código · Conta · Saldo Inicial · Débitos ·
   Créditos · Saldo Final). Competência em branco: o título do balancete diz.
6. Marque a hipótese da conta referencial e clique em **👁 Prévia**.

## O que é resultado certo

| Teste | Como fazer | Esperado |
|---|---|---|
| 1. Caminho feliz | Anual + hipótese marcada | ✓ XML conferido nos dois eventos; avisos com contagem (analíticas sem codTrib, contas fora do PGCC, sintéticas fora) |
| 2. Frequência errada | Trocar para M — Mensal | D-1101 **recusado**, dizendo quantas contas de resultado têm saldo inicial ≠ 0 e quais frequências o balancete admite. Se passar, é defeito |
| 3. Sem conta referencial | Desmarcar a hipótese | D-1011 **recusado**, dizendo quantas contas estão sem conta referencial |

Se algo sair diferente: print inteiro da tela com a versão do app (rodapé → 📗
Como conferir uma entrega) e o número do teste. Não descreva, mande o print.

## Por que o app recusa em vez de completar

- **{cCtaRef}**: código do Plano de Contas Padrão da ANS — a Receita chama a
  tabela de "referência externa". O app não adivinha; a hipótese do 1º segmento
  sai carimbada como hipótese.
- **{codTrib}** (Tabela 11): sem ele o PGCC é aceito com aviso, mas os
  condicionais (D-1106, D-1121, D-2101) não se detectam e a base sai zero.
- **Frequência de encerramento**: o balancete prova o que NÃO é; o que É, o
  contador afirma.
- **Compensação e apuração do resultado**: o leiaute só tem natureza para
  ativo, passivo, PL, receita e despesa. Ficam fora, contadas.

## O que pedir ao contador do cliente

A mesma exportação do plano com duas colunas a mais: **Conta Referencial** e
**Código de Tributação** (Tabela 11, 9 dígitos, nas analíticas). E duas
confirmações: a frequência de encerramento e o tratamento de compensação e
apuração. Na dúvida, não preencher por conta própria — coluna errada vira XML
aceito com dado errado.
