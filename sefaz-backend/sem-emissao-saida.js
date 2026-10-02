// ============================================================================
// sefaz-backend/sem-emissao-saida.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚫 EMPRESA QUE NÃO EMITE NOTA DE SAÍDA — parâmetro da EMPRESA (02/10).
//
// Paulo, 02/10, no CONDOMINIO DO EDIFICIO BENJAMIN CONSTANT: *"devemos
// parametrizar nos casos em que empresas não possuem notas de saída mod.
// 55/65 nem NFS, apenas captura de notas de entrada, serviços tomados, e fica
// impedindo o fechamento do mês"*. A etapa 1 dizia "N entrada(s), nenhuma nota
// de SAÍDA" em âmbar todo mês — alarme sobre estado CORRETO, que ninguém
// consegue apagar (a lição do aluguel na Rotina, 27/08).
//
// A régua (alerta, nunca contorno):
//  · quem sabe é a pessoa, e ela MARCA (autor, data, motivo) — o app não
//    deduz "não emite" de meses sem saída;
//  · marcada, a etapa 1 FECHA com entradas e zero saída, e diz por quê;
//  · marcada e chega SAÍDA mesmo assim: ALERTA — a marca está errada ou a
//    empresa passou a emitir. A nota nunca some por causa da marca;
//  · o "zero NFS-e emitida" da empresa marcada é a resposta declarada, não
//    "captura incerta" (o CCM continua cobrado: é ele que traz as TOMADAS).
// Mora em `rotinaParametros.saidaPropria` do cadastro da empresa.
// ============================================================================

export const SAIDA_PROPRIA = Object.freeze({ ESPERADA: 'esperada', NAO_EMITE: 'nao-emite' });
export const MOTIVO_MINIMO = 5;

/** A marca gravada na empresa, ou null. */
export function marcaSemEmissaoDeSaida(rotinaParametros) {
    const p = rotinaParametros && typeof rotinaParametros === 'object' ? rotinaParametros : null;
    if (!p || p.saidaPropria !== SAIDA_PROPRIA.NAO_EMITE) return null;
    const m = p.saidaPropriaMarca && typeof p.saidaPropriaMarca === 'object' ? p.saidaPropriaMarca : {};
    return { por: m.por || null, em: m.em || null, motivo: m.motivo || null };
}

/** Confere o pedido da tela. @returns {{ok:true, valor:object}|{ok:false, erro:string}} */
export function conferirMarcaSemSaida({ naoEmite, motivo, quem, agoraIso } = {}) {
    if (naoEmite !== true && naoEmite !== false) return { ok: false, erro: 'Informe se a empresa emite ou não nota de saída.' };
    if (naoEmite === false) {
        return { ok: true, valor: { saidaPropria: SAIDA_PROPRIA.ESPERADA, saidaPropriaMarca: { por: quem || null, em: agoraIso, motivo: 'desfeita' } } };
    }
    const txt = String(motivo || '').trim();
    if (txt.length < MOTIVO_MINIMO) {
        return { ok: false, erro: `Escreva o motivo (mínimo ${MOTIVO_MINIMO} letras) — ex.: "condomínio, só serviços tomados".` };
    }
    return { ok: true, valor: { saidaPropria: SAIDA_PROPRIA.NAO_EMITE, saidaPropriaMarca: { por: quem || null, em: agoraIso, motivo: txt.slice(0, 300) } } };
}

const quando = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** Frase da marca, para o resumo da etapa e para o card. */
export function textoDaMarca(marca) {
    if (!marca) return '';
    const quem = [marca.por, quando(marca.em)].filter(Boolean).join(' em ');
    return `empresa marcada como SEM emissão de saída (nem NF-e/NFC-e nem NFS-e)${quem ? ` por ${quem}` : ''}`
        + `${marca.motivo ? ` — "${marca.motivo}"` : ''}`;
}

/**
 * Aplica a marca à etapa 1 (captura) já montada pela Rotina.
 *
 * @param {object} p
 * @param {object} p.captura   etapa 'captura'
 * @param {number} p.entradas
 * @param {number} p.saidas
 * @param {object|null} p.marca  `marcaSemEmissaoDeSaida(...)`
 */
export function aplicarSemEmissaoNaCaptura({ captura, entradas = 0, saidas = 0, marca = null }) {
    if (!captura) return captura;
    if (!marca) {
        // A porta só aparece onde resolve: entradas chegaram, saída nenhuma,
        // e é isso (e só isso) que segura a etapa.
        const pode = captura.status === 'atencao' && entradas > 0 && saidas === 0;
        return { ...captura, podeMarcarSemSaida: pode };
    }
    const info = { semSaidaMarcada: marca, podeMarcarSemSaida: false };
    if (saidas > 0) {
        return {
            ...captura, ...info,
            status: captura.status === 'pendente' ? 'pendente' : 'atencao',
            resumo: `${captura.resumo} · ATENÇÃO: ${textoDaMarca(marca)}, mas chegaram ${saidas} nota(s) de SAÍDA.`,
            acao: 'Confira: ou a marca está errada (desfaça no card da empresa), ou a empresa passou a emitir. '
                + 'As notas de saída continuam no livro — a marca nunca as esconde.',
        };
    }
    if (captura.status === 'atencao' && entradas > 0) {
        return {
            ...captura, ...info,
            status: 'concluida',
            resumo: `${entradas} entrada(s) capturada(s) · ${textoDaMarca(marca)}.`,
            acao: null,
        };
    }
    return { ...captura, ...info };
}
