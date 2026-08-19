// ============================================================================
// 🚨 O SPED PERDIA AS NOTAS CAPTURADAS — o filtro lia o CAMPO CRU `modelo`.
//
// Paulo, 19/08 (PRONTO SOCORRO 0896, 07/2026): *"no consultor está puxando 131
// notas de saída NF-e e NFC-e; quando gerei o SPED me dá isso aqui apenas"* —
// o relatório do PVA trazia DOIS CFOPs e R$ 30.833,16 contra R$ 74.213,10 do
// recorte.
//
// CAUSA: `if (!['55','65'].includes(String(n.modelo))) return false` — e o
// importer PRINCIPAL (captura SEFAZ, cofre, XML manual do backend) nunca
// gravou `modelo`. O modelo mora na CHAVE (posições 21-22). Só o import pelo
// navegador e o sync-routes gravam o campo, e eram essas as poucas notas que
// sobravam no arquivo.
//
// O alcance ia além do bloco C: bloco D (CT-e), bloco C do EFD-Contribuições e
// — o pior — `somarImpostoPorDirecao`, que soma o DÉBITO e o CRÉDITO do E110 e
// o IPI do E520. Nota fora do bloco é nota fora da APURAÇÃO.
// ============================================================================
import {
    ehNotaDeMercadoria, ehConhecimentoDeTransporte, selecionarNotasBlocoC,
    selecionarCtesBlocoD, avisosDaSelecao, ehResumoSefaz,
} from '../sefaz-backend/sped-selecao-documentos.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { somarIcmsPorDirecao } from '../sefaz-backend/sped-fiscal-blocoE.js';
import { readFileSync } from 'fs';
import { join } from 'path';

/** Chave de NFC-e (mod 65) — o modelo está nas posições 21-22. */
const CHAVE_NFCE = '35260707590894000166650203000007870001234567';
/** Chave de NF-e (mod 55). */
const CHAVE_NFE = '35260707590894000166550010000034853106861510';
const CHAVE_CTE = '35260735523401000291570000000956861100095683';

/** Como o importer PRINCIPAL grava: tipo/tipoDoc/chave, SEM o campo `modelo`. */
const capturada = (over: any = {}) => ({
    id: 'x', chave: CHAVE_NFCE, tipo: 'NFCe', tipoDoc: 'NFCe', schema: 'procNFCe_v4.00',
    status: 'autorizado', direcao: 'saida', competencia: '2026-07',
    numero: '787', valorTotal: 17.90,
    itens: [{ cfop: '5102', vProd: 17.90, vBC: 17.90, vICMS: 3.22, aliqIcms: 18, cst: '00' }],
    ...over,
});

describe('o modelo vem da RÉGUA, não do campo cru (caso PS VIDROS 0896)', () => {
    it('NFC-e capturada SEM o campo modelo entra no bloco C — era ela que sumia', () => {
        const nota = capturada();
        expect((nota as any).modelo).toBeUndefined();   // é assim que o banco está
        expect(ehNotaDeMercadoria(nota)).toBe(true);
        expect(selecionarNotasBlocoC([nota]).notas).toHaveLength(1);
    });

    it('NF-e capturada sem modelo idem (o 55 sai da chave)', () => {
        expect(ehNotaDeMercadoria(capturada({ chave: CHAVE_NFE, tipo: 'NFe', tipoDoc: 'NFe' }))).toBe(true);
    });

    it('nota com o campo `modelo` gravado continua entrando (import manual)', () => {
        expect(ehNotaDeMercadoria(capturada({ modelo: '65' }))).toBe(true);
        expect(ehNotaDeMercadoria(capturada({ modelo: '55', chave: CHAVE_NFE }))).toBe(true);
    });

    // ⚠️ A ARMADILHA DO FALLBACK: `modeloDoDoc` devolve '55' quando não há
    // modelo nem chave legível. Se o tipo não fosse julgado ANTES, uma NFS-e
    // entraria no bloco C como se fosse NF-e.
    it('NFS-e NUNCA entra no bloco C, mesmo sem modelo e sem chave', () => {
        const nfse = { tipo: 'NFSe', tipoDoc: 'NFSe', direcao: 'saida', numero: '2901', chave: null };
        expect(ehNotaDeMercadoria(nfse)).toBe(false);
        const semRotulo = { prestador: { cnpjCpf: '1' }, tomador: { cnpjCpf: '2' }, chave: null };
        expect(ehNotaDeMercadoria(semRotulo)).toBe(false);
    });

    it('CT-e vai ao bloco D e NÃO ao C — mesmo sem o campo modelo', () => {
        const cte = { tipo: 'CTe', tipoDoc: 'CTe', chave: CHAVE_CTE, direcao: 'entrada' };
        expect(ehNotaDeMercadoria(cte)).toBe(false);
        expect(ehConhecimentoDeTransporte(cte)).toBe(true);
        expect(selecionarCtesBlocoD([cte, capturada()])).toHaveLength(1);
    });
});

