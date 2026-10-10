/**
 * 🧾🔁 LANCHONETE JO-BRAS (09/10): o Fim de Mês de 07/2026 travava em "NFS-e de
 * SP com captura incerta" — zero NFS-e só vale como "sem ISS" com o mês
 * inteiro baixado do portal, e a rodada automática só alcança ~40 dias.
 * Lanchonete (Simples, só NFC-e) nunca emite nota de serviço.
 *
 * Duas saídas, as duas cobradas pelo FATO:
 *  1. a marca "não emite NFS-e" (autor, motivo): o zero vira resposta
 *     declarada; NFS-e aparecendo é ALERTA, nunca some;
 *  2. a captura do MÊS ENCERRADO de uma empresa: o download do mês inteiro,
 *     limpo e posterior à rodada, prova o mês por si.
 */
jest.mock('../sefaz-backend/secret-loader.js', () => ({ loadCertificate: jest.fn() }));
jest.mock('../sefaz-backend/nfse-sp-headless-login.js', () => ({ loginHeadlessPortalSp: jest.fn() }));
jest.mock('../sefaz-backend/nfse-sp-csv-importer.js', () => ({ importarCsvNfseSp: jest.fn() }));
jest.mock('firebase-admin', () => ({ __esModule: true, default: { apps: [{}], firestore: () => ({}) } }));

import {
    conferirMarcaSemNfse, marcaSemEmissaoDeNfse, efeitoDaMarcaNfse,
} from '../sefaz-backend/sem-emissao-nfse.js';
// @ts-expect-error — módulo .js puro (sem tipos)
import { aplicarIssNaRotina } from '../sefaz-backend/rotina-fiscal.js';
import { bloqueioDaEtapa } from '../sefaz-backend/fim-de-mes.js';
import { zeroConfiavelDaEmpresa } from '../sefaz-backend/nfse-sp-saude.js';
// @ts-expect-error — módulo .js
import { periodoDoMesEncerrado } from '../sefaz-backend/nfse-sp-portal-orchestrator';

const CNPJ = '58579529000191';
const ISS_INCERTO = {
    aplicavel: true, situacao: 'captura-incerta', notas: 0, aRecolher: 0, tomadoRetido: 0, tomadoNotas: 0,
    acao: 'Zero notas emitidas no mês e a captura desta empresa não está provada: …',
};
const etapa = (id: string) => ({ id, ordem: 1, nome: id, status: 'ok', resumo: '1 entrada(s) e 124 saída(s).', acao: null });
const rodar = (iss: any, marcaNfse: any = null, semEmissaoDeSaida = false) => aplicarIssNaRotina({
    iss, envios: [], captura: etapa('captura'), validacao: etapa('validacao'), guias: etapa('guias'), semEmissaoDeSaida, marcaNfse,
});
const MARCA = marcaSemEmissaoDeNfse({ nfsePropria: 'nao-emite', nfsePropriaMarca: { por: 'eunice@sp', em: '2026-10-09T13:00:00Z', motivo: 'lanchonete, só NFC-e' } });

