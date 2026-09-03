// ============================================================================
// AS QUOTAS DO IRPJ/CSLL TRIMESTRAL — e o defeito que custava dinheiro.
//
// Paulo, 13/08: *"as cotas devem ser enviadas todos os meses pois sofrem
// atualização da SELIC"*. O app fazia o contrário: escolher "3 quotas" emitia
// AS TRÊS no mesmo clique, hoje.
//
// Lei 9.430/96 art. 5º §3º — o acréscimo é *"juros equivalentes à taxa SELIC,
// acumulada mensalmente, calculados a partir do primeiro dia do segundo mês
// subsequente ao do encerramento do período de apuração até o último dia do mês
// ANTERIOR ao do pagamento, e de 1% no mês do pagamento"*.
//
// Logo a quota 3 depende da SELIC do 2º mês, que só é DIVULGADA no começo do
// 3º. Gerada junto com a quota 1, ela sai A MENOR — e guia a menor não avisa:
// o cliente paga, fica com débito residual, e a diferença aparece depois com
// multa. Este é o defeito que o teste tranca.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    planejarQuotas, dividirEmQuotas, vencimentoQuotaTrimestral, mesDaQuota,
    resumoDoPlano, QUOTA_VALOR_MINIMO,
} from '../sefaz-backend/darf-quotas.js';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

describe('vencimento das quotas', () => {
    it('quota i vence no i-ésimo mês após o trimestre', () => {
        // 2º trimestre (competência 06/2026) ⇒ quotas em jul, ago, set.
        expect(mesDaQuota(2026, 6, 1)).toEqual({ ano: 2026, mes: 7 });
        expect(mesDaQuota(2026, 6, 2)).toEqual({ ano: 2026, mes: 8 });
        expect(mesDaQuota(2026, 6, 3)).toEqual({ ano: 2026, mes: 9 });
    });

    it('vira o ano no 4º trimestre', () => {
        expect(mesDaQuota(2026, 12, 1)).toEqual({ ano: 2027, mes: 1 });
        expect(mesDaQuota(2026, 12, 3)).toEqual({ ano: 2027, mes: 3 });
    });

    it('cai no último dia ÚTIL (31/05/2026 é domingo ⇒ 29/05)', () => {
        // 1º trimestre/2026: quota 1 em abril, 2 em maio, 3 em junho.
        expect(vencimentoQuotaTrimestral(2026, 3, 1)).toBe('2026-04-30');
        expect(vencimentoQuotaTrimestral(2026, 3, 2)).toBe('2026-05-29');
    });
});

describe('divisão em quotas', () => {
    it('a soma SEMPRE fecha com o total (a 1ª absorve o centavo)', () => {
        for (const [valor, n] of [[9000, 3], [10000.01, 3], [7333.33, 2], [1, 1]] as const) {
            const partes = dividirEmQuotas(valor, n);
            const soma = partes.reduce((s: number, v: number) => s + Math.round(v * 100), 0);
            expect(soma).toBe(Math.round(valor * 100));
        }
    });
});

describe('MATA-BURRO: quota 2 e 3 NÃO se emitem antes do mês delas', () => {
    const emJulho = () => planejarQuotas({ valor: 9000, anoPA: 2026, mesPA: 6, quotas: 3, hoje: '2026-07-15' });

    it('em julho sai SÓ a quota 1 — as outras ficam agendadas', () => {
        const p = emJulho();
        expect(p.quotasEfetivas).toBe(3);
        expect(p.agora.map((l: any) => l.cota)).toEqual([1]);
        expect(p.depois.map((l: any) => l.cota)).toEqual([2, 3]);
    });

    it('e a recusa DIZ o porquê, com a lei e a consequência', () => {
        const q3 = emJulho().depois.find((l: any) => l.cota === 3)!;
        expect(q3.motivo).toMatch(/SELIC acumulada/);
        expect(q3.motivo).toMatch(/9\.430/);
        // "não emitiu" sem a causa faz procurar defeito onde há regra.
        expect(q3.motivo).toMatch(/A MENOR/);
        expect(q3.vencimento).toBe('2026-09-30');
    });

    it('em agosto a quota 2 já pode sair, e a 3 ainda não', () => {
        const p = planejarQuotas({ valor: 9000, anoPA: 2026, mesPA: 6, quotas: 3, hoje: '2026-08-10' });
        expect(p.agora.map((l: any) => l.cota)).toEqual([1, 2]);
        expect(p.depois.map((l: any) => l.cota)).toEqual([3]);
    });

    it('quota ATRASADA continua emitível — e é sinalizada', () => {
        // Quota que ninguém gerou não pode virar impossível quando o mês passa:
        // é justamente ela que está correndo multa.
        const p = planejarQuotas({ valor: 9000, anoPA: 2026, mesPA: 6, quotas: 3, hoje: '2026-11-01' });
        expect(p.depois).toHaveLength(0);
        expect(p.agora.map((l: any) => l.cota)).toEqual([1, 2, 3]);
        expect(p.agora[2].motivo).toMatch(/vencida em 2026-09-30/);
    });
});

