/**
 * Testes do classificador de erros do login headless NFSe SP.
 *
 * A heuristica decide se o erro vai retentar (manutencao/timeout-rede) ou
 * aborta imediato (selector-mudou/cert-rejeitado). Errar aqui = ou ficar
 * em loop de retry inutil ou desistir cedo demais. Esse teste trava a
 * decisao pra cada classe de erro real visto em producao.
 */

// @ts-expect-error — modulo .js puro
import { classificarErro, HeadlessLoginError } from '../sefaz-backend/nfse-sp-error-classifier.js';

const tipoDe = (err: any) => classificarErro(err).tipo;
const retentavel = (err: any) => classificarErro(err).retentavel;

describe('classificarErro — categorias', () => {
    describe('manutencao (retentavel)', () => {
        it.each([
            'Portal SP em manutencao',
            'Sistema em manutenção temporária',
            'Sistema indisponivel no momento',
            'HTTP 503 Service Unavailable',
            'HTTP 502 Bad Gateway',
            'HTTP 504 Gateway Timeout',
        ])('"%s" → manutencao', (msg) => {
            expect(tipoDe(new Error(msg))).toBe('manutencao');
            expect(retentavel(new Error(msg))).toBe(true);
        });
    });

    describe('timeout-rede (retentavel)', () => {
        it.each([
            'navigation timeout of 60000ms exceeded',
            'page.goto: Timeout 30000ms exceeded',
            'ECONNRESET',
            'ETIMEDOUT',
            'net::ERR_NAME_NOT_RESOLVED',
            'getaddrinfo ENOTFOUND nfe.prefeitura.sp.gov.br',
        ])('"%s" → timeout-rede', (msg) => {
            expect(tipoDe(new Error(msg))).toBe('timeout-rede');
            expect(retentavel(new Error(msg))).toBe(true);
        });
    });

    describe('selector-mudou (NAO retentavel)', () => {
        it.each([
            'PMSP_NFeID não retornado. Cookies recebidos: ',
            'PMSP_NFeID nao apareceu apos clique',
            'Botão ENTRAR não encontrado na LoginICP',
            'button not found in DOM',
            'no element matches selector',
        ])('"%s" → selector-mudou', (msg) => {
            expect(tipoDe(new Error(msg))).toBe('selector-mudou');
            expect(retentavel(new Error(msg))).toBe(false);
        });
    });

    describe('cert-rejeitado (NAO retentavel)', () => {
        it.each([
            'Portal SP rejeitou cert (redirect /relogin.aspx)',
            'redirect: /avisoacesso',
            'certificate rejected by server',
        ])('"%s" → cert-rejeitado', (msg) => {
            expect(tipoDe(new Error(msg))).toBe('cert-rejeitado');
            expect(retentavel(new Error(msg))).toBe(false);
        });
    });

    describe('desconhecido (NAO retentavel — abre pra investigacao)', () => {
        it.each([
            'foo bar baz',
            'unexpected condition',
            'Error: 42',
        ])('"%s" → desconhecido', (msg) => {
            expect(tipoDe(new Error(msg))).toBe('desconhecido');
            // Honesto: nao sabemos se retry resolve. Default = nao retry
            // (melhor reportar pra admin investigar do que loopar 3× inutil).
            expect(retentavel(new Error(msg))).toBe(false);
        });
    });

    describe('HeadlessLoginError passa direto (idempotente)', () => {
        it('nao reclassifica erro ja tipado', () => {
            const orig = new HeadlessLoginError('manutencao', 'msg');
            expect(classificarErro(orig)).toBe(orig);
        });
    });
});

describe('HeadlessLoginError — formato', () => {
    it('carrega tipo + tentativas + ultimaMensagem + retentavel flag', () => {
        const e = new HeadlessLoginError('timeout-rede', 'msg', { tentativas: 2, ultimaMensagem: 'timeout' });
        expect(e.tipo).toBe('timeout-rede');
        expect(e.tentativas).toBe(2);
        expect(e.ultimaMensagem).toBe('timeout');
        expect(e.retentavel).toBe(true);
        expect(e.message).toContain('[timeout-rede]');
    });

    it('default tentativas=1', () => {
        const e = new HeadlessLoginError('cert-rejeitado', 'msg');
        expect(e.tentativas).toBe(1);
        expect(e.retentavel).toBe(false);
    });
});
