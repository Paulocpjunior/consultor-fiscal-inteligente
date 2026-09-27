// ============================================================================
// sefaz-backend/dere-insumo-contabil.js  (PURO — sem I/O, testável)
// ----------------------------------------------------------------------------
// 🏦 O INSUMO CONTÁBIL DA DeRE — plano de contas + balancete analítico — lido
// da PLANILHA que a contabilidade exporta, e transformado no que o D-1011
// (PGCC) e o D-1101 (Balancete Mensal) pedem.
//
// Nasceu em 27/09/2026 do arquivo de TESTE que o Paulo mandou ("SEGUE ARQUIVO
// TESTE DO DERE PARA VALIDAÇÃO"): `Plano_de_contas_2026.xlsx` (Cód. Reduzido ·
// Conta Contábil · Descrição · Conta de Lançamento(S/N) · Tipo de Conta (C/D))
// e `Bal_analitico-mes-7-2026.xlsx` (Código · Conta · Saldo Inicial · Débitos ·
// Créditos · Saldo Final), de uma operadora de plano de saúde.
//
// O QUE FOI MEDIDO NO ARQUIVO REAL, e virou régua aqui (contagens, nunca
// valores — dado de cliente não entra no repo):
//   · 3.847 contas (3.297 analíticas · 550 sintéticas), hierarquia LIMPA: toda
//     analítica tem pai sintético, nenhuma sintética sem filho, nível máx. 11,
//     código sem ponto ≤ 14 dígitos e sem colisão — o pai é o MAIOR código que
//     é PREFIXO do filho (os segmentos têm tamanho variável: 12111.9 → 12111.901
//     → 12111.9011), nunca "tira o último dígito".
//   · O SINAL do saldo no balancete é relativo à natureza da RAIZ (1 e 4
//     devedoras · 2 e 3 credoras), NÃO ao tipo C/D da conta no plano: 20
//     retificadoras "(-) Depreciação acumulada", "(-) Glosas" são tipo C no
//     plano e saem NEGATIVAS no balancete, e a aritmética SF = SI + D − C só
//     fecha lendo pela raiz — 1.960 linhas, ZERO falhas. Pelo tipo do plano,
//     20 falhas. Negativo = saldo INVERTIDO em relação à raiz.
//   · Contas de RESULTADO com saldo inicial ≠ 0 em julho: 148 de 150 — o
//     encerramento NÃO é mensal/trimestral/semestral/bimestral (CONFERIR_SALDO_
//     INICIAL zeraria em 07). Quem decide entre anual e quadrimestral é o
//     contador; o app CONFERE a escolha contra o balancete e recusa a incompatível.
//   · Grupos 19/29 (COMPENSAÇÃO) e 6 (APURAÇÃO DO RESULTADO) não têm {codNat}
//     no XSD (1 ativo · 2 passivo · 3 PL · 4 receita · 5 despesa), e o leiaute
//     diz "Devem ser informadas todas as contas PATRIMONIAIS e de RESULTADO" —
//     compensação e apuração não são nem uma nem outra. Saem FORA, CONTADAS e
//     DITAS; código de natureza não se inventa.
//
// O QUE A PLANILHA NÃO TRAZ, e o módulo NÃO inventa (vira pendência/aviso
// nomeado no gerador): {cCtaRef} (Tabela 32 — Plano de Contas Padrão da ANS,
// referência EXTERNA ao leiaute), {codTrib} (Tabela 11, obrigatório na
// analítica — MS1103), {iniVig} por conta, {freqEncerr}, {planoCtaRef}, o CNPJ
// (o título diz só o nome). Colunas OPCIONAIS com esses nomes são lidas quando
// existirem — é assim que o contador completa o insumo sem redigitar o plano.
// ============================================================================

import { normalizarCompetencia } from './competencia.js';

/** Natureza da RAIZ do plano — a régua do SINAL do balancete (medida, ver cabeçalho). */
export const NATUREZA_DA_RAIZ = Object.freeze({ 1: 'D', 2: 'C', 3: 'C', 4: 'D', 6: 'D' });

