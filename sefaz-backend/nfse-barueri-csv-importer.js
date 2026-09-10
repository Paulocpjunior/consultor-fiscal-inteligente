// ============================================================================
// sefaz-backend/nfse-barueri-csv-importer.js
// Grava no Firestore as notas lidas do CSV do portal de **Barueri**.
//
// O documento sai nas MESMAS formas que o resto do app já lê — é o que faz a
// nota aparecer na lista, no Livro de Serviços, no ISS da competência e no
// bloco A do EFD-Contribuições. Nenhuma régua nasce aqui: competência,
// identidade, cancelamento e participantes vêm dos DONOS.
//
// 🔑 O ID É A CHAVE (dono: `nfse-identidade.js`), que é o MESMO id da captura
// pelo ADN. Então importar o CSV do município **atualiza** a nota que veio
// pelo Portal Nacional em vez de criar uma segunda — e é isso que faz a
// cancelada-depois-da-captura virar cancelada sem ninguém marcar à mão.
//
// ⚠️ `merge: true` SEMPRE: reimportar não pode apagar o que outro trilho
// gravou (o `eventos[]` do ADN, um ajuste declarado, o XML no Storage).
// ============================================================================

import admin from 'firebase-admin';
import { idDocumentoNfse, patchSubstituiuDigitada } from './nfse-identidade.js';
import { competenciaDaNfse } from './competencia-da-nfse.js';
// 🚨 Quem responde "esta nota está cancelada?" é o DONO — o campo `status`
// MENTE quando o cancelamento chegou por EVENTO (é assim que ele chega pelo
// ADN, que é justamente o trilho por onde estas notas subiram ATIVAS).
import { docCancelado } from './xml-metadata-helper.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

const so = (v) => String(v ?? '').replace(/\D/g, '');
const raiz = (v) => so(v).slice(0, 8);
const num = (v) => (Number.isFinite(v) ? v : null);

/**
 * De que lado a empresa está — pelos DOCUMENTOS da nota, nunca pelo nome do
 * arquivo. Compara pela RAIZ (matriz e filial são a mesma empresa no resto do
 * app: a régua do certificado e a do lote de XML).
 */
export function direcaoDaNotaBarueri(nota, empresaCnpj) {
    const emp = raiz(empresaCnpj);
    if (!emp) return null;
    if (raiz(nota?.prestadorCnpj) === emp) return 'saida';
    if (raiz(nota?.tomadorDoc) === emp) return 'entrada';
    return null;
}

/**
 * O ARQUIVO É DESTA EMPRESA?
 *
 * 🚨 A pergunta existe por causa do caso de 03/09 (*"lancei uma nota da J.P.
 * PISSATO na empresa SILVIO FREIRE, e o consultor não deu nenhum erro"*):
 * documento gravado no cliente errado infla o livro de quem não prestou e
 * SOME do livro de quem prestou — e nenhum validador acusa, porque as duas
 * empresas estão cadastradas certas.
 *
 * A exportação que a equipe usa é a de notas EMITIDAS, e o prestador está na
 * chave. Recusa só quando a empresa **não aparece em lado nenhum** do arquivo:
 * se ela for a TOMADORA de todas as notas, isso é um export de notas recebidas
 * e o arquivo é dela — dizer "é de outra empresa" ali seria a mensagem que
 * manda procurar no lugar errado (o achado 18).
 *
 * Notas sem chave não acusam: ausência não é prova (a régua de 03/09 — lado
 * ilegível não bloqueia).
 */
export function conferirPosseDoCsvBarueri(parsed, empresaCnpj) {
    const emp = raiz(empresaCnpj);
    const prestadores = [...new Set((parsed?.notas || []).map((n) => so(n.prestadorCnpj)).filter(Boolean))];
    if (!prestadores.length) {
        return { ok: true, motivo: null, prestadores: [], semChave: true };
    }
    if (!emp) return { ok: true, motivo: null, prestadores, semChave: false };
    const daEmpresa = prestadores.filter((p) => raiz(p) === emp);
    if (daEmpresa.length) return { ok: true, motivo: null, prestadores, semChave: false };
    // A empresa pode estar do outro lado: export de notas RECEBIDAS.
    if ((parsed?.notas || []).some((n) => raiz(n.tomadorDoc) === emp)) {
        return { ok: true, motivo: null, prestadores, semChave: false };
    }
    return {
        ok: false,
        prestadores,
        semChave: false,
        motivo: `Este arquivo é de OUTRA empresa: quem emitiu as notas é ${prestadores.join(', ')} `
            + `(está dentro da chave de acesso de cada nota), e a empresa escolhida é ${so(empresaCnpj)}. `
            + 'Importar assim poria as notas no cliente errado — o livro de quem prestou ficaria a MENOS e o '
            + 'de quem não prestou, a mais, sem nada acusar. O que fazer agora: escolha a empresa emitente '
            + 'e importe de novo.',
    };
}

