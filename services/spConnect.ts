// ============================================================================
// services/spConnect.ts — núcleo PURO do SP Connect (sem firebase, testável)
// ----------------------------------------------------------------------------
// Regras de apresentação do inbox que não podem divergir entre telas:
// a janela de 24h, o carimbo dos status de entrega e o rótulo do contato.
// A CONTA da janela é do backend (janela24hAte, gravada pelo webhook) —
// aqui só se LÊ o campo; recalcular seria a segunda régua.
// ============================================================================

export interface FilaAtendimento { id: string; rotulo: string }

export interface ConfigAtendimento {
    botAtivo: boolean;
    /** 'piloto' = só os números da lista · 'todos' = o dia do corte. */
    botAlcance: 'piloto' | 'todos';
    botNumerosPiloto: string[];
    avisarClienteTransferencia: boolean;
    avaliacaoAtiva: boolean;
    /** Escala da nota (5 ou 10) — a mensagem e o painel leem dela. */
    avaliacaoEscala: number;
    horario: { dias: number[]; turnos: { inicio: string; fim: string }[] };
    mensagens: Record<string, string>;
    /** `submenu` = opção-PORTA (1 nível): escolher abre as sub-opções; a fila do item é o fallback se o sub-menu esvaziar. */
    menu: { opcao: string; fila: string; rotulo: string; submenu?: { opcao: string; fila: string; rotulo: string }[] }[];
    /** Imagem enviada junto da confirmação de fila (URL pública). Fila sem entrada = só texto. */
    imagensPorFila: Record<string, string>;
    /** ⚡ Frases do composer (editáveis na ⚙️). Vazia = sem chips, escolha legítima. */
    respostasRapidas: string[];
    /** 📷 e-mails que atendem as DMs do Instagram; lista vazia = sem restrição. */
    instagramAtendentes: string[];
    /** 🔔 Aviso NATIVO do Teams (sino de Atividade via Graph) — nasce desligado. */
    avisoTeamsAtivo: boolean;
    /**
     * 🤖 IA de triagem: lê o texto livre do cliente e escolhe uma fila DO MENU
     * quando tem certeza; sem certeza, o menu de sempre. **Ela só classifica —
     * nunca responde ao cliente.** Nasce desligada (regra da casa: o que fala
     * com o CLIENTE nasce desligado).
     */
    triagemIaAtiva: boolean;
}

/**
 * O app está rodando DENTRO de um iframe (Teams)? Instrução de navegador
 * ("clique no cadeado ao lado do endereço") não serve lá — não há barra de
 * endereço, e quem manda na permissão é o PACOTE do app do Teams. Toda
 * mensagem de permissão (microfone, avisos) pergunta aqui antes de aconselhar.
 * O try/catch cobre webview que recusa até a comparação com window.top.
 */
export function dentroDeIframe(): boolean {
    try {
        return typeof window !== 'undefined' && window.self !== window.top;
    } catch {
        return true; // acesso negado a window.top só acontece emoldurado
    }
}

/** Rótulo curto pras fichas/chips (o rótulo cheio é o que o CLIENTE vê no menu). */
export function rotuloCurtoFila(id: string | null): string {
    const m: Record<string, string> = {
        recepcao: 'Recepção', financeiro: 'Financeiro', 'dp-folha': 'DP',
        fiscal: 'Fiscal', contabil: 'Contábil', legalizacao: 'Legalização',
        rh: 'RH', juridico: 'Jurídico',
    };
    return m[id || 'recepcao'] || (id || 'Recepção');
}

