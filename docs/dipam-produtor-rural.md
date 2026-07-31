# DIPAM 1.1 e FUNRURAL — compra de produtor rural

> Origem: Paulo, 31/07/2026, com dois prints do SAGE e a NF-e 425.231.
> "essa nota é de FUNRURAL, temos que lançar manualmente esses campos, pois o
> sistema não entende (…) temos que entrar no cadastro, confirmar o município,
> voltar e informar aqui na frente."

## O que a lei pede

Uma nota de compra de produtor rural gera **duas** obrigações independentes:

| | DIPAM 1.1 | FUNRURAL por sub-rogação |
|---|---|---|
| Norma | Manual da DIPAM 2026 v1.3 (Portaria SRE 94/2022, art. 17) | Lei 8.212/91, art. 30, IV |
| Alcance | **só produtor paulista** | produtor PF de **qualquer** estado |
| Onde entra | ficha "Informações para a DIPAM B" da GIA **e** Registro 1400 da EFD (`SPDIPAM11`) | guia previdenciária da empresa adquirente (e EFD-Reinf) |
| Como se declara | valor **mensal** agrupado **por município de origem** | por nota: previdenciária + GILRAT + SENAR |
| Se errar | multa (RICMS/SP art. 527, VII, "b" e "e") e, desde 2025, a SEFAZ cruza os lançamentos com as próprias NF-e | recolhimento a menor da empresa |

A DIPAM define a fatia do município no rateio do ICMS (IPM): **omitir tira
dinheiro do município; inflar dá multa.** O preenchimento na EFD **não dispensa**
o da GIA (Manual, pág. 29).

### Quem entra no código 1.1 (e quem não entra)

- Só **Produtor Rural — Pessoa Física** (natureza jurídica no CADESP).
  **CNPJ não descaracteriza** a condição de PF (Comunicado CAT 45/2008) — a
  IE paulista de produtor começa com **"P"** (ex.: `P-01100424.3/002`).
- Fornecedor **PJ (RPA ou Simples) nunca entra** — é o erro mais comum e a
  SEFAZ desconsidera o lançamento inteiro.
- Só **produto agropecuário/hortifrutigranjeiro** (erro frequente II do Manual:
  lançar autopeça, combustível…).
- **Não entram**: depósito, armazenagem, retorno simbólico e entrada para
  fixação de preço (CFOP 1131).
- **Devolução deduz** do município — e se o mês fechar negativo, a dedução vai
  para o próximo mês com saldo (o Registro 1400 não aceita valor ≤ 0).
- **Cooperativa** que adquire do cooperado usa o código **1.3** (`SPDIPAM13`).
- Cliente que **é** produtor rural PF entrega a **DIPAM-A** anual
  (https://www4.fazenda.sp.gov.br/DIPAM-A/Login) e não lança o 1.1.

## Como ficou no CFI

### 1. Cadastro do CLIENTE — `Dados Fiscais → 🌾 Produtor rural`

`EmpresaDadosFiscais.condicaoRural`:

| Campo | Efeito |
|---|---|
| `adquireDeProdutor` | liga a cobrança da obrigação todo mês, inclusive em mês **sem** nota (mês vazio pode ser falha de captura) |
| `ehProdutorRuralPF` | o cliente entrega DIPAM-A e **não** lança o 1.1 |
| `ehCooperativa` | troca o código para 1.3 |
| `funruralSubRogacao: 'nao_aplica'` | desliga o cálculo da sub-rogação (com motivo na observação) |

A marcação **não é a fonte da verdade**: o app classifica cada nota pelo que ela
mostra e exibe a divergência ("cliente não marcado, mas comprou de produtor").

### 2. Cadastro do FORNECEDOR — coleção `produtores_rurais`

Id = CPF/CNPJ. É a **memória da conferência do CADESP**, hoje refeita nota a nota:

- `natureza`: `produtor_rural_pf` | `pessoa_juridica` | `cooperativa`;
- `codMunIBGE`/`municipio`: sobrepõe o da nota (é o rateio que o produtor informa
  quando a produção é de mais de um município — Manual, pág. 12);
- `funrural`: `sub_rogacao` | `folha` (produtor optou por recolher sobre a folha,
  Lei 13.606/2018 — **sem** sub-rogação) | `nao_aplica`.

Colaborador lê; **só admin grava** (a natureza muda o que é declarado à SEFAZ).

### 3. Tela — `Central de XMLs → XMLs → 🌾 DIPAM / Produtor rural`

- varredura da competência: quais clientes têm compra de produtor;
- DIPAM agrupada **por município**, com o **Registro 1400 pronto** para copiar;
- FUNRURAL nota a nota, com os três valores separados como o lançamento pede
  (Seguro Social, GILRAT, SENAR) e a conferência contra o que o **emitente
  declarou** no campo de informações complementares;
- pendências com a ação, e o botão de confirmar o fornecedor ali mesmo.

### 4. SPED Fiscal

`buildBloco1(registros1400)` emite o `1400` por município e liga o `IND_VA` do
`1010` — 'S' só existe com 1400, e 1400 nunca existe com 'N' (o PVA rejeita as
duas combinações). Pendência de DIPAM vira **warning** na geração do arquivo.

### 5. Rotina do Mês

A compra de produtor rural aparece na etapa **Obrigações** (é lá que a DIPAM é
entregue). Fornecedor a confirmar **não deixa a etapa fechar**.

## Alíquotas do FUNRURAL — ponto de manutenção

`ALIQUOTAS_FUNRURAL_PF` é **tabela com vigência** (`sefaz-backend/dipam-produtor-rural.js`):

| Desde | Previdenciária | GILRAT | SENAR | Total |
|---|---|---|---|---|
| 2018-01 | 1,20% | 0,10% | 0,20% | 1,50% |
| 2026-01 | 1,32% | 0,11% | 0,20% | 1,63% | ⚠ `revisar: true` |

A linha de 2026 foi conferida contra a NF-e 425.231 (que declara "FUNRURAL 1.63%
… R$ 909,47" sobre R$ 55.796,00) e contra o lançamento do SAGE. **Está marcada
para revisão**: confirme a base legal vigente e troque `revisar` para `false`.
Enquanto estiver marcada, o painel mostra o aviso.

Centavos são **desprezados** (IN RFB 971/2009), como no SAGE:
55.796,00 × 1,32% = 736,5072 → **736,50**.

## Arquivos

| Arquivo | Papel |
|---|---|
| `sefaz-backend/dipam-produtor-rural.js` | núcleo **puro** (39 testes em `__tests__/dipamProdutorRural.test.ts`) |
| `sefaz-backend/dipam-store.js` | Firestore: `produtores_rurais` + condição rural do cliente |
| `sefaz-backend/dipam-routes.js` | `/api/admin/dipam/{painel,varredura,produtores,produtor}` |
| `sefaz-backend/sped-fiscal-blocos-vazios.js` | Registro 1400 + IND_VA no Bloco 1 |
| `components/xml/DipamProdutorRuralPanel.tsx` | a tela |
| `components/EmpresaDadosFiscaisModal.tsx` | marcação no cadastro do cliente |

## O que ainda é manual

- **Lançar na GIA**: o app entrega o valor por município pronto; a transmissão
  da GIA continua no portal da SEFAZ.
- **Guia do FUNRURAL**: o valor sai calculado; a emissão/recolhimento não passa
  pelo app (candidato natural ao rito #293 depois).
- **Rateio entre municípios** de um mesmo produtor: hoje o cadastro aceita um
  município; o rateio proporcional (Manual, pág. 12) entra quando aparecer o
  primeiro caso real.
