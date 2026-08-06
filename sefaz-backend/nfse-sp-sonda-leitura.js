// ============================================================================
// sefaz-backend/nfse-sp-sonda-leitura.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Lê o resultado da sonda do 1102 e diz O QUE ELE PROVA.
//
// Com o contrato do WSDL conferido (06/08), o envelope está descartado: os
// parâmetros e a SOAPAction batem. Sobram duas explicações OPOSTAS pro
// "Mensagem XML de Pedido do serviço sem conteúdo":
//
//   (A) TRANSPORTE — o conteúdo não chega (CDATA/encoding/escape). O serviço vê
//       string vazia e diz "sem conteúdo" literalmente.
//   (B) CONTEÚDO — chega e é RECUSADO (root do Pedido, schema, assinatura), e o
//       1102 é a mensagem genérica pra "não achei o Pedido aqui dentro".
//
// A prova está na COMPARAÇÃO de códigos entre variantes conhecidas — não em
// chutar leiaute de fisco. Esta função não sabe nada do leiaute: ela só compara.
// ============================================================================

const cod = (r) => (r && r.codigo != null ? String(r.codigo) : null);
const acha = (rs, nome) => (rs || []).find((r) => r.variante === nome) || null;

/**
 * @param {Array} resultados saída de sondar1102
 */
export function interpretarSonda(resultados) {
    const rs = resultados || [];
    const vazio = acha(rs, 'vazio');
    const rootRuim = acha(rs, 'root-desconhecido');
    const semAss = acha(rs, 'pedido-sem-assinatura');
    const escapado = acha(rs, 'pedido-assinado-escapado');
    const controle = acha(rs, 'pedido-assinado-cdata');

    const linhas = rs.map((r) => `${r.variante}: ${r.erro ? `falhou (${r.erro})` : `${cod(r) || 'sem código'} — ${r.descricao || 'sem descrição'}`}`);

    // Alguma variante PASSOU: acabou a investigação, o caminho é aquele.
    const passou = rs.find((r) => !r.erro && !cod(r));
    if (passou) {
        return {
            conclusivo: true,
            causa: 'variante-funciona',
            veredicto: `A variante "${passou.variante}" NÃO foi recusada — é esse o formato que o serviço aceita.`,
            acao: `Trocar o envio de hoje pelo formato da variante "${passou.variante}".`,
            linhas,
        };
    }

    if (!vazio || !rootRuim || vazio.erro || rootRuim.erro) {
        return {
            conclusivo: false,
            causa: null,
            veredicto: 'As variantes de referência (vazio e root desconhecido) não responderam — sem elas não dá pra concluir nada.',
            acao: 'Rode a sonda de novo; se persistir, o problema é de conexão, não de conteúdo.',
            linhas,
        };
    }

    const cVazio = cod(vazio);
    const cRoot = cod(rootRuim);
    const cControle = cod(controle);

    // Vazio e root inventado dão o MESMO código ⇒ 1102 é genérico: o serviço
    // usa a mesma mensagem pra "vazio" e pra "não reconheci". Então o nosso
    // conteúdo pode estar chegando e sendo recusado.
    if (cVazio && cRoot && cVazio === cRoot) {
        const assinaturaMuda = semAss && cod(semAss) !== cControle;
        return {
            conclusivo: true,
            causa: 'conteudo',
            veredicto: `O código ${cVazio} é GENÉRICO: o serviço responde a mesma coisa pra mensagem vazia e pra XML de root desconhecido. `
                + 'Logo, "sem conteúdo" não prova que o conteúdo não chegou — ele está sendo RECUSADO.'
                + (assinaturaMuda ? ' E a variante sem assinatura respondeu DIFERENTE: a assinatura entra na conta.' : ''),
            acao: 'A causa é o formato do Pedido (root/schema/assinatura), não o envelope. '
                + 'Isso precisa do manual do WS — o leiaute do Pedido não se deduz por tentativa.',
            linhas,
        };
    }

    // Códigos DIFERENTES ⇒ o serviço distingue vazio de conteúdo. Se o nosso
    // envio dá o mesmo código do VAZIO, o conteúdo não está chegando.
    if (cControle && cVazio && cControle === cVazio) {
        const escapadoDiferente = escapado && cod(escapado) !== cVazio;
        return {
            conclusivo: true,
            causa: 'transporte',
            veredicto: `O serviço DISTINGUE vazio (${cVazio}) de root desconhecido (${cRoot}) — e o nosso envio dá o mesmo código do VAZIO. `
                + 'O conteúdo do MensagemXML não está chegando.'
                + (escapadoDiferente ? ` Com entidades no lugar do CDATA o código muda (${cod(escapado)}): é o CDATA.` : ''),
            acao: escapadoDiferente
                ? 'Trocar o CDATA por escape de entidades no envelope.'
                : 'O conteúdo se perde no transporte — investigar encoding/serialização do MensagemXML.',
            linhas,
        };
    }

    return {
        conclusivo: true,
        causa: 'conteudo',
        veredicto: `O serviço distingue vazio (${cVazio}) de root desconhecido (${cRoot}), e o nosso envio responde ${cControle || 'sem código'} — `
            + 'ou seja, o conteúdo CHEGA e é recusado pelo que ele é.',
        acao: 'A causa é o formato do Pedido. Confirmar o leiaute no manual do WS antes de mexer.',
        linhas,
    };
}