export interface ConversaResumo {
    numero: string;
    nome: string | null;
    empresaId: string | null;
    empresaNome?: string | null;
    fila: string | null;
    protocolo?: string | null;
    atribuidoA: string | null;
    /** Fila de ORIGEM da última transferência — selo "↪ veio de X" até assumirem. */
    transferidaDe?: string | null;
    /** Por qual NÚMERO do escritório a conversa entrou (2º número em diante). */
    canalId?: string | null;
    /** 'whatsapp' (padrão) ou 'instagram' (DM — selo 📷, composer só texto). */
    canal?: string;
    situacao: string;
    janela24hAte: string | null;
    // ☎️ status do cartão "Permitir" (fase 2 da chamada): null = nunca pedido
    permissaoLigacao?: { status: 'pendente' | 'aceita' | 'recusada'; pedidoEm?: string | null; em?: string | null; expiraEm?: string | null } | null;
    ultimaMensagem: { resumo: string; direcao: string; em: string } | null;
    naoLidas: number;
    atualizadoEm: string | null;
}

export interface MensagemInbox {
    id: string;
    /** 'interna' = nota do atendente — vive na thread e NUNCA sai pro cliente. */
    direcao: 'entrada' | 'saida' | 'interna' | null;
    tipo: string | null;
    texto: string | null;
    /** `link`: banner de fila (URL pública própria) — abre direto, sem o clique de baixar da Meta. */
    midia: { nomeArquivo: string | null; mime: string | null; baixada: boolean; link?: string | null } | null;
    timestamp: string | null;
    statusEntrega: string | null;
    erroEntrega: { codigo: number | null; detalhe: string | null; acao: string } | null;
}

// ── TODA HORA DESTA TELA SAI EM AMERICA/SAO_PAULO, EXPLÍCITO ────────────────
// Formatar pelo relógio do NAVEGADOR (o padrão do toLocaleString) mostraria
// horas diferentes pra quem estiver fora de SP — o expediente do escritório é
// UM só. Mesma decisão do horario-acesso.js (momentoEmSaoPaulo).
const FUSO_SP = 'America/Sao_Paulo';

