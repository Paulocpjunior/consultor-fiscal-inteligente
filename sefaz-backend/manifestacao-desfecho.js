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
 *   outro   → RECUSADA, com cStat e xMotivo ditos
 *   nenhum evento no retorno → SEM RESPOSTA (o lote falhou: cStatLote/xMotivoLote)
 */

export const CSTAT_ACEITO = Object.freeze(['135', '136']);
export const CSTAT_JA_EXISTIA = '573';

/**
 * @param {{cStatLote?:string|null, xMotivoLote?:string|null, eventos?:Array<{cStat?:string|null, xMotivo?:string|null}>}|null|undefined} retorno
 * @returns {{situacao:'aceita'|'ja-existia'|'recusada'|'sem-resposta', cStat:string|null, xMotivo:string|null, registraEvento:boolean, frase:string}}
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
