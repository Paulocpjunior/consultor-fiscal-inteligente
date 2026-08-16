// ============================================================================
// sefaz-backend/whatsapp-chamadas.js — chamada de VOZ/VÍDEO no WhatsApp
// ----------------------------------------------------------------------------
// Pergunta do Paulo (16/08): *"como habilitar ou não a opção de ligação de
// voz/vídeo, já liberado pela Meta Brasil"*.
//
// 🚨 ESTE MÓDULO NÃO LIGA NADA. Ele SONDA e RELATA — e isso é decisão de
// desenho, não falta de trabalho:
//
//  (1) **Payload de API externa não se deduz.** É a lição que o MSG_ISN_023
//      (PGDAS-D sem movimento) e o MS0030 (R-2055) cobraram caro: leiaute
//      deduzido é aceito errado ou recusado inteiro. Aqui a fonte responde —
//      a sonda pergunta e mostra o CRU do que não souber nomear.
//
//  (2) **Ligar chamada muda o WhatsApp DO CLIENTE.** Habilitado, aparece o
//      botão de ligar na conversa dele, do lado do escritório. Se ninguém
//      atender do nosso lado, o cliente liga e **chama no vazio** — e a
//      leitura dele não é "o recurso está desligado", é "a SP não me atende".
//      Isso é pior que não ter o botão. Por isso ligar é decisão do Paulo,
//      com destino de atendimento definido ANTES.
//
// A régua de sempre: **indeterminado nunca vira "desligado"**. Rede que
// piscou não pode fazer alguém concluir que o recurso não existe na conta.
// ============================================================================

/**
 * Onde a chamada pode estar declarada. São CANDIDATOS — a sonda pergunta os
 * dois e relata o que cada um respondeu, em vez de cravar um caminho e
 * concluir "não existe" quando o caminho é que estava errado.
 */
export const CANDIDATOS_SONDA = [
    {
        id: 'settings',
        rotulo: 'Configurações do número (settings)',
        caminho: (phoneNumberId) => `${phoneNumberId}/settings`,
        hipotese: 'A Meta expõe a chamada como uma configuração DO NÚMERO.',
    },
    {
        id: 'campo-do-numero',
        rotulo: 'Campos do próprio número',
        caminho: (phoneNumberId) => `${phoneNumberId}?fields=id,display_phone_number,verified_name,status,quality_rating`,
        hipotese: 'A chamada aparece entre os campos do número (e serve de controle: se ESTE falhar, o problema é o token, não o recurso).',
    },
];

const LIGADO = /^(enabled|enable|true|on|ativo)$/i;
const DESLIGADO = /^(disabled|disable|false|off|inativo)$/i;

/** Acha, em profundidade, qualquer chave que fale de chamada (calling/call). */
export function acharBlocoDeChamada(corpo) {
    const achados = [];
    const visitar = (no, caminho) => {
        if (!no || typeof no !== 'object') return;
        for (const [k, v] of Object.entries(no)) {
            const aqui = caminho ? `${caminho}.${k}` : k;
            if (/^(calling|call_settings|calls?)$/i.test(k)) achados.push({ caminho: aqui, valor: v });
            if (v && typeof v === 'object') visitar(v, aqui);
        }
    };
    visitar(corpo, '');
    return achados;
}

/**
 * Interpreta UMA resposta da Meta. Situações possíveis:
 *  - `ligado` / `desligado`  → a conta respondeu sobre a chamada;
 *  - `nao-declarado`         → respondeu, e não há bloco de chamada (a conta
 *                              não expõe o recurso por este caminho);
 *  - `sem-permissao`         → o token não alcança (ação: permissão, não recurso);
 *  - `indeterminado`         → rede/erro. NUNCA vira "desligado".
 */