/**
 * Os campos do documento, nas formas que os leitores do app já leem.
 * PURO — não fala com o banco, para ser exercitável por teste.
 */
export function documentoDaNotaBarueri(nota, ctx = {}) {
    const direcao = direcaoDaNotaBarueri(nota, ctx.empresaCnpj);
    const incidencia = competenciaDaNfse({
        dataFatoGerador: nota.dataFatoGerador, dataEmissao: nota.dataEmissao,
    });

    const prest = so(nota.prestadorCnpj);
    const toma = so(nota.tomadorDoc);

    const doc = {
        // O app inteiro pergunta `tipo === 'NFSe'`; `tipoDoc` guarda o trilho.
        tipo: 'NFSe',
        tipoDoc: 'NFSe',
        fonte: 'csv-portal-barueri',
        layout: 'barueri-csv',
        modelo: '99',
        chave: nota.chaveAcesso || null,
        numero: String(nota.numero || ''),
        // ⚠️ NÃO é a série do RPS (documento diferente — o recibo provisório).
        // A NFS-e do padrão nacional não tem série; sai `'1'`, que é o que o
        // importador do portal de SP grava e o que está PROVADO por recibo do
        // PVA no bloco A. Inventar uma terceira resposta aqui faria o mesmo
        // campo sair diferente conforme o município de origem.
        serie: '1',
        codigoVerificacao: nota.codigoAutenticidade || null,
        natOp: nota.codigoServico ? `Cód. serviço ${nota.codigoServico}` : 'Serviço NFS-e',

        dhEmi: nota.dataEmissao,
        dataFatoGerador: nota.dataFatoGerador,
        codMunIBGE: nota.codMunIBGE || null,

        // Prestador e tomador nas formas ACHATADA e ANINHADA — os leitores do
        // app usam as duas (a armadilha que mordeu 13 vezes neste projeto).
        prestadorCnpj: prest,
        cnpjEmit: prest,
        tomadorCnpj: toma,
        cnpjDest: toma,
        xNomeDest: nota.tomadorNome || '',
        tomadorNome: nota.tomadorNome || '',
        tomadorEndereco: nota.tomadorEndereco || null,
        ufDest: nota.tomadorEndereco?.uf || '',

        codigoServico: nota.codigoServico || '',
        aliquotaServicos: num(nota.aliquota),
        descricao: nota.discriminacao || '',
        discriminacaoServicos: nota.discriminacao || '',

        // Auditoria da origem — o número do portal, que é por onde a equipe
        // procura a nota lá dentro.
        identificadorPortal: nota.identificador || null,
        numeroRps: nota.numeroRps || '',
        // ⚠️ O CÓDIGO DE ISS RETIDO VAI CRU E NÃO VIRA `issRetido`: o portal
        // manda `2` em todas as notas da amostra e o significado do código
        // **não está provado**. Afirmar "não houve retenção" é a afirmação
        // cara (o ISS a recolher sairia a maior se houvesse); afirmar que
        // houve tira ISS que a empresa deve. Sem prova, o app não afirma.
        issRetidoCodigoPortal: nota.issRetidoBruto || null,
    };

    if (direcao) doc.direcao = direcao;
    if (incidencia.competencia) {
        doc.competencia = incidencia.competencia;
        doc.competenciaOrigem = incidencia.origem;
        doc.competenciaDivergeDaEmissao = incidencia.diverge;
    }

    // ⚠️ VALOR AUSENTE NÃO VIRA ZERO — nota valendo 0,00 entra no livro, no
    // Resumo por CFOP e na apuração sem nenhum validador denunciar.
    if (Number.isFinite(nota.valorServicos)) {
        doc.valorTotal = nota.valorServicos;
        doc.valorServicos = nota.valorServicos;
        doc.totais = { vNF: nota.valorServicos, vServ: nota.valorServicos, vISS: num(nota.issDevido) };
    }
    const iss = num(nota.issDevido);
    if (iss !== null) {
        // As duas formas achatadas que os leitores do app conhecem — quem LÊ
        // é `issDoDocumento`, o dono; aqui só se GRAVA o que o portal mandou.
        doc.valorIss = iss;
        doc.issDevido = iss;
    }

    // Retenções federais: o portal entrega DECOMPOSTO (medido). Campo vazio
    // fica FORA do objeto — `undefined` gravado vira `null`, e `null` passa em
    // `retencoesFederaisGravadas`, fazendo a nota imprimir 0,00, que é a
    // AFIRMAÇÃO de que não houve retenção (o defeito de 01/09).
    if (Number.isFinite(nota.irRetido)) doc.valorIr = nota.irRetido;
    if (Number.isFinite(nota.pisRetido)) doc.valorPis = nota.pisRetido;
    if (Number.isFinite(nota.cofinsRetida)) doc.valorCofins = nota.cofinsRetida;
    if (Number.isFinite(nota.csllRetida)) doc.valorCsll = nota.csllRetida;

    // ⚠️ STATUS SÓ COM RESPOSTA: rótulo que o CFI não conhece não vira
    // 'autorizado' nem 'cancelado' — com `merge` o que já estava lá continua
    // valendo, e marcar nota válida como cancelada apaga receita.
    if (nota.situacao === 'cancelada') {
        doc.status = 'cancelado';
        doc.situacao = 'cancelada';
        doc.situacaoBruta = nota.situacaoBruta || 'Cancelada';
        doc.canceladoPelaFonte = 'portal-barueri';
    } else if (nota.situacao === 'ativa') {
        doc.status = 'autorizado';
        doc.situacao = 'ativa';
        doc.situacaoBruta = nota.situacaoBruta || 'Sim';
    }

    if (nota.substituidaPor) doc.substituidaPor = nota.substituidaPor;
    return doc;
}

