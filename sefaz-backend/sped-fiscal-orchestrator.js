// ============================================================================
// sefaz-backend/sped-fiscal-orchestrator.js
//
// Coleta dados do Firestore + monta os blocos do SPED Fiscal.
//
// Fase 1 implementada: Bloco 0 + Bloco 9.
// ============================================================================

import admin from 'firebase-admin';
import { buildBloco0 } from './sped-fiscal-bloco0.js';
import { buildBlocoC } from './sped-fiscal-blocoC.js';
import { buildBloco9 } from './sped-fiscal-bloco9.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Coleta os dados necessarios pra montar o SPED Fiscal de uma empresa
 * num determinado periodo.
 *
 * @param {object} args
 * @param {string} args.empresaId
 * @param {string} [args.competencia]       'YYYY-MM' (modo mensal)
 * @param {string} [args.competenciaInicio] 'YYYY-MM' (modo trimestre)
 * @param {string} [args.competenciaFim]    'YYYY-MM' (modo trimestre)
 *
 * @returns {Promise<{
 *   empresa: object,
 *   contador: object,
 *   competenciaInicio: string,
 *   competenciaFim: string,
 *   notas: object[],
 *   itens: object[],
 *   participantes: object[],
 *   unidades: object[],
 *   warnings: string[],
 * }>}
 */
export async function coletarDadosEmpresa({ empresaId, competencia, competenciaInicio, competenciaFim }) {
    const db = fa().firestore();

    // ─── 1. Le empresa (tenta simples_empresas, depois lucro_empresas) ───
    let empresaSnap = await db.collection('simples_empresas').doc(empresaId).get();
    let regime = 'simples';
    if (!empresaSnap.exists) {
        empresaSnap = await db.collection('lucro_empresas').doc(empresaId).get();
        regime = 'lucro';
    }
    if (!empresaSnap.exists) {
        const err = new Error(`Empresa ${empresaId} nao encontrada em simples_empresas nem lucro_empresas.`);
        err.code = 'EMPRESA_NAO_ENCONTRADA';
        throw err;
    }
    const empresa = { id: empresaId, ...empresaSnap.data(), _regime: regime };

    // Validacao critica: precisa ter dadosFiscais
    if (!empresa.dadosFiscais || !empresa.dadosFiscais.uf || !empresa.dadosFiscais.codMunIBGE) {
        const err = new Error(
            `Empresa "${empresa.nome}" nao tem dadosFiscais cadastrados (UF e codMunIBGE sao obrigatorios). ` +
            `Clique no botao "Dados Fiscais" no header da empresa pra preencher.`
        );
        err.code = 'DADOS_FISCAIS_INCOMPLETOS';
        throw err;
    }

    // ─── 2. Define o range de competencia ───
    const periodoInicio = competenciaInicio || competencia;
    const periodoFim = competenciaFim || competencia;

    // ─── 3. Le documentos_fiscais filtrados por empresaId + competencia ───
    let notasQuery = db.collection('documentos_fiscais')
        .where('empresaId', '==', empresaId);

    // Quando eh mes unico, da pra usar where exato. Quando eh range, le
    // todos do empresa e filtra em memoria (Firestore nao aceita range +
    // outras condicoes facilmente).
    let notas;
    if (periodoInicio === periodoFim) {
        notasQuery = notasQuery.where('competencia', '==', periodoInicio);
        const snap = await notasQuery.get();
        notas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
        const snap = await notasQuery.get();
        notas = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(n => n.competencia >= periodoInicio && n.competencia <= periodoFim);
    }

    // ─── 4. Extrai participantes unicos (entrada + saida) ───
    const participantesMap = new Map();
    for (const nota of notas) {
        // Identifica o "outro lado" da nota (nao a empresa).
        const direcao = nota.direcao;  // 'entrada' | 'saida'
        const participanteRaw = direcao === 'saida'
            ? (nota.destinatario || nota.tomador)
            : (nota.emitente || nota.prestador);

        if (!participanteRaw || !participanteRaw.cnpj) continue;

        const cnpjLimpo = String(participanteRaw.cnpj).replace(/\D/g, '');
        if (participantesMap.has(cnpjLimpo)) continue;

        // codPart = primeiros 14 digitos do CNPJ (suficiente como identificador unico)
        participantesMap.set(cnpjLimpo, {
            codPart: cnpjLimpo,
            nome: participanteRaw.nome || participanteRaw.razaoSocial || 'SEM NOME',
            cnpj: cnpjLimpo,
            ie: participanteRaw.ie || participanteRaw.inscricaoEstadual || '',
            codMunIBGE: participanteRaw.codMunIBGE || '',
            logradouro: participanteRaw.logradouro || participanteRaw.endereco || '',
            numero: participanteRaw.numero || '',
            complemento: participanteRaw.complemento || '',
            bairro: participanteRaw.bairro || '',
        });
    }
    const participantes = Array.from(participantesMap.values());

    // ─── 5. Extrai itens unicos (produtos/servicos) e unidades ───
    const itensMap = new Map();
    const unidadesMap = new Map();
    for (const nota of notas) {
        for (const item of (nota.itens || [])) {
            const codItem = item.cProd || item.codigo || item.cFiscal || `ITEM-${item.nItem || '?'}`;
            if (!itensMap.has(codItem)) {
                itensMap.set(codItem, {
                    codItem,
                    descricao: item.xProd || item.descricao || codItem,
                    codBarra: item.cEAN && item.cEAN !== 'SEM GTIN' ? item.cEAN : '',
                    unidade: (item.uCom || item.unidade || 'UN').toUpperCase().substring(0, 6),
                    tipo: '00',  // Default: 00 = Mercadoria pra Revenda
                    ncm: item.NCM || item.ncm || '',
                    codGen: '',
                    codLst: '',
                    aliqIcms: '',
                    cest: item.CEST || item.cest || '',
                });
            }
            const unidade = (item.uCom || item.unidade || 'UN').toUpperCase().substring(0, 6);
            if (!unidadesMap.has(unidade)) {
                unidadesMap.set(unidade, {
                    codigo: unidade,
                    descricao: descreverUnidade(unidade),
                });
            }
        }
    }
    const itens = Array.from(itensMap.values());
    const unidades = Array.from(unidadesMap.values());

    // Garante que UN seja sempre incluido (regra prudente do Guia Pratico)
    if (!unidadesMap.has('UN')) {
        unidades.unshift({ codigo: 'UN', descricao: 'UNIDADE' });
    }

    // ─── 6. Warnings ───
    const warnings = [];
    if (notas.length === 0) {
        warnings.push(`Empresa "${empresa.nome}" nao tem documentos fiscais no periodo. Arquivo sera gerado com estrutura minima (apenas registros 0000-0100 + Bloco 9).`);
    }

    return {
        empresa,
        contador: getContadorPadrao(),
        competenciaInicio: periodoInicio,
        competenciaFim: periodoFim,
        notas,
        itens,
        participantes,
        unidades,
        warnings,
    };
}

