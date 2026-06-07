/**
 * Testes do mapeador de cStat → mensagem acionável.
 *
 * Bug que motivou: tela mostrava 'cStat=593 Rejeicao: CNPJ-Base
 * consultado difere do CNPJ-Base do Certificado Digital' e o admin nao
 * sabia que precisava cadastrar procuracao no e-CAC. Esses testes
 * travam o mapeamento dos cStats mais frequentes pra nao quebrar
 * quando alguem editar a tabela.
 */
import { interpretarCstat, type CstatInfo } from '../services/cstatHelper';

describe('interpretarCstat — cStats mais frequentes', () => {
    it('137: nada novo (NSU em dia) → ok, sem ação', () => {
        const r = interpretarCstat('137');
        expect(r.categoria).toBe('ok');
        expect(r.acao).toBeNull();
    });

    it('138: documentos retornados → ok', () => {
        const r = interpretarCstat('138');
        expect(r.categoria).toBe('ok');
        expect(r.titulo).toMatch(/Documentos/);
    });

    it('593: procuração e-CAC ausente → erro + ação cita e-CAC + cnpj da S&P', () => {
        const r = interpretarCstat('593');
        expect(r.categoria).toBe('erro');
        expect(r.acao).toBeTruthy();
        expect(r.acao!.toLowerCase()).toContain('e-cac');
        expect(r.acao!).toContain('44.388.152/0001-89');
        // Deve mencionar a alternativa (cert A1 próprio)
        expect(r.acao!).toMatch(/A1.*pr[oó]prio/i);
    });

    it('280: cert inválido → erro + ação cita renovar ou marcar procuração', () => {
        const r = interpretarCstat('280');
        expect(r.categoria).toBe('erro');
        expect(r.acao).toMatch(/renovar|procura/i);
    });

    it('656: rate-limit → atencao (não bloqueante)', () => {
        const r = interpretarCstat('656');
        expect(r.categoria).toBe('atencao');
        expect(r.acao).toMatch(/frequ[eê]ncia|cron/i);
    });

    it('aceita cStat numerico tambem (não so string)', () => {
        expect(interpretarCstat(593).cStat).toBe('593');
        expect(interpretarCstat(593).categoria).toBe('erro');
    });

    it('cStat null/undefined → categoria erro sem ação', () => {
        const r1 = interpretarCstat(null);
        const r2 = interpretarCstat(undefined);
        expect(r1.categoria).toBe('erro');
        expect(r2.categoria).toBe('erro');
        expect(r1.acao).toBeNull();
    });

    it('cStat desconhecido com xMotivo "Rejeicao..." vira erro', () => {
        const r = interpretarCstat('999', 'Rejeicao: motivo desconhecido');
        expect(r.cStat).toBe('999');
        expect(r.categoria).toBe('erro');
        expect(r.titulo).toContain('Rejeicao');
    });

    it('cStat desconhecido sem indicativo de erro vira atencao', () => {
        const r = interpretarCstat('888', 'Status novo');
        expect(r.categoria).toBe('atencao');
    });

    it('cStat desconhecido aponta pra tabela oficial SEFAZ', () => {
        const r = interpretarCstat('888');
        expect(r.acao).toMatch(/tabela oficial|SEFAZ/i);
    });
});

describe('interpretarCstat — forma do retorno', () => {
    it('sempre devolve { cStat, titulo, categoria, acao }', () => {
        const r: CstatInfo = interpretarCstat('137');
        expect(r).toHaveProperty('cStat');
        expect(r).toHaveProperty('titulo');
        expect(r).toHaveProperty('categoria');
        expect(r).toHaveProperty('acao');
    });
});
