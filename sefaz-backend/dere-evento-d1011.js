// ============================================================================
// sefaz-backend/dere-evento-d1011.js  (PURO — sem I/O, testável)
// ----------------------------------------------------------------------------
// 🏦 D-1011 — PLANO GERAL DE CONTAS COMENTADO (PGCC), o evento de TABELA que
// todo contribuinte da DeRE entrega antes do primeiro mensal. Nasceu em
// 27/09/2026 do plano de contas de TESTE que o Paulo mandou; o insumo vem do
// `dere-insumo-contabil.js` (a planilha da contabilidade), e este módulo só
// decide o que o LEIAUTE decide.
//
// FONTES: XSD `evtPGCC-v1_0_3.xsd` (pacote 1.2.0, docs/dere/xsd/), Leiautes
// 1.1.0 seção 1.2 (campos 1-39) e Anexo II 1.2.0 — PAI_CTA_ANALITICA
// (MS1074/MS1083/MS1099/MS1100), OBRIGAR_CODTRIB (MS1103/MS1109/MS1115),
// OBRIGAR_IND_TRIB_ISS (MS1102), CONTA_NO_PLANO_CONTAS_REFERENCIAL (MS1077),
// OBRIGAR_CCTAREF_IGUAL_CONTA_PRINCIPAL (MS1114), INI_VALID.
//
// O QUE ESTE MÓDULO NÃO INVENTA, e por quê:
//   · {cCtaRef} é OBRIGATÓRIO em toda conta e vem da Tabela 32 (ANS), 22
//     (COSIF), 23 (SUSEP), 14 (SPED) ou 24 (PREVIC) — todas REFERÊNCIA EXTERNA
//     ("as informações não constam no corpo deste documento"). A planilha de
//     teste não traz a coluna. Sem ela o evento NÃO sai; a única derivação que
//     o app oferece é OPT-IN e DITA (`cCtaRefRegra: 'segmento-1'` — o 1º
//     segmento do código, antes do primeiro ponto, hipótese de que o plano
//     interno desdobra o padrão ANS), carimbada em cada conta e no aviso, para
//     o contador conferir contra o Plano de Contas Padrão da ANS.
//   · {codTrib} (Tabela 11) é obrigatório na analítica (MS1103 — não
//     interrompe). Sem ele o evento sai, com a contagem DITA e a consequência:
//     os condicionais (D-1106/D-1121/D-2101) não se detectam, e o {vApur} do
//     balancete não tem régua.
//   · {planoCtaRef}, {freqEncerr} e {iniValid} são AFIRMAÇÕES do contribuinte
//     — vêm da tela/cadastro. {iniVig} por conta cai em {iniValid} quando a
//     planilha não traz, e isso vai DITO: a conta vige desde o início do PGCC.
// ============================================================================

import { EVENTOS_DERE, XSD_DERE, montarIdEventoDere, VIGENCIA_DERE } from './dere.js';
import { raizDoCnpj } from './dere-regimes.js';
import { competenciaIsoDe } from './catalogo-obrigacoes.js';
import { VER_APLIC_PADRAO } from './dere-evento-d1001.js';

export const XSD_D1011 = XSD_DERE.find((x) => x.evento === 'D-1011');

/** {planoCtaRef} — enumeração do XSD, com a tabela do Anexo I que cada um aponta. */
export const PLANOS_REFERENCIAIS = Object.freeze([
    { codigo: 1, rotulo: 'COSIF', tabela: 'Tabela 22 — Plano de Contas Referencial COSIF (BACEN)' },
    { codigo: 2, rotulo: 'ANS', tabela: 'Tabela 32 — Plano de Contas Padrão da ANS (referência externa)' },
    { codigo: 3, rotulo: 'SUSEP', tabela: 'Tabela 23 — Plano de Contas Referencial SUSEP' },
    { codigo: 4, rotulo: 'SPED', tabela: 'Tabela 14 — Plano de Contas Referencial da ECF/ECD (referência externa)' },
    { codigo: 5, rotulo: 'PREVIC', tabela: 'Tabela 24 — Plano de Contas Referencial PREVIC (1.2.0; não veio)' },
]);