/** {codNat} do D-1011 pela raiz — 1 ativo · 2 passivo · 4 receita · 5 despesa. O 3 (PL) vem do NOME do grupo. */
export const COD_NAT_DA_RAIZ = Object.freeze({ 1: 1, 2: 2, 3: 4, 4: 5 });

export const MESES_PT = Object.freeze({
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8,
    setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
});

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = (s) => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();
const txt = (v) => (v == null ? '' : String(v).trim());

/** Código como o D-1011 quer: só alfanumérico, sem pontos/traços/barras/espaços. */
export function cCtaDe(codigo) {
    const c = txt(codigo).replace(/[.\-/\s]/g, '');
    if (!c || !/^[0-9A-Za-z]{1,53}$/.test(c)) return null;
    return c;
}

/**
 * Lê um valor de célula como número. Aceita número JS, texto pt-BR (1.234,56),
 * texto JS (1234.56) e o sufixo D/C que alguns balancetes imprimem
 * ("1.234,56 C"). Ausência devolve null — nunca zero: zero em coluna de saldo é
 * afirmação, ausência é lacuna.
 *
 * @returns {{ valor: number|null, natureza: 'D'|'C'|null }}
 */
export function lerNumeroCelula(v) {
    if (v == null || v === '') return { valor: null, natureza: null };
    if (typeof v === 'number') return Number.isFinite(v) ? { valor: v, natureza: null } : { valor: null, natureza: null };
    let s = String(v).trim().replace(/^R\$\s*/i, '');
    let natureza = null;
    const suf = /^(.*?)\s*([DdCc])$/.exec(s);
    if (suf && /\d/.test(suf[1])) { s = suf[1].trim(); natureza = suf[2].toUpperCase(); }
    const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
    s = s.replace(/[()\s-]/g, '');
    if (!s) return { valor: null, natureza: null };
    if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s) || (/,/.test(s) && !/\.\d{1,2}$/.test(s))) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d+(\.\d+)?$/.test(s)) { /* forma JS */ }
    else return { valor: null, natureza: null };
    const n = Number(s);
    if (!Number.isFinite(n)) return { valor: null, natureza: null };
    return { valor: neg ? -n : n, natureza };
}

/** Acha a linha de cabeçalho (≤ 15 primeiras) e o índice de cada coluna pelo NOME — nunca pela posição. */
function acharCabecalho(linhas, mapa, minimo) {
    for (let i = 0; i < Math.min(linhas.length, 15); i++) {
        const row = Array.isArray(linhas[i]) ? linhas[i] : [];
        const cols = {};
        row.forEach((cel, j) => {
            const k = chave(cel);
            if (!k) return;
            for (const [nome, re] of Object.entries(mapa)) {
                if (cols[nome] == null && re.test(k)) { cols[nome] = j; return; }
            }
        });
        if (Object.keys(cols).length >= minimo) return { linha: i, cols };
    }
    return null;
}

/** Competência escrita no TÍTULO ("Balancete Analítico de Julho/2026", "07/2026", "2026-07"). */
export function competenciaDoTitulo(linhas, ateLinha) {
    for (let i = 0; i < Math.min(linhas.length, ateLinha); i++) {
        for (const cel of (Array.isArray(linhas[i]) ? linhas[i] : [])) {
            const s = chave(cel);
            if (!s) continue;
            const m1 = /([a-z]{3,9})\s*(?:\/|de)\s*(20\d{2})/.exec(s);
            if (m1 && MESES_PT[m1[1]]) return `${m1[2]}-${String(MESES_PT[m1[1]]).padStart(2, '0')}`;
            const m2 = /(?:^|\D)(\d{2})\/(20\d{2})(?!\d)/.exec(s);
            if (m2) { const c = normalizarCompetencia(`${m2[1]}/${m2[2]}`); if (c) return c; }
            const m3 = /(20\d{2})-(\d{2})(?!\d)/.exec(s);
            if (m3) { const c = normalizarCompetencia(`${m3[1]}-${m3[2]}`); if (c) return c; }
        }
    }
    return null;
}

