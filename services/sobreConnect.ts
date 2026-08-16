// ============================================================================
// services/sobreConnect.ts — o ℹ️ SOBRE do SP Connect
// ----------------------------------------------------------------------------
// Pedido do Paulo (16/08): *"criar um modal chamado SOBRE, nele deve conter um
// manual de uso para os colaboradores, um resumo das atualizações sempre que
// houver, um resumo do que nosso app é capaz, o que ele faz, conta um pouco
// sobre o porquê da sua criação, seus diferenciais em relação aos apps do
// mercado"*.
//
// POR QUE O CONTEÚDO MORA AQUI, e não no JSX do modal: (1) texto dentro de
// componente não se testa — e a trava deste arquivo é justamente comparar o
// manual com o que o app REALMENTE faz; (2) o mesmo conteúdo precisa alimentar
// o selo de "tem coisa nova", que é dado, não marcação.
//
// 🚨 O QUE NÃO PODE ACONTECER AQUI é o que já aconteceu no 📣 Novidades do CFI
// (Paulo, 15/08: *"o botão novidade você não está inserindo o detalhe em
// vermelho que sinaliza que algo foi feito"*): onze dias de entrega com o selo
// apagado. A régua de comparação é IMPORTADA do novidadesService — segunda
// cópia divergiria — e `__tests__/sobreConnect.test.ts` derruba o build quando
// a versão não bate com a primeira revisão do histórico, ou quando um comando
// do bot existe e o manual não ensina.
// ============================================================================
import { temNovidadeNaoLida, versaoVistaEm, marcarVistaEm } from './novidadesService';

/**
 * Data da revisão MAIS NOVA do histórico abaixo. Mudou o app → entra revisão
 * nova em `REVISOES` e esta constante acompanha, NO MESMO PR. Entregar sem
 * avisar é quase não entregar.
 */
export const SOBRE_VERSAO = '2026-08-16';

const CHAVE_LOCAL = 'spconnect_sobre_lido';

export interface Bloco {
    titulo: string;
    texto: string;
}

export interface PassoManual {
    titulo: string;
    passos: string[];
    /** Ressalva que evita o erro caro daquele passo (não é enfeite). */
    atencao?: string;
}

export interface Revisao {
    data: string;   // AAAA-MM-DD
    itens: string[];
}

// ─── Por que o SP Connect existe ────────────────────────────────────────────
export const POR_QUE = `O atendimento do escritório rodava numa plataforma alugada, a Ultra Fox. Ela funcionava, mas era uma ilha: as conversas viviam fora do CFI, ninguém no atendimento enxergava a carteira do cliente, e o que a equipe combinava com ele no WhatsApp não encostava no trabalho fiscal que estava sendo feito ao lado. Quando o cliente perguntava "e a minha guia?", a resposta dependia de alguém abrir outro sistema e procurar.

O SP Connect nasceu para fechar essa distância. Ele usa a API oficial da Meta, com o número do próprio escritório, e mora dentro de casa: mesmo login do CFI, mesmo cadastro de empresas, mesma carteira de responsáveis. Quem atende passa a ver de quem está falando.

E há um ganho direto: sai a mensalidade da plataforma, fica só o custo de conversa que a Meta cobra. Mas não foi o preço que decidiu — foi o fato de que o atendimento é onde o cliente fala com a gente, e esse lugar não podia continuar sendo o único que não sabe nada sobre ele.`;

// ─── O que ele é capaz de fazer ─────────────────────────────────────────────
export const O_QUE_FAZ: Bloco[] = [
    {
        titulo: '💬 Atender pelo número do escritório',
        texto: 'Todas as conversas do WhatsApp num painel só, com histórico gravado, busca por nome, número ou conteúdo, e carimbo de entrega em cada mensagem enviada (enviado · entregue · lido).',
    },
    {
        titulo: '🤖 Triar sozinho quem chega',
        texto: 'O bot recebe, saúda, mostra o menu de departamentos e encaminha para a fila certa antes de qualquer pessoa gastar tempo com isso. Fora do horário, avisa que estamos fechados em vez de deixar a mensagem sem resposta.',
    },
    {
        titulo: '🗂 Separar por fila de departamento',
        texto: 'Cada conversa fica numa fila (Recepção, Fiscal, DP, Contábil, Financeiro, Legalização, RH, Jurídico). O colaborador vê as filas dele; a Recepção vê tudo. Transferir é um clique, e o histórico vai junto.',
    },
    {
        titulo: '📎 Receber e mandar anexo, foto e áudio',
        texto: 'Documento, imagem, vídeo e áudio abrem dentro da conversa. Dá para responder anexando arquivo ou gravando áudio pelo próprio painel.',
    },
    {
        titulo: '👤 Saber de quem se está falando',
        texto: 'A conversa se vincula ao cliente do cadastro do escritório e passa a mostrar quem é o responsável pela carteira dele e quais guias já foram enviadas.',
    },
    {
        titulo: '✅ Encerrar com avaliação',
        texto: 'O atendimento tem fim explícito, e o cliente recebe a pesquisa de nota (1 a 5). O painel 📊 mostra média, distribuição e as últimas avaliações.',
    },
    {
        titulo: '📝 Combinar entre a equipe sem o cliente ver',
        texto: 'Nota interna na própria conversa — fica no histórico, com autor e hora, e o cliente nunca recebe.',
    },
    {
        titulo: '🔔 Avisar de mensagem nova',
        texto: 'Som, pop-up do navegador e contador no título da aba. Com a chave de push publicada, o aviso também chega no celular com o app fechado.',
    },
    {
        titulo: '💼 Rodar onde a equipe já trabalha',
        texto: 'No navegador, instalado como aplicativo no celular (PWA) e dentro do Microsoft Teams.',
    },
];

