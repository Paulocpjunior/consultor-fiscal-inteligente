import {
    formatMitDataEncerramento,
    getMitEncerramentoEstado,
} from '../components/DCTFWeb/mitApuracaoStatus';

describe('mitApuracaoStatus', () => {
    it('trata situacao 3 do MIT como apuracao encerrada', () => {
        const estado = getMitEncerramentoEstado(null, {
            situacao: 3,
            dataEncerramento: '20250218',
        });

        expect(estado.encerrada).toBe(true);
        expect(estado.emProcessamento).toBe(false);
        expect(estado.bloqueiaEncerramento).toBe(true);
        expect(estado.dataEncerramentoLabel).toBe('18/02/2025');
    });

    it('trata situacao 4 do MIT como encerramento em processamento', () => {
        const estado = getMitEncerramentoEstado({ SituacaoApuracao: 4 }, null);

        expect(estado.encerrada).toBe(false);
        expect(estado.emProcessamento).toBe(true);
        expect(estado.bloqueiaEncerramento).toBe(true);
    });

    it('mantem apuracao em aberto liberada para encerramento', () => {
        const estado = getMitEncerramentoEstado(null, { situacao: 2 });

        expect(estado.encerrada).toBe(false);
        expect(estado.emProcessamento).toBe(false);
        expect(estado.bloqueiaEncerramento).toBe(false);
    });

    it('formata data oficial AAAAMMDD quando disponivel', () => {
        expect(formatMitDataEncerramento('20260623')).toBe('23/06/2026');
        expect(formatMitDataEncerramento('2026-06-23')).toBe('23/06/2026');
        expect(formatMitDataEncerramento(null)).toBeNull();
    });
});
