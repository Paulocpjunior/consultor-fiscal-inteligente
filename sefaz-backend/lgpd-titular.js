// ============================================================================
// sefaz-backend/lgpd-titular.js — os DIREITOS DO TITULAR (LGPD art. 18)
// ----------------------------------------------------------------------------
// Paulo, 17/08: *"devemos atender a lei de proteção de dados LGPD, evidenciar
// de forma enfática que estamos em acordo com a lei, sugiro isso no rodapé"*.
//
// 🚨 ESTE MÓDULO EXISTE PORQUE SELO NÃO É CONFORMIDADE.
//
// Escrever "estamos em conformidade com a LGPD" no rodapé é fácil e é a coisa
// mais perigosa que este app poderia fazer: vira uma AFIRMAÇÃO ao titular. Se
// amanhã alguém pedir os dados dele e a resposta for "não temos como fazer
// isso", o selo deixa de ser marketing e passa a ser prova — de informação
// enganosa — na mão de quem reclamar (a própria LGPD trata a transparência
// como princípio, art. 6º, VI).
//
// A régua desta casa já responde isso em outro domínio: **farol honesto**.
// Verde tem que significar alguma coisa. Então o que o rodapé afirma é o que
// o app FAZ — e é por isso que o mecanismo vem ANTES da frase:
//
//   · art. 18, II  (acesso)      → exportar TUDO que temos daquela pessoa;
//   · art. 18, VI  (eliminação)  → apagar, dizendo o que NÃO some e por quê;
//   · art. 18, IX  (revogação)   → já está nas etiquetas (whatsapp-etiquetas);
//   · art. 37      (registro)    → toda solicitação fica gravada com autor.
//
// E o que o app NÃO pode prometer sozinho (encarregado nomeado, contrato com
// operadores, política de retenção assinada) sai ESCRITO na página, em vez de
// escondido atrás de um cadeado verde.
// ============================================================================

/**
 * O que a lei nos OBRIGA a guardar mesmo depois do pedido de eliminação.
 *
 * O art. 16 é explícito: a eliminação não alcança o que é preciso para
 * cumprir obrigação legal, nem para exercício regular de direitos. Num
 * escritório contábil isso não é detalhe — o comprovante de que a guia foi
 * enviada ao cliente é justamente a prova que defende o escritório se ele
 * disser que nunca recebeu.
 *
 * Prometer "apagamos tudo" e depois guardar seria pior que não prometer.
 */
export const GUARDA_OBRIGATORIA = [
    {
        id: 'comprovante-envio',
        rotulo: 'Comprovantes de envio de guias e obrigações',
        motivo: 'É a prova de que a obrigação foi entregue ao cliente — exercício regular de direitos (LGPD art. 16, III) e prazo fiscal.',
    },
    {
        id: 'auditoria-permissoes',
        rotulo: 'Trilha de quem acessou e alterou',
        motivo: 'Registro das operações de tratamento (LGPD art. 37). Apagar a trilha destruiria justamente a prova de que os dados foram bem tratados.',
    },
    {
        id: 'documento-fiscal',
        rotulo: 'Documentos fiscais (notas, SPED, declarações)',
        motivo: 'Guarda obrigatória pela legislação tributária, independente do pedido do titular (LGPD art. 16, I).',
    },
];

/**
 * Monta o relatório de acesso (art. 18, II): TUDO que o app guarda sobre a
 * pessoa daquele número.
 *
 * Relatório que esconde categoria não serve ao titular — e a lista de
 * categorias sai do que foi realmente lido, com CONTAGEM, para que a ausência
 * de uma categoria seja visível em vez de silenciosa.
 */