// ─── Diferenciais frente ao que se compra pronto ────────────────────────────
export const DIFERENCIAIS: Bloco[] = [
    {
        titulo: 'Ele conhece o cliente — as plataformas genéricas, não',
        texto: 'Um atendimento de mercado sabe o número que escreveu. O SP Connect sabe qual empresa é aquela, quem responde pela carteira dela e o que já foi enviado. Isso não é integração paga por fora: é o mesmo banco de dados.',
    },
    {
        titulo: 'As filas são os departamentos REAIS do escritório',
        texto: 'Não é um CRM com "vendas / suporte" adaptado no grito. As oito filas são as áreas da casa, e a Recepção enxerga tudo porque é assim que a recepção trabalha.',
    },
    {
        titulo: 'Ele não promete o que não pode cumprir',
        texto: 'A regra da Meta é que, passadas 24h da última mensagem do cliente, só sai template aprovado. O painel diz isso na cara, antes de você escrever — em vez de deixar mandar e falhar em silêncio. Quando a Meta recusa, o erro vem traduzido com a ação, não com um código.',
    },
    {
        titulo: 'O histórico é do escritório',
        texto: 'As conversas ficam no banco da casa. Não há cancelamento de contrato que leve o histórico do atendimento junto, e não se paga para exportar o que já é nosso.',
    },
    {
        titulo: 'Quem pode o quê está escrito e é aplicado',
        texto: 'Colaborador enxerga a fila dele; gestor vê e atende tudo; só admin muda configuração. E toda mudança de permissão fica gravada com antes, depois e autor.',
    },
    {
        titulo: 'O custo é o da conversa, não o da plataforma',
        texto: 'Sem mensalidade de licença por atendente. O que se paga é o que a Meta cobra pelas conversas — e ele já nasce pronto para um segundo número, sem contrato novo.',
    },
];

