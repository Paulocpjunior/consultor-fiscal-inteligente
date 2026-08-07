// ============================================================================
// sefaz-backend/reinf-aquisicao-rural.js  (PURO — testável)
// ----------------------------------------------------------------------------
// AS AQUISIÇÕES DE PRODUÇÃO RURAL no formato que o EFD-Reinf consome para o
// R-2055 — o FUNRURAL que o CLIENTE recolhe por SUB-ROGAÇÃO.
//
// POR QUE ESTA CASCA EXISTE
//
// O R-2055 é o único evento da série R-2000 com o cálculo JÁ PRONTO e
// conferido: a aba 🌾 do CFI apura o FUNRURAL desde 31/07, com vigência de
// alíquota (1,5% até 31/03/2026 e 1,63% a partir de 01/04/2026 pela LC
// 224/2025), tabela própria de segurado especial, centavo desprezado (IN RFB
// 971) e conferência contra o FUNRURAL declarado no infAdic da própria nota.
//
// Refazer essa conta do outro lado seria abrir a porta pro pior defeito
// possível num arquivo fiscal: dois números diferentes pro mesmo fato, sem
// ninguém ver qual está certo. A integração é LER — nunca redigitar, nunca
// recalcular.
//
// ═══ O QUE MUDA DA ABA 🌾 PRA CÁ: O EIXO ════════════════════════════════════
//
// A aba 🌾 responde por NOTA (é assim que se confere contra o documento) e por
// MUNICÍPIO (é assim que a DIPAM é declarada). O R-2055 é declarado por
// PRODUTOR: um bloco por pessoa de quem se comprou, com as aquisições do mês
// somadas. É só isso que esta casca faz — reagrupar, sem recalcular nada.
//
// ═══ O QUE ESTA CASCA SE RECUSA A INVENTAR ══════════════════════════════════
//
// O R-2055 exige um indicador de aquisição (a natureza da compra) que vem de
// tabela oficial da EFD-Reinf, e essa tabela NÃO está neste app. O campo vai
// **nulo**, com a informação que o CFI TEM e que é o que decide o indicador:
// se o produtor é SEGURADO ESPECIAL. Preencher um código de tabela que não
// temos seria a repetição do erro que o `csllOuTotal` evitou do outro lado —
// e num campo de declaração o pior caso não é ser recusado, é ser ACEITO
// errado.
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v) => String(v ?? '').trim();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Uma nota de FUNRURAL da aba 🌾 → uma aquisição.
 *
 * Os valores vêm PRONTOS do núcleo da DIPAM. Aqui não se multiplica alíquota
 * por base: se aparecer conta neste arquivo, é bug.
 */
export function normalizarAquisicao(n) {
    return {
        chave: texto(n?.chave) || null,
        numero: texto(n?.numero) || null,
        data: texto(n?.dhEmi) || null,
        base: r2(n?.base),
        // A quebra do FUNRURAL, com os nomes do CÁLCULO (não os do leiaute):
        // as tags do R-2055 não estão provadas, e nome que finge ser do leiaute
        // faria o outro lado escrever no campo errado achando que conferiu.
        inss: r2(n?.inss),
        gilrat: r2(n?.gilrat),
        senar: r2(n?.senar),
        total: r2(n?.total),
        aliquotas: n?.aliquotas || null,
        // Divergência entre o que o app calculou e o que a NOTA declarou no
        // infAdic. Não é detalhe: é o cliente e o app discordando sobre quanto
        // foi retido, e isso precisa chegar do outro lado.
        declaradoNaNota: n?.declarado ?? null,
        divergencia: n?.divergencia ?? null,
    };
}

/**
 * Payload do R-2055 para UMA empresa (o ADQUIRENTE) numa competência.
 *
 * @param {object} p
 * @param {string} p.cnpjAdquirente  quem compra — é ele quem declara
 * @param {string} p.competencia     'AAAA-MM'
 * @param {object} p.funrural        o bloco `funrural` de montarDipamCompetencia
 * @param {object} [p.produtores]    cadastro por doc: { [cpf]: { seguradoEspecial, ... } }
 */
