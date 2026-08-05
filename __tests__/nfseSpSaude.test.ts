import { saudeNfseSp, empresaComFalhaNaCaptura, MAX_IDLE_HORAS } from '../sefaz-backend/nfse-sp-saude.js';

/**
 * Paulo, 05/08: "imagina o cliente esperando a guia p pagamento e o
 * colaborador não consegue capturar as nfs e só descobre tentando".
 *
 * O ponto não é o cron — é a LEITURA DO ZERO. Com o trilho quebrado,
 * "não houve nota" e "não conseguimos buscar" ficam idênticos na tela.
 */
const AGORA = Date.parse('2026-08-05T20:00:00Z');
const hAtras = (h: number) => AGORA - h * 3600 * 1000;

describe('saudeNfseSp — quando NÃO se pode confiar no zero', () => {
    it('nunca rodou: quebrado e zero não confiável', () => {
        const s = saudeNfseSp([], AGORA);
        expect(s.farol).toBe('quebrado');
        expect(s.zeroConfiavel).toBe(false);
        expect(s.motivo).toMatch(/nunca rodou/);
    });

    it('parado além da janela vira quebrado, com as horas', () => {
        const s = saudeNfseSp([{ executadoEm: hAtras(MAX_IDLE_HORAS + 5), status: 'sucesso', sucessos: 10 }], AGORA);
        expect(s.farol).toBe('quebrado');
        expect(s.motivo).toMatch(/não roda há 53h/);
        expect(s.zeroConfiavel).toBe(false);
    });

    it('última execução falhou: leva o erro junto', () => {
        const s = saudeNfseSp([{ executadoEm: hAtras(2), status: 'falha', erroFatal: 'login recusado pelo portal' }], AGORA);
        expect(s.farol).toBe('quebrado');
        expect(s.motivo).toMatch(/login recusado pelo portal/);
        expect(s.acao).toMatch(/Não conclua que o cliente não emitiu nota/);
    });

    it('ALL-FAILED nunca é verde (0 sucessos e N falhas)', () => {
        // Foi assim que a NFS-e SP passou semanas "verde" com 0/121.
        const s = saudeNfseSp([{ executadoEm: hAtras(1), status: 'sucesso', processadas: 121, sucessos: 0, falhas: 121 }], AGORA);
        expect(s.farol).toBe('quebrado');
        expect(s.motivo).toMatch(/0 sucesso\(s\) e 121 falha\(s\)/);
        expect(s.zeroConfiavel).toBe(false);
    });

    it('em andamento e interrompido são âmbar, nunca verde', () => {
        expect(saudeNfseSp([{ executadoEm: hAtras(1), status: 'iniciado' }], AGORA).farol).toBe('atencao');
        expect(saudeNfseSp([{ executadoEm: hAtras(1), status: 'interrompido' }], AGORA).farol).toBe('atencao');
    });

    it('sucesso parcial: âmbar e zero ainda NÃO confiável', () => {
        // A empresa do colaborador pode ser justamente uma das que falharam.
        const s = saudeNfseSp([{ executadoEm: hAtras(3), status: 'sucesso', processadas: 100, sucessos: 90, falhas: 10 }], AGORA);
        expect(s.farol).toBe('atencao');
        expect(s.zeroConfiavel).toBe(false);
        expect(s.acao).toMatch(/se o SEU cliente está entre as que falharam/);
    });

    it('captura limpa: verde e aí sim o zero vale', () => {
        const s = saudeNfseSp([{ executadoEm: hAtras(4), status: 'sucesso', processadas: 188, sucessos: 188, falhas: 0 }], AGORA);
        expect(s.farol).toBe('ok');
        expect(s.zeroConfiavel).toBe(true);
    });

    it('usa a execução MAIS RECENTE, não a primeira da lista', () => {
        const s = saudeNfseSp([
            { executadoEm: hAtras(30), status: 'sucesso', processadas: 5, sucessos: 5 },
            { executadoEm: hAtras(2), status: 'falha', erroFatal: 'timeout' },
        ], AGORA);
        expect(s.farol).toBe('quebrado');
        expect(s.motivo).toMatch(/timeout/);
    });
});

describe('empresaComFalhaNaCaptura — "algumas falharam" vira "a SUA falhou"', () => {
    const logs = [{
        executadoEm: hAtras(1), status: 'sucesso', processadas: 100, sucessos: 99, falhas: 1,
        errosResumo: [{ cnpj: '09246389000124', ccm: '3702018', erroPrestador: 'CCM sem autorização do escritório' }],
    }];

    it('acha a empresa pelo CNPJ, com o erro dela', () => {
        const r = empresaComFalhaNaCaptura(logs, '09.246.389/0001-24');
        expect(r?.erro).toMatch(/CCM sem autorização/);
        expect(r?.ccm).toBe('3702018');
    });

    it('empresa que não falhou devolve null', () => {
        expect(empresaComFalhaNaCaptura(logs, '11111111000191')).toBeNull();
        expect(empresaComFalhaNaCaptura(logs, '')).toBeNull();
    });
});
