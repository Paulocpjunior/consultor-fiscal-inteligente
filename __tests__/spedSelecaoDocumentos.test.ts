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

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O RÓTULO NÃO DECIDE — defeito MEU, pego pelo PVA da PWR no mesmo dia.
//
// O import pelo NAVEGADOR não grava `schema` nem `tipoDoc`: a nota COMPLETADA
// por cima de um resumo continua rotulada `resNFe` — com itens, modelo e
// número. Excluí-la pelo rótulo tirou três notas inteiras do bloco C, e o PVA
// acusou na hora: participante e item declarados no 0150/0200 sem C100 que os
// referencie, e o crédito do E110/E520 sem origem documental.
// ═══════════════════════════════════════════════════════════════════════════
describe('nota completada por cima do resumo entra — quem decide é o ITEM', () => {
    it('rótulo resNFe + itens presentes = escriturada (casos GLOBAL COMPANY/POXPUR/BENCO)', () => {
        const completada = capturada({
            // NF-e (mod 55) de ENTRADA — é o caso real (compra de fornecedor).
            // A fixture usava a chave de NFC-e por descuido, e a régua nova
            // ("NFC-e não se escritura nas entradas", Guia Prático) pegou.
            chave: CHAVE_NFE, tipo: 'NFe',
            tipoDoc: 'resNFe', schema: 'resNFe_v1.01', numero: '34853', direcao: 'entrada',
            itens: [{ cfop: '2101', vProd: 1000, vICMS: 120 }],
        });
        const sel = selecionarNotasBlocoC([completada]);
        expect(sel.notas).toHaveLength(1);
        expect(sel.soResumo).toHaveLength(0);
    });

    it('rótulo resNFe SEM itens continua fora e nomeado (o resumo de verdade)', () => {
        const resumo = capturada({ tipoDoc: 'resNFe', schema: 'resNFe_v1.01', itens: [], numero: '999' });
        expect(selecionarNotasBlocoC([resumo]).soResumo).toEqual(['999']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O C100 DECLARAVA MODELO 55 COM CHAVE DE 65 — e informava campos que a
// NFC-e não pode ter. PVA da PS VIDROS 07/2026 (19/08): "O modelo da chave do
// documento eletrônico não confere com o modelo do documento" (35×) e "Para NF
// Eletrônica para consumidor final (COD_MOD = 65) não devem ser informados os
// campos COD_PART, VL_BC_ICMS_ST, VL_ICMS_ST, VL_IPI, VL_PIS, VL_COFINS…" (86×).
// ═══════════════════════════════════════════════════════════════════════════
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';

const dadosBlocoC = (notas: any[]) => ({
    empresa: { _regime: 'lucro', cnpj: '07590894000166', dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' } },
    competenciaInicio: '2026-07', competenciaFim: '2026-07',
    notas, warnings: [] as string[],
});

describe('C100 — o COD_MOD sai da chave e a NFC-e respeita o leiaute dela', () => {
    const nfce = capturada({
        numero: '787', itens: [{ cfop: '5102', vProd: 17.90, vBC: 17.90, vICMS: 3.22, aliqIcms: 18, cst: '00', vIPI: 1.5, vPIS: 0.3 }],
        destinatario: { cnpjCpf: '12345678909', nome: 'CONSUMIDOR' },
        totais: { vNF: 17.90, vIPI: 1.5, vPIS: 0.3 },
    });

    it('NFC-e capturada sem `modelo` sai como COD_MOD 65, não 55', () => {
        const c100 = buildBlocoC(dadosBlocoC([nfce])).find((l: string) => l.startsWith('|C100|'));
        expect(c100.split('|')[5]).toBe('65');
    });

    it('e NÃO informa COD_PART nem os campos de ST/IPI/PIS/COFINS', () => {
        const campos = buildBlocoC(dadosBlocoC([nfce])).find((l: string) => l.startsWith('|C100|')).split('|');
        expect(campos[4]).toBe('');           // COD_PART vazio
        expect(campos[24]).toBe('');          // VL_BC_ICMS_ST
        expect(campos[25]).toBe('');          // VL_ICMS_ST
        expect(campos[26]).toBe('');          // VL_IPI
        expect(campos[27]).toBe('');          // VL_PIS
        expect(campos[28]).toBe('');          // VL_COFINS
    });

    it('NF-e (55) continua com COD_PART e os campos preenchidos', () => {
        const nfe = capturada({
            chave: CHAVE_NFE, tipo: 'NFe', tipoDoc: 'NFe', numero: '3',
            destinatario: { cnpjCpf: '15438711000110', nome: 'CLIENTE' },
            totais: { vNF: 8562.54 },
            itens: [{ cfop: '5101', vProd: 8562.54, vBC: 8562.54, vICMS: 1541.26, aliqIcms: 18, cst: '00' }],
        });
        const campos = buildBlocoC(dadosBlocoC([nfe])).find((l: string) => l.startsWith('|C100|')).split('|');
        expect(campos[5]).toBe('55');
        expect(campos[4]).toBe('15438711000110');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 PARTICIPANTE QUE NENHUM REGISTRO REFERENCIA É RECUSA (PVA, 19/08).
//
// Duas fontes de órfão: a NFC-e (cujo C100 não pode ter COD_PART) e a nota que
// não foi escriturada (só resumo / sem itens). O 0150 tem que casar com a
// MESMA régua do bloco C — é o que o 0200 já fazia pelos itens.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 o 0150 casa com a régua do bloco C', () => {
    const fonte = readFileSync(join(__dirname, '..', 'sefaz-backend/sped-fiscal-orchestrator.js'), 'utf8');

    it('a coleta de participantes usa a régua, não varre todas as notas', () => {
        expect(fonte).toMatch(/selecionarNotasBlocoC\(notas\)/);
        expect(fonte).toMatch(/modeloDoDoc\(n\) !== '65'/);
        expect(fonte).toMatch(/selecionarCtesBlocoD\(notas\)/);
    });

    it('CT-e conta como referência (o D100 tem COD_PART)', () => {
        const trecho = fonte.slice(fonte.indexOf('4. Extrai participantes'), fonte.indexOf('4b.'));
        expect(trecho).toMatch(/selecionarCtesBlocoD/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 📖 REGRAS QUE VIERAM DO MANUAL (Guia Prático EFD ICMS/IPI 3.2.3, 20/08).
// O Paulo mandou o Guia em WORD depois de o link não abrir desta rede. O que
// era dedução a partir das recusas do PVA virou regra com CITAÇÃO.
// ═══════════════════════════════════════════════════════════════════════════
describe('Guia Prático 3.2.3 — NFC-e não se escritura nas entradas', () => {
    it('NFC-e marcada como entrada fica FORA e sai nomeada', () => {
        const sel = selecionarNotasBlocoC([capturada({ direcao: 'entrada', numero: '55' })]);
        expect(sel.notas).toHaveLength(0);
        expect(sel.nfceEmEntrada).toEqual(['55']);
        expect(avisosDaSelecao(sel).join(' ')).toMatch(/não devem ser escrituradas nas entradas/);
    });

    it('NFC-e de SAÍDA continua entrando normalmente', () => {
        expect(selecionarNotasBlocoC([capturada()]).notas).toHaveLength(1);
    });

    it('NF-e de entrada não é afetada', () => {
        const nfe = capturada({ chave: CHAVE_NFE, tipo: 'NFe', tipoDoc: 'NFe', direcao: 'entrada' });
        expect(selecionarNotasBlocoC([nfe]).notas).toHaveLength(1);
    });
});

describe('Guia Prático 3.2.3 — C100, as três regras que o manual corrigiu', () => {
    const dados = (notas: any[], uf = 'SP') => ({
        empresa: { _regime: 'lucro', cnpj: '07590894000166', dadosFiscais: { uf, codMunIBGE: '3550308' } },
        competenciaInicio: '2026-07', competenciaFim: '2026-07', notas, warnings: [] as string[],
    });
    const c100De = (linhas: string[]) => linhas.find((l: string) => l.startsWith('|C100|'))!.split('|');

    // Exceção 1: "preencher SOMENTE REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT,
    // SER, NUM_DOC e CHV_NFe. Demais campos … com conteúdo VAZIO."
    it('CANCELADA sai com os demais campos VAZIOS', () => {
        const cancelada = capturada({
            chave: CHAVE_NFE, tipo: 'NFe', tipoDoc: 'NFe', numero: '9', status: 'cancelado',
            totais: { vNF: 500 }, itens: [{ cfop: '5102', vProd: 500, vBC: 500, vICMS: 90 }],
        });
        const f = c100De(buildBlocoC(dados([cancelada]) as never));
        expect(f[6]).toBe('02');       // COD_SIT preenchido
        expect(f[8]).toBe('9');        // NUM_DOC preenchido
        expect(f[9]).toBe(CHAVE_NFE);  // CHV_NFE preenchida
        expect(f[12]).toBe('');        // VL_DOC vazio
        expect(f[21]).toBe('');        // VL_BC_ICMS vazio
        expect(f[22]).toBe('');        // VL_ICMS vazio
    });

    // Campo 07 (SER): "obrigatório com TRÊS posições … Se não existir, 000."
    it('SER sai com três posições, e 000 quando a nota não tem série', () => {
        const comSerie = capturada({ chave: CHAVE_NFE, tipo: 'NFe', tipoDoc: 'NFe', serie: '1' });
        expect(c100De(buildBlocoC(dados([comSerie]) as never))[7]).toBe('001');
        const semSerie = capturada({ chave: CHAVE_NFE, tipo: 'NFe', tipoDoc: 'NFe', serie: '' });
        expect(c100De(buildBlocoC(dados([semSerie]) as never))[7]).toBe('000');
    });

    // Exceção 4: nota em substituição ao cupom (CFOP 5929/6929) é COD_SIT 08.
    it('nota com CFOP 5929 sai como COD_SIT 08, não 00', () => {
        const nf5929 = capturada({
            chave: CHAVE_NFE, tipo: 'NFe', tipoDoc: 'NFe', numero: '77',
            itens: [{ cfop: '5929', vProd: 3459.63, vBC: 0, vICMS: 0, cst: '60' }],
        });
        expect(c100De(buildBlocoC(dados([nf5929]) as never))[6]).toBe('08');
    });

    it('⚠️ no PARANÁ a régua NÃO vale — o próprio manual abre a exceção', () => {
        const nf5929 = capturada({
            chave: CHAVE_NFE, tipo: 'NFe', tipoDoc: 'NFe', numero: '77',
            itens: [{ cfop: '5929', vProd: 100, vBC: 0, vICMS: 0, cst: '60' }],
        });
        expect(c100De(buildBlocoC(dados([nf5929], 'PR') as never))[6]).toBe('00');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O VL_OPR DO C190 NÃO É A SOMA DOS vProd — e o livro saía a MENOR.
//
// Paulo, 20/08, teste da PWR: o Livro de Entradas do CFI dizia
// `TOTAIS (4 notas) 71.960,81` e o relatório "Registros fiscais dos documentos
// de entradas" do PVA, sobre o arquivo recém-gerado, dizia `TOTAL 69.760,36`.
// A diferença é 2.200,45 — EXATAMENTE o "Total de IPI" do mesmo relatório.
//
// Guia Prático 3.2.3, C190 Campo 05 (VL_OPR): *"informar neste campo o valor
// das mercadorias somadas aos valores de fretes, seguros e outras despesas
// acessórias e os valores de ICMS_ST, FCP_ST e IPI (somente quando o IPI está
// destacado na NF), subtraídos o desconto incondicional e o abatimento não
// tributado e não comercial"*.
//
// É a MESMA lição do VL_CONT_IPI do E510 (11/08): o "valor contábil" do SPED
// inclui o IPI. E o PVA NÃO recusa por isso — só imprime um total menor.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 C190 · VL_OPR — o valor da OPERAÇÃO (caso PWR, 20/08)', () => {
    const dados = (notas: any[]) => ({
        empresa: { _regime: 'lucro', cnpj: '31947349000169', dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' } },
        competenciaInicio: '2026-07', competenciaFim: '2026-07', notas, warnings: [] as string[],
    });
    const c190sDe = (linhas: string[]) => linhas.filter((l) => l.startsWith('|C190|')).map((l) => l.split('|'));
    const brl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

    /** O agregado real da PWR 07/2026, numa nota só (os totais são os do PVA). */
    const entrada = (over: any = {}) => capturada({
        chave: CHAVE_NFE, tipo: 'NFe', tipoDoc: 'NFe', direcao: 'entrada', numero: '3',
        emitente: { cnpjCpf: '15438711000110', nome: 'FORNECEDOR' },
        totais: { vNF: 71960.81, vIPI: 2200.45 },
        itens: [{
            cfop: '1102', vProd: 69760.36, vBC: 69760.36, vICMS: 3459.19, aliqIcms: 4.96,
            cst: '00', vIPI: 2200.45,
        }],
        ...over,
    });

    it('o IPI destacado ENTRA no VL_OPR — 69.760,36 + 2.200,45 = 71.960,81', () => {
        const [c190] = c190sDe(buildBlocoC(dados([entrada()]) as never));
        expect(brl(c190[5])).toBeCloseTo(71960.81, 2);
    });

    it('e o VL_OPR passa a fechar com o VL_DOC do C100 (é a regra do campo 12)', () => {
        const linhas = buildBlocoC(dados([entrada()]) as never);
        const c100 = linhas.find((l: string) => l.startsWith('|C100|'))!.split('|');
        const soma = c190sDe(linhas).reduce((s, f) => s + brl(f[5]), 0);
        expect(soma).toBeCloseTo(brl(c100[12]), 2);
    });

    it('VL_MERC (campo 16) continua sendo só a mercadoria — não é o mesmo campo', () => {
        const c100 = buildBlocoC(dados([entrada()]) as never)
            .find((l: string) => l.startsWith('|C100|'))!.split('|');
        expect(brl(c100[16])).toBeCloseTo(69760.36, 2);
    });

    it('frete, seguro, outras despesas e ICMS-ST/FCP-ST entram; desconto sai', () => {
        const nota = entrada({
            totais: { vNF: 113 },
            itens: [{
                cfop: '1102', vProd: 100, vBC: 100, vICMS: 18, aliqIcms: 18, cst: '00',
                vFrete: 5, vSeg: 1, vOutro: 2, vICMSST: 4, vFCPST: 1, vIPI: 2, vDesc: 2,
            }],
        });
        // 100 + (5+1+2) + (4+1) + 2 − 2 = 113
        expect(brl(c190sDe(buildBlocoC(dados([nota]) as never))[0][5])).toBeCloseTo(113, 2);
    });

    it('item SEM IPI destacado não muda nada (não se deduz destaque por CST)', () => {
        const nota = entrada({
            totais: { vNF: 100 },
            itens: [{ cfop: '1102', vProd: 100, vBC: 100, vICMS: 18, aliqIcms: 18, cst: '00' }],
        });
        expect(brl(c190sDe(buildBlocoC(dados([nota]) as never))[0][5])).toBeCloseTo(100, 2);
    });
});
