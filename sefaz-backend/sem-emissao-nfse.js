// ============================================================================
// sefaz-backend/sem-emissao-nfse.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🧾 EMPRESA QUE NÃO EMITE NFS-e — parâmetro da EMPRESA (09/10).
//
// Paulo, LANCHONETE JO-BRAS (Simples, comércio — NFC-e de saída, nenhuma nota
// de serviço): a etapa 1 travava em "NFS-e de SP com captura incerta" em
// 07/2026 porque zero NFS-e só vale como "sem ISS" se a captura do portal de
// SP baixou o mês inteiro — e o portal só alcança os últimos 40 dias. Para
// quem NUNCA emite nota de serviço, "zero NFS-e" não é dúvida de captura: é
// a resposta.
//
// Irmã de `sem-emissao-saida.js` (que é "não emite NADA de saída") — esta é
// só a NFS-e: a empresa continua emitindo NF-e/NFC-e, e a saída dela continua
// cobrada. A régua (alerta, nunca contorno):
//  · quem sabe é a pessoa, e ela MARCA (autor, data, motivo) — o app não
//    deduz "não emite NFS-e" de meses sem NFS-e;
//  · marcada, "zero NFS-e emitida" é a resposta declarada, não captura incerta;
//  · marcada e aparece NFS-e emitida: ALERTA — a marca está errada ou a
//    empresa passou a emitir. A nota nunca some por causa da marca;
//  · o CCM continua valendo: é ele que traz as NFS-e TOMADAS (ISS retido).
// Mora em `rotinaParametros.nfsePropria` do cadastro da empresa.
// ============================================================================

export const NFSE_PROPRIA = Object.freeze({ ESPERADA: 'esperada', NAO_EMITE: 'nao-emite' });
export const MOTIVO_MINIMO_NFSE = 5;

/** A marca gravada na empresa, ou null. */
export function marcaSemEmissaoDeNfse(rotinaParametros) {
    const p = rotinaParametros && typeof rotinaParametros === 'object' ? rotinaParametros : null;
    if (!p || p.nfsePropria !== NFSE_PROPRIA.NAO_EMITE) return null;
    const m = p.nfsePropriaMarca && typeof p.nfsePropriaMarca === 'object' ? p.nfsePropriaMarca : {};
    return { por: m.por || null, em: m.em || null, motivo: m.motivo || null };
}

/** Confere o pedido da tela. @returns {{ok:true, valor:object}|{ok:false, erro:string}} */
export function conferirMarcaSemNfse({ naoEmite, motivo, quem, agoraIso } = {}) {
    if (naoEmite !== true && naoEmite !== false) return { ok: false, erro: 'Informe se a empresa emite ou não NFS-e.' };
    if (naoEmite === false) {
        return { ok: true, valor: { nfsePropria: NFSE_PROPRIA.ESPERADA, nfsePropriaMarca: { por: quem || null, em: agoraIso, motivo: 'desfeita' } } };
    }
    const txt = String(motivo || '').trim();
    if (txt.length < MOTIVO_MINIMO_NFSE) {
        return { ok: false, erro: `Escreva o motivo (mínimo ${MOTIVO_MINIMO_NFSE} letras) — ex.: "lanchonete, só NFC-e".` };
    }
    return { ok: true, valor: { nfsePropria: NFSE_PROPRIA.NAO_EMITE, nfsePropriaMarca: { por: quem || null, em: agoraIso, motivo: txt.slice(0, 300) } } };
}

const quando = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** Frase da marca, para o resumo da etapa e para o card. */
export function textoDaMarcaNfse(marca) {
    if (!marca) return '';
    const quem = [marca.por, quando(marca.em)].filter(Boolean).join(' em ');
    return `empresa marcada como NÃO emite NFS-e${quem ? ` por ${quem}` : ''}${marca.motivo ? ` — "${marca.motivo}"` : ''}`;
}

/**
 * O que a marca faz com o ISS da Rotina.
 *
 * @param {{situacao?: string, notas?: number}|null} iss  ISS do mês (`montarPainelIssCarteira`)
 * @param {object|null} marca  `marcaSemEmissaoDeNfse(...)`
 * @returns {{zeroDeclarado: boolean, conflito: boolean, podeMarcar: boolean}}
 *   · zeroDeclarado — marcada e zero NFS-e emitida: o zero É a resposta;
 *   · conflito      — marcada e há NFS-e emitida: a marca está errada (ALERTA);
 *   · podeMarcar    — sem marca, e o que segura é só o zero sem prova.
 */
export function efeitoDaMarcaNfse(iss, marca) {
    const notas = Number(iss?.notas || 0);
    const incertoPorZero = iss?.situacao === 'captura-incerta' && notas === 0;
    if (!marca) return { zeroDeclarado: false, conflito: false, podeMarcar: incertoPorZero };
    return { zeroDeclarado: notas === 0, conflito: notas > 0, podeMarcar: false };
}
