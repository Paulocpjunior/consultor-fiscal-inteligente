/**
 * relatoriosAgregacoes.ts — PURO (testável). As contas dos relatórios do menu
 * Relatórios que agregam documentos fiscais (lista do Paulo, 01/08: resumo
 * CFOP, ICMS/IPI/ISS, serviços tomados/prestados, retenções, resumo por UF).
 *
 * Régua única: as colunas Base/Isentos/Outras saem de alocarTributacaoIcms —
 * a MESMA alocação do Exportar SAGE e do Livro. Relatório nunca inventa conta.
 */
import type { DocumentoFiscal } from '../types';
import { alocarTributacaoIcms } from './iobSageExportService';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);

export const docValido = (d: DocumentoFiscal) => !CANCELADOS.has(d.status);
const contabilDoc = (d: DocumentoFiscal) => d.totais?.vNF || d.valorTotal || 0;

/** Contraparte (quem não é a empresa): destinatário na saída e na nota própria de entrada. */
export function contraparteDoc(d: DocumentoFiscal): any {
    const propriaEntrada = String((d as any).tpNF ?? '') === '0';
    return (d.direcao === 'saida' || propriaEntrada)
        ? (d.destinatario || d.tomador)
        : (d.emitente || d.prestador);
}

// ─── Resumo por CFOP ────────────────────────────────────────────────────────

export interface LinhaCfop {
    cfop: string;
    direcao: 'entrada' | 'saida';
    notas: number;
    itens: number;
    contabil: number;
    base: number;
    icms: number;
    isentos: number;
    outras: number;
    ipi: number;
}

/**
 * Agrega por CFOP com o contábil da nota RATEADO entre os CFOPs dela na
 * proporção do valor dos itens (mesma regra do E201 do Exportar SAGE).
 */
export function resumoPorCfop(docs: DocumentoFiscal[]): LinhaCfop[] {
    const mapa = new Map<string, LinhaCfop>();
    for (const d of docs) {
        if (!docValido(d) || !(d.itens || []).length) continue;
        const porCfop = new Map<string, typeof d.itens>();
        for (const it of d.itens) {
            const cfop = String(it.cfop || '0000').replace(/\D/g, '') || '0000';
            if (!porCfop.has(cfop)) porCfop.set(cfop, []);
            porCfop.get(cfop)!.push(it);
        }
        const valorGrupo = (its: typeof d.itens) => its.reduce((a, i) => a + (i.vProd || 0) - (i.vDesc || 0), 0);
        const totalItens = Array.from(porCfop.values()).reduce((a, g) => a + valorGrupo(g), 0);
        const contabil = contabilDoc(d);
        const grupos = Array.from(porCfop.entries());
        let distribuido = 0;
        grupos.forEach(([cfop, its], idx) => {
            const ultimo = idx === grupos.length - 1;
            const contabilLinha = ultimo
                ? r2(contabil - distribuido)
                : (totalItens > 0 ? r2(contabil * (valorGrupo(its) / totalItens)) : 0);
            distribuido = r2(distribuido + contabilLinha);
            const a = alocarTributacaoIcms(its, contabilLinha);
            const k = `${d.direcao}|${cfop}`;
            const linha = mapa.get(k) || {
                cfop, direcao: d.direcao as 'entrada' | 'saida',
                notas: 0, itens: 0, contabil: 0, base: 0, icms: 0, isentos: 0, outras: 0, ipi: 0,
            };
            linha.notas += 1;
            linha.itens += its.length;
            linha.contabil = r2(linha.contabil + contabilLinha);
            linha.base = r2(linha.base + a.base);
            linha.icms = r2(linha.icms + a.icms);
            linha.isentos = r2(linha.isentos + a.isentos);
            linha.outras = r2(linha.outras + a.outras);
            linha.ipi = r2(linha.ipi + a.ipi);
            mapa.set(k, linha);
        });
    }
    return Array.from(mapa.values()).sort((a, b) =>
        a.direcao.localeCompare(b.direcao) || a.cfop.localeCompare(b.cfop));
}