function pedacosSp(t: number): { dia: string; data: string; hora: string } {
    const fmt = new Intl.DateTimeFormat('pt-BR', {
        timeZone: FUSO_SP, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return {
        dia: `${p.year}-${p.month}-${p.day}`,          // chave de comparação "mesmo dia em SP"
        data: `${p.day}/${p.month}`,
        hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`,
    };
}

/**
 * Estado da janela de 24h para a tela. `agora` entra por parâmetro (função
 * pura — e o teste não depende do relógio).
 */
export function estadoJanela(janela24hAte: string | null | undefined, agora: Date): {
    aberta: boolean; rotulo: string;
} {
    const ate = Date.parse(janela24hAte || '');
    if (!Number.isFinite(ate)) {
        return { aberta: false, rotulo: 'Sem janela de 24h — o cliente ainda não escreveu; envio inicial só por template.' };
    }
    if (ate <= agora.getTime()) {
        return { aberta: false, rotulo: 'Janela de 24h FECHADA — envio só por template aprovado.' };
    }
    const fim = pedacosSp(ate);
    const mesmoDia = fim.dia === pedacosSp(agora.getTime()).dia;
    return { aberta: true, rotulo: `Janela de 24h ABERTA — livre até ${mesmoDia ? '' : 'amanhã, '}${fim.hora}.` };
}

/** Carimbo visual do status de entrega (✓ ✓✓ ✓✓azul ✗). */
export function carimboStatus(statusEntrega: string | null | undefined): {
    simbolo: string; rotulo: string; tom: 'ok' | 'lido' | 'falha' | 'neutro';
} {
    switch (statusEntrega) {
        case 'enviado': return { simbolo: '✓', rotulo: 'enviado', tom: 'neutro' };
        case 'entregue': return { simbolo: '✓✓', rotulo: 'entregue', tom: 'ok' };
        case 'lido': return { simbolo: '✓✓', rotulo: 'lido', tom: 'lido' };
        case 'falhou': return { simbolo: '✗', rotulo: 'falhou', tom: 'falha' };
        default: return { simbolo: '·', rotulo: statusEntrega || 'sem status', tom: 'neutro' };
    }
}

/** Nome de exibição: nome do perfil > número formatado. Nunca string vazia. */
export function nomeExibicao(c: Pick<ConversaResumo, 'nome' | 'numero'> & { canal?: string }): string {
    if (c.nome && c.nome.trim()) return c.nome.trim();
    // DM do Instagram sem nome de perfil: o id (ig_1784…) NÃO é telefone —
    // formatá-lo como número mentiria; "Instagram" diz o que a conversa é.
    if (c.canal === 'instagram') return 'Instagram';
    return formatarNumeroBr(c.numero);
}

/** 5511964440000 → +55 11 96444-0000 (falhou o padrão? devolve cru, nunca esconde). */
export function formatarNumeroBr(numero: string): string {
    const d = String(numero || '').replace(/\D/g, '');
    const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
    if (!m) return numero || '';
    return `+55 ${m[1]} ${m[2]}-${m[3]}`;
}

/** Hora curta pro balão, SEMPRE no fuso de SP (dia+hora quando não é hoje). */
export function horaCurta(iso: string | null | undefined, agora: Date): string {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    const d = pedacosSp(t);
    if (d.dia === pedacosSp(agora.getTime()).dia) return d.hora;
    return `${d.data} ${d.hora}`;
}

/** Data+hora completas no fuso de SP (o painel 📡 usa; o webhook grava UTC). */
export function dataHoraSp(iso: string | null | undefined): string {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    return new Date(t).toLocaleString('pt-BR', { timeZone: FUSO_SP });
}

/**
 * Filtro da lista (busca + aba), puro pra teste. `aba` pode ser 'todas',
 * 'nao-lidas' ou o ID de uma fila — 'recepcao' casa fila null (não triada)
 * E fila 'recepcao' explícita.
 */
export function filtrarConversas(
    lista: ConversaResumo[],
    { busca, aba }: { busca: string; aba: string },
): ConversaResumo[] {
    const b = busca.trim().toLowerCase();
    return lista.filter((c) => {
        if (aba === 'nao-lidas' && !(c.naoLidas > 0)) return false;
        if (aba !== 'todas' && aba !== 'nao-lidas' && (c.fila || 'recepcao') !== aba) return false;
        if (!b) return true;
        return (c.nome || '').toLowerCase().includes(b)
            || c.numero.includes(b.replace(/\D/g, '') || '§')
            || (c.ultimaMensagem?.resumo || '').toLowerCase().includes(b);
    });
}

/**
 * 🔍 Busca DENTRO da conversa (Paulo, 21/08 — pendência 🟡 do de-para: a
 * busca só alcançava a lista). Pura, sobre as mensagens CARREGADAS da
 * thread; casa sem acento e sem caixa (o atendente digita "voce", a
 * mensagem tem "você") no texto E no nome do arquivo do anexo. Termo vazio
 * devolve tudo — a busca desligada não é filtro.
 */
export function filtrarMensagensDaThread(mensagens: MensagemInbox[], termo: string): MensagemInbox[] {
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const t = norm(termo.trim());
    if (!t) return mensagens;
    return mensagens.filter((m) => norm(m.texto || '').includes(t)
        || norm(m.midia?.nomeArquivo || '').includes(t));
}

/** Iniciais pro avatar (nome > número). Nunca vazio. */
export function iniciais(c: Pick<ConversaResumo, 'nome' | 'numero'>): string {
    const n = (c.nome || '').trim();
    if (n) {
        const partes = n.split(/\s+/);
        return (partes[0][0] + (partes[1]?.[0] || '')).toUpperCase();
    }
    return c.numero.slice(-2);
}

/** Rótulo da mídia no balão (a mídia em si abre na F2-PR3, com URL assinada). */
export function rotuloMidia(m: MensagemInbox['midia'], tipo: string | null): string | null {
    if (!m) return null;
    const nomes: Record<string, string> = {
        image: '🖼️ Imagem', document: '📎 Documento', audio: '🎙️ Áudio',
        video: '🎬 Vídeo', sticker: '🩹 Figurinha',
    };
    const base = m.nomeArquivo ? `📎 ${m.nomeArquivo}` : (nomes[tipo || ''] || '📎 anexo');
    return m.baixada ? base : `${base} (ainda na Meta — não baixado)`;
}
