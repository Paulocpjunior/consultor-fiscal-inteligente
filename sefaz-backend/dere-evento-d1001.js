// ============================================================================
// sefaz-backend/dere-evento-d1001.js  (PURO — sem I/O, testável)
// ----------------------------------------------------------------------------
// 🏦 D-1001 — INFORMAÇÕES DO CONTRIBUINTE, o primeiro evento da DeRE que o CFI
// GERA. Paulo, 02/09 à noite: *"Fiscal, tudo roda no Fiscal"* — a casa da
// geração é esta, e o D-1001 é o único evento cujo INSUMO é inteiramente de
// CADASTRO (regime, atividades, natureza tributária, UFs credenciadas). Os
// mensais (balancete, aplicações) dependem de insumo contábil e vêm depois.
//
// FONTES: Leiautes 1.1.0, seção 1.1 (docs/dere/02-…txt, p. 2-5) e o XSD
// `evtInfoContrib-v1_0_1.xsd` (docs/dere/xsd/). O XML sai na ORDEM do XSD e é
// conferido contra o PRÓPRIO arquivo pelo `dere-xsd-bolso.js` — o teste gera e
// confere; gerador que não passa no próprio XSD não sobe.
//
// O QUE ESTE MÓDULO RECUSA, com o campo nomeado (nunca chuta):
//   · empresa que o cadastro não afirma obrigada (`decidirDereNoCadastro`);
//   · regime secundário igual ao principal, repetido ou fora do leiaute
//     (REG_SEC_DIFERENTE_REG_PRINC);
//   · atividade de regime que a empresa NÃO declarou (REJEITAR_GRUPO_REGIME),
//     regime declarado SEM atividade (EXIGIR_GRUPO_REGIME), código fora das
//     Tabelas 21/31/41 (TPATIVIDADE_REG*);
//   · UF credenciada fora da Tabela 13, ou em quem não é de prognósticos;
//   · `indNatTrib` e `iniValid` ausentes — e `iniValid` anterior ao início da
//     obrigatoriedade (INI_VALID). Data de validade não recebe default.
//
// O QUE ELE NÃO FAZ: assinar e transmitir. A prévia sai SEM `ds:Signature`;
// quem assina é o gateway, com o A1 do cofre, quando houver credencial do
// piloto (INTEGRACAO_DERE.preRequisitos). `entregaPeloApp` continua false.
// ============================================================================

import { ATIVIDADES_DERE, REGIMES_ESPECIFICOS_IBS_CBS, decidirDereNoCadastro, raizDoCnpj, regimeEspecificoPorCodigo } from './dere-regimes.js';
import { XSD_DERE, montarIdEventoDere, VIGENCIA_DERE } from './dere.js';
import { competenciaIsoDe } from './catalogo-obrigacoes.js';

/** Tabela 13 do Anexo I — Unidades Federativas (código IBGE de 2 dígitos). Copiada da fonte. */
export const TABELA_13_UF = Object.freeze({
    11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
    21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
    31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
    41: 'PR', 42: 'SC', 43: 'RS',
    50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
    99: 'BR (União)',
});

/** `indNatTrib` do D-1001 — Leiautes 1.1.0, campo 22. */
export const IND_NAT_TRIB = Object.freeze([
    { codigo: '0', rotulo: 'Tributação regular' },
    { codigo: '1', rotulo: 'Imunidade ou não incidência' },
]);

/** Grupo do `infoContrib` que cada regime do D-1001 preenche (campos 23-33 do leiaute). */
const GRUPO_POR_CODIGO = Object.freeze({ 1: 'servFinanc', 2: 'plAssistSaude', 3: 'prognosticos' });

export const VER_APLIC_PADRAO = 'CFI-1.2';
export const XSD_D1001 = XSD_DERE.find((x) => x.evento === 'D-1001');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Lê uma atividade gravada como `REGIME:NNC` (o regime é o do vocabulário, o
 * código é o da Tabela 21/31/41 DAQUELE regime). Recusa forma sem regime e
 * código que não está na tabela do regime — nunca adivinha a tabela.
 */
