import { resumoManifestacao } from '../services/manifestoService';

/**
 * Caso KJM (05/08): nota de 28/07 seguia como RESUMO e o colaborador só via
 * "sem produto". Se o botão de manifestar responder "0 manifestadas" sem
 * motivo, ele clica de novo achando que foi lentidão — e o motivo existe.
 */
describe('resumoManifestacao — zero manifestada nunca sai mudo', () => {
    it('manifestou: diz quantas e o que acontece depois', () => {
        const t = resumoManifestacao({ total: 3, sucessos: 3 });
        expect(t).toMatch(/3 de 3/);
        expect(t).toMatch(/PRÓXIMA captura/);
        expect(t).toMatch(/Reconferir/);
    });

    it('manifestou em parte: conta as falhas em vez de esconder', () => {
        expect(resumoManifestacao({ total: 5, sucessos: 3, falhas: 2 })).toMatch(/2 falharam/);
    });

    it('nada manifestado: mostra os motivos dominantes', () => {
        const t = resumoManifestacao({
            total: 0,
            diagnostico: {
                porMotivo: { 'Já manifestada': 12, 'Falhou há pouco — volta ao lote em ~4h': 3 },
                ultimaFalha: 'SEFAZ HTTP 500',
            },
        });
        expect(t).toMatch(/12× Já manifestada/);
        expect(t).toMatch(/3× Falhou há pouco/);
        expect(t).toMatch(/Última falha: SEFAZ HTTP 500/);
    });

    it('sem diagnóstico e sem total: diz que não há pendência, sem inventar', () => {
        expect(resumoManifestacao({ total: 0 })).toMatch(/Nenhum documento pendente/);
    });

    it('erro do backend aparece inteiro', () => {
        expect(resumoManifestacao({ erro: 'Cron secret inválido' })).toMatch(/Cron secret inválido/);
    });
});
