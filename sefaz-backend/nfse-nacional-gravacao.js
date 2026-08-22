// ============================================================================
// sefaz-backend/nfse-nacional-gravacao.js  (PURO — sem firebase, testável)
//
// 🚨 O TRILHO DO ADN GRAVAVA UM DOCUMENTO QUE NENHUM LEITOR DO APP ENXERGA
//
// A captura da NFS-e Nacional (ADN) escreve em `documentos_fiscais` — a MESMA
// coleção de tudo — e gravava só o que o parser dela extraiu:
// `tipo: 'nfseNacional'`, `prestadorCnpj`, `tomadorCnpj`, `valorServico`,
// `valorIss`. **Sem `direcao`, sem `competencia`, sem `status`, sem
// `valorTotal` e sem os blocos de participante.**
//
// 🔴 O efeito é a nota EXISTIR e não aparecer em lugar nenhum:
//
//   · **sem `direcao`** — some do filtro Entradas/Saídas, do Livro, do Resumo
//     por CFOP, da aba de Serviços e do bloco A do EFD-Contribuições;
//   · **sem `competencia`** — fica fora de TODA consulta por competência, que
//     é como o app recorta o mês inteiro;
//   · **`tipo: 'nfseNacional'`** — o `detectTipo` da lista não conhece esse
//     rótulo e cai no default `'NFe'`: a NFS-e aparecia como nota de
//     MERCADORIA, com valor 0,00 (ela não tem `totais.vNF`);
//   · **sem `status`** — a régua de cancelamento não tem o que ler.
//
// ✂️ Aqui não se INVENTA nada: tudo sai do próprio documento. A direção vem de
// comparar prestador/tomador com o CNPJ da empresa (é o que o importador do
// portal de SP já faz), a competência sai da data de emissão, e o que não der
// para derivar **fica de fora, nomeado** — nunca preenchido no escuro.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 E O EVENTO ESTAVA APAGANDO A NOTA
//
// O `docId` é a CHAVE nos dois casos — e a chave do evento é a **da NFS-e a
// que ele se refere**. Com `merge: true` e `tipo: meta.tipoDoc`, o evento de
// cancelamento reescrevia o `tipo` do documento para `'eventoNfseNacional'`:
// a nota deixava de ser nota. É a família do stub que o merge ressuscitava
// (11/08, MV LIDER 639), na direção contrária.
//
// ✂️ O evento passa a entrar em **`eventos[]`** — o array que `docCancelado`
// já lê —, sem tocar na identidade do documento.
//
// 🚩 **PENDÊNCIA NOMEADA, NÃO CORRIGIDA**: isto NÃO faz o cancelamento pelo
// ADN ser detectado. `docCancelado` reconhece o evento **110111** da NF-e, e o
// código de cancelamento do leiaute nacional da NFS-e **não está provado neste
// repo** — carimbá-lo de memória seria inventar código de tabela oficial, que
// é o erro que este projeto mais paga. O evento fica GRAVADO e FIEL; quem
// fechar a classe é um evento real de cancelamento vindo do ADN.
// ============================================================================

const so = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * A competência (AAAA-MM) da data de emissão — só quando ela é legível.
 * Data ilegível NÃO vira competência: nota na competência errada é pior que
 * nota sem competência, porque some do mês certo e aparece no errado.
 */
export function competenciaDaEmissao(dataEmissao) {
    const t = String(dataEmissao ?? '').trim();
    const m = /^(\d{4})-(\d{2})/.exec(t);
    if (!m) return null;
    const mes = Number(m[2]);
    if (mes < 1 || mes > 12) return null;
    return `${m[1]}-${m[2]}`;
}

/**
 * De que lado a empresa está neste documento.
 *
 * ⚠️ Devolve `null` quando ela não é NENHUM dos dois — e aí a direção NÃO é
 * gravada. Chutar um lado aqui colocaria a nota no livro errado, que é
 * exatamente o erro que a régua da direção existe para impedir.
 */