// ─── ICMS / IPI / ISS ───────────────────────────────────────────────────────

export interface ResumoImpostos {
    icms: { creditoEntradas: number; debitoSaidas: number; saldo: number };
    ipi: { creditoEntradas: number; debitoSaidas: number; saldo: number };
    iss: { prestados: number; retidoTomados: number };
}

/**
 * Débitos × créditos DESTACADOS nos documentos da competência. É resumo de
 * escrituração (o que as notas carregam), NÃO a apuração — crédito de entrada
 * depende de direito a crédito que só a apuração conhece; a observação do PDF
 * diz isso.
 */
export function resumoImpostos(docs: DocumentoFiscal[]): ResumoImpostos {
    const out: ResumoImpostos = {
        icms: { creditoEntradas: 0, debitoSaidas: 0, saldo: 0 },
        ipi: { creditoEntradas: 0, debitoSaidas: 0, saldo: 0 },
        iss: { prestados: 0, retidoTomados: 0 },
    };
    for (const d of docs) {
        if (!docValido(d)) continue;
        if (d.tipo === 'NFSe') {
            if (d.direcao === 'saida') out.iss.prestados = r2(out.iss.prestados + (d.valores?.iss || 0));
            else out.iss.retidoTomados = r2(out.iss.retidoTomados + (d.valores?.valorIssRetido || 0));
            continue;
        }
        const icms = (d.itens || []).reduce((a, i) => a + (i.vICMS || 0), 0) || d.totais?.vICMS || 0;
        const ipi = (d.itens || []).reduce((a, i) => a + (i.vIPI || 0), 0) || d.totais?.vIPI || 0;
        if (d.direcao === 'saida') {
            out.icms.debitoSaidas = r2(out.icms.debitoSaidas + icms);
            out.ipi.debitoSaidas = r2(out.ipi.debitoSaidas + ipi);
        } else {
            out.icms.creditoEntradas = r2(out.icms.creditoEntradas + icms);
            out.ipi.creditoEntradas = r2(out.ipi.creditoEntradas + ipi);
        }
    }
    out.icms.saldo = r2(out.icms.debitoSaidas - out.icms.creditoEntradas);
    out.ipi.saldo = r2(out.ipi.debitoSaidas - out.ipi.creditoEntradas);
    return out;
}

// ─── Serviços tomados / prestados + retenções ───────────────────────────────

export interface LinhaServico {
    data: string;
    numero: string;
    participante: string;
    doc: string;
    municipio: string;
    base: number;
    iss: number;
    issRetido: number;
    pis: number;
    cofins: number;
    ir: number;
    inss: number;
    csll: number;
    liquido: number;
    /** Doc gravado antes de 01/08 não tem IR/INSS/CSLL — ausente ≠ zero retido. */
    retencoesFederaisGravadas: boolean;
}

export function linhasServicos(docs: DocumentoFiscal[], direcao: 'entrada' | 'saida'): LinhaServico[] {
    return docs
        .filter(d => docValido(d) && d.tipo === 'NFSe' && d.direcao === direcao)
        .map(d => {
            const parte: any = direcao === 'saida' ? (d.tomador || d.destinatario) : (d.prestador || d.emitente);
            const v = d.valores || {};
            return {
                data: (d.dhEmi || '').slice(0, 10).split('-').reverse().join('/'),
                numero: d.numero || '—',
                participante: parte?.nome || '—',
                doc: String(parte?.cnpjCpf || '').replace(/\D/g, ''),
                municipio: parte?.municipio || '',
                base: v.baseCalculo ?? d.valorTotal ?? 0,
                iss: v.iss || 0,
                issRetido: v.valorIssRetido || 0,
                pis: v.pis || 0,
                cofins: v.cofins || 0,
                ir: v.ir || 0,
                inss: v.inss || 0,
                csll: v.csll || 0,
                liquido: v.liquido ?? d.valorTotal ?? 0,
                retencoesFederaisGravadas: v.ir !== undefined || v.inss !== undefined || v.csll !== undefined,
            };
        })
        .sort((a, b) => a.data.localeCompare(b.data) || a.numero.localeCompare(b.numero));
}

