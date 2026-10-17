// ============================================================================
// sefaz-backend/apuracao-icms-st-raicms.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 📕 REGISTRO DE APURAÇÃO DO ICMS — SUBSTITUIÇÃO TRIBUTÁRIA (17/10).
//
// Paulo, com o RAICMS-ST do e-Fiscal (REALITY 09/2026: Saídas ST 5.401 e o
// demonstrativo 001–014 com 1.330,86 a recolher): "seguindo a mesma linha de
// demonstrativo do ICMS e IPI, podemos ter um relatório de ICMS ST?".
//
// ⚠️ ESTE MÓDULO NÃO APURA NADA. Ele lê as linhas que o gerador do SPED já
// montou (`montarLinhasStBlocoE`: E200/E210/E220/E250 por UF) e as distribui
// no modelo do livro. Um número diferente aqui e no arquivo seria o relatório
// divergindo do que a SEFAZ recebe — a lição do RAICMS (14/09).
//
// Mapa do E210 (Guia 3.2.3; índices do array, 0 = 'E210'):
//   2 VL_SLD_CRED_ANT_ST → 009 · 3 VL_DEVOL_ST + 4 VL_RESSARC_ST → 005
//   7 VL_RETENCAO_ST → 001 · 10 VL_SLD_DEV_ANT_ST → 011 · 11 VL_DEDUCOES_ST → 012
//   12 VL_ICMS_RECOL_ST → 013 · 13 VL_SLD_CRED_ST_TRANSPORTAR → 014 · 14 DEB_ESP_ST
// Os ajustes (002 outros débitos, 003 estornos de crédito, 006 outros créditos,
// 007 estornos de débito) saem dos E220 pelo 4º caractere do código (0/1/2/3,
// tabela 5.1.1), cada um na Coluna Auxiliar com o histórico — como o RAICMS.
//
// As SAÍDAS por CFOP (a página do livro) vêm dos documentos com ICMS-ST para a
// UF: contábil do CFOP pelo dono (`contabilDosGruposDeCfop`), base ST, ICMS-ST
// e FCP-ST do documento. A soma do ICMS-ST tem de bater com o 001; se não
// bater, é DITO.
// ============================================================================

import { contabilDosGruposDeCfop } from './contabil-por-cfop.js';
import { docCancelado, direcaoEfetivaDoc } from './xml-metadata-helper.js';
import { ufDoDestinatarioDoc } from './participante-doc-helper.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** "1234,56" (forma do arquivo) → número. */
const doArquivo = (v) => n0(String(v ?? '').replace(/\./g, '').replace(',', '.'));

/** Saídas com ICMS-ST/FCP-ST para cada UF, por CFOP. */
function saidasStPorUf(notas) {
    const porUf = new Map();
    for (const d of notas || []) {
        if (direcaoEfetivaDoc(d) !== 'saida' || docCancelado(d)) continue;
        const itens = Array.isArray(d?.itens) ? d.itens : [];
        const uf = String(ufDoDestinatarioDoc(d) || '').toUpperCase();
        if (!uf || !itens.length) continue;
        const porCfop = new Map();
        for (const it of itens) {
            const cfop = String(it?.cfop || '0000').replace(/\D/g, '') || '0000';
            if (!porCfop.has(cfop)) porCfop.set(cfop, []);
            porCfop.get(cfop).push(it);
        }
        const grupos = [...porCfop.entries()];
        const contabeis = contabilDosGruposDeCfop(d, itens, grupos.map(([, its]) => its), n0(d?.totais?.vNF ?? d?.valorTotal));
        grupos.forEach(([cfop, its], idx) => {
            const soma = (campo) => r2(its.reduce((a, i) => a + n0(i?.[campo]), 0));
            const icmsSt = soma('vICMSST');
            const fcpSt = soma('vFCPST');
            if (!(icmsSt > 0) && !(fcpSt > 0)) return;
            const linhasUf = porUf.get(uf) || new Map();
            const atual = linhasUf.get(cfop) || { cfop, notas: 0, vlCont: 0, bcSt: 0, icmsSt: 0, fcpSt: 0 };
            atual.notas += 1;
            atual.vlCont = r2(atual.vlCont + (contabeis[idx] || 0));
            atual.bcSt = r2(atual.bcSt + soma('vBCST'));
            atual.icmsSt = r2(atual.icmsSt + icmsSt);
            atual.fcpSt = r2(atual.fcpSt + fcpSt);
            linhasUf.set(cfop, atual);
            porUf.set(uf, linhasUf);
        });
    }
    return porUf;
}

/**
 * O livro do ICMS-ST, uma seção por UF.
 *
 * @param {object} p
 * @param {Array<Array<string|number>>} p.linhas  as linhas de `montarLinhasStBlocoE` (arrays de campos)
 * @param {object[]} p.notas  os documentos do período (os mesmos que o gerador leu)
 */
