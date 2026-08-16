// ============================================================================
// services/spConnect.ts — núcleo PURO do SP Connect (sem firebase, testável)
// ----------------------------------------------------------------------------
// Regras de apresentação do inbox que não podem divergir entre telas:
// a janela de 24h, o carimbo dos status de entrega e o rótulo do contato.
// A CONTA da janela é do backend (janela24hAte, gravada pelo webhook) —
// aqui só se LÊ o campo; recalcular seria a segunda régua.
// ============================================================================

export interface ConversaResumo {
    numero: string;
    nome: string | null;
    empresaId: string | null;
    fila: string | null;
    situacao: string;
    janela24hAte: string | null;
    ultimaMensagem: { resumo: string; direcao: string; em: string } | null;
    naoLidas: number;
    atualizadoEm: string | null;
}

export interface MensagemInbox {
    id: string;
    direcao: 'entrada' | 'saida' | null;
    tipo: string | null;
    texto: string | null;
    midia: { nomeArquivo: string | null; mime: string | null; baixada: boolean } | null;
    timestamp: string | null;
    statusEntrega: string | null;
    erroEntrega: { codigo: number | null; detalhe: string | null; acao: string } | null;
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
    const fim = new Date(ate);
    const hh = String(fim.getHours()).padStart(2, '0');
    const mm = String(fim.getMinutes()).padStart(2, '0');
    const mesmoDia = fim.toDateString() === agora.toDateString();
    return { aberta: true, rotulo: `Janela de 24h ABERTA — livre até ${mesmoDia ? '' : 'amanhã, '}${hh}:${mm}.` };
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
export function nomeExibicao(c: Pick<ConversaResumo, 'nome' | 'numero'>): string {
    if (c.nome && c.nome.trim()) return c.nome.trim();
    return formatarNumeroBr(c.numero);
}

/** 5511964440000 → +55 11 96444-0000 (falhou o padrão? devolve cru, nunca esconde). */
export function formatarNumeroBr(numero: string): string {
    const d = String(numero || '').replace(/\D/g, '');
    const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
    if (!m) return numero || '';
    return `+55 ${m[1]} ${m[2]}-${m[3]}`;
}

/** Hora curta pro balão (dia+hora quando não é hoje). */
export function horaCurta(iso: string | null | undefined, agora: Date): string {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (d.toDateString() === agora.toDateString()) return hh;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hh}`;
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