/** Só as notas com ALGUMA retenção (federal ou ISS retido). */
export function linhasRetencoes(docs: DocumentoFiscal[], direcao: 'entrada' | 'saida'): LinhaServico[] {
    return linhasServicos(docs, direcao)
        .filter(l => l.issRetido + l.pis + l.cofins + l.ir + l.inss + l.csll > 0);
}

export interface DiagnosticoRetencoes {
    /** NFS-e da direção no recorte (com ou sem retenção). */
    totalNotas: number;
    /** Notas com alguma retenção destacada. */
    comRetencao: number;
    /** Notas SEM os campos federais gravados — ausente ≠ zero retido. */
    semCamposGravados: number;
    /**
     * O relatório pode afirmar "não houve retenção"? Só quando TODAS as notas
     * do recorte têm os campos gravados. Com nota sem campo, "0,00" significa
     * "não foi capturado", e dizer "nenhuma retenção" é responder uma pergunta
     * que o dado não responde.
     */
    podeAfirmarZero: boolean;
    /** Frase pronta pro vazio da tela e pra observação do PDF. */
    mensagem: string;
}

/**
 * Diagnóstico do recorte de retenções.
 *
 * POR QUE EXISTE (equipe, 05/08): a aba Retenções dizia "Nenhuma NFS-e
 * prestada com retenção neste recorte" para uma empresa cujo relatório de
 * Serviços prestados, no MESMO recorte, avisava que as 9 notas foram
 * importadas antes de 01/08 e não têm IR/INSS/CSLL gravados. As duas telas
 * liam o mesmo dado e davam respostas opostas — e a errada era a que
 * AFIRMAVA. O aviso até existia, mas era contado sobre a lista JÁ FILTRADA
 * (só notas com retenção), que nesse caso é vazia: o alerta nunca aparecia
 * exatamente no caso em que ele importa.
 */
export function diagnosticoRetencoes(
    docs: DocumentoFiscal[],
    direcao: 'entrada' | 'saida',
): DiagnosticoRetencoes {
    const todas = linhasServicos(docs, direcao);
    const comRetencao = todas.filter(
        l => l.issRetido + l.pis + l.cofins + l.ir + l.inss + l.csll > 0,
    ).length;
    const semCamposGravados = todas.filter(l => !l.retencoesFederaisGravadas).length;
    const podeAfirmarZero = todas.length > 0 && semCamposGravados === 0;
    const rotulo = direcao === 'entrada' ? 'tomada' : 'prestada';

    let mensagem: string;
    if (todas.length === 0) {
        mensagem = `Nenhuma NFS-e ${rotulo} neste recorte.`;
    } else if (comRetencao > 0 && semCamposGravados > 0) {
        mensagem = `${semCamposGravados} de ${todas.length} nota(s) não têm IR/INSS/CSLL gravados `
            + '(importadas antes de 01/08/2026) — pode haver retenção além da listada. '
            + 'Reimporte o XML para completar.';
    } else if (semCamposGravados > 0) {
        mensagem = `NÃO é possível afirmar que não houve retenção: ${semCamposGravados} de ${todas.length} `
            + 'nota(s) foram importadas antes de 01/08/2026 e não têm IR/INSS/CSLL gravados. '
            + 'Reimporte o XML da competência para completar.';
    } else if (comRetencao === 0) {
        mensagem = `Nenhuma das ${todas.length} NFS-e ${rotulo} do recorte tem retenção — `
            + 'todas com os campos conferidos.';
    } else {
        mensagem = `${comRetencao} de ${todas.length} NFS-e ${rotulo} com retenção.`;
    }

    return { totalNotas: todas.length, comRetencao, semCamposGravados, podeAfirmarZero, mensagem };
}

