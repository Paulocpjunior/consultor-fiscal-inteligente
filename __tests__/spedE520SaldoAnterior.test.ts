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
        const dados = dadosBase({
            notas: [notaEntradaComIpi], saldoCredorIpiAnterior: 2547.39,
            origemSaldoIpi: 'campo "Cred. IPI do mês anterior (compensado)" da ficha desta competência',
        });
        buildBlocoE(dados as never);
        const w = (dados.warnings as string[]).join('\n');
        expect(w).toMatch(/Saldo credor de IPI do período anterior: 2547\.39/);
        expect(w).toMatch(/ficha desta competência/);
        expect(w).not.toMatch(/IPI = 0,00/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A FICHA NÃO MORA EM COLEÇÃO NENHUMA — premissa MINHA, derrubada pelo PVA.
//
// A primeira correção (19/08) passou a ler `db.collection('lucro_fichas')`.
// Essa coleção NÃO EXISTE: a ficha é EMBUTIDA no documento da empresa, em
// `fichaFinanceira[]`, com a competência em `mesReferencia`. A query voltava
// vazia SEMPRE, então o E520 da PWR continuou 0,00 depois da "correção" — e o
// ICMS (que já lia assim antes) nunca transportou saldo nenhum.
//
// Consulta que só devolve vazio é indistinguível de "não tem saldo": a
// ausência plausível outra vez, agora do lado da leitura. Os testes que
// travavam a coleção foram TROCADOS — eles descreviam a fonte errada.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 o ORQUESTRADOR lê a ficha EMBUTIDA na empresa, não uma coleção', () => {
    const fonte = readFileSync(join(__dirname, '..', 'sefaz-backend/sped-fiscal-orchestrator.js'), 'utf8');

    it('nenhuma leitura da coleção fantasma sobrou (o comentário que a explica pode ficar)', () => {
        const codigo = fonte.split('\n').filter(l => !l.trim().startsWith('//'));
        expect(codigo.filter(l => /collection\('lucro_fichas'\)/.test(l))).toEqual([]);
    });

    it('lê `empresa.fichaFinanceira` casando por `mesReferencia`', () => {
        expect(fonte).toMatch(/empresa\.fichaFinanceira/);
        expect(fonte).toMatch(/mesReferencia/);
    });

    it('prefere o saldo A TRANSPORTAR da ficha ANTERIOR (o que sobrou), com o outro de reserva', () => {
        expect(fonte).toMatch(/anterior\?\.saldoCredorIpiTransportar/);
        expect(fonte).toMatch(/atual\?\.saldoCredorIpi\b/);
        expect(fonte).toMatch(/anterior\?\.saldoCredorIcmsTransportar/);
    });

    it('os campos viajam no retorno, com a ORIGEM junto', () => {
        expect(fonte).toMatch(/^\s*saldoCredorIpiAnterior,$/m);
        expect(fonte).toMatch(/^\s*origemSaldoIpi,$/m);
    });

    it('falha na leitura vira AVISO nomeado, nunca "não tem saldo" calado', () => {
        expect(fonte).toMatch(/Não consegui ler os saldos credores da ficha/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 E500/E520 EM QUEM NÃO É CONTRIBUINTE DE IPI — o PVA recusa.
//
// PS VIDROS 07/2026 (19/08): *"Se não for contribuinte do IPI, não deve
// apresentar os registros E500 e filhos"*. Todo comércio compra com IPI
// destacado na nota do fornecedor; para ele aquilo é CUSTO, não crédito.
// A prova positiva é o IPI destacado na SAÍDA, ou o saldo credor da ficha.
// ═══════════════════════════════════════════════════════════════════════════
describe('E500/E520 — crédito de compra não prova contribuinte de IPI', () => {
    const soCredito = {
        direcao: 'entrada', status: 'autorizado', modelo: '55', tipo: 'NFe',
        itens: [{ cfop: '1101', cstIpi: '00', vProd: 1000, vBcIpi: 1000, vIPI: 100 }],
    };

    it('comércio (só IPI de compra, sem saldo na ficha) NÃO gera o bloco — e o aviso diz onde marcar', () => {
        const dados = dadosBase({ notas: [soCredito] });
        const linhas = limpo(buildBlocoE(dados as never));
        expect(linhas.some((l) => l.startsWith('|E500|') || l.startsWith('|E520|'))).toBe(false);
        const w = (dados.warnings as string[]).join('\n');
        expect(w).toMatch(/E500\/E520 NÃO gerados/);
        expect(w).toMatch(/Contribuinte de IPI/);
    });

    it('cadastro marcado SIM gera o bloco mesmo só com crédito', () => {
        const dados = dadosBase({
            notas: [soCredito],
            empresa: { _regime: 'lucro', dadosFiscais: { uf: 'SP', contribuinteIpi: 'sim' } },
        });
        expect(limpo(buildBlocoE(dados as never)).some((l) => l.startsWith('|E520|'))).toBe(true);
    });

    it('cadastro marcado NÃO tira o bloco mesmo com saldo na ficha', () => {
        const dados = dadosBase({
            notas: [soCredito], saldoCredorIpiAnterior: 500,
            empresa: { _regime: 'lucro', dadosFiscais: { uf: 'SP', contribuinteIpi: 'nao' } },
        });
        expect(limpo(buildBlocoE(dados as never)).some((l) => l.startsWith('|E500|'))).toBe(false);
    });

    it('PWR: saldo credor na ficha PROVA o contribuinte — o bloco sai sem cadastro nenhum', () => {
        const dados = dadosBase({ notas: [soCredito], saldoCredorIpiAnterior: 2547.39 });
        const e520 = limpo(buildBlocoE(dados as never)).find((l) => l.startsWith('|E520|'));
        expect(e520).toBe('|E520|2547,39|0,00|100,00|0,00|0,00|2647,39|0,00|');
    });

    it('IPI destacado na SAÍDA prova sozinho (só contribuinte destaca)', () => {
        const comDebito = {
            direcao: 'saida', status: 'autorizado', modelo: '55', tipo: 'NFe',
            itens: [{ cfop: '5101', cstIpi: '50', vProd: 1000, vBcIpi: 1000, vIPI: 50 }],
        };
        expect(limpo(buildBlocoE(dadosBase({ notas: [comDebito] }) as never))
            .some((l) => l.startsWith('|E520|'))).toBe(true);
    });
});
