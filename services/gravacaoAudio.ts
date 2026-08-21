// ============================================================================
// services/gravacaoAudio.ts — regras da gravação de áudio do SP Connect
// ----------------------------------------------------------------------------
// A parte PURA fica aqui (formato, limites, mensagens de recusa) pra ser
// testável; o MediaRecorder em si vive no componente.
//
// DECISÕES QUE MANDAM:
// - **O formato sai do que o NAVEGADOR sabe gravar, na ordem que a META
//   aceita.** Gravar num formato que o WhatsApp recusa produz o pior
//   desfecho: o atendente fala 40 segundos e a mensagem não chega.
// - **Navegador sem suporte NÃO esconde o botão** — ele diz o motivo. Botão
//   que some faz a pessoa achar que o app está quebrado (e o Safari antigo
//   ainda é comum nos celulares do escritório).
// - **Permissão negada é RECUSA COM CAMINHO**: o navegador guarda o "não", e
//   sem dizer onde reverter a pessoa fica presa achando que é bug do app.
// - **Gravação longa demais é cortada com AVISO** — o limite real é o do
//   corpo da requisição (a régua do anexo), e estourar depois de falar 5
//   minutos jogaria fora o trabalho todo.
// ============================================================================

/**
 * Formatos na ordem de preferência: os dois primeiros são os que o WhatsApp
 * entrega nativamente; mp4/aac é a saída do Safari. `audio/webm` fica por
 * último — a Meta aceita como documento, mas o cliente perde o player.
 */
export const FORMATOS_AUDIO = [
    { mime: 'audio/ogg;codecs=opus', extensao: 'ogg' },
    { mime: 'audio/mp4', extensao: 'm4a' },
    { mime: 'audio/aac', extensao: 'aac' },
    { mime: 'audio/webm;codecs=opus', extensao: 'webm' },
];

/** Teto da gravação (o mesmo do anexo de áudio da Meta: 16 MB ≈ 20 min). */
export const LIMITE_SEGUNDOS = 5 * 60;

/**
 * 🚨 PISO da gravação — caso real, Paulo 20/08: clique de teste de ~1s no
 * Safari virou um `audio-....m4a` que a Meta aceitou no upload e recusou no
 * PROCESSAMENTO (131053), com o arquivo mostrando "0,0 MB". O Safari só sabe
 * gravar em `audio/mp4` (não tem ogg/opus), e o MediaRecorder dele produz um
 * MP4 que o WhatsApp não processa quando a gravação é curta demais — mesmo
 * com bytes não-zero, então o guard de "blob vazio" que já existia não pega
 * este caso.
 *
 * Barrar ANTES do envio evita o round-trip até a Meta falhar: a pessoa sabe
 * na hora, com a causa, em vez do áudio "sumir" depois de mandado.
 */
export const DURACAO_MINIMA_SEGUNDOS = 1.5;

export function duracaoSuficiente(segundos: number): boolean {
    return segundos >= DURACAO_MINIMA_SEGUNDOS;
}

export interface SuporteGravacao {
    suportado: boolean;
    mime?: string;
    extensao?: string;
    motivo?: string;
    acao?: string;
}

/**
 * O navegador grava? Em qual formato? `deps` existe pro teste — em produção
 * lê o MediaRecorder real.
 */
export function suporteDeGravacao(deps?: {
    temMediaRecorder?: boolean;
    temMicrofone?: boolean;
    aceita?: (mime: string) => boolean;
}): SuporteGravacao {
    const temMediaRecorder = deps?.temMediaRecorder
        ?? (typeof window !== 'undefined' && typeof (window as any).MediaRecorder !== 'undefined');
    const temMicrofone = deps?.temMicrofone
        ?? (typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia));

    if (!temMediaRecorder || !temMicrofone) {
        return {
            suportado: false,
            motivo: 'Este navegador não grava áudio.',
            acao: 'Grave o áudio no celular e envie como anexo (📎), ou use um navegador atualizado.',
        };
    }
    const aceita = deps?.aceita
        ?? ((mime: string) => Boolean((window as any).MediaRecorder?.isTypeSupported?.(mime)));
    const escolhido = FORMATOS_AUDIO.find((f) => aceita(f.mime));
    if (!escolhido) {
        return {
            suportado: false,
            motivo: 'Nenhum formato de áudio aceito pelo WhatsApp está disponível neste navegador.',
            acao: 'Envie o áudio como anexo (📎) — gravado fora do app ele chega igual.',
        };
    }
    return { suportado: true, mime: escolhido.mime, extensao: escolhido.extensao };
}

/** Nome do arquivo do áudio gravado (data no fuso de SP, legível no celular). */
export function nomeDoAudio(agora: Date, extensao = 'ogg'): string {
    const p = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(agora).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
    return `audio-${p.day}${p.month}-${p.hour}${p.minute}.${extensao}`;
}

