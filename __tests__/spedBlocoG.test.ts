/**
 * Bloco G / CIAP — conferido contra o CIAP REAL da EXPERTE METAIS EXPANDIDOS
 * (06/2026, recibo de 20/07/2026), que o Paulo mandou em PDF.
 *
 * Os números do relatório do PVA precisam sair EXATOS daqui — é a única forma
 * de saber que a régua está certa antes de gerar arquivo pra cliente:
 *   Σ parcelas 527,53 × índice 0,86032111 = 453,85 apropriado.
 */
import {
    apurarCiap, indiceParticipacao, parcelaPassivel, creditoTotalDoBem,
    classificarSaidasCiap, montarLinhasBlocoG, PARCELAS_CIAP,
    type BemCiapEntrada,
} from '../sefaz-backend/sped-bloco-g.js';

// Os 4 bens do CIAP da EXPERTE, exatamente como no relatório.
const BENS_EXPERTE: BemCiapEntrada[] = [
    {
        codigo: 'CHAPAS', descricao: 'CHAPAS', tipo: 'bem',
        dataMovimentacao: '2026-06-01', tipoMovimentacao: 'SI',
        creditoIcmsProprio: 955.50, creditoIcmsSt: 0, creditoIcmsFrete: 0, creditoIcmsDifal: 0,
        numeroParcela: 12,
    },
    {
        codigo: 'FRESA FERRAMENTEIRA', descricao: 'FRESA FERRAMENTEIRA', tipo: 'bem',
        dataMovimentacao: '2026-06-01', tipoMovimentacao: 'SI',
        creditoIcmsProprio: 7778.06, creditoIcmsSt: 0, creditoIcmsFrete: 0, creditoIcmsDifal: 0,
        numeroParcela: 12,
    },
    {
        codigo: 'RETIFICADORA PLANA', descricao: 'RETIFICADORA PLANA', tipo: 'bem',
        dataMovimentacao: '2026-06-01', tipoMovimentacao: 'SI',
        creditoIcmsProprio: 13200.30, creditoIcmsSt: 0, creditoIcmsFrete: 0, creditoIcmsDifal: 0,
        numeroParcela: 35,
    },
    {
        codigo: 'ROLAMENTOS', descricao: 'ROLAMENTOS', tipo: 'componente',
        codigoBemPrincipal: 'FRESA FERRAMENTEIRA',
        dataMovimentacao: '2026-06-01', tipoMovimentacao: 'SI',
        creditoIcmsProprio: 3387.47, creditoIcmsSt: 0, creditoIcmsFrete: 0, creditoIcmsDifal: 0,
        numeroParcela: 10,
    },
];

const APURACAO_EXPERTE = {
    bens: BENS_EXPERTE,
    saldoInicial: 25321.33,
    saidasTributadas: 425472.59,
    saidasTotais: 494550.91,
};

describe('CIAP — caso real EXPERTE 06/2026', () => {
    it('reproduz o valor da parcela de cada bem (crédito / 48)', () => {
        expect(PARCELAS_CIAP).toBe(48);
        expect(parcelaPassivel(BENS_EXPERTE[0])).toBe(19.91);   // 955,50 / 48
        expect(parcelaPassivel(BENS_EXPERTE[1])).toBe(162.04);  // 7.778,06 / 48
        expect(parcelaPassivel(BENS_EXPERTE[2])).toBe(275.01);  // 13.200,30 / 48
        expect(parcelaPassivel(BENS_EXPERTE[3])).toBe(70.57);   // 3.387,47 / 48
    });

    it('reproduz o índice de participação com as 8 casas do PVA', () => {
        expect(indiceParticipacao(425472.59, 494550.91)).toBe(0.86032111);
    });

    it('reproduz o somatório das parcelas e o crédito apropriado do relatório', () => {
        const r = apurarCiap(APURACAO_EXPERTE);
        expect(r.somaParcelas).toBe(527.53);
        expect(r.indice).toBe(0.86032111);
        expect(r.creditoApropriado).toBe(453.85);
        expect(r.saldoInicial).toBe(25321.33);
    });

    it('soma as 4 origens de crédito do bem (próprio + ST + frete + DIFAL)', () => {
        expect(creditoTotalDoBem({
            creditoIcmsProprio: 100, creditoIcmsSt: 10, creditoIcmsFrete: 5, creditoIcmsDifal: 2.5,
        })).toBe(117.5);
    });

    it('gera G110 com os valores do relatório e um G125 por bem', () => {
        const linhas = montarLinhasBlocoG({
            apuracao: apurarCiap(APURACAO_EXPERTE),
            dtIni: '2026-06-01', dtFin: '2026-06-30',
        });

        expect(linhas[0]).toBe('G001|0|');
        expect(linhas[1]).toBe(
            'G110|01062026|30062026|25321,33|527,53|425472,59|494550,91|0,86032111|453,85|0,00|',
        );
        expect(linhas.filter((l: string) => l.startsWith('G125'))).toHaveLength(4);
        expect(linhas[2]).toBe('G125|CHAPAS|01062026|SI|955,50|0,00|0,00|0,00|12|19,91|');
        // G990 conta TODAS as linhas do bloco, inclusive ele mesmo.
        expect(linhas[linhas.length - 1]).toBe(`G990|${linhas.length}|`);
    });
});

