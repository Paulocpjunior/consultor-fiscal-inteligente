// ============================================================================
// 🧮 A CRONOLOGIA DO SALDO CREDOR — abertura carimbada + transporte CALCULADO.
//
// Paulo, 17/08: *"essa empresa possui saldos acumulados de meses anteriores…
// a apuração não está considerando o saldo que já vinha sendo acumulado"*.
//
// O desenho decidido: o saldo de ABERTURA vem do E110 c.14 / E520 c.7 do
// último SPED ENTREGUE (colado — nunca digitado), e dali em diante o
// transporte é CALCULADO mês a mês com a MESMA matemática do E110
// (`aplicarAjustesApuracao`, dono único).
//
// 🚨 E A LEITURA DO E520 QUASE NASCEU ERRADA: o parser TS mapeava fields[4]
// (VL_OD_IPI, quase sempre 0,00) como "saldo credor". A prova é a linha REAL
// da PWR: |E520|2547,39|0,00|2200,45|0,00|0,00|4747,84|0,00| —
// 2.547,39 + 2.200,45 = 4.747,84 SÓ fecha com o campo 7 sendo o credor a
// transportar. O parser da tela 🪞 foi corrigido no mesmo PR.
// ============================================================================
// @ts-expect-error módulo JS puro sem tipos
import { extrairAberturaDoSped, resolverSaldoAnterior, transportarIpi, competenciaAnterior, competenciasEntre } from '../sefaz-backend/saldo-abertura.js';
import { classificarAjustes } from '../sefaz-backend/sped-ajustes-apuracao.js';

/** Um SPED ICMS/IPI mínimo, com os números REAIS do E520 da PWR 07/2026. */
const SPED_ENTREGUE = [
    '|0000|020|0|01072026|31072026|PWR INDUSTRIA METALURGICA LTDA|31947349000169||SP|225544975114|3507605||||1|',
    '|0001|0|',
    '|E100|01072026|31072026|',
    '|E110|18741,24|0|0|0|3459,19|0|0|0|0|0|0|0|1250,55|0|',
    '|E520|2547,39|0,00|2200,45|0,00|0,00|4747,84|0,00|',
].join('\n');

describe('🧮 extrairAberturaDoSped — a fonte é o ARQUIVO entregue', () => {
    it('lê CNPJ, competência, E110 c.14 e E520 c.7', () => {
        const r = extrairAberturaDoSped(SPED_ENTREGUE);
        expect(r.ok).toBe(true);
        expect(r.cnpj).toBe('31947349000169');
        expect(r.competencia).toBe('2026-07');
        expect(r.icms).toBeCloseTo(1250.55, 2);
        expect(r.ipi).toBeCloseTo(4747.84, 2);
    });

    it('🚨 o IPI sai do campo 7 — fields[4] é o VL_OD, o quase-erro do parser', () => {
        // Se lesse fields[4], voltaria 0,00 e a abertura nasceria SEM o crédito
        // de IPI — o defeito original (E520 0,00) com roupa de correção.
        expect(extrairAberturaDoSped(SPED_ENTREGUE).ipi).not.toBe(0);
    });

    it('sem E110 recusa NOMEADO — EFD-Contribuições colado por engano não vira abertura', () => {
        const contrib = '|0000|006|0|||01072026|31072026|X|31947349000169|SP|3507605||00|0|\n|M200|0|0|0|0|0|0|0|1|0|0|1|1|';
        const r = extrairAberturaDoSped(contrib);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/EFD-Contribuições não serve/);
    });

    it('dois E110 recusa — colagem de arquivos emendados não escolhe competência sozinha', () => {
        const r = extrairAberturaDoSped(`${SPED_ENTREGUE}\n|E110|1|0|0|0|1|0|0|0|0|0|0|0|9,99|0|`);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/UM arquivo por vez/);
    });

    it('sem E520 a abertura de IPI é 0 com temE520=false — comércio não tem o bloco', () => {
        const semIpi = SPED_ENTREGUE.split('\n').filter((l) => !l.startsWith('|E520|')).join('\n');
        const r = extrairAberturaDoSped(semIpi);
        expect(r.ok).toBe(true);
        expect(r.ipi).toBe(0);
        expect(r.temE520).toBe(false);
    });

    it('texto vazio ou sem 0000 recusa com a ação', () => {
        expect(extrairAberturaDoSped('').ok).toBe(false);
        expect(extrairAberturaDoSped('|C100|...|').motivo).toMatch(/registro 0000/);
    });
});

