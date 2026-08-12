# Manual do Mês — EFD-Reinf e DCTFWeb, departamento por departamento

<!-- guia-id: ordem-do-mes · guia-revisao: 2026-08-13 -->
<!-- Mexeu aqui? mexa no par em public/ e suba a revisão nos DOIS. -->

> Fonte do guia servido em `/guia-ordem-do-mes.html`.
> **Atualizar os DOIS juntos** — o teste `guiaParDuplo` barra o build se as
> revisões divergirem.

---

## A REGRA DE OURO

**A DCTFWeb é UMA declaração do CNPJ, e TRÊS departamentos a alimentam.**

Contábil, Pessoal e Fiscal mandam informação para a **mesma** declaração, em
datas diferentes do mês. Por isso existe uma ordem — e por isso duas coisas que
parecem a mesma são **obrigações diferentes**:

| | o que é | quem pode |
| --- | --- | --- |
| **Gerar a guia (DARF)** | sai com a declaração **EM ANDAMENTO** | qualquer departamento, a qualquer hora |
| **Transmitir a declaração** | **FECHA** a competência | **só o Fiscal** |

> 🚨 **Transmitir para "conseguir a guia" é o erro que este manual existe para
> impedir.** A guia sai sem transmitir. Quem transmite antes da hora fecha a
> competência para os outros dois departamentos e obriga retificadora.

O app aplica isso: quem não é do Fiscal **não consegue** transmitir, e a recusa
aponta a guia — que é o que a pessoa quase sempre queria.

---

## ANTES DE COMEÇAR O MÊS — parametrização

Sem isto, nada abaixo funciona. Confira **uma vez por cliente**, e de novo
sempre que algo mudar.

| O quê | Onde | Sem isso… |
| --- | --- | --- |
| **Certificado A1 válido** | Fiscal → Cofre de certificados | Nada transmite. Filial usa o da matriz pela raiz do CNPJ |
| **Procuração e-CAC** para a SP Contábil | e-CAC do cliente | O SERPRO recusa a consulta |
| **R-1000 aceito** (cadastro do contribuinte no Reinf) | Contábil → EFD-Reinf → R-1000 | O movimento é rejeitado em lote |
| **Departamento do colaborador** | Fiscal → Gerenciar Usuários (chips azuis) | A pessoa não entra no módulo, e o Fiscal não consegue transmitir |
| **Regime da empresa** | Fiscal → Dados Fiscais | O mês nasce sem as obrigações do regime |
| **Responsável pela carteira** | Fiscal → Carteira → Atribuição | O envio ao cliente sai da caixa errada |

---

## O MÊS, EM ORDEM

```
  Dia 1  ──────────────────────────────────────────────────────────────
         O cron cria as tarefas do mês (Vencimentos e Obrigações)

  Ao longo do mês ─────────────────────────────────────────────────────
    👥 PESSOAL   fecha a folha  →  eSocial  →  Reinf (se houver)
    📊 CONTÁBIL  aluguéis e dividendos  →  Reinf (R-4010 + R-4099)
    🧾 FISCAL    serviços tomados e produtor rural  →  Reinf (R-2010/R-2055)

  Precisa pagar antes? ────────────────────────────────────────────────
         Qualquer departamento GERA A GUIA com a declaração em andamento.
         NÃO transmita.

  Fechamento ──────────────────────────────────────────────────────────
    🧾 FISCAL    apura e encerra o MIT  →  confere os débitos
                 →  TRANSMITE a DCTFWeb  →  gera a guia definitiva
```

---

## 📊 DEPARTAMENTO CONTÁBIL

### Parte 1 — EFD-Reinf (no **Consultor Contábil**)

**IRRF de aluguéis pagos a pessoa física (R-4010)**

1. Abra **EFD-Reinf → R-4010**
2. Informe o CNPJ da empresa e a competência
3. Lance os locadores por **um** dos três caminhos:
   - **importar planilha** (o app lê as colunas de CPF, nome e valor)
   - **lançamento manual**, locador a locador
   - **lançamento unitário** (`R-4010 unitário`), para um pagamento avulso
4. Confira o **IRRF calculado** — a tabela progressiva de 2026 já está no app,
   com a dedução mensal
5. **Acúmulo de IRRF:** quando o imposto do locador fica abaixo do mínimo de
   recolhimento, ele **não some** — o app acumula para a competência seguinte.
   Confira a lista de acúmulos antes de fechar
6. **R-4099** (fechamento dos eventos R-4000) é o que dá o "ponto final" no
   movimento do mês. Sem ele, o que você mandou não é considerado

**Dividendos**

7. Abra **EFD-Reinf → Dividendos**, informe o beneficiário e o valor pago
8. O app aplica a regra: **acima de R$ 50.000,00 no mês** para o mesmo
   beneficiário, incide **IRRF de 10%** sobre o valor
9. Abaixo do limite, **não gera guia** — e isso está certo. Não force
10. Acima do limite, a guia sai pelo caminho normal de DARF

> ⚠️ Aplicações financeiras têm tela própria (**Aplicações**) com o mesmo rito:
> lançar → conferir → registrar.

### Parte 2 — DCTFWeb (no **Consultor Fiscal**)

