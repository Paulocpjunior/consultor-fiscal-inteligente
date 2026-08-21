// ============================================================================
// 🚨 O BLOCO D DO EFD ICMS/IPI TINHA CINCO LEITURAS CRUAS NUM REGISTRO SÓ —
// e a pior INVENTAVA um participante.
//
// Varredura noturna dos leitores de DOCUMENTO (21/08). O `buildD100` lia
// `nota.emitente?.cnpj`: a régua monta `.cnpjCpf` e a captura grava `cnpjEmit`
// — NENHUMA das duas era lida. Consequências, em cadeia:
//
//   · `indEmit` saía sempre '1' (terceiros), mesmo em CT-e próprio;
//   · `codPart` caía no literal **'PARTSEM'** — um participante FABRICADO, que
//     o 0150 nunca teria: o PVA recusa COD_PART que nenhum participante casa;
//   · `VL_DOC`/`VL_OPR` liam `t.vNF || t.valor` e o CT-e capturado grava
//     `valorTotal` na raiz (o XML traz <vTPrest>) ⇒ 0,00 — o mesmo defeito do
//     bloco D do EFD-Contribuições, achado na mesma varredura;
//   · `COD_SIT` do cancelamento e `IND_OPER` da direção, pelos campos crus.
// ============================================================================
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoD } from '../sefaz-backend/sped-fiscal-blocoD.js';

/** Chave real de CT-e (modelo 57 nas posições 21-22). */
const CHAVE_CTE = '35260731947349000169570010000000031705547508';
const CNPJ_EMPRESA = '31947349000169';

const dados = (notas: any[]) => ({
    empresa: { _regime: 'lucro', cnpj: CNPJ_EMPRESA, dadosFiscais: { uf: 'SP' } },
    competenciaInicio: '2026-07', competenciaFim: '2026-07', notas, warnings: [] as string[],
});

/** Como o importer principal grava um CT-e tomado: valorTotal + achatados. */
const cteCapturado = (over: any = {}) => ({
    chave: CHAVE_CTE, tipoDoc: 'CTe', direcao: 'entrada', status: 'autorizado',
    numero: '4321', dhEmi: '2026-07-10T10:00:00-03:00',
    valorTotal: 1500,
<<<<<<< HEAD
    // O CT-e traz o CFOP no CABEÇALHO (o da PRESTAÇÃO, na ótica do
    // transportador) — a captura passou a lê-lo em 21/08.
    cfop: '5352', cstIcms: '00',
=======
>>>>>>> origin/main
    cnpjEmit: '47252373000113', xNomeEmit: 'TRANSPORTADORA LTDA',
    ...over,
});

const d100De = (linhas: string[]) => linhas.find((l) => l.startsWith('|D100|'))!.split('|');

describe('🚨 bloco D (ICMS/IPI) — o CT-e como ele chega da captura', () => {
    it('COD_PART é o participante REAL — nunca o literal inventado "PARTSEM"', () => {
        const campos = d100De(buildBlocoD(dados([cteCapturado()])) as never);
        expect(campos[4]).toBe('47252373000113');
        expect(campos[4]).not.toBe('PARTSEM');
    });

    it('sem participante legível o campo sai VAZIO — ausência não se inventa', () => {
        const semParte = cteCapturado({ cnpjEmit: undefined, xNomeEmit: undefined });
        expect(d100De(buildBlocoD(dados([semParte])) as never)[4]).toBe('');
    });

    it('VL_DOC sai com o valor real (valorTotal), não 0,00', () => {
        const linha = buildBlocoD(dados([cteCapturado()])).find((l: string) => l.startsWith('|D100|'));
        expect(linha).toContain('1500,00');
    });

    it('o D190 lê o MESMO valor — resumo que contradiz o documento é pior que resumo nenhum', () => {
        const d190 = buildBlocoD(dados([cteCapturado()])).find((l: string) => l.startsWith('|D190|'));
        expect(d190).toContain('1500,00');
    });

    it('cancelado por EVENTO vira COD_SIT 02 (o campo status ainda diz "autorizado")', () => {
        const cancelado = cteCapturado({ eventos: [{ tpEvento: '110111', cStat: '135' }] });
        expect(d100De(buildBlocoD(dados([cancelado])) as never)[6]).toBe('02');
    });

    it('CT-e de terceiro é IND_EMIT=1 e entrada é IND_OPER=0', () => {
        const campos = d100De(buildBlocoD(dados([cteCapturado()])) as never);
        expect(campos[2]).toBe('0');   // IND_OPER: aquisição
        expect(campos[3]).toBe('1');   // IND_EMIT: terceiros
    });

    it('sem CT-e no período o bloco continua vazio', () => {
        const linhas = buildBlocoD(dados([]));
        expect(linhas.find((l: string) => l.startsWith('|D001|'))).toBe('|D001|1|\r\n');
    });
});
<<<<<<< HEAD

// ═══ O CFOP DO CT-e NÃO SE INVENTA (e é o do TRANSPORTADOR) ═════════════════
//
// O D190 saía com CFOP **'5352' CRAVADO** em 100% dos conhecimentos e CST
// '000': a captura só lia o CFOP de dentro de <prod>, e o CT-e o traz no
// CABEÇALHO. Cravar ali é afirmar a NATUREZA da operação de transporte — é a
// mesma família do 'PARTSEM', num campo que a fiscalização lê.
describe('🚨 D190 — CFOP vem do documento, na ótica de quem escritura', () => {
    it('CT-e tomado: o 5352 do transportador vira 1352 na entrada', () => {
        const d190 = buildBlocoD(dados([cteCapturado()])).find((l: string) => l.startsWith('|D190|'))!;
        const campos = d190.split('|');
        expect(campos[3]).toBe('1352');       // CFOP na ótica de ENTRADA
        expect(campos[3]).not.toBe('5352');   // nunca o do emitente
    });

    it('CT-e SEM CFOP fica de fora e sai NOMEADO — nada de natureza inventada', () => {
        const d = dados([cteCapturado({ cfop: undefined, numero: '888' })]);
        const linhas = buildBlocoD(d as never);
        expect(linhas.find((l: string) => l.startsWith('|D100|'))).toBeUndefined();
        expect(d.warnings.join(' ')).toMatch(/888/);
        expect(d.warnings.join(' ')).toMatch(/♻️|CABEÇALHO/);
    });

    it('e o importer passa a CAPTURAR o CFOP/CST do cabeçalho do CT-e', () => {
        const fs = require('fs');
        const path = require('path');
        const imp = fs.readFileSync(path.resolve(__dirname, '../sefaz-backend/xml-importer.js'), 'utf8');
        expect(imp).toMatch(/cfopCabecalho = pickTag\(xml, 'CFOP'\)/);
        expect(imp).toMatch(/meta\.cfopCabecalho \? \{ cfop: meta\.cfopCabecalho \}/);
    });
});
=======
>>>>>>> origin/main
