// ============================================================================
// sefaz-backend/dere-evento-d1101.js  (PURO — sem I/O, testável)
// ----------------------------------------------------------------------------
// 🏦 D-1101 — BALANCETE MENSAL, o evento periódico que o D-1199 exige (MS1146).
// Nasceu em 27/09/2026 do balancete analítico de TESTE (07/2026) que o Paulo
// mandou; o insumo vem do `dere-insumo-contabil.js` e o PGCC do
// `dere-evento-d1011.js` — o balancete só aceita conta que ESTÁ no PGCC
// (CCTA_NO_PGCC, MS1118) e que é ANALÍTICA (MS1120).
//
// FONTES: XSD `evtBalancete-v1_0_1.xsd` (pacote 1.2.0), Leiautes 1.1.0 seção
// 2.1 (campos 1-29) e Anexo II 1.2.0 — CCTA_NO_PGCC, CONFERIR_SALDO_INICIAL,
// CONFERIR_VAPUR (MS1141), OBRIGAR_NATVAPUR (MS1142), MS1081 (conta repetida),
// REJEITAR_PERAPUR_FUTURO (MS1155), PERAPUR_FECHADO (MS1166).
//
// AS TRÊS RÉGUAS QUE ESTE MÓDULO APLICA, com a fonte:
//   · SINAL → natureza pela RAIZ (medido no arquivo real, ver o dono do insumo);
//     o valor sai ABSOLUTO com {natSaldoInic}/{natSaldoFinal} ao lado, como o
//     XSD pede ("Valor absoluto (sem sinal)").
//   · CONFERIR_SALDO_INICIAL → conta de resultado ({codNat} 4/5) com saldo
//     inicial ≠ 0 num mês em que a {freqEncerr} declarada exige zero é RECUSA
//     aqui, antes da Receita: o balancete é a PROVA de qual frequência vale.
//   · {vApur} → base sobre a qual o {codTrib} aplica regra. Sem codTrib não há
//     regra, então 0.00 (o XSD manda 0.00 quando não há movimentação a
//     apurar). COM codTrib, o app preenche o movimento na natureza da conta
//     (credora → créditos, devedora → débitos), que é o que CONFERIR_VAPUR
//     recalcula — e DIZ que fez isso. Estornos ({vAjuste*}) não estão na
//     planilha e ficam de fora, ditos.
// ============================================================================

import { XSD_DERE, montarIdEventoDere, arredondarDere, VIGENCIA_DERE } from './dere.js';
import { raizDoCnpj } from './dere-regimes.js';
import { competenciaIsoDe } from './catalogo-obrigacoes.js';
import { normalizarCompetencia } from './competencia.js';
import { VER_APLIC_PADRAO } from './dere-evento-d1001.js';
import { FREQUENCIAS_ENCERRAMENTO } from './dere-evento-d1011.js';
import { natSaldoPelaRaiz, conferirAritmeticaDaLinha } from './dere-insumo-contabil.js';

export const XSD_D1101 = XSD_DERE.find((x) => x.evento === 'D-1101');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Valor no formato do XSD: `(0|[1-9][0-9]{0,14})\.[0-9]{2}`, ABSOLUTO, arredondado pela NBR 5891. */
export function formatarValorDere(valor) {
    const r = arredondarDere(Math.abs(Number(valor) || 0), 2);
    if (!r.ok) return null;
    const s = r.valor.toFixed(2);
    return /^(0|[1-9][0-9]{0,14})\.[0-9]{2}$/.test(s) ? s : null;
}

/**
 * Valida o insumo do D-1101 e devolve as linhas prontas.
 *
 * @param insumo { cnpj, perApur (AAAA-MM), balancete (de lerBalancete), contasPgcc (contas de lerPlanoDeContas),
 *                 foraDoPgcc (as que lerPlanoDeContas deixou fora — compensação/apuração), freqEncerr,
 *                 hoje (Date, para REJEITAR_PERAPUR_FUTURO) }
 */
