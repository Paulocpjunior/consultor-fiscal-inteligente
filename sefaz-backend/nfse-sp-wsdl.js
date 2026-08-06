// ============================================================================
// sefaz-backend/nfse-sp-wsdl.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Lê o CONTRATO do Web Service da Prefeitura (o próprio ?WSDL) e confere contra
// o que o CFI envia.
//
// POR QUE ASSIM: o erro 1102 diz "Mensagem XML de Pedido do serviço sem
// conteúdo" — ou seja, o parâmetro chegou VAZIO ao método. A causa mais comum
// disso num serviço ASMX é nome de parâmetro que não bate: o .NET não acha o
// elemento, deixa a string nula, e o serviço responde "sem conteúdo". Não dá
// pra descobrir isso adivinhando, e layout de fisco não se inventa (mesma regra
// do código de receita da GNRE e do IVA-ST).
//
// A FONTE QUE NÃO MENTE é o WSDL publicado pela própria Prefeitura. O ambiente
// de desenvolvimento não alcança o host (bloqueio de política), mas o Cloud Run
// alcança — ele já conversa com o serviço. Então quem lê o contrato é o app.
// ============================================================================

/**
 * Nomes dos parâmetros que o WSDL declara para uma operação.
 *
 * Num WSDL de ASMX a operação tem um <s:element name="{operacao}"> cujo
 * <s:sequence> lista os parâmetros na ordem. É esse o contrato.
 *
 * @param {string} wsdl  conteúdo do ?WSDL
 * @param {string} operacao  ex.: 'ConsultaNFeEmitidas'
 */
export function extrairContratoWsdl(wsdl, operacao) {
    const xml = String(wsdl || '');
    const nome = String(operacao || '').trim();
    if (!xml || !nome) {
        return { encontrada: false, parametros: [], soapAction: null, motivo: 'WSDL vazio ou operação não informada.' };
    }

    // Um WSDL de ASMX declara os parâmetros de DUAS formas, e as duas são
    // comuns. Tratar só a primeira foi o que fez o leitor dizer "aparece no
    // WSDL, mas sem a sequência de parâmetros" no teste de 06/08:
    //
    //   (a) complexType ANÔNIMO dentro do element da operação
    //       <s:element name="X"><s:complexType><s:sequence>…
    //   (b) complexType NOMEADO, referenciado pelo element
    //       <s:element name="X" type="tns:X"/> … <s:complexType name="X">…
    const bloco = new RegExp(
        `<(?:\\w+:)?element[^>]*\\bname="${nome}"[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?element>`,
    ).exec(xml) || new RegExp(
        `<(?:\\w+:)?complexType[^>]*\\bname="${nome}"[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?complexType>`,
    ).exec(xml);

    if (!bloco) {
        const existe = new RegExp(`\\bname="${nome}"`).test(xml);
        return {
            encontrada: false,
            parametros: [],
            soapAction: extrairSoapAction(xml, nome),
            motivo: existe
                ? `A operação ${nome} aparece no WSDL, mas sem a sequência de parâmetros no formato esperado.`
                : `O WSDL não declara a operação ${nome}.`,
            // Trecho CRU em volta do nome: se o leitor não entendeu a forma do
            // WSDL, o que resolve é ver os bytes — não tentar outro palpite.
            trecho: existe ? trechoEmVolta(xml, nome) : null,
        };
    }

    const parametros = [];
    const re = /<(?:\w+:)?element\b([^>]*)\/?>/g;
    let m;
    while ((m = re.exec(bloco[1])) !== null) {
        const attrs = m[1] || '';
        const n = /\bname="([^"]+)"/.exec(attrs);
        if (!n) continue;
        const t = /\btype="([^"]+)"/.exec(attrs);
        parametros.push({ nome: n[1], tipo: t ? t[1] : null });
    }

    return { encontrada: true, parametros, soapAction: extrairSoapAction(xml, nome), motivo: null };
}

/** Pedaço do WSDL em volta da 1ª menção ao nome — pra ler a forma real. */
export function trechoEmVolta(xml, nome, antes = 200, depois = 900) {
    const i = String(xml || '').indexOf(`name="${nome}"`);
    if (i < 0) return null;
    return String(xml).slice(Math.max(0, i - antes), i + depois);
}

function extrairSoapAction(xml, operacao) {
    const bloco = new RegExp(
        `<(?:\\w+:)?operation[^>]*\\bname="${operacao}"[^>]*>([\\s\\S]{0,800}?)<\\/(?:\\w+:)?operation>`,
    ).exec(String(xml || ''));
    if (!bloco) return null;
    const a = /soapAction="([^"]*)"/.exec(bloco[1]);
    return a ? a[1] : null;
}

