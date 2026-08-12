// ============================================================================
// sefaz-backend/dctfweb-transmissao-regras.js   (PURO — sem io, testável)
//
// QUEM TRANSMITE A DCTFWEB, E COM QUE CONDIÇÕES.
//
// Decisões do Paulo (12/08/2026), depois de descrever o mês real do escritório:
//   T1 — o DONO da transmissão é o FISCAL. A DCTFWeb é UMA declaração do CNPJ,
//        não do departamento: quem transmite fecha a competência para os outros
//        dois. Sem dono, qualquer um fecha e ninguém sabe quem foi.
//   T3 — transmitir com insumo pendente NÃO é bloqueio, é JUSTIFICATIVA
//        GRAVADA. Bloquear puro faria alguém perder o dia 15 por causa de um
//        insumo que talvez não venha — e aí a multa é certa, enquanto a
//        retificadora é barata.
//
// ─── A DISTINÇÃO QUE EVITA A RETIFICADORA ───────────────────────────────────
//
// PAGAR e TRANSMITIR são fatos diferentes, e é confundi-los que gera retrabalho:
// o DARF sai com a declaração EM ANDAMENTO (GERARGUIAANDAMENTO313), então quem
// tem guia vencendo cedo NÃO precisa transmitir pra pagar. Por isso emitir guia
// não passa por nenhuma trava daqui — só transmitir passa.
// ============================================================================

/** Departamento dono da transmissão (T1). */
export const DEPARTAMENTO_DONO = 'fiscal';

const departamentosDe = (user) => (Array.isArray(user?.departamentos) ? user.departamentos : [])
    .map((d) => String(d || '').trim().toLowerCase());

/**
 * T1 — quem pode transmitir/retificar a DCTFWeb.
 *
 * Admin sempre passa (é quem destrava o escritório quando falta gente). Quem não
 * é do fiscal enxerga tudo — o veto é só no ATO de transmitir, porque é ele que
 * fecha a competência alheia.
 */
export function podeTransmitirDctfweb(user) {
    if (user?.role === 'admin' || user?.isAdmin === true) {
        return { pode: true, motivo: 'admin', dono: 'admin' };
    }
    const deps = departamentosDe(user);
    if (deps.includes(DEPARTAMENTO_DONO)) {
        return { pode: true, motivo: 'departamento fiscal', dono: DEPARTAMENTO_DONO };
    }
    return {
        pode: false,
        dono: DEPARTAMENTO_DONO,
        motivo: deps.length
            ? `A DCTFWeb é transmitida pelo departamento FISCAL — o seu vínculo é ${deps.join(', ')}. `
              + 'Transmitir fecha a competência para os outros departamentos, por isso tem um dono só.'
            : 'A DCTFWeb é transmitida pelo departamento FISCAL e você não tem departamento vinculado. '
              + 'Peça ao admin para vincular o seu — não é troca de senha.',
        acao: 'Precisa transmitir hoje? Fale com o fiscal responsável ou com o admin. '
            + 'Se o que você precisa é a GUIA, ela sai sem transmitir: use "Gerar DARF" com a declaração em andamento.',
    };
}

/**
 * T3 — transmitir com insumo pendente exige confirmação E justificativa.
 *
 * A justificativa é TEXTO de quem clica, não caixinha: ela vai pra auditoria e
 * é o que responde, daqui a três meses, "por que essa competência foi fechada
 * sem o eSocial?". Justificativa vazia ou de uma palavra não responde nada.
 */
export const JUSTIFICATIVA_MINIMA = 15;

export function checarJustificativa({ veredito, confirmou, justificativa }) {
    if (veredito !== 'incompleto') return { ok: true };
    if (!confirmou) {
        return {
            ok: false,
            erro: 'Há insumo pendente de outro departamento. Confirme explicitamente para transmitir assim mesmo — '
                + 'fica registrado quem seguiu e por quê.',
        };
    }
    const texto = String(justificativa || '').trim();
    if (texto.length < JUSTIFICATIVA_MINIMA) {
        return {
            ok: false,
            erro: `Escreva a justificativa (mínimo ${JUSTIFICATIVA_MINIMA} caracteres): por que esta competência `
                + 'está sendo transmitida sem o insumo do outro departamento? '
                + 'Ela vai pra auditoria com o seu nome e é o que explica a retificadora depois.',
        };
    }
    return { ok: true, justificativa: texto };
}

/**
 * T5 — pré-condições da RETIFICADORA.
 *
 * Retificar é transmitir DE NOVO a mesma competência: o e-CAC monta uma nova
 * declaração em andamento com os insumos que chegaram depois, e o mesmo fluxo
 * (consulta o XML → assina → TRANSDECLARACAO310) a entrega.
 *
 * ⚠️ O QUE ESTA FUNÇÃO NÃO PROMETE: um preview do "depois". Os débitos da
 * DCTFWeb são montados pela RECEITA a partir do eSocial/Reinf/MIT — o app não os
 * constrói e portanto não sabe o resultado antes de transmitir. Fingir preview
 * aqui seria inventar número fiscal. O que dá pra fazer é guardar o ANTES e
 * comparar com o DEPOIS na auditoria, e é isso que a rota faz.
 */
export function checarRetificadora({ declaracao, motivo }) {
    const transmitida = !!declaracao?.transmitidoEm
        || String(declaracao?.situacao || '').toUpperCase() === 'ATIVA';
    if (!transmitida) {
        return {
            ok: false,
            erro: 'Esta competência ainda NÃO foi transmitida — não existe retificadora de declaração que não foi entregue. '
                + 'Use a transmissão normal.',
        };
    }
    const texto = String(motivo || '').trim();
    if (texto.length < JUSTIFICATIVA_MINIMA) {
        return {
            ok: false,
            erro: `Escreva o motivo da retificadora (mínimo ${JUSTIFICATIVA_MINIMA} caracteres) — `
                + 'ex.: "eSocial fechou dia 18, depois da transmissão dia 12". '
                + 'Retificação sem motivo registrado é a mesma opacidade que criou o problema.',
        };
    }
    return { ok: true, motivo: texto };
}

/**
 * Comparação ANTES × DEPOIS dos débitos, para a auditoria da retificadora.
 * Puro: recebe as duas listas já consultadas.
 */
export function compararDebitos(antes = [], depois = []) {
    const chave = (d) => String(d?.codReceita || d?.codigo || '');
    const mapa = (lista) => new Map(lista.map((d) => [chave(d), Number(d?.valor) || 0]));
    const a = mapa(antes), b = mapa(depois);
    const linhas = [];
    for (const k of new Set([...a.keys(), ...b.keys()])) {
        const va = a.get(k) ?? null, vb = b.get(k) ?? null;
        if (va === vb) continue;
        linhas.push({
            codReceita: k,
            antes: va,
            depois: vb,
            delta: Number((((vb ?? 0) - (va ?? 0))).toFixed(2)),
            tipo: va === null ? 'incluido' : vb === null ? 'removido' : 'alterado',
        });
    }
    const soma = (lista) => Number(lista.reduce((s, d) => s + (Number(d?.valor) || 0), 0).toFixed(2));
    return {
        linhas: linhas.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)),
        totalAntes: soma(antes),
        totalDepois: soma(depois),
        deltaTotal: Number((soma(depois) - soma(antes)).toFixed(2)),
        // Retificadora que não mudou NADA é sinal de que o insumo ainda não
        // chegou na Receita — e isso precisa aparecer, senão a pessoa acha que
        // resolveu.
        semEfeito: linhas.length === 0,
    };
}