/** {freqEncerr} — e os meses em que CONFERIR_SALDO_INICIAL exige saldo inicial ZERO nas contas de resultado. */
export const FREQUENCIAS_ENCERRAMENTO = Object.freeze([
    { codigo: 'A', rotulo: 'Anual', mesesZero: [1] },
    { codigo: 'S', rotulo: 'Semestral', mesesZero: [1, 7] },
    { codigo: 'Q', rotulo: 'Quadrimestral', mesesZero: [1, 5, 9] },
    { codigo: 'T', rotulo: 'Trimestral', mesesZero: [1, 4, 7, 10] },
    { codigo: 'B', rotulo: 'Bimestral', mesesZero: [1, 3, 5, 7, 9, 11] },
    { codigo: 'M', rotulo: 'Mensal', mesesZero: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
]);

/** Regras de {cCtaRef} que o app oferece. `coluna` é a única que AFIRMA; a outra é hipótese dita. */
export const CCTAREF_REGRAS = Object.freeze([
    { codigo: 'coluna', rotulo: 'Só o que a planilha traz na coluna "Conta Referencial"' },
    { codigo: 'segmento-1', rotulo: 'Hipótese: 1º segmento do código (antes do primeiro ponto) — confira contra o plano referencial' },
]);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Sugestão de {planoCtaRef} pelo regime do D-1001 — só onde a tabela é do PRÓPRIO regulador do regime. */
export function sugerirPlanoCtaRef(codigoD1001) {
    if (Number(codigoD1001) === 2) return { codigo: 2, motivo: 'Planos de assistência à saúde → Tabela 32 (Plano de Contas Padrão da ANS). Sugestão: quem afirma é o contador.' };
    return { codigo: null, motivo: 'O leiaute não amarra o plano referencial ao regime (bancos → COSIF, seguradoras → SUSEP, demais → SPED). Escolha na tela.' };
}

/** Quais eventos condicionais os {codTrib} presentes ACIONAM (Anexo II 1.2.0, RN Tabela de codtribs obrigatórios). */
export function eventosCondicionaisPorCodTrib(codTribs) {
    const set = new Set((codTribs || []).map((c) => String(c)));
    return EVENTOS_DERE.filter((e) => e.condicional?.codTribs?.some((c) => set.has(c)))
        .map((e) => ({ codigo: e.codigo, nome: e.nome, codTribs: e.condicional.codTribs.filter((c) => set.has(c)) }));
}

function cCtaRefDe(conta, regra) {
    if (conta.cCtaRef) return { valor: conta.cCtaRef, origem: 'coluna' };
    if (regra === 'segmento-1') {
        const seg = String(conta.codigo || '').split(/[.\-/]/)[0].replace(/[^0-9A-Za-z]/g, '');
        if (seg && seg.length <= 13) return { valor: seg, origem: 'segmento-1' };
    }
    return { valor: null, origem: null };
}

/**
 * Valida o insumo do D-1011 e devolve os valores prontos para o XML.
 *
 * @param insumo { cnpj, contas (de lerPlanoDeContas), planoCtaRef, freqEncerr, iniValid, fimValid, cCtaRefRegra }
 */
export function validarInsumoD1011(insumo = {}) {
    const pendencias = [];
    const avisos = [];
    const nrInsc = raizDoCnpj(insumo.cnpj);
    if (!nrInsc) pendencias.push('CNPJ do declarante ilegível — a DeRE identifica o contribuinte pela RAIZ (8 posições).');

    const planoCtaRef = Number(insumo.planoCtaRef);
    const plano = PLANOS_REFERENCIAIS.find((p) => p.codigo === planoCtaRef);
    if (!plano) pendencias.push('Plano de contas referencial ({planoCtaRef}) não informado — 1 COSIF · 2 ANS · 3 SUSEP · 4 SPED · 5 PREVIC. É afirmação do contribuinte: escolha na tela.');

    const freq = FREQUENCIAS_ENCERRAMENTO.find((f) => f.codigo === String(insumo.freqEncerr || '').toUpperCase());
    if (!freq) pendencias.push('Frequência de encerramento das contas de resultado ({freqEncerr}) não informada — A anual · S semestral · Q quadrimestral · T trimestral · B bimestral · M mensal. O balancete CONFERE a escolha (CONFERIR_SALDO_INICIAL).');

    const iniValid = String(insumo.iniValid || '').trim();
    const inicioObrig = `${competenciaIsoDe(VIGENCIA_DERE)}-01`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iniValid)) pendencias.push(`Início da validade do PGCC ({iniValid}) não informado em AAAA-MM-DD — para a 1ª onda é ${inicioObrig}. Data de validade não recebe default.`);
    else if (iniValid < inicioObrig) pendencias.push(`Início da validade ${iniValid} é anterior ao início da DeRE (${inicioObrig}) — INI_VALID.`);
    const fimValid = String(insumo.fimValid || '').trim() || null;
    if (fimValid && (!/^\d{4}-\d{2}-\d{2}$/.test(fimValid) || fimValid < iniValid)) pendencias.push(`Fim da validade ${fimValid} ilegível ou anterior ao início — FIM_VALID.`);

    const contas = Array.isArray(insumo.contas) ? insumo.contas : [];
    if (!contas.length) pendencias.push('Nenhuma conta no plano — o PGCC exige ao menos uma ({infoConta} 1-150.000).');
    if (contas.length > 150000) pendencias.push(`${contas.length} contas — o XSD 1.0.3 admite até 150.000.`);

    const regra = CCTAREF_REGRAS.some((r) => r.codigo === insumo.cCtaRefRegra) ? insumo.cCtaRefRegra : 'coluna';
    const porCcta = new Map(contas.map((c) => [c.cCta, c]));
    const linhas = [];
    let semCtaRef = 0; let ctaRefPorHipotese = 0; let semCodTrib = 0; let iniVigDoPgcc = 0;
    const codTribs = new Set();
    for (const c of contas) {
        if (!/^[0-9A-Za-z]{1,53}$/.test(c.cCta || '')) { pendencias.push(`Conta "${c.codigo}": {cCta} inválido.`); continue; }
        if (!['A', 'S'].includes(c.indCta)) { pendencias.push(`Conta ${c.codigo}: {indCta} deve ser A ou S.`); continue; }
        if (!['C', 'D', 'V'].includes(c.natCta)) { pendencias.push(`Conta ${c.codigo}: {natCta} deve ser C, D ou V.`); continue; }
        if (![1, 2, 3, 4, 5].includes(Number(c.codNat))) { pendencias.push(`Conta ${c.codigo}: {codNat} fora de 1-5 — conta sem natureza reconhecida não entra no PGCC.`); continue; }
        if (!Number.isInteger(c.nivelCta) || c.nivelCta < 1 || c.nivelCta > 99) { pendencias.push(`Conta ${c.codigo}: {nivelCta} fora de 1-99.`); continue; }
        if (c.nivelCta > 1 && !c.cCtaSup) pendencias.push(`Conta ${c.codigo}: nível ${c.nivelCta} sem pai ({cCtaSup}) — PAI_CTA_ANALITICA.`);
        if (c.nivelCta === 1 && c.cCtaSup) pendencias.push(`Conta ${c.codigo}: nível 1 não pode ter pai (MS1100).`);
        if (c.indCta === 'A' && !c.cCtaSup) pendencias.push(`Conta ${c.codigo}: analítica sem pai (MS1074).`);
        if (c.cCtaSup && !porCcta.has(c.cCtaSup)) pendencias.push(`Conta ${c.codigo}: o pai ${c.cCtaSup} não está no PGCC (MS1099).`);
        if (c.cCtaSup && porCcta.get(c.cCtaSup)?.indCta === 'A') pendencias.push(`Conta ${c.codigo}: o pai é analítico (MS1083).`);

        const ref = cCtaRefDe(c, regra);
        if (!ref.valor) semCtaRef += 1;
        else if (ref.origem === 'segmento-1') ctaRefPorHipotese += 1;
        if (ref.valor && !/^[0-9A-Za-z]{1,13}$/.test(ref.valor)) pendencias.push(`Conta ${c.codigo}: {cCtaRef} "${ref.valor}" fora do padrão (alfanumérico, até 13).`);

        let codTrib = c.codTrib ? String(c.codTrib) : null;
        if (codTrib && c.indCta === 'S') { pendencias.push(`Conta ${c.codigo}: sintética com {codTrib} — o campo é exclusivo da analítica (MS1109).`); }
        if (codTrib && !/^[1-9]\d{8}$/.test(codTrib)) { pendencias.push(`Conta ${c.codigo}: {codTrib} "${codTrib}" deve ter 9 dígitos entre 100000000 e 999999999 (MS1115).`); codTrib = null; }
        if (c.indCta === 'A' && !codTrib) semCodTrib += 1;
        if (codTrib) codTribs.add(codTrib);

        const indTribISS = c.indTribISS == null || c.indTribISS === '' ? null : String(c.indTribISS);
        if (indTribISS && c.indCta === 'S') pendencias.push(`Conta ${c.codigo}: {indTribISS} é vedado em sintética (MS1102).`);
        if (indTribISS && !['0', '1'].includes(indTribISS)) pendencias.push(`Conta ${c.codigo}: {indTribISS} deve ser 0 ou 1.`);

        let iniVig = c.iniVig || null;
        if (!iniVig) { iniVig = iniValid; iniVigDoPgcc += 1; }
        if (c.fimVig && c.fimVig < iniVig) pendencias.push(`Conta ${c.codigo}: fim de vigência anterior ao início.`);

        linhas.push({
            cCta: c.cCta, cCtaInterna: c.cCta, cDbrMista: '000', nomeCta: String(c.nome || '').slice(0, 100), indCta: c.indCta,
            descCta: c.descCta ? String(c.descCta).slice(0, 600) : null, cCtaSup: c.nivelCta > 1 ? c.cCtaSup : null,
            cCtaRef: ref.valor, cCtaRefOrigem: ref.origem, nivelCta: c.nivelCta, natCta: c.natCta, codNat: Number(c.codNat),
            codTrib, indTribISS, iniVig, fimVig: c.fimVig || null, codigo: c.codigo,
        });
    }
    if (semCtaRef) {
        pendencias.push(`${semCtaRef} conta(s) sem {cCtaRef} — o código do plano REFERENCIAL é obrigatório em TODA conta (${plano ? plano.tabela : 'Tabelas 14/22/23/24/32'}) e a planilha não o traz. `
            + 'Inclua a coluna "Conta Referencial" no plano exportado, ou marque a hipótese "1º segmento do código" na tela — ela sai carimbada como hipótese para o contador conferir.');
    }
    if (ctaRefPorHipotese) {
        avisos.push(`${ctaRefPorHipotese} conta(s) com {cCtaRef} preenchido pela HIPÓTESE "1º segmento do código" (o que vem antes do primeiro ponto). `
            + 'O app não tem a Tabela 32/14/22/23 (referência externa ao leiaute) e não afirma que estes códigos existem nela — MS1077 recusa o que não existir. Confira antes de transmitir.');
    }
    if (semCodTrib) {
        avisos.push(`${semCodTrib} conta(s) analítica(s) sem {codTrib} (Tabela 11). O PGCC é aceito com aviso (MS1103 não interrompe), mas: os eventos condicionais `
            + '(D-1106 aplicações, D-1121 deduções, D-2101 títulos) só se detectam pelo codTrib, e o {vApur} do balancete dessas contas sai 0,00. Inclua a coluna "Código de Tributação" no plano.');
    }
    if (iniVigDoPgcc) avisos.push(`${iniVigDoPgcc} conta(s) sem vigência própria na planilha — {iniVig} saiu igual ao início do PGCC (${iniValid || '—'}): a conta vige desde o início do plano.`);
    avisos.push('Todas as contas saíram com {cDbrMista} 000 — a planilha não marca conta MISTA (desdobramento). Se houver, o contador informa.');
    const condicionais = eventosCondicionaisPorCodTrib([...codTribs]);
    if (condicionais.length) avisos.push(`Os codTribs presentes ACIONAM eventos condicionais: ${condicionais.map((e) => `${e.codigo} (${e.codTribs.join(', ')})`).join(' · ')}.`);

    if (pendencias.length) return { ok: false, pendencias, avisos, valores: null };
    return {
        ok: true, pendencias, avisos,
        valores: {
            nrInsc, planoCtaRef, planoCtaRefRotulo: plano.rotulo, freqEncerr: freq.codigo, iniValid, fimValid, cCtaRefRegra: regra,
            linhas, codTribs: [...codTribs].sort(), condicionais,
            resumo: {
                contas: linhas.length, analiticas: linhas.filter((l) => l.indCta === 'A').length,
                ctaRefPorHipotese, semCodTrib, iniVigDoPgcc,
            },
        },
    };
}

