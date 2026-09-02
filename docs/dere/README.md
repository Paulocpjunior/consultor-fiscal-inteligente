# DeRE — Declaração de Regimes Específicos (IBS/CBS/IS) · documentação oficial no repo

> Regra da casa (20/08): **fonte oficial que chega vira ARQUIVO NO REPO, não
> conhecimento de sessão.** Os PDFs vieram do Paulo em 02/09/2026 (o gov.br,
> o sped.rfb.gov.br e o cgibs.gov.br são bloqueados pela rede deste ambiente).
> O texto extraído fica aqui, grep-ável; os PDFs originais ficam em
> `public/docs/dere/` e são servidos pelo app (⚙️ Config Admin → 🏦 DeRE →
> Documentação oficial).

## O que está aqui

| Arquivo | Versão | Data | O que é |
|---|---|---|---|
| `02-leiautes-eventos-v1.1.0.txt` | 1.1.0 | 22/06/2026 | Leiaute de TODOS os eventos: D-1001, D-1011 (tabela) · D-1101, D-1106, D-1199, D-2101 (periódicos) · D-9001, D-9101, D-9106, D-9121, D-9199 (retorno) |
| `03-anexo-i-tabelas-v1.1.0.txt` | 1.1.0 | 22/06/2026 | Tabelas de domínio: 11 (codTrib), 12/12.1/12.2 (codBC), 13 (UF), 14/22/23/32 (planos de contas referenciais SPED/COSIF/SUSEP/ANS), **21/31/41 (atividades por regime)**, 33 |
| `04-anexo-ii-regras-de-validacao-v1.1.0.txt` | 1.1.0 | 22/06/2026 | Regras de validação com o código de mensagem (MSxxxx) e se interrompem o processamento; as RNs de chave, recibo, protocolo e ID |
| `05-historico-de-versoes-v1.1.0.txt` | 1.1.0 | 22/06/2026 | O que mudou da 1.0.1 (29/05/2026) para a 1.1.0 |
| `07-manual-do-desenvolvedor-v1.0.2.txt` | 1.0.2 | 18/08/2026 | APIs (Receita Integra, lote, consulta), assinatura XMLDSig, certificados, produção restrita |
| `xsd/` (9 arquivos) | 1.0.0–1.0.2 | pacote "06 - Arquivos XSD (Nota Orientativa 2026)", 02/09/2026 | Schemas: `envioLoteDere` / `retornoLoteDere` (lote), `evtInfoContrib` (D-1001), `evtPGCC` (D-1011), `evtBalancete` (D-1101), `evtAplicResTec` (D-1106), `evtRetornoTabela` (D-9001), `evtRetornoBalan` (D-9101), `evtRetornoAplicFin` (D-9106). **Parcial**: não vieram D-1199, D-2101, D-9121, D-9199 |

## O que NÃO está aqui (e por isso o app não afirma)

- **01 — Manual de Orientação do Usuário (MOD 1.0.1)**: quem está obrigado em
  linguagem de negócio, prazos, penalidades. O que o app sabe do PRAZO vem do
  Ato Conjunto RFB/CGIBS 4/2026 e do esclarecimento CGIBS/RFB de 26/08/2026,
  conhecidos por resumo de terceiros.
- **06** (não veio) e **08 — Mensagens de Erro do Sistema** (citado no Anexo II).
- **XSD de D-1199 (fechamento), D-2101, D-9121 e D-9199** — o pacote da Nota
  Orientativa 2026 não os trouxe. Montar XML desses eventos por dedução é o
  `1405` num arquivo que a Receita processa.

## Os fatos que o app usa, com a página

- **Quem cabe na DeRE hoje** — D-1001 `{regTribPrinc}` valores válidos:
  `1 – Serviços Financeiros · 2 – Plano de Assistência à Saúde · 3 – Concursos
  de Prognósticos · 9 – Outros Regimes de Tributação` (só como principal de
  quem tem secundário 1-3). `{regTribSecund}` só admite 1/2/3
  (Leiautes, p. 4). **Imóveis, cooperativas, combustíveis, bares/hotelaria,
  SAF e missões não têm grupo no leiaute 1.1.0** — não há como declará-los.
- **A declaração é por CNPJ RAIZ** — `{nrInsc}` tem 8 posições em todo evento
  (Leiautes, p. 3; Anexo II, CONTRIBUINTE_NO_CADASTRO). Matriz e filiais
  entram numa declaração só.
- **Eventos de tabela**: D-1001 (regime principal + até 3 secundários,
  `indNatTrib` 0 regular / 1 imunidade, atividades das Tabelas 21/31/41) e
  D-1011 PGCC (`planoCtaRef` 1 COSIF · 2 ANS · 3 SUSEP · 4 SPED, contas com
  `codTrib` da Tabela 11; até 50.000 contas).