export function lerAtividadeDere(bruto) {
    const s = String(bruto ?? '').trim().toUpperCase();
    const m = /^([A-Z_]+):([0-9]{2}[A-Z])$/.exec(s);
    if (!m) {
        return { ok: false, regime: null, codigo: null, motivo: `Atividade "${s}" fora da forma REGIME:NNC (ex.: SERVICOS_FINANCEIROS:01A) — as Tabelas 21/31/41 repetem códigos, então a atividade só existe junto do regime.` };
    }
    const [, regime, codigo] = m;
    const tabela = ATIVIDADES_DERE[regime];
    if (!tabela) return { ok: false, regime, codigo, motivo: `Atividade "${s}": regime "${regime}" não tem tabela de atividades no D-1001.` };
    const linha = tabela.find(([c]) => c === codigo);
    if (!linha) return { ok: false, regime, codigo, motivo: `Atividade "${codigo}" não existe na tabela de ${regimeEspecificoPorCodigo(regime)?.rotulo || regime} (Anexo I).` };
    return { ok: true, regime, codigo, descricao: linha[1], motivo: null };
}

function lista(v) {
    if (v == null || v === '') return [];
    if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
    return String(v).split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Valida os campos do D-1001 que vêm do CADASTRO. Devolve pendências NOMEADAS
 * (o que falta ou está torto) e, quando nada falta, os valores prontos.
 *
 * Lê as DUAS formas (topo e `dadosFiscais`) — a armadilha das duas formas,
 * tratada uma vez aqui.
 */
export function validarInsumoD1001(empresa, { regimeCatalogo } = {}) {
    const df = empresa?.dadosFiscais || {};
    const pendencias = [];
    const avisos = [];

    const veredicto = decidirDereNoCadastro(empresa, { regimeCatalogo });
    if (veredicto.decisao !== 'obrigada') {
        pendencias.push(`A empresa não está OBRIGADA pelo cadastro (${veredicto.decisao}): ${veredicto.motivo}`);
        return { ok: false, pendencias, avisos, veredicto, valores: null };
    }
    const principal = regimeEspecificoPorCodigo(veredicto.regimeEspecifico);

    const nrInsc = raizDoCnpj(empresa?.cnpj);
    if (!nrInsc) pendencias.push('CNPJ do cadastro ilegível — a DeRE identifica o declarante pela RAIZ (8 posições).');

    // Regimes secundários (0-3), do vocabulário, com código no D-1001, ≠ principal, sem repetição.
    const secundarios = [];
    for (const cod of lista(empresa?.dereRegimesSecundarios ?? df.dereRegimesSecundarios)) {
        const r = regimeEspecificoPorCodigo(cod);
        if (!r || !r.dereConfirmada) { pendencias.push(`Regime secundário "${cod}" não tem código no D-1001 (só serviços financeiros, planos de saúde e concursos de prognósticos).`); continue; }
        if (r.codigo === principal.codigo) { pendencias.push(`Regime secundário "${r.rotulo}" é igual ao principal — REG_SEC_DIFERENTE_REG_PRINC.`); continue; }
        if (secundarios.some((s) => s.codigo === r.codigo)) continue;
        secundarios.push(r);
    }
    if (secundarios.length > 3) pendencias.push('Mais de 3 regimes secundários — o D-1001 admite até 3.');

    const regimes = [principal, ...secundarios];

    // indNatTrib: obrigatório, 0 ou 1. Ausência NÃO vira "regular" — imunidade é afirmação.
    const indNatTrib = String(empresa?.dereIndNatTrib ?? df.dereIndNatTrib ?? '').trim();
    if (!IND_NAT_TRIB.some((i) => i.codigo === indNatTrib)) {
        pendencias.push('Natureza tributária (indNatTrib) não informada — 0 tributação regular · 1 imunidade/não incidência. Preencha em Dados Fiscais → DeRE.');
    }

    // Atividades: cada regime declarado exige ≥1 da SUA tabela; código de regime não declarado é recusa.
    // ⚠️ As três tabelas REPETEM códigos (01A existe na 21, na 31 e na 41), então a
    // atividade se grava com o regime na frente — `REGIME:NNC` — senão "05A" seria
    // factoring (Tabela 21) ou "demais operadoras" (Tabela 31) conforme quem lê.
    const atividadesBrutas = lista(empresa?.dereAtividades ?? df.dereAtividades).map((a) => a.toUpperCase());
    const porRegime = Object.fromEntries(regimes.map((r) => [r.codigo, []]));
    for (const bruto of atividadesBrutas) {
        const at = lerAtividadeDere(bruto);
        if (!at.ok) { pendencias.push(at.motivo); continue; }
        if (!porRegime[at.regime]) {
            const r = regimeEspecificoPorCodigo(at.regime);
            pendencias.push(`Atividade "${at.codigo}" é da tabela de ${r?.rotulo || at.regime}, regime que a empresa NÃO declarou — REJEITAR_GRUPO_REGIME.`);
            continue;
        }
        if (!porRegime[at.regime].includes(at.codigo)) porRegime[at.regime].push(at.codigo);
    }
    for (const r of regimes) {
        if (!porRegime[r.codigo].length) {
            pendencias.push(`Regime "${r.rotulo}" declarado sem nenhuma atividade da sua tabela — EXIGIR_GRUPO_REGIME. Marque as atividades em Dados Fiscais → DeRE.`);
        }
        if (porRegime[r.codigo].length > 99) pendencias.push(`Regime "${r.rotulo}" com mais de 99 atividades — o D-1001 admite até 99.`);
    }

    // UFs credenciadas: só em prognósticos (campo 32 é filho de `prognosticos`), Tabela 13, ≤30.
    const ufsBrutas = lista(empresa?.dereUfsCredenciadas ?? df.dereUfsCredenciadas);
    // Grupo 3 do D-1001 é o de prognósticos — comparar pelo código do LEIAUTE, não pelo nome.
    const temPrognosticos = regimes.some((r) => r.codigoD1001 === 3);
    const ufs = [];
    for (const u of ufsBrutas) {
        const cod = u.replace(/\D/g, '').padStart(2, '0');
        if (!TABELA_13_UF[Number(cod)]) { pendencias.push(`UF credenciada "${u}" não está na Tabela 13 (código IBGE de 2 dígitos).`); continue; }
        if (!ufs.includes(cod)) ufs.push(cod);
    }
    if (ufs.length && !temPrognosticos) pendencias.push('UFs credenciadas só existem para concursos de prognósticos — a empresa não declarou esse regime.');
    if (ufs.length > 30) pendencias.push('Mais de 30 UFs credenciadas — o D-1001 admite até 30.');
    if (temPrognosticos && !ufs.length) avisos.push('Concursos de prognósticos sem UF credenciada informada — o grupo UFsCredenc é opcional (OC), então o evento sai sem ele.');

    // iniValid: obrigatório, AAAA-MM-DD, ≥ início da obrigatoriedade (INI_VALID). Sem default.
    const iniValid = String(empresa?.dereIniValid ?? df.dereIniValid ?? '').trim();
    const inicioObrig = `${competenciaIsoDe(VIGENCIA_DERE)}-01`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iniValid)) {
        pendencias.push(`Início da validade (iniValid) não informado em AAAA-MM-DD — para a 1ª onda é ${inicioObrig} (início da obrigatoriedade). Preencha em Dados Fiscais → DeRE.`);
    } else if (iniValid < inicioObrig) {
        pendencias.push(`Início da validade ${iniValid} é anterior ao início da obrigatoriedade (${inicioObrig}) — INI_VALID.`);
    }
    const fimValid = String(empresa?.dereFimValid ?? df.dereFimValid ?? '').trim() || null;
    if (fimValid && (!/^\d{4}-\d{2}-\d{2}$/.test(fimValid) || fimValid < iniValid)) {
        pendencias.push(`Fim da validade ${fimValid} ilegível ou anterior ao início — FIM_VALID.`);
    }

    if (pendencias.length) return { ok: false, pendencias, avisos, veredicto, valores: null };
    return {
        ok: true, pendencias, avisos, veredicto,
        valores: {
            nrInsc, regTribPrinc: principal.codigoD1001,
            regTribSecund: secundarios.map((r) => r.codigoD1001),
            indNatTrib, iniValid, fimValid,
            grupos: regimes.map((r) => ({ grupo: GRUPO_POR_CODIGO[r.codigoD1001], regime: r.codigo, rotulo: r.rotulo, atividades: porRegime[r.codigo] })),
            ufsCredenciadas: temPrognosticos ? ufs : [],
        },
    };
}

