// ============================================================================
// sefaz-backend/aptidao-saida.js  (PURO — testável)
// ----------------------------------------------------------------------------
// "O CLIENTE FEZ CERTO?" — prova de que a saída mod 55 está configurada.
//
// Paulo, 04/08: "como assegurar que o cliente fez correto, como podemos
// confirmar se o cadastro já está apto conforme ele informa".
//
// O QUE A COBERTURA DE SAÍDA NÃO RESPONDIA: ela olha os últimos N dias. Isso
// confunde TRÊS situações diferentes:
//
//   configurou e vendeu           → aparecia verde   ✅ certo
//   configurou e NÃO vendeu no mês → aparecia vermelho ❌ INJUSTO
//   não configurou                 → aparecia vermelho ✅ certo
//
// Cobrar quem já fez queima a relação; e o inverso deixa o buraco aberto.
//
// A CHAVE: APTIDÃO ≠ ATIVIDADE.
//   • APTIDÃO é permanente e se prova com UMA nota, de qualquer data. O
//     cliente pode ficar um mês sem vender que continua apto.
//   • ATIVIDADE é recente e diz se está chegando nota AGORA.
//
// A PROVA MAIS FORTE está escrita na própria nota: o CNPJ do escritório no
// bloco <autXML>. Sem ele a SEFAZ não entrega saída ao emissor (Rejeição 641)
// — então a nota ter chegado por trilho automático já É a prova. O campo
// `autXmlEscritorio` (gravado na captura desde 04/08) torna isso literal,
// e a origem do documento cobre o histórico anterior.
// ============================================================================

const DIA_MS = 24 * 3600 * 1000;

const so = (v) => String(v || '').replace(/\D/g, '');
const tsMs = (v) => {
    if (!v) return null;
    const ms = typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
};

/**
 * A nota PROVA que o cliente configurou algum trilho? Devolve qual, ou null.
 *
 * 'autxml' → o CNPJ do escritório está no <autXML> (prova literal) OU a nota
 *            de SAÍDA chegou pela SEFAZ, o que só acontece com autXML.
 * 'cofre'  → chegou por e-mail (origem 'email').
 */
export function provaDoDocumento(doc, cnpjEscritorio) {
    if (!doc) return null;
    const origem = String(doc.origem || '').toLowerCase();
    const fonte = String(doc.capturadoPor?.fonte || doc.fonte || '').toLowerCase();

    if (origem === 'email') return 'cofre';

    // Marca literal gravada na captura — não depende de inferência.
    if (doc.autXmlEscritorio === true) return 'autxml';
    if (Array.isArray(doc.autXml) && doc.autXml.map(so).includes(so(cnpjEscritorio))) return 'autxml';

    // Importação manual/conferência não prova configuração nenhuma: o XML
    // veio pela mão do colaborador, não pelo trilho do cliente.
    if (/conferencia|consulta-chave|manual|agent|importac/.test(fonte)) return null;
    if (origem === 'manual' || origem === 'sharepoint_auto') return null;

    // Saída que chegou pela SEFAZ só existe com autXML (Rejeição 641).
    if (origem === 'sefaz' || origem === 'autxml') return 'autxml';
    return null;
}

/**
 * Classifica UMA empresa.
 *
 * @returns {{status:string, rotulo:string, apto:boolean, trilhos:string[],
 *            provaChave:string|null, provaData:string|null, provaTipo:string|null,
 *            ultimaEntradaMs:number|null, diasSemReceber:number|null,
 *            acao:string}}
 *
 * status:
 *   'apto-ativo'      apto E recebendo (o normal de quem está migrado)
 *   'apto-sem-fluxo'  apto, mas sem nota nova na janela — pode ser só o
 *                     cliente sem vender. NÃO é pendência de configuração.
 *   'apto-parou'      apto e parou de chegar por muito tempo: virou suspeita
 *                     de regressão (trocou de emissor, tirou a autorização)
 *   'sem-prova'       tem saída no histórico e NUNCA chegou por trilho
 *                     automático — este é o que a equipe precisa cobrar
 *   'sem-saida-55'    a empresa não emite mod 55: não há o que configurar
 */
