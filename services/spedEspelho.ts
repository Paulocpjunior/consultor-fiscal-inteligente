/**
 * spedEspelho — conferência ESPELHO do SPED Fiscal: o arquivo gerado pelo CFI
 * contra o arquivo gerado pelo E-Fiscal (ou pelo PVA) da MESMA empresa e
 * competência.
 *
 * POR QUE ISTO EXISTE: a regra da onda de migração é "no 1º mês o cliente roda
 * nos DOIS sistemas e compara" (docs/plano-migracao-ondas.md). Só que comparar
 * dois arquivos de milhares de linhas na mão não acontece: sem ferramenta, a
 * "conferência" vira olhar o total e confiar.
 *
 * O E-FISCAL É REFERÊNCIA, NUNCA GABARITO (Paulo, 11/08). O arquivo dele saiu de
 * um processo de colcha de retalhos — nem todo campo do sistema era usado, cada
 * colaborador tinha o seu jeito, e havia ajuste à mão em Excel, no PVA e no
 * próprio SPED. Arquivo aceito prova que a RECEITA aceitou, não que está certo.
 * Consequência que este módulo tem que respeitar: divergir do E-Fiscal NÃO é
 * defeito do CFI — é uma PERGUNTA cujo juiz é o XML-fonte. Bater dos dois lados
 * é CORROBORAÇÃO (dois caminhos independentes, um deles manual, no mesmo
 * número), e nenhum motivo de veredito pode atribuir culpa a um dos lados.
 *
 * As conferências que já existiam cruzam o SPED com OUTRA fonte (capturadas,
 * declarado, faturamento). Esta é a única que compara ARQUIVO com ARQUIVO.
 *
 * Módulo PURO — recebe os dois parses prontos e devolve o veredicto.
 */
import type { SpedFiscalParseResult, SpedDocumentoC100, SpedApuracaoE110, SpedConsolidacaoE510 } from '../types';

/** Diferença de centavo é arredondamento, não divergência. */
const TOLERANCIA = 0.005;

/** Modelos que a ponte .FML leva ao E-Fiscal — só NF-e e NFC-e. */
const MODELOS_NA_PONTE = new Set(['55', '65']);

export type ClasseDocumento = 'igual' | 'divergente' | 'so-cfi' | 'so-efiscal' | 'so-cfi-esperado';

export interface DivergenciaValor {
    campo: string;
    cfi: number;
    efiscal: number;
    diferenca: number;
}

export interface DocumentoEspelho {
    chave: string;
    rotulo: string;
    classe: ClasseDocumento;
    valores: DivergenciaValor[];
    /** Explicação quando a ausência é ESPERADA (não é erro de ninguém). */
    motivo?: string;
}

export interface LinhaApuracao {
    campo: string;
    rotulo: string;
    cfi: number | null;
    efiscal: number | null;
    diferenca: number | null;
    /** true quando um dos lados não tem o registro — ausente ≠ zero. */
    naoApurado: boolean;
}

/** Comparação de uma linha do E510 (consolidação do IPI) entre os dois arquivos. */
export interface LinhaE510 {
    cfop: string;
    cstIpi: string;
    /** [cfi, efiscal] de VL_CONT, VL_BC, VL_IPI. */
    valorContabil: [number | null, number | null];
    valorBcIpi: [number | null, number | null];
    valorIpi: [number | null, number | null];
    classe: 'igual' | 'divergente' | 'so-cfi' | 'so-efiscal';
}

export type VeredictoEspelho = 'espelho-bate' | 'divergente' | 'nao-conferivel';

export interface ResultadoEspelho {
    veredicto: VeredictoEspelho;
    /** Motivo obrigatório quando não é 'espelho-bate'. */
    motivo: string;
    identificacao: {
        cnpjCfi: string;
        cnpjEfiscal: string;
        periodoCfi: string;
        periodoEfiscal: string;
        confere: boolean;
    };
    documentos: DocumentoEspelho[];
    resumoDocumentos: {
        iguais: number;
        divergentes: number;
        soCfi: number;
        soEfiscal: number;
        soCfiEsperado: number;
    };
    apuracao: LinhaApuracao[];
    /** E510 — consolidação do IPI por CFOP+CST, comparada linha a linha. */
    consolidacaoIpi: LinhaE510[];
    avisos: string[];
}

