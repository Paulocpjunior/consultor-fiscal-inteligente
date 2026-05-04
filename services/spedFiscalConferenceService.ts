/**
 * spedFiscalConferenceService.ts
 * Conferência XML × SPED.
 *
 * Cruza uma lista de XMLs (forma leve, compatível com a futura coleção
 * documentos_fiscais e com o mock atual do dashboard) contra os documentos
 * C100 do SpedFiscalParseResult. Emite SpedFiscalInconsistencia com
 * gravidade e status iniciais.
 *
 * Esta camada NÃO transmite, NÃO assina nada. Só compara.
 */

import type {
    SpedFiscalParseResult,
    SpedFiscalConferenceResult,
    SpedFiscalInconsistencia,
    SpedInconsistenciaTipo,
    SpedInconsistenciaGravidade,
} from '../types';

// ─── tipo leve para o XML do lado da conferência ─────────────────────────────

/**
 * Forma mínima que o conferencer precisa de cada XML. Tanto o
 * DocumentoFiscalMeta (Firestore) quanto o DocumentoFiscalMock (UI atual)
 * conformam-se a esta interface.
 */
export interface XmlConferenciaInput {
    chave?: string;       // chNFe — 44 dígitos
    numero?: string;
    valorTotal?: number;
    valorIcms?: number;
    status?: string;      // 'autorizado' | 'cancelado' | ...
}

// ─── parâmetros e helpers ────────────────────────────────────────────────────

const TOLERANCIA_VALOR = 0.01;

const GRAVIDADE_POR_TIPO: Record<SpedInconsistenciaTipo, SpedInconsistenciaGravidade> = {
    NOTA_CANCELADA_ESCRITURADA: 'CRITICA',
    DOCUMENTO_DUPLICADO:        'CRITICA',
    SPED_SEM_XML:               'ALTA',
    XML_NAO_ESCRITURADO:        'ALTA',
    VALOR_DIVERGENTE:           'ALTA',
    ICMS_DIVERGENTE:            'ALTA',
    CFOP_DIVERGENTE:            'MEDIA',
    CST_DIVERGENTE:             'MEDIA',
    REGISTRO_INCOMPLETO:        'BAIXA',
    CHAVE_INVALIDA:             'BAIXA',
};

function aproxIguais(a: number, b: number, tol = TOLERANCIA_VALOR): boolean {
    return Math.abs(a - b) <= tol;
}

function chaveValida(chave: string | undefined): chave is string {
    return !!chave && /^\d{44}$/.test(chave);
}

function uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return (crypto as Crypto).randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function novaInconsistencia(
    tipo: SpedInconsistenciaTipo,
    descricao: string,
    extras: Partial<Pick<SpedFiscalInconsistencia, 'chave' | 'documento' | 'valorXml' | 'valorSped'>> = {},
): SpedFiscalInconsistencia {
    return {
        id: uuid(),
        tipo,
        gravidade: GRAVIDADE_POR_TIPO[tipo],
        descricao,
        status: 'ABERTA',
        ...extras,
    };
}

// ─── conferência principal ───────────────────────────────────────────────────

/**
 * Cruza a lista de XMLs (forma leve) com os C100 do SPED parseado.
 *
 * @param xmls         lista de XMLs já gravados/conhecidos pela aplicação
 * @param parseResult  resultado do parser SPED
 * @returns SpedFiscalConferenceResult com totais e inconsistências
 */
