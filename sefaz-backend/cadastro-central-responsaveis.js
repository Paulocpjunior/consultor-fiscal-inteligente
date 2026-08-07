// ============================================================================
// sefaz-backend/cadastro-central-responsaveis.js  (PURO — testável)
// ----------------------------------------------------------------------------
// FASE 2 DO TÚNEL: QUEM RESPONDE POR ESTE CLIENTE.
//
// A fase 1 respondeu "este CNPJ existe?". Esta responde a pergunta seguinte,
// que é a que trava o trabalho do outro app: *"e quem eu procuro quando ele
// tiver problema?"* — hoje o Consultor Contábil e o Legalização não sabem, e
// a resposta acaba saindo por WhatsApp, de memória.
//
// ═══ POR QUE ISSO É MAIS DO QUE CONVENIÊNCIA ════════════════════════════════
//
// Já vale a regra de 05/08 (*"o cliente tende a entender que eu que enviei e
// acaba me questionando"*): todo envio sai da caixa de QUEM CUIDA da carteira.
// Um app irmão que não sabe quem cuida só tem duas saídas — mandar pela caixa
// institucional (o problema que o Paulo mandou corrigir) ou não mandar. Este
// túnel dá a terceira.
//
// ═══ TRÊS DECISÕES QUE SEGUEM A REGRA DA CASA ═══════════════════════════════
//
// 1) **DOIS PRINCIPAIS NÃO VIRAM ESCOLHA SILENCIOSA.** Se a empresa tem mais
//    de um vínculo `principal`, `principal` sai NULO e os dois vêm em
//    `principais[]` com o conflito nomeado. Escolher um seria o app decidindo
//    de quem é o cliente — e o outro lado mandaria e-mail para a pessoa errada
//    sem nunca desconfiar. Cadastro torto ACENDE, não se conserta (06/08).
//
// 2) **EMPRESA SEM RESPONSÁVEL NÃO SOME.** Ela vem com `principal: null` e
//    entra em `semResponsavel`. Sumir faria o outro app concluir que a lista
//    está completa — é a mesma razão pela qual "Empresas SEM responsável" é
//    opção do seletor no Guia do mês, e não um filtro que esconde.
//
// 3) **O NOME VIVO VENCE A CÓPIA.** O vínculo guarda `colaboradorNome` do dia
//    da atribuição; `users` tem o de hoje. Quando divergem, vale o de `users`
//    e a divergência ACENDE — cadastro × fonte divergente é alerta de primeira
//    classe, nunca escolha muda.
//
// ⚠️ Aqui também não passa certificado: isto é cadastro de PESSOA, e a chave
// privada continua morando só no CFI.
// ============================================================================

export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
};
const PAPEL_PADRAO = 'principal';

/** Papel normalizado. Vínculo sem papel é principal — é o default da tela. */
const papelDe = (v) => (texto(v?.papel) || PAPEL_PADRAO).toLowerCase();

/**
 * Um colaborador, juntando o vínculo (cópia do dia da atribuição) com o doc
 * vivo de `users`. O e-mail só existe em `users` — e é ele que o outro app
 * precisa pra falar com a pessoa.
 */
export function normalizarResponsavel(vinculo, usuario) {
    const uid = texto(vinculo?.colaboradorUid);
    if (!uid) return null;

    const nomeVivo = texto(usuario?.nome) || texto(usuario?.displayName);
    const nomeCopia = texto(vinculo?.colaboradorNome);
    const email = texto(usuario?.email);

    const avisos = [];
    if (!usuario) {
        avisos.push('Colaborador sem cadastro em `users` — o nome vem da cópia guardada no vínculo e não '
            + 'há e-mail. Pode ser conta removida com vínculo esquecido.');
    } else if (nomeVivo && nomeCopia && nomeVivo !== nomeCopia) {
        // Divergência entre cadastro e fonte é alerta de primeira classe.
        avisos.push(`O vínculo diz "${nomeCopia}" e o cadastro do usuário diz "${nomeVivo}" — vale o do `
            + 'cadastro, mas alguém precisa acertar o vínculo.');
    }
    if (usuario && !email) {
        avisos.push('Colaborador sem e-mail no cadastro — o outro app não tem como falar com ele.');
    }

    return {
        uid,
        nome: nomeVivo || nomeCopia || null,
        email,
        papel: papelDe(vinculo),
        role: texto(usuario?.role) || null,
        avisos,
    };
}

/**
 * O mapa "empresa → quem responde", pronto pra outro app consumir.
 *
 * @param {object} p
 * @param {Array} p.empresas  saída de `montarCadastroEmpresas` (CNPJ em dígitos)
 * @param {Array} p.vinculos  docs de `carteiras`
 * @param {Array} p.usuarios  docs de `users` ({ uid, nome, email, role })
 */
