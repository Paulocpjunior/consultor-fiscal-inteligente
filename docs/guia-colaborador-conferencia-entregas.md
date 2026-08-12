# Guia do Colaborador — Conferir uma entrega nova

<!-- guia-id: conferencia-entregas · guia-revisao: 2026-08-13 -->
<!-- Mexeu aqui? mexa no par em public/ e suba a revisão nos DOIS. -->

> Fonte do guia servido em `/guia-conferencia-entregas.html`.
> **Atualizar os DOIS juntos** — o teste `guiaParDuplo` barra o build se as
> revisões divergirem.

---

## Por que este guia existe

Em 12/08/2026 o Paulo mandou um print de uma tela com defeito **que já estava
corrigido**. O trabalho estava pronto e mesclado; o que tinha falhado era o
*deploy*, e ninguém tinha como saber olhando a tela.

Resultado: tempo gasto procurando um defeito que não existia mais.

A regra que sai disso é simples e vale para sempre:

> **Print sem versão não é evidência. É narrativa.**

Este guia é o roteiro de como conferir uma entrega e o que mandar de volta.

---

## PASSO 1 — Descubra em que versão você está (30 segundos)

Antes de testar qualquer coisa:

1. Se aparecer o aviso **"Nova versão disponível"** no rodapé, clique em
   **Atualizar agora**. Ele faz o recarregamento forte; F5 comum às vezes não
   basta (o Safari segura a página antiga).
2. Olhe a versão no **rodapé da tela**. Anote (ou deixe no print).

**Se você não fizer isso, tudo abaixo pode dar resultado errado** — e o erro
não vai ser do app, vai ser da página velha que o navegador guardou.

### Os apps são separados — e a versão fica em lugar diferente em cada um

| Módulo | Onde achar a versão |
| --- | --- |
| 🧾 Fiscal (CFI) | **rodapé** da tela — ou o selo no topo do guia servido |
| 📊 Contábil (Consultor Contábil) | menu **ℹ️ Sobre o Sistema** → linha **"Versão atual"**. *Não é no rodapé* |

O selo do guia lê a versão do **Fiscal** — o guia é servido por ele e não
consegue ler a versão do outro módulo.

Uma correção no Fiscal **não** aparece no Contábil, e vice-versa. Se o teste
envolve os dois lados (é o caso do FUNRURAL → EFD-Reinf), anote as **duas**
versões.

---

## PASSO 2 — Teste pelo RESULTADO, nunca pelo status

"Salvou" não é prova. "Ficou verde" não é prova. **Prova é o número certo na
tela**, ou o documento aceito pelo órgão.

Para cada item que você for conferir, o roteiro tem três colunas:

- **onde clicar** — o caminho exato
- **o que TEM que aparecer** — o critério de aceite
- **se não aparecer** — o que reportar

---

## PASSO 3 — O que reportar quando não bater

Mande, nesta ordem:

1. **A versão** do módulo (Passo 1)
2. **O cliente e a competência** (ex.: `1131 VINCENZO GUERRA · 07/2026`)
3. **O print da tela inteira** — não recortado. O que parece irrelevante
   costuma ser a pista
4. **O que você esperava** e **o que apareceu**

Não é preciso explicar a causa. **A causa é trabalho nosso, não seu.** O print
completo com cliente, competência e versão vale mais que qualquer descrição.

---

## ROTEIRO — entregas de 12/08/2026

### 1. FUNRURAL de produtor rural com CNPJ

O caso: `VINCENZO GUERRA` comprava de `ANTONIO DIAS DA SILVA`, que é produtor
rural pessoa física **mas tem CNPJ**. O Fiscal calculava certo e o Contábil
dizia "nenhuma aquisição encontrada".

| onde clicar | o que TEM que aparecer |
| --- | --- |
| 🧾 Fiscal → Central de XMLs → aba **🌾 DIPAM / Produtor rural** → escolher o cliente e a competência | O FUNRURAL apurado, com o produtor listado |
| 📊 Contábil → EFD-Reinf → **R-2055** → CNPJ do cliente + competência → **Buscar no Consultor Fiscal** | O produtor **aparece na lista** (antes ele sumia) |

