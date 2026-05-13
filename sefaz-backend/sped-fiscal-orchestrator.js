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
import {
    buildBlocoB,
    buildBlocoG, buildBlocoH, buildBlocoK, buildBloco1,
} from './sped-fiscal-blocos-vazios.js';
import { buildBlocoD } from './sped-fiscal-blocoD.js';
import { buildBlocoE } from './sped-fiscal-blocoE.js';
import { enrichParticipantesViaBrasilApi } from './brasilapi-cache.js';

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

        if (!participanteRaw) continue;
        const cnpjBruto = participanteRaw.cnpjCpf || participanteRaw.cnpj || participanteRaw.CNPJ || '';
        if (!cnpjBruto) continue;

        const docLimpo = String(cnpjBruto).replace(/\D/g, '');
        if (!docLimpo) continue;
        if (participantesMap.has(docLimpo)) continue;

        // Detecta PF (CPF 11 digitos) vs PJ (CNPJ 14 digitos) pelo tamanho.
        // Documentos com outros tamanhos sao invalidos — loga e pula.
        let cnpjFinal = '';
        let cpfFinal = '';
        if (docLimpo.length === 14) {
            cnpjFinal = docLimpo;
        } else if (docLimpo.length === 11) {
            cpfFinal = docLimpo;
        } else {
            console.warn(`[sped-fiscal] participante com documento invalido (${docLimpo.length} digitos): ${docLimpo} — pulado`);
            continue;
        }

        // codPart = documento limpo (suficiente como identificador unico)
        participantesMap.set(docLimpo, {
            codPart: docLimpo,
            nome: participanteRaw.nome || participanteRaw.razaoSocial || participanteRaw.xNome || 'SEM NOME',
            cnpj: cnpjFinal,
            cpf: cpfFinal,
            ie: participanteRaw.ie || participanteRaw.inscricaoEstadual || '',
            codMunIBGE: participanteRaw.codMunIBGE || '',
            logradouro: participanteRaw.logradouro || participanteRaw.endereco || '',
            numero: participanteRaw.numero || '',
            complemento: participanteRaw.complemento || '',
            bairro: participanteRaw.bairro || '',
        });
    }
    const participantes = Array.from(participantesMap.values());

    // ─── 4b. Enriquece participantes legados via BrasilAPI ───
    // Notas processadas pelo parser antigo nao tem codMunIBGE/endereco.
    // BrasilAPI preenche por CNPJ. Parser novo ja extrai do XML.
    try {
        const stats = await enrichParticipantesViaBrasilApi(participantes);
        console.log(`[sped-fiscal] BrasilAPI enrich: ${JSON.stringify(stats)}`);
    } catch (err) {
        console.warn(`[sped-fiscal] BrasilAPI falhou: ${err.message}`);
    }

    // ─── 5. Extrai itens unicos (produtos/servicos) e unidades ───
    // Importante: itens de notas de saida propria (IND_EMIT=0) NAO geram
    // C170 — entao nao podem aparecer no 0200 (PVA reclama de item orfao).
    const itensMap = new Map();
    const unidadesMap = new Map();
    for (const nota of notas) {
        if (nota.direcao === 'saida') continue;  // itens de saida propria nao geram C170 nem 0200
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

    // 0190 deve listar APENAS unidades efetivamente referenciadas em algum
    // 0200 ou C170. Forcar 'UN' quando ninguem usa gera erro no PVA:
    // "Codigo invalido. Informar codigo da unidade de medida (UNID) se
    //  referenciado em pelo menos um dos blocos ou no Registro 0200 ou 0220."

    // ─── 6. Warnings ───
    const warnings = [];
    if (notas.length === 0) {
        warnings.push(`Empresa "${empresa.nome}" nao tem documentos fiscais no periodo. Arquivo sera gerado com estrutura minima (apenas registros 0000-0100 + Bloco 9).`);
    }

    // ─── 7. Saldo credor ICMS do mes anterior (so pra Lucro) ───
    // Leitura da ficha mensal anterior em lucro_fichas.
    let saldoCredorIcmsAnterior = 0;
    if (regime === 'lucro') {
        try {
            const competenciaAnterior = computarCompetenciaAnterior(periodoInicio);
            const fichaSnap = await db.collection('lucro_fichas')
                .where('empresaId', '==', empresaId)
                .where('competencia', '==', competenciaAnterior)
                .limit(1)
                .get();
            if (!fichaSnap.empty) {
                const ficha = fichaSnap.docs[0].data();
                saldoCredorIcmsAnterior = parseFloat(ficha.saldoCredorIcms || 0);
            }
        } catch (err) {
            console.warn(`[sped-fiscal] saldoCredorIcmsAnterior falhou: ${err.message}`);
        }
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
        saldoCredorIcmsAnterior,
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
    const linhasBlocoB = buildBlocoB();   // vazio
    const linhasBlocoC = buildBlocoC(dados);
    const linhasBlocoD = buildBlocoD(dados);  // CTe modelo 57
    const linhasBlocoE = buildBlocoE(dados);  // E001+E100+E110 zerada+E990
    const linhasBlocoG = buildBlocoG();   // vazio
    const linhasBlocoH = buildBlocoH();   // vazio
    const linhasBlocoK = buildBlocoK();   // vazio
    const linhasBloco1 = buildBloco1();   // vazio

    // Bloco 9 precisa contar registros de TODOS os blocos anteriores.
    // Ordem oficial: 0 -> B -> C -> D -> E -> G -> H -> K -> 1 -> 9
    const linhasAteAqui = [
        ...linhasBloco0,
        ...linhasBlocoB,
        ...linhasBlocoC,
        ...linhasBlocoD,
        ...linhasBlocoE,
        ...linhasBlocoG,
        ...linhasBlocoH,
        ...linhasBlocoK,
        ...linhasBloco1,
    ];
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


/**
 * Computa competencia YYYY-MM do mes anterior.
 * Ex: '2026-01' -> '2025-12'. Ex: '2026-04' -> '2026-03'.
 */
function computarCompetenciaAnterior(competenciaYYYYMM) {
    const m = (competenciaYYYYMM || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    let ano = parseInt(m[1], 10);
    let mes = parseInt(m[2], 10);
    mes -= 1;
    if (mes === 0) { mes = 12; ano -= 1; }
    return `${ano}-${String(mes).padStart(2, '0')}`;
}

function getContadorPadrao() {
    // Dados reais SP Assessoria Contabil. Futuramente pode virar cadastro
    // editavel pelo admin no app, mas hoje eh fixo no codigo.
    return {
        nome: 'PAULO CESAR PEREIRA JUNIOR',
        cpf: '26819016859',
        crc: '1SP238285/O-5',
        cnpj: '44388152000189',
        cep: '01042001',
        logradouro: 'RUA BARAO DE ITAPETININGA',
        numero: '221',
        complemento: '3 ANDAR',
        bairro: 'REPUBLICA',
        telefone: '31551554',
        email: 'spcontabil@spassessoriacontabil.com.br',
        codMunIBGE: '3550308',
    };
}