export function validarInsumoD1101(insumo = {}) {
    const pendencias = [];
    const avisos = [];
    const nrInsc = raizDoCnpj(insumo.cnpj);
    if (!nrInsc) pendencias.push('CNPJ do declarante ilegível — a DeRE identifica o contribuinte pela RAIZ (8 posições).');

    const perApur = normalizarCompetencia(insumo.perApur);
    if (!perApur) pendencias.push('Período de apuração ({perApur}) não informado ou ilegível — AAAA-MM.');
    const bal = insumo.balancete || {};
    const linhasBal = Array.isArray(bal.linhas) ? bal.linhas : [];
    if (perApur && bal.competencia && bal.competencia !== perApur) {
        pendencias.push(`O título do balancete diz ${bal.competencia} e a competência pedida é ${perApur} — arquivo de outro mês não vira balancete deste. Confira qual está certo.`);
    }
    if (perApur) {
        const primeira = competenciaIsoDe(VIGENCIA_DERE);
        if (perApur < primeira) avisos.push(`Competência ${perApur} é ANTERIOR à 1ª competência da DeRE (${primeira}) — serve como TESTE do leiaute; a Receita não recebe período anterior à obrigatoriedade.`);
        const hoje = insumo.hoje instanceof Date ? insumo.hoje : new Date();
        const mesHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
        if (perApur > mesHoje) pendencias.push(`Competência ${perApur} é FUTURA — REJEITAR_PERAPUR_FUTURO (MS1155).`);
    }
    const freq = FREQUENCIAS_ENCERRAMENTO.find((f) => f.codigo === String(insumo.freqEncerr || '').toUpperCase());
    if (!freq) pendencias.push('Frequência de encerramento ({freqEncerr} do PGCC) não informada — sem ela não dá para conferir o saldo inicial das contas de resultado.');

    const pgcc = new Map((Array.isArray(insumo.contasPgcc) ? insumo.contasPgcc : []).map((c) => [c.cCta, c]));
    const foraPgccSet = new Set((Array.isArray(insumo.foraDoPgcc) ? insumo.foraDoPgcc : []).map((c) => c.cCta));
    if (!pgcc.size) pendencias.push('PGCC vazio — o balancete só aceita conta que existe no D-1011 (CCTA_NO_PGCC).');
    if (!linhasBal.length) pendencias.push('Balancete sem linhas.');

    const linhas = [];
    const foraSinteticas = [];
    const foraDoPgcc = [];
    const naoEncontradas = [];
    const aritmetica = [];
    const saldoInicialResultado = [];
    let comCodTrib = 0; let semCodTrib = 0;
    const mes = perApur ? Number(perApur.slice(5, 7)) : null;
    const exigeZero = freq && mes ? freq.mesesZero.includes(mes) : false;

    for (const l of linhasBal) {
        const conta = pgcc.get(l.cCta);
        if (!conta) { (foraPgccSet.has(l.cCta) ? foraDoPgcc : naoEncontradas).push(l.codigo); continue; }
        if (conta.indCta !== 'A') { foraSinteticas.push(l.codigo); continue; }
        if (![1, 2, 3, 4, 5].includes(Number(conta.codNat))) { foraDoPgcc.push(l.codigo); continue; }
        const ari = conferirAritmeticaDaLinha(l);
        if (!ari.ok) aritmetica.push(`${l.codigo}: ${ari.motivo}`);
        const si = natSaldoPelaRaiz(l.cCta, l.saldoInicial, l.saldoInicialNatureza || null);
        const sf = natSaldoPelaRaiz(l.cCta, l.saldoFinal, l.saldoFinalNatureza || null);
        if (!si.nat || !sf.nat) { pendencias.push(`Conta ${l.codigo}: raiz sem natureza conhecida — não dá para dizer se o saldo é devedor ou credor.`); continue; }
        const ehResultado = [4, 5].includes(Number(conta.codNat));
        if (ehResultado && exigeZero && si.valor > 0.005) saldoInicialResultado.push(l.codigo);
        const vMovDebt = formatarValorDere(l.debitos); const vMovCred = formatarValorDere(l.creditos);
        const vSaldoInic = formatarValorDere(si.valor); const vSaldoFinal = formatarValorDere(sf.valor);
        if ([vMovDebt, vMovCred, vSaldoInic, vSaldoFinal].some((x) => x == null)) { pendencias.push(`Conta ${l.codigo}: valor fora do formato do XSD (até 15 inteiros e 2 decimais).`); continue; }
        let vApur = '0.00'; let natVApur = null; let vApurOrigem = 'sem-codtrib';
        if (conta.codTrib) {
            comCodTrib += 1;
            const natMov = conta.natCta === 'C' ? 'C' : 'D';
            const base = natMov === 'C' ? l.creditos : l.debitos;
            vApur = formatarValorDere(base) || '0.00';
            natVApur = vApur !== '0.00' ? natMov : null;
            vApurOrigem = 'movimento-na-natureza-da-conta';
        } else semCodTrib += 1;
        linhas.push({
            cCta: l.cCta, codigo: l.codigo, nome: l.nome, codNat: Number(conta.codNat), codTrib: conta.codTrib || null,
            natSaldoInic: si.nat, vSaldoInic, vMovDebt, vMovCred, natSaldoFinal: sf.nat, vSaldoFinal, natVApur, vApur, vApurOrigem,
        });
    }
    if (naoEncontradas.length) pendencias.push(`${naoEncontradas.length} conta(s) do balancete NÃO estão no plano de contas (CCTA_NO_PGCC, MS1118): ${naoEncontradas.slice(0, 8).join(', ')}${naoEncontradas.length > 8 ? '…' : ''}. Plano e balancete são do mesmo mês?`);
    if (aritmetica.length) pendencias.push(`${aritmetica.length} conta(s) em que saldo final ≠ saldo inicial ± movimento pela natureza da raiz — a planilha está torta ou o sinal segue outra convenção: ${aritmetica.slice(0, 5).join(' · ')}${aritmetica.length > 5 ? '…' : ''}.`);
    if (saldoInicialResultado.length) {
        pendencias.push(`${saldoInicialResultado.length} conta(s) de RESULTADO com saldo inicial ≠ 0,00 em ${perApur}, e a frequência declarada (${freq?.rotulo}) exige zero neste mês — CONFERIR_SALDO_INICIAL. `
            + 'Ou o encerramento é outro (o balancete PROVA que não é este), ou o saldo está errado. Frequências compatíveis com este balancete: '
            + FREQUENCIAS_ENCERRAMENTO.filter((f) => !f.mesesZero.includes(mes)).map((f) => `${f.codigo} ${f.rotulo}`).join(', ') + '.');
    }
    if (foraSinteticas.length) avisos.push(`${foraSinteticas.length} linha(s) SINTÉTICA(S) do balancete ficaram de fora — o D-1101 só aceita conta analítica (MS1120). O total delas é a soma das analíticas, então nada se perde.`);
    if (foraDoPgcc.length) avisos.push(`${foraDoPgcc.length} linha(s) de conta que ficou FORA do PGCC (compensação/apuração) também ficaram fora do balancete — conta que não está no D-1011 não pode estar no D-1101.`);
    if (semCodTrib) avisos.push(`${semCodTrib} conta(s) sem {codTrib} no PGCC saíram com {vApur} 0.00 — sem código de tributação não há base a apurar. Com o codTrib na planilha do plano, o app preenche o movimento na natureza da conta.`);
    if (comCodTrib) avisos.push(`${comCodTrib} conta(s) com {codTrib}: {vApur} = movimento na natureza da conta (credora → créditos, devedora → débitos), sem ajustes — {vAjusteDebt}/{vAjusteCred} (estornos) não estão na planilha. É o que CONFERIR_VAPUR recalcula; se houver estornos, o contador informa.`);
    if (!linhas.length && !pendencias.length) pendencias.push('Nenhuma conta analítica do PGCC no balancete — o D-1101 exige ao menos uma.');
    if (linhas.length > 90000) pendencias.push(`${linhas.length} contas — o XSD 1.0.1 admite até 90.000.`);

    if (pendencias.length) return { ok: false, pendencias, avisos, valores: null };
    return {
        ok: true, pendencias, avisos,
        valores: {
            nrInsc, perApur, freqEncerr: freq.codigo, linhas,
            resumo: { contas: linhas.length, sinteticasFora: foraSinteticas.length, foraDoPgcc: foraDoPgcc.length, comCodTrib, semCodTrib, competenciaDoTitulo: bal.competencia || null },
        },
    };
}

