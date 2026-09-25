/**
 * 📖 CATÁLOGO DAS RECUSAS DO ADN (25/09, Paulo: "pode catalogar E999 do ADN").
 *
 * O card mostrava o JSON cru de dois CNPJs. O que se cobra: o código vira
 * assinatura; E999 é do CNPJ (não do serviço, não do certificado) com a ação
 * cadastral; código desconhecido sai DITO como desconhecido; E2220 não é
 * falha; a reincidência conta execuções seguidas por parâmetro de relógio; e
 * o agrupamento junta os CNPJs da mesma causa.
 */
// @ts-expect-error módulo JS sem tipos
import { extrairErrosAdn, catalogarErroAdn, proximoErroAtual, textoDaReincidencia, agruparFalhasAdn, CATALOGO_ADN } from '../sefaz-backend/adn-erro-catalogo.js';

const E999 = 'pagina 1: HTTP 400: {"StatusProcessamento":"REJEICAO","Alertas":[],"Erros":[{"Mensagem":{},"Codigo":"E999","Descricao":"Erro não catalogado"}]}';
const E2243 = 'pagina 1: HTTP 400: {"StatusProcessamento":"REJEICAO","Erros":[{"Codigo":"E2243","Descricao":"CNPJ base divergente"}]}';
const E2220 = 'HTTP 404: {"Erros":[{"Codigo":"E2220","Descricao":"NENHUM_DOCUMENTO_ENCONTRADO"}]}';
const DESCONHECIDO = 'pagina 2: HTTP 400: {"Erros":[{"Codigo":"E1234","Descricao":"Algo novo"}]}';

describe('extrairErrosAdn', () => {
    it('lê o JSON do ADN mesmo com prefixo "pagina N: HTTP 400:" e Mensagem vazia como objeto', () => {
        expect(extrairErrosAdn(E999)).toEqual([{ codigo: 'E999', descricao: 'Erro não catalogado', mensagem: '' }]);
    });
    it('sem JSON legível, ainda acha o código pela assinatura Exxxx', () => {
        expect(extrairErrosAdn('HTTP 500: E999 blá')).toEqual([{ codigo: 'E999', descricao: '', mensagem: '' }]);
        expect(extrairErrosAdn('timeout')).toEqual([]);
        expect(extrairErrosAdn(null)).toEqual([]);
    });
});

describe('catalogarErroAdn', () => {
    it('E999 é do CNPJ, com ação cadastral — não manda trocar certificado nem culpa o serviço', () => {
        const c = catalogarErroAdn(E999);
        expect(c.codigo).toBe('E999');
        expect(c.conhecido).toBe(true);
        expect(c.escopo).toBe('cnpj');
        expect(c.http).toBe(400);
        expect(c.acao).toMatch(/Não é certificado/);
        expect(c.acao).toMatch(/municípios aderentes/);
        expect(c.acao).toMatch(/habilitada no ambiente nacional/);
        expect(c.frase).not.toMatch(/\d{14}/);
    });
    it('E2243 aponta o certificado da raiz; E2220 é sucesso-vazio', () => {
        expect(catalogarErroAdn(E2243)).toMatchObject({ codigo: 'E2243', escopo: 'cnpj' });
        expect(catalogarErroAdn(E2220)).toMatchObject({ codigo: 'E2220', escopo: 'sucesso-vazio' });
    });
    it('código desconhecido sai DITO como desconhecido, com o código e a descrição do ADN', () => {
        const c = catalogarErroAdn(DESCONHECIDO);
        expect(c.conhecido).toBe(false);
        expect(c.codigo).toBe('E1234');
        expect(c.titulo).toMatch(/E1234/);
        expect(c.titulo).toMatch(/Algo novo/);
        expect(c.acao).toMatch(/catalogar/);
    });
    it('motivo sem código continua legível (a frase é o próprio motivo, sem o prefixo de página)', () => {
        const c = catalogarErroAdn('pagina 1: socket hang up');
        expect(c.codigo).toBeNull();
        expect(c.frase).toBe('socket hang up');
    });
    it('todo código do catálogo tem título, escopo e ação', () => {
        for (const [cod, v] of Object.entries(CATALOGO_ADN) as Array<[string, { titulo: string; escopo: string; acao: string }]>) {
            expect({ cod, ok: v.titulo.length > 10 && ['servico', 'cnpj', 'sucesso-vazio'].includes(v.escopo) && v.acao.length > 10 }).toEqual({ cod, ok: true });
        }
    });
});