// ═══ 03/09: `hoje` TORTO FAZIA TODA QUOTA SAIR AGORA ══════════════════════
// `chaveMes(undefined)` era NaN, `mesDaCota > NaN` é false, e o plano
// carimbava `emitirAgora: true` nas três — o defeito que o módulo existe para
// impedir, reaberto por um parâmetro ausente. E `Number(valor) || 0` virava
// plano de R$ 0,00 sobre débito ilegível.
describe('MATA-BURRO: parâmetro torto é RECUSA, não plano', () => {
    it('sem `hoje` (ou ilegível) o plano NÃO nasce — e diz o porquê', () => {
        for (const hoje of [undefined, null, '', 'julho', '15/07/2026']) {
            expect(() => planejarQuotas({ valor: 9000, anoPA: 2026, mesPA: 6, quotas: 3, hoje: hoje as any }))
                .toThrow(/Data de hoje inválida/);
        }
    });

    it('valor ilegível/zero/negativo não vira plano de R$ 0,00', () => {
        for (const valor of [undefined, NaN, 'abc', 0, -10]) {
            expect(() => planejarQuotas({ valor: valor as any, anoPA: 2026, mesPA: 6, quotas: 1, hoje: '2026-07-15' }))
                .toThrow(/Valor do débito inválido/);
            expect(() => dividirEmQuotas(valor as any, 1)).toThrow(/Valor do débito inválido/);
        }
    });
});

describe('limites legais (Lei 9.430 art. 5º §1º)', () => {
    it('nenhuma quota abaixo de R$ 1.000 — cai para quota única COM aviso', () => {
        const p = planejarQuotas({ valor: 2500, anoPA: 2026, mesPA: 6, quotas: 3, hoje: '2026-07-15' });
        expect(p.quotasEfetivas).toBe(1);
        expect(p.aviso).toMatch(/mínimo R\$ 1\.000,00 por cota/);
        // Nunca falha em silêncio: sai UMA guia, e a tela sabe dizer por quê.
        expect(p.agora).toHaveLength(1);
        expect(p.agora[0].valorPrincipal).toBe(2500);
    });

    it('R$ 2.000 em 2 quotas é exatamente o limite e PASSA', () => {
        // §1º proíbe quota inferior a R$ 1.000 — 2 × 1.000,00 é legal.
        const p = planejarQuotas({ valor: 2000, anoPA: 2026, mesPA: 6, quotas: 2, hoje: '2026-07-15' });
        expect(p.quotasEfetivas).toBe(2);
        expect(QUOTA_VALOR_MINIMO).toBe(1000);
    });

    it('receita que não é trimestral não tem quota (PIS/COFINS)', () => {
        const p = planejarQuotas({ valor: 90000, anoPA: 2026, mesPA: 6, quotas: 3, hoje: '2026-07-15', aceitaQuota: false });
        expect(p.quotasEfetivas).toBe(1);
        expect(p.aviso).toMatch(/não é IRPJ\/CSLL trimestral/);
    });

    it('quota única não inventa vencimento de quota — é o do tributo', () => {
        const p = planejarQuotas({ valor: 5000, anoPA: 2026, mesPA: 6, quotas: 1, hoje: '2026-07-15' });
        expect(p.linhas[0]).toMatchObject({ cota: null, totalCotas: null, vencimento: null, emitirAgora: true });
        expect(resumoDoPlano(p)).toBeNull();
    });
});

