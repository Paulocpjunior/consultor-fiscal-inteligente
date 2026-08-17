// ============================================================================
// sefaz-backend/whatsapp-etiquetas.js — as ETIQUETAS (flags) do contato
// ----------------------------------------------------------------------------
// Pedido do Paulo (17/08): *"devemos criar uma opção de Flags para os
// usuários, como por exemplo, Leads, Clientes, Marketing, Colaboradores,
// Candidatos, entre outros"*.
//
// 🚨 ETIQUETA NÃO É ENFEITE DE TELA — É CLASSIFICAÇÃO DE PESSOA, e é isso que
// a torna assunto de LGPD. Dizer que um número é "lead" ou "candidato" é
// tratar dado pessoal com uma FINALIDADE, e a lei (Lei 13.709/2018, art. 6º,
// I e art. 7º) exige que a finalidade seja específica e tenha base legal.
//
// Por isso cada etiqueta nasce COM a finalidade e a base legal escritas — não
// como texto jurídico decorativo, mas porque elas mudam o que o app cobra:
//   · `marketing` pede CONSENTIMENTO (art. 7º, I). Sem ele registrado, o app
//     ACENDE — é a regra de 06/08 (alerta, nunca contorno) aplicada a dado
//     pessoal: mandar campanha para quem não consentiu é o dano que não se
//     desfaz depois, porque a mensagem já chegou.
//   · `cliente` se sustenta na execução do contrato (art. 7º, V) e não pede
//     consentimento — cobrar consentimento aqui encheria a tela de alarme sem
//     ação, que é o que ensina a equipe a ignorar os alarmes que importam.
//
// O catálogo é EDITÁVEL (coleção `whatsapp_etiquetas`), nunca uma constante
// fechada: etiqueta nova aparece na operação toda semana, e lista no código
// obriga deploy pra cada uma. O que o código guarda é o PADRÃO — o ponto de
// partida do Paulo — e as REGRAS que valem para qualquer etiqueta.
// ============================================================================

/** Bases legais que este app usa. O rótulo é o que aparece pra quem opera. */
export const BASES_LEGAIS = {
    contrato: { rotulo: 'Execução de contrato', artigo: 'art. 7º, V', pedeConsentimento: false },
    consentimento: { rotulo: 'Consentimento do titular', artigo: 'art. 7º, I', pedeConsentimento: true },
    legitimo: { rotulo: 'Legítimo interesse', artigo: 'art. 7º, IX', pedeConsentimento: false },
    obrigacao: { rotulo: 'Obrigação legal', artigo: 'art. 7º, II', pedeConsentimento: false },
    preliminares: { rotulo: 'Procedimentos preliminares a contrato', artigo: 'art. 7º, V', pedeConsentimento: false },
};

export function baseLegalValida(id) {
    return Object.prototype.hasOwnProperty.call(BASES_LEGAIS, String(id || ''));
}

/**
 * As etiquetas que o app já traz — as do Paulo mais as que a operação de um
 * escritório contábil pede. Elas são o PADRÃO, e o admin acrescenta as dele.
 */
export const ETIQUETAS_PADRAO = [
    {
        id: 'lead', rotulo: 'Lead', cor: 'amber', ordem: 1,
        finalidade: 'Contato que demonstrou interesse e ainda não é cliente — acompanhamento comercial.',
        baseLegal: 'preliminares',
    },
    {
        id: 'cliente', rotulo: 'Cliente', cor: 'emerald', ordem: 2,
        finalidade: 'Atendimento e prestação dos serviços contratados.',
        baseLegal: 'contrato',
    },
    {
        id: 'marketing', rotulo: 'Marketing', cor: 'pink', ordem: 3,
        finalidade: 'Envio de comunicação promocional e conteúdo não relacionado à execução do contrato.',
        baseLegal: 'consentimento',
    },
    {
        id: 'colaborador', rotulo: 'Colaborador', cor: 'blue', ordem: 4,
        finalidade: 'Comunicação interna com a equipe do escritório.',
        baseLegal: 'contrato',
    },
    {
        id: 'candidato', rotulo: 'Candidato', cor: 'violet', ordem: 5,
        finalidade: 'Processo seletivo — contato sobre vaga.',
        baseLegal: 'preliminares',
    },
    {
        id: 'fornecedor', rotulo: 'Fornecedor', cor: 'slate', ordem: 6,
        finalidade: 'Relação com prestadores e fornecedores do escritório.',
        baseLegal: 'contrato',
    },
    {
        id: 'contador-parceiro', rotulo: 'Parceiro', cor: 'cyan', ordem: 7,
        finalidade: 'Relação com parceiros e indicadores de negócio.',
        baseLegal: 'legitimo',
    },
    {
        id: 'ex-cliente', rotulo: 'Ex-cliente', cor: 'rose', ordem: 8,
        finalidade: 'Guarda de histórico de quem encerrou o contrato, para obrigações legais do período.',
        baseLegal: 'obrigacao',
    },
];

