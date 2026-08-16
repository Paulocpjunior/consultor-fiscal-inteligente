// ============================================================================
// Gravação de áudio do SP Connect — "ativar o envio de áudio saindo por nós"
// (Paulo, 16/08). O que estes testes protegem: o formato é o que a META
// aceita (gravar no formato errado = 40 segundos de fala que não chegam), e
// toda recusa tem CAMINHO (permissão negada fica guardada no navegador).
// ============================================================================
import {
    FORMATOS_AUDIO, LIMITE_SEGUNDOS, suporteDeGravacao, nomeDoAudio,
    duracaoLegivel, traduzirErroDeMicrofone, atingiuLimite,
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
