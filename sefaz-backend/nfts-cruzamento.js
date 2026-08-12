// ============================================================================
// sefaz-backend/nfts-cruzamento.js  (PURO — sem io, testável)
//
// SERVIÇO TOMADO × NFTS EMITIDA: onde falta NFTS.
//
// A NFTS é emitida pelo TOMADOR quando o prestador NÃO emite NFS-e paulistana
// — e é ela que declara o ISS retido. Se o cliente tomou um serviço desses e
// não emitiu a NFTS, há obrigação não cumprida e ISS retido não declarado.
//
// POR QUE EXISTE: o export de NFTS de 07/2026 veio com `Total;0` (Paulo,
// 12/08). Zero NFTS é ambíguo — pode ser "não tomou serviço desses" ou "tomou e
// não emitiu". Este módulo transforma a ambiguidade em resposta, usando os
// serviços tomados que o app já capturou.
//
// ─── A HONESTIDADE QUE MANDA NESTE MÓDULO ───────────────────────────────────
//
// O cruzamento é **PARCIAL POR CONSTRUÇÃO**, e por um motivo estrutural: o
// prestador de outro município emite NFS-e no portal DELE, que não é
// distribuída a ninguém. O CFI só enxerga o serviço tomado quando ele chega por
// NFS-e Nacional (ADN), importação manual ou PDF.
//
// Consequência: **AUSÊNCIA DE ACHADO NÃO É PROVA DE CONFORMIDADE.** Um resultado
// "nenhuma lacuna" significa "nenhuma lacuna NO QUE EU VEJO" — e o retorno diz
// isso com todas as letras, senão vira o pior farol possível: o que dá verde por
// não ter olhado.
//
// A recíproca também é tratada: NFTS sem serviço tomado correspondente NÃO é
// erro do cliente — é serviço que o app não capturou. Acusar ali seria mandar
// procurar defeito onde não há.
// ============================================================================

const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const norm = (s) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase();

/** Município de São Paulo — quem emite NFS-e paulistana. */
export const IBGE_SAO_PAULO = '3550308';

/**
 * O serviço tomado EXIGE NFTS?
 *
 * Três respostas, e a terceira é a que impede o falso verde:
 *   'nao-exige'     — o prestador emitiu NFS-e paulistana (o ISS já está nela);
 *   'exige'         — prestador de fora de SP (ou sem inscrição municipal em SP);
 *   'indeterminado' — o documento não permite dizer. NUNCA vira 'nao-exige'.
 *
 * @param {object} servico linha de serviço tomado (ver `linhasServicos`)
 */
export function exigeNfts(servico) {
    const municipio = norm(servico?.municipio);
    const ibge = soDigitos(servico?.codMunIBGE);
    const origem = norm(servico?.origem);

    // NFS-e paulistana capturada: o documento É a prova de que não cabe NFTS.
    if (ibge === IBGE_SAO_PAULO || municipio === 'sao paulo') {
        return { veredito: 'nao-exige', motivo: 'prestador em São Paulo — emite NFS-e paulistana' };
    }
    if (origem === 'nfse-sp' || origem === 'portal-sp') {
        return { veredito: 'nao-exige', motivo: 'nota do portal da PMSP — NFS-e paulistana' };
    }

    // Município conhecido e diferente de SP ⇒ o prestador não emite NFS-e
    // paulistana, então o tomador é quem declara.
    if (ibge || municipio) {
        return {
            veredito: 'exige',
            motivo: `prestador em ${servico?.municipio || `IBGE ${ibge}`} — não emite NFS-e paulistana`,
        };
    }

    return {
        veredito: 'indeterminado',
        motivo: 'município do prestador não consta no documento — não dá pra dizer se cabe NFTS',
    };
}

/**
 * Casa serviço tomado com NFTS emitida.
 *
 * NÃO HÁ CHAVE ligando os dois (a NFTS não referencia a nota do prestador), então
 * o casamento é por CNPJ/CPF do prestador dentro da competência. Valor entra só
 * como desempate quando o mesmo prestador tem várias — casar por valor sozinho
 * produziria par falso, e par falso aqui esconde uma obrigação faltando.
 */
export function cruzarServicosComNfts(servicosTomados = [], nfts = []) {
    const disponiveis = nfts
        .filter((n) => !n?.cancelada)
        .map((n) => ({ ...n, _doc: soDigitos(n?.docPrestador), _usada: false }));

    const cobertos = [];
    const semNfts = [];
    const indeterminados = [];

    for (const s of servicosTomados) {
        const { veredito, motivo } = exigeNfts(s);
        const docPrestador = soDigitos(s?.doc);
        const valor = num(s?.base);

        if (veredito === 'indeterminado') {
            indeterminados.push({ ...s, motivo });
            continue;
        }
        if (veredito === 'nao-exige') {
            cobertos.push({ ...s, motivo });
            continue;
        }

        const candidatas = disponiveis.filter((n) => !n._usada && n._doc && n._doc === docPrestador);
        // Mesmo prestador com mais de uma NFTS: o valor desempata.
        const par = candidatas.length > 1
            ? (candidatas.find((n) => Math.abs(num(n.valorServicos) - valor) < 0.01) || candidatas[0])
            : candidatas[0];

        if (par) {
            par._usada = true;
            cobertos.push({ ...s, motivo: `NFTS ${par.numero} emitida`, nftsNumero: par.numero });
        } else {
            semNfts.push({ ...s, motivo, issRetidoNaoDeclarado: num(s?.issRetido) });
        }
    }

    // NFTS sem serviço correspondente: NÃO é erro do cliente — é serviço que o
    // app não capturou. Sai nomeada pra ninguém sair procurando defeito.
    const nftsSemServico = disponiveis.filter((n) => !n._usada)
        .map(({ _doc, _usada, ...n }) => n);

    const totalSemNfts = semNfts.reduce((a, s) => a + num(s.base), 0);
    const issNaoDeclarado = semNfts.reduce((a, s) => a + num(s.issRetido), 0);

    return {
        cobertos,
        semNfts,
        indeterminados,
        nftsSemServico,
        resumo: {
            servicosTomados: servicosTomados.length,
            nftsEmitidas: nfts.length,
            comLacuna: semNfts.length,
            indeterminados: indeterminados.length,
            totalSemNfts: Number(totalSemNfts.toFixed(2)),
            issRetidoNaoDeclarado: Number(issNaoDeclarado.toFixed(2)),
        },
        // ⚠️ A frase que impede o falso verde. Ela NÃO é opcional: sai sempre,
        // inclusive (e principalmente) quando não há lacuna nenhuma.
        cobertura: 'PARCIAL — o CFI só enxerga o serviço tomado que chegou por NFS-e Nacional (ADN), '
            + 'importação manual ou PDF. Prestador de outro município emite no portal dele, que não é '
            + 'distribuído. Nenhuma lacuna encontrada significa "nenhuma no que eu vejo", nunca conformidade.',
        semLacunaMasParcial: semNfts.length === 0,
    };
}
