import type {
    SpedFiscalParseResult,
    SpedFiscalConferenceResult,
    SpedFiscalInconsistencia,
    SpedInconsistenciaTipo,
    SpedInconsistenciaGravidade,
    SpedDocumentoC100,
    SpedDocumentoD100,
} from '../types';

export interface XmlConferenciaInput {
    chave?: string;
    numero?: string;
    valorTotal?: number;
    valorIcms?: number;
    status?: string;
}

interface SpedDocGenerico {
    chave?: string;
    numDoc?: string;
    codSit?: string;
    valorDocumento: number;
    valorIcms?: number;
    registro: 'C100' | 'D100';
}

const TOLERANCE = 0.01;

const GRAVITY_MAP: Record<SpedInconsistenciaTipo, SpedInconsistenciaGravidade> = {
    NOTA_CANCELADA_ESCRITURADA: 'CRITICA',
    DOCUMENTO_DUPLICADO: 'CRITICA',
    XML_NAO_ESCRITURADO: 'ALTA',
    SPED_SEM_XML: 'ALTA',
    VALOR_DIVERGENTE: 'ALTA',
    ICMS_DIVERGENTE: 'ALTA',
    CFOP_DIVERGENTE: 'MEDIA',
    CST_DIVERGENTE: 'MEDIA',
    REGISTRO_INCOMPLETO: 'BAIXA',
    CHAVE_INVALIDA: 'BAIXA',
};

function chaveValida(chave: string | undefined): chave is string {
    return typeof chave === 'string' && /^\d{44}$/.test(chave);
}

