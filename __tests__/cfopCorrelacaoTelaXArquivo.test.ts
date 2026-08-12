/**
 * A TELA DE CORRELAÇÃO DE CFOP MOSTRAVA UM CFOP E O ARQUIVO SAÍA COM OUTRO.
 *
 * Paulo, 12/08 (DISTRIBUIDORA DE BANANAS ELS): *"Confirma pra mim se é nesse
 * campo a correlação de CFOP"*. É — mas o modal carregava uma "réplica
 * simplificada da lógica do backend", escrita para "não acoplar o frontend", e
 * as duas divergiram.
 *
 * Conferência que promete um CFOP diferente do que o arquivo grava é pior que
 * não ter tela: ela dá confiança no número errado. Estes testes travam a
 * régua ÚNICA (`correlacionarCfop`) contra os dois casos em que a cópia mentia.
 */
import { correlacionarCfop } from '../sefaz-backend/cfop-correlacao.js';

/** A cópia que vivia no modal, preservada AQUI só para provar a divergência. */
function replicaAntiga(cfopOrigem: string, natureza?: string): string {
    const c = String(cfopOrigem || '').trim();
    if (c.length !== 4 || !['5', '6', '7'].includes(c[0])) return '';
    const sufixo = c.slice(1);
    const primeiro = ({ '5': '1', '6': '2', '7': '3' } as any)[c[0]];
    const PRESERVA = ['401', '403', '405', '406', '407', '408', '409', '410', '411',
        '910', '911', '912', '913', '918', '919', '551', '552', '553', '554', '555', '556', '557'];
    if (PRESERVA.includes(sufixo)) return primeiro + sufixo;
    const COMPRA = ['101', '102', '116', '117', '118', '120', '122'];
    if (COMPRA.includes(sufixo)) {
        const map: Record<string, string> = { comercio: '102', industria: '101', servicos: '556' };
        if (natureza && map[natureza]) return primeiro + map[natureza];
        return primeiro + sufixo;
    }
    return primeiro + sufixo;
}

const naArvore = (cfop: string, naturezaAtividade?: string) =>
    correlacionarCfop(cfop, 'entrada', { naturezaAtividade });

describe('DIVERGÊNCIA 1 — venda com ST virava CFOP que não existe', () => {
    // Caso real do Paulo (05/08): na ENTRADA a família ST não tem 402/404/405,
    // porque esses sufixos descrevem a POSIÇÃO DO VENDEDOR na substituição.
    it('5405 no arquivo é 1403 (destino da mercadoria), não 1405', () => {
        expect(naArvore('5405', 'comercio')).toBe('1403');
        // ...e era isso que a tela mostrava:
        expect(replicaAntiga('5405', 'comercio')).toBe('1405');
    });

    it('vale para toda a família de VENDA com ST, e para 6xxx', () => {
        for (const c of ['5401', '5402', '5403', '5404', '5405']) {
            expect(naArvore(c, 'comercio')).toBe('1403');
        }
        expect(naArvore('6405', 'industria')).toBe('2401');
        expect(naArvore('6405', 'servicos')).toBe('2407');
    });

    it('sem natureza declarada NÃO cai na conversão mecânica — 1402/1405 não existem', () => {
        expect(naArvore('5405')).toBe('1403');
        expect(naArvore('5402')).toBe('1403');
    });
});

describe('DIVERGÊNCIA 2 — natureza em branco não é "sem heurística"', () => {
    // Empresa do Simples quase nunca preenche naturezaAtividade, então este era
    // o caso COMUM: a tela mostrava 1101 e o arquivo saía 1102.
    it('compra de produto com natureza ausente: a tela dizia 1101', () => {
        expect(replicaAntiga('5101')).toBe('1101');
    });

    it('e o arquivo, com o cadastro dizendo comércio, grava 1102', () => {
        expect(naArvore('5101', 'comercio')).toBe('1102');
        expect(naArvore('6102', 'comercio')).toBe('2102');
        expect(naArvore('5101', 'industria')).toBe('1101');
        expect(naArvore('5101', 'servicos')).toBe('1556');
    });
});

describe('o que as duas SEMPRE concordaram continua igual', () => {
    it('devolução, ativo e uso/consumo só invertem o primeiro dígito', () => {
        for (const c of ['5910', '5551', '5556', '6910', '7551']) {
            expect(naArvore(c, 'comercio')).toBe(replicaAntiga(c, 'comercio'));
        }
    });

    it('SAÍDA nunca se converte — o CFOP já é o da própria empresa', () => {
        expect(correlacionarCfop('5102', 'saida', { naturezaAtividade: 'industria' })).toBe('5102');
    });

    it('override manual vence tudo — é para isso que a tela existe', () => {
        expect(correlacionarCfop('5405', 'entrada', {
            naturezaAtividade: 'comercio', cfopOverrides: { '5405': '1401' },
        })).toBe('1401');
    });
});
