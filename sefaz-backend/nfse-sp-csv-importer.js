// ============================================================================
// sefaz-backend/nfse-sp-csv-importer.js
// Salva notas parseadas do CSV (exportado pelo portal SP) no Firestore.
//
// Schema compatível com o que NFSe SP WS salvaria (mesma collection
// `documentos_fiscais`, mesmo formato de docId, mesmos campos básicos)
// pra UI/relatórios funcionarem indistintamente.
// ============================================================================

import admin from 'firebase-admin';
import { idDocumentoNfseSp, patchSubstituiuDigitada } from './nfse-identidade.js';
// 🚨 A competência da NFS-e de SP é a INCIDÊNCIA (fato gerador), não a emissão
// — mesmo dono do trilho do WS/XML: duas leituras do mês fariam os dois
// trilhos gravarem a MESMA nota em competências diferentes.
import { competenciaDaNfse } from './competencia-da-nfse.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Salva uma nota parseada (do parseCsvNfseSp) no Firestore.
 * Idempotente: usa docId determinístico, sobrescreve metadados.
 *
 * @param {object} nota — output do parseCsvNfseSp().notas[i]
 * @param {object} ctx — { empresaId, empresaCnpj, empresaNome, importadoPor, direcao }
 *                       direcao = 'entrada' (recebida) | 'saida' (emitida)
 */