describe('🧮 resolverSaldoAnterior — a cadeia anda com a matemática do arquivo', () => {
    const abertura = { competencia: '2026-06', icms: 1250.55, ipi: 4747.84 };

    it('caso comum: abertura é o mês imediatamente anterior — valor direto, sem cadeia', () => {
        const r = resolverSaldoAnterior({ abertura, competencia: '2026-07' });
        expect(r.aplicavel).toBe(true);
        expect(r.icms).toBeCloseTo(1250.55, 2);
        expect(r.ipi).toBeCloseTo(4747.84, 2);
        expect(r.cadeia).toEqual([]);
        expect(r.origem).toMatch(/SPED ENTREGUE de 2026-06/);
    });

    it('🚨 NÃO retroage: competência ≤ abertura é recusada nomeada', () => {
        const r = resolverSaldoAnterior({ abertura, competencia: '2026-06' });
        expect(r.aplicavel).toBe(false);
        expect(r.motivo).toMatch(/já foi entregue/);
        expect(resolverSaldoAnterior({ abertura, competencia: '2026-05' }).aplicavel).toBe(false);
    });

    it('cadeia de um mês: o transporte usa a MESMA matemática do E110', () => {
        // Julho: débitos 1.000, créditos 400 → saldo 600 − 1.250,55 anterior =
        // credor 650,55 a transportar para agosto. IPI: deb 0, cred 100 →
        // 4.747,84 + 100 = 4.847,84.
        const r = resolverSaldoAnterior({
            abertura,
            competencia: '2026-08',
            movimentos: {
                '2026-07': {
                    icms: { debitos: 1000, creditos: 400, cls: classificarAjustes([]) },
                    ipi: { debitos: 0, creditos: 100 },
                },
            },
        });
        expect(r.aplicavel).toBe(true);
        expect(r.icms).toBeCloseTo(650.55, 2);
        expect(r.ipi).toBeCloseTo(4847.84, 2);
        expect(r.cadeia).toHaveLength(1);
        expect(r.origem).toMatch(/transporte CALCULADO/);
    });

    it('mês devedor ZERA o transporte — crédito consumido não reaparece', () => {
        const r = resolverSaldoAnterior({
            abertura: { competencia: '2026-06', icms: 100, ipi: 50 },
            competencia: '2026-08',
            movimentos: {
                '2026-07': {
                    icms: { debitos: 5000, creditos: 200, cls: classificarAjustes([]) },
                    ipi: { debitos: 900, creditos: 10 },
                },
            },
        });
        expect(r.icms).toBe(0);
        expect(r.ipi).toBe(0);
    });

    it('🚨 elo FALTANDO derruba a cadeia NOMEADO — mês sem leitura não vira zero calado', () => {
        const r = resolverSaldoAnterior({ abertura, competencia: '2026-09', movimentos: {} });
        expect(r.aplicavel).toBe(false);
        expect(r.faltam).toEqual(['2026-07', '2026-08']);
        expect(r.motivo).toMatch(/2026-07, 2026-08/);
    });

    it('sem abertura cadastrada, não se aplica — o caminho da ficha continua', () => {
        expect(resolverSaldoAnterior({ abertura: null, competencia: '2026-07' }).aplicavel).toBe(false);
    });
});

describe('helpers de competência e a fórmula do IPI', () => {
    it('competenciaAnterior atravessa o ano', () => {
        expect(competenciaAnterior('2026-07')).toBe('2026-06');
        expect(competenciaAnterior('2026-01')).toBe('2025-12');
    });

    it('competenciasEntre é exclusiva nas duas pontas', () => {
        expect(competenciasEntre('2026-06', '2026-07')).toEqual([]);
        expect(competenciasEntre('2026-04', '2026-07')).toEqual(['2026-05', '2026-06']);
        expect(competenciasEntre('2025-11', '2026-02')).toEqual(['2025-12', '2026-01']);
    });

    it('transportarIpi espelha o E520 do gerador — a linha real da PWR fecha', () => {
        // |E520|2547,39|0,00|2200,45|...|4747,84|0,00| → deb 0, cred 2.200,45,
        // ant 2.547,39 ⇒ credor 4.747,84.
        expect(transportarIpi({ saldoAnterior: 2547.39, debitos: 0, creditos: 2200.45 })).toBeCloseTo(4747.84, 2);
        expect(transportarIpi({ saldoAnterior: 0, debitos: 500, creditos: 100 })).toBe(0);
    });
});