// ─── NF Saídas Canceladas/Faltantes ─────────────────────────────────────────

export interface LinhaSerieNumeracao {
    modelo: string;
    serie: string;
    /** Menor e maior número EMITIDOS pela empresa na competência. */
    primeiro: number;
    ultimo: number;
    autorizadas: number;
    canceladas: number[];
    /** Números ausentes entre primeiro..último (limitado a 500 — ver faltantesTotal). */
    faltantes: number[];
    faltantesTotal: number;
}

const LIMITE_FALTANTES = 500;

/**
 * Completude da numeração das notas EMITIDAS pela empresa (mod 55/65), por
 * série. A nota própria de entrada (tpNF=0) CONSOME número do mesmo talão —
 * por isso o recorte é "emitente == empresa", não "direção == saída".
 * Buraco ≠ nota perdida: pode ser inutilização na SEFAZ (não gera XML) ou
 * captura incompleta (cofre/autXML) — as ressalvas ficam na tela e no PDF.
 */
export function nfCanceladasFaltantes(docs: DocumentoFiscal[], empresaCnpj: string): LinhaSerieNumeracao[] {
    const cnpj = String(empresaCnpj || '').replace(/\D/g, '');
    const mapa = new Map<string, { modelo: string; serie: string; presentes: Set<number>; canceladas: Set<number> }>();
    for (const d of docs) {
        const tipoDoc = (d as any).tipoDoc || d.tipo;
        if (!['NFe', 'NFCe'].includes(tipoDoc)) continue;
        if (String(d.emitente?.cnpjCpf || '').replace(/\D/g, '') !== cnpj) continue;
        const num = parseInt(String(d.numero || '').replace(/\D/g, ''), 10);
        if (!Number.isFinite(num) || num <= 0) continue;
        const modelo = String(d.modelo || (tipoDoc === 'NFCe' ? '65' : '55'));
        const serie = String(parseInt(String(d.serie || '0').replace(/\D/g, '') || '0', 10));
        const k = `${modelo}|${serie}`;
        const g = mapa.get(k) || { modelo, serie, presentes: new Set<number>(), canceladas: new Set<number>() };
        g.presentes.add(num);
        if (CANCELADOS.has(d.status)) g.canceladas.add(num);
        mapa.set(k, g);
    }
    return Array.from(mapa.values()).map(g => {
        const nums = Array.from(g.presentes).sort((a, b) => a - b);
        const primeiro = nums[0], ultimo = nums[nums.length - 1];
        const faltantes: number[] = [];
        let faltantesTotal = 0;
        for (let n = primeiro; n <= ultimo; n++) {
            if (!g.presentes.has(n)) {
                faltantesTotal++;
                if (faltantes.length < LIMITE_FALTANTES) faltantes.push(n);
            }
        }
        return {
            modelo: g.modelo, serie: g.serie, primeiro, ultimo,
            autorizadas: nums.length - g.canceladas.size,
            canceladas: Array.from(g.canceladas).sort((a, b) => a - b),
            faltantes, faltantesTotal,
        };
    }).sort((a, b) => a.modelo.localeCompare(b.modelo) || Number(a.serie) - Number(b.serie));
}

/** Compacta [3,4,5,9] em "3–5, 9" (pra tela e PDF não estourarem). */
export function formatarFaixas(nums: number[]): string {
    if (!nums.length) return '';
    const faixas: string[] = [];
    let ini = nums[0], fim = nums[0];
    for (let i = 1; i <= nums.length; i++) {
        if (i < nums.length && nums[i] === fim + 1) { fim = nums[i]; continue; }
        faixas.push(ini === fim ? String(ini) : `${ini}–${fim}`);
        if (i < nums.length) { ini = nums[i]; fim = nums[i]; }
    }
    return faixas.join(', ');
}

