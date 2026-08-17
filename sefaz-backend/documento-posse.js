// ============================================================================
// sefaz-backend/documento-posse.js  (PURO — testável)
// ----------------------------------------------------------------------------
// DE QUEM É ESTE DOCUMENTO? — e, principalmente, QUANDO tirar de quem está com
// ele é conserto e quando é ROUBO.
//
// ═══ O CASO QUE CRIOU ISTO (Paulo, 17/08, KROYA × GOLDLOG) ═══════════════════
//
// Ele importou as saídas da KROYA e algumas eram para a GOLDLOG — que também é
// cliente da casa. A MESMA NF-e é **saída de uma e entrada da outra**: dois
// contribuintes, dois livros, duas escriturações. Na tela veio
// *"Este XML já está gravado em OUTRA empresa"*.
//
// A causa é estrutural: em `documentos_fiscais` o **id do documento é a CHAVE**,
// então uma chave só comporta UM dono. Isso ainda vai ser resolvido na
// identidade do documento; o que este módulo resolve é o dano que já estava
// acontecendo em silêncio.
//
// ═══ O DANO: A REATRIBUIÇÃO ESTAVA TROCANDO A NOTA DE DONA ═══════════════════
//
// O importer, ao achar a chave com `empresaId` diferente, REATRIBUÍA o
// documento (`status: 'reatribuido'`). Aquilo nasceu para o caso GUARANI (27/07:
// *"36 duplicadas · 0 reatribuídas"*, notas sem dono e invisíveis no filtro por
// empresa) e nunca previu **duas empresas da mesma carteira negociando entre
// si**: aí a nota muda de dona a cada rodada de captura, e o livro de quem
// perdeu fica a menor **sem nada acender**.
//
// ═══ A RÉGUA ════════════════════════════════════════════════════════════════
//
// Dono errado é dono que **não é parte do documento**. Se o CNPJ de quem está
// com a nota é o emitente ou o destinatário dela, ele não é dono errado — é a
// CONTRAPARTE, e tirar a nota dele apaga a escrituração de um contribuinte.
//
// ⚠️ AUSÊNCIA NÃO É PROVA: dono cujo CNPJ não está gravado **não é declarado
// errado** — vira `posse-indeterminada` e a nota FICA onde está, com o caso
// NOMEADO no resultado. Reatribuir no escuro é exatamente o que estava
// corrompendo dado; deixar parado aparece no log e se resolve com dado, não com
// dedução.
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * As partes do documento — quem EMITIU e para quem foi.
 *
 * Lê as duas formas em que o documento chega (CHATA e ANINHADA), que é a
 * armadilha que mais mordeu este projeto. Aqui ela mordeu de um jeito novo:
 * julgar posse sem enxergar o participante daria "não é parte" para todo mundo,
 * e o módulo passaria a autorizar justamente a troca que veio impedir.
 */
export function partesDoDocumento(doc) {
    const d = doc || {};
    const cand = [
        d.cnpjEmit, d.cpfEmit,
        d.emitente?.cnpjCpf, d.emitente?.cnpj, d.emitente?.CNPJ,
        d.prestador?.cnpjCpf, d.prestador?.cnpj,
        d.cnpjDest, d.cpfDest,
        d.destinatario?.cnpjCpf, d.destinatario?.cnpj, d.destinatario?.CNPJ,
        d.tomador?.cnpjCpf, d.tomador?.cnpj,
    ];
    const out = [];
    for (const c of cand) {
        const s = soDigitos(c);
        if ((s.length === 14 || s.length === 11) && !out.includes(s)) out.push(s);
    }
    return out;
}

/** O CNPJ/CPF é uma das partes do documento? */
export function ehParteDoDocumento(doc, cnpj) {
    const s = soDigitos(cnpj);
    if (s.length !== 14 && s.length !== 11) return false;
    return partesDoDocumento(doc).includes(s);
}

/**
 * @param {object} p
 * @param {{empresaId?:string|null, empresaCnpj?:string|null, empresaNome?:string|null}} p.existente
 *        o que já está gravado (o documento em si serve de fonte das partes)
 * @param {{empresaId?:string|null, empresaCnpj?:string|null}} p.pretendente
 *        a empresa em cujo nome a captura/importação está acontecendo
 * @param {object} [p.documento]  o documento (default: o próprio `existente`)
 */
export function decidirPosseDocumento({ existente, pretendente, documento } = {}) {
    const ex = existente || {};
    const pre = pretendente || {};
    const doc = documento || ex;

    const donoId = String(ex.empresaId ?? '').trim();
    const novoId = String(pre.empresaId ?? '').trim();

    if (!novoId) {
        return {
            situacao: 'sem-pretendente', reatribuir: false,
            motivo: 'A captura não veio em nome de nenhuma empresa — não há a quem atribuir.',
        };
    }
    if (donoId && donoId === novoId) {
        return { situacao: 'mesmo-dono', reatribuir: false, motivo: 'O documento já é desta empresa.' };
    }

    // ── Sem dono: é o caso GUARANI, e reatribuir É o conserto ───────────────
    if (!donoId) {
        return {
            situacao: 'sem-dono', reatribuir: true,
            motivo: 'O documento estava sem empresa — invisível em qualquer filtro por cliente.',
        };
    }

    const cnpjDono = soDigitos(ex.empresaCnpj);
    if (cnpjDono.length !== 14 && cnpjDono.length !== 11) {
        // Não dá pra dizer que o dono está errado sem saber quem ele é. Ausência
        // não é prova — e afirmar aqui é justamente o que troca a nota de dona
        // por engano.
        return {
            situacao: 'posse-indeterminada', reatribuir: false,
            motivo: 'O documento tem dono, mas o CNPJ dele não está gravado — não dá pra dizer se ele é parte '
                + 'do documento. A nota fica onde está; confira o cadastro da empresa dona.',
        };
    }

    if (ehParteDoDocumento(doc, cnpjDono)) {
        // 🚨 O CASO KROYA × GOLDLOG. As duas são partes: uma escritura saída, a
        // outra entrada. Trocar a dona apaga um livro para preencher o outro.
        const pretendenteTambemEParte = ehParteDoDocumento(doc, pre.empresaCnpj);
        return {
            situacao: pretendenteTambemEParte ? 'contraparte-legitima' : 'dono-e-parte',
            reatribuir: false,
            motivo: pretendenteTambemEParte
                ? 'As DUAS empresas são partes deste documento — ele é saída de uma e entrada da outra. '
                  + 'Trocar a dona apagaria a escrituração de um dos dois contribuintes.'
                : 'Quem está com o documento é parte dele (emitente ou destinatário) — não é dono errado.',
        };
    }

    return {
        situacao: 'dono-nao-e-parte', reatribuir: true,
        motivo: 'A empresa que está com o documento não é emitente nem destinatário dele — a posse está errada.',
    };
}