/** Monta o XML do D-1101 (SEM assinatura) na ordem do XSD evtBalancete v1_0_1. */
export function montarEventoD1101(insumo, opts = {}) {
    const tpAmb = String(opts.tpAmb ?? 2);
    const tpOper = String(opts.tpOper ?? 1);
    const pendencias = [];
    if (!['1', '2'].includes(tpAmb)) pendencias.push('tpAmb deve ser 1 (produção) ou 2 (produção restrita).');
    if (tpOper !== '1') pendencias.push('A prévia só monta INCLUSÃO (tpOper 1). Alteração/exclusão exigem o {nrRecibo} do evento anterior.');
    const ins = validarInsumoD1101(insumo);
    pendencias.push(...ins.pendencias);
    if (pendencias.length) return { ok: false, xml: null, id: null, pendencias, avisos: ins.avisos, resumo: null };
    const v = ins.valores;
    const idr = montarIdEventoDere({ codigoEvento: 'D-1101', cnpj: insumo.cnpj, data: opts.data || new Date(), sequencial: opts.sequencial ?? 1 });
    if (!idr.ok) return { ok: false, xml: null, id: null, pendencias: [idr.motivo], avisos: ins.avisos, resumo: null };
    const verAplic = String(opts.verAplic || VER_APLIC_PADRAO).slice(0, 20);
    const L = [];
    L.push(`<DeRE xmlns="${XSD_D1101.namespace}">`);
    L.push(`<evtBalancete id="${idr.id}">`);
    L.push(`<ideEvento><tpOper>${tpOper}</tpOper><tpAmb>${tpAmb}</tpAmb><aplicEmi>1</aplicEmi><verAplic>${esc(verAplic)}</verAplic></ideEvento>`);
    L.push(`<ideContrib><nrInsc>${esc(v.nrInsc)}</nrInsc></ideContrib>`);
    L.push(`<idePeriodo><perApur>${v.perApur}</perApur></idePeriodo>`);
    L.push('<infoBalancete><infoContas>');
    for (const l of v.linhas) {
        L.push('<infoConta>'
            + `<cCta>${esc(l.cCta)}</cCta><natSaldoInic>${l.natSaldoInic}</natSaldoInic><vSaldoInic>${l.vSaldoInic}</vSaldoInic>`
            + `<vMovDebt>${l.vMovDebt}</vMovDebt><vMovCred>${l.vMovCred}</vMovCred>`
            + `<natSaldoFinal>${l.natSaldoFinal}</natSaldoFinal><vSaldoFinal>${l.vSaldoFinal}</vSaldoFinal>`
            + (l.natVApur ? `<natVApur>${l.natVApur}</natVApur>` : '') + `<vApur>${l.vApur}</vApur>`
            + '</infoConta>');
    }
    L.push('</infoContas></infoBalancete>');
    L.push('</evtBalancete></DeRE>');
    return {
        ok: true, xml: L.join(''), id: idr.id, pendencias: [],
        avisos: [
            ...ins.avisos,
            'Prévia SEM assinatura (ds:Signature) — quem assina é o gateway, com o A1 do cofre, na transmissão.',
            tpAmb === '2' ? 'Ambiente: PRODUÇÃO RESTRITA (tpAmb 2).' : 'Ambiente: PRODUÇÃO (tpAmb 1).',
        ],
        resumo: { evento: 'D-1101', xsd: XSD_D1101.arquivo, namespace: XSD_D1101.namespace, tpAmb, tpOper, nrInsc: v.nrInsc, perApur: v.perApur, freqEncerr: v.freqEncerr, ...v.resumo },
    };
}
