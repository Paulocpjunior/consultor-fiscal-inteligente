// ============================================================================
// sefaz-backend/nfts-sp-importer.js
// ----------------------------------------------------------------------------
// A NFTS vira DOCUMENTO — antes ela só era cruzada, nunca importada.
//
// 🚨 O CASO (03/09, Paulo, PEC PRONTA ENTREGA · CCM 9.251.696-3 · 08/2026):
// *"Referente a NFTS, ela não aparece pra mim no consultor, o PDF ele não
// aceita e o CSV por causa do layout"*.
//
// 📌 O "não aparece" era POR CONSTRUÇÃO, e isso foi MEDIDO: o módulo de NFTS
// tinha UMA rota (`/cruzamento`), que **LÊ** `documentos_fiscais` para conferir
// e **nunca escreve**. Ou seja, a NFTS nunca virava documento — não estava no
// Livro de Serviços tomados, não entrava no recorte de competência, não
// aparecia em lugar nenhum. Não era defeito de captura, era ausência de
// trilho.
//
// 🚨 E O QUE FICAVA DE FORA É O QUE CARREGA O IMPOSTO: a NFTS é o documento em
// que o TOMADOR declara o serviço de quem não emite NFS-e paulistana — e é
// nela que mora o **ISS RETIDO** que o cliente recolhe. No print: `ISS devido
// pelo tomador R$ 427,20 · ISS Retido? Sim`.
//
// ⚠️ **A COMPETÊNCIA É A DATA DA PRESTAÇÃO, nunca a da emissão** — e o print
// prova de novo: `Emissão 03/09/2026 · Data Prestação Serv. 31/08/2026`, e o
// portal lista sob `Período: Incidência 08/2026`. Quem responde é o DONO
// (`competenciaDaNfse`), o mesmo da NFS-e: duas leituras da mesma pergunta
// fariam a NFTS e a NFS-e do MESMO mês caírem em competências diferentes.
//
// ⚠️ **DIREÇÃO É ENTRADA POR DEFINIÇÃO**: NFTS é a nota do TOMADOR. Não há o
// que deduzir aqui — quem emite é o cliente, e o serviço é tomado.
// ============================================================================
import admin from 'firebase-admin';
import { competenciaDaNfse } from './competencia-da-nfse.js';
import { dataDeclaradaDoDocumento, docCancelado } from './xml-metadata-helper.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * O id do documento — DETERMINÍSTICO, para reimportar cair por cima.
 *
 * ⚠️ Sem isto, reimportar o MESMO CSV criaria uma segunda NFTS e o serviço
 * contaria duas vezes no livro (o defeito do `Date.now()` de 01/09).
 */
export function idDaNfts(ccmTomador, numero) {
    return `nfts-sp-${soDigitos(ccmTomador) || 'sem-ccm'}-${soDigitos(numero) || 'sem-numero'}`;
}

/**
 * O documento que a NFTS vira — PURO, para a forma ser testável sem Firestore.
 *
 * @returns {{doc: object|null, lacunas: string[]}}
 */