/** Grava UMA nota. Idempotente pelo id do dono. */
export async function salvarNotaBarueri(nota, ctx = {}) {
    const db = fa().firestore();
    const docId = idDocumentoNfse({
        chave: nota.chaveAcesso,
        prestadorCnpj: nota.prestadorCnpj,
        tomadorCnpj: nota.tomadorDoc,
        numero: nota.numero,
    });
    const ref = db.collection('documentos_fiscais').doc(docId);
    const snap = await ref.get();
    const existia = snap.exists;

    const doc = documentoDaNotaBarueri(nota, ctx);
    const empresaCnpj = so(ctx.empresaCnpj) || (doc.direcao === 'entrada' ? doc.tomadorCnpj : doc.prestadorCnpj);

    const payload = {
        id: docId,
        ...doc,
        empresaId: ctx.empresaId || null,
        empresaCnpj: empresaCnpj || null,
        empresaNome: ctx.empresaNome || null,
        importadoEm: admin.firestore.FieldValue.serverTimestamp(),
        importadoPor: ctx.importadoPor || 'admin',
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!existia) {
        payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
        payload.createdBy = ctx.importadoPor || 'admin';
    }

    await ref.set({ ...payload, ...patchSubstituiuDigitada(snap.data()) }, { merge: true });

    const antes = snap.data() || {};
    const agoraCancelada = nota.situacao === 'cancelada';
    // ⚠️ O QUE JÁ ESTAVA LÁ se lê pela RÉGUA: `antes.status` continua
    // 'autorizado' quando o cancelamento veio por evento, e comparar o campo
    // cru diria "virou cancelada agora" sobre nota que já estava cancelada —
    // alarme falso avisando que o faturamento mudou quando ele não mudou.
    const jaEstavaCancelada = existia && docCancelado(antes);
    return {
        status: existia ? 'atualizada' : 'criada',
        docId,
        numero: doc.numero,
        valor: doc.valorTotal ?? null,
        tomador: doc.tomadorNome,
        direcao: doc.direcao || null,
        competencia: doc.competencia || null,
        cancelada: agoraCancelada,
        // 🚨 O QUE ESTE IMPORT MUDOU NA NOTA QUE JÁ ESTAVA LÁ: é a resposta ao
        // caso que abriu tudo — a nota veio ATIVA pelo Portal Nacional e o
        // município diz que ela foi cancelada. Sem dizer, ninguém sabe que o
        // faturamento mudou.
        virouCancelada: agoraCancelada && existia && !jaEstavaCancelada,
    };
}

/** Importa o CSV inteiro. */
export async function importarCsvNfseBarueri(parsed, ctx = {}) {
    const t0 = Date.now();
    const out = {
        criadas: 0, atualizadas: 0, erros: 0, viraramCanceladas: [], detalhes: [],
    };

    for (const nota of parsed.notas) {
        try {
            const r = await salvarNotaBarueri(nota, ctx);
            if (r.status === 'criada') out.criadas++; else out.atualizadas++;
            if (r.virouCancelada) out.viraramCanceladas.push({ numero: r.numero, valor: r.valor });
            out.detalhes.push(r);
        } catch (e) {
            out.erros++;
            out.detalhes.push({ status: 'erro', numero: nota.numero, motivo: e.message });
            console.error(`[nfse-barueri-csv] erro nota ${nota.numero}:`, e.message);
        }
    }

    return {
        ...out,
        totalNotas: parsed.notas.length,
        canceladas: parsed.canceladas,
        valorTotal: parsed.valorSomaCalculada,
        periodo: parsed.periodo,
        duracaoMs: Date.now() - t0,
    };
}