describe('reincidência — relógio por parâmetro', () => {
    const T0 = Date.parse('2026-09-23T07:00:00Z');
    const DIA = 24 * 3600 * 1000;
    it('primeira falha conta 1 desde agora; a mesma causa acumula; causa diferente reinicia; sucesso limpa', () => {
        const a = proximoErroAtual({ anterior: null, motivo: E999, agoraMs: T0 });
        expect(a).toMatchObject({ codigo: 'E999', execucoes: 1, primeiraEm: T0, ultimaEm: T0 });
        const b = proximoErroAtual({ anterior: a, motivo: E999, agoraMs: T0 + DIA });
        expect(b).toMatchObject({ codigo: 'E999', execucoes: 2, primeiraEm: T0, ultimaEm: T0 + DIA });
        const c = proximoErroAtual({ anterior: b, motivo: E2243, agoraMs: T0 + 2 * DIA });
        expect(c).toMatchObject({ codigo: 'E2243', execucoes: 1, primeiraEm: T0 + 2 * DIA });
        expect(proximoErroAtual({ anterior: c, motivo: null, agoraMs: T0 + 3 * DIA })).toBeNull();
        expect(proximoErroAtual({ anterior: c, motivo: E2220, agoraMs: T0 + 3 * DIA })).toBeNull();
    });
    it('a frase só aparece com 2+ execuções e diz desde quando', () => {
        expect(textoDaReincidencia({ codigo: 'E999', execucoes: 1, primeiraEm: T0 })).toBe('');
        expect(textoDaReincidencia({ codigo: 'E999', execucoes: 3, primeiraEm: T0 })).toBe('há 3 execuções seguidas desde 23/09/2026');
    });
});

describe('agruparFalhasAdn — o card agrupa por CAUSA e nomeia os CNPJs', () => {
    const registros = [
        { empresaCnpj: '27986638000108', motivo: E999 },
        { empresaCnpj: '34025070000116', motivo: E999 },
        { empresaCnpj: '11111111000191', motivo: E2243 },
        { empresaCnpj: '22222222000192', motivo: E2220 },
    ];
    it('dois E999 viram UMA linha com os dois CNPJs; E2220 fica de fora', () => {
        const top = agruparFalhasAdn(registros, { reincidenciaPorCnpj: { '27986638000108': { codigo: 'E999', execucoes: 4, primeiraEm: Date.parse('2026-09-22T07:00:00Z') } } });
        expect(top).toHaveLength(2);
        expect(top[0]).toMatchObject({ codigo: 'E999', quantidade: 2, cnpjs: ['27986638000108', '34025070000116'] });
        expect(top[0].motivo).toMatch(/CNPJ 27986638000108, 34025070000116/);
        expect(top[0].motivo).toMatch(/27986638000108: há 4 execuções seguidas desde 22\/09\/2026/);
        expect(top[0].acao).toMatch(/municípios aderentes/);
        expect(top[1]).toMatchObject({ codigo: 'E2243', quantidade: 1 });
        expect(top.some((t: { codigo: string | null }) => t.codigo === 'E2220')).toBe(false);
    });
    it('lista cortada diz "e mais N"', () => {
        const muitos = Array.from({ length: 8 }, (_, i) => ({ empresaCnpj: `1000000000010${i}`, motivo: E999 }));
        const [t] = agruparFalhasAdn(muitos, { maxCnpjs: 3 });
        expect(t.quantidade).toBe(8);
        expect(t.motivo).toMatch(/e mais 5/);
    });
});
