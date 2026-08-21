// ============================================================================
// Gravação de áudio do SP Connect — "ativar o envio de áudio saindo por nós"
// (Paulo, 16/08). O que estes testes protegem: o formato é o que a META
// aceita (gravar no formato errado = 40 segundos de fala que não chegam), e
// toda recusa tem CAMINHO (permissão negada fica guardada no navegador).
// ============================================================================
import {
    FORMATOS_AUDIO, LIMITE_SEGUNDOS, suporteDeGravacao, nomeDoAudio,
    duracaoLegivel, traduzirErroDeMicrofone, atingiuLimite,
    DURACAO_MINIMA_SEGUNDOS, duracaoSuficiente,
    floatParaInt16, codificarMp3, converterGravacaoParaMp3, lerBytesDoBlob,
} from '../services/gravacaoAudio';

describe('formato — o que a Meta aceita, na ordem', () => {
    it('ogg/opus vem primeiro (é o do WhatsApp) e webm por último', () => {
        expect(FORMATOS_AUDIO[0].mime).toContain('audio/ogg');
        expect(FORMATOS_AUDIO[FORMATOS_AUDIO.length - 1].mime).toContain('webm');
    });

    it('escolhe o PRIMEIRO que o navegador aceita', () => {
        const chrome = suporteDeGravacao({ temMediaRecorder: true, temMicrofone: true, aceita: (m) => m.includes('ogg') });
        expect(chrome).toMatchObject({ suportado: true, extensao: 'ogg' });
        // Safari: sem ogg, cai no mp4 — e NÃO no webm
        const safari = suporteDeGravacao({ temMediaRecorder: true, temMicrofone: true, aceita: (m) => m === 'audio/mp4' });
        expect(safari).toMatchObject({ suportado: true, mime: 'audio/mp4', extensao: 'm4a' });
    });

    it('navegador sem gravação NÃO esconde o botão — diz o motivo e a saída pelo 📎', () => {
        const r = suporteDeGravacao({ temMediaRecorder: false, temMicrofone: true });
        expect(r.suportado).toBe(false);
        expect(r.motivo).toContain('não grava áudio');
        expect(r.acao).toContain('📎');
    });

    it('sem NENHUM formato aceito, também recusa com caminho (em vez de gravar o que não chega)', () => {
        const r = suporteDeGravacao({ temMediaRecorder: true, temMicrofone: true, aceita: () => false });
        expect(r.suportado).toBe(false);
        expect(r.motivo).toContain('WhatsApp');
    });
});

describe('recusa do microfone tem CAMINHO', () => {
    it('permissão negada diz ONDE reverter — o navegador guarda o "não"', () => {
        const r = traduzirErroDeMicrofone({ name: 'NotAllowedError' });
        expect(r.erro).toContain('bloqueou');
        expect(r.acao).toContain('cadeado');
    });
    it('dentro do Teams NÃO fala em cadeado — lá não existe barra de endereço (Paulo, 21/08)', () => {
        const r = traduzirErroDeMicrofone({ name: 'NotAllowedError' }, true);
        expect(r.erro).toContain('Teams');
        expect(r.acao).not.toContain('cadeado');
        // O conselho tem que apontar o que resolve de verdade: o pacote do
        // app (devicePermissions) e o Permitir do próprio Teams.
        expect(r.acao).toContain('1.0.1');
        expect(r.acao).toContain('navegador');
    });
    it('microfone ocupado aponta o suspeito (Teams/HitPhone), não um erro genérico', () => {
        expect(traduzirErroDeMicrofone({ name: 'NotReadableError' }).acao).toContain('HitPhone');
    });
    it('sem microfone e erro desconhecido também saem com ação', () => {
        expect(traduzirErroDeMicrofone({ name: 'NotFoundError' }).acao).toContain('📎');
        expect(traduzirErroDeMicrofone({ name: 'Xyz', message: 'boom' }).erro).toContain('boom');
        expect(traduzirErroDeMicrofone(null).acao).toBeTruthy();
    });
});

describe('cronômetro e nome do arquivo', () => {
    it('mm:ss legível, sem número negativo', () => {
        expect(duracaoLegivel(0)).toBe('00:00');
        expect(duracaoLegivel(9)).toBe('00:09');
        expect(duracaoLegivel(75)).toBe('01:15');
        expect(duracaoLegivel(-5)).toBe('00:00');
    });
    it('o nome leva dia e hora de SÃO PAULO (o arquivo aparece no celular do cliente)', () => {
        // 16/08/2026 12:37 UTC = 09:37 em SP
        expect(nomeDoAudio(new Date('2026-08-16T12:37:00Z'), 'ogg')).toBe('audio-1608-0937.ogg');
        expect(nomeDoAudio(new Date('2026-08-16T12:37:00Z'), 'm4a')).toContain('.m4a');
    });
    it('o teto para a gravação antes de virar arquivo que o envio recusa', () => {
        expect(atingiuLimite(LIMITE_SEGUNDOS - 1)).toBe(false);
        expect(atingiuLimite(LIMITE_SEGUNDOS)).toBe(true);
    });
});