export async function salvarNotaCsv(nota, ctx = {}) {
    const db = fa().firestore();
    const cnpjP = (nota.cnpjPrestador || '').replace(/\D/g, '');
    const cnpjT = (nota.cnpjTomador || '').replace(/\D/g, '');
    const numero = String(nota.numero || '').trim();
    if (!numero) throw new Error('Nota sem número');

    const docId = idDocumentoNfseSp({ prestadorCnpj: cnpjP, tomadorCnpj: cnpjT, numero });
    const ref = db.collection('documentos_fiscais').doc(docId);
    const snap = await ref.get();
    const existia = snap.exists;

    // Direção REAL baseada nos CNPJs da nota (não no parâmetro de download).
    // Resolve casos em que o portal SP devolve a mesma nota em "Recebidas" e
    // "Emitidas" — o docId fica idêntico e o último save sobrescreveria a
    // direção. Aqui forçamos: se empresa do contexto é prestador, é saída;
    // se é tomador, é entrada. Ignora ctx.direcao se inferível pelos dados.
    let direcao = null;
    const ctxCnpj = (ctx.empresaCnpj || '').replace(/\D/g, '');
    if (ctxCnpj && ctxCnpj === cnpjP) direcao = 'saida';
    else if (ctxCnpj && ctxCnpj === cnpjT) direcao = 'entrada';
    else direcao = ctx.direcao || 'entrada';

    // A que MÊS a nota pertence — pelo DONO. Em SP a nota de 31/08 pode ser
    // emitida até 10/09 (05/09 com retenção), e quem recorta é a INCIDÊNCIA.
    const incidencia = competenciaDaNfse({
        dataFatoGerador: nota.dataFatoGerador, dataEmissao: nota.dataHoraEmissao,
    });

    const empresaCnpjFinal = direcao === 'saida' ? cnpjP : cnpjT;
    const empresaNomeFinal = direcao === 'saida'
        ? nota.razaoSocialPrestador
        : nota.razaoSocialTomador;

    const docData = {
        id: docId,
        chave: null, // CSV SP não traz chave NFSe — só código de verificação
        tipo: 'NFSe',
        tipoDoc: 'NFSe',
        fonte: 'csv-portal-sp',
        layout: 'V.006',
        modelo: '99',
        numero,
        serie: '1',
        codigoVerificacao: nota.codigoVerificacao,
        natOp: nota.codigoServico ? `Cód. serviço ${nota.codigoServico}` : 'Serviço NFS-e',

        dhEmi: nota.dataHoraEmissao,
        dataFatoGerador: nota.dataFatoGerador,
        // 🚨 Era `dataHoraEmissao.slice(0, 7)` com o `dataFatoGerador` (coluna 8
        // do layout do portal) parseado e ignorado: a nota de 31/08 emitida em
        // setembro caía em 09/2026 e saía de TODO recorte de agosto, sem erro
        // nenhum na tela. É o campo que RECORTA O MÊS lido da data errada.
        competencia: incidencia.competencia,
        competenciaOrigem: incidencia.origem,
        competenciaDivergeDaEmissao: incidencia.diverge,

        direcao,
        status: nota.situacao === 'cancelada' ? 'cancelado' : 'autorizado',
        situacao: nota.situacao,
        situacaoBruta: nota.situacaoBruta,
        canceladoEm: nota.dataCancelamento,

        // Empresa do contexto
        empresaId: ctx.empresaId || null,
        empresaCnpj: empresaCnpjFinal,
        empresaNome: empresaNomeFinal || ctx.empresaNome || '',

        // Prestador completo
        prestadorCnpj: cnpjP,
        prestadorNome: nota.razaoSocialPrestador,
        prestadorEmail: nota.emailPrestador,
        prestadorEndereco: nota.enderecoPrestador,
        prestadorCcm: nota.ccmPrestador,
        prestadorOptanteSimples: nota.optanteSimples,

        // Tomador completo
        tomadorCnpj: cnpjT,
        tomadorNome: nota.razaoSocialTomador,
        tomadorEmail: nota.emailTomador,
        tomadorEndereco: nota.enderecoTomador,
        tomadorInscricaoMunicipal: nota.inscricaoMunicipalTomador,
        tomadorInscricaoEstadual: nota.inscricaoEstadualTomador,

        // Compat com schema NFe (campos esperados pelo dashboard)
        cnpjEmit: cnpjP,
        xNomeEmit: nota.razaoSocialPrestador,
        cnpjDest: cnpjT,
        xNomeDest: nota.razaoSocialTomador,

        // Valores
        valorTotal: nota.valorServicos,
        valorServicos: nota.valorServicos,
        valorDeducoes: nota.valorDeducoes,
        valorCredito: nota.valorCredito,
        valorIss: nota.issDevido,
        issDevido: nota.issDevido,
        issPago: nota.issPago,
        issAPagar: nota.issAPagar,
        issRetido: nota.issRetido === 'S',

        // Retenções
        valorPis: nota.pisRetido,
        valorCofins: nota.cofinsRetida,
        valorInss: nota.contribPrevidenciariaRetida,
        valorIr: nota.irRetido,
        valorCsll: nota.contribSociaisRetidas,

        // Tributação
        codigoServico: nota.codigoServico,
        aliquotaServicos: nota.aliquota,
        cargaTributariaValor: nota.cargaTributariaValor,
        cargaTributariaPct: nota.cargaTributariaPct,
        municipioPrestacaoIbge: nota.municipioPrestacaoIbge,

        // Reforma Tributária 2026
        valorIbs: nota.valorIbs,
        valorCbs: nota.valorCbs,
        valorInicialCobrado: nota.valorInicialCobrado,
        valorFinalCobrado: nota.valorFinalCobrado,

        // Descrição
        descricao: nota.discriminacaoServicos,
        discriminacaoServicos: nota.discriminacaoServicos,

        // Compat com totais NFe
        totais: {
            vNF: nota.valorServicos,
            vISS: nota.issDevido,
            vServ: nota.valorServicos,
        },

        // Auditoria
        importadoEm: admin.firestore.FieldValue.serverTimestamp(),
        importadoPor: ctx.importadoPor || 'admin',
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (!existia) {
        docData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        docData.createdBy = ctx.importadoPor || 'admin';
    }

    // O documento de verdade chegou: o carimbo de digitada SAI (merge nao
    // remove campo sozinho, e doc real marcado 'digitada' mente na procedencia).
    await ref.set({ ...docData, ...patchSubstituiuDigitada(snap.data()) }, { merge: true });

    return {
        status: existia ? 'atualizada' : 'criada',
        docId,
        numero,
        valor: nota.valorServicos,
        prestador: nota.razaoSocialPrestador,
        tomador: nota.razaoSocialTomador,
        direcao,
    };
}

/**
 * Importa um CSV completo. Itera as notas e salva cada uma.
 * Determina direcao automaticamente comparando CNPJ da empresa do contexto
 * com prestador/tomador de cada nota.
 */
export async function importarCsvNfseSp(parsed, ctx = {}) {
    const t0 = Date.now();
    const resultados = { criadas: 0, atualizadas: 0, erros: 0, ignoradas: 0, detalhes: [] };

    for (const nota of parsed.notas) {
        try {
            const r = await salvarNotaCsv(nota, ctx);
            if (r.status === 'criada') resultados.criadas++;
            else resultados.atualizadas++;
            resultados.detalhes.push(r);
        } catch (e) {
            resultados.erros++;
            resultados.detalhes.push({ status: 'erro', numero: nota.numero, motivo: e.message });
            console.error(`[nfse-sp-csv-importer] erro nota ${nota.numero}:`, e.message);
        }
    }

    return {
        ...resultados,
        totalNotas: parsed.notas.length,
        duracaoMs: Date.now() - t0,
        valorTotal: parsed.valorSomaCalculada,
        periodo: parsed.periodo,
        ccmExportado: parsed.ccmExportado,
    };
}
