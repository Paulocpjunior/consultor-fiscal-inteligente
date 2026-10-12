/**
 * Alerta de DARF do Consultor DP sem pagamento (dp-darf-nao-pago.js): os alvos
 * saem da auditoria do túnel (dp_dctfweb_log), a consulta só depois do
 * vencimento, "não localizado" só depois da carência e pagamento com outro
 * número pelo período de apuração. Datas fixas por parâmetro (sem relógio).
 */
// @ts-nocheck — módulo .js do backend
import {
    alvosDosLogs, precisaConsultar, passouCarencia, filtroPorPeriodo, classificar, documentoSituacao, situacoesParaDp,
    somarDiasUteis, idSituacao, DIAS_DE_ACOMPANHAMENTO,
} from '../sefaz-backend/dp-darf-nao-pago.js';

const CNPJ = '11222333000181';
const log = (extra = {}) => ({ operacao: 'darf', ok: true, cnpj: CNPJ, competencia: '2026-09', numeroDocumento: '07.20.26.293.0000001-1', vencimento: '2026-10-20', valor: 1234.56, empresaIdDp: 'E1', em: '2026-10-05T12:00:00Z', ...extra });

describe('alvos pela auditoria do túnel', () => {
    it('um alvo por CNPJ + competência, com todos os números; vencimento e valor da última emissão', () => {
        const alvos = alvosDosLogs([
            log(),
            log({ numeroDocumento: '0720262930000022', vencimento: '2026-10-20', valor: 1300, em: '2026-10-25T12:00:00Z' }),
            log({ competencia: '2026-08', numeroDocumento: '111', vencimento: null }),
            log({ ok: false, numeroDocumento: '999' }),
            log({ operacao: 'transmitir', numeroDocumento: '888' }),
            log({ numeroDocumento: 'número inválido!' }),
            log({ cnpj: '123' }),
        ]);
        expect(alvos).toEqual([
            { id: `${CNPJ}_2026-09`, cnpj: CNPJ, competencia: '2026-09', empresaIdDp: 'E1', numerosDocumento: ['07202629300000011', '0720262930000022'], vencimento: '2026-10-20', valor: 1300 },
            { id: `${CNPJ}_2026-08`, cnpj: CNPJ, competencia: '2026-08', empresaIdDp: 'E1', numerosDocumento: ['111'], vencimento: null, valor: 1234.56 },
        ]);
        expect(idSituacao(CNPJ, '2026-09')).toBe(`${CNPJ}_2026-09`);
    });
});