export function interpretarSondaChamadas(status, corpo) {
    if (status == null) {
        return { situacao: 'indeterminado', motivo: 'A sonda não obteve resposta da Meta.', acao: 'Tente de novo; se persistir, é rede ou o token expirou.', bruto: corpo ?? null };
    }
    if (status === 401 || status === 403) {
        return {
            situacao: 'sem-permissao',
            motivo: corpo?.error?.message || `A Meta recusou a consulta (HTTP ${status}).`,
            acao: 'O token precisa da permissão de gestão da conta (whatsapp_business_management). Isso não diz nada sobre a chamada estar ligada ou não.',
            bruto: corpo ?? null,
        };
    }
    if (status >= 400) {
        return {
            situacao: 'indeterminado',
            motivo: corpo?.error?.message || `HTTP ${status}`,
            acao: 'Erro na consulta — não dá pra afirmar que a chamada está desligada.',
            bruto: corpo ?? null,
        };
    }

    const blocos = acharBlocoDeChamada(corpo);
    if (!blocos.length) {
        return {
            situacao: 'nao-declarado',
            motivo: 'A Meta respondeu, e não veio nenhum campo de chamada por este caminho.',
            acao: 'Pode ser que a conta não tenha o recurso, ou que ele se declare em outro lugar — a resposta crua está abaixo.',
            bruto: corpo ?? null,
        };
    }

    // Achou o bloco: procura o estado DENTRO dele, sem inventar o nome do campo.
    for (const b of blocos) {
        const v = b.valor;
        const candidatos = typeof v === 'object' && v
            ? Object.entries(v).filter(([k]) => /status|enabled|state/i.test(k)).map(([, x]) => x)
            : [v];
        for (const c of candidatos) {
            const s = String(c);
            if (LIGADO.test(s)) return { situacao: 'ligado', campo: b.caminho, motivo: `A Meta diz que a chamada está LIGADA (${b.caminho} = ${s}).`, bruto: corpo };
            if (DESLIGADO.test(s)) return { situacao: 'desligado', campo: b.caminho, motivo: `A Meta diz que a chamada está DESLIGADA (${b.caminho} = ${s}).`, bruto: corpo };
        }
    }
    return {
        situacao: 'nao-reconhecido',
        campo: blocos[0].caminho,
        motivo: `Veio um bloco de chamada (${blocos[0].caminho}), mas o formato não é um que eu saiba ler.`,
        acao: 'A resposta crua está abaixo — é dela que sai a régua, e não de suposição.',
        bruto: corpo,
    };
}

/**
 * Junta as respostas dos candidatos numa conclusão. Uma resposta AFIRMATIVA
 * (ligado/desligado) manda; sem nenhuma, o veredito é o mais informativo, e
 * nunca "desligado" por omissão.
 */
export function concluirSonda(resultados = []) {
    const achou = resultados.find((r) => r.situacao === 'ligado' || r.situacao === 'desligado');
    if (achou) {
        return {
            veredito: achou.situacao,
            motivo: achou.motivo,
            respondeuPor: achou.candidato || achou.campo || null,
        };
    }
    if (resultados.some((r) => r.situacao === 'nao-reconhecido')) {
        const r = resultados.find((x) => x.situacao === 'nao-reconhecido');
        return { veredito: 'nao-reconhecido', motivo: r.motivo, acao: r.acao, respondeuPor: r.candidato || null };
    }
    if (resultados.some((r) => r.situacao === 'sem-permissao')) {
        const r = resultados.find((x) => x.situacao === 'sem-permissao');
        return { veredito: 'sem-permissao', motivo: r.motivo, acao: r.acao };
    }
    if (resultados.length && resultados.every((r) => r.situacao === 'nao-declarado')) {
        return {
            veredito: 'nao-declarado',
            motivo: 'Os dois caminhos responderam e nenhum trouxe campo de chamada.',
            acao: 'Confira no Gerenciador de WhatsApp da Meta se a chamada aparece para esta conta. A resposta crua de cada caminho está na tela.',
        };
    }
    return {
        veredito: 'indeterminado',
        motivo: 'Nenhum caminho respondeu de forma conclusiva.',
        acao: 'Não dá pra afirmar que a chamada está desligada — repita a sonda.',
    };
}

/**
 * O que o Paulo precisa saber ANTES de ligar. Não é aviso legal: é o efeito
 * que a decisão tem no cliente, e ele não aparece em lugar nenhum da tela da
 * Meta.
 */
export const ANTES_DE_LIGAR = [
    {
        titulo: 'O botão aparece no WhatsApp DO CLIENTE',
        texto: 'Habilitada, a chamada fica disponível na conversa dele, do lado do escritório. Não é um recurso só nosso: é uma porta que se abre para fora.',
    },
    {
        titulo: 'Chamada sem quem atenda é pior que chamada nenhuma',
        texto: 'Se o cliente liga e ninguém atende, a leitura dele não é "o recurso está desligado" — é "a SP não me atende". Antes de ligar, é preciso definir QUEM atende, em qual horário, e o que acontece fora dele.',
    },
    {
        titulo: 'O SP Connect hoje não é um telefone',
        texto: 'O painel atende mensagem, não chamada de voz. Ligar a chamada na Meta sem um destino que toque (HitPhone, ramal, celular do plantão) faz o telefone tocar no vazio.',
    },
    {
        titulo: 'Ligar e desligar não é neutro',
        texto: 'Cliente que já usou o botão e o encontra sumido entende como serviço retirado. A decisão vale mais tomada uma vez, com o destino pronto, do que testada e revertida.',
    },
];