describe('CIAP — regras que protegem o crédito', () => {
    it('mês sem saída não credita (índice 0) e avisa', () => {
        const r = apurarCiap({ ...APURACAO_EXPERTE, saidasTributadas: 0, saidasTotais: 0 });
        expect(r.indice).toBe(0);
        expect(r.creditoApropriado).toBe(0);
        expect(r.avisos.join(' ')).toContain('Sem saídas no período');
    });

    it('saída isenta/ST derruba o índice (fica só no denominador)', () => {
        // Metade tributada: índice 0,5 → credita metade das parcelas.
        const r = apurarCiap({ ...APURACAO_EXPERTE, saidasTributadas: 100, saidasTotais: 200 });
        expect(r.indice).toBe(0.5);
        expect(r.creditoApropriado).toBe(263.77); // 527,53 × 0,5
    });

    it('bem baixado/alienado não gera parcela', () => {
        for (const tipo of ['BA', 'AT', 'PE', 'OT']) {
            expect(parcelaPassivel({ ...BENS_EXPERTE[0], tipoMovimentacao: tipo })).toBe(0);
        }
    });

    it('parcela fora da janela 1..48 não gera crédito', () => {
        expect(parcelaPassivel({ ...BENS_EXPERTE[0], numeroParcela: 49 })).toBe(0);
        expect(parcelaPassivel({ ...BENS_EXPERTE[0], numeroParcela: 0 })).toBe(0);
        expect(parcelaPassivel({ ...BENS_EXPERTE[0], numeroParcela: undefined })).toBe(0);
    });

    it('componente sem bem principal vira aviso (o G125 exige o vínculo)', () => {
        const r = apurarCiap({
            ...APURACAO_EXPERTE,
            bens: [{ ...BENS_EXPERTE[3], codigoBemPrincipal: '' }],
        });
        expect(r.avisos.join(' ')).toContain('sem bem principal');
    });

    it('sem bens no CIAP o bloco sai VAZIO (é o caso da maioria das empresas)', () => {
        const linhas = montarLinhasBlocoG({
            apuracao: apurarCiap({ bens: [], saldoInicial: 0, saidasTributadas: 0, saidasTotais: 0 }),
            dtIni: '2026-06-01', dtFin: '2026-06-30',
        });
        expect(linhas).toEqual(['G001|1|', 'G990|2|']);
    });
});

describe('classificarSaidasCiap — de onde saem as duas bases do índice', () => {
    it('saída com ICMS destacado é tributada; isenta entra só no total', () => {
        const r = classificarSaidasCiap([
            { direcao: 'saida', valores: { total: 1000, icms: 180 } },
            { direcao: 'saida', valores: { total: 500, icms: 0 } },
        ]);
        expect(r.tributadasEExportacao).toBe(1000);
        expect(r.total).toBe(1500);
    });

    it('exportação (CFOP 7xxx) conta como tributada mesmo sem destaque', () => {
        const r = classificarSaidasCiap([
            { direcao: 'saida', valores: { total: 800, icms: 0 }, cfops: ['7101'] },
        ]);
        expect(r.tributadasEExportacao).toBe(800);
        expect(r.total).toBe(800);
    });

    it('entrada, cancelada e denegada ficam de fora das duas contas', () => {
        const r = classificarSaidasCiap([
            { direcao: 'entrada', valores: { total: 900, icms: 100 } },
            { direcao: 'saida', valores: { total: 700, icms: 100 }, situacao: 'cancelada' },
            { direcao: 'saida', valores: { total: 300, icms: 50 }, situacao: 'denegada' },
            { direcao: 'saida', valores: { total: 200, icms: 36 } },
        ]);
        expect(r.tributadasEExportacao).toBe(200);
        expect(r.total).toBe(200);
    });
});


// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O ÍNDICE DO CIAP PULAVA A NOTA IMPORTADA PELO NAVEGADOR
//
// Varredura dos leitores de documento (21/08): o `xmlParserService` (import
// manual pelo navegador) grava **só `totais.vNF`** — nunca `valorTotal` —, e
// esta classificação lia `valores.total ?? valorTotal`. A nota caía como se
// valesse zero: DENOMINADOR menor ⇒ índice MAIOR ⇒ mais crédito de ICMS do
// imobilizado do que a lei dá. Zero silencioso, na direção mais cara.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 índice do CIAP — o valor sai da régua, nas duas formas', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { classificarSaidasCiap } = require('../sefaz-backend/sped-bloco-g.js');

    it('nota importada pelo NAVEGADOR (só totais.vNF) entra na conta', () => {
        const r = classificarSaidasCiap([
            { direcao: 'saida', status: 'autorizado', totais: { vNF: 2000 }, valores: { icms: 360 } },
        ]);
        expect(r.total).toBe(2000);
        expect(r.tributadasEExportacao).toBe(2000);
    });

    it('e a isenta importada assim DERRUBA o índice, como deve', () => {
        const r = classificarSaidasCiap([
            { direcao: 'saida', status: 'autorizado', valorTotal: 1000, valores: { icms: 180 } },
            { direcao: 'saida', status: 'autorizado', totais: { vNF: 1000 } },  // sem ICMS: isenta/ST
        ]);
        expect(r.total).toBe(2000);
        expect(r.tributadasEExportacao).toBe(1000);   // antes: 1000/1000 = índice 1,0
    });
});
