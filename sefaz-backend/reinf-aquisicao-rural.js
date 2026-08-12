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
//
// ═══ A RÉGUA DE QUEM É PRODUTOR PF NÃO MORA AQUI ════════════════════════════
//
// Caso VINCENZO GUERRA 07/2026 (Paulo, 12/08): *"ta puxando aqui os valores de
// FUNRURAL certinho, mas quando vou CCI ele, fala que não tem"*. A aba 🌾
// apurava R$ 308,07 de 4 notas de ANTONIO DIAS DA SILVA e esta casca respondia
// "NENHUMA aquisição encontrada" — porque o doc dele tem 14 dígitos e a linha
// era `if (doc.length !== 11) { dePessoaJuridica += 1; continue; }`.
//
// DUAS RÉGUAS PRO MESMO FATO, que é o defeito que esta casa mais combate. A do
// 🌾 (`identificarNaturezaFornecedor`) honra o cadastro `produtores_rurais` e a
// IE paulista de produtor ("P"), e o **CNPJ NÃO descaracteriza produtor rural
// PF** (Comunicado CAT 45/2008 — já escrito na regra da casa). A daqui contava
// dígitos. Quem apura é o 🌾; **esta casca não julga natureza** — se a nota
// entrou no FUNRURAL, a sub-rogação já foi decidida lá, e reagrupar é tudo o
// que se faz aqui.
//
// O que sobra desta casca é NOMEAR a forma da inscrição: o R-2055 identifica o
// produtor por inscrição (tpInscProd/nrInscProd) e o app NÃO sabe qual tipo
// carimbar num produtor com CNPJ. Então o produtor VIAJA, com `tipoInscricao`
// dizendo a verdade e `cpfProdutor` NULO quando não é CPF — número de CNPJ num
// campo chamado "cpf" é a mentira do `csllOuTotal` outra vez. Quem recebe
// bloqueia com a causa na mão; ninguém deduz o tipo.
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
    const semInscricao = [];

    for (const n of notas) {
        const doc = soDigitos(n?.doc);
        // Doc que não é nem CPF nem CNPJ não identifica ninguém — não dá pra
        // declarar. Mas NÃO some: vira lista nomeada (some é o que faz alguém
        // achar que declarou tudo).
        if (doc.length !== 11 && doc.length !== 14) {
            semInscricao.push({ fornecedor: texto(n?.fornecedor) || '—', doc: doc || null, numero: texto(n?.numero) || null });
            continue;
        }

        const cad = produtores[doc] || {};
        // O CPF DO TITULAR destrava o produtor inscrito por CNPJ.
        //
        // O `ideProdutor` do R-2055 identifica a PESSOA, e a única forma provada
        // contra evento aceito é tpInscProd=2 (CPF). O produtor rural PF pode
        // estar inscrito por CNPJ (Com. CAT 45/2008), e a NOTA traz o CNPJ —
        // quem sabe o CPF é o CADESP, e ele entra no cadastro do produtor.
        //
        // Não é dedução: é dado digitado por alguém, e viaja CARIMBADO
        // (`origemDoCpf`) pra o outro lado saber que ele não veio da nota.
        const cpfTitular = soDigitos(cad.cpfTitular);
        const cpfDoCadastro = doc.length === 14 && cpfTitular.length === 11 ? cpfTitular : null;
        const acc = porProdutor.get(doc) || {
            docProdutor: doc,
            // FORMA da inscrição — e o nome do campo não mente: CNPJ nunca sai
            // num campo chamado "cpf". Quem recebe decide o tpInscProd; o app
            // não deduz.
            tipoInscricao: doc.length === 11 || cpfDoCadastro ? 'cpf' : 'cnpj',
            cpfProdutor: doc.length === 11 ? doc : cpfDoCadastro,
            origemDoCpf: doc.length === 11 ? 'nota' : (cpfDoCadastro ? 'cadastro-do-produtor' : null),
            inscricaoAtipica: doc.length === 14,
            nome: texto(n?.fornecedor) || null,
            uf: texto(n?.uf) || null,
            ie: texto(n?.ie) || null,
            // A PROVA de que ele é produtor rural PF, carimbada com a origem —
            // é a régua do 🌾 que decidiu, e ela viaja junto do número pra o
            // outro lado não precisar (nem poder) reinventá-la.
            provaDeProdutorPF: {
                confianca: texto(n?.naturezaConfianca) || null,
                motivo: texto(n?.naturezaMotivo) || null,
            },
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
        // Fora da conta, mas NOMEADOS — não é contador mudo.
        semInscricao,
        resumo: {
            produtores: produtoresLista.length,
            aquisicoes: produtoresLista.reduce((t, p) => t + p.aquisicoes.length, 0),
            comCnpj: produtoresLista.filter((p) => p.tipoInscricao === 'cnpj').length,
            semInscricao: semInscricao.length,
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
            semInscricao,
            revisarAliquotas: funrural?.revisarAliquotas === true,
        }),
    };
}