/**
 * Compara os E510 (consolidação do IPI) dos dois arquivos, casando por
 * CFOP+CST_IPI. Reproduzir o E510 do E-Fiscal CORROBORA o gerador do IPI ponta a
 * ponta — não o prova: o arquivo de lá pode ter ajuste manual, e quem prova o
 * valor é o XML-fonte. Ausente de um lado ≠ zero.
 */
export function compararE510(
    cfiLinhas: SpedConsolidacaoE510[] = [],
    efiscalLinhas: SpedConsolidacaoE510[] = [],
): LinhaE510[] {
    const chave = (l: SpedConsolidacaoE510) => `${so(l.cfop)}|${(l.cstIpi || '').trim()}`;
    const mapCfi = new Map(cfiLinhas.map((l) => [chave(l), l]));
    const mapEfi = new Map(efiscalLinhas.map((l) => [chave(l), l]));
    const chaves = Array.from(new Set([...mapCfi.keys(), ...mapEfi.keys()])).sort();
    return chaves.map((k) => {
        const c = mapCfi.get(k);
        const e = mapEfi.get(k);
        const bate = (a?: number, b?: number) => Math.abs(num(a) - num(b)) <= TOLERANCIA;
        let classe: LinhaE510['classe'];
        if (c && !e) classe = 'so-cfi';
        else if (!c && e) classe = 'so-efiscal';
        else classe = (bate(c!.valorContabil, e!.valorContabil) && bate(c!.valorBcIpi, e!.valorBcIpi) && bate(c!.valorIpi, e!.valorIpi))
            ? 'igual' : 'divergente';
        return {
            cfop: (c || e)!.cfop,
            cstIpi: (c || e)!.cstIpi,
            valorContabil: [c ? num(c.valorContabil) : null, e ? num(e.valorContabil) : null],
            valorBcIpi: [c ? num(c.valorBcIpi) : null, e ? num(e.valorBcIpi) : null],
            valorIpi: [c ? num(c.valorIpi) : null, e ? num(e.valorIpi) : null],
            classe,
        };
    });
}

const num = (v: number | undefined | null): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const so = (v: string | undefined | null): string => String(v || '').replace(/\D+/g, '');

/**
 * Chave de casamento entre os dois arquivos.
 *
 * CUIDADO: NÃO entra o COD_PART. O código do participante é interno de cada
 * sistema (o 0150 do E-Fiscal numera de um jeito, o do CFI de outro) — casar
 * por ele daria 100% de divergência num arquivo idêntico.
 *
 * A chave da NF-e é a régua quando existe (ela não mente). Sem chave — nota
 * antiga, modelo sem chave — cai em modelo+série+número+sentido, que é o que
 * identifica o documento dentro da competência.
 */
export function chaveDocumento(d: SpedDocumentoC100): string {
    const chave = so(d.chave);
    if (chave.length === 44) return chave;
    const mod = so(d.codMod) || '??';
    const serie = String(d.serie || '').trim();
    const numDoc = so(d.numDoc) || '?';
    const oper = String(d.indOper || '').trim() || '?';
    return `${mod}|${serie}|${numDoc}|${oper}`;
}

const rotuloDoc = (d: SpedDocumentoC100): string => {
    const mod = so(d.codMod) || '??';
    const serie = String(d.serie || '').trim();
    const numDoc = so(d.numDoc) || '?';
    return `mod ${mod} · NF ${numDoc}${serie ? `/${serie}` : ''}`;
};