export function montarRelatorioTitular({ numero, contato = null, conversa = null, mensagens = [], envios = [], catalogoEtiquetas = [] }) {
    const porId = new Map((catalogoEtiquetas || []).map((e) => [e.id, e]));
    const etiquetas = (contato?.etiquetas || []).map((id) => {
        const e = porId.get(id);
        return {
            id,
            rotulo: e?.rotulo || id,
            // A finalidade é o CENTRO da resposta ao titular: ele não quer saber
            // que existe uma etiqueta "lead", quer saber POR QUE foi classificado.
            finalidade: e?.finalidade || 'Finalidade não cadastrada — esta etiqueta precisa ser revista pelo administrador.',
            baseLegal: e?.baseLegal || null,
        };
    });

    return {
        numero,
        geradoEm: null,   // quem carimba a data é a rota (módulo puro não relogia)
        temCadastro: Boolean(contato),
        cadastro: contato ? {
            nome: contato.nomePerfil || null,
            empresaVinculada: contato.empresaNome || contato.empresaNomeSugerido || null,
            origem: contato.origem || null,
            criadoEm: contato.criadoEm || null,
            observacao: contato.observacao || null,
        } : null,
        etiquetas,
        consentimentos: Object.entries(contato?.consentimentos || {}).map(([id, c]) => ({
            etiqueta: id, registradoEm: c?.em || null, como: c?.como || null, revogadoEm: c?.revogadoEm || null,
        })),
        conversa: conversa ? {
            fila: conversa.fila || null, situacao: conversa.situacao || null,
            ultimaAtualizacao: conversa.atualizadoEm || null,
        } : null,
        mensagens: {
            total: mensagens.length,
            // Conteúdo de mensagem É dado pessoal e entra no relatório: entregar
            // só a contagem seria dizer "temos coisas suas" sem dizer o quê.
            itens: mensagens.map((m) => ({
                em: m.timestamp || null, direcao: m.direcao || null,
                tipo: m.tipo || null, texto: m.texto || null,
                temAnexo: Boolean(m.midia),
            })),
        },
        enviosDeGuia: {
            total: envios.length,
            itens: envios.map((e) => ({ tipo: e.tipo || null, competencia: e.competencia || null, em: e.enviadoEm || null, canal: e.canal || null })),
        },
        guardaObrigatoria: GUARDA_OBRIGATORIA,
    };
}

/**
 * Plano de eliminação (art. 18, VI): o que SAI, o que FICA e por quê.
 *
 * O app NÃO apaga em silêncio nem promete apagar tudo. Ele mostra o plano
 * ANTES, a pessoa confirma, e o que não pode sair vem NOMEADO — é a mesma
 * régua do "recusa que diz o estado e oferece a saída" (14/08).
 */
export function planoDeEliminacao({ numero, contato = null, mensagens = 0, envios = 0 }) {
    const remove = [];
    const mantem = [];

    if (contato) remove.push({ item: 'Cadastro do contato (nome, etiquetas, observações, consentimentos)', quantidade: 1 });
    else mantem.push({ item: 'Cadastro do contato', motivo: 'Não existe cadastro para este número — nada a remover.' });

    if (mensagens > 0) remove.push({ item: 'Mensagens da conversa (texto e anexos)', quantidade: mensagens });
    if (envios > 0) {
        mantem.push({
            item: `Comprovantes de envio de guia (${envios})`,
            motivo: GUARDA_OBRIGATORIA.find((g) => g.id === 'comprovante-envio').motivo,
        });
    }
    mantem.push({
        item: 'Registro desta própria solicitação',
        motivo: 'A lei exige o registro das operações de tratamento (art. 37) — é ele que prova que o pedido foi atendido.',
    });

    return {
        numero,
        remove,
        mantem,
        // Sem NADA a remover, a resposta não pode ser um "ok" que faz a pessoa
        // achar que algo aconteceu.
        nadaARemover: remove.length === 0,
        aviso: remove.length === 0
            ? 'Não há dado deste número no app para eliminar.'
            : 'Ao confirmar, os itens acima são apagados e não há como desfazer.',
    };
}

/** O registro que fica da solicitação — sem ele, "atendemos" é palavra. */
export function registroDaSolicitacao({ numero, tipo, quem, em, plano = null, motivoDoTitular = null }) {
    if (!['acesso', 'eliminacao'].includes(tipo)) return { ok: false, erro: `Tipo de solicitação desconhecido: ${tipo}.` };
    if (!numero) return { ok: false, erro: 'Informe o número do titular.' };
    if (!quem) return { ok: false, erro: 'A solicitação precisa do responsável que a atendeu.' };
    return {
        ok: true,
        registro: {
            numero, tipo, atendidoPor: quem, em,
            motivoDoTitular: motivoDoTitular || null,
            ...(plano ? { removidos: plano.remove, mantidos: plano.mantem } : {}),
        },
    };
}
