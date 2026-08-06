// ============================================================================
// sefaz-backend/nfse-sp-ws-leitura.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Lê a resposta do Web Service da Prefeitura de SP e diz DE QUEM é o problema.
//
// ACHADO DE 06/08 (teste do Paulo, CLINICA MANTOAN): o WS respondeu
// **HTTP 200** com `erro 1102 — "Mensagem XML de Pedido do serviço sem
// conteúdo."`. Isso derruba a premissa que estava escrita no app desde 22/07:
// o serviço NÃO está aposentado. Ele atende, autentica o certificado e RECUSA
// o nosso pedido dizendo que o XML chegou vazio — ou seja, o defeito é do lado
// do CFI, não da Prefeitura.
//
// Essa diferença decide o trabalho: "serviço desligado" é esperar a Prefeitura;
// "nosso XML está errado" é consertar aqui. Ficou meses na leitura errada.
// ============================================================================

/** Códigos que a Prefeitura devolve e cuja leitura já está confirmada. */
const CODIGOS = {
    // Confirmado no teste de 06/08 com resposta crua na mão.
    1102: {
        lado: 'cfi',
        motivo: 'O serviço RESPONDEU e recusou o pedido: o XML que enviamos chegou vazio para ele.',
        acao: 'Defeito do nosso lado (montagem/assinatura do XML) — não é serviço fora do ar nem falta de autorização. Não adianta tentar de novo.',
    },
};

const texto = (v) => String(v ?? '').trim();

/**
 * @param {object} r resposta do diagnóstico (crua)
 * @returns {{veredicto:'servico-vivo-recusou'|'servico-vivo-ok'|'nao-chegamos'|'indefinido', lado:'cfi'|'prefeitura'|'ambiente'|null, motivo:string, acao:string|null, codigo:string|null}}
 */
export function interpretarRespostaWs(r) {
    const d = r || {};

    // Nem chegamos lá: TLS, certificado, DNS, timeout. Aqui não dá pra dizer
    // nada sobre o serviço — e afirmar que ele está fora seria chute.
    if (d.falhaAntesDaResposta || d.ok === false) {
        return {
            veredicto: 'nao-chegamos',
            lado: 'ambiente',
            codigo: null,
            motivo: `A chamada nem chegou a ter resposta da Prefeitura: ${texto(d.erro) || 'falha não detalhada'}.`,
            acao: 'É certificado, rede ou endpoint — não diz nada sobre o serviço estar no ar.',
        };
    }

    const http = Number(d.httpStatus);
    const erros = Array.isArray(d.erros) ? d.erros : [];

    if (http === 200 && d.sucesso && erros.length === 0) {
        return {
            veredicto: 'servico-vivo-ok',
            lado: null,
            codigo: null,
            motivo: `O Web Service respondeu e ACEITOU a consulta (${Number(d.totalNFes) || 0} nota(s)).`,
            acao: null,
        };
    }

    if (erros.length > 0) {
        const primeiro = erros[0] || {};
        const codigo = texto(primeiro.codigo) || null;
        const desc = texto(primeiro.descricao) || 'sem descrição';
        const conhecido = codigo ? CODIGOS[Number(codigo)] : null;
        return {
            veredicto: 'servico-vivo-recusou',
            lado: conhecido?.lado || 'prefeitura',
            codigo,
            // A frase que importa: HTTP 200 com erro de NEGÓCIO é serviço VIVO.
            // Foi exatamente isso que ficou lido como "aposentado".
            motivo: conhecido?.motivo
                || `O serviço RESPONDEU (HTTP ${http || '—'}) e recusou o pedido — código ${codigo || '—'}: ${desc}`,
            acao: conhecido?.acao
                || `Recusa de negócio, não indisponibilidade. Trate o código ${codigo || '—'} ("${desc}") antes de concluir que o WS está fora.`,
        };
    }

    return {
        veredicto: 'indefinido',
        lado: null,
        codigo: null,
        motivo: `Resposta sem sucesso e sem erro declarado (HTTP ${http || '—'}).`,
        acao: 'Mande o bloco cru — sem código de erro não dá pra concluir de quem é o problema.',
    };
}

/**
 * O certificado X509 assinado é enorme e polui o bloco que a pessoa cola no
 * chat. Ele é público (vai na assinatura), mas ocupa a tela inteira — cortar
 * mantém o diagnóstico legível sem esconder nada que importe.
 */
export function enxugarParaDiagnostico(xml, max = 1200) {
    const s = String(xml || '')
        .replace(/(<X509Certificate>)[\s\S]*?(<\/X509Certificate>)/g, '$1…certificado omitido…$2')
        .replace(/(<SignatureValue>)[\s\S]*?(<\/SignatureValue>)/g, '$1…assinatura omitida…$2');
    return s.length > max ? `${s.slice(0, max)}…[+${s.length - max} chars]` : s;
}
