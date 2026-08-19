// ============================================================================
// 🚨 E520 — O SALDO CREDOR ANTERIOR DE IPI AGORA É PUXADO DA FICHA.
//
// Caso PWR INDUSTRIA METALURGICA 07/2026 (Paulo, 19/08): a ficha do CFI dizia
// "Cred. IPI do mês anterior (compensado): R$ 2.547,39" e o E520 do arquivo
// gerado saía "Saldo credor do período anterior: 0,00" — o gerador sempre leu
// `saldoCredorIpiAnterior` e o orquestrador nunca passou o campo (registro de
// 17/08, "O SALDO CREDOR ANTERIOR SAÍA ZERO").
//
// A conta que PROVA o fio certo, com os números do print dele:
//   2.547,39 (anterior) + 2.200,45 (créditos do período) = 4.747,84
//   — exatamente o "IPI a transportar p/ 08/2026" da mesma ficha.
//
// ⚠️ A FONTE É A FICHA DA PRÓPRIA COMPETÊNCIA: `saldoCredorIpi` na ficha de M
// já significa "o que ENTROU em M" — a semântica exata do VL_SD_ANT_IPI. O
// ICMS lê a ficha ANTERIOR e por isso transporta defasado (defeito conhecido);
// este teste barra a volta daquele desenho no IPI.
// ============================================================================
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoE } from '../sefaz-backend/sped-fiscal-blocoE.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const limpo = (linhas: string[]) => linhas.map((l) => l.replace(/\r?\n$/, ''));

const dadosBase = (extra: Record<string, unknown> = {}) => ({
    empresa: { _regime: 'lucro', dadosFiscais: { uf: 'SP' } },
    competenciaInicio: '2026-07',
    competenciaFim: '2026-07',
    ajustesApuracao: [],
    obrigacoesStPorUf: {},
    warnings: [] as string[],
    notas: [] as unknown[],
    ...extra,
});

const notaEntradaComIpi = {
    direcao: 'entrada',
    status: 'autorizado',
    modelo: '55',
    itens: [{ cfop: '1101', cstIpi: '00', vProd: 30000, vBcIpi: 22004.5, vIPI: 2200.45 }],
};

describe('E520 — saldo credor anterior de IPI (caso PWR 07/2026)', () => {
    it('o saldo da ficha entra no VL_SD_ANT_IPI e o transporte fecha com a ficha: 2.547,39 + 2.200,45 = 4.747,84', () => {
        const dados = dadosBase({ notas: [notaEntradaComIpi], saldoCredorIpiAnterior: 2547.39 });
        const linhas = limpo(buildBlocoE(dados as never));
        const e520 = linhas.find((l) => l.startsWith('|E520|'));
        // |E520|VL_SD_ANT_IPI|VL_DEB|VL_CRED|VL_OD|VL_OC|VL_SC|VL_SD|
        expect(e520).toBe('|E520|2547,39|0,00|2200,45|0,00|0,00|4747,84|0,00|');
    });

    it('mês SEM movimento de IPI mas COM saldo anterior ainda gera E500/E520 — o saldo não some da corrente de transporte', () => {
        const dados = dadosBase({ saldoCredorIpiAnterior: 2547.39 });
        const linhas = limpo(buildBlocoE(dados as never));
        expect(linhas.some((l) => l.startsWith('|E500|'))).toBe(true);
        expect(linhas.find((l) => l.startsWith('|E520|')))
            .toBe('|E520|2547,39|0,00|0,00|0,00|0,00|2547,39|0,00|');
    });

    it('sem movimento E sem saldo, o bloco continua NÃO saindo (comércio/serviço sem IPI não ganha registro indevido)', () => {
        const linhas = limpo(buildBlocoE(dadosBase() as never));
        expect(linhas.some((l) => l.startsWith('|E500|') || l.startsWith('|E520|'))).toBe(false);
    });

    it('o aviso sai CARIMBADO com a origem quando o saldo existe — e não acusa mais 0,00', () => {
        const dados = dadosBase({ notas: [notaEntradaComIpi], saldoCredorIpiAnterior: 2547.39 });
        buildBlocoE(dados as never);
        const w = (dados.warnings as string[]).join('\n');
        expect(w).toMatch(/Saldo credor de IPI do período anterior: 2547\.39/);
        expect(w).toMatch(/ficha desta competência/);
        expect(w).not.toMatch(/IPI = 0,00/);
    });
});

describe('🚨 e o ORQUESTRADOR alimenta o campo — gerador que lê campo que ninguém passa é o defeito original', () => {
    const fonte = readFileSync(join(__dirname, '..', 'sefaz-backend/sped-fiscal-orchestrator.js'), 'utf8');

    it('lê o saldoCredorIpi da ficha da PRÓPRIA competência (periodoInicio), nunca da anterior', () => {
        // A ficha da competência M já guarda "o que entrou em M" — ler a
        // anterior repetiria a defasagem conhecida do ICMS.
        expect(fonte).toMatch(/saldoCredorIpiAnterior = parseFloat\(fichaAtual\.saldoCredorIpi \|\| 0\)/);
        const secao = fonte.slice(fonte.indexOf('7a. Saldo credor de IPI'), fonte.indexOf('7b. Ajustes'));
        expect(secao).toMatch(/where\('competencia', '==', periodoInicio\)/);
    });

    it('e o campo viaja no retorno para o buildBlocoE', () => {
        expect(fonte).toMatch(/^\s*saldoCredorIpiAnterior,$/m);
    });

    it('falha na leitura vira AVISO nomeado, nunca "não tem saldo" calado', () => {
        expect(fonte).toMatch(/Não consegui ler o saldo credor de IPI da ficha/);
    });
});