// ─── Resumo por participante (fornecedor/cliente) ───────────────────────────

export interface LinhaParticipante {
    doc: string;
    nome: string;
    uf: string;
    municipio: string;
    notas: number;
    valor: number;
}

/**
 * Ranking por CONTRAPARTE (fornecedor nas entradas, cliente nas saídas) —
 * cobre os "Resumo por fornecedor/cliente" e a listagem "Clientes e
 * fornecedores" do E-Fiscal num painel só. NFe e NFSe juntas.
 */
export function resumoPorParticipante(docs: DocumentoFiscal[], direcao: 'entrada' | 'saida'): LinhaParticipante[] {
    const mapa = new Map<string, LinhaParticipante>();
    for (const d of docs) {
        if (!docValido(d) || d.direcao !== direcao) continue;
        const parte: any = contraparteDoc(d);
        const doc = String(parte?.cnpjCpf || '').replace(/\D/g, '');
        const k = doc || `nome:${String(parte?.nome || '—').toUpperCase()}`;
        const linha = mapa.get(k) || {
            doc, nome: parte?.nome || '—', uf: String(parte?.uf || '').toUpperCase(),
            municipio: parte?.municipio || '', notas: 0, valor: 0,
        };
        linha.notas += 1;
        linha.valor = r2(linha.valor + contabilDoc(d));
        if (!linha.uf && parte?.uf) linha.uf = String(parte.uf).toUpperCase();
        if (!linha.municipio && parte?.municipio) linha.municipio = parte.municipio;
        mapa.set(k, linha);
    }
    return Array.from(mapa.values()).sort((a, b) => b.valor - a.valor);
}

// ─── Resumo por alíquota (ICMS) ─────────────────────────────────────────────

export interface LinhaAliquota {
    direcao: 'entrada' | 'saida';
    /** Alíquota em % para tributadas; null nas linhas Isentas e Outras. */
    aliquota: number | null;
    rotulo: string;
    itens: number;
    valor: number;
    base: number;
    icms: number;
}

/**
 * Base × ICMS por alíquota destacada (conferência de GIA). Mesma régua de CST
 * da alocação do Exportar SAGE: 40/41/50 = Isentas; sem destaque = Outras
 * (ST/diferimento/Simples).
 */
export function resumoPorAliquota(docs: DocumentoFiscal[]): LinhaAliquota[] {
    const mapa = new Map<string, LinhaAliquota>();
    const add = (direcao: 'entrada' | 'saida', aliquota: number | null, rotulo: string, valor: number, base: number, icms: number) => {
        const k = `${direcao}|${aliquota ?? rotulo}`;
        const linha = mapa.get(k) || { direcao, aliquota, rotulo, itens: 0, valor: 0, base: 0, icms: 0 };
        linha.itens += 1;
        linha.valor = r2(linha.valor + valor);
        linha.base = r2(linha.base + base);
        linha.icms = r2(linha.icms + icms);
        mapa.set(k, linha);
    };
    for (const d of docs) {
        const tipoDoc = (d as any).tipoDoc || d.tipo;
        if (!docValido(d) || !['NFe', 'NFCe'].includes(tipoDoc)) continue;
        const direcao = d.direcao as 'entrada' | 'saida';
        for (const it of d.itens || []) {
            const valorItem = r2((it.vProd || 0) - (it.vDesc || 0));
            const cst = String(it.cst || '').replace(/\D/g, '');
            if ((it.vICMS || 0) > 0) {
                const base = (it.vBC || 0) > 0 ? (it.vBC as number) : valorItem;
                const aliq = (it.aliqIcms || 0) > 0
                    ? r2(it.aliqIcms as number)
                    : (base > 0 ? r2(((it.vICMS || 0) / base) * 100) : null);
                add(direcao, aliq, aliq !== null ? `${aliq}%` : 'Tributadas s/ alíquota', valorItem, base, it.vICMS || 0);
            } else if (['40', '41', '50'].includes(cst)) {
                add(direcao, null, 'Isentas / não tributadas', valorItem, 0, 0);
            } else {
                add(direcao, null, 'Outras (ST · diferido · Simples)', valorItem, 0, 0);
            }
        }
    }
    return Array.from(mapa.values()).sort((a, b) =>
        a.direcao.localeCompare(b.direcao)
        || (b.aliquota ?? -1) - (a.aliquota ?? -1)
        || a.rotulo.localeCompare(b.rotulo));
}