export function conferXmlContraSped(
    xmls: XmlConferenciaInput[],
    parseResult: SpedFiscalParseResult,
): SpedFiscalConferenceResult {
    const c100s = parseResult.documentosC100;
    const inconsistencias: SpedFiscalInconsistencia[] = [];

    // Mapas chave → registro, com detecção de duplicidade
    const xmlsByChave = new Map<string, XmlConferenciaInput>();
    xmls.forEach(d => {
        if (!chaveValida(d.chave)) {
            inconsistencias.push(novaInconsistencia(
                'CHAVE_INVALIDA',
                `XML com chave inválida: ${d.chave || '(vazia)'}`,
                { chave: d.chave, documento: d.numero },
            ));
            return;
        }
        if (xmlsByChave.has(d.chave)) {
            inconsistencias.push(novaInconsistencia(
                'DOCUMENTO_DUPLICADO',
                `XML duplicado para a chave ${d.chave}.`,
                { chave: d.chave, documento: d.numero },
            ));
            return;
        }
        xmlsByChave.set(d.chave, d);
    });

    const spedByChave = new Map<string, typeof c100s[number]>();
    c100s.forEach(c => {
        if (!chaveValida(c.chave)) {
            inconsistencias.push(novaInconsistencia(
                'CHAVE_INVALIDA',
                `Documento C100 com chave inválida: ${c.chave || '(vazia)'}`,
                { chave: c.chave, documento: c.numDoc },
            ));
            return;
        }
        if (spedByChave.has(c.chave)) {
            inconsistencias.push(novaInconsistencia(
                'DOCUMENTO_DUPLICADO',
                `C100 duplicado para a chave ${c.chave}.`,
                { chave: c.chave, documento: c.numDoc },
            ));
            return;
        }
        spedByChave.set(c.chave, c);
    });

    const todasChaves = new Set<string>([...xmlsByChave.keys(), ...spedByChave.keys()]);
    let documentosConferidos = 0;

    todasChaves.forEach(chave => {
        const xml = xmlsByChave.get(chave);
        const c100 = spedByChave.get(chave);

        // Caso 1: XML existe, SPED não
        if (xml && !c100) {
            inconsistencias.push(novaInconsistencia(
                'XML_NAO_ESCRITURADO',
                `XML ${xml.numero || '(s/n)'} não foi escriturado no SPED.`,
                { chave, documento: xml.numero, valorXml: xml.valorTotal },
            ));
            return;
        }

        // Caso 2: SPED existe, XML não
        if (!xml && c100) {
            inconsistencias.push(novaInconsistencia(
                'SPED_SEM_XML',
                `Documento C100 ${c100.numDoc || '(s/n)'} escriturado sem XML correspondente.`,
                { chave, documento: c100.numDoc, valorSped: c100.valorDocumento },
            ));
            return;
        }

        // Caso 3: ambos existem — comparar
        if (xml && c100) {
            const valorXml = xml.valorTotal ?? 0;
            const valorSped = c100.valorDocumento ?? 0;
            const icmsXml = xml.valorIcms ?? 0;
            const icmsSped = c100.valorIcms ?? 0;

            // Cancelado x autorizado
            if (c100.codSit && c100.codSit !== '00' && c100.codSit !== '08' && xml.status === 'autorizado') {
                inconsistencias.push(novaInconsistencia(
                    'NOTA_CANCELADA_ESCRITURADA',
                    `Documento ${xml.numero} consta no SPED com situação ${c100.codSit} mas o XML está autorizado.`,
                    { chave, documento: xml.numero, valorXml, valorSped },
                ));
            }

            // Valor total
            if (!aproxIguais(valorXml, valorSped)) {
                inconsistencias.push(novaInconsistencia(
                    'VALOR_DIVERGENTE',
                    `Valor total divergente para documento ${xml.numero}.`,
                    { chave, documento: xml.numero, valorXml, valorSped },
                ));
            }

            // ICMS
            if (!aproxIguais(icmsXml, icmsSped)) {
                inconsistencias.push(novaInconsistencia(
                    'ICMS_DIVERGENTE',
                    `Valor de ICMS divergente para documento ${xml.numero}.`,
                    { chave, documento: xml.numero, valorXml: icmsXml, valorSped: icmsSped },
                ));
            }

            documentosConferidos += 1;
        }
    });

    return {
        totalXmls: xmls.length,
        totalDocumentosSped: c100s.length,
        documentosConferidos,
        inconsistencias,
    };
}
