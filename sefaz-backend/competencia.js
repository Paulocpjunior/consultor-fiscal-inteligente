// ============================================================================
// sefaz-backend/competencia.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 "QUAL É A COMPETÊNCIA?" É UMA PERGUNTA SÓ — e tinha DUAS respostas.
//
// A competência circula neste app em quatro formas: `AAAA-MM` (o padrão),
// `MM/AAAA` (o catálogo de obrigações e a coleção de tarefas), `AAAA-MM-DD` (a
// ficha financeira, conforme a época do lançamento) e `AAAAMM` (colagens de
// arquivo). Havia duas funções chamadas `normalizarCompetencia`, e elas
// divergiam nos DOIS sentidos:
//
//   · `envio-imposto.js`  aceitava `AAAAMM` e **recusava** `AAAA-MM-DD`;
//   · `ipi-varredura.js`  aceitava `AAAA-MM-DD` e **recusava** `AAAAMM`.
//
// Cada uma devolvia **null** para a forma que a outra entendia — e null aqui
// não falha: some. Foi assim que o descasamento `MM/AAAA` × `AAAA-MM` mordeu
// três vezes em 15/08, uma delas em silêncio.
//
// ⚠️ `assertCompetencia`/`partesDaCompetencia` do catálogo NÃO são uma terceira
// cópia: eles respondem outra pergunta — *"esta entrada está no formato que o
// catálogo exige?"* — e LANÇAM de propósito, para validar na porta. Régua única
// é o dono da MESMA pergunta, não o dono mais próximo (lição do `ufDoDest`).
// ============================================================================

/**
 * Traz qualquer forma conhecida para `AAAA-MM`.
 *
 * Devolve **null** quando não reconhece — nunca chuta período. Competência
 * chutada é guia emitida para o mês errado.
 *
 * @param {unknown} comp
 * @returns {string|null}
 */
export function normalizarCompetencia(comp) {
    const s = String(comp ?? '').trim();
    if (!s) return null;

    // AAAA-MM e AAAA-MM-DD (a ficha financeira grava as duas).
    let m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(s);
    if (m) return mesValido(m[2]) ? `${m[1]}-${m[2]}` : null;

    // MM/AAAA — catálogo de obrigações e coleção de tarefas.
    m = /^(\d{2})\/(\d{4})$/.exec(s);
    if (m) return mesValido(m[1]) ? `${m[2]}-${m[1]}` : null;

    // AAAAMM — colagem de arquivo (SPED, extrato).
    m = /^(\d{4})(\d{2})$/.exec(s);
    if (m) return mesValido(m[2]) ? `${m[1]}-${m[2]}` : null;

    // DD/MM/AAAA — a DANFSe do padrão NACIONAL escreve o campo "Competência
    // da NFS-e" como DATA (01/09, caso MARCOS ANTONIO ZAMBOLIN). Ler a data e
    // devolver o mês dela é o que a leitura da tela já faz há tempo
    // (`getCompetenciaDocumento`); o que faltava era o DONO conhecer a forma.
    m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return mesValido(m[2]) ? `${m[3]}-${m[2]}` : null;

    return null;
}

function mesValido(mm) {
    const n = parseInt(mm, 10);
    return n >= 1 && n <= 12;
}

/**
 * Competência no formato da coleção `tarefas` (`MM/AAAA`).
 * Devolve null quando a entrada não é reconhecível.
 */
export function competenciaTarefa(comp) {
    const n = normalizarCompetencia(comp);
    if (!n) return null;
    const [ano, mes] = n.split('-');
    return `${mes}/${ano}`;
}

/**
 * As formas em que a MESMA competência pode estar GRAVADA — para quem precisa
 * consultar o banco por igualdade e não pode perder o registro gravado noutra
 * forma.
 *
 * 🚨 Foi essa a falta que cegou a trava do DÉBITO REPETIDO: a gravação
 * normaliza para `AAAA-MM` e a consulta perguntava pelo texto cru que veio na
 * requisição. Pedindo `07/2026`, ela achava ZERO envios anteriores e liberava
 * a MESMA cobrança de novo — que é exatamente o que a trava existe para
 * impedir (caso HYPE, 17/08).
 */