describe('1 · a marca "não emite NFS-e"', () => {
    it('sem marca: a etapa 1 trava e oferece a porta da marca', () => {
        const r = rodar(ISS_INCERTO);
        expect(r.captura.status).toBe('atencao');
        expect(r.captura.resumo).toMatch(/captura incerta/);
        expect(r.captura.podeMarcarSemNfse).toBe(true);
        // A porta chega à tela do Fim de Mês.
        expect(bloqueioDaEtapa({ ...r.captura, status: 'atencao' }).podeMarcarSemNfse).toBe(true);
    });

    it('com a marca e zero NFS-e: o zero é a resposta declarada, nada trava', () => {
        const r = rodar(ISS_INCERTO, MARCA);
        expect(r.captura.status).toBe('ok');
        expect(r.captura.semNfseMarcada).toEqual(MARCA);
        expect(r.captura.podeMarcarSemNfse).toBe(false);
        expect(r.iss.situacao).toBe('sem-nfse-declarado');
    });

    it('com a marca e NFS-e emitida: ALERTA — a nota não some', () => {
        const r = rodar({ ...ISS_INCERTO, situacao: 'a-recolher', notas: 2 }, MARCA);
        expect(r.captura.status).toBe('atencao');
        expect(r.captura.resumo).toMatch(/2 NFS-e emitida\(s\), mas a empresa marcada como NÃO emite NFS-e/);
        expect(r.iss.notas).toBe(2);
    });

    it('a porta não aparece quando o problema é outro (nota sem ISS gravado)', () => {
        expect(efeitoDaMarcaNfse({ situacao: 'captura-incerta', notas: 3 }, null).podeMarcar).toBe(false);
    });

    it('marcar exige motivo; desfazer não', () => {
        expect(conferirMarcaSemNfse({ naoEmite: true, motivo: 'x', quem: 'a', agoraIso: 'T' }).ok).toBe(false);
        expect(conferirMarcaSemNfse({ naoEmite: false, quem: 'a', agoraIso: 'T' })).toEqual({
            ok: true, valor: { nfsePropria: 'esperada', nfsePropriaMarca: { por: 'a', em: 'T', motivo: 'desfeita' } },
        });
        expect(marcaSemEmissaoDeNfse({ nfsePropria: 'esperada' })).toBeNull();
    });
});

describe('2 · a captura do mês encerrado prova o mês', () => {
    it('07/2026 pedido em 09/10/2026: o mês INTEIRO', () => {
        expect(periodoDoMesEncerrado('2026-07', new Date(2026, 9, 9))).toEqual({
            ok: true, periodo: { dataInicio: '01/07/2026', dataFim: '31/07/2026', anoMes: '2026-07' },
        });
    });

    it('mês corrente ou futuro: recusa (a janela automática já cobre)', () => {
        expect(periodoDoMesEncerrado('2026-10', new Date(2026, 9, 9)).ok).toBe(false);
        expect(periodoDoMesEncerrado('2026-11', new Date(2026, 9, 9)).ok).toBe(false);
        expect(periodoDoMesEncerrado('07/2026', new Date(2026, 9, 9)).ok).toBe(false);
    });

    // A rodada geral (que só cobriu set/out) FALHOU para esta empresa…
    const rodada = {
        iniciadoEm: '2026-10-09T05:00:00.000Z', executadoEm: '2026-10-09T05:20:00.000Z', status: 'sucesso',
        sucessos: 100, falhas: 1, periodos: [{ anoMes: '2026-09', dataInicio: '01/09/2026', dataFim: '30/09/2026' }],
        errosResumo: [{ cnpj: CNPJ, erroPrestador: 'HTTP 500 do portal' }],
    };
    const julho = (em: string) => ({
        ultimaSync: Date.parse(em),
        porPeriodo: { '2026-07': { em, dataInicio: '01/07/2026', dataFim: '31/07/2026', mesInteiro: true, prestadas: 0, tomadas: 0, erroPrestadas: null, erroTomadas: null } },
    });

    it('…mas a captura de julho feita DEPOIS dela, inteira e limpa, prova julho', () => {
        const r = zeroConfiavelDaEmpresa({ logs: [rodada], state: julho('2026-10-09T14:00:00.000Z'), cnpj: CNPJ, competencia: '2026-07' });
        expect(r).toEqual({ confiavel: true, via: 'periodo-da-empresa', motivo: null });
    });

    it('captura de julho ANTERIOR à rodada que falhou: a falha continua dita', () => {
        const r = zeroConfiavelDaEmpresa({ logs: [rodada], state: julho('2026-10-08T14:00:00.000Z'), cnpj: CNPJ, competencia: '2026-07' });
        expect(r.confiavel).toBe(false);
        expect(r.motivo).toMatch(/HTTP 500/);
    });

    it('captura de julho com erro não prova nada', () => {
        const st = julho('2026-10-09T14:00:00.000Z');
        st.porPeriodo['2026-07'].erroTomadas = 'timeout' as any;
        expect(zeroConfiavelDaEmpresa({ logs: [rodada], state: st, cnpj: CNPJ, competencia: '2026-07' }).confiavel).toBe(false);
    });
});
