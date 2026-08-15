// sefaz-backend/abrasf/importer.js
// Importa NFSes parseadas (estrutura do parser-nfse) para a colecao
// `documentos_fiscais` no Firestore, seguindo o mesmo schema usado pelo
// nfse-sp-importer (compatibilidade com cruzamentos, dashboards, etc).
//
// Dedup: chave eh `${cnpjEmissor}-${numero}-${codigoVerificacao}` ou
// `${cnpjEmissor}-${numero}-${codMun}` se nao tiver codVerificacao.

import admin from 'firebase-admin';
import { createHash } from 'crypto';
import { patchSubstituiuDigitada } from '../nfse-identidade.js';

function getDb() {
    if (!admin.apps.length) admin.initializeApp();
    return admin.firestore();
}

/**
 * Gera chave determinística para dedup de NFSe ABRASF.
 * Tomado: identifica pelo prestador+numero+codMun (tomador eh o cliente do escritorio).
 * Prestado: identifica pelo prestador+numero+codMun (o proprio cliente eh prestador).
 */
function gerarChaveAbrasf(nfse, codMunIBGE) {
    const prestador = nfse.prestador?.cnpj || '';
    const num = nfse.numero || '';
    const verif = nfse.codigoVerificacao || '';
    const mun = codMunIBGE || nfse.servico?.codigoMunicipio || '';
    const base = `${prestador}|${num}|${mun}|${verif}`;
    const hash = createHash('sha256').update(base).digest('hex').slice(0, 16);
    return `abrasf-${prestador}-${num}-${hash}`;
}

/**
 * Mapeia 1 NFSe parseada -> objeto DocumentoFiscal.
 *
 * @param nfse retorno do parser-nfse
 * @param contexto.empresaId id da empresa do escritorio
 * @param contexto.empresaCnpj CNPJ da empresa do escritorio (consulente)
 * @param contexto.tipo 'tomado' | 'prestado' - define direcao
 * @param contexto.codMunIBGE codigo IBGE do municipio
 * @param contexto.codMunNome nome do municipio
 */
function mapearParaDocumentoFiscal(nfse, contexto) {
    const { empresaId, empresaCnpj, tipo, codMunIBGE, codMunNome } = contexto;
    const direcao = tipo === 'tomado' ? 'entrada' : 'saida';

    return {
        // Identificacao base
        empresaId,
        empresaCnpj,
        tipo: 'NFSe',
        modelo: 'nfse-abrasf',
        fonte: 'abrasf-adapter',

        // Chave + numero
        chave: gerarChaveAbrasf(nfse, codMunIBGE),
        numero: nfse.numero,
        serie: '',
        codigoVerificacao: nfse.codigoVerificacao,

        // Direcao + datas
        direcao,
        dhEmi: nfse.dataEmissao,
        importadoEm: admin.firestore.FieldValue.serverTimestamp(),

        // Status
        status: 'autorizada',

        // Emitente (prestador)
        emitente: {
            cnpjCpf: nfse.prestador.cnpj || '',
            nome: nfse.prestador.nome || '',
            ie: '',
            inscricaoMunicipal: nfse.prestador.inscricaoMunicipal || '',
            municipio: codMunNome || '',
            codMunIBGE,
        },

        // Destinatario (tomador)
        destinatario: {
            cnpjCpf: nfse.tomador.cnpj || '',
            nome: nfse.tomador.nome || '',
            inscricaoMunicipal: nfse.tomador.inscricaoMunicipal || '',
            municipio: codMunNome || '',
            codMunIBGE,
        },

        // Item unico (NFSe nao tem multiplos itens como NFe)
        itens: [{
            nItem: '1',
            xProd: nfse.servico.discriminacao || 'Servico',
            cfop: '',  // NFSe nao usa CFOP
            cst: '',
            ncm: '',
            uCom: 'UN',
            qCom: 1,
            vUnCom: nfse.servico.valorServicos,
            vProd: nfse.servico.valorServicos,
            // Impostos NFSe
            aliquotaIss: nfse.servico.aliquota,
            vISS: nfse.servico.valorIss,
            vBC: nfse.servico.baseCalculo,
            issRetido: nfse.servico.issRetido,
            itemListaServico: nfse.servico.itemListaServico,
            codigoTributacaoMunicipio: nfse.servico.codigoTributacaoMunicipio,
            // Retencoes
            vPIS: nfse.servico.valorPis,
            vCOFINS: nfse.servico.valorCofins,
            vINSS: nfse.servico.valorInss,
            vIR: nfse.servico.valorIr,
            vCSLL: nfse.servico.valorCsll,
        }],

        // Totais
        totais: {
            vProd: nfse.servico.valorServicos,
            vNF: nfse.servico.valorLiquidoNfse || nfse.servico.valorServicos,
            vBC: nfse.servico.baseCalculo,
            vISS: nfse.servico.valorIss,
            vISSRetido: nfse.servico.valorIssRetido,
            vPIS: nfse.servico.valorPis,
            vCOFINS: nfse.servico.valorCofins,
            vINSS: nfse.servico.valorInss,
            vIR: nfse.servico.valorIr,
            vCSLL: nfse.servico.valorCsll,
        },

        infAdic: nfse.servico.discriminacao,
        createdBy: 'system:abrasf-adapter',
    };
}

/**
 * Importa uma lista de NFSes parseadas para o Firestore.
 * Dedup-safe: se a chave ja existe, atualiza (merge) em vez de duplicar.
 *
 * @returns { criadas, atualizadas, falhas }
 */
export async function importarNfsesAbrasf(nfses, contexto) {
    const db = getDb();
    const col = db.collection('documentos_fiscais');
    let criadas = 0;
    let atualizadas = 0;
    let falhas = 0;

    for (const nfse of nfses) {
        try {
            const doc = mapearParaDocumentoFiscal(nfse, contexto);
            const ref = col.doc(doc.chave);
            const snap = await ref.get();
            if (snap.exists) {
                // Merge: preserva campos do dono original (cron capturou, depois
                // user editou tag, etc) e atualiza so o que mudou — MENOS o
                // carimbo de digitada, que o documento de verdade nao herda.
                await ref.set({ ...doc, ...patchSubstituiuDigitada(snap.data()) }, { merge: true });
                atualizadas++;
            } else {
                await ref.set(doc);
                criadas++;
            }
        } catch (e) {
            console.error('[abrasf-importer] falha em NFSe', nfse.numero, ':', e.message);
            falhas++;
        }
    }

    return { total: nfses.length, criadas, atualizadas, falhas };
}

// Export interno pra teste
export { mapearParaDocumentoFiscal, gerarChaveAbrasf };