/** mm:ss do cronômetro (a pessoa precisa saber quanto já falou). */
export function duracaoLegivel(segundos: number): string {
    const s = Math.max(0, Math.floor(segundos));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Traduz a recusa do getUserMedia — "erro" cru não diz o que fazer. */
export function traduzirErroDeMicrofone(erro: { name?: string; message?: string } | null | undefined): {
    erro: string; acao: string;
} {
    const nome = String(erro?.name || '');
    if (nome === 'NotAllowedError' || nome === 'SecurityError') {
        return {
            erro: 'O navegador bloqueou o microfone.',
            // O "não" fica GUARDADO — sem dizer onde reverter, a pessoa acha
            // que é defeito do app e tenta de novo pra sempre.
            acao: 'Clique no cadeado 🔒 ao lado do endereço → Microfone → Permitir, e recarregue a página.',
        };
    }
    if (nome === 'NotFoundError' || nome === 'OverconstrainedError') {
        return { erro: 'Nenhum microfone encontrado neste dispositivo.', acao: 'Conecte um microfone/fone, ou envie o áudio como anexo (📎).' };
    }
    if (nome === 'NotReadableError') {
        return { erro: 'O microfone está em uso por outro programa.', acao: 'Feche a outra chamada/gravação (Teams, HitPhone) e tente de novo.' };
    }
    return { erro: `Não foi possível gravar: ${erro?.message || nome || 'erro desconhecido'}`, acao: 'Tente de novo, ou envie o áudio como anexo (📎).' };
}

/** A gravação chegou ao teto? (o componente para sozinho e avisa). */
export function atingiuLimite(segundos: number): boolean {
    return segundos >= LIMITE_SEGUNDOS;
}

// ─── 🎙️ → MP3: a gravação é CONVERTIDA antes de enviar ─────────────────────
// Caso real (Paulo, 21/08, audio-2108-1430.m4a): o MP4 que o Safari grava a
// Meta aceita no UPLOAD e recusa no PROCESSAMENTO (131053) — mesmo com
// duração acima do piso. E no Chrome o MediaRecorder só grava webm, que a
// Meta trata como documento (o cliente perde o player). Convertendo a
// gravação pra MP3 (audio/mpeg — formato com player nativo no WhatsApp) os
// dois problemas somem de uma vez: todo navegador passa a enviar o MESMO
// formato, processável e audível.
//
// A conversão é local (lamejs, JS puro) — o áudio não sai do navegador até o
// envio normal. decodeAudioData quem faz é o componente (AudioContext não
// existe no jest); AQUI fica a parte pura e testável: PCM → MP3.

/** Taxa do MP3 de voz (96 kbps mono ≈ 720 KB/min — sobra folga no limite). */
export const MP3_KBPS = 96;

/**
 * Bytes de um Blob com fallback por FileReader — `blob.arrayBuffer()` só
 * existe do Safari 14 em diante, e Safari antigo ainda é comum nos celulares
 * do escritório (a mesma ressalva do suporteDeGravacao).
 */
export function lerBytesDoBlob(blob: Blob): Promise<ArrayBuffer> {
    if (typeof (blob as any).arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(leitor.result as ArrayBuffer);
        leitor.onerror = () => reject(new Error('não deu pra ler o áudio'));
        leitor.readAsArrayBuffer(blob);
    });
}

/** Float32 [-1,1] do WebAudio → Int16 que o encoder come. */
export function floatParaInt16(canal: Float32Array): Int16Array {
    const saida = new Int16Array(canal.length);
    for (let i = 0; i < canal.length; i++) {
        const v = Math.max(-1, Math.min(1, canal[i]));
        saida[i] = Math.round(v < 0 ? v * 0x8000 : v * 0x7fff);
    }
    return saida;
}

/**
 * PCM mono → MP3. O import do lamejs é dinâmico de propósito: o encoder só
 * entra no bundle de quem grava áudio, não no carregamento do app.
 */
export async function codificarMp3(pcm: Int16Array, taxaAmostragem: number): Promise<Blob> {
    // O pacote entrega ESM e CJS; conforme o empacotador, o construtor vem
    // como named export ou dentro do default — as duas formas são lidas.
    const mod: any = await import('@breezystack/lamejs');
    const Mp3Encoder = mod.Mp3Encoder || mod.default?.Mp3Encoder;
    const enc = new Mp3Encoder(1, taxaAmostragem, MP3_KBPS);
    const partes: Uint8Array[] = [];
    const BLOCO = 1152; // tamanho de frame do MP3
    for (let i = 0; i < pcm.length; i += BLOCO) {
        const b = enc.encodeBuffer(pcm.subarray(i, i + BLOCO));
        if (b.length) partes.push(new Uint8Array(b));
    }
    const fim = enc.flush();
    if (fim.length) partes.push(new Uint8Array(fim));
    return new Blob(partes as BlobPart[], { type: 'audio/mpeg' });
}

/**
 * Gravação (qualquer formato do navegador) → MP3, decodificando com o
 * AudioContext do próprio navegador. Canais viram MONO por média — voz é
 * mono por natureza, e metade dos bytes.
 * Falha na decodificação NÃO derruba o envio: devolve null e o componente
 * manda o blob original (o comportamento de antes), com o formato dito.
 */
export async function converterGravacaoParaMp3(blob: Blob, criarContexto?: () => {
    decodeAudioData: (b: ArrayBuffer) => Promise<{
        numberOfChannels: number; sampleRate: number; length: number;
        getChannelData: (c: number) => Float32Array;
    }>;
    close?: () => Promise<void> | void;
}): Promise<Blob | null> {
    try {
        const Ctx = (typeof window !== 'undefined')
            ? ((window as any).AudioContext || (window as any).webkitAudioContext)
            : null;
        const ctx = criarContexto ? criarContexto() : (Ctx ? new Ctx() : null);
        if (!ctx) return null;
        try {
            const audio = await ctx.decodeAudioData(await lerBytesDoBlob(blob));
            const canais = audio.numberOfChannels;
            const mono = new Float32Array(audio.length);
            for (let c = 0; c < canais; c++) {
                const dados = audio.getChannelData(c);
                for (let i = 0; i < mono.length; i++) mono[i] += dados[i] / canais;
            }
            return await codificarMp3(floatParaInt16(mono), audio.sampleRate);
        } finally {
            try { await ctx.close?.(); } catch { /* contexto já fechado */ }
        }
    } catch {
        return null;
    }
}
