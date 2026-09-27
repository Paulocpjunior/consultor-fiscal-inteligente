/**
 * 🚨 M400/M800 — A RECEITA SEM ÔNUS NÃO ENTRAVA EM LUGAR NENHUM DO BLOCO M.
 *
 * PVA da EDUARDO GUERRA HORTIFRUTI 08/2026 (25/09): *"Deverá existir um
 * registro M400/M800 para cada CST informados nos documentos com CST igual a
 * 04, 06, 07, 08 ou 09"* — 2 erros. O arquivo tinha 6.859 itens de saída com
 * CST 06 e bloco M só com M200/M600.
 *
 * Espelho (EFD ACEITO da mesma empresa, 07/2026, outro sistema):
 *   |M400|06|3944824,4|||  |M410|116|3944824,4|||
 *   |M400|08|280|||        |M410|999|280|||
 *   e o mesmo par em M800/M810. VL_TOT_REC = Σ VL_ITEM das saídas com o CST.
 *
 * O que se cobra é o FATO: soma certa por CST, natureza vinda do CADASTRO
 * (sem cadastro NÃO sai e o aviso diz onde), posição no bloco, contagem de
 * campos do leiaute, M990 contando as linhas novas.
 */
import { buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error módulo JS sem tipos
import { acumularReceitaSemOnus, montarReceitaSemOnus, conferirCadastroNaturezaReceita, CSTS_SEM_ONUS } from '../sefaz-backend/sped-contrib-m400.js';
// @ts-expect-error módulo JS sem tipos
import { conferirContagemDeCampos } from '../sefaz-backend/sped-contrib-campos.js';

const campos = (linha: string) => linha.trim().split('|');

const nfe = (numero: number, direcao: 'saida' | 'entrada', itens: Array<{ vProd: number; vDesc?: number; cst: string }>) => ({
    tipo: 'NFe',
    direcao,
    numero: String(numero),
    chave: `3526080000543000010455001000${String(numero).padStart(6, '0')}1000000001`,
    dataEmissao: '2026-08-10',
    cnpjEmit: '00005430000104',
    cnpjDest: '11222333000181',
    itens: itens.map((i, k) => ({
        nItem: k + 1, codigo: `P${k}`, descricao: 'Banana', cfop: direcao === 'saida' ? '5102' : '1102', ncm: '08039000',
        unidade: 'KG', quantidade: 1, vUnCom: i.vProd, vProd: i.vProd, vDesc: i.vDesc || 0,
        cstPis: i.cst, cstCofins: i.cst, vPIS: 0, vCOFINS: 0, vICMS: 0,
    })),
});

const notas = [
    nfe(1, 'saida', [{ vProd: 1000, cst: '06' }, { vProd: 500, vDesc: 20, cst: '06' }]), // 1.480,00 em CST 06
    nfe(2, 'saida', [{ vProd: 280, cst: '08' }]),                                          // 280,00 em CST 08
    nfe(3, 'saida', [{ vProd: 300, cst: '01' }]),                                          // tributada — fica no M210, fora do M400
    nfe(4, 'saida', [{ vProd: 77, cst: '49' }]),                                           // outras saídas — não é sem ônus
    nfe(5, 'entrada', [{ vProd: 9000, cst: '70' }]),                                       // entrada nunca é receita
];

describe('🚨 M400/M800: receita sem ônus por natureza (EDUARDO GUERRA 08/2026)', () => {
    it('sem cadastro da natureza, o registro NÃO sai e o aviso diz valor, CST, tabela e onde cadastrar', () => {
        const warnings: string[] = [];
        const linhas: string[] = buildBlocoM({ notas, regimeApuracao: '2', warnings, naturezaReceita: {} });
        expect(linhas.some((l) => l.startsWith('|M400|'))).toBe(false);
        expect(linhas.some((l) => l.startsWith('|M800|'))).toBe(false);
        const aviso06 = warnings.find((w) => /M400\/M410/.test(w) && /CST 06/.test(w));
        expect(aviso06).toBeDefined();
        expect(aviso06).toMatch(/1480\.00/);
        expect(aviso06).toMatch(/4\.3\.13/);
        expect(aviso06).toMatch(/Natureza da receita/);
        expect(aviso06).toMatch(/116/); // sugestão provada — no aviso, nunca no arquivo
        expect(warnings.find((w) => /M800\/M810/.test(w) && /CST 08/.test(w))).toMatch(/4\.3\.15/);
        // só os CST sem ônus viram aviso de M400 — o tributado (01) e o "outras saídas" (49) não
        expect(warnings.filter((w) => /M400\/M410|M800\/M810/.test(w)).some((w) => /CST 01\b|CST 49\b/.test(w))).toBe(false);
    });

    it('com cadastro, sai o par M400/M410 e o par M800/M810 com a soma das saídas daquele CST', () => {
        const warnings: string[] = [];
        const linhas: string[] = buildBlocoM({
            notas, regimeApuracao: '2', warnings,
            naturezaReceita: { '06': { natRec: '116', descricao: '' }, '08': { natRec: '999', descricao: 'Outras' } },
        });
        const m400 = linhas.filter((l) => l.startsWith('|M400|')).map(campos);
        const m410 = linhas.filter((l) => l.startsWith('|M410|')).map(campos);
        expect(m400.map((c) => [c[2], c[3]])).toEqual([['06', '1480,00'], ['08', '280,00']]);
        expect(m410.map((c) => [c[2], c[3], c[5]])).toEqual([['116', '1480,00', ''], ['999', '280,00', 'Outras']]);
        const m800 = linhas.filter((l) => l.startsWith('|M800|')).map(campos);
        const m810 = linhas.filter((l) => l.startsWith('|M810|')).map(campos);
        expect(m800.map((c) => [c[2], c[3]])).toEqual([['06', '1480,00'], ['08', '280,00']]);
        expect(m810.map((c) => c[2])).toEqual(['116', '999']);
        expect(warnings.some((w) => /M400\/M410 NÃO saiu/.test(w))).toBe(false);
    });

    it('o par fica na posição do leiaute: M400 depois do M210 e antes do M500/M600; M800 depois do M610 e antes do M990', () => {
        const linhas: string[] = buildBlocoM({
            notas, regimeApuracao: '2', warnings: [],
            naturezaReceita: { '06': { natRec: '116' }, '08': { natRec: '999' } },
        });
        const idx = (reg: string) => linhas.findIndex((l) => l.startsWith(`|${reg}|`));
        expect(idx('M210')).toBeLessThan(idx('M400'));
        expect(idx('M400')).toBeLessThan(idx('M600'));
        expect(idx('M610')).toBeLessThan(idx('M800'));
        expect(idx('M800')).toBeLessThan(idx('M990'));
        expect(campos(linhas[linhas.length - 1])[2]).toBe(String(linhas.length));
        // contagem de campos: 5 em cada um dos quatro registros (leiaute 1.35)
        const conf = conferirContagemDeCampos(linhas.map((l) => l.trim()));
        expect(conf.erros.filter((e: { registro?: string; mensagem: string }) => /M4|M8/.test(e.mensagem))).toEqual([]);
    });

    it('a soma é a receita do item (mercadoria menos desconto) das SAÍDAS — entrada e CST tributado ficam de fora', () => {
        const r = acumularReceitaSemOnus(notas, {
            regimeApuracao: '2',
            getCstPis: (i: { cstPis: string }) => i.cstPis,
            getCstCofins: (i: { cstCofins: string }) => i.cstCofins,
            direcaoDoDoc: (n: { direcao: string }) => n.direcao,
            docFora: () => false,
        });
        expect(r.pis['06']).toMatchObject({ valor: 1480, itens: 2 });
        expect(r.pis['06'].docs.size).toBe(1);
        expect(r.pis['08']).toMatchObject({ valor: 280, itens: 1 });
        expect(r.pis['01']).toBeUndefined();
        expect(r.pis['49']).toBeUndefined();
        expect(r.pis['70']).toBeUndefined();
        expect(CSTS_SEM_ONUS).toEqual(['04', '06', '07', '08', '09']);
    });

    it('documento cancelado não entra', () => {
        const r = acumularReceitaSemOnus(notas, {
            regimeApuracao: '2',
            getCstPis: (i: { cstPis: string }) => i.cstPis,
            getCstCofins: (i: { cstCofins: string }) => i.cstCofins,
            direcaoDoDoc: (n: { direcao: string }) => n.direcao,
            docFora: (n: { numero: string }) => n.numero === '1',
        });
        expect(r.pis['06']).toBeUndefined();
    });

    it('o cadastro é conferido antes de gravar: CST fora da lista e código que não tem 3 dígitos são recusados; linha vazia é "sem cadastro"', () => {
        const ok = conferirCadastroNaturezaReceita({ '6': { natRec: '116' }, '08': { natRec: '', descricao: 'x' } });
        expect(ok.ok).toBe(true);
        expect(ok.cadastro).toEqual({ '06': { natRec: '116', descricao: '' } });
        const ruim = conferirCadastroNaturezaReceita({ '01': { natRec: '116' }, '06': { natRec: '16' } });
        expect(ruim.ok).toBe(false);
        expect(ruim.erros.join('\n')).toMatch(/CST 01/);
        expect(ruim.erros.join('\n')).toMatch(/3 dígitos/);
    });

    it('montarReceitaSemOnus não inventa zero: CST com valor 0 não gera registro', () => {
        const warnings: string[] = [];
        const linhas = montarReceitaSemOnus({ contribuicao: 'pis', porCst: { '06': { valor: 0, itens: 0, docs: new Set() } }, cadastro: { '06': { natRec: '116' } }, warnings });
        expect(linhas).toEqual([]);
        expect(warnings).toEqual([]);
    });
});
