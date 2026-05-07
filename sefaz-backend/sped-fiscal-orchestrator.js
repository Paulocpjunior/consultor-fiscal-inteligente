// ============================================================================
// sefaz-backend/sped-fiscal-orchestrator.js  (ESM)
//
// Coleta dados do Firestore + monta os blocos do SPED Fiscal.
//
// Status atual: ESQUELETO — funcoes stub que jogam FASE1_PENDENTE.
// Logica fiscal sera implementada na proxima sessao.
//
// Estrutura da Fase 1:
//   coletarDadosEmpresa() → le simples_empresas / lucro_empresas + documentos_fiscais
//                          → retorna { empresa, notas, itens, participantes, warnings }
//   montarBlocos()         → monta blocos 0 e 9 + concatena → retorna string .txt
// ============================================================================

import admin from 'firebase-admin';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Coleta os dados necessarios pra montar o SPED Fiscal de uma empresa
 * num determinado periodo (mes ou range de meses).
 *
 * @param {object} args
 * @param {string} args.empresaId    - id da empresa em simples_empresas/lucro_empresas
 * @param {string} [args.competencia] - 'YYYY-MM' (modo mensal)
 * @param {string} [args.competenciaInicio] - 'YYYY-MM' (modo trimestre)
 * @param {string} [args.competenciaFim]    - 'YYYY-MM' (modo trimestre)
 *
 * @returns {Promise<{
 *   empresa: object,
 *   notas: object[],
 *   itens: object[],
 *   participantes: object[],
 *   warnings: string[],
 * }>}
 */
export async function coletarDadosEmpresa({ empresaId, competencia, competenciaInicio, competenciaFim }) {
    // STUB — implementar na Fase 1.
    const err = new Error('coletarDadosEmpresa: Fase 1 pendente');
    err.code = 'FASE1_PENDENTE';
    throw err;

    // Esboco do que vai ser implementado:
    //
    // 1. Le empresa (tenta simples_empresas, depois lucro_empresas)
    // 2. Le documentos_fiscais filtrados por empresaId + competencia
    // 3. Extrai itens unicos (cProd) e participantes unicos (CNPJ destinatario/emitente)
    // 4. Retorna estrutura normalizada pros builders dos blocos.
    //
    // const db = fa().firestore();
    // const empresaSnap = await ...
    // const notasSnap = await db.collection('documentos_fiscais')
    //                            .where('empresaId', '==', empresaId)
    //                            .where('competencia', '==', competencia)
    //                            .get();
    // ...
}

/**
 * Monta o arquivo .txt completo do SPED Fiscal a partir dos dados coletados.
 *
 * Fase 1: Bloco 0 (registros 0000, 0001, 0005, 0100, 0150, 0190, 0200, 0990)
 *         + Bloco 9 (registros 9001, 9900, 9990, 9999).
 * Fase 2: + Bloco C (mercadorias).
 * Fase 3: + Bloco E (apuracao ICMS/IPI).
 *
 * @returns {Promise<string>} — arquivo .txt em encoding Windows-1252.
 */
export async function montarBlocos({ dados, dadosContador }) {
    // STUB — implementar na Fase 1.
    const err = new Error('montarBlocos: Fase 1 pendente');
    err.code = 'FASE1_PENDENTE';
    throw err;

    // Esboco:
    //
    // const linhas = [];
    // linhas.push(...buildBloco0(dados, dadosContador));
    // linhas.push(...buildBloco9(linhas));
    // return linhas.join('\r\n') + '\r\n';
}