describe('o que NÃO tem como ser escriturado sai NOMEADO, nunca calado', () => {
    it('resumo da SEFAZ fica fora (sem itens não há C190) e é nomeado com a ação', () => {
        const resumo = capturada({ tipoDoc: 'resNFe', schema: 'resNFe_v1.01', itens: [], numero: '999' });
        expect(ehResumoSefaz(resumo)).toBe(true);
        const sel = selecionarNotasBlocoC([resumo, capturada()]);
        expect(sel.notas).toHaveLength(1);
        expect(sel.soResumo).toEqual(['999']);
        const aviso = avisosDaSelecao(sel).join(' ');
        expect(aviso).toMatch(/só tem o RESUMO da SEFAZ/);
        expect(aviso).toMatch(/Reler XMLs guardados|XML completo/);
        expect(aviso).toMatch(/livro está a MENOS/);
    });

    it('nota válida sem itens capturados fica fora e é nomeada (C100 sem C190 o PVA recusa)', () => {
        const sel = selecionarNotasBlocoC([capturada({ itens: [], numero: '404' })]);
        expect(sel.notas).toHaveLength(0);
        expect(sel.semItens).toEqual(['404']);
        expect(avisosDaSelecao(sel).join(' ')).toMatch(/C100 sem C190/);
    });

    it('CANCELADA entra (Guia Prático: só o C100, sem filhos) mesmo sem itens', () => {
        const cancelada = capturada({ status: 'cancelado', itens: [], numero: '13' });
        expect(selecionarNotasBlocoC([cancelada]).notas).toHaveLength(1);
        // e a cancelada por EVENTO — o campo `status` continua 'autorizado'
        const porEvento = capturada({ itens: [], numero: '14', eventos: [{ tpEvento: '110111', cStat: '135' }] });
        expect(selecionarNotasBlocoC([porEvento]).notas).toHaveLength(1);
        expect(selecionarNotasBlocoC([porEvento]).semItens).toHaveLength(0);
    });
});

describe('🚨 a APURAÇÃO estava zerando junto — somarIcmsPorDirecao lia os mesmos campos crus', () => {
    it('soma o ICMS da nota capturada sem `modelo` (antes dava 0,00 no E110)', () => {
        const notas = [
            capturada({ itens: [{ cfop: '5102', vICMS: 2948.41 }] }),
            capturada({ id: 'b', numero: '788', itens: [{ cfop: '5405', vICMS: 0 }] }),
        ];
        expect(somarIcmsPorDirecao(notas, 'saida')).toBe(2948.41);
    });

    it('cancelada por EVENTO fica FORA da apuração — o campo status diz "autorizado"', () => {
        const cancelada = capturada({
            itens: [{ cfop: '5102', vICMS: 1000 }],
            eventos: [{ tpEvento: '110111', cStat: '135' }],
        });
        expect(somarIcmsPorDirecao([cancelada], 'saida')).toBe(0);
    });

    it('NFS-e não entra na apuração de ICMS (o fallback do modelo não a captura)', () => {
        const nfse = {
            tipo: 'NFSe', tipoDoc: 'NFSe', direcao: 'saida', status: 'autorizado', chave: null,
            itens: [{ cfop: '', vICMS: 500 }],
        };
        expect(somarIcmsPorDirecao([nfse], 'saida')).toBe(0);
    });
});

// ─── A TRAVA: nenhum bloco pode voltar a ler o campo cru ─────────────────────
describe('🚨 varredura — filtro de bloco não lê `String(n.modelo)` direto', () => {
    const raiz = join(__dirname, '..');
    const ARQUIVOS = [
        'sefaz-backend/sped-fiscal-blocoC.js',
        'sefaz-backend/sped-fiscal-blocoD.js',
        'sefaz-backend/sped-fiscal-blocoE.js',
        'sefaz-backend/sped-contrib-blocos.js',
    ];

    it.each(ARQUIVOS)('%s decide o modelo pela régua', (arq) => {
        const fonte = readFileSync(join(raiz, arq), 'utf8');
        // O padrão que causou o defeito: comparar o campo cru com a lista de
        // modelos. `modeloDoDoc`/`ehNotaDeMercadoria` são o caminho certo.
        const linhas = fonte.split('\n').filter(l => /includes\(String\((n|nota|d)\.modelo\)\)/.test(l));
        expect(linhas).toEqual([]);
        expect(/String\((n|nota|d)\.modelo\)\s*===\s*'5[57]'/.test(fonte)).toBe(false);
    });

    it('e os blocos importam a régua única', () => {
        for (const arq of ARQUIVOS) {
            const fonte = readFileSync(join(raiz, arq), 'utf8');
            expect(fonte).toMatch(/from '\.\/sped-selecao-documentos\.js'/);
        }
    });
});