/**
 * Monta o XML do D-1011 (SEM assinatura) na ordem do XSD evtPGCC v1_0_3.
 * @param opts { tpAmb (1|2, padrão 2), tpOper (só 1), data, sequencial, verAplic }
 */
export function montarEventoD1011(insumo, opts = {}) {
    const tpAmb = String(opts.tpAmb ?? 2);
    const tpOper = String(opts.tpOper ?? 1);
    const pendencias = [];
    if (!['1', '2'].includes(tpAmb)) pendencias.push('tpAmb deve ser 1 (produção) ou 2 (produção restrita).');
    if (tpOper !== '1') pendencias.push('A prévia só monta INCLUSÃO (tpOper 1). Alteração/exclusão exigem o recibo do evento anterior.');
    const ins = validarInsumoD1011(insumo);
    pendencias.push(...ins.pendencias);
    if (pendencias.length) return { ok: false, xml: null, id: null, pendencias, avisos: ins.avisos, resumo: null };

    const v = ins.valores;
    const idr = montarIdEventoDere({ codigoEvento: 'D-1011', cnpj: insumo.cnpj, data: opts.data || new Date(), sequencial: opts.sequencial ?? 1 });
    if (!idr.ok) return { ok: false, xml: null, id: null, pendencias: [idr.motivo], avisos: ins.avisos, resumo: null };
    const verAplic = String(opts.verAplic || VER_APLIC_PADRAO).slice(0, 20);

    const L = [];
    L.push(`<DeRE xmlns="${XSD_D1011.namespace}">`);
    L.push(`<evtPGCC id="${idr.id}">`);
    L.push(`<ideEvento><tpOper>${tpOper}</tpOper><tpAmb>${tpAmb}</tpAmb><aplicEmi>1</aplicEmi><verAplic>${esc(verAplic)}</verAplic></ideEvento>`);
    L.push(`<ideContrib><nrInsc>${esc(v.nrInsc)}</nrInsc></ideContrib>`);
    L.push(`<idePeriodo><iniValid>${v.iniValid}</iniValid>${v.fimValid ? `<fimValid>${v.fimValid}</fimValid>` : ''}</idePeriodo>`);
    L.push(`<infoPGCC><planoCtaRef>${v.planoCtaRef}</planoCtaRef><freqEncerr>${v.freqEncerr}</freqEncerr><infoContas>`);
    for (const l of v.linhas) {
        L.push('<infoConta>'
            + `<cCta>${esc(l.cCta)}</cCta><cCtaInterna>${esc(l.cCtaInterna)}</cCtaInterna><cDbrMista>${l.cDbrMista}</cDbrMista>`
            + `<nomeCta>${esc(l.nomeCta)}</nomeCta><indCta>${l.indCta}</indCta>`
            + (l.descCta ? `<descCta>${esc(l.descCta)}</descCta>` : '')
            + (l.cCtaSup ? `<cCtaSup>${esc(l.cCtaSup)}</cCtaSup>` : '')
            + `<cCtaRef>${esc(l.cCtaRef)}</cCtaRef><nivelCta>${l.nivelCta}</nivelCta><natCta>${l.natCta}</natCta><codNat>${l.codNat}</codNat>`
            + (l.codTrib ? `<codTrib>${l.codTrib}</codTrib>` : '')
            + (l.indTribISS ? `<indTribISS>${l.indTribISS}</indTribISS>` : '')
            + `<iniVig>${l.iniVig}</iniVig>` + (l.fimVig ? `<fimVig>${l.fimVig}</fimVig>` : '')
            + '</infoConta>');
    }
    L.push('</infoContas></infoPGCC>');
    L.push('</evtPGCC></DeRE>');
    return {
        ok: true, xml: L.join(''), id: idr.id, pendencias: [],
        avisos: [
            ...ins.avisos,
            'Prévia SEM assinatura (ds:Signature) — quem assina é o gateway, com o A1 do cofre, na transmissão.',
            tpAmb === '2' ? 'Ambiente: PRODUÇÃO RESTRITA (tpAmb 2).' : 'Ambiente: PRODUÇÃO (tpAmb 1).',
        ],
        resumo: {
            evento: 'D-1011', xsd: XSD_D1011.arquivo, namespace: XSD_D1011.namespace, tpAmb, tpOper,
            nrInsc: v.nrInsc, planoCtaRef: v.planoCtaRef, planoCtaRefRotulo: v.planoCtaRefRotulo, freqEncerr: v.freqEncerr,
            iniValid: v.iniValid, fimValid: v.fimValid, cCtaRefRegra: v.cCtaRefRegra, codTribs: v.codTribs, condicionais: v.condicionais, ...v.resumo,
        },
    };
}