/** Documento que a ponte .FML nunca levou ao E-Fiscal — ausência esperada. */
export function ausenciaEsperada(d: SpedDocumentoC100): string | null {
    const mod = so(d.codMod);
    if (!mod) return null;
    if (MODELOS_NA_PONTE.has(mod)) return null;
    return `modelo ${mod} — a ponte .FML só leva NF-e (55) e NFC-e (65)`;
}

function compararValores(a: SpedDocumentoC100, b: SpedDocumentoC100): DivergenciaValor[] {
    const campos: Array<[string, keyof SpedDocumentoC100]> = [
        ['Valor do documento', 'valorDocumento'],
        ['ICMS', 'valorIcms'],
        ['IPI', 'valorIpi'],
    ];
    const out: DivergenciaValor[] = [];
    for (const [campo, prop] of campos) {
        const va = num(a[prop] as number | undefined);
        const vb = num(b[prop] as number | undefined);
        if (Math.abs(va - vb) > TOLERANCIA) {
            out.push({ campo, cfi: va, efiscal: vb, diferenca: Number((va - vb).toFixed(2)) });
        }
    }
    return out;
}

const CAMPOS_E110: Array<[keyof SpedApuracaoE110, string]> = [
    ['valorTotalDebitos', 'Total de débitos'],
    ['valorTotalCreditos', 'Total de créditos'],
    ['saldoCredorAnterior', 'Saldo credor anterior'],
    ['valorSaldoDevedor', 'Saldo devedor apurado'],
    ['valorDeducoes', 'Deduções'],
    ['valorIcmsRecolher', 'ICMS a recolher'],
    ['valorSaldoCredorTransportar', 'Saldo credor a transportar'],
];

function compararApuracao(
    a: SpedApuracaoE110 | undefined,
    b: SpedApuracaoE110 | undefined,
): LinhaApuracao[] {
    return CAMPOS_E110.map(([prop, rotulo]) => {
        const temA = !!a;
        const temB = !!b;
        const cfi = temA ? num(a![prop] as number | undefined) : null;
        const efiscal = temB ? num(b![prop] as number | undefined) : null;
        const naoApurado = !temA || !temB;
        return {
            campo: String(prop),
            rotulo,
            cfi,
            efiscal,
            diferenca: naoApurado ? null : Number(((cfi as number) - (efiscal as number)).toFixed(2)),
            naoApurado,
        };
    });
}

const periodoDe = (r: SpedFiscalParseResult): string => {
    const ini = r.registro0000?.dtIni || '';
    const fim = r.registro0000?.dtFin || '';
    return ini || fim ? `${ini} a ${fim}` : '';
};

/**
 * Compara o SPED do CFI com o do E-Fiscal.
 *
 * O E-Fiscal é REFERÊNCIA, não gabarito (Paulo, 11/08): o arquivo dele podia ter
 * ajuste à mão (Excel, PVA, o próprio SPED). Então 'divergente' é uma PERGUNTA
 * ABERTA — pode ser erro do CFI, ajuste manual do lado de lá ou captura
 * incompleta em qualquer um dos dois — e o juiz é o XML-fonte, nunca o outro
 * arquivo. O motivo do veredito NUNCA pode atribuir a culpa a um dos lados.
 *
 * @param cfi     parse do arquivo gerado pelo CFI
 * @param efiscal parse do arquivo gerado pelo E-Fiscal (ou pelo PVA)
 */
