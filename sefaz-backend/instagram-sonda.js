// ============================================================================
// sefaz-backend/instagram-sonda.js — DM do Instagram: dá pra alcançar?
// ----------------------------------------------------------------------------
// Pergunta do Paulo (18/08): *"Conseguimos linkar as DM do nosso Instagram?
// E se sim somente para alguns atendentes?"*.
//
// 🚨 ESTE MÓDULO NÃO LINKA NADA. Ele SONDA e RELATA — mesma decisão de
// desenho do `whatsapp-chamadas.js`, e pela mesma razão: o token que já
// funciona pro WhatsApp (`WHATSAPP_CLOUD_TOKEN`) foi concedido para as
// permissões DO WHATSAPP (`whatsapp_business_management`,
// `whatsapp_business_messaging`). A API de Mensagens do Instagram é OUTRO
// produto da Graph API — exige Página do Facebook vinculada, conta
// profissional do Instagram conectada a ela, e permissões PRÓPRIAS
// (`pages_show_list`, `instagram_basic`, `instagram_manage_messages`,
// `pages_messaging`). Nada disso se deduz: SE o mesmo token alcança essas
// permissões só se sabe perguntando pra Meta com o token de verdade.
//
// A sonda testa CAMINHOS (não nomes de permissão que a gente cravaria à
// toa — é a mesma lição do CANDIDATOS_SONDA da chamada): um controle (o
// token em si responde?) e o caminho que REVELA página + Instagram
// vinculado, se existir. Achar a conta prova a IDENTIDADE; não prova
// sozinho que MENSAGENS funcionam — isso fica dito, não escondido atrás
// de um "apto" genérico.
// ============================================================================

export const CANDIDATOS_SONDA = [
    {
        id: 'token',
        rotulo: 'Identidade do token (controle)',
        caminho: () => 'me?fields=id,name',
        hipotese: 'Confirma que o token do WhatsApp responde a QUALQUER coisa fora do WhatsApp — se ESTE falhar, o problema é o token, não o Instagram.',
    },
    {
        id: 'paginas',
        rotulo: 'Páginas que o token gerencia + Instagram vinculado',
        caminho: () => 'me/accounts?fields=id,name,instagram_business_account{id,username}',
        hipotese: 'É aqui que aparece SE existe Página do Facebook que o token gerencia, e SE ela tem uma conta profissional do Instagram conectada.',
    },
];

/** Interpreta UMA resposta da Meta pra UM candidato. */
export function interpretarSondaInstagram(candidatoId, status, corpo) {
    if (status == null) {
        return { situacao: 'indeterminado', motivo: 'A sonda não obteve resposta da Meta.', acao: 'Tente de novo; se persistir, é rede ou o token expirou.', bruto: corpo ?? null };
    }
    if (status === 401 || status === 403) {
        return {
            situacao: 'sem-permissao',
            motivo: corpo?.error?.message || `A Meta recusou a consulta (HTTP ${status}).`,
            acao: 'O token do WhatsApp não tem a permissão pra este caminho — é esperado, ele foi concedido só pro WhatsApp. Instagram exige permissão própria no mesmo app da Meta.',
            bruto: corpo ?? null,
        };
    }
    if (status >= 400) {
        return {
            situacao: 'indeterminado',
            motivo: corpo?.error?.message || `HTTP ${status}`,
            acao: 'Erro na consulta — não dá pra concluir nada a partir daqui.',
            bruto: corpo ?? null,
        };
    }

    if (candidatoId === 'token') {
        if (corpo?.id) return { situacao: 'token-ok', motivo: `O token responde como "${corpo.name || corpo.id}".`, bruto: corpo };
        return { situacao: 'nao-reconhecido', motivo: 'A Meta respondeu 200 sem um id reconhecível.', acao: 'A resposta crua está abaixo.', bruto: corpo };
    }

    // candidatoId === 'paginas'
    const paginas = Array.isArray(corpo?.data) ? corpo.data : null;
    if (!paginas) {
        return { situacao: 'nao-reconhecido', motivo: 'A Meta respondeu, mas não veio uma lista de páginas onde eu esperava.', acao: 'A resposta crua está abaixo — é dela que sai a régua.', bruto: corpo };
    }
    if (!paginas.length) {
        return {
            situacao: 'sem-pagina',
            motivo: 'O token não enxerga NENHUMA Página do Facebook.',
            acao: 'Confira no Meta Business Suite se a Página do escritório está vinculada ao MESMO Business Manager da WABA, e se o app/token tem acesso a ela.',
            bruto: corpo,
        };
    }
    const comInstagram = paginas.find((p) => p.instagram_business_account?.id);
    if (comInstagram) {
        return {
            situacao: 'conta-encontrada',
            motivo: `Página "${comInstagram.name}" tem a conta do Instagram "@${comInstagram.instagram_business_account.username || comInstagram.instagram_business_account.id}" vinculada.`,
            pagina: { id: comInstagram.id, nome: comInstagram.name },
            instagram: { id: comInstagram.instagram_business_account.id, username: comInstagram.instagram_business_account.username || null },
            bruto: corpo,
        };
    }
    return {
        situacao: 'pagina-sem-instagram',
        motivo: `${paginas.length} página(s) encontrada(s) (${paginas.map((p) => p.name).join(', ')}), nenhuma com Instagram vinculado.`,
        acao: 'No Meta Business Suite, vincule a conta profissional do Instagram à Página do escritório — é lá que essa ligação se faz, não neste app.',
        bruto: corpo,
    };
}