// 🚨 Caso real, Paulo 20/08: clique de teste (~1s) no Safari virou um
// audio/mp4 que a Meta aceitou no upload e recusou no processamento
// (131053, "0,0 MB") — o guard de blob vazio não pega isso, porque o
// arquivo tinha bytes, só era curto demais.
describe('piso de duração — grava curto demais falha DEPOIS, no WhatsApp', () => {
    it('abaixo do piso não é suficiente', () => {
        expect(duracaoSuficiente(0)).toBe(false);
        expect(duracaoSuficiente(0.9)).toBe(false);
        expect(duracaoSuficiente(DURACAO_MINIMA_SEGUNDOS - 0.01)).toBe(false);
    });
    it('no piso ou acima já basta', () => {
        expect(duracaoSuficiente(DURACAO_MINIMA_SEGUNDOS)).toBe(true);
        expect(duracaoSuficiente(5)).toBe(true);
    });
});

// 🚨 Caso real nº 2, Paulo 21/08 (audio-2108-1430.m4a): a duração passou do
// piso e a Meta AINDA recusou (131053) — o MP4 do MediaRecorder do Safari é
// que não processa lá, curto ou longo. A saída definitiva: converter TODA
// gravação pra MP3 (audio/mpeg — formato de player nativo no WhatsApp).
describe('🎙️→MP3 — a gravação é convertida antes do envio', () => {
    it('floatParaInt16 satura em vez de estourar (clipping vira teto, não ruído)', () => {
        const r = floatParaInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
        expect(r[0]).toBe(0);
        expect(r[1]).toBe(0x7fff);
        expect(r[2]).toBe(-0x8000);
        expect(r[3]).toBe(0x7fff);   // acima de 1 não passa do teto
        expect(r[4]).toBe(-0x8000);
        expect(r[5]).toBe(Math.round(0.5 * 0x7fff));
    });

    it('codificarMp3 produz um MP3 de verdade (bytes com frame sync, mime audio/mpeg)', async () => {
        // 1s de senoide a 44,1 kHz — pequeno o bastante pro teste, real o
        // bastante pro encoder ter o que codificar.
        const pcm = new Int16Array(44100);
        for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 20) * 8000);
        const blob = await codificarMp3(pcm, 44100);
        expect(blob.type).toBe('audio/mpeg');
        expect(blob.size).toBeGreaterThan(1000);
        // lerBytesDoBlob é o MESMO leitor da produção (fallback FileReader —
        // o Blob do jsdom, como o do Safari 13, não tem .arrayBuffer()).
        const bytes = new Uint8Array(await lerBytesDoBlob(blob));
        // Frame sync do MPEG: 11 bits em 1 (0xFF Ex/Fx) no primeiro frame.
        expect(bytes[0]).toBe(0xff);
        expect(bytes[1] & 0xe0).toBe(0xe0);
    });

    it('converterGravacaoParaMp3 decodifica via contexto injetado e devolve MP3 mono', async () => {
        const amostras = 22050; // 0,5s a 44,1 kHz
        const canalA = new Float32Array(amostras).fill(0.5);
        const canalB = new Float32Array(amostras).fill(-0.5);
        const ctx = {
            decodeAudioData: async () => ({
                numberOfChannels: 2, sampleRate: 44100, length: amostras,
                // média dos canais = silêncio — prova que o downmix é por MÉDIA
                getChannelData: (c: number) => (c === 0 ? canalA : canalB),
            }),
            close: async () => { /* noop */ },
        };
        const blob = await converterGravacaoParaMp3(new Blob([new Uint8Array(10)]), () => ctx);
        expect(blob).not.toBeNull();
        expect(blob!.type).toBe('audio/mpeg');
    });

    it('falha na decodificação devolve NULL — o componente manda o original, nunca perde a gravação', async () => {
        const ctx = { decodeAudioData: async () => { throw new Error('formato ilegível'); } };
        const r = await converterGravacaoParaMp3(new Blob([new Uint8Array(10)]), () => ctx as any);
        expect(r).toBeNull();
    });

    it('a tela converte ANTES da prévia e cai no original se a conversão falhar', () => {
        const tela = require('fs').readFileSync(require('path').join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');
        expect(tela).toMatch(/converterGravacaoParaMp3\(blob\)\.then/);
        expect(tela).toMatch(/mp3 \|\| blob/);
    });
});