// ─── Lançamento por produto (NCM) ───────────────────────────────────────────

export interface LinhaProduto {
    produto: string;
    ncm: string;
    cfops: string;
    unidade: string;
    qtd: number;
    itens: number;
    notas: number;
    valor: number;
}

/** Agregado por produto (NCM + descrição), com quantidade quando a unidade é única. */
export function resumoPorProduto(docs: DocumentoFiscal[], direcao: 'entrada' | 'saida'): LinhaProduto[] {
    const mapa = new Map<string, LinhaProduto & { _unidades: Set<string>; _cfops: Set<string>; _notas: Set<string> }>();
    for (const d of docs) {
        const tipoDoc = (d as any).tipoDoc || d.tipo;
        if (!docValido(d) || d.direcao !== direcao || !['NFe', 'NFCe'].includes(tipoDoc)) continue;
        for (const it of d.itens || []) {
            const produto = String(it.xProd || '—').trim().toUpperCase();
            const ncm = String(it.ncm || '').replace(/\D/g, '');
            const k = `${ncm}|${produto}`;
            const linha = mapa.get(k) || {
                produto, ncm: ncm || '—', cfops: '', unidade: '', qtd: 0, itens: 0, notas: 0, valor: 0,
                _unidades: new Set<string>(), _cfops: new Set<string>(), _notas: new Set<string>(),
            };
            linha.itens += 1;
            linha.qtd = r2(linha.qtd + (it.qCom || 0));
            linha.valor = r2(linha.valor + (it.vProd || 0) - (it.vDesc || 0));
            if (it.uCom) linha._unidades.add(String(it.uCom).trim().toUpperCase());
            if (it.cfop) linha._cfops.add(String(it.cfop).replace(/\D/g, ''));
            linha._notas.add(d.id || d.chave);
            mapa.set(k, linha);
        }
    }
    return Array.from(mapa.values()).map(l => ({
        produto: l.produto, ncm: l.ncm,
        cfops: Array.from(l._cfops).sort().join(' '),
        unidade: l._unidades.size === 1 ? Array.from(l._unidades)[0] : (l._unidades.size ? 'várias' : '—'),
        qtd: l.qtd, itens: l.itens, notas: l._notas.size, valor: l.valor,
    })).sort((a, b) => b.valor - a.valor);
}

// ─── Resumo por UF ──────────────────────────────────────────────────────────

export interface LinhaUf {
    uf: string;
    entradasQtd: number;
    entradasValor: number;
    saidasQtd: number;
    saidasValor: number;
}

export function resumoPorUf(docs: DocumentoFiscal[]): LinhaUf[] {
    const mapa = new Map<string, LinhaUf>();
    for (const d of docs) {
        if (!docValido(d)) continue;
        const parte = contraparteDoc(d);
        const uf = String(parte?.uf || '').toUpperCase() || '??';
        const linha = mapa.get(uf) || { uf, entradasQtd: 0, entradasValor: 0, saidasQtd: 0, saidasValor: 0 };
        const valor = contabilDoc(d);
        if (d.direcao === 'saida') { linha.saidasQtd++; linha.saidasValor = r2(linha.saidasValor + valor); }
        else { linha.entradasQtd++; linha.entradasValor = r2(linha.entradasValor + valor); }
        mapa.set(uf, linha);
    }
    return Array.from(mapa.values()).sort((a, b) =>
        (b.saidasValor + b.entradasValor) - (a.saidasValor + a.entradasValor));
}