export function montarPayloadR2055({ cnpjAdquirente, competencia, funrural, produtores = {} } = {}) {
    const alvo = soDigitos(cnpjAdquirente);
    const notas = Array.isArray(funrural?.notas) ? funrural.notas : [];

    const porProdutor = new Map();
    let dePessoaJuridica = 0;

    for (const n of notas) {
        const doc = soDigitos(n?.doc);
        // PJ não entra: sem sub-rogação, quem recolhe é o próprio emitente, e
        // a comercialização dele é R-2050 — outro evento. Some da lista é o que
        // faz alguém achar que declarou tudo, então vira contagem.
        if (doc.length !== 11) { dePessoaJuridica += 1; continue; }

        const cad = produtores[doc] || {};
        const acc = porProdutor.get(doc) || {
            cpfProdutor: doc,
            nome: texto(n?.fornecedor) || null,
            uf: texto(n?.uf) || null,
            // O CFI SABE isto, e é o que decide a natureza da aquisição.
            seguradoEspecial: cad.seguradoEspecial === true,
            // Indicador de aquisição: tabela oficial que não está neste app.
            indAquis: null,
            aquisicoes: [],
            base: 0, inss: 0, gilrat: 0, senar: 0, total: 0,
            comDivergencia: 0,
        };
        const a = normalizarAquisicao(n);
        acc.aquisicoes.push(a);
        acc.base = r2(acc.base + a.base);
        acc.inss = r2(acc.inss + a.inss);
        acc.gilrat = r2(acc.gilrat + a.gilrat);
        acc.senar = r2(acc.senar + a.senar);
        acc.total = r2(acc.total + a.total);
        if (a.divergencia) acc.comDivergencia += 1;
        porProdutor.set(doc, acc);
    }

    const produtoresLista = [...porProdutor.values()]
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    return {
        cnpjAdquirente: alvo || null,
        competencia: competencia || null,
        produtores: produtoresLista,
        resumo: {
            produtores: produtoresLista.length,
            aquisicoes: produtoresLista.reduce((t, p) => t + p.aquisicoes.length, 0),
            dePessoaJuridica,
            comDivergencia: produtoresLista.filter((p) => p.comDivergencia > 0).length,
            seguradoEspecial: produtoresLista.filter((p) => p.seguradoEspecial).length,
            base: r2(produtoresLista.reduce((t, p) => t + p.base, 0)),
            inss: r2(produtoresLista.reduce((t, p) => t + p.inss, 0)),
            gilrat: r2(produtoresLista.reduce((t, p) => t + p.gilrat, 0)),
            senar: r2(produtoresLista.reduce((t, p) => t + p.senar, 0)),
            total: r2(produtoresLista.reduce((t, p) => t + p.total, 0)),
        },
        ressalvas: ressalvasDoPayload({
            produtores: produtoresLista,
            dePessoaJuridica,
            revisarAliquotas: funrural?.revisarAliquotas === true,
        }),
    };
}

function ressalvasDoPayload({ produtores, dePessoaJuridica, revisarAliquotas }) {
    const out = [
        'O `indAquis` (indicador/natureza da aquisição) vai NULO: ele vem de tabela oficial da '
        + 'EFD-Reinf que não existe neste app, e código de declaração não se inventa. O que decide '
        + 'esse indicador — se o produtor é SEGURADO ESPECIAL — viaja no campo `seguradoEspecial`.',
        'Os valores vêm PRONTOS da apuração do FUNRURAL do CFI (vigência de alíquota da LC 224/2025, '
        + 'tabela própria de segurado especial, centavos desprezados pela IN RFB 971). NÃO recalcule '
        + 'do outro lado: dois números para o mesmo fato é o pior defeito de um arquivo fiscal.',
    ];
    if (dePessoaJuridica) {
        out.push(`${dePessoaJuridica} aquisição(ões) de produtor PESSOA JURÍDICA ficaram de fora — sem `
            + 'sub-rogação, quem recolhe é o próprio emitente, e a comercialização dele é R-2050.');
    }
    const divergentes = produtores.filter((p) => p.comDivergencia > 0).length;
    if (divergentes) {
        out.push(`${divergentes} produtor(es) com DIVERGÊNCIA entre o FUNRURAL calculado e o declarado no `
            + 'infAdic da própria nota. O cliente e o app discordam sobre quanto foi retido — confira '
            + 'antes de declarar.');
    }
    if (revisarAliquotas) {
        out.push('A competência cai numa faixa de alíquota que pede conferência — veja o aviso da aba 🌾.');
    }
    if (!produtores.length) {
        // Zero nunca é sucesso: pode ser mês sem compra OU captura faltando.
        out.push('NENHUMA aquisição de produtor rural PF nesta competência. Se o cliente compra de produtor, '
            + 'o problema é de CAPTURA — não é ausência de obrigação. A marcação `condicaoRural` no cadastro '
            + 'existe justamente para o mês vazio não passar despercebido.');
    }
    return out;
}
