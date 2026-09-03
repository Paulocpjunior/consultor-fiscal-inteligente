/**
 * Importer NFS-e prefeitura de São Paulo capital.
 *
 * Recebe a string XML de uma <NFe>...</NFe> retornada pelo ConsultaNFeRecebidas,
 * parseia os campos relevantes e persiste no Firestore na coleção
 * `documentos_fiscais`, alinhado ao schema do frontend.
 *
 * Idempotência: ID composto determinístico
 *   nfsesp-{cnpjTomador14}-{cnpjPrestador14}-{numero}
 */

import { DOMParser } from '@xmldom/xmldom';
import { validarXmlSeguro } from './xml-seguranca.js';
import { idDocumentoNfseSp, patchSubstituiuDigitada } from './nfse-identidade.js';
// 🚨 A competência da NFS-e de SP é a INCIDÊNCIA (fato gerador), não a emissão.
import { competenciaDaNfse } from './competencia-da-nfse.js';

const text = (parent, tag) => parent.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
const num = (parent, tag) => {
    const v = text(parent, tag);
    return v ? Number(v) : null;
};

export function parseNfseSpXml(xmlString) {
    validarXmlSeguro(xmlString);
    const doc = new DOMParser({
        errorHandler: { warning: () => {}, error: () => {}, fatalError: (e) => { throw e; } },
    }).parseFromString(xmlString, 'text/xml');

    const nfeNode = doc.getElementsByTagName('NFe')[0];
    if (!nfeNode) throw new Error('NFS-e SP importer: nó <NFe> não encontrado no XML');

    const chaveNode = nfeNode.getElementsByTagName('ChaveNFe')[0];
    if (!chaveNode) throw new Error('NFS-e SP importer: <ChaveNFe> ausente');

    const inscricaoPrestador = text(chaveNode, 'InscricaoPrestador');
    const numero = text(chaveNode, 'Numero');
    const codigoVerificacao = text(chaveNode, 'CodigoVerificacao');

    if (!inscricaoPrestador || !numero) {
        throw new Error('NFS-e SP importer: ChaveNFe incompleta (InscricaoPrestador ou Numero ausente)');
    }

    const prestadorNode = nfeNode.getElementsByTagName('CPFCNPJPrestador')[0];
    const tomadorNode = nfeNode.getElementsByTagName('CPFCNPJTomador')[0];
    const cnpjPrestador = prestadorNode ? text(prestadorNode, 'CNPJ') || text(prestadorNode, 'CPF') : '';
    const cnpjTomador = tomadorNode ? text(tomadorNode, 'CNPJ') || text(tomadorNode, 'CPF') : '';

    const dhEmi = text(nfeNode, 'DataEmissaoNFe');
    // ⚠️ O CRU viaja separado: `dataFatoGerador` já cai no `dhEmi` quando o
    // campo não vem, e passar o valor JÁ com fallback faria a origem afirmar
    // "fato-gerador" sobre uma data de emissão — presença ≠ preenchido (a régua
    // do `csllOuTotalPresente`, 02/09).
    const fatoGeradorCru = text(nfeNode, 'DataFatoGeradorNFe');
    const dataFatoGerador = fatoGeradorCru || dhEmi;
    const statusBruto = text(nfeNode, 'StatusNFe');
    const cancelado = statusBruto === 'C';

    // 🚨 A COMPETÊNCIA É A INCIDÊNCIA (o FATO GERADOR), NÃO A EMISSÃO (03/09).
    // Este recorte saía do `dhEmi` com o `DataFatoGeradorNFe` lido na linha de
    // cima e jogado fora — e em SP a nota de 31/08 pode ser emitida até 10/09
    // (05/09 com retenção): ela caía em setembro e saía de TODO recorte de
    // agosto, sem erro nenhum na tela. Régua no dono, lida também pelo trilho
    // do CSV — duas leituras do mês fariam os dois trilhos discordarem.
    const incidencia = competenciaDaNfse({ dataFatoGerador: fatoGeradorCru, dataEmissao: dhEmi });
    const competencia = incidencia.competencia || '';

    return {
        chave: `${inscricaoPrestador}-${numero}-${codigoVerificacao || 'sn'}`,
        inscricaoPrestador,
        numero,
        codigoVerificacao,

        cnpjPrestador,
        razaoSocialPrestador: text(nfeNode, 'RazaoSocialPrestador'),
        emailPrestador: text(nfeNode, 'EmailPrestador'),

        cnpjTomador,
        razaoSocialTomador: text(nfeNode, 'RazaoSocialTomador'),
        emailTomador: text(nfeNode, 'EmailTomador'),
        inscricaoMunicipalTomador: text(nfeNode, 'InscricaoMunicipalTomador'),

        dhEmi,
        dataFatoGerador,
        competencia,
        // A ORIGEM viaja: número derivado não se apresenta como lido, e é ela que
        // explica a nota aparecer num mês diferente do da emissão.
        competenciaOrigem: incidencia.origem,
        competenciaDivergeDaEmissao: incidencia.diverge,
        cancelado,
        dataCancelamento: text(nfeNode, 'DataCancelamento'),

        valorServicos: num(nfeNode, 'ValorServicos'),
        valorIss: num(nfeNode, 'ValorISS'),
        valorPis: num(nfeNode, 'ValorPIS'),
        valorCofins: num(nfeNode, 'ValorCOFINS'),
        valorInss: num(nfeNode, 'ValorINSS'),
        valorIr: num(nfeNode, 'ValorIR'),
        valorCsll: num(nfeNode, 'ValorCSLL'),
        valorDeducoes: num(nfeNode, 'ValorDeducoes'),
        valorCredito: num(nfeNode, 'ValorCredito'),

        aliquotaServicos: num(nfeNode, 'AliquotaServicos'),
        codigoServico: text(nfeNode, 'CodigoServico'),
        issRetido: text(nfeNode, 'ISSRetido') === 'true',
        municipioPrestacao: text(nfeNode, 'MunicipioPrestacao'),
        discriminacao: text(nfeNode, 'Discriminacao'),

        xmlOriginal: xmlString,
    };
}

