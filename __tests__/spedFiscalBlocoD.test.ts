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