/**
 * Monta o arquivo .txt completo do SPED Fiscal a partir dos dados coletados.
 *
 * Fase 1: Bloco 0 + Bloco 9.
 *
 * @returns {Promise<string>} arquivo .txt em encoding Windows-1252.
 */
export async function montarBlocos({ dados }) {
    const linhasBloco0 = buildBloco0(dados);
    const linhasBlocoC = buildBlocoC(dados);

    // Bloco 9 precisa contar registros de TODOS os blocos anteriores
    const linhasAteAqui = [...linhasBloco0, ...linhasBlocoC];
    const linhasBloco9 = buildBloco9(linhasAteAqui);

    const todas = [...linhasAteAqui, ...linhasBloco9];
    return todas.join('');
}

// ─── Helpers ────────────────────────────────────────────────────────────

const UNIDADES_PADRAO = {
    'UN': 'UNIDADE',
    'KG': 'QUILOGRAMA',
    'L': 'LITRO',
    'LT': 'LITRO',
    'M': 'METRO',
    'M2': 'METRO QUADRADO',
    'M3': 'METRO CUBICO',
    'CX': 'CAIXA',
    'PC': 'PECA',
    'PCT': 'PACOTE',
    'PAR': 'PAR',
    'DZ': 'DUZIA',
    'TON': 'TONELADA',
    'G': 'GRAMA',
    'ML': 'MILILITRO',
    'CM': 'CENTIMETRO',
};

function descreverUnidade(codigo) {
    return UNIDADES_PADRAO[codigo.toUpperCase()] || codigo.toUpperCase();
}

function getContadorPadrao() {
    // Placeholder. No futuro pode ser parametro do admin no app.
    return {
        nome: 'CONTADOR SP CONTABIL',
        cpf: '',
        crc: '1SP123456/O-7',
        cnpj: '',
        cep: '',
        logradouro: '',
        numero: '',
        complemento: '',
        bairro: '',
        telefone: '',
        email: '',
        codMunIBGE: '',
    };
}