export async function salvarNfseSpRecebida(db, nfeXmlString, empresaCtx) {
    if (!db) throw new Error('NFS-e SP importer: db (Firestore) é obrigatório');
    if (!nfeXmlString) throw new Error('NFS-e SP importer: nfeXmlString é obrigatório');

    const parsed = parseNfseSpXml(nfeXmlString);

    const cnpjT = (empresaCtx?.cnpjTomadorEsperado || parsed.cnpjTomador || '').replace(/\D/g, '');
    const cnpjP = (parsed.cnpjPrestador || '').replace(/\D/g, '');

    if (cnpjT && parsed.cnpjTomador && cnpjT !== parsed.cnpjTomador.replace(/\D/g, '')) {
        console.warn(
            `[nfse-sp-importer] WARN cnpjTomador da NF (${parsed.cnpjTomador}) != esperado (${cnpjT}) — gravando mesmo assim com flag.`
        );
    }

    const docId = idDocumentoNfseSp({ prestadorCnpj: cnpjP, tomadorCnpj: cnpjT, numero: parsed.numero });

    const ref = db.collection('documentos_fiscais').doc(docId);
    const snap = await ref.get();
    const existia = snap.exists;

    const docData = {
        id: docId,
        chave: parsed.chave,
        tipo: 'NFSe',
        tipoDoc: 'NFSe',
        modelo: '99',
        numero: parsed.numero,
        serie: '1',
        codigoVerificacao: parsed.codigoVerificacao,
        natOp: parsed.codigoServico ? `Cód. serviço ${parsed.codigoServico}` : 'Serviço NFS-e',

        dhEmi: parsed.dhEmi,
        dataFatoGerador: parsed.dataFatoGerador,
        competencia: parsed.competencia,
        competenciaOrigem: parsed.competenciaOrigem,
        competenciaDivergeDaEmissao: parsed.competenciaDivergeDaEmissao,

        direcao: 'entrada',
        status: parsed.cancelado ? 'cancelado' : 'autorizado',
        canceladoEm: parsed.dataCancelamento || null,

        empresaId: empresaCtx?.empresaId || null,
        empresaCnpj: cnpjT,
        empresaNome: parsed.razaoSocialTomador || empresaCtx?.empresaNome || '',

        prestadorCnpj: cnpjP,
        prestadorNome: parsed.razaoSocialPrestador,
        prestadorEmail: parsed.emailPrestador,

        valorTotal: parsed.valorServicos ?? 0,
        valorServicos: parsed.valorServicos,
        valorIss: parsed.valorIss,
        valorPis: parsed.valorPis,
        valorCofins: parsed.valorCofins,
        valorInss: parsed.valorInss,
        valorIr: parsed.valorIr,
        valorCsll: parsed.valorCsll,
        valorDeducoes: parsed.valorDeducoes,
        valorCredito: parsed.valorCredito,

        aliquotaServicos: parsed.aliquotaServicos,
        codigoServico: parsed.codigoServico,
        issRetido: parsed.issRetido,
        municipioPrestacao: parsed.municipioPrestacao,
        discriminacao: parsed.discriminacao,

        xml: parsed.xmlOriginal,
        schema: 'NFSeSP_v1',
        origem: 'sefaz',
        capturadoVia: 'nfse-sp-recebidas',

        atualizadoEm: new Date().toISOString(),
    };

    if (!existia) {
        docData.createdAt = new Date().toISOString();
        docData.importadoEm = new Date().toISOString();
        docData.importadoPor = empresaCtx?.importadoPor || 'sistema-nfse-sp-cron';
    }

    for (const k of Object.keys(docData)) {
        if (docData[k] === undefined) delete docData[k];
    }

    // Idem CSV: doc real nao herda o carimbo de digitada.
    await ref.set({ ...docData, ...patchSubstituiuDigitada(snap.data()) }, { merge: true });

    return {
        id: docId,
        criado: !existia,
        atualizado: existia,
        parsed,
    };
}