describe('quando consultar', () => {
    const [alvo] = alvosDosLogs([log()]);
    it('só depois do vencimento, uma vez por dia, até o fim do acompanhamento; pago encerra (salvo número novo)', () => {
        expect(precisaConsultar(alvo, null, '2026-10-20')).toEqual({ consultar: false, motivo: 'nao_venceu' });
        expect(precisaConsultar(alvo, null, '2026-10-21')).toEqual({ consultar: true, motivo: 'vencido' });
        expect(precisaConsultar(alvo, { situacao: 'aguardando', conferidoEm: '2026-10-21', numerosDocumento: alvo.numerosDocumento }, '2026-10-21').motivo).toBe('ja_conferido_hoje');
        expect(precisaConsultar(alvo, { situacao: 'pago', numerosDocumento: alvo.numerosDocumento }, '2026-10-22').motivo).toBe('pago');
        expect(precisaConsultar(alvo, { situacao: 'pago', numerosDocumento: ['outro'] }, '2026-10-22')).toEqual({ consultar: true, motivo: 'numero_novo' });
        const fim = new Date(2026, 9, 20 + DIAS_DE_ACOMPANHAMENTO + 1);
        const depois = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}-${String(fim.getDate()).padStart(2, '0')}`;
        expect(precisaConsultar(alvo, { situacao: 'nao_localizado', numerosDocumento: alvo.numerosDocumento }, depois).motivo).toBe('fim_do_acompanhamento');
        expect(precisaConsultar({ ...alvo, vencimento: null }, null, '2026-12-01').motivo).toBe('sem_vencimento');
    });
    it('carência em dias úteis, com feriado nacional', () => {
        expect(somarDiasUteis('2026-10-20', 3)).toBe('2026-10-23');
        expect(somarDiasUteis('2026-10-30', 3)).toBe('2026-11-05'); // 02/11 (Finados) não conta
        expect(passouCarencia(alvo, '2026-10-22')).toBe(false);
        expect(passouCarencia(alvo, '2026-10-23')).toBe(true);
        expect(filtroPorPeriodo(alvo, '2026-10-26')).toEqual({ dataInicial: '2026-10-01', dataFinal: '2026-10-26' });
    });
});

describe('classificação', () => {
    const [alvo] = alvosDosLogs([log()]);
    const naoLocalizado = { ok: true, documentos: [], situacoes: [{ numeroDocumento: '07202629300000011', localizado: false, pagamento: null }] };
    it('número localizado: pago', () => {
        const porNumero = { ok: true, situacoes: [{ numeroDocumento: '07202629300000011', localizado: true, pagamento: { numeroDocumento: '07202629300000011', dataArrecadacao: '2026-10-19', valorTotal: 1234.56 } }] };
        expect(classificar(alvo, porNumero, null, '2026-10-21')).toEqual({ situacao: 'pago', pagamento: { numeroDocumento: '07202629300000011', dataArrecadacao: '2026-10-19', valorTotal: 1234.56, outroDocumento: false }, aviso: null });
    });
    it('não localizado: aguardando na carência, alerta depois; pago com outro número pelo período de apuração', () => {
        expect(classificar(alvo, naoLocalizado, null, '2026-10-22').situacao).toBe('aguardando');
        expect(classificar(alvo, naoLocalizado, { ok: true, documentos: [], podeHaverMais: false }, '2026-10-23')).toEqual({ situacao: 'nao_localizado', pagamento: null, aviso: null });
        const outraCompetencia = { numeroDocumento: 'X1', periodoApuracao: '2026-08-31', dataArrecadacao: '2026-10-02', valorTotal: 10, desmembramentos: [] };
        const mesmaCompetencia = { numeroDocumento: 'X2', periodoApuracao: null, dataArrecadacao: '2026-10-21', valorTotal: 1240, desmembramentos: [{ periodoApuracao: '2026-09-30' }] };
        const r = classificar(alvo, naoLocalizado, { ok: true, documentos: [outraCompetencia, mesmaCompetencia] }, '2026-10-23');
        expect(r.situacao).toBe('pago');
        expect(r.pagamento).toEqual({ numeroDocumento: 'X2', dataArrecadacao: '2026-10-21', valorTotal: 1240, outroDocumento: true });
        // Página cheia na consulta por período: alerta com a ressalva.
        expect(classificar(alvo, naoLocalizado, { ok: true, documentos: [outraCompetencia], podeHaverMais: true }, '2026-10-23').aviso).toMatch(/pode haver pagamento com outro número/);
    });
    it('documento gravado e o que vai ao DP', () => {
        const d = documentoSituacao(alvo, { situacao: 'nao_localizado', pagamento: null, aviso: null }, '2026-10-23', { consultas: 2 });
        expect(d).toEqual({ cnpj: CNPJ, competencia: '2026-09', empresaIdDp: 'E1', numerosDocumento: ['07202629300000011'], vencimento: '2026-10-20', valor: 1234.56, situacao: 'nao_localizado', pagamento: null, aviso: null, conferidoEm: '2026-10-23', consultas: 3, erro: null });
        expect(Object.values(d).includes(undefined)).toBe(false);
        const lista = situacoesParaDp([{ ...d, competencia: '2026-08' }, d, { ...d, competencia: 'x' }]);
        expect(lista.map((x) => x.competencia)).toEqual(['2026-09', '2026-08']);
        expect(lista[0]).not.toHaveProperty('cnpj');
    });
});