/**
 * Monta o XML do D-1001 (SEM assinatura) na ordem do XSD evtInfoContrib v1_0_1.
 *
 * @param empresa doc do cadastro (topo + dadosFiscais)
 * @param opts { regimeCatalogo, tpAmb (1 produção · 2 produção restrita — padrão 2),
 *               tpOper (1 inclusão — o único que a prévia monta), data, sequencial, verAplic }
 */
export function montarEventoD1001(empresa, opts = {}) {
    const tpAmb = String(opts.tpAmb ?? 2);
    const tpOper = String(opts.tpOper ?? 1);
    const pendencias = [];
    if (!['1', '2'].includes(tpAmb)) pendencias.push('tpAmb deve ser 1 (produção) ou 2 (produção restrita).');
    if (tpOper !== '1') pendencias.push('A prévia só monta INCLUSÃO (tpOper 1). Alteração/exclusão exigem o recibo do evento anterior — não há trilho para isso ainda.');

    const insumo = validarInsumoD1001(empresa, { regimeCatalogo: opts.regimeCatalogo });
    pendencias.push(...insumo.pendencias);
    if (pendencias.length) return { ok: false, xml: null, id: null, pendencias, avisos: insumo.avisos, veredicto: insumo.veredicto, resumo: null };

    const v = insumo.valores;
    const idr = montarIdEventoDere({ codigoEvento: 'D-1001', cnpj: empresa?.cnpj, data: opts.data || new Date(), sequencial: opts.sequencial ?? 1 });
    if (!idr.ok) return { ok: false, xml: null, id: null, pendencias: [idr.motivo], avisos: insumo.avisos, veredicto: insumo.veredicto, resumo: null };

    const verAplic = String(opts.verAplic || VER_APLIC_PADRAO).slice(0, 20);
    const L = [];
    L.push(`<DeRE xmlns="${XSD_D1001.namespace}">`);
    L.push(`<evtInfoContrib id="${idr.id}">`);
    L.push('<ideEvento>');
    L.push(`<tpOper>${tpOper}</tpOper>`);
    L.push(`<tpAmb>${tpAmb}</tpAmb>`);
    L.push('<aplicEmi>1</aplicEmi>');
    L.push(`<verAplic>${esc(verAplic)}</verAplic>`);
    L.push('</ideEvento>');
    L.push(`<ideContrib><nrInsc>${esc(v.nrInsc)}</nrInsc></ideContrib>`);
    L.push(`<idePeriodo><iniValid>${v.iniValid}</iniValid>${v.fimValid ? `<fimValid>${v.fimValid}</fimValid>` : ''}</idePeriodo>`);
    L.push('<infoContrib>');
    L.push(`<regTribPrinc>${v.regTribPrinc}</regTribPrinc>`);
    for (const s of v.regTribSecund) L.push(`<regTribSecund>${s}</regTribSecund>`);
    L.push(`<indNatTrib>${v.indNatTrib}</indNatTrib>`);
    // A ordem dos grupos é a do XSD: servFinanc · plAssistSaude · prognosticos.
    for (const grupo of ['servFinanc', 'plAssistSaude', 'prognosticos']) {
        const g = v.grupos.find((x) => x.grupo === grupo);
        if (!g) continue;
        L.push(`<${grupo}>`);
        L.push(`<tpAtividades>${g.atividades.map((a) => `<tpAtividade>${a}</tpAtividade>`).join('')}</tpAtividades>`);
        if (grupo === 'prognosticos' && v.ufsCredenciadas.length) {
            L.push(`<UFsCredenc>${v.ufsCredenciadas.map((u) => `<UFCredenc>${u}</UFCredenc>`).join('')}</UFsCredenc>`);
        }
        L.push(`</${grupo}>`);
    }
    L.push('</infoContrib>');
    L.push('</evtInfoContrib>');
    L.push('</DeRE>');

    return {
        ok: true,
        xml: L.join(''),
        id: idr.id,
        pendencias: [],
        avisos: [
            ...insumo.avisos,
            'Prévia SEM assinatura (ds:Signature) — quem assina é o gateway, com o A1 do cofre, na transmissão.',
            tpAmb === '2' ? 'Ambiente: PRODUÇÃO RESTRITA (tpAmb 2) — o Manual 1.0.2 só documenta este ambiente.' : 'Ambiente: PRODUÇÃO (tpAmb 1).',
        ],
        veredicto: insumo.veredicto,
        resumo: {
            evento: 'D-1001', xsd: XSD_D1001.arquivo, namespace: XSD_D1001.namespace, tpAmb, tpOper,
            nrInsc: v.nrInsc, regTribPrinc: v.regTribPrinc, regTribSecund: v.regTribSecund, indNatTrib: v.indNatTrib,
            iniValid: v.iniValid, fimValid: v.fimValid,
            grupos: v.grupos, ufsCredenciadas: v.ufsCredenciadas,
        },
    };
}