// ─── Manual do colaborador ──────────────────────────────────────────────────
export const MANUAL: PassoManual[] = [
    {
        titulo: '1. Ligar os avisos (faça isto no primeiro dia)',
        passos: [
            'Ao abrir o SP Connect, a barra amarela pede permissão de notificação — clique em 🔔 Ligar avisos e aceite no navegador.',
            'Dê um clique em qualquer lugar da tela: o som só é liberado depois do primeiro clique (é regra do navegador, não do app).',
            'Se aparecer 📱 Avisar também no celular, clique — é o aviso que chega com o app fechado.',
        ],
        atencao: 'Enquanto a barra amarela estiver na tela, existe um aviso desligado. Ela some sozinha quando tudo está ligado.',
    },
    {
        titulo: '2. Achar a conversa',
        passos: [
            'Os chips no topo filtram: Todas, Não lidas e uma por fila que você atende.',
            'A busca acha por nome, número ou pelo conteúdo das mensagens.',
            'A lista se atualiza sozinha a cada 30 segundos; 🔄 força na hora.',
        ],
    },
    {
        titulo: '3. Assumir antes de responder',
        passos: [
            'Clique em 🙋 Assumir pra mim. O seu nome passa a aparecer na conversa para toda a equipe.',
            'Terminou e quer devolver para a fila? ↩️ Liberar a conversa.',
        ],
        atencao: 'Se a conversa já está em condução por outra pessoa, o painel avisa. Dois atendentes respondendo o mesmo cliente é o erro que o cliente mais percebe.',
    },
    {
        titulo: '4. Responder',
        passos: [
            'A faixa acima da conversa diz se a janela de 24h está aberta (verde) ou fechada (amarela).',
            'Janela ABERTA: escreva normalmente.',
            'Janela FECHADA: só sai template aprovado — use ✚ Nova e escolha o template.',
        ],
        atencao: 'A janela conta a partir da última mensagem que o CLIENTE mandou. É regra da Meta: o app não contorna, porque a mensagem seria recusada de qualquer jeito.',
    },
    {
        titulo: '5. Mandar arquivo, foto ou áudio',
        passos: [
            '📎 anexa arquivo, foto ou documento. O texto que você já escreveu vira a legenda.',
            '🎤 grava áudio pelo próprio painel: grave, ouça a prévia e envie (ou descarte).',
        ],
        atencao: 'Áudio não aceita legenda — se você escrever e gravar um áudio, o texto não vai junto; mande em duas mensagens. O app avisa antes.',
    },
    {
        titulo: '6. Transferir para outro departamento',
        passos: [
            'Escolha o destino em ↪️ Transferir de fila e confirme.',
            'A conversa sai da sua condução e entra na fila do outro departamento, com o histórico inteiro.',
            'Fica uma nota automática na thread dizendo quem transferiu, de onde e para onde.',
        ],
        atencao: 'Com a chave ligada na ⚙️, o cliente também recebe um aviso de que está sendo transferido — assim ele não acha que foi ignorado.',
    },
    {
        titulo: '7. Combinar com a equipe sem o cliente ver',
        passos: [
            'Clique em 📝 Nota interna, escreva e grave.',
            'Ela aparece na conversa com borda tracejada e o aviso "o cliente não vê".',
        ],
        atencao: 'Nota interna nunca é enviada ao cliente — mas é registro do escritório: escreva o que você assinaria.',
    },
    {
        titulo: '8. Encerrar e pedir a avaliação',
        passos: [
            '✅ Encerrar atendimento marca a conversa como resolvida.',
            'Com a pesquisa ligada na ⚙️, o cliente recebe na hora o pedido de nota de 1 a 5.',
            'As notas aparecem no 📊 (média, distribuição e as últimas).',
        ],
        atencao: 'Encerrar é de quem conduz a conversa — ou de gestor e admin. Se o botão estiver travado, assuma a conversa (🙋) primeiro.',
    },
    {
        titulo: '9. Vincular a conversa ao cliente do escritório',
        passos: [
            'Em 🔗 Vincular ao cliente, busque por nome ou CNPJ e confirme.',
            'A partir daí a coluna do cliente mostra o responsável pela carteira e as guias já enviadas.',
        ],
        atencao: 'Fica gravado quem vinculou. Vincular no cliente errado mistura o histórico de duas empresas — confira o CNPJ.',
    },
    {
        titulo: '10. O que o CLIENTE consegue fazer sozinho',
        passos: [
            '#menu — ele pede o menu de novo, em qualquer momento, e escolhe outro departamento sem precisar de nós.',
            '#sair — ele encerra o próprio atendimento (e recebe a pesquisa de avaliação, se estiver ligada).',
        ],
        atencao: 'Esses comandos só funcionam com o bot ligado na ⚙️. Enquanto o bot estiver desligado, quem encaminha é a equipe.',
    },
    {
        titulo: '11. Quem pode o quê',
        passos: [
            'Colaborador: atende as filas ligadas ao seu nome, transfere e encerra o atendimento que ele conduz.',
            'Gestor: vê e atende tudo, encerra qualquer atendimento — só não mexe em configuração.',
            'Admin: tudo, inclusive a ⚙️ (bot, horário, mensagens, menu, filas, números).',
        ],
        atencao: 'Não está enxergando uma fila que deveria? É cadastro: peça ao admin em ⚙️ → 👥 Atendentes.',
    },
];

// ─── Histórico de atualizações (mais nova PRIMEIRO) ─────────────────────────
export const REVISOES: Revisao[] = [
    {
        data: '2026-08-16',
        itens: [
            'ℹ️ SOBRE: este manual, com o histórico de atualizações e o selo vermelho quando houver novidade.',
            '🔔 Aviso de mensagem nova em três camadas: som, pop-up do navegador e contador no título da aba.',
            '📱 Push no celular com o app fechado — pronto, aguardando o admin publicar a chave Web Push.',
            '🎤 Gravar e enviar áudio pelo próprio painel.',
            '📎 Abrir o anexo recebido (imagem, áudio, vídeo e documento) e enviar anexo na conversa.',
            '📞 Preparado para um segundo número / segunda conta da Meta, com o roteamento de entrada por canal.',
            '✅ Encerramento de atendimento com pesquisa de avaliação (1 a 5) e painel 📊.',
            '👥 Papéis de atendimento: colaborador, gestor e admin, com as permissões aplicadas na tela e no servidor.',
            '↪️ Transferência entre departamentos, com nota automática e aviso opcional ao cliente.',
            '🔗 Vínculo da conversa com o cliente do escritório, mostrando responsável da carteira e guias enviadas.',
            '📥 Importação do backup da Ultra Fox (contatos e mensagens), com prévia antes de gravar.',
            '💼 App do Microsoft Teams e instalação no celular como aplicativo (PWA).',
        ],
    },
];

// ─── Selo "tem coisa nova" ──────────────────────────────────────────────────
/** A revisão mais nova do histórico — é ela que a versão precisa espelhar. */
export function revisaoMaisNova(): Revisao | null {
    return REVISOES[0] || null;
}

/** Este navegador já abriu a revisão atual? */
export function temSobreNaoLido(versaoAtual: string = SOBRE_VERSAO): boolean {
    return temNovidadeNaoLida(versaoAtual, versaoVistaEm(CHAVE_LOCAL));
}

/** Carimba a revisão como lida — só quando o colaborador ABRE o modal. */
export function marcarSobreComoLido(versao: string = SOBRE_VERSAO): void {
    marcarVistaEm(CHAVE_LOCAL, versao);
}

/** 2026-08-16 → 16/08/2026 (o histórico é lido por gente). */
export function dataBr(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