function ressalvasDoPayload({ produtores, semInscricao, revisarAliquotas }) {
    const out = [
        'O `indAquis` (indicador/natureza da aquisição) vai NULO: ele vem de tabela oficial da '
        + 'EFD-Reinf que não existe neste app, e código de declaração não se inventa. O que decide '
        + 'esse indicador — se o produtor é SEGURADO ESPECIAL — viaja no campo `seguradoEspecial`.',
        'Os valores vêm PRONTOS da apuração do FUNRURAL do CFI (vigência de alíquota da LC 224/2025, '
        + 'tabela própria de segurado especial, centavos desprezados pela IN RFB 971). NÃO recalcule '
        + 'do outro lado: dois números para o mesmo fato é o pior defeito de um arquivo fiscal.',
    ];
    const comCnpj = produtores.filter((p) => p.tipoInscricao === 'cnpj');
    if (comCnpj.length) {
        out.push(`${comCnpj.length} produtor(es) com CNPJ: ${comCnpj.map((p) => `${p.nome} (${p.docProdutor})`).join(', ')}. `
            + 'O FUNRURAL DELES JÁ FOI APURADO pelo CFI (a natureza saiu do cadastro do produtor ou da IE '
            + 'paulista de produtor rural, que começa com "P") — CNPJ não descaracteriza produtor rural PF, '
            + 'Comunicado CAT 45/2008. O que falta é o CPF: o `ideProdutor` do R-2055 identifica a PESSOA, e a '
            + 'única forma provada contra evento aceito é tpInscProd=2 (CPF). COMO RESOLVER: consulte o CPF do '
            + 'titular no CADESP e grave em "CPF do titular" no cadastro do produtor (aba 🌾) — daí ele passa a '
            + 'viajar carimbado como `origemDoCpf: cadastro-do-produtor`. NÃO descarte a aquisição: o valor está '
            + 'na guia do cliente.');
    }
    const cpfDoCadastro = produtores.filter((p) => p.origemDoCpf === 'cadastro-do-produtor');
    if (cpfDoCadastro.length) {
        // Carimbo obrigatório: quem declara precisa saber que o CPF NÃO veio do
        // documento — veio de alguém que olhou o CADESP, e está gravado quem foi.
        out.push(`${cpfDoCadastro.length} produtor(es) declaram com CPF vindo do CADASTRO, não da nota `
            + `(${cpfDoCadastro.map((p) => `${p.nome}: CNPJ ${p.docProdutor} → CPF ${p.cpfProdutor}`).join('; ')}). `
            + 'A nota traz o CNPJ do estabelecimento rural; o CPF do titular foi confirmado no CADESP e gravado '
            + 'no cadastro do produtor. Confira antes de transmitir — declarar em nome da pessoa errada não se desfaz.');
    }
    if (semInscricao?.length) {
        out.push(`${semInscricao.length} aquisição(ões) sem CPF/CNPJ legível do produtor `
            + `(${semInscricao.map((s) => s.fornecedor).join(', ')}) — sem inscrição o evento não identifica `
            + 'o produtor. Confira o documento na origem (lista completa em `semInscricao`).');
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
