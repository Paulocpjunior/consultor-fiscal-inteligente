// ============================================================================
// services/somAviso.ts — o "plim" da mensagem nova, SEM arquivo externo.
// ----------------------------------------------------------------------------
// O CSP do app bloqueia mídia de fora e não vale carregar um .mp3 só pra
// isso: o som é SINTETIZADO no WebAudio (duas notas curtas, discretas).
//
// REGRA DO NAVEGADOR QUE MANDA AQUI: áudio só toca depois de um GESTO do
// usuário (clique/tecla). Sem isso o navegador engole o som em silêncio — e
// o atendente ficaria achando que o app avisa quando não avisa. Por isso o
// contexto é criado/retomado no primeiro gesto e a tela sabe dizer se o som
// está DESTRAVADO.
// ============================================================================

let ctx: AudioContext | null = null;

function pegarContexto(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    return ctx;
}

/** O som já pode tocar? (false = falta um clique nesta aba). */
export function somDestravado(): boolean {
    return Boolean(ctx && ctx.state === 'running');
}

/** Chamado no primeiro gesto do usuário — destrava o áudio da aba. */
export async function destravarSom(): Promise<boolean> {
    const c = pegarContexto();
    if (!c) return false;
    try {
        if (c.state === 'suspended') await c.resume();
        return c.state === 'running';
    } catch {
        return false;
    }
}

/**
 * Toca o aviso. Silencioso por natureza se o navegador não deixar — nunca
 * lança: falhar o som não pode derrubar o inbox.
 */
export function tocarAviso(volume = 0.18): void {
    const c = pegarContexto();
    if (!c || c.state !== 'running') return;
    try {
        const agora = c.currentTime;
        // Duas notas curtas (lá → dó#), o suficiente pra reconhecer sem irritar.
        [[880, 0], [1108.73, 0.12]].forEach(([hz, atraso]) => {
            const osc = c.createOscillator();
            const ganho = c.createGain();
            osc.type = 'sine';
            osc.frequency.value = hz;
            // Envelope curto: sem o fade, o som estala no fim.
            ganho.gain.setValueAtTime(0.0001, agora + atraso);
            ganho.gain.exponentialRampToValueAtTime(volume, agora + atraso + 0.01);
            ganho.gain.exponentialRampToValueAtTime(0.0001, agora + atraso + 0.16);
            osc.connect(ganho).connect(c.destination);
            osc.start(agora + atraso);
            osc.stop(agora + atraso + 0.18);
        });
    } catch {
        /* som é conforto, não função crítica */
    }
}
