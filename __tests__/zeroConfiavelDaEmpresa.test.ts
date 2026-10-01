import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
    saudeNfseSp, zeroConfiavelDaEmpresa, zeroConfiavelParaCompetencia, periodoCobreMesInteiro, LIMITE_ERROS_RESUMO,
} from '../sefaz-backend/nfse-sp-saude.js';
// @ts-expect-error — módulo .js puro (sem tipos)
import { montarPainelIssCarteira } from '../sefaz-backend/iss-carteira';

/**
 * Paulo, 01/10, na ALMEIDA e na BRISKA: "agora diz que está incerto as notas
 * da prefeitura de SP, porém consultei na prefeitura e no consultor e consta
 * as notas de serviços tomados da BRISKA".
 *
 * A régua antiga anulava o zero de TODA a carteira quando UMA empresa falhava
 * na rodada do portal. A trava cobra o fato: o zero é decidido com a prova
 * DESTA empresa — e o "não sei" continua "não sei" quando a prova falta.
 */
const BRISKA = '12345678000175';
const OUTRA = '99888777000166';
const INICIO = '2026-10-01T05:00:00.000Z';
const FIM = Date.parse('2026-10-01T05:20:00.000Z');
const AGORA = Date.parse('2026-10-01T15:00:00.000Z');
const SET_INTEIRO = { anoMes: '2026-09', dataInicio: '01/09/2026', dataFim: '30/09/2026' };
const OUT_PARCIAL = { anoMes: '2026-10', dataInicio: '01/10/2026', dataFim: '30/09/2026' };

const rodada = (over: any = {}) => ({
    iniciadoEm: INICIO, executadoEm: FIM, status: 'sucesso',
    processadas: 150, sucessos: 147, falhas: 3,
    periodos: [{ anoMes: '2026-08', dataInicio: '01/08/2026', dataFim: '31/08/2026' }, SET_INTEIRO],
    errosResumo: [{ cnpj: OUTRA, erroPrestador: 'HTTP 500 do portal' }, { cnpj: '11111111000111', motivo: 'timeout' }],
    ...over,
});
const visitada = (over: any = {}) => ({ ultimaSync: FIM - 60_000, erroPrestadas: null, erroTomadas: null, ...over });

describe('zeroConfiavelDaEmpresa — o caso da BRISKA', () => {
    it('falha de OUTRA empresa não anula o zero de quem o portal respondeu sem erro', () => {
        const logs = [rodada()];
        const saude = saudeNfseSp(logs, AGORA);
        // A régua geral, sozinha, não confia (alguém falhou) — era o bloqueio.
        expect(saude.zeroConfiavel).toBe(false);
        const r = zeroConfiavelDaEmpresa({ saude, logs, state: visitada(), cnpj: BRISKA, competencia: '2026-09' });
        expect(r.confiavel).toBe(true);
    });

    it('a empresa que falhou continua incerta, com o erro DELA na frase', () => {
        const logs = [rodada()];
        const r = zeroConfiavelDaEmpresa({
            saude: saudeNfseSp(logs, AGORA), logs, state: visitada(), cnpj: OUTRA, competencia: '2026-09',
        });
        expect(r.confiavel).toBe(false);
        expect(r.motivo).toContain('HTTP 500 do portal');
    });

    it('lista de erros cortada no limite: não dá para afirmar que a empresa está fora dela', () => {
        const errosResumo = Array.from({ length: LIMITE_ERROS_RESUMO }, (_, i) => ({ cnpj: `0000000000${String(i).padStart(4, '0')}`, motivo: 'x' }));
        const logs = [rodada({ falhas: 40, errosResumo })];
        const r = zeroConfiavelDaEmpresa({
            saude: saudeNfseSp(logs, AGORA), logs, state: visitada(), cnpj: BRISKA, competencia: '2026-09',
        });
        expect(r.confiavel).toBe(false);
        expect(r.motivo).toMatch(/40 falha/);
    });

    it('empresa que a rodada não visitou (estado anterior ao início) não ganha prova emprestada', () => {
        const logs = [rodada()];
        const r = zeroConfiavelDaEmpresa({
            saude: saudeNfseSp(logs, AGORA), logs,
            state: visitada({ ultimaSync: Date.parse(INICIO) - 86_400_000 }), cnpj: BRISKA, competencia: '2026-09',
        });
        expect(r.confiavel).toBe(false);
        expect(r.motivo).toMatch(/não chegou a esta empresa/);
    });

    it('sem estado nenhum da empresa: incerto', () => {
        const logs = [rodada()];
        const r = zeroConfiavelDaEmpresa({ saude: saudeNfseSp(logs, AGORA), logs, state: null, cnpj: BRISKA, competencia: '2026-09' });
        expect(r.confiavel).toBe(false);
    });

    it('rodada que não baixou o mês inteiro não prova o zero do mês', () => {
        const logs = [rodada({ periodos: [OUT_PARCIAL] })];
        const r = zeroConfiavelDaEmpresa({ saude: saudeNfseSp(logs, AGORA), logs, state: visitada(), cnpj: BRISKA, competencia: '2026-10' });
        expect(r.confiavel).toBe(false);
        expect(r.motivo).toMatch(/2026-10 inteiro/);
    });

    it('último download da empresa com erro gravado: incerto, com o erro', () => {
        const logs = [rodada()];
        const r = zeroConfiavelDaEmpresa({
            saude: saudeNfseSp(logs, AGORA), logs,
            state: visitada({ erroPrestadas: 'sessão expirada' }), cnpj: BRISKA, competencia: '2026-09',
        });
        expect(r.confiavel).toBe(false);
        expect(r.motivo).toContain('sessão expirada');
    });

    it('rodada sem falha nenhuma continua bastando (régua geral)', () => {
        const logs = [rodada({ falhas: 0, errosResumo: [] })];
        const saude = saudeNfseSp(logs, AGORA);
        expect(saude.zeroConfiavel).toBe(true);
        const r = zeroConfiavelDaEmpresa({ saude, logs, state: null, cnpj: BRISKA, competencia: '2026-09' });
        expect(r.confiavel).toBe(true);
    });
});