export function documentoDaNfts(nota, ctx = {}) {
    const lacunas = [];
    const numero = String(nota?.numero ?? '').trim();
    const docPrestador = soDigitos(nota?.docPrestador);
    const valor = Number(nota?.valorServicos);

    // 🚨 SEM ESTES TRÊS A NOTA NÃO ENTRA — e sai NOMEADA. Documento sem valor
    // entra no livro valendo zero e nenhum validador denuncia; sem prestador,
    // o A100 sai com COD_PART vazio (a recusa de hoje, INSTITUTO HAYAY); sem
    // número, não há como reencontrá-la.
    if (!numero) lacunas.push('sem número da NFTS');
    if (!docPrestador) lacunas.push('sem CPF/CNPJ do prestador');
    if (!Number.isFinite(valor) || valor <= 0) lacunas.push('sem valor dos serviços');
    if (lacunas.length) return { doc: null, lacunas };

    // A que MÊS ela pertence: a INCIDÊNCIA, que na NFTS é a **Data da Prestação
    // de Serviços** — o mesmo papel que o `Data Fato Gerador` faz na NFS-e, e
    // por isso o dono é o MESMO (`competenciaDaNfse`). Duas leituras da mesma
    // pergunta fariam a NFTS e a NFS-e do MESMO mês caírem em competências
    // diferentes, que é a divergência que esta casa mais paga.
    const incidencia = competenciaDaNfse({
        dataFatoGerador: nota.dataPrestacao,
        dataEmissao: nota.dataEmissao,
    });
    if (!incidencia.competencia) lacunas.push('sem data legível (prestação nem emissão)');
    if (lacunas.length) return { doc: null, lacunas };

    const dhEmi = dataDeclaradaDoDocumento(nota.dataEmissao) || null;
    const cancelada = !!nota.cancelada;
    const issRetido = /^(s|sim|1|true)$/i.test(String(nota.issRetido ?? '').trim());

    return {
        lacunas: [],
        doc: {
            id: idDaNfts(nota.ccmTomador || ctx.ccmTomador, numero),
            chave: null,
            // ⚠️ RÓTULO PRÓPRIO: NFTS não é NFS-e — quem a emite é o TOMADOR, e
            // confundir as duas faria a mesma prestação ser declarada duas
            // vezes quando o prestador também emitir.
            tipo: 'NFTS',
            tipoDoc: 'NFTS',
            fonte: 'csv-portal-sp-nfts',
            layout: ctx.layout || null,
            modelo: '99',
            numero,
            serie: String(nota.serieDocumento ?? '').trim() || null,
            natOp: nota.codigoServico ? `Cód. serviço ${nota.codigoServico}` : 'Serviço tomado (NFTS)',

            dhEmi,
            dataFatoGerador: dataDeclaradaDoDocumento(nota.dataPrestacao) || null,
            competencia: incidencia.competencia,
            competenciaOrigem: incidencia.origem,
            competenciaDivergeDaEmissao: incidencia.diverge,

            // NFTS é do TOMADOR, sempre — não há direção a deduzir.
            direcao: 'entrada',
            status: cancelada ? 'cancelado' : 'autorizado',
            canceladoEm: nota.dataCancelamento || null,

            empresaId: ctx.empresaId || null,
            empresaCnpj: soDigitos(ctx.empresaCnpj) || soDigitos(nota.docTomador) || null,
            empresaNome: ctx.empresaNome || nota.nomeTomador || '',

            prestadorCnpj: docPrestador,
            prestadorNome: nota.nomePrestador || '',
            prestadorCcm: soDigitos(nota.ccmPrestador) || null,
            prestadorUf: nota.ufPrestador || null,
            prestadorMunicipio: nota.cidadePrestador || null,

            tomadorCnpj: soDigitos(nota.docTomador) || soDigitos(ctx.empresaCnpj) || null,
            tomadorNome: nota.nomeTomador || ctx.empresaNome || '',
            tomadorCcm: soDigitos(nota.ccmTomador || ctx.ccmTomador) || null,

            valorTotal: valor,
            valorServicos: valor,
            valorDeducoes: Number.isFinite(Number(nota.valorDeducoes)) ? Number(nota.valorDeducoes) : null,
            aliquotaIss: Number.isFinite(Number(nota.aliquota)) ? Number(nota.aliquota) : null,
            valorIss: Number.isFinite(Number(nota.valorIss)) ? Number(nota.valorIss) : null,
            // 🚨 É O ISS DA NFTS QUE O CLIENTE RECOLHE. `issRetido` é BOOLEANO
            // no portal (o campo diz "Sim"/"Não"), e o VALOR mora em `valorIss`
            // — somar o booleano como número seria declarar retenção de 1,00.
            issRetidoDeclarado: issRetido,
            valorIssRetido: issRetido && Number.isFinite(Number(nota.valorIss))
                ? Number(nota.valorIss) : null,
            codigoServico: nota.codigoServico || null,
            subitemLista: nota.subitemLista || null,
            discriminacaoServicos: nota.discriminacao || null,
        },
    };
}

/**
 * Grava as NFTS lidas do CSV.
 *
 * ⚠️ Nota que não vira documento **não some**: volta em `foras`, nomeada e com
 * a lacuna — "3 importadas" sem dizer que 2 ficaram de fora é o que faz alguém
 * achar que declarou tudo.
 */
export async function importarNftsDoCsv(notas, ctx = {}) {
    const db = fa().firestore();
    const resultado = { gravadas: 0, atualizadas: 0, canceladas: 0, foras: [], competencias: {} };

    for (const nota of (notas || [])) {
        const { doc, lacunas } = documentoDaNfts(nota, ctx);
        if (!doc) {
            resultado.foras.push({
                numero: nota?.numero || '(sem número)',
                prestador: nota?.nomePrestador || nota?.docPrestador || '(sem prestador)',
                lacunas,
            });
            continue;
        }
        const ref = db.collection('documentos_fiscais').doc(doc.id);
        const snap = await ref.get();
        // ⚠️ MERGE: reimportar não pode apagar o que outro trilho já gravou
        // (evento, carimbo de conferência) — a lição do stub ressuscitado.
        await ref.set({
            ...doc,
            importadoEm: Date.now(),
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        if (snap.exists) resultado.atualizadas += 1; else resultado.gravadas += 1;
        // ⚠️ QUEM DECIDE "cancelada" É A RÉGUA, nunca o campo cru: `status`
        // mente quando o cancelamento chega por EVENTO. Na NFTS ele vem do
        // próprio portal (coluna `Data de Cancelamento`), mas contar aqui de
        // outro jeito seria a segunda régua — e é assim que elas divergem.
        if (docCancelado(doc)) resultado.canceladas += 1;
        resultado.competencias[doc.competencia] = (resultado.competencias[doc.competencia] || 0) + 1;
    }
    return resultado;
}
