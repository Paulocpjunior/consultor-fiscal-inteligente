/**
 * 📭 03/10 — Paulo: "incluir também, em modo informativo ao cliente, usando o
 * mesmo template, que naquele determinado mês não houve movimentação — após o
 * colaborador efetivar o fim do mês".
 *
 * Fatos cobrados: o informativo só sai para o mês que fechou pela DECLARAÇÃO de
 * sem movimento; uma vez por competência; o texto afirma o fato (nenhuma nota),
 * não "não há imposto"; e usa o mesmo layout dos e-mails de guia.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo .js puro
import { montarRotinaFiscal } from '../sefaz-backend/rotina-fiscal.js';
// @ts-expect-error — módulo .js puro
import { deveEnviarInformativo, montarInformativoSemMovimento } from '../sefaz-backend/informativo-sem-movimento.js';

const DECLARACAO = { declaradoPor: 'eunice@sp', quando: '2026-10-02', comoFoi: 'cliente confirmou por e-mail', em: '2026-10-02T12:00:00Z' };
const rotina = (over: any = {}) => montarRotinaFiscal({
    empresa: { nome: 'EMPRESA X', cnpj: '11111111000191' },
    competencia: '2026-09',
    documentos: [],
    declaracaoSemMovimento: DECLARACAO,
    ...over,
});

describe('quando o informativo sai', () => {
    it('mês fechado pela declaração de sem movimento: sai (a fixture chega no ramo)', () => {
        const r = rotina();
        expect(r.etapas.find((e: any) => e.id === 'captura').semMovimentoDeclarado).toBe(true);
        expect(deveEnviarInformativo({ rotina: r, anterior: null })).toBe(true);
    });

    it('sem declaração (zero nota não é sem movimento): não sai', () => {
        expect(deveEnviarInformativo({ rotina: rotina({ declaracaoSemMovimento: null }), anterior: null })).toBe(false);
    });

    it('declaração que caiu (chegou nota): não sai', () => {
        const r = rotina({ documentos: [{ chave: '1'.repeat(44), direcao: 'entrada', competencia: '2026-09', valorTotal: 1, temItens: true, schema: 'procNFe', status: 'autorizado' }] });
        expect(deveEnviarInformativo({ rotina: r, anterior: null })).toBe(false);
    });

    it('já enviado num fechamento anterior: não repete; se a tentativa falhou, tenta de novo', () => {
        expect(deveEnviarInformativo({ rotina: rotina(), anterior: { informativoSemMovimento: { enviadoEm: '2026-10-02T13:00:00Z' } } })).toBe(false);
        expect(deveEnviarInformativo({ rotina: rotina(), anterior: { informativoSemMovimento: { enviadoEm: null, motivo: 'sem e-mail' } } })).toBe(true);
    });
});

describe('o e-mail', () => {
    const { assunto, corpoHtml } = montarInformativoSemMovimento({ empresaNome: 'CONDOMINIO <X> & CIA', competencia: '2026-09', geradoEm: '03/10/2026' });

    it('diz o mês e a empresa no assunto', () => {
        expect(assunto).toBe('Sem movimento 09/2026 — CONDOMINIO <X> & CIA');
    });

    it('afirma o fato — nenhuma nota — e não promete "sem imposto"', () => {
        expect(corpoHtml).toMatch(/não houve movimentação fiscal/);
        expect(corpoHtml).toMatch(/nenhuma nota fiscal emitida ou recebida/);
        expect(corpoHtml).not.toMatch(/não há (imposto|guia)/i);
    });

    it('escapa o nome da empresa', () => {
        expect(corpoHtml).not.toMatch(/<X>/);
        expect(corpoHtml).toMatch(/&lt;X&gt;/);
    });

    it('usa o MESMO layout dos e-mails de guia', () => {
        const src = readFileSync(join(__dirname, '..', 'sefaz-backend', 'informativo-sem-movimento.js'), 'utf8');
        expect(src).toMatch(/from '\.\/email-layout\.js'/);
        expect(corpoHtml).toMatch(/Competência 09\/2026/);
    });
});

describe('o fechamento dispara o informativo', () => {
    it('a rota do fim de mês chama a régua depois de gravar o carimbo', () => {
        const src = readFileSync(join(__dirname, '..', 'sefaz-backend', 'fim-de-mes-routes.js'), 'utf8');
        const grava = src.indexOf('refFechamento.set(montado.fechamento');
        const dispara = src.indexOf('deveEnviarInformativo(');
        expect(grava).toBeGreaterThan(0);
        expect(dispara).toBeGreaterThan(grava);
    });
});