describe('o que a tela diz depois de emitir', () => {
    it('a frase traz a PRÓXIMA cota e A PARTIR DE QUANDO ela pode sair', () => {
        // Paulo, 13/08: *"não posso enviar na data para o cliente"* — a frase
        // dizia "geradas na data delas" e fazia parecer que a guia só nasce no
        // DIA do vencimento. Ela nasce no dia 1º do mês dele: um mês de folga
        // para conferir e mandar. O comportamento sempre foi esse; a frase é
        // que mentia, e frase que assusta à toa faz a equipe evitar o recurso.
        const frase = resumoDoPlano(planejarQuotas({ valor: 9000, anoPA: 2026, mesPA: 6, quotas: 3, hoje: '2026-07-15' }))!;
        expect(frase).toMatch(/Cota 1 de 3 emitida/);
        expect(frase).toMatch(/a partir de 01\/08\/2026/);
        expect(frase).toMatch(/vence em 31\/08/);
        expect(frase).toMatch(/mês inteiro para enviar ao cliente/);
        expect(frase).toMatch(/Cotas do mês/);
    });

    it('e a cota REALMENTE sai no dia 1º do mês dela (não é só texto)', () => {
        const p = planejarQuotas({ valor: 9000, anoPA: 2026, mesPA: 6, quotas: 3, hoje: '2026-08-01' });
        expect(p.agora.map((l: any) => l.cota)).toContain(2);
    });
});

// ============================================================================
// A LIGAÇÃO — núcleo, orquestrador, rota e TELA. Rota sem botão não conta
// (mata-burro de 13/08).
// ============================================================================
describe('o caminho inteiro existe', () => {
    const orq = ler('sefaz-backend/dctfweb-orchestrator.js');
    const rotas = ler('sefaz-backend/dctfweb-routes.js');
    const painel = ler('components/DCTFWeb/QuotasDoMesPanel.tsx');
    const hub = ler('components/DCTFWeb/DctfwebHub.tsx');

    it('o orquestrador usa o núcleo e não tem régua própria de quota', () => {
        expect(orq).toMatch(/from '\.\/darf-quotas\.js'/);
        // As cópias que viviam aqui dentro (mínimo, divisão, vencimento).
        expect(orq).not.toMatch(/const QUOTA_VALOR_MINIMO = 1000/);
        expect(orq).not.toMatch(/function dividirEmQuotas/);
        expect(orq).not.toMatch(/function vencimentoQuotaTrimestral/);
    });

    it('a quota que espera é GRAVADA — senão ela não volta sozinha', () => {
        expect(orq).toMatch(/const COLLECTION_QUOTAS = 'darf_quotas_agenda'/);
        expect(orq).toMatch(/export async function registrarQuotasAgendadas/);
        // Falha ao gravar não derruba a emissão, mas é DITA: agenda perdida em
        // silêncio é pior que não ter agenda.
        expect(orq).toMatch(/agendaGravada = `falhou/);
    });

    it('o id da quota é estável — reemitir sobrescreve, não duplica', () => {
        expect(orq).toMatch(/export function idQuotaAgendada/);
    });

    it('emitir uma quota já emitida é RECUSADO', () => {
        // Duas guias da mesma cota é cobrança em dobro no cliente.
        expect(orq).toMatch(/emitir de novo geraria uma segunda guia da mesma cota/);
    });

    it('a listagem inclui as ATRASADAS (mesRef <= mês pedido)', () => {
        expect(orq).toMatch(/String\(q\.mesRef \|\| ''\) <= ref/);
    });

    it('as rotas existem e respeitam a carteira', () => {
        expect(rotas).toMatch(/router\.get\('\/quotas-agendadas', requireAuth/);
        expect(rotas).toMatch(/router\.post\('\/quotas-agendadas\/emitir', requireAuth/);
        expect(rotas).toMatch(/podeAcessarCnpj\(req\.user, cnpj\)/);
    });

    it('a tela existe, está montada e emite UMA a UMA com confirmação', () => {
        expect(hub).toMatch(/QuotasDoMesPanel/);
        expect(hub).toMatch(/Cotas do mês/);
        expect(painel).toMatch(/window\.confirm/);
        expect(painel).toMatch(/emitirQuotaAgendada/);
    });

    it('a TELA fala "cota", a grafia da casa (Paulo, 13/08)', () => {
        // Lei 9.430 escreve "quota"; o escritório escreve COTA, e a tela é
        // lida pelo colaborador. Misturar as duas grafias na mesma tela foi o
        // que o Paulo marcou no print. Identificador de código pode continuar
        // `quotas` — o que a régua vigia é o TEXTO QUE APARECE.
        const textoVisivel = painel
            .split('\n')
            .filter((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
            .join('\n')
            .replace(/QuotasDoMesPanel|listarQuotasAgendadas|emitirQuotaAgendada|DctfwebQuotaAgendada|setQuotas|quotas\b/g, '');
        expect(textoVisivel).not.toMatch(/[Qq]uota/);
    });

    it('a tela não some com a cota atrasada', () => {
        expect(painel).toMatch(/atrasada/);
        expect(painel).toMatch(/gerando multa/);
    });
});