- **Eventos mensais**: D-1101 Balancete (até 10.000 contas analíticas, saldo
  inicial/movimentos/saldo final/vApur), D-1106 e D-2101 **condicionais** ao
  PGCC ter `codTrib` das listas (Anexo II, "RN - Tabela de codtribs
  obrigatórios": D-1106 → 120130001/120230001/120330001 saúde e 111112701
  seguros; D-2101 → 110113001/110113002), D-1199 Fechamento (só inclusão;
  exige D-1101 ativo — EVENTOS_OBRIGATORIOS_PERIODO; retificar exige
  reabertura).
- **D-1121 NÃO EXISTE** no leiaute 1.1.0 (o resumo de terceiros que o app
  usou em 02/09 de manhã o listava; corrigido ao ler a fonte).
- **Retornos**: D-9001 (tabela), D-9101/9106/9121 (totalizadores por evento) e
  **D-9199** — a memória de cálculo do débito de IBS, CBS e IS do mês
  (`totalTributosGeral`), o análogo do que o R-2099/totalizador faz na Reinf.
- **ID do evento** (42 caracteres): `DeRE` + `NNNN` (evento) + `1` (CNPJ) +
  CNPJ com 14 posições (zeros à esquerda) + `AAAAMMDD` + `HHMMSS` (Brasília)
  + `QQQQQ` (Anexo II, "RN - Unicidade Recepção Evento").
- **Recibo** (31 caracteres): `0000-AAAAMM-<id interno até 19>`; **protocolo
  do lote**: `T.AAAAMM.N…` com T = 1 produção / 2 pré-produção (Anexo II).
- **Integração** (Manual do Desenvolvedor 1.0.2): OAuth 2.0 client credentials
  no Receita Integra (`https://api.receitafederal.gov.br/token`, token de 60
  min); produção restrita `POST https://api.receitafederal.gov.br/prr-dere/v1/recepcao/lotes`
  e `GET …/v1/consulta/lotes/{protocolo}`; **protocolo ≠ recibo**
  (processamento assíncrono); assinatura XMLDSig Enveloped, RSA-SHA256, C14N,
  certificado A1/A3 ICP-Brasil (e-CNPJ, e-CPF, procurador) só com o
  certificado final; pré-requisitos administrativos: piloto da Reforma,
  procuração no e-CAC ("Piloto da CBS" + "DeRE") e credencial gerada no portal
  `piloto-cbs.tributos.gov.br`.

## O que o XSD confirmou contra o módulo (`dere.js`)

- `{nrInsc}` é `[0-9A-Z]{8}` — raiz **alfanumérica** (o CNPJ alfanumérico vale
  desde 07/2026); `raizDoCnpj` passou a manter letras, em maiúsculas.
- O `id` do evento casa `DeRE[0-9]{4}[1-2][A-Z0-9]{14}[0-9]{19}` (evtBalancete,
  evtAplicResTec, retornos) — os 42 de `montarIdEventoDere`. O XSD admite T=2;
  a RN do Anexo II só define 1 (CNPJ) e é ela que o módulo segue.
- `{tpAtividade}` é `[0-9]{2}[A-Z]` — a máscara de `ATIVIDADES_DERE`.
- `nrRecibo` tem `maxLength 31` e `protocolo` `maxLength 28` — os tetos de
  `lerRecibo`/`lerProtocolo`.
- `{regTribPrinc}`/`{regTribSecund}` são `xs:byte` com enumeração 1/2/3 (e 9
  no principal) — o `codigoD1001` de `dere-regimes.js`.

## O que o app já MONTA a partir destes arquivos

- **D-1001** (`sefaz-backend/dere-evento-d1001.js`): XML na ordem do
  `evtInfoContrib-v1_0_1.xsd`, a partir do cadastro (`dadosFiscais.dere*`), sem
  `ds:Signature`, conferido contra o XSD pelo `dere-xsd-bolso.js`. Prévia em
  ⚙️ Config Admin → 🏦 DeRE (rota `/api/admin/cadastro/dere-d1001-previa`).
  **Não assina, não transmite.** Decisão do Paulo (02/09): a geração roda no
  Fiscal; o insumo contábil dos mensais virá pelo túnel.

## Como o texto foi extraído

`pypdf` num venv isolado (o `cryptography` do sistema está quebrado), uma
marca `===== PÁGINA N =====` por página. Tabelas largas saem com colunas
coladas — para ler tabela, prefira o PDF em `public/docs/dere/`.