function makeId(): string {
    return `inc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function buildInconsistencia(
    tipo: SpedInconsistenciaTipo,
    descricao: string,
    chave?: string,
    documento?: string,
    valorXml?: number,
    valorSped?: number,
): SpedFiscalInconsistencia {
    return {
        id: makeId(),
        tipo,
        gravidade: GRAVITY_MAP[tipo],
        chave,
        documento,
        descricao,
        valorXml,
        valorSped,
        status: 'ABERTA',
    };
}

export function conferXmlContraSped(
    xmls: XmlConferenciaInput[],
    parseResult: SpedFiscalParseResult,
): SpedFiscalConferenceResult {
    const inconsistencias: SpedFiscalInconsistencia[] = [];
    // Documentos em que o VALOR não pôde ser lido — o confronto não aconteceu.
    let semValorParaConferir = 0;

    // Unifica C100 (NF-e) + D100 (CT-e) num mapa genérico para conferência
    const allSpedDocs: SpedDocGenerico[] = [
        ...parseResult.documentosC100.map(d => ({
            chave: d.chave, numDoc: d.numDoc, codSit: d.codSit,
            valorDocumento: d.valorDocumento, valorIcms: d.valorIcms, registro: 'C100' as const,
        })),
        ...parseResult.documentosD100.map(d => ({
            chave: d.chave, numDoc: d.numDoc, codSit: d.codSit,
            valorDocumento: d.valorDocumento, valorIcms: d.valorIcms, registro: 'D100' as const,
        })),
    ];

    const spedByChave = new Map<string, SpedDocGenerico>();
    const spedChaveDupCount = new Map<string, number>();

    for (const doc of allSpedDocs) {
        if (!chaveValida(doc.chave)) {
            if (doc.chave) {
                inconsistencias.push(
                    buildInconsistencia(
                        'CHAVE_INVALIDA',
                        `${doc.registro} ${doc.numDoc || '?'} possui chave inválida: ${doc.chave}`,
                        doc.chave,
                        doc.numDoc,
                    ),
                );
            }
            continue;
        }
        const count = (spedChaveDupCount.get(doc.chave) || 0) + 1;
        spedChaveDupCount.set(doc.chave, count);
        if (count > 1) {
            inconsistencias.push(
                buildInconsistencia(
                    'DOCUMENTO_DUPLICADO',
                    `Chave ${doc.chave} aparece ${count} vezes no SPED (${doc.registro})`,
                    doc.chave,
                    doc.numDoc,
                ),
            );
        }
        spedByChave.set(doc.chave, doc);
    }

    const xmlChavesUsadas = new Set<string>();

    for (const xml of xmls) {
        if (!chaveValida(xml.chave)) {
            if (xml.chave) {
                inconsistencias.push(
                    buildInconsistencia(
                        'CHAVE_INVALIDA',
                        `XML ${xml.numero || '?'} possui chave inválida: ${xml.chave}`,
                        xml.chave,
                        xml.numero,
                    ),
                );
            }
            continue;
        }

        xmlChavesUsadas.add(xml.chave);
        const spedDoc = spedByChave.get(xml.chave);

        if (!spedDoc) {
            inconsistencias.push(
                buildInconsistencia(
                    'XML_NAO_ESCRITURADO',
                    `XML com chave ${xml.chave} (nº ${xml.numero || '?'}) não encontrado no SPED`,
                    xml.chave,
                    xml.numero,
                    xml.valorTotal,
                ),
            );
            continue;
        }

        // Nota cancelada escriturada: codSit diferente de '00' (regular) e '08' (emitida em regime especial)
        // mas o XML está autorizado
        const codSitNormal = spedDoc.codSit === '00' || spedDoc.codSit === '08';
        const xmlAutorizado = !xml.status || xml.status === 'autorizado' || xml.status === 'autorizada';
        if (!codSitNormal && xmlAutorizado) {
            inconsistencias.push(
                buildInconsistencia(
                    'NOTA_CANCELADA_ESCRITURADA',
                    `Documento ${spedDoc.numDoc || '?'} escriturado com codSit=${spedDoc.codSit} mas XML está autorizado`,
                    xml.chave,
                    spedDoc.numDoc,
                    xml.valorTotal,
                    spedDoc.valorDocumento,
                ),
            );
        }

        // 🚨 SEM VALOR LEGÍVEL A CONFERÊNCIA NÃO ACONTECE — e antes ela
        // simplesmente PULAVA, calada. Quem lê a tela via "nenhuma divergência
        // de valor" e concluía que os números batiam, quando na verdade nada
        // foi comparado. Agora o pulo é CONTADO e a tela diz.
        if (xml.valorTotal === undefined || xml.valorTotal === null) {
            semValorParaConferir += 1;
        } else {
            const diff = Math.abs((xml.valorTotal || 0) - spedDoc.valorDocumento);
            if (diff > TOLERANCE) {
                inconsistencias.push(
                    buildInconsistencia(
                        'VALOR_DIVERGENTE',
                        `Valor divergente para chave ${xml.chave}: XML R$ ${(xml.valorTotal || 0).toFixed(2)} vs SPED R$ ${spedDoc.valorDocumento.toFixed(2)}`,
                        xml.chave,
                        spedDoc.numDoc,
                        xml.valorTotal,
                        spedDoc.valorDocumento,
                    ),
                );
            }
        }

        if (xml.valorIcms !== undefined && spedDoc.valorIcms !== undefined) {
            const diffIcms = Math.abs((xml.valorIcms || 0) - (spedDoc.valorIcms || 0));
            if (diffIcms > TOLERANCE) {
                inconsistencias.push(
                    buildInconsistencia(
                        'ICMS_DIVERGENTE',
                        `ICMS divergente para chave ${xml.chave}: XML R$ ${(xml.valorIcms || 0).toFixed(2)} vs SPED R$ ${(spedDoc.valorIcms || 0).toFixed(2)}`,
                        xml.chave,
                        spedDoc.numDoc,
                        xml.valorIcms,
                        spedDoc.valorIcms,
                    ),
                );
            }
        }
    }

    for (const [chave, spedDoc] of spedByChave) {
        if (!xmlChavesUsadas.has(chave)) {
            inconsistencias.push(
                buildInconsistencia(
                    'SPED_SEM_XML',
                    `${spedDoc.registro} ${spedDoc.numDoc || '?'} (chave ${chave}) escriturado no SPED mas sem XML correspondente`,
                    chave,
                    spedDoc.numDoc,
                    undefined,
                    spedDoc.valorDocumento,
                ),
            );
        }
    }

    const allDocs = allSpedDocs.length;
    let documentosConferidos = 0;
    for (const xml of xmls) {
        if (chaveValida(xml.chave) && spedByChave.has(xml.chave)) {
            documentosConferidos++;
        }
    }

    return {
        totalXmls: xmls.length,
        totalDocumentosSped: allDocs,
        documentosConferidos,
        semValorParaConferir,
        inconsistencias,
    };
}