export function direcaoDaNfseNacional(meta, empresaCnpj) {
    const emp = so(empresaCnpj);
    if (emp.length < 11) return null;
    if (so(meta?.prestadorCnpj) === emp) return 'saida';
    if (so(meta?.tomadorCnpj) === emp) return 'entrada';
    // O tomador pode ser PESSOA FÍSICA (CPF) — aí a empresa só pode ser a
    // prestadora, mas quem afirma isso é o CNPJ do prestador acima, não a
    // ausência de um CNPJ do outro lado.
    return null;
}

/**
 * Os campos que a NFS-e do ADN precisa ter para os leitores do app a
 * enxergarem. Sai só o que o documento permite afirmar.
 */
export function documentoDaNfseNacional(meta, empresaCnpj) {
    const m = meta || {};
    const direcao = direcaoDaNfseNacional(m, empresaCnpj);
    const competencia = competenciaDaEmissao(m.dataEmissao);
    const valor = Number(m.valorServico);

    const out = {
        // O app inteiro pergunta `tipo === 'NFSe'`; `tipoDoc` guarda o trilho,
        // que é o que o `nfseNacional` de fato diz. Mesmo desenho do importador
        // do portal de SP.
        tipo: 'NFSe',
        tipoDoc: 'nfseNacional',
        // A NFS-e distribuída pelo ADN é uma nota EMITIDA. O cancelamento vem
        // por evento, e ele NÃO é lido aqui (ver a pendência no topo).
        status: 'autorizado',
        numero: m.numero ?? null,
        dhEmi: m.dataEmissao ?? null,
        codMunIBGE: m.codMunicipio ?? null,
    };

    if (direcao) out.direcao = direcao;
    if (competencia) out.competencia = competencia;

    if (Number.isFinite(valor)) {
        out.valorTotal = valor;
        out.valorServicos = valor;
    }
    // ⚠️ `valorIss` já vem no meta e é lido por `issDoDocumento` — não se
    // duplica aqui numa segunda forma.

    // Blocos de participante nas formas que os donos do app leem
    // (`normalizarParticipantesDoc` e `participanteDoDocumento`).
    const prest = so(m.prestadorCnpj);
    const tomad = so(m.tomadorCnpj) || so(m.tomadorCpf);
    if (prest) {
        out.cnpjEmit = prest;
        out.prestador = { cnpjCpf: prest, inscricaoMunicipal: m.prestadorIM ?? null };
    }
    if (tomad) {
        out.cnpjDest = tomad;
        out.tomador = { cnpjCpf: tomad };
    }
    return out;
}

/**
 * O que ficou SEM derivação — para o resultado da rodada dizer, em vez de a
 * nota entrar torta e calada.
 */
export function lacunasDaNfseNacional(meta, empresaCnpj) {
    const faltas = [];
    if (!direcaoDaNfseNacional(meta, empresaCnpj)) {
        faltas.push('direção (a empresa não é o prestador nem o tomador desta nota)');
    }
    if (!competenciaDaEmissao(meta?.dataEmissao)) {
        faltas.push('competência (data de emissão ilegível)');
    }
    if (!Number.isFinite(Number(meta?.valorServico))) {
        faltas.push('valor do serviço');
    }
    return faltas;
}

/**
 * O evento entra em `eventos[]` — SEM tocar na identidade do documento.
 *
 * Devolve `null` quando não há o que registrar. O chamador faz o merge do
 * array (o Firestore não tem "append" idempotente por conteúdo, então a
 * dedução do que já existe é de quem tem o documento na mão).
 */
export function eventoDaNfseNacional(meta) {
    const m = meta || {};
    if (!m.tpEvento && !m.dh) return null;
    return {
        tpEvento: m.tpEvento ?? null,
        seq: m.seq ?? null,
        dh: m.dh ?? null,
        justificativa: m.justificativa ?? null,
        origem: 'adn',
    };
}

/** O evento já está no array? (mesmo tipo e mesma sequência.) */
export function eventoJaRegistrado(eventos, novo) {
    if (!novo) return true;
    return (eventos || []).some((e) => e
        && String(e.tpEvento ?? '') === String(novo.tpEvento ?? '')
        && String(e.seq ?? '') === String(novo.seq ?? ''));
}