export function montarResponsaveis({ empresas = [], vinculos = [], usuarios = [] } = {}) {
    const porUid = new Map();
    for (const u of usuarios) {
        const uid = texto(u?.uid) || texto(u?.id);
        if (uid) porUid.set(uid, u);
    }

    // A empresa é indexada pelas DUAS chaves porque o vínculo grava as duas, e
    // qual delas veio preenchida varia com a época em que foi atribuído.
    const porId = new Map();
    const porCnpj = new Map();
    for (const e of empresas) {
        if (e?.id) porId.set(e.id, e);
        if (e?.cnpj) porCnpj.set(e.cnpj, e);
    }

    const daEmpresa = new Map();
    const orfaos = [];

    for (const v of vinculos) {
        const empresa = porId.get(texto(v?.empresaId)) || porCnpj.get(soDigitos(v?.empresaCnpj));
        if (!empresa) {
            // Vínculo apontando pra empresa que não está no cadastro (excluída,
            // mesclada, id trocado). NÃO some: é justamente o que faz alguém
            // achar que a atribuição está feita quando não está mais.
            orfaos.push({
                empresaId: texto(v?.empresaId),
                empresaCnpj: soDigitos(v?.empresaCnpj) || null,
                empresaNome: texto(v?.empresaNome),
                colaboradorNome: texto(v?.colaboradorNome),
                motivo: 'A empresa deste vínculo não está no cadastro (excluída, mesclada ou id trocado).',
            });
            continue;
        }
        const r = normalizarResponsavel(v, porUid.get(texto(v?.colaboradorUid)));
        if (!r) continue;
        if (!daEmpresa.has(empresa.cnpj)) daEmpresa.set(empresa.cnpj, []);
        const lista = daEmpresa.get(empresa.cnpj);
        // Mesmo colaborador atribuído duas vezes é ruído do cadastro, não dois
        // responsáveis: mantém o primeiro.
        if (!lista.some((x) => x.uid === r.uid)) lista.push(r);
    }

    const linhas = empresas.map((e) => montarLinha(e, daEmpresa.get(e.cnpj) || []));
    const semResponsavel = linhas.filter((l) => !l.responsaveis.length).length;
    const comConflito = linhas.filter((l) => l.conflito).length;

    return {
        linhas,
        resumo: {
            empresas: linhas.length,
            comResponsavel: linhas.length - semResponsavel,
            semResponsavel,
            comConflito,
            vinculosOrfaos: orfaos.length,
            colaboradores: new Set(linhas.flatMap((l) => l.responsaveis.map((r) => r.uid))).size,
        },
        vinculosOrfaos: orfaos,
        avisos: avisosDosResponsaveis({ total: linhas.length, semResponsavel, comConflito, orfaos: orfaos.length }),
    };
}

function montarLinha(empresa, responsaveis) {
    const principais = responsaveis.filter((r) => r.papel === PAPEL_PADRAO);
    const backups = responsaveis.filter((r) => r.papel !== PAPEL_PADRAO);

    // Um principal = resposta. Nenhum ou vários = pergunta, e o túnel devolve
    // a pergunta em vez de fingir uma resposta.
    const conflito = principais.length > 1
        ? `${principais.length} colaboradores marcados como principal — o túnel NÃO escolhe: escolher `
          + 'aqui faria o outro app falar com a pessoa errada sem nunca desconfiar. Acerte na aba '
          + 'Atribuição da Carteira.'
        : null;

    return {
        cnpj: empresa.cnpj,
        empresaId: empresa.id || null,
        nome: empresa.nome || null,
        regime: empresa.regime || null,
        principal: principais.length === 1 ? principais[0] : null,
        principais,
        backups,
        responsaveis,
        conflito,
        // Sem responsável NÃO é ausência de informação: é pendência de
        // atribuição, e tem que chegar assim do outro lado.
        pendenteDeAtribuicao: responsaveis.length === 0,
    };
}

function avisosDosResponsaveis({ total, semResponsavel, comConflito, orfaos }) {
    const out = [
        'O `principal` só vem preenchido quando há exatamente UM. Com mais de um, ele vai nulo e os dois '
        + 'aparecem em `principais[]`: escolher por conta própria mandaria o outro app falar com a pessoa errada.',
    ];
    if (semResponsavel) {
        out.push(`${semResponsavel} de ${total} empresa(s) SEM responsável na carteira. Elas vêm na lista com `
            + '`pendenteDeAtribuicao`, não somem — sumir faria o outro app achar que a lista está completa.');
    }
    if (comConflito) {
        out.push(`${comConflito} empresa(s) com mais de um responsável PRINCIPAL — conflito de atribuição, `
            + 'para acertar na Carteira.');
    }
    if (orfaos) {
        out.push(`${orfaos} vínculo(s) apontando pra empresa que não está mais no cadastro (excluída ou `
            + 'mesclada). Vêm em `vinculosOrfaos` porque quem olha a Carteira ainda os vê como atribuídos.');
    }
    if (!total) {
        out.push('NENHUMA empresa no cadastro. Isso não é "escritório sem clientes": é falha de leitura.');
    }
    return out;
}

/** A linha de UMA empresa, pelo CNPJ em qualquer grafia. */
export function responsavelDoCnpj(linhas, cnpj) {
    const alvo = soDigitos(cnpj);
    if (alvo.length !== 14) return null;
    return (linhas || []).find((l) => l.cnpj === alvo) || null;
}