const COLS_PLANO = Object.freeze({
    codigo: /^(conta contabil|conta|codigo( da conta)?|classificacao|cod\.? conta)$/,
    reduzido: /reduzid/,
    nome: /^(descricao|nome( da conta)?|titulo)$/,
    lancamento: /lancamento|analitic|\(s\/n\)/,
    tipo: /tipo de conta|natureza|\(c\/d\)/,
    cCtaRef: /referencial|cta ?ref/,
    codTrib: /cod ?trib|tributacao/,
    iniVig: /inicio.*vig|ini ?vig/,
    fimVig: /fim.*vig|fim ?vig/,
});

/**
 * Lê a planilha do PLANO DE CONTAS (linhas = arrays de células, como a
 * `sheet_to_json(ws, { header: 1 })` devolve) e monta as contas do PGCC.
 *
 * @returns {{ ok, contas, foraDoPgcc, pendencias, avisos, resumo, colunas }}
 */
export function lerPlanoDeContas(linhas) {
    const pendencias = [];
    const avisos = [];
    const vazio = { ok: false, contas: [], foraDoPgcc: [], pendencias, avisos, resumo: null, colunas: null };
    if (!Array.isArray(linhas) || !linhas.length) { pendencias.push('Plano de contas vazio — nenhuma linha lida da planilha.'); return vazio; }

    const cab = acharCabecalho(linhas, COLS_PLANO, 3);
    if (!cab || cab.cols.codigo == null || cab.cols.nome == null) {
        pendencias.push('Não achei o cabeçalho do plano de contas: preciso das colunas "Conta Contábil" (código), "Descrição", '
            + '"Conta de Lançamento (S/N)" e "Tipo de Conta (C/D)" nas 15 primeiras linhas. Colunas opcionais: "Conta Referencial", "Código de Tributação", "Início/Fim de vigência".');
        return vazio;
    }
    const c = cab.cols;
    if (c.lancamento == null) pendencias.push('Falta a coluna "Conta de Lançamento (S/N)" — sem ela não dá para dizer qual conta é analítica ({indCta}), e o D-1011 exige.');
    if (c.tipo == null) pendencias.push('Falta a coluna "Tipo de Conta (C/D)" — sem ela não dá para preencher {natCta}.');
    if (pendencias.length) return vazio;

    const brutas = [];
    const porCcta = new Map();
    let nomesCortados = 0;
    for (let i = cab.linha + 1; i < linhas.length; i++) {
        const row = Array.isArray(linhas[i]) ? linhas[i] : [];
        const codigo = txt(row[c.codigo]);
        if (!codigo) continue;
        const cCta = cCtaDe(codigo);
        if (!cCta) { pendencias.push(`Linha ${i + 1}: código "${codigo}" não vira {cCta} (só letras e dígitos, até 53) — corrija na planilha.`); continue; }
        if (porCcta.has(cCta)) { pendencias.push(`Código "${codigo}" repetido (linha ${i + 1}) — sem os pontos ele colide com outra conta; o PGCC exige {cCta} único.`); continue; }
        let nome = txt(row[c.nome]).replace(/\s+/g, ' ');
        if (!nome) { pendencias.push(`Linha ${i + 1}: conta "${codigo}" sem descrição — {nomeCta} é obrigatório.`); continue; }
        if (nome.length > 100) { nome = nome.slice(0, 100).trim(); nomesCortados += 1; }
        const lanc = chave(row[c.lancamento]);
        // "Conta de Lançamento" S = recebe lançamento = ANALÍTICA; N = sintética. Vazio é lacuna, não sintética.
        const indCta = ['s', 'sim', 'a', 'analitica'].includes(lanc) ? 'A' : (['n', 'nao', 'sintetica'].includes(lanc) ? 'S' : null);
        if (!indCta) { pendencias.push(`Linha ${i + 1}: "Conta de Lançamento" = "${txt(row[c.lancamento])}" — esperava S (analítica) ou N (sintética).`); continue; }
        const tipo = chave(row[c.tipo]).slice(0, 1).toUpperCase();
        const natCta = tipo === 'C' || tipo === 'D' ? tipo : (tipo === 'V' ? 'V' : null);
        if (!natCta) { pendencias.push(`Linha ${i + 1}: "Tipo de Conta" = "${txt(row[c.tipo])}" — esperava C, D ou V.`); continue; }
        const conta = {
            codigo, cCta, nome, indCta, natCta,
            reduzido: c.reduzido != null ? (txt(row[c.reduzido]) || null) : null,
            cCtaRef: c.cCtaRef != null ? (cCtaDe(row[c.cCtaRef]) || null) : null,
            codTrib: c.codTrib != null ? (txt(row[c.codTrib]).replace(/\D/g, '') || null) : null,
            iniVig: c.iniVig != null ? (dataIso(row[c.iniVig]) || null) : null,
            fimVig: c.fimVig != null ? (dataIso(row[c.fimVig]) || null) : null,
            cCtaSup: null, nivelCta: null, codNat: null, raiz: cCta[0],
        };
        brutas.push(conta);
        porCcta.set(cCta, conta);
    }
    if (nomesCortados) avisos.push(`${nomesCortados} descrição(ões) com mais de 100 caracteres foram CORTADAS em 100 — é o máximo de {nomeCta} no XSD. Confira se o corte não apaga o que distingue a conta.`);
    if (!brutas.length) { pendencias.push('Nenhuma conta legível abaixo do cabeçalho do plano.'); return vazio; }

    // Pai = o MAIOR código que é PREFIXO próprio (segmentos de tamanho variável).
    const ordenados = [...porCcta.keys()].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    for (const conta of brutas) {
        let pai = null;
        for (let n = conta.cCta.length - 1; n >= 1; n--) {
            const p = conta.cCta.slice(0, n);
            if (porCcta.has(p)) { pai = p; break; }
        }
        conta.cCtaSup = pai;
    }
    for (const k of ordenados) {
        const conta = porCcta.get(k);
        conta.nivelCta = conta.cCtaSup ? porCcta.get(conta.cCtaSup).nivelCta + 1 : 1;
    }
    // Grupos de PL e de COMPENSAÇÃO se reconhecem pelo NOME do ancestral (o plano
    // diz "PATRIMÔNIO LÍQUIDO / PATRIMÔNIO SOCIAL", "COMPENSAÇÃO - ATIVO").
    const ancestrais = (conta) => { const r = []; let p = conta.cCtaSup; while (p) { r.push(porCcta.get(p)); p = porCcta.get(p).cCtaSup; } return r; };
    const ehPL = (conta) => [conta, ...ancestrais(conta)].some((a) => /patrimonio (liquido|social)/.test(chave(a.nome)));
    const ehCompensacao = (conta) => [conta, ...ancestrais(conta)].some((a) => /compensacao/.test(chave(a.nome)));

    const contas = [];
    const foraDoPgcc = [];
    let plContas = 0;
    for (const conta of brutas) {
        const raiz = Number(conta.raiz);
        if (ehCompensacao(conta)) { foraDoPgcc.push({ cCta: conta.cCta, codigo: conta.codigo, nome: conta.nome, indCta: conta.indCta, motivo: 'compensacao' }); continue; }
        if (!COD_NAT_DA_RAIZ[raiz]) { foraDoPgcc.push({ cCta: conta.cCta, codigo: conta.codigo, nome: conta.nome, indCta: conta.indCta, motivo: raiz === 6 ? 'apuracao-do-resultado' : 'raiz-sem-codnat' }); continue; }
        conta.codNat = raiz === 2 && ehPL(conta) ? 3 : COD_NAT_DA_RAIZ[raiz];
        if (conta.codNat === 3) plContas += 1;
        contas.push(conta);
    }
    // Pai que ficou de fora (compensação) não pode ser referenciado — o filho iria junto, então nunca acontece; travado por conferência.
    const noPgcc = new Set(contas.map((x) => x.cCta));
    for (const conta of contas) {
        if (conta.cCtaSup && !noPgcc.has(conta.cCtaSup)) pendencias.push(`Conta ${conta.codigo}: o pai ${conta.cCtaSup} ficou fora do PGCC — hierarquia inconsistente.`);
        if (conta.indCta === 'A' && !conta.cCtaSup) pendencias.push(`Conta ${conta.codigo} é analítica de nível 1 — toda analítica precisa de pai (PAI_CTA_ANALITICA, MS1074).`);
        if (conta.cCtaSup && porCcta.get(conta.cCtaSup).indCta !== 'S') pendencias.push(`Conta ${conta.codigo}: o pai ${porCcta.get(conta.cCtaSup).codigo} é ANALÍTICO — pai tem de ser sintético (MS1083).`);
    }
    const sinteticasSemFilho = contas.filter((x) => x.indCta === 'S' && !contas.some((f) => f.cCtaSup === x.cCta)).length;
    if (sinteticasSemFilho) avisos.push(`${sinteticasSemFilho} conta(s) sintética(s) sem nenhum filho no plano — o XSD aceita, mas vale conferir se não era analítica.`);
    if (!plContas) avisos.push('Nenhum grupo de PATRIMÔNIO LÍQUIDO reconhecido pelo nome — todas as contas do passivo saíram com {codNat} 2 (passivo). Se houver PL com outro nome, o codNat 3 não foi aplicado.');
    const compensacao = foraDoPgcc.filter((x) => x.motivo === 'compensacao').length;
    const apuracao = foraDoPgcc.filter((x) => x.motivo === 'apuracao-do-resultado').length;
    const outras = foraDoPgcc.length - compensacao - apuracao;
    if (foraDoPgcc.length) {
        avisos.push(`${foraDoPgcc.length} conta(s) FORA do PGCC: ${compensacao} de COMPENSAÇÃO, ${apuracao} de APURAÇÃO DO RESULTADO${outras ? `, ${outras} de raiz sem código de natureza` : ''}. `
            + 'O leiaute manda informar as contas PATRIMONIAIS e de RESULTADO, e {codNat} só tem 1 ativo · 2 passivo · 3 PL · 4 receita · 5 despesa — não há código para estas. '
            + 'Elas também ficam fora do balancete (D-1101 só aceita conta que está no PGCC). Se a Receita exigir, é decisão do contador — o app não inventa código de natureza.');
    }
    const analiticas = contas.filter((x) => x.indCta === 'A');
    const resumo = {
        total: contas.length, analiticas: analiticas.length, sinteticas: contas.length - analiticas.length,
        foraDoPgcc: foraDoPgcc.length, compensacao, apuracao,
        nivelMaximo: Math.max(...contas.map((x) => x.nivelCta)),
        comCtaRef: contas.filter((x) => x.cCtaRef).length,
        analiticasComCodTrib: analiticas.filter((x) => x.codTrib).length,
        comIniVig: contas.filter((x) => x.iniVig).length,
        porCodNat: contas.reduce((acc, x) => { acc[x.codNat] = (acc[x.codNat] || 0) + 1; return acc; }, {}),
        nomesCortados,
    };
    return { ok: pendencias.length === 0, contas, foraDoPgcc, pendencias, avisos, resumo, colunas: c };
}