export const CORES_ETIQUETA = ['amber', 'emerald', 'pink', 'blue', 'violet', 'slate', 'cyan', 'rose', 'red', 'lime'];

/** id de etiqueta: minúsculo, sem espaço — é chave, não texto de tela. */
export function normalizarIdEtiqueta(v) {
    return String(v || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/**
 * Valida a etiqueta que o admin cadastra. FINALIDADE e BASE LEGAL são
 * OBRIGATÓRIAS — e essa recusa é deliberada: etiqueta sem finalidade é
 * exatamente o "prazo órfão" do calendário municipal (15/08). Daqui a três
 * meses ninguém lembra por que aquela etiqueta existe, e quando um titular
 * perguntar "por que vocês me classificaram assim?", a resposta precisa
 * existir ANTES da pergunta.
 */
export function validarEtiqueta(d = {}) {
    const id = normalizarIdEtiqueta(d.id || d.rotulo);
    if (!id) return { ok: false, erro: 'Informe o nome da etiqueta.' };
    const rotulo = String(d.rotulo || '').trim();
    if (!rotulo) return { ok: false, erro: 'Informe o rótulo (é o que aparece na tela).' };
    const finalidade = String(d.finalidade || '').trim();
    if (finalidade.length < 15) {
        return {
            ok: false,
            erro: 'Escreva PARA QUE esta etiqueta serve (mín. 15 caracteres). Etiqueta classifica uma pessoa: sem finalidade escrita, não há como responder ao titular que perguntar por que foi classificado assim (LGPD art. 6º, I).',
        };
    }
    if (!baseLegalValida(d.baseLegal)) {
        return {
            ok: false,
            erro: `Escolha a base legal do tratamento. Opções: ${Object.entries(BASES_LEGAIS).map(([k, v]) => `${k} (${v.rotulo})`).join(' · ')}.`,
        };
    }
    const cor = CORES_ETIQUETA.includes(d.cor) ? d.cor : 'slate';
    const ordem = Number.isFinite(Number(d.ordem)) ? Number(d.ordem) : 99;
    return { ok: true, etiqueta: { id, rotulo, cor, ordem, finalidade, baseLegal: d.baseLegal, ativa: d.ativa !== false } };
}

/** Junta o padrão com o que o admin cadastrou (o cadastrado VENCE no mesmo id). */
export function montarCatalogoEtiquetas(cadastradas = []) {
    const porId = new Map(ETIQUETAS_PADRAO.map((e) => [e.id, { ...e, origem: 'padrao', ativa: true }]));
    (cadastradas || []).forEach((e) => {
        if (!e || !e.id) return;
        porId.set(e.id, { ...porId.get(e.id), ...e, origem: porId.has(e.id) ? 'padrao-editado' : 'cadastro' });
    });
    return [...porId.values()]
        .filter((e) => e.ativa !== false)
        .sort((a, b) => (a.ordem || 99) - (b.ordem || 99) || a.rotulo.localeCompare(b.rotulo));
}

/** Só entram etiquetas que EXISTEM no catálogo — id solto vira dado órfão. */
export function validarEtiquetasDoContato(ids, catalogo) {
    const conhecidos = new Set((catalogo || []).map((e) => e.id));
    const limpos = [...new Set((Array.isArray(ids) ? ids : []).map(normalizarIdEtiqueta).filter(Boolean))];
    const desconhecidas = limpos.filter((i) => !conhecidos.has(i));
    if (desconhecidas.length) {
        return { ok: false, erro: `Etiqueta que não existe no catálogo: ${desconhecidas.join(', ')}. Cadastre na ⚙️ antes de usar.`, desconhecidas };
    }
    return { ok: true, etiquetas: limpos };
}

/**
 * A etiqueta pede consentimento e ele não está registrado?
 *
 * ACENDE — não bloqueia. É a régua de 06/08: o app aponta e a pessoa arruma.
 * Bloquear a etiqueta faria a equipe deixar de classificar (e aí o dado fica
 * lá, tratado, sem nem a etiqueta que explica por quê) — o pior dos mundos.
 * O que o app RECUSA é o passo seguinte, o envio de campanha; classificar é
 * organização interna.
 */
export function pendenciasLgpdDoContato(contato = {}, catalogo = []) {
    const porId = new Map((catalogo || []).map((e) => [e.id, e]));
    const consentimentos = contato.consentimentos || {};
    const pendencias = [];
    for (const id of contato.etiquetas || []) {
        const e = porId.get(id);
        if (!e) {
            pendencias.push({
                etiqueta: id, tipo: 'etiqueta-desconhecida',
                motivo: `A etiqueta "${id}" não está no catálogo — ninguém sabe dizer para que ela serve.`,
                acao: 'Cadastre a etiqueta (com finalidade e base legal) ou remova do contato.',
            });
            continue;
        }
        const base = BASES_LEGAIS[e.baseLegal];
        if (base?.pedeConsentimento && consentimentos[id]?.em == null) {
            pendencias.push({
                etiqueta: id, tipo: 'sem-consentimento',
                motivo: `"${e.rotulo}" se apoia em consentimento (LGPD ${base.artigo}) e não há consentimento registrado para este contato.`,
                acao: 'Registre quando e como o titular consentiu — ou remova a etiqueta. Sem isso, não envie campanha para este número.',
            });
        }
        if (consentimentos[id]?.revogadoEm) {
            pendencias.push({
                etiqueta: id, tipo: 'consentimento-revogado',
                motivo: `O titular REVOGOU o consentimento de "${e.rotulo}" em ${consentimentos[id].revogadoEm}.`,
                acao: 'Pare o envio dessa natureza e retire a etiqueta. Revogação é direito do titular (art. 18, IX) e vale na hora.',
            });
        }
    }
    return pendencias;
}

/**
 * Pode mandar comunicação DESTA natureza para este contato?
 * Aqui sim é RECUSA, e não alerta: a mensagem enviada não volta.
 */
export function podeEnviarPorEtiqueta(contato = {}, etiquetaId, catalogo = []) {
    const e = (catalogo || []).find((x) => x.id === etiquetaId);
    if (!e) return { pode: false, motivo: `Etiqueta "${etiquetaId}" não existe no catálogo.` };
    const base = BASES_LEGAIS[e.baseLegal];
    if (!base?.pedeConsentimento) return { pode: true };
    const c = (contato.consentimentos || {})[etiquetaId];
    if (c?.revogadoEm) {
        return { pode: false, motivo: `O titular revogou o consentimento em ${c.revogadoEm}.`, acao: 'Revogação vale imediatamente (art. 18, IX).' };
    }
    if (!c?.em) {
        return { pode: false, motivo: `Não há consentimento registrado para "${e.rotulo}".`, acao: 'Registre o consentimento do titular antes de enviar comunicação dessa natureza.' };
    }
    return { pode: true };
}

/** Filtro da lista de contatos — puro, e é o MESMO que a tela usa. */
export function filtrarContatos(contatos = [], { busca = '', etiqueta = '', semEtiqueta = false } = {}) {
    const q = String(busca || '').trim().toLowerCase();
    const digitos = q.replace(/\D/g, '');
    return (contatos || []).filter((c) => {
        if (semEtiqueta && (c.etiquetas || []).length) return false;
        if (etiqueta && !(c.etiquetas || []).includes(etiqueta)) return false;
        if (!q) return true;
        const nome = String(c.nomePerfil || c.nome || '').toLowerCase();
        const emp = String(c.empresaNome || c.empresaNomeSugerido || '').toLowerCase();
        return nome.includes(q) || emp.includes(q)
            || (digitos.length >= 3 && String(c.numero || '').includes(digitos));
    });
}