export function montarRaicmsSt({ linhas, notas }) {
    const saidas = saidasStPorUf(notas);
    const ufs = [];
    let atual = null;
    for (const campos of linhas || []) {
        const reg = campos[0];
        if (reg === 'E200') {
            atual = { uf: String(campos[1] || ''), e210: null, ajustes: [], obrigacoes: [] };
            ufs.push(atual);
        } else if (reg === 'E210' && atual) {
            atual.e210 = campos;
        } else if (reg === 'E220' && atual) {
            atual.ajustes.push({ codigo: String(campos[1] || ''), historico: String(campos[2] || ''), valor: doArquivo(campos[3]) });
        } else if (reg === 'E250' && atual) {
            atual.obrigacoes.push({
                codOr: String(campos[1] || ''), valor: doArquivo(campos[2]), vencimento: String(campos[3] || ''),
                codRec: String(campos[4] || ''), mesRef: String(campos[9] || ''),
            });
        }
    }
    return ufs.map((u) => {
        const f = (i) => doArquivo(u.e210?.[i]);
        const ajustesDo = (tipo) => u.ajustes.filter((a) => a.codigo.charAt(3) === tipo);
        const somaAj = (tipo) => r2(ajustesDo(tipo).reduce((s, a) => s + a.valor, 0));
        const l001 = f(7);
        const l002 = somaAj('0');
        const l003 = somaAj('1');
        const l005 = r2(f(3) + f(4));
        const l006 = somaAj('2');
        const l007 = somaAj('3');
        const l008 = r2(l005 + l006 + l007);
        const l009 = f(2);
        const linhaDemo = (codigo, historico, soma, itens = [], secao) => ({ codigo, historico, soma, itens, ...(secao ? { secao } : {}) });
        const item = (a) => ({ codigo: a.codigo, historico: a.historico, valor: a.valor });
        const demonstrativo = [
            linhaDemo('001', 'Por saídas com débito do imposto (ICMS retido)', l001, [], 'Débito do Imposto'),
            linhaDemo('002', 'Outros débitos', l002, ajustesDo('0').map(item)),
            linhaDemo('003', 'Estornos de crédito', l003, ajustesDo('1').map(item)),
            linhaDemo('004', 'Total (001+002+003)', r2(l001 + l002 + l003)),
            linhaDemo('005', 'Por entradas com crédito do imposto (devoluções e ressarcimentos)', l005, [], 'Crédito do Imposto'),
            linhaDemo('006', 'Outros créditos', l006, ajustesDo('2').map(item)),
            linhaDemo('007', 'Estornos de débito', l007, ajustesDo('3').map(item)),
            linhaDemo('008', 'Subtotal (005+006+007)', l008),
            linhaDemo('009', 'Saldo credor do período anterior', l009),
            linhaDemo('010', 'Total (008+009)', r2(l008 + l009)),
            linhaDemo('011', 'Saldo devedor (débito − crédito)', f(10), [], 'Apuração de Saldos'),
            linhaDemo('012', 'Deduções', f(11)),
            linhaDemo('013', 'Imposto a recolher', f(12)),
            linhaDemo('014', 'Saldo credor (crédito − débito) a transportar para o próximo período', f(13)),
        ];
        const saidasUf = [...(saidas.get(u.uf)?.values() || [])].sort((a, b) => a.cfop.localeCompare(b.cfop));
        const totalSaidas = saidasUf.reduce((t, s) => ({
            vlCont: r2(t.vlCont + s.vlCont), bcSt: r2(t.bcSt + s.bcSt), icmsSt: r2(t.icmsSt + s.icmsSt), fcpSt: r2(t.fcpSt + s.fcpSt),
        }), { vlCont: 0, bcSt: 0, icmsSt: 0, fcpSt: 0 });
        const avisos = [];
        if (Math.abs(totalSaidas.icmsSt - l001) > 0.01) {
            avisos.push(`${u.uf}: o ICMS-ST das saídas por CFOP (${totalSaidas.icmsSt.toFixed(2)}) não fecha com o débito do E210 (${l001.toFixed(2)}) — nota com ST só no total, sem o valor nos itens.`);
        }
        const outDeb = r2(f(8) + f(9));
        if (Math.abs(r2(l002 + l003) - outDeb) > 0.01) {
            avisos.push(`${u.uf}: os ajustes de débito (${r2(l002 + l003).toFixed(2)}) não fecham com o E210 (${outDeb.toFixed(2)}).`);
        }
        return {
            uf: u.uf,
            saidas: saidasUf,
            totalSaidas,
            demonstrativo,
            devedor: f(12) > 0,
            impostoARecolher: f(12),
            saldoCredorATransportar: f(13),
            debitosEspeciais: f(14),
            obrigacoes: u.obrigacoes,
            avisos,
        };
    });
}
