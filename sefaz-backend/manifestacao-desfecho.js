/**
 * manifestacao-desfecho.js — o DESFECHO de uma manifestação do destinatário,
 * lido do retorno da SEFAZ. PURO.
 *
 * 28/09 (Paulo, validando a etapa 2 da Rotina): "consigo marcar como ciente,
 * porém quando atualizo ele volta a aparecer como sem ciência". A rota
 * `manifest-one` devolvia HTTP 200 com o retorno CRU da SEFAZ, e a tela lia
 * qualquer 200 como "✔ ciência manifestada". O evento só era gravado no
 * documento com cStat 135/136 — qualquer recusa passava como sucesso mudo e
 * não gravava nada.
 *
 * Situações (Manual de Orientação do Contribuinte, eventos):
 *   135/136 → ACEITA (evento registrado agora)
 *   573     → JÁ EXISTIA ("Duplicidade de Evento": a ciência já estava
 *             registrada na SEFAZ — o fato é o mesmo, o app só não sabia)
 *   596     → PRAZO ENCERRADO ("Evento apresentado após o prazo permitido
 *             para o evento: [10 dias]" — 01/10, ALMEIDA COMERCIO nº 187).
 *             Recusa DEFINITIVA: nenhum reenvio muda a resposta. Não grava
 *             evento (não houve ciência), grava o FATO do prazo, para a Rotina
 *             parar de cobrar o que não tem mais saída e o lote parar de
 *             reenviar — e a contagem continua DITA no resumo.
 *   outro   → RECUSADA, com cStat e xMotivo ditos
 *   nenhum evento no retorno → SEM RESPOSTA (o lote falhou: cStatLote/xMotivoLote)
 */

export const CSTAT_ACEITO = Object.freeze(['135', '136']);
export const CSTAT_JA_EXISTIA = '573';
export const CSTAT_PRAZO_ENCERRADO = '596';

/**
 * @param {{cStatLote?:string|null, xMotivoLote?:string|null, eventos?:Array<{cStat?:string|null, xMotivo?:string|null}>}|null|undefined} retorno
 * @returns {{situacao:'aceita'|'ja-existia'|'prazo-encerrado'|'recusada'|'sem-resposta', cStat:string|null, xMotivo:string|null, registraEvento:boolean, registraPrazoEncerrado?:boolean, frase:string}}
 */
export function desfechoDaManifestacao(retorno) {
    const eventos = Array.isArray(retorno?.eventos) ? retorno.eventos : [];
    const aceito = eventos.find((e) => CSTAT_ACEITO.includes(String(e?.cStat ?? '')));
    if (aceito) {
        return { situacao: 'aceita', cStat: String(aceito.cStat), xMotivo: aceito.xMotivo || null, registraEvento: true, frase: 'ciência manifestada agora' };
    }
    const jaExistia = eventos.find((e) => String(e?.cStat ?? '') === CSTAT_JA_EXISTIA);
    if (jaExistia) {
        return { situacao: 'ja-existia', cStat: CSTAT_JA_EXISTIA, xMotivo: jaExistia.xMotivo || null, registraEvento: true, frase: 'a ciência já estava registrada na SEFAZ' };
    }
    const prazo = eventos.find((e) => String(e?.cStat ?? '') === CSTAT_PRAZO_ENCERRADO);
    if (prazo) {
        return {
            situacao: 'prazo-encerrado', cStat: CSTAT_PRAZO_ENCERRADO, xMotivo: prazo.xMotivo || null,
            registraEvento: false, registraPrazoEncerrado: true,
            frase: `prazo da SEFAZ encerrado (596${prazo.xMotivo ? `: ${prazo.xMotivo}` : ''}) — não há mais como manifestar este evento`,
        };
    }
    if (eventos.length) {
        const e = eventos[0];
        const cStat = e?.cStat != null ? String(e.cStat) : null;
        return { situacao: 'recusada', cStat, xMotivo: e?.xMotivo || null, registraEvento: false, frase: `SEFAZ recusou${cStat ? ` (${cStat})` : ''}${e?.xMotivo ? `: ${e.xMotivo}` : ''}` };
    }
    const cStat = retorno?.cStatLote != null ? String(retorno.cStatLote) : null;
    return {
        situacao: 'sem-resposta', cStat, xMotivo: retorno?.xMotivoLote || null, registraEvento: false,
        frase: `sem resposta da SEFAZ para o evento${cStat ? ` (lote ${cStat}` : ''}${retorno?.xMotivoLote ? `: ${retorno.xMotivoLote}` : ''}${cStat ? ')' : ''}`,
    };
}

const DESCRICAO = {
    ciencia: 'Ciência da Operação',
    confirmacao: 'Confirmação da Operação',
    desconhecimento: 'Desconhecimento da Operação',
};

/** O evento que vai para `documentos_fiscais.eventos[]` — inclusive quando a SEFAZ diz que já existia. */
export function eventoDaManifestacao({ evt, tipo, capturadoPor = null, jaExistia = false, tpEventoPadrao = null }) {
    return {
        tpEvento: evt?.tpEvento || tpEventoPadrao || null,
        tipo: `manifestacao_${tipo}`,
        descricao: DESCRICAO[tipo] || 'Operação não Realizada',
        nSeqEvento: '1',
        dhEvento: evt?.dhRegEvento || null,
        nProt: evt?.nProt || null,
        cStat: evt?.cStat != null ? String(evt.cStat) : null,
        xMotivo: evt?.xMotivo || null,
        // 573: o registro já existia na SEFAZ (feito por outro sistema ou
        // antes do app). É FATO, e vai dito — não é "manifestado agora".
        ...(jaExistia ? { jaExistiaNaSefaz: true } : {}),
        importadoPor: capturadoPor?.email || 'manifesto-auto',
    };
}

/**
 * O FATO do prazo encerrado que vai para o documento (`manifestacaoPrazoEncerrado`).
 * Sem `undefined` (o Firestore recusa): ausente sai null.
 */
export function marcaDoPrazoEncerrado({ desfecho, tipo, capturadoPor = null, agoraIso = new Date().toISOString() }) {
    return {
        tipo: String(tipo || 'ciencia'),
        cStat: desfecho?.cStat || CSTAT_PRAZO_ENCERRADO,
        xMotivo: desfecho?.xMotivo || null,
        em: agoraIso,
        por: capturadoPor?.email || 'manifesto-auto',
    };
}

/**
 * Os campos do documento que a pergunta "a ciência ainda é pendência?" lê
 * (`ehCompletaSemCiencia` / `ehCienciaComPrazoEncerrado` da Rotina). Projeção
 * sem um deles CEGA a régua — 01/10, KJM: o 596 estava gravado na nota e a
 * Rotina seguia cobrando, porque `manifestacaoPrazoEncerrado` não vinha no
 * `.select(...)`. A trava `projecaoNaoCegaARegua` cobra esta lista.
 */
export const CAMPOS_PARA_CIENCIA_DO_DOCUMENTO = Object.freeze(['eventos', '_completadoEm', 'manifestacaoPrazoEncerrado']);

/** O prazo DESTE tipo de evento já foi declarado encerrado pela SEFAZ neste documento? */
export function prazoDaManifestacaoEncerrado(doc, tipo = 'ciencia') {
    const m = doc?.manifestacaoPrazoEncerrado;
    return !!m && String(m.tipo || 'ciencia') === String(tipo);
}