export function classificarAptidaoEmpresa({
    empresa, docsDaEmpresa, agoraMs, cnpjEscritorio,
    janelaAtivaDias = 30, limiteParouDias = 90,
}) {
    const docs = docsDaEmpresa || [];
    const base = {
        empresaId: empresa?.empresaId || null,
        cnpj: so(empresa?.cnpj),
        nome: empresa?.nome || '—',
        trilhos: [],
        provaChave: null,
        provaData: null,
        provaTipo: null,
        ultimaEntradaMs: null,
        diasSemReceber: null,
    };

    if (docs.length === 0) {
        return {
            ...base,
            status: 'sem-saida-55',
            rotulo: 'Não emite NF-e de saída',
            apto: false,
            acao: 'Nada a configurar enquanto a empresa não emitir mod 55.',
        };
    }

    const trilhos = new Set();
    let primeira = null;     // a PROVA: a mais antiga serve, e é a mais convincente
    let ultimaMs = null;

    for (const d of docs) {
        const prova = provaDoDocumento(d, cnpjEscritorio);
        if (!prova) continue;
        trilhos.add(prova);
        const ms = tsMs(d.dhEmi) ?? tsMs(d.createdAt);
        if (ms != null && (ultimaMs == null || ms > ultimaMs)) ultimaMs = ms;
        if (!primeira || (ms != null && tsMs(primeira.dhEmi) != null && ms < tsMs(primeira.dhEmi))) {
            primeira = { ...d, _prova: prova };
        }
    }

    if (trilhos.size === 0) {
        return {
            ...base,
            status: 'sem-prova',
            rotulo: 'Sem prova de configuração',
            apto: false,
            acao: 'Nenhuma nota de saída chegou por trilho automático. Envie as instruções: '
                + 'incluir o CNPJ do escritório no autXML da nota OU apontar o emissor para o '
                + 'cofre de e-mail. Uma única nota já comprova.',
        };
    }

    const dias = ultimaMs == null ? null : Math.floor((agoraMs - ultimaMs) / DIA_MS);
    const comum = {
        ...base,
        apto: true,
        trilhos: Array.from(trilhos).sort(),
        provaChave: primeira?.chave || null,
        provaData: primeira?.dhEmi || null,
        provaTipo: primeira?._prova || null,
        ultimaEntradaMs: ultimaMs,
        diasSemReceber: dias,
    };

    if (dias != null && dias <= janelaAtivaDias) {
        return {
            ...comum,
            status: 'apto-ativo',
            rotulo: 'Configurado e recebendo',
            acao: 'Nada a fazer.',
        };
    }

    if (dias != null && dias > limiteParouDias) {
        return {
            ...comum,
            status: 'apto-parou',
            rotulo: `Configurado, mas sem nota há ${dias} dias`,
            // Farol honesto: aqui a suspeita é REGRESSÃO, não falta de
            // configuração — e a ação é diferente (confirmar, não instruir).
            acao: `A configuração está comprovada (nota ${primeira?.chave || '—'}), mas nada chega há `
                + `${dias} dias. Confirme com o cliente se ele trocou de emissor ou se apenas parou `
                + 'de vender — não reenvie as instruções antes disso.',
        };
    }

    return {
        ...comum,
        status: 'apto-sem-fluxo',
        rotulo: 'Configurado · sem nota nova na janela',
        acao: 'Configuração comprovada. A ausência de nota nova provavelmente é o cliente sem vender '
            + '— NÃO é pendência de cadastro.',
    };
}

/** Ordem de trabalho: primeiro quem precisa de ação de verdade. */
const PESO = {
    'sem-prova': 0, 'apto-parou': 1, 'apto-sem-fluxo': 2, 'apto-ativo': 3, 'sem-saida-55': 4,
};

/**
 * Painel completo.
 *
 * @param {{empresas:Array, docsSaida:Array, agoraMs:number, cnpjEscritorio:string,
 *          janelaAtivaDias?:number, limiteParouDias?:number}} p
 */
export function montarAptidaoSaida({
    empresas, docsSaida, agoraMs, cnpjEscritorio,
    janelaAtivaDias = 30, limiteParouDias = 90,
}) {
    const porCnpj = new Map();
    for (const d of docsSaida || []) {
        const c = so(d.empresaCnpj);
        if (!c) continue;
        if (!porCnpj.has(c)) porCnpj.set(c, []);
        porCnpj.get(c).push(d);
    }

    const linhas = (empresas || []).map((e) => classificarAptidaoEmpresa({
        empresa: e,
        docsDaEmpresa: porCnpj.get(so(e.cnpj)) || [],
        agoraMs,
        cnpjEscritorio,
        janelaAtivaDias,
        limiteParouDias,
    }));

    linhas.sort((a, b) => (PESO[a.status] - PESO[b.status])
        || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    const conta = (s) => linhas.filter((l) => l.status === s).length;
    const aptos = linhas.filter((l) => l.apto).length;
    const comSaida = linhas.filter((l) => l.status !== 'sem-saida-55').length;

    return {
        linhas,
        resumo: {
            total: linhas.length,
            comSaida55: comSaida,
            aptos,
            ativos: conta('apto-ativo'),
            aptosSemFluxo: conta('apto-sem-fluxo'),
            aptosPararam: conta('apto-parou'),
            semProva: conta('sem-prova'),
            semSaida55: conta('sem-saida-55'),
        },
        ressalvas: [
            'APTIDÃO não é o mesmo que ATIVIDADE: uma única nota, de qualquer data, já prova que o '
            + 'cliente configurou. Ele pode ficar meses sem vender e continuar apto.',
            'A prova mais forte é o CNPJ do escritório no <autXML> da nota — sem ele a SEFAZ não '
            + 'entrega saída ao emissor (Rejeição 641).',
            'Importação manual, conferência por chaves e consulta por chave NÃO provam configuração: '
            + 'nesses casos o XML veio pela mão do colaborador, não pelo trilho do cliente.',
            'Só cobre instruções de quem está em "Sem prova de configuração" — quem está apto e sem '
            + 'fluxo não tem pendência nenhuma.',
        ],
    };
}