11. Abra **DCTFWeb → o cliente → a competência**
12. Clique em **Ver débitos apurados** e confirme que o que você mandou no
    Reinf **apareceu** (IRRF de aluguéis costuma sair no código 3208; de
    dividendos, conforme a natureza)
13. **Precisa da guia agora?** Gere o DARF. A declaração fica **em andamento** e
    a guia é válida
14. **NÃO transmita.** Se aparecer bloqueio, está funcionando — a transmissão é
    do Fiscal

> Se o débito **não** apareceu: o evento pode não ter sido aceito, ou o R-4099
> não foi transmitido. Volte ao Reinf e confira o recibo antes de qualquer
> outra coisa.

---

## 👥 DEPARTAMENTO PESSOAL / FOLHA

1. Feche a **folha do mês**
2. Transmita o **eSocial** — é ele que leva a folha para a DCTFWeb
3. Se houver retenção previdenciária que seja do seu escopo, trate no
   **EFD-Reinf**
4. No **Consultor Fiscal → DCTFWeb**, confira em **Ver débitos apurados** que a
   parte previdenciária apareceu (CPP, segurados, terceiros)
5. **Precisa da guia?** Gere o DARF com a declaração em andamento
6. **NÃO transmita** — mesmo motivo do Contábil

> O eSocial **fechado** é pré-requisito da DCTFWeb. Se o fechamento não foi
> feito, os débitos da folha não aparecem e a declaração sairia a menor.

---

## 🧾 DEPARTAMENTO FISCAL

### Parte 1 — EFD-Reinf

1. **Serviços tomados (R-2010)** — retenção previdenciária de 11% sobre cessão
   de mão de obra e empreitada (limpeza, vigilância, conservação)
2. **Aquisição de produção rural (R-2055)** — o FUNRURAL sub-rogado. O cálculo
   vem pronto do Consultor Fiscal (aba 🌾); **não recalcule do outro lado**
3. **Retenções de PJ (R-4020)** — as NFS-e tomadas com retenção federal, também
   lidas do Consultor Fiscal

### Parte 2 — MIT e o fechamento da DCTFWeb

4. **Apure o MIT** (DCTFWeb → MIT → Apuração) e confira tributo a tributo
5. **Encerre o MIT** — é ele que leva os débitos próprios (IRPJ, CSLL, PIS,
   COFINS, IPI) para a DCTFWeb
6. Volte à DCTFWeb e clique em **Ver débitos apurados**. Confira que estão lá:
   - a **folha** (veio do eSocial — Pessoal)
   - os **aluguéis e dividendos** (vieram do Reinf — Contábil)
   - os **serviços e produtor rural** (vieram do Reinf — Fiscal)
   - os **tributos do MIT** (você acabou de encerrar)
7. **Agora sim: transmita.** O app vai perguntar se algum insumo ainda está
   pendente
8. Gere a **guia definitiva** e siga o rito de envio ao cliente (arquivo no
   SharePoint → gestor em cópia → baixa da obrigação)

> **Insumo pendente NÃO bloqueia a transmissão** — mas exige **justificativa
> escrita**, que fica gravada com o seu nome. É decisão consciente: perder o dia
> 15 por um insumo que talvez não venha é multa certa; retificadora é barata.

---

## QUANDO O INSUMO CHEGA DEPOIS

Acontece: o Contábil manda um aluguel no dia 20, e a DCTFWeb foi transmitida no
dia 14.

1. O app **acende sozinho**: "precisa de retificadora"
2. Retificar **é transmitir de novo** — o e-CAC monta a nova declaração com o
   insumo que chegou depois
3. O app exige **motivo** e grava a auditoria **antes × depois**
4. Transmitir de novo **sem dizer que é retificadora é recusado**. Retificar às
   escondidas não pode

> O app **não promete prever** o resultado da retificadora: os débitos são
> montados pela Receita a partir do eSocial/Reinf/MIT. Se a retificadora sair
> **sem efeito**, é sinal de que o insumo ainda não chegou na Receita.

---

## O QUE NÃO FAZER — em qualquer departamento

- ❌ **Transmitir para conseguir a guia.** A guia sai com a declaração em
  andamento
- ❌ **Recalcular no Reinf o que o Fiscal já apurou.** Dois números para o mesmo
  fato é o pior defeito de um arquivo fiscal
- ❌ **Preencher campo por cima para "destravar".** Campo em branco acende
  alerta de propósito
- ❌ **Concluir "não tem" a partir de tela vazia.** Vazio pode ser ausência de
  operação *ou* falha de captura — o app diz qual é, leia a frase
- ❌ **Inventar código de tabela** (`tpServico`, `indAquis`, natureza do
  rendimento). Se o app pede, é porque não dá para deduzir

---

## AINDA NÃO EXISTE NO APP (não procure)

Honestidade sobre os limites, para ninguém perder tempo:

| O quê | Situação |
| --- | --- |
| **R-2010** — tela e transmissão | O cálculo e o gerador estão prontos e conferidos contra um evento aceito; **falta a tela** no Consultor Contábil. Por enquanto, no e-CAC |
| **PGDAS-D sem movimento** | Bloqueado de propósito — a forma que o SN-Entregar aceita não foi confirmada. Entregue no e-CAC |
| **Prazo do ISS** fora de São Paulo | Só a capital está cadastrada. Outros municípios aparecem **sem data**, dizendo o que falta |