export function compararEspelho(
    cfi: SpedFiscalParseResult,
    efiscal: SpedFiscalParseResult,
): ResultadoEspelho {
    const avisos: string[] = [];

    const cnpjCfi = so(cfi.registro0000?.cnpj);
    const cnpjEfiscal = so(efiscal.registro0000?.cnpj);
    const periodoCfi = periodoDe(cfi);
    const periodoEfiscal = periodoDe(efiscal);

    const mesmaEmpresa = !!cnpjCfi && !!cnpjEfiscal && cnpjCfi === cnpjEfiscal;
    const mesmoPeriodo = !!periodoCfi && !!periodoEfiscal && periodoCfi === periodoEfiscal;
    const identificacao = {
        cnpjCfi, cnpjEfiscal, periodoCfi, periodoEfiscal,
        confere: mesmaEmpresa && mesmoPeriodo,
    };

    const vazio = (motivo: string): ResultadoEspelho => ({
        veredicto: 'nao-conferivel',
        motivo,
        identificacao,
        documentos: [],
        resumoDocumentos: { iguais: 0, divergentes: 0, soCfi: 0, soEfiscal: 0, soCfiEsperado: 0 },
        apuracao: [],
        consolidacaoIpi: [],
        avisos,
    });

    // Comparar empresas ou meses diferentes produz um relatório inteiro de
    // divergências falsas — e ele PARECE uma conferência feita. Barra antes.
    if (!mesmaEmpresa) {
        return vazio(
            `Os arquivos são de CNPJs diferentes (${cnpjCfi || 'sem CNPJ'} × ${cnpjEfiscal || 'sem CNPJ'}). `
            + 'Gere os dois arquivos da MESMA empresa e tente de novo.',
        );
    }
    if (!mesmoPeriodo) {
        return vazio(
            `Os arquivos são de períodos diferentes (${periodoCfi || 'sem período'} × ${periodoEfiscal || 'sem período'}). `
            + 'Gere os dois arquivos da MESMA competência e tente de novo.',
        );
    }

    const docsCfi = cfi.documentosC100 || [];
    const docsEfiscal = efiscal.documentosC100 || [];

    // all-failed nunca é verde: sem documento dos dois lados não há o que
    // conferir — e "0 divergências" aqui só significaria "não se olhou".
    if (docsCfi.length === 0 && docsEfiscal.length === 0) {
        return vazio('Nenhum documento (C100) nos dois arquivos — não há o que conferir.');
    }
    if (docsCfi.length === 0) {
        return vazio('O arquivo do CFI não tem documento nenhum (C100). Gere o SPED da competência antes de conferir.');
    }
    if (docsEfiscal.length === 0) {
        return vazio('O arquivo do E-Fiscal não tem documento nenhum (C100). Confirme se exportou a competência certa.');
    }

    const mapaEfiscal = new Map<string, SpedDocumentoC100>();
    for (const d of docsEfiscal) {
        const k = chaveDocumento(d);
        if (mapaEfiscal.has(k)) {
            avisos.push(`O arquivo do E-Fiscal traz o documento ${rotuloDoc(d)} mais de uma vez — comparado só o primeiro.`);
            continue;
        }
        mapaEfiscal.set(k, d);
    }

    const documentos: DocumentoEspelho[] = [];
    const vistos = new Set<string>();

    for (const d of docsCfi) {
        const k = chaveDocumento(d);
        vistos.add(k);
        const par = mapaEfiscal.get(k);
        if (!par) {
            const motivo = ausenciaEsperada(d);
            documentos.push({
                chave: k,
                rotulo: rotuloDoc(d),
                classe: motivo ? 'so-cfi-esperado' : 'so-cfi',
                valores: [],
                motivo: motivo || undefined,
            });
            continue;
        }
        const valores = compararValores(d, par);
        documentos.push({
            chave: k,
            rotulo: rotuloDoc(d),
            classe: valores.length ? 'divergente' : 'igual',
            valores,
        });
    }

    for (const d of docsEfiscal) {
        const k = chaveDocumento(d);
        if (vistos.has(k)) continue;
        documentos.push({
            chave: k,
            rotulo: rotuloDoc(d),
            classe: 'so-efiscal',
            valores: [],
            motivo: 'Está no E-Fiscal e NÃO no CFI — pode ser documento lançado à mão lá ou buraco de captura aqui.',
        });
    }

    const resumoDocumentos = {
        iguais: documentos.filter((d) => d.classe === 'igual').length,
        divergentes: documentos.filter((d) => d.classe === 'divergente').length,
        soCfi: documentos.filter((d) => d.classe === 'so-cfi').length,
        soEfiscal: documentos.filter((d) => d.classe === 'so-efiscal').length,
        soCfiEsperado: documentos.filter((d) => d.classe === 'so-cfi-esperado').length,
    };

    // CT-e vive no bloco D e a ponte também não o leva — a ausência do outro
    // lado é esperada, mas precisa ficar DITA, não sumir da conta.
    const ctesCfi = (cfi.documentosD100 || []).length;
    if (ctesCfi > 0) {
        avisos.push(
            `${ctesCfi} CT-e no bloco D do CFI. A ponte .FML não leva CT-e ao E-Fiscal — a diferença é esperada.`,
        );
    }
    if (resumoDocumentos.soCfiEsperado > 0) {
        avisos.push(
            `${resumoDocumentos.soCfiEsperado} documento(s) só no CFI por modelo fora da ponte .FML — esperado, não é erro.`,
        );
    }

    const consolidacaoIpi = compararE510(cfi.consolidacaoIpiE510, efiscal.consolidacaoIpiE510);
    const e510Divergente = consolidacaoIpi.some((l) => l.classe !== 'igual');
    if (e510Divergente) {
        const div = consolidacaoIpi.filter((l) => l.classe !== 'igual').length;
        avisos.push(`E510 (IPI): ${div} linha(s) de consolidação divergem entre CFI e E-Fiscal — confira o Bloco E do IPI.`);
    }

    const apuracao = compararApuracao(cfi.apuracaoIcms, efiscal.apuracaoIcms);
    const apuracaoNaoConferida = apuracao.some((l) => l.naoApurado);
    const apuracaoDivergente = apuracao.some((l) => !l.naoApurado && Math.abs(l.diferenca as number) > TOLERANCIA);

    if (apuracaoNaoConferida) {
        const falta = !cfi.apuracaoIcms ? 'do CFI' : 'do E-Fiscal';
        avisos.push(`O arquivo ${falta} não tem E110 — a apuração aparece como NÃO APURADA, não como zero.`);
    }

    const divergenciasReais = resumoDocumentos.divergentes + resumoDocumentos.soCfi + resumoDocumentos.soEfiscal;

    if (divergenciasReais === 0 && !apuracaoDivergente && !apuracaoNaoConferida) {
        return {
            veredicto: 'espelho-bate',
            motivo: `Os ${resumoDocumentos.iguais} documento(s) comparáveis e a apuração do E110 batem nos dois arquivos — dois caminhos independentes no mesmo número, o que CORROBORA o do CFI.`,
            identificacao, documentos, resumoDocumentos, apuracao, consolidacaoIpi, avisos,
        };
    }

    if (apuracaoNaoConferida && divergenciasReais === 0 && !apuracaoDivergente) {
        return {
            veredicto: 'nao-conferivel',
            motivo: 'Os documentos batem, mas um dos arquivos não tem apuração (E110) — o número que fecha o mês não foi conferido.',
            identificacao, documentos, resumoDocumentos, apuracao, consolidacaoIpi, avisos,
        };
    }

    const partes: string[] = [];
    if (apuracaoDivergente) partes.push('a apuração do E110 não bate');
    if (resumoDocumentos.divergentes) partes.push(`${resumoDocumentos.divergentes} documento(s) com valor diferente`);
    if (resumoDocumentos.soCfi) partes.push(`${resumoDocumentos.soCfi} só no CFI`);
    if (resumoDocumentos.soEfiscal) partes.push(`${resumoDocumentos.soEfiscal} só no E-Fiscal`);

    return {
        veredicto: 'divergente',
        motivo: `${partes.join(' · ')}. Confira no XML da nota qual dos dois está certo — o arquivo do E-Fiscal pode ter ajuste manual, então divergir dele não quer dizer que o CFI errou. Explique cada divergência antes de migrar o cliente.`,
        identificacao, documentos, resumoDocumentos, apuracao, consolidacaoIpi, avisos,
    };
}