/**
 * Confere o que ENVIAMOS contra o que o WSDL DECLARA.
 *
 * Caixa importa: o .NET casa o elemento pelo nome exato. `mensagemXML` e
 * `MensagemXML` são parâmetros diferentes — e o segundo chega nulo, que é
 * exatamente o "sem conteúdo" do 1102.
 */
export function conferirContrato({ enviados, contrato, soapActionEnviada }) {
    const esperados = (contrato?.parametros || []).map((p) => p.nome);
    const mandados = Array.isArray(enviados) ? enviados : [];

    if (!contrato?.encontrada) {
        return {
            ok: false,
            conclusivo: false,
            esperados,
            enviados: mandados,
            faltando: [],
            sobrando: [],
            divergenciaDeCaixa: [],
            motivo: contrato?.motivo || 'Não foi possível ler o contrato do WSDL — sem ele não dá pra concluir nada.',
        };
    }

    const porMinusculo = new Map(esperados.map((e) => [e.toLowerCase(), e]));
    const faltando = esperados.filter((e) => !mandados.includes(e));
    const sobrando = mandados.filter((e) => !esperados.includes(e));
    // Caso mais traiçoeiro: o nome existe, só muda a caixa. O serviço aceita a
    // chamada e devolve o campo vazio — nunca um erro de schema.
    const divergenciaDeCaixa = sobrando
        .filter((s) => porMinusculo.has(s.toLowerCase()))
        .map((s) => ({ enviado: s, esperado: porMinusculo.get(s.toLowerCase()) }));

    const actionEsperada = contrato.soapAction || null;
    const actionDivergente = !!actionEsperada && !!soapActionEnviada && actionEsperada !== soapActionEnviada;

    const problemas = [];
    if (divergenciaDeCaixa.length) {
        problemas.push(
            'nome de parâmetro com CAIXA diferente do contrato ('
            + divergenciaDeCaixa.map((d) => `enviamos "${d.enviado}", o WSDL declara "${d.esperado}"`).join('; ')
            + ') — o serviço aceita a chamada e lê o campo VAZIO, que é exatamente o erro 1102',
        );
    }
    const faltandoDeVerdade = faltando.filter((f) => !divergenciaDeCaixa.some((d) => d.esperado === f));
    if (faltandoDeVerdade.length) problemas.push(`parâmetro(s) que o WSDL exige e não enviamos: ${faltandoDeVerdade.join(', ')}`);
    const sobrandoDeVerdade = sobrando.filter((s) => !divergenciaDeCaixa.some((d) => d.enviado === s));
    if (sobrandoDeVerdade.length) problemas.push(`parâmetro(s) que enviamos e o WSDL não declara: ${sobrandoDeVerdade.join(', ')}`);
    if (actionDivergente) problemas.push(`SOAPAction enviada "${soapActionEnviada}" ≠ declarada "${actionEsperada}"`);

    return {
        ok: problemas.length === 0,
        conclusivo: true,
        esperados,
        enviados: mandados,
        faltando: faltandoDeVerdade,
        sobrando: sobrandoDeVerdade,
        divergenciaDeCaixa,
        soapActionEsperada: actionEsperada,
        soapActionEnviada: soapActionEnviada || null,
        motivo: problemas.length
            ? `O que enviamos não bate com o contrato: ${problemas.join(' · ')}.`
            : 'Os parâmetros e a SOAPAction batem com o contrato do WSDL — a causa do 1102 é o CONTEÚDO, não o envelope.',
    };
}

/** Nomes dos parâmetros presentes no envelope SOAP que montamos. */
export function parametrosDoEnvelope(soap, operacao) {
    const bloco = new RegExp(
        `<(?:\\w+:)?${operacao}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${operacao}>`,
    ).exec(String(soap || ''));
    if (!bloco) return [];
    // O conteúdo do CDATA é o XML do PEDIDO — as tags de lá não são parâmetros
    // do método. Sem tirar, `<Pedido/>` dentro do CDATA virava "parâmetro que o
    // WSDL não declara" e o diagnóstico apontaria um problema inexistente.
    const corpo = bloco[1].replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const nomes = [];
    const re = /<(?:\w+:)?([A-Za-z_][\w.-]*)\b[^>]*>/g;
    let m;
    while ((m = re.exec(corpo)) !== null) {
        if (!nomes.includes(m[1])) nomes.push(m[1]);
    }
    return nomes;
}