export function formasDaCompetencia(comp) {
    const n = normalizarCompetencia(comp);
    if (!n) return [];
    const [ano, mes] = n.split('-');
    const cru = String(comp ?? '').trim();
    // ⚠️ `AAAA-MM-01` é a QUARTA forma gravada — a ficha financeira e os
    // lançamentos antigos guardam a competência como DATA. A consulta por `in`
    // não tem como enumerar os 31 dias, então entra só o 1º (a forma que o
    // app grava quando "a competência" é a data). Registro gravado com OUTRO
    // dia (`2026-07-15`) só é achado quando ele mesmo é a forma crua pedida —
    // e é por isso que quem LÊ o resultado ainda normaliza antes de comparar
    // (`normalizarCompetencia`), nunca `===` com o texto.
    const formas = [n, `${mes}/${ano}`, `${ano}${mes}`, `${n}-01`];
    if (cru && !formas.includes(cru)) formas.push(cru);
    return formas;
}

/**
 * 🚨 A COMPETÊNCIA ENTRAVA NA GERAÇÃO SEM CONFERÊNCIA DE FORMA — e o arquivo
 * saía VAZIO dizendo que a empresa não teve movimento (22/08).
 *
 * As portas do **EFD-Contribuições** e do **EFD ICMS/IPI** só perguntavam se a
 * competência EXISTIA. Chegando `07/2026` ou `202607`, o
 * `where('competencia','==',…)` de `documentos_fiscais` — que grava sempre
 * `AAAA-MM` — devolvia **ZERO documentos**; o orquestrador avisava *"não tem
 * documentos fiscais no período; arquivo será gerado com estrutura mínima"* e
 * **o arquivo saía mesmo assim**, declarando nada à Receita.
 *
 * 🔴 É a ausência PLAUSÍVEL no lugar mais caro: empresa sem movimento é caso
 * legítimo, então o aviso não parece defeito. Mesma família do caso HYPE
 * (17/08), em que a consulta por igualdade de competência liberou a MESMA
 * cobrança duas vezes.
 *
 * ⚠️ **Normaliza em vez de recusar as outras formas** — `07/2026` e `202607`
 * dizem a mesma competência, e é para isso que o dono existe. O que RECUSA é o
 * ILEGÍVEL: competência chutada é arquivo entregue no mês errado.
 *
 * @returns {{ok: true, competencia: string} | {ok: false, erro: string}}
 */
export function competenciaParaGerarArquivo(bruta) {
    const n = normalizarCompetencia(bruta);
    if (n) return { ok: true, competencia: n };
    return {
        ok: false,
        erro: `Competência inválida: "${String(bruta ?? '')}". Use AAAA-MM (ex.: 2026-07). `
            + 'Sem competência legível o arquivo sairia VAZIO — e vazio, aqui, é uma afirmação à Receita.',
    };
}

// ═══ DATA E HORA DE BRASÍLIA ═════════════════════════════════════════════════
//
// O Cloud Run é UTC. Toda data que o app AFIRMA num documento — o `dhEmi` da
// DPS (e o `dCompet` que sai dele), o "hoje" que decide se um DARF está
// vencido, a data de consolidação do SICALC — é de BRASÍLIA. Ler
// `toISOString()` produz o dia seguinte das 21h à meia-noite: uma NFS-e
// emitida em 31/08 às 22h nasceria com competência 01/09 (o mês errado, no
// XML que a Receita processa) e uma emissão no prazo viraria "vencida".
//
// Dono ÚNICO, em vez de cada módulo ler o fuso do jeito dele (o
// `darf-payload-builder` já tinha o seu `hojeIso`; ele passou a delegar).

const FUSO_BRASILIA = 'America/Sao_Paulo';

function partesEmBrasilia(d) {
    const f = new Intl.DateTimeFormat('en-CA', {
        timeZone: FUSO_BRASILIA, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const { type, value } of f.formatToParts(d)) p[type] = value;
    return p;
}

/**
 * `AAAA-MM-DD` do instante `d` em Brasília. Data inválida → **null**, nunca
 * hoje (campo de data não recebe default).
 */
export function dataBrasilia(d = new Date()) {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const p = partesEmBrasilia(dt);
    return `${p.year}-${p.month}-${p.day}`;
}

/**
 * `AAAA-MM-DDThh:mm:ss-03:00` — o instante `d` em Brasília, na forma que os
 * XSD da NFS-e Nacional (e da NF-e) aceitam: sem milissegundos, sem `Z`, com o
 * deslocamento explícito. O deslocamento é MEDIDO (Brasília vs. UTC do mesmo
 * instante), não escrito à mão — se o horário de verão voltar, a régua não
 * envelhece.
 */
export function dataHoraBrasilia(d = new Date()) {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const p = partesEmBrasilia(dt);
    const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const offMin = Math.round((comoUtc - Math.floor(dt.getTime() / 1000) * 1000) / 60000);
    const sinal = offMin < 0 ? '-' : '+';
    const abs = Math.abs(offMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sinal}${hh}:${mm}`;
}