function dataIso(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    const s = txt(v);
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
}

const COLS_BALANCETE = Object.freeze({
    codigo: /^(codigo( da conta)?|conta contabil|classificacao|cod\.? conta)$/,
    nome: /^(conta|descricao|nome( da conta)?|titulo)$/,
    saldoInicial: /saldo (inicial|anterior)/,
    debitos: /^debitos?$/,
    creditos: /^creditos?$/,
    saldoFinal: /saldo (final|atual)/,
});

/**
 * Lê a planilha do BALANCETE ANALÍTICO. Devolve as linhas com os quatro valores
 * como números ASSINADOS (como vieram) e a competência do título.
 */
export function lerBalancete(linhas) {
    const pendencias = [];
    const avisos = [];
    const vazio = { ok: false, competencia: null, linhas: [], pendencias, avisos, resumo: null, colunas: null };
    if (!Array.isArray(linhas) || !linhas.length) { pendencias.push('Balancete vazio — nenhuma linha lida da planilha.'); return vazio; }
    const cab = acharCabecalho(linhas, COLS_BALANCETE, 5);
    if (!cab || ['codigo', 'saldoInicial', 'debitos', 'creditos', 'saldoFinal'].some((k) => cab.cols[k] == null)) {
        pendencias.push('Não achei o cabeçalho do balancete: preciso de "Código", "Conta", "Saldo Inicial", "Débitos", "Créditos" e "Saldo Final" nas 15 primeiras linhas.');
        return vazio;
    }
    const c = cab.cols;
    const competencia = competenciaDoTitulo(linhas, cab.linha);
    if (!competencia) avisos.push('O título do balancete não diz a competência (ex.: "Balancete Analítico de Julho/2026") — a competência será a informada na tela.');
    const saida = [];
    const vistos = new Set();
    for (let i = cab.linha + 1; i < linhas.length; i++) {
        const row = Array.isArray(linhas[i]) ? linhas[i] : [];
        const codigo = txt(row[c.codigo]);
        if (!codigo) continue;
        const cCta = cCtaDe(codigo);
        if (!cCta) { pendencias.push(`Linha ${i + 1}: código "${codigo}" ilegível como {cCta}.`); continue; }
        if (vistos.has(cCta)) { pendencias.push(`Conta "${codigo}" aparece mais de uma vez no balancete (linha ${i + 1}) — cada conta só entra uma vez (MS1081).`); continue; }
        vistos.add(cCta);
        const v = {};
        let faltou = null;
        for (const k of ['saldoInicial', 'debitos', 'creditos', 'saldoFinal']) {
            const lido = lerNumeroCelula(row[c[k]]);
            if (lido.valor == null) { faltou = k; break; }
            v[k] = lido.valor;
            if (lido.natureza) v[`${k}Natureza`] = lido.natureza;
        }
        if (faltou) { pendencias.push(`Linha ${i + 1} (${codigo}): "${faltou}" vazio ou ilegível — campo de valor do balancete não recebe zero por ausência.`); continue; }
        saida.push({ codigo, cCta, nome: c.nome != null ? txt(row[c.nome]) : '', ...v });
    }
    if (!saida.length) { pendencias.push('Nenhuma linha legível abaixo do cabeçalho do balancete.'); return vazio; }
    return {
        ok: pendencias.length === 0, competencia, linhas: saida, pendencias, avisos, colunas: c,
        resumo: { linhas: saida.length, competenciaDoTitulo: competencia },
    };
}