/**
 * Junta as duas respostas num veredito. `conta-encontrada` manda (é a
 * resposta afirmativa); sem ela, o motivo do candidato 'paginas' é quem fala,
 * e 'token' só serve pra distinguir "problema geral de token" de "página
 * específica faltando".
 */
export function concluirSondaInstagram(resultados = []) {
    const paginas = resultados.find((r) => r.candidato === 'paginas');
    const token = resultados.find((r) => r.candidato === 'token');

    if (paginas?.situacao === 'conta-encontrada') {
        return {
            veredito: 'conta-encontrada',
            motivo: paginas.motivo,
            pagina: paginas.pagina,
            instagram: paginas.instagram,
            // 🚨 Achar a conta prova IDENTIDADE, não prova MENSAGEM. São
            // permissões diferentes na Graph API — dizer "apto" aqui seria
            // prometer o que esta sonda não testou.
            acao: 'Isso confirma QUAL conta é — falta confirmar se o token tem permissão de MENSAGEM (instagram_manage_messages/pages_messaging). Isso só se prova de verdade assinando o webhook e recebendo uma DM real, ou olhando as permissões do App no Meta for Developers.',
        };
    }
    if (paginas && paginas.situacao !== 'indeterminado' && paginas.situacao !== 'nao-reconhecido') {
        return { veredito: paginas.situacao, motivo: paginas.motivo, acao: paginas.acao };
    }
    if (token?.situacao === 'sem-permissao') {
        return { veredito: 'sem-permissao', motivo: token.motivo, acao: token.acao };
    }
    return {
        veredito: 'indeterminado',
        motivo: 'Nenhum caminho respondeu de forma conclusiva.',
        acao: 'Repita a sonda; se persistir, confira o token no Cloud Run.',
    };
}

/**
 * O que o Paulo precisa saber sobre o "só pra alguns atendentes" — a parte
 * que JÁ está pronta hoje, independente do que a sonda encontrar.
 */
export const SOBRE_RESTRINGIR_ATENDENTES = {
    titulo: 'O "só alguns atendentes" do Instagram é POR USUÁRIO — a lista mora nesta aba',
    texto: 'Decisão do Paulo (22/08): as DMs do Instagram são limitadas por USUÁRIO, não por departamento. A lista "Quem atende as DMs" (logo abaixo, admin edita) decide quem vê, abre e responde conversa 📷 — inclusive o push segue a mesma régua. Lista vazia = sem restrição (vale a regra de filas de sempre).',
};
