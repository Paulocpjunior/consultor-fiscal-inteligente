/**
 * 🧮 ICMS SOBRE VENDAS e ICMS-ST + FCP-ST DESTACADOS — a PROPOSTA da ficha (17/10).
 *
 * Paulo, KROYA 09/2026: a equipe somava o ST no campo "ICMS sobre Vendas" (que
 * só deduz PIS/COFINS), e o campo "ICMS ST (Destacado nas Vendas)" — que deduz a
 * receita bruta de IRPJ/CSLL/PIS/COFINS — ficava zerado. A ficha passa a PROPOR
 * os dois a partir das notas de saída do mês; quem aplica é a pessoa.
 *
 * O que entra: saída válida (régua da direção e do cancelamento), NF-e/NFC-e, por
 * item — ICMS destacado (`icmsDestacadoDoItem`, o mesmo que sai da base do
 * PIS/COFINS no EFD-Contribuições) e ICMS-ST + FCP-ST do item. A lista sai por
 * CFOP: remessa/transferência com ICMS não é venda, e quem tira é a pessoa
 * (o app não deduz o que é receita).
 */
import type { DocumentoFiscal } from '../types';
import { direcaoEfetivaDoc, docCancelado } from '../sefaz-backend/xml-metadata-helper.js';
// @ts-expect-error — módulo .js do backend (sem tipos); o dono do ICMS que sai da base do PIS/COFINS.
import { icmsDestacadoDoItem } from '../sefaz-backend/base-pis-cofins.js';

export interface LinhaIcmsVendasCfop { cfop: string; notas: number; icms: number; icmsSt: number; fcpSt: number }
export interface PropostaIcmsVendas {
    icmsVendas: number;
    icmsStFcp: number;
    notas: number;
    porCfop: LinhaIcmsVendasCfop[];
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n0 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function proporIcmsDasVendas(docs: DocumentoFiscal[], cfopsFora: string[] = []): PropostaIcmsVendas {
    const fora = new Set(cfopsFora);
    const mapa = new Map<string, LinhaIcmsVendasCfop & { _notas: Set<string> }>();
    const notasLidas = new Set<string>();
    for (const d of docs || []) {
        const tipo = (d as any).tipoDoc || d.tipo;
        if (!['NFe', 'NFCe'].includes(tipo)) continue;
        if (direcaoEfetivaDoc(d) !== 'saida' || docCancelado(d)) continue;
        for (const it of (d.itens || []) as any[]) {
            const cfop = String(it.cfop || '').replace(/\D/g, '') || '0000';
            const icms = n0(icmsDestacadoDoItem(it));
            const st = n0(it.vICMSST);
            const fcp = n0(it.vFCPST);
            if (!(icms > 0) && !(st > 0) && !(fcp > 0)) continue;
            const l = mapa.get(cfop) || { cfop, notas: 0, icms: 0, icmsSt: 0, fcpSt: 0, _notas: new Set<string>() };
            l.icms = r2(l.icms + icms); l.icmsSt = r2(l.icmsSt + st); l.fcpSt = r2(l.fcpSt + fcp);
            l._notas.add(String(d.id || d.chave)); mapa.set(cfop, l);
        }
    }
    const porCfop = [...mapa.values()].map(({ _notas, ...l }) => ({ ...l, notas: _notas.size }))
        .sort((a, b) => a.cfop.localeCompare(b.cfop));
    let icmsVendas = 0; let icmsStFcp = 0;
    for (const l of porCfop) {
        if (fora.has(l.cfop)) continue;
        icmsVendas = r2(icmsVendas + l.icms);
        icmsStFcp = r2(icmsStFcp + l.icmsSt + l.fcpSt);
        for (const id of mapa.get(l.cfop)!._notas) notasLidas.add(id);
    }
    return { icmsVendas, icmsStFcp, notas: notasLidas.size, porCfop };
}
