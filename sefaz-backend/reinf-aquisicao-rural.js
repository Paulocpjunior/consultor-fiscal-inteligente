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
// Dinheiro em pt-BR: este resumo é lido por gente, e vai por e-mail ao gestor
// no fechamento da competência. "R$ 308.07" num papel de conferência fiscal
// obriga quem lê a decidir se o ponto é decimal ou milhar — e num número de
// contribuição essa dúvida é cara.
const fmtBRL = (n) => r2(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ═══ CÓDIGOS DE RECEITA DO FUNRURAL — PROVADOS CONTRA RECIBO ════════════════
//
// 13/08/2026, VINCENZO GUERRA, PA 07/2026. O R-2055 foi transmitido, o R-2099
// fechou o período (MS7001, recibo 11774083-10-2099-2607-11774083) e o
// "Totalizador das contribuições sociais incidentes sobre a aquisição de
// produção rural" do e-CAC devolveu, por CÓDIGO DE RECEITA:
//
//   1656-01 → R$ 249,48     1646-03 → R$ 20,79     1213-06 → R$ 37,80
//
// A aba 🌾 tinha apurado, sobre base de R$ 18.900,00 (LC 224/2025):
//
//   INSS 1,32% = 249,48     GILRAT 0,11% = 20,79   SENAR 0,20% = 37,80
//
// Os três batem componente a componente, e o total (R$ 308,07) é o mesmo. Isso
// faz DUAS coisas de uma vez:
//
//  1. **Prova o de-para.** As três alíquotas são diferentes entre si, então o
//     casamento é único — não há como confundir qual código é qual. Este
//     de-para não estava escrito em lugar nenhum do projeto, e agora ele vem
//     de um recibo, não de dedução (a régua da casa: arquivo aceito vale mais
//     que leiaute deduzido).
//  2. **Corrobora a apuração.** Dois caminhos independentes — o cálculo do CFI
//     e a totalização da Receita — no mesmo número. Isso é corroboração, não
//     "passei no teste".
//
// CUIDADO: código de receita é da tabela da RFB e pode ganhar variação por
// natureza de aquisição. O que está provado é o caso COMUM (sub-rogação sobre
// aquisição de produtor rural PF). Código novo entra aqui com o recibo do lado.
export const CODIGOS_RECEITA_FUNRURAL = {
    inss: '1656-01',
    gilrat: '1646-03',
    senar: '1213-06',
};

/**
 * O código de receita **sem a máscara** — é assim que o XML do recibo escreve.
 *
 * ═══ O CASO QUE ISTO CORRIGE ════════════════════════════════════════════════
 *
 * O de-para nasceu do RECIBO LIDO POR HUMANO (13/08, VINCENZO), onde a Receita
 * mostra `1656-01`. O XML do mesmo recibo, que chegou em 14/08, escreve o
 * MESMO código **sem hífen**:
 *
 *     <RAquis><CRAquis>165601</CRAquis><vlrCRAquis>249,48</vlrCRAquis></RAquis>
 *     <RAquis><CRAquis>164603</CRAquis><vlrCRAquis>20,79</vlrCRAquis></RAquis>
 *     <RAquis><CRAquis>121306</CRAquis><vlrCRAquis>37,80</vlrCRAquis></RAquis>
 *
 * A comparação só tirava ESPAÇOS. Colando o XML de verdade — que é o caminho
 * que a tela oferece —, os três códigos cairiam em `codigosDesconhecidos` e a
 * conferência sairia **divergente**: o app diria que a Receita não totalizou
 * nada e que totalizou três códigos que ele não conhece, TUDO ao mesmo tempo,
 * com os valores certos dos dois lados.
 *
 * É o pior tipo de alarme falso — o que aparece justamente quando está tudo
 * certo, e ensina a equipe a ignorar a conferência que existe para pegar o erro
 * de verdade.
 *
 * Comparar por DÍGITOS resolve os dois formatos de uma vez, e não afrouxa nada:
 * o código é numérico, a máscara é enfeite de tela.
 */
const soCodigo = (v) => texto(v).replace(/\D/g, '');

/** Rótulo de cada componente para a tela — o código sozinho não diz nada. */
const ROTULO_COMPONENTE = {
    inss: 'Contribuição previdenciária (INSS)',
    gilrat: 'GILRAT/RAT',
    senar: 'SENAR',
};

/**
 * Confere o que o CFI apurou contra o TOTALIZADOR do R-2099.
 *
 * ═══ POR QUE ISTO É O ORÁCULO FINAL ═════════════════════════════════════════
 *
 * "MS7001 — evento recebido com sucesso" prova só que o XML foi ACEITO. Já o
 * totalizador do fechamento é a Receita dizendo **quanto ela entendeu** — e é
 * contra ele que a guia vai ser paga. Um evento pode ser aceito declarando
 * menos do que foi retido (foi exatamente o risco escrito no R-2010), e
 * "sucesso" não denuncia isso.
 *
 * Conferir aqui é o mesmo rito do espelho 🪞 do SPED: dois caminhos
 * independentes no mesmo número, um deles fora do app.
 *
 * TRAVAS:
 *  · **Sem totalizador não existe "conferido".** Não colou o retorno ⇒
 *    `situacao: 'nao-conferido'`, nunca verde por omissão.
 *  · **Código que a Receita totalizou e o app não conhece NÃO é ignorado** —
 *    vira `codigosDesconhecidos`, porque pode ser outra natureza de aquisição
 *    e somar por engano criaria divergência inventada (mesma regra do
 *    `nao-classificado` do IRRF).
 *  · Centavo: a comparação é exata. O FUNRURAL despreza centavos POR NOTA
 *    (IN RFB 971) antes de somar, então o total já sai redondo dos dois lados
 *    — divergência de R$ 0,01 aqui é divergência de verdade, não arredondamento.
 *
 * @param {object} p
 * @param {object} p.apurado      { inss, gilrat, senar } — o bloco `funrural` da aba 🌾
 * @param {Array}  p.totalizador  [{ codigoReceita, valor }] lido do R-2099
 */
export function conferirTotalizadorR2099({ apurado, totalizador } = {}) {
    if (!Array.isArray(totalizador) || !totalizador.length) {
        return {
            situacao: 'nao-conferido',
            linhas: [],
            codigosDesconhecidos: [],
            resumo: 'Sem o totalizador do R-2099 não há conferência. "Evento recebido com sucesso" prova que o '
                + 'XML foi aceito, não que a Receita entendeu os mesmos valores — e é contra o totalizador que a '
                + 'guia é paga. Cole o retorno do fechamento (ou baixe o XML do recibo/totalizador) para conferir.',
        };
    }

    // Chave por DÍGITOS: o recibo humano escreve `1656-01` e o XML escreve
    // `165601`. Os dois são o mesmo código — comparar a máscara faria o
    // caminho que a tela recomenda (colar o XML) sair divergente com tudo certo.
    const porCodigo = new Map();
    const rotuloOriginal = new Map();
    for (const t of totalizador) {
        const cod = soCodigo(t?.codigoReceita);
        if (!cod) continue;
        porCodigo.set(cod, r2((porCodigo.get(cod) || 0) + (Number(t?.valor) || 0)));
        // Guarda como a Receita ESCREVEU, para o código desconhecido aparecer
        // na tela do jeito que a pessoa vai procurar no e-CAC.
        if (!rotuloOriginal.has(cod)) rotuloOriginal.set(cod, texto(t?.codigoReceita).trim() || cod);
    }

    const linhas = Object.keys(CODIGOS_RECEITA_FUNRURAL).map((componente) => {
        const codigo = CODIGOS_RECEITA_FUNRURAL[componente];
        const chave = soCodigo(codigo);
        const noApp = r2(apurado?.[componente]);
        const naReceita = porCodigo.has(chave) ? porCodigo.get(chave) : null;
        porCodigo.delete(chave);
        return {
            componente,
            rotulo: ROTULO_COMPONENTE[componente],
            codigoReceita: codigo,
            apurado: noApp,
            totalizado: naReceita,
            // Ausente ≠ zero: código que a Receita não totalizou com valor
            // apurado do lado de cá é divergência, não "bateu em zero".
            confere: naReceita !== null && naReceita === noApp,
            diferenca: naReceita === null ? null : r2(naReceita - noApp),
        };
    });

    const codigosDesconhecidos = Array.from(porCodigo.entries())
        .map(([chave, valor]) => ({ codigoReceita: rotuloOriginal.get(chave) || chave, valor }));

    const divergentes = linhas.filter((l) => !l.confere);
    const situacao = divergentes.length || codigosDesconhecidos.length ? 'divergente' : 'confere';

    const partes = [];
    if (situacao === 'confere') {
        const total = r2(linhas.reduce((s, l) => s + l.apurado, 0));
        partes.push(`✓ O totalizador do R-2099 bate com a apuração da aba 🌾 nos três componentes `
            + `(total R$ ${fmtBRL(total)}). Dois caminhos independentes no mesmo número.`);
    }
    for (const l of divergentes) {
        partes.push(l.totalizado === null
            ? `${l.rotulo} (${l.codigoReceita}): o app apurou R$ ${fmtBRL(l.apurado)} e a Receita NÃO totalizou `
              + 'este código. Ausente não é zero — ou o evento não levou este componente, ou a natureza da '
              + 'aquisição usa outro código.'
            : `${l.rotulo} (${l.codigoReceita}): app R$ ${fmtBRL(l.apurado)} × Receita `
              + `R$ ${fmtBRL(l.totalizado)} (diferença R$ ${fmtBRL(l.diferenca)}).`);
    }
    for (const d of codigosDesconhecidos) {
        partes.push(`A Receita totalizou R$ ${fmtBRL(d.valor)} no código ${d.codigoReceita}, que este app `
            + 'não conhece. Ele fica FORA da conferência de propósito: somar por engano criaria uma divergência '
            + 'inventada. Se for aquisição rural de outra natureza, cadastre o código com o recibo do lado.');
    }

    return { situacao, linhas, codigosDesconhecidos, resumo: partes.join(' ') };
}

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
