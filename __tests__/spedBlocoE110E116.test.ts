// ============================================================================
// 🚨 O E110 SOMAVA A NOTA PRÓPRIA DE ENTRADA COMO DÉBITO — e o E116 declarava
// um vencimento que ninguém podia corrigir.
//
// Varredura de 21/08, eixo novo: **campos que o gerador LÊ do cadastro e que
// ninguém pode preencher** (foi assim que o IND_NAT_PJ apareceu).
//
// (1) `somarImpostoPorDirecao` é quem soma o **débito e o crédito de ICMS do
//     E110** e o **IPI do E520**. Duas leituras cruas dessa linha já tinham
//     sido corrigidas em 19/08 (o status e o modelo) — a TERCEIRA, a direção,
//     ficou. A nota PRÓPRIA DE ENTRADA (art. 136, tpNF=0 — compra de produtor
//     rural, importação) tem a EMPRESA como emitente e fica gravada como
//     'saida' até o backfill passar: o ICMS dela entrava como DÉBITO em vez de
//     CRÉDITO, imposto a maior nas duas pontas.
//
// (2) `icmsCodRec` e `icmsDiaVencimento` eram lidos de `dadosFiscais` e **não
//     estavam na whitelist nem em tela nenhuma** — a régua caía SEMPRE no
//     default. O dia 20 é o de SP, e o prazo do ICMS varia por UF e pelo CPR do
//     próprio contribuinte. É a "rota sem botão" na versão CAMPO, num campo que
//     é DATA DE PAGAMENTO.
// ============================================================================
// @ts-expect-error — módulo .js do backend (sem tipos)
import { somarIcmsPorDirecao, buildBlocoE } from '../sefaz-backend/sped-fiscal-blocoE.js';

const fonte = (rel: string) => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
};

const CHAVE = '35260731947349000169550010000000031705547508';
const CNPJ_EMPRESA = '31947349000169';

/**
 * A nota PRÓPRIA DE ENTRADA como ela fica no banco antes do backfill: emitente
 * = a empresa, `tpNF: '0'`, e `direcao` gravada como 'saida'.
 */
const notaPropriaDeEntrada = (over: any = {}) => ({
    chave: CHAVE, tipo: 'NFe', tipoDoc: 'NFe', status: 'autorizado',
    direcao: 'saida', tpNF: '0', numero: '255273',
    cnpjEmit: CNPJ_EMPRESA, xNomeEmit: 'NOVA ERA',
    cnpjDest: '12345678901', xNomeDest: 'JOSE D. KOKI',
    itens: [{ cfop: '1101', vProd: 10000, vBC: 10000, vICMS: 1200 }],
    totais: { vNF: 10000 },
    ...over,
});

const saidaNormal = (over: any = {}) => ({
    chave: CHAVE.replace(/.$/, '9'), tipo: 'NFe', tipoDoc: 'NFe', status: 'autorizado',
    direcao: 'saida', tpNF: '1', numero: '3',
    itens: [{ cfop: '5101', vProd: 5000, vBC: 5000, vICMS: 900 }],
    totais: { vNF: 5000 },
    ...over,
});

describe('🚨 E110 — a nota própria de entrada é CRÉDITO, não débito', () => {
    it('o ICMS dela sai do débito', () => {
        const notas = [notaPropriaDeEntrada(), saidaNormal()];
        expect(somarIcmsPorDirecao(notas, 'saida')).toBe(900);
    });

    it('e entra no crédito', () => {
        const notas = [notaPropriaDeEntrada(), saidaNormal()];
        expect(somarIcmsPorDirecao(notas, 'entrada')).toBe(1200);
    });

    it('saída de verdade continua sendo débito (a régua não inverte tudo)', () => {
        expect(somarIcmsPorDirecao([saidaNormal()], 'saida')).toBe(900);
        expect(somarIcmsPorDirecao([saidaNormal()], 'entrada')).toBe(0);
    });

    it('o E110 do arquivo reflete os dois lados', () => {
        const dados = {
            empresa: { _regime: 'lucro', cnpj: CNPJ_EMPRESA, dadosFiscais: { uf: 'SP' } },
            competenciaInicio: '2026-07', competenciaFim: '2026-07',
            notas: [notaPropriaDeEntrada(), saidaNormal()],
            warnings: [] as string[],
        };
        const e110 = (buildBlocoE(dados) as string[]).find((l) => l.startsWith('|E110|'))!;
        const campos = e110.split('|');
        expect(campos[2]).toBe('900,00');    // VL_TOT_DEBITOS
        expect(campos[6]).toBe('1200,00');   // VL_TOT_CREDITOS
    });
});

describe('🚨 E116 — o vencimento do ICMS tem cadastro, e o default sai DITO', () => {
    const dadosCom = (df: any) => ({
        empresa: { _regime: 'lucro', cnpj: CNPJ_EMPRESA, dadosFiscais: { uf: 'SP', ...df } },
        competenciaInicio: '2026-07', competenciaFim: '2026-07',
        notas: [saidaNormal()],
        warnings: [] as string[],
    });

    it('sem cadastro: o arquivo sai com o dia 20 e a geração AVISA', () => {
        const d = dadosCom({});
        const linhas = buildBlocoE(d) as string[];
        expect(linhas.find((l) => l.startsWith('|E116|'))).toContain('20082026');
        const aviso = d.warnings.find((w: string) => w.includes('E116') && w.includes('vencimento'));
        expect(aviso).toBeDefined();
        expect(aviso).toContain('Dados Fiscais');
    });

    it('cadastrado, o dia do cadastro VAI ao arquivo e o aviso some', () => {
        const d = dadosCom({ icmsDiaVencimento: '10' });
        expect(buildBlocoE(d).find((l: string) => l.startsWith('|E116|'))).toContain('10082026');
        expect(d.warnings.some((w: string) => w.includes('vencimento'))).toBe(false);
    });

    it('código de receita: o do cadastro vence o padrão da UF', () => {
        const d = dadosCom({ icmsCodRec: '063-1' });
        expect(buildBlocoE(d).find((l: string) => l.startsWith('|E116|'))).toContain('063-1');
    });

    it('UF sem padrão e sem cadastro: campo VAZIO e aviso nomeado — não se inventa código estadual', () => {
        const d = {
            empresa: { _regime: 'lucro', cnpj: CNPJ_EMPRESA, dadosFiscais: { uf: 'PR' } },
            competenciaInicio: '2026-07', competenciaFim: '2026-07',
            notas: [saidaNormal()],
            warnings: [] as string[],
        };
        const e116 = (buildBlocoE(d) as string[]).find((l) => l.startsWith('|E116|'))!;
        expect(e116.split('|')[5]).toBe('');
        expect(d.warnings.some((w: string) => w.includes('código de receita'))).toBe(true);
    });

    // Regra do #382: campo novo do modal ENTRA na whitelist no MESMO PR.
    it('os três campos têm onde ser preenchidos E onde ser gravados', () => {
        const whitelist = fonte('sefaz-backend/empresa-status-routes.js');
        const modal = fonte('components/EmpresaDadosFiscaisModal.tsx');
        for (const campo of ['icmsCodRec', 'icmsDiaVencimento', 'regimeApuracaoPisCofins']) {
            expect({ campo, naWhitelist: whitelist.includes(`'${campo}'`) })
                .toEqual({ campo, naWhitelist: true });
            expect({ campo, naTela: modal.includes(`'${campo}'`) })
                .toEqual({ campo, naTela: true });
        }
    });
});