// ─── AS TRAVAS DE COMPOSIÇÃO — núcleo sem leitor não protege ─────────────────
//
// A família do "rota sem botão" (13/08) e do gate por último (20/08): cada
// pedaço aqui já quebrou sozinho uma vez em outro módulo. As varreduras provam
// que os pedaços estão LIGADOS, não só escritos.
import * as fs from 'fs';
import * as path from 'path';
const ler = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('🚨 a cronologia está LIGADA de ponta a ponta', () => {
    it('a rota existe, extrai pelo núcleo e confere o CNPJ antes de gravar', () => {
        const rotas = ler('sefaz-backend/sped-fiscal-routes.js');
        expect(rotas).toMatch(/router\.post\('\/saldo-abertura'/);
        expect(rotas).toMatch(/router\.get\('\/saldo-abertura'/);
        expect(rotas).toMatch(/extrairAberturaDoSped\(texto\)/);
        // SPED de outro cliente é recusado NOMEADO — abertura da empresa
        // errada é saldo de um contribuinte transportado para outro.
        expect(rotas).toMatch(/cnpjEmpresa !== r\.cnpj/);
    });

    it('o orquestrador PREFERE a abertura e só cai na ficha sem ela', () => {
        const orq = ler('sefaz-backend/sped-fiscal-orchestrator.js');
        expect(orq).toMatch(/sped_saldos_abertura/);
        expect(orq).toMatch(/resolverSaldoAnterior\(\{ abertura/);
        // A ficha é o FALLBACK: o bloco dela tem que estar condicionado.
        expect(orq).toMatch(/regime === 'lucro' && !saldoVeioDaAbertura/);
        // E a cadeia usa as MESMAS somas do E110/E520 — não uma conta nova.
        expect(orq).toMatch(/somarIcmsPorDirecao\(notasMes, 'saida'\)/);
        expect(orq).toMatch(/somarImpostoPorDirecao\(notasMes, 'entrada', 'vIPI', 'vIPI'\)/);
    });

    it('a rota nasceu COM a tela — aba 🧮 no card SPED (rota sem botão é código morto)', () => {
        const card = ler('components/SpedFiscal/index.tsx');
        expect(card).toMatch(/'saldo'/);
        expect(card).toMatch(/🧮 Saldo de abertura/);
        expect(card).toMatch(/spedTab === 'saldo' && \(/);
        const tela = ler('components/SpedFiscal/SaldoAbertura.tsx');
        // A tela NÃO tem campo de digitar valor — a fonte é o arquivo colado.
        expect(tela).toMatch(/saldo-abertura/);
        expect(tela).not.toMatch(/type="number"/);
    });

    it('a coleção está no catálogo do banco e nas rules (backend-only)', () => {
        expect(ler('sefaz-backend/catalogo-banco.js')).toMatch(/sped_saldos_abertura/);
        const rules = ler('firestore.rules');
        const bloco = rules.slice(rules.indexOf('match /sped_saldos_abertura/'));
        expect(bloco.slice(0, 200)).toMatch(/allow read, write: if false/);
    });

    it('o aviso da geração DISTINGUE cronologia de ficha — não mente mais "não calcula"', () => {
        const aviso = ler('sefaz-backend/saldo-anterior-apuracao.js');
        expect(aviso).toMatch(/daCronologia/);
        expect(aviso).toMatch(/CALCULADO pela/);
    });
});

describe('o aviso muda de tom quando o valor é da cronologia', () => {
    const { avisosDeSaldoAnterior } = require('../sefaz-backend/saldo-anterior-apuracao.js');

    it('origem da cronologia → "CALCULADO", sem mandar conferir a ficha', () => {
        const avisos = avisosDeSaldoAnterior({
            icmsAnterior: 1250.55,
            origemIcms: 'E110 c.14 / E520 c.7 do SPED ENTREGUE de 2026-06 (saldo de abertura carimbado)',
            ipiAnterior: 4747.84,
            origemIpi: 'E110 c.14 / E520 c.7 do SPED ENTREGUE de 2026-06 (saldo de abertura carimbado)',
            geraIpi: true,
        });
        const texto = avisos.join(' ');
        expect(texto).toMatch(/CALCULADO pela/);
        expect(texto).not.toMatch(/foi digitado na ficha/);
    });

    it('origem da ficha continua honesta — digitado, com o caminho da 🧮 na frase', () => {
        const avisos = avisosDeSaldoAnterior({
            icmsAnterior: 100, origemIcms: 'saldo A TRANSPORTAR da ficha da competência anterior',
            ipiAnterior: 50, origemIpi: 'campo "Cred. IPI do mês anterior (compensado)" da ficha desta competência',
            geraIpi: true,
        });
        const texto = avisos.join(' ');
        expect(texto).toMatch(/🧮 Saldo de abertura/);
        expect(texto).not.toMatch(/CALCULADO pela/);
    });
});

// ─── O PARSER DA 🪞 LÊ O E520 PELO LEIAUTE REAL — o defeito que este PR achou ─
describe('🚨 o parser TS do E520 foi corrigido — a linha real da PWR prova', () => {
    it('parseSpedFile devolve o VL_SC_IPI do campo 7, não o VL_OD do 4', () => {
        // Antes: "Saldo Credor IPI" na tela mostrava fields[4] (VL_OD, 0,00) e
        // "IPI a Recolher" mostrava fields[3] (VL_CRED). Ninguém pegou porque
        // pouquíssimos clientes têm IPI — e a tela mostrava zero plausível.
        const fonte = ler('services/spedFiscalParserService.ts');
        expect(fonte).toMatch(/valorSaldoCredorIpi: parseNumber\(fields\[6\]\)/);
        expect(fonte).toMatch(/valorSaldoDevedorIpi: parseNumber\(fields\[7\]\)/);
        expect(fonte).not.toMatch(/valorIpiRecolher: parseNumber\(fields\[3\]\)/);
    });

    it('e o resumo gravado usa o VL_SD (a recolher), não mais o VL_CRED', () => {
        expect(ler('services/spedFiscalStorageService.ts'))
            .toMatch(/ipiRecolher: parseResult\.apuracaoIpi\?\.valorSaldoDevedorIpi/);
    });
});
