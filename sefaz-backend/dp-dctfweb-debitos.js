// ============================================================================
// sefaz-backend/dp-dctfweb-debitos.js
// Monta a resposta de POST /api/dp-integration/dctfweb/debitos (consumida pela
// conferência pós-folha do Consultor DP) a partir do que consultarXmlDeclaracao
// devolveu. Função pura: a rota só chama o provider e repassa.
//
// Regras:
//  - débitos = extrairDebitosDctfweb (o mesmo das guias separadas): todo
//    CreditoTributarioApurado com saldo a pagar > 0, por código de receita;
//  - a identificação vem do PRÓPRIO XML (inscContrib/perApuracao) e é conferida
//    contra o pedido: declaração de outra empresa ou competência volta ok=false,
//    porque número de outra declaração não pode chegar ao DP como se fosse desta;
//  - sem XML, XML ilegível ou XML sem identificação volta ok=false com o
//    motivo — nunca lista vazia como se não houvesse débito;
//  - `fonte` (serpro | mock) vai junto: o DP recusa número de mock.
// ============================================================================

import { extrairDebitosDctfweb, identificacaoDeclaracao, conferirIdentificacao } from './dctfweb-retencao-normalizer.js';

export function montarRespostaDebitosDctfweb(consulta, { cnpj, competencia }) {
    const fonte = consulta?.fonte || null;
    const xml = consulta?.xml || '';
    if (!xml) {
        return { ok: false, fonte, erro: 'O SERPRO não devolveu o XML da declaração (DCTFWeb não transmitida ou sem declaração na competência).', debitos: [] };
    }
    const identificacao = identificacaoDeclaracao(xml);
    const conferencia = conferirIdentificacao(identificacao, { cnpj, competencia });
    // Declaração real sempre traz inscContrib e perApuracao. Sem eles não dá
    // para provar de quem é o XML — e lista vazia viraria "sem débito".
    if (!identificacao.cnpj || !identificacao.competencia) {
        return { ok: false, fonte, identificacao, erro: 'O XML devolvido não identifica a declaração (sem CNPJ ou competência); os débitos não foram lidos.', debitos: [] };
    }
    if (conferencia.problemas.length) {
        return { ok: false, fonte, identificacao, erro: `Declaração não confere com o pedido: ${conferencia.problemas.join('; ')}.`, debitos: [] };
    }
    const ext = extrairDebitosDctfweb(xml);
    if (!ext.lido) return { ok: false, fonte, identificacao, erro: ext.motivo, debitos: [] };
    return { ok: true, fonte, identificacao, debitos: ext.debitos };
}
