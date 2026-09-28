/**
 * 🏁 SITUAÇÃO ESPECIAL no 0000 do EFD-Contribuições (GIRY 1365, 28/09).
 *
 * "Vou gerar um EFD de encerramento — essa opção será habilitada no
 * consultor? Gerei, validei no PVA e continua como um arquivo normal."
 *
 * Fatos cobrados (Guia Prático, registro 0000): campo 04 IND_SIT_ESP recebe
 * o código; a DATA DO EVENTO vai no DT_INI (abertura) ou no DT_FIN (cisão,
 * fusão, incorporação, encerramento); o outro extremo segue o mês. Sem
 * situação, o arquivo é o normal. Situação sem data ou fora do mês é RECUSA
 * dita — nunca arquivo normal em silêncio.
 */
// @ts-expect-error módulo .js puro sem tipos
import { conferirSituacaoEspecial, dataSped, SITUACOES_ESPECIAIS } from '../sefaz-backend/sped-contrib-situacao-especial.js';
// @ts-expect-error módulo .js puro sem tipos
import { buildBloco0Contrib } from '../sefaz-backend/sped-contrib-bloco0.js';

const dados = (over: any = {}) => ({
    empresa: { cnpj: '63575824000100', nome: 'GIRY COMERCIO E SERVICOS LTDA', dadosFiscais: { uf: 'SP', codMunIBGE: '3505708', indNatPJ: '00', indAtividade: 'servicos' } },
    competencia: '2026-08', competenciaInicio: '2026-08', competenciaFim: '2026-08',
    regimeApuracao: '1', notas: [], itens: [], unidades: [], participantes: [],
    warnings: [] as string[],
    ...over,
});
const campos0000 = (d: any) => (buildBloco0Contrib(d) as string[]).find((l) => l.startsWith('|0000|'))!.split('|');

describe('conferirSituacaoEspecial', () => {
    it('sem situação → arquivo normal (valor null), nada a recusar', () => {
        expect(conferirSituacaoEspecial({ competencia: '2026-08' })).toEqual({ ok: true, valor: null });
        expect(conferirSituacaoEspecial({ situacaoEspecial: '', competencia: '2026-08' })).toEqual({ ok: true, valor: null });
    });

    it('os cinco códigos do leiaute existem; encerramento leva a data ao DT_FIN, abertura ao DT_INI', () => {
        expect(Object.keys(SITUACOES_ESPECIAIS)).toEqual(['0', '1', '2', '3', '4']);
        const enc = conferirSituacaoEspecial({ situacaoEspecial: '4', dataEvento: '2026-08-20', competencia: '2026-08' });
        expect(enc.ok).toBe(true);
        expect(enc.valor).toMatchObject({ indSitEsp: '4', rotulo: 'Encerramento', dtIni: null, dtFin: '20082026' });
        const abe = conferirSituacaoEspecial({ situacaoEspecial: 0, dataEvento: '2026-08-05', competencia: '2026-08' });
        expect(abe.valor).toMatchObject({ indSitEsp: '0', dtIni: '05082026', dtFin: null });
    });

    it('recusa dita: código fora do leiaute, sem data, data ilegível/inexistente, data fora da competência', () => {
        expect(conferirSituacaoEspecial({ situacaoEspecial: '7', dataEvento: '2026-08-20', competencia: '2026-08' })).toMatchObject({ ok: false });
        expect(conferirSituacaoEspecial({ situacaoEspecial: '4', competencia: '2026-08' })).toMatchObject({ ok: false, erro: expect.stringMatching(/DATA DO EVENTO/) });
        expect(conferirSituacaoEspecial({ situacaoEspecial: '4', dataEvento: '20/08/2026', competencia: '2026-08' })).toMatchObject({ ok: false });
        expect(conferirSituacaoEspecial({ situacaoEspecial: '4', dataEvento: '2026-02-30', competencia: '2026-02' })).toMatchObject({ ok: false });
        expect(conferirSituacaoEspecial({ situacaoEspecial: '4', dataEvento: '2026-09-01', competencia: '2026-08' })).toMatchObject({ ok: false, erro: expect.stringMatching(/fora da competência/) });
    });

    it('dataSped: AAAA-MM-DD → DDMMAAAA', () => {
        expect(dataSped('2026-08-20')).toBe('20082026');
        expect(dataSped('')).toBe('');
    });
});

describe('o 0000 escreve a situação especial', () => {
    it('sem situação: IND_SIT_ESP vazio, DT_INI = 1º dia, DT_FIN = último dia do mês', () => {
        const c = campos0000(dados());
        expect(c[4]).toBe('');
        expect(c[6]).toBe('01082026');
        expect(c[7]).toBe('31082026');
    });

    it('encerramento em 20/08: IND_SIT_ESP=4, DT_INI segue o mês, DT_FIN = data do evento', () => {
        const conf = conferirSituacaoEspecial({ situacaoEspecial: '4', dataEvento: '2026-08-20', competencia: '2026-08' });
        const c = campos0000(dados({ situacaoEspecial: conf.valor }));
        expect(c[4]).toBe('4');
        expect(c[6]).toBe('01082026');
        expect(c[7]).toBe('20082026');
        // Só o 0000 muda: o resto do bloco continua com os mesmos registros.
        const semSit = (buildBloco0Contrib(dados()) as string[]).map((l) => l.split('|')[1]);
        const comSit = (buildBloco0Contrib(dados({ situacaoEspecial: conf.valor })) as string[]).map((l) => l.split('|')[1]);
        expect(comSit).toEqual(semSit);
    });

    it('abertura em 05/08: DT_INI = data do evento, DT_FIN segue o mês', () => {
        const conf = conferirSituacaoEspecial({ situacaoEspecial: '0', dataEvento: '2026-08-05', competencia: '2026-08' });
        const c = campos0000(dados({ situacaoEspecial: conf.valor }));
        expect(c[4]).toBe('0');
        expect(c[6]).toBe('05082026');
        expect(c[7]).toBe('31082026');
    });

    it('forma crua em `dados` (sem passar pela rota) também funciona, e inválida RECUSA em vez de sair normal', () => {
        const c = campos0000(dados({ situacaoEspecial: { situacaoEspecial: '3', dataEvento: '2026-08-15' } }));
        expect(c[4]).toBe('3');
        expect(c[7]).toBe('15082026');
        expect(() => buildBloco0Contrib(dados({ situacaoEspecial: { situacaoEspecial: '4' } }))).toThrow(/DATA DO EVENTO/);
    });
});
