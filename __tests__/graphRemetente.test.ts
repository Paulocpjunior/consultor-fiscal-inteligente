import {
    escolherRemetente, dominiosPermitidos, ehErroDeCaixaInexistente,
} from '../sefaz-backend/graph-remetente.js';

const PADRAO = 'junior@spassessoriacontabil.com.br';

describe('escolherRemetente — o cliente responde a quem cuida da carteira', () => {
    it('envia pela caixa do colaborador que clicou', () => {
        const r = escolherRemetente({ emailColaborador: 'eunice.maria@spassessoriacontabil.com.br', padrao: PADRAO });
        expect(r.remetente).toBe('eunice.maria@spassessoriacontabil.com.br');
        expect(r.fonte).toBe('colaborador');
        expect(r.motivo).toBeNull();
    });

    it('normaliza maiúsculas e espaços do login', () => {
        const r = escolherRemetente({ emailColaborador: '  Eunice.Maria@SPassessoriacontabil.com.br ', padrao: PADRAO });
        expect(r.remetente).toBe('eunice.maria@spassessoriacontabil.com.br');
    });

    it('e-mail FORA do domínio do escritório cai no remetente institucional', () => {
        // Não se envia "como" uma caixa que não é do tenant — o Graph recusaria,
        // e tentar seria falsificar origem.
        const r = escolherRemetente({ emailColaborador: 'pessoa@gmail.com', padrao: PADRAO });
        expect(r.remetente).toBe(PADRAO);
        expect(r.fonte).toBe('padrao');
        expect(r.motivo).toMatch(/não é uma caixa do escritório/);
    });

    it('sessão sem e-mail identificado usa o padrão, com o motivo', () => {
        const r = escolherRemetente({ emailColaborador: '', padrao: PADRAO });
        expect(r.remetente).toBe(PADRAO);
        expect(r.motivo).toMatch(/sem e-mail identificado/);
    });

    it('domínio extra configurado é aceito', () => {
        const r = escolherRemetente({
            emailColaborador: 'x@outra.com.br', padrao: PADRAO, dominios: ['spassessoriacontabil.com.br', 'outra.com.br'],
        });
        expect(r.fonte).toBe('colaborador');
    });
});

describe('dominiosPermitidos', () => {
    it('sempre inclui o domínio do escritório', () => {
        expect(dominiosPermitidos({})).toContain('spassessoriacontabil.com.br');
    });

    it('soma os domínios do env sem duplicar', () => {
        const d = dominiosPermitidos({ GRAPH_DOMINIOS_REMETENTE: 'outra.com.br, spassessoriacontabil.com.br' });
        expect(d).toEqual(['spassessoriacontabil.com.br', 'outra.com.br']);
    });
});

describe('ehErroDeCaixaInexistente — quando vale refazer pelo padrão', () => {
    it('reconhece caixa inexistente/sem mailbox', () => {
        expect(ehErroDeCaixaInexistente('Graph sendMail 404: ErrorInvalidUser')).toBe(true);
        expect(ehErroDeCaixaInexistente('MailboxNotEnabledForRESTAPI')).toBe(true);
        expect(ehErroDeCaixaInexistente('The requested object was not found')).toBe(true);
    });

    it('NÃO reenvia em erro de outra natureza — repetir duplicaria a mensagem', () => {
        expect(ehErroDeCaixaInexistente('Graph sendMail 413: attachment too large')).toBe(false);
        expect(ehErroDeCaixaInexistente('invalid recipient address')).toBe(false);
        expect(ehErroDeCaixaInexistente('')).toBe(false);
    });
});