/**
 * Natureza do saldo pela RAIZ: positivo = natureza da raiz, negativo = a
 * oposta. Regra MEDIDA no balancete real (1.960 linhas, zero falhas) — o tipo
 * C/D do plano erra nas retificadoras. Sufixo D/C explícito na célula VENCE.
 */
export function natSaldoPelaRaiz(cCta, valor, naturezaExplicita = null) {
    const raiz = NATUREZA_DA_RAIZ[Number(String(cCta || '')[0])] || null;
    const abs = Math.abs(Number(valor) || 0);
    if (naturezaExplicita === 'D' || naturezaExplicita === 'C') return { nat: naturezaExplicita, valor: abs, raiz };
    if (!raiz) return { nat: null, valor: abs, raiz: null };
    return { nat: Number(valor) < 0 ? (raiz === 'D' ? 'C' : 'D') : raiz, valor: abs, raiz };
}

/** SF = SI + D − C (raiz devedora) · SF = SI − D + C (raiz credora), com tolerância de 1 centavo. */
export function conferirAritmeticaDaLinha(linha) {
    const raiz = NATUREZA_DA_RAIZ[Number(String(linha.cCta || '')[0])];
    if (!raiz) return { ok: false, motivo: 'raiz sem natureza conhecida' };
    const esperado = raiz === 'D'
        ? linha.saldoInicial + linha.debitos - linha.creditos
        : linha.saldoInicial - linha.debitos + linha.creditos;
    const ok = Math.abs(esperado - linha.saldoFinal) <= 0.011;
    return { ok, esperado: Math.round(esperado * 100) / 100, motivo: ok ? null : `saldo final ${linha.saldoFinal} ≠ ${Math.round(esperado * 100) / 100} pela natureza da raiz (${raiz})` };
}