**Critério de aceite:** o produtor aparece nos dois lados **com o mesmo valor**.
Se os valores divergirem, pare e reporte — dois números para o mesmo fato é o
defeito mais grave que existe num arquivo fiscal.

**Ele ainda vai ficar "pendente", e isso está certo.** Faltam duas informações
que a nota não traz:

1. **CPF do titular.** O R-2055 identifica a *pessoa*; a nota traz o CNPJ do
   estabelecimento rural. Consulte no **CADESP** e grave no bloco roxo da aba
   🌾 ("produtor inscrito por CNPJ").
2. **Indicador da aquisição (`indAquis`).** Para compra de produção rural de
   produtor PF por sub-rogação — o caso comum — o valor é **`1`**. Digite no
   campo `INDAQUIS`, clique em **💾 Salvar indicadores** e busque de novo.

Depois dos dois, ele sai de "pendente".

> ⚠️ Se a linha ainda disser **"CPF do produtor inválido ou ausente"**, você
> está numa versão antiga do Contábil. Volte ao Passo 1.

---

### 2. Município da DIPAM em branco

O caso: centenas de pendências "nota sem código IBGE do município", com a DIPAM
saindo R$ 0,00 — e o município estava dentro do XML o tempo todo.

| onde clicar | o que TEM que aparecer |
| --- | --- |
| 🌾 DIPAM → bloco de **Pendências** → botão **♻️ Reler participante e município dos XMLs** | Uma frase com quantas notas foram recuperadas |

**Critério de aceite:** as pendências de município caem e a DIPAM passa a
mostrar valor por município.

**Não digite município à mão.** Se sobrar pendência depois de reler, é buraco
de captura — reporte, não contorne.

---

### 3. Correlação de CFOP

O caso: a tela mostrava um CFOP e o arquivo gravava outro.

| onde clicar | o que TEM que aparecer |
| --- | --- |
| Ficha do cliente → **Correlacao CFOP** | A **Natureza da Atividade** e, se ela estiver em branco, uma frase âmbar dizendo **qual natureza vai valer** e de onde ela veio |

**Critério de aceite:** o "CFOP final" da tela é **o mesmo** que sai no SPED e
no Exportar SAGE. Se você vir um CFOP de entrada terminado em **402, 404 ou
405**, reporte imediatamente — esses não existem.

**Se a lista vier vazia**, leia a frase: ela agora diz *qual* dos três casos é
(nenhum documento capturado / nenhuma nota de entrada / entradas sem CFOP
legível). Só o primeiro e o terceiro são problema.

---

### 4. Simples Nacional sem movimento

| onde clicar | o que TEM que aparecer |
| --- | --- |
| Ficha do Simples → **Declarar sem movimento** | A mensagem diz **o que a conferência prévia respondeu** |

Há três respostas possíveis, com ações **opostas**:

- *"Conferi antes: a Receita respondeu que NÃO há declaração"* → **entregue no
  e-CAC** (PGDAS-D → Declarar → sem movimento). A multa de R$ 50,00 está
  correndo.
- *"Esta competência JÁ TEM declaração transmitida"* → **nada a fazer**. Está
  certo.
- *"a consulta falhou"* → se você **já entregou**, ignore. Se não, entregue.

O botão continua bloqueado de propósito: a forma que o SN-Entregar aceita para
mês sem faturamento ainda não foi confirmada, e **declaração aceita com
estrutura errada é pior que recusada**.

---

## O que NÃO fazer

- **Não conserte cadastro para "destravar" a tela.** Campo em branco acende
  alerta de propósito. Preencher por cima esconde o buraco
- **Não use o app como conferência do outro app.** Se o Fiscal e o Contábil
  discordam, isso é o achado — reporte, não escolha um
- **Não conclua "não tem" a partir de tela vazia.** Vazio pode ser ausência de
  operação *ou* falha de captura, e o app agora diz qual é. Leia a frase