describe('registro POR MÊS da empresa (porPeriodo)', () => {
    it('mês inteiro baixado sem erro prova o zero, mesmo com a última rodada quebrada', () => {
        const logs = [{ iniciadoEm: INICIO, executadoEm: FIM, status: 'falha', erroFatal: 'login recusado' }];
        const state = { porPeriodo: { '2026-09': { mesInteiro: true, prestadas: 0, tomadas: 7, erroPrestadas: null, erroTomadas: null } } };
        const r = zeroConfiavelDaEmpresa({ saude: saudeNfseSp(logs, AGORA), logs, state, cnpj: BRISKA, competencia: '2026-09' });
        expect(r.confiavel).toBe(true);
    });

    it('mês com erro gravado: incerto, com o erro', () => {
        const state = { porPeriodo: { '2026-09': { mesInteiro: true, erroPrestadas: 'WAF bloqueou' } } };
        const r = zeroConfiavelDaEmpresa({ saude: null, logs: [], state, cnpj: BRISKA, competencia: '2026-09' });
        expect(r.confiavel).toBe(false);
        expect(r.motivo).toContain('WAF bloqueou');
    });

    it('mês baixado só em parte não prova nada sozinho', () => {
        const state = { porPeriodo: { '2026-10': { mesInteiro: false, erroPrestadas: null } } };
        const r = zeroConfiavelDaEmpresa({ saude: null, logs: [], state, cnpj: BRISKA, competencia: '2026-10' });
        expect(r.confiavel).toBe(false);
    });

    it('periodoCobreMesInteiro: do dia 1 ao último dia, e só isso', () => {
        expect(periodoCobreMesInteiro(SET_INTEIRO)).toBe(true);
        expect(periodoCobreMesInteiro({ anoMes: '2028-02', dataInicio: '01/02/2028', dataFim: '29/02/2028' })).toBe(true);
        expect(periodoCobreMesInteiro({ anoMes: '2026-09', dataInicio: '01/09/2026', dataFim: '29/09/2026' })).toBe(false);
        expect(periodoCobreMesInteiro({ anoMes: '2026-09', dataInicio: '22/09/2026', dataFim: '30/09/2026' })).toBe(false);
        expect(periodoCobreMesInteiro(null)).toBe(false);
    });
});

describe('a carteira de ISS usa a resposta da empresa', () => {
    const emp = { empresaId: 'b1', nome: 'BRISKA', cnpj: BRISKA, ccm: '46129308' };
    const ap = { empresaId: 'b1', notas: 0, tomadoNotas: 7, tomadoRetido: 0 };

    it('zero confiável da empresa: não vira "captura incerta"', () => {
        const logs = [rodada()];
        const zero = zeroConfiavelParaCompetencia({
            saude: saudeNfseSp(logs, AGORA), logs, estados: new Map([[BRISKA, visitada()]]), competencia: '2026-09',
        });
        const p = montarPainelIssCarteira({ empresas: [emp], apuracoes: [ap], zeroConfiavelPara: zero });
        expect(p.linhas[0].situacao).not.toBe('captura-incerta');
        expect(p.linhas[0].zeroConfiavel).toBe(true);
    });

    it('incerto: a ação diz o PORQUÊ desta empresa', () => {
        const logs = [rodada()];
        const zero = zeroConfiavelParaCompetencia({ saude: saudeNfseSp(logs, AGORA), logs, estados: new Map(), competencia: '2026-09' });
        const p = montarPainelIssCarteira({ empresas: [emp], apuracoes: [ap], zeroConfiavelPara: zero });
        expect(p.linhas[0].situacao).toBe('captura-incerta');
        expect(p.linhas[0].acao).toMatch(/não chegou a esta empresa/);
    });
});

describe('varredura: nenhuma tela decide o zero com a régua global', () => {
    const dir = join(__dirname, '..', 'sefaz-backend');
    const fontes = readdirSync(dir).filter((f) => f.endsWith('.js'))
        .map((f) => ({ f, src: readFileSync(join(dir, f), 'utf8') }));

    it('quem chama montarPainelIssCarteira passa a régua por empresa', () => {
        const chamadores = fontes.filter(({ f, src }) => f !== 'iss-carteira.js' && /montarPainelIssCarteira\(/.test(src));
        expect(chamadores.length).toBeGreaterThan(0);
        for (const { f, src } of chamadores) {
            expect({ f, usa: /zeroConfiavelParaCompetencia\(/.test(src) }).toEqual({ f, usa: true });
            expect({ f, global: /saude\?\.zeroConfiavel\s*&&/.test(src) }).toEqual({ f, global: false });
        }
    });

    it('o cron do portal grava o registro por mês da empresa', () => {
        const orq = fontes.find(({ f }) => f === 'nfse-sp-portal-orchestrator.js')!.src;
        expect(orq).toMatch(/porPeriodo/);
        expect(orq).toMatch(/periodoCobreMesInteiro\(/);
    });
});
