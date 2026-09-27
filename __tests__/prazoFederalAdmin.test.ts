// ============================================================================
// __tests__/prazoFederalAdmin.test.ts — o admin muda a data de vencimento SEM
// deploy, e a DCTFWeb vence no último dia útil.
//
// 22/09/2026, Paulo (colaborador admin): *"Preciso que me dê permissão para
// alterar a data dos vencimentos, por exemplo a DCTF WEB, ainda está com
// vencimento de todo dia 15, mas vence no final do mês"* — e a AFFITTARE
// 08/2026 aparecia com "DCTFWEB — ATRASADA" em 21/09, antes do prazo real.
//
// Duas respostas, as duas aqui:
//   1. o CATÁLOGO passa a dizer o prazo certo (último dia útil do mês
//      seguinte, IN RFB 2.237/2024);
//   2. o cadastro de prazos ganha a esfera FEDERAL (escopo 'BR'): o admin
//      cadastra a vigência nova em ⚙️ Config Admin → Calendário de prazos e o
//      cadastro VENCE o catálogo daquela competência em diante — com a opção
//      de reaplicar a data nas tarefas abertas.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    CATALOGO, calcularVencimento, mesDoCliente,
} from '../sefaz-backend/catalogo-obrigacoes.js';
import {
    validarPrazoMunicipal, escopoDoPrazo, escopoDoCliente, idPrazoMunicipal, resolverPrazoFederal,
} from '../sefaz-backend/prazos-municipais.js';

const RAIZ = join(__dirname, '..');
const presumido = { colecao: 'lucro_empresas', regimePadrao: 'Presumido', uf: 'SP' };
const dctf = () => (CATALOGO.LUCRO_PRESUMIDO as any[]).find((r) => r.obrigacao === 'DCTFWEB');

describe('🚨 a DCTFWeb vence no ÚLTIMO DIA ÚTIL do mês seguinte, não no dia 15', () => {
    it('o catálogo diz último dia útil, com a norma', () => {
        expect(dctf().ultimoDiaUtilDoMes).toBe(true);
        expect(dctf().diaVencimento).toBeNull();
        expect(dctf().baseLegal).toMatch(/2\.237\/2024/);
    });
    it('competência 08/2026 → 30/09/2026 (quarta-feira)', () => {
        const v = calcularVencimento('08/2026', dctf())!;
        expect(v.getFullYear()).toBe(2026);
        expect(v.getMonth()).toBe(8);
        expect(v.getDate()).toBe(30);
    });
    it('competência 04/2026: 31/05 é domingo → 29/05 (sexta)', () => {
        const v = calcularVencimento('04/2026', dctf())!;
        expect(v.getMonth()).toBe(4);
        expect(v.getDate()).toBe(29);
    });
    it('o mês do cliente sai com a data certa — é ela que a Rotina compara com hoje', () => {
        const d: any = mesDoCliente(presumido, '08/2026').obrigacoes.find((r: any) => r.obrigacao === 'DCTFWEB');
        expect(d.vencimento.getDate()).toBe(30);
        expect(d.vencimento.getMonth()).toBe(8);
    });
});

describe('🏦 a esfera FEDERAL entrou no cadastro de prazos', () => {
    const federal: any = {
        esfera: 'federal', obrigacao: 'DCTFWEB', ultimoDiaUtilDoMes: true,
        mesesApos: 1, baseLegal: 'IN RFB 2.237/2024', vigenciaInicio: '2025-01-01',
    };
    it('escopo é BR — sem IBGE e sem UF', () => {
        expect(escopoDoPrazo(federal)).toBe('BR');
        expect(escopoDoCliente({ esfera: 'federal' })).toBe('BR');
        expect(idPrazoMunicipal(federal)).toBe('BR_DCTFWEB_2025-01-01');
    });
    it('"último dia útil" dispensa o dia fixo; sem os dois, recusa', () => {
        expect(validarPrazoMunicipal(federal).ok).toBe(true);
        const semDia = validarPrazoMunicipal({ ...federal, ultimoDiaUtilDoMes: false });
        expect(semDia.ok).toBe(false);
        expect(semDia.erros.join(' ')).toMatch(/último dia útil/);
        expect(validarPrazoMunicipal({ ...federal, ultimoDiaUtilDoMes: false, diaVencimento: 20 }).ok).toBe(true);
    });
    it('base legal continua obrigatória — data sem norma não se confere', () => {
        expect(validarPrazoMunicipal({ ...federal, baseLegal: '' }).ok).toBe(false);
    });
    it('resolve por VIGÊNCIA: antes dela, vale o catálogo', () => {
        const r = resolverPrazoFederal([federal], { obrigacao: 'DCTFWEB', competencia: '2026-08' });
        expect(r.achou).toBe(true);
        expect(r.prazo.ultimoDiaUtilDoMes).toBe(true);
        expect(r.prazo.diaVencimento).toBeNull();
        expect(resolverPrazoFederal([federal], { obrigacao: 'DCTFWEB', competencia: '2024-06' }).situacao).toBe('fora-de-vigencia');
        expect(resolverPrazoFederal([], { obrigacao: 'DCTFWEB', competencia: '2026-08' }).situacao).toBe('sem-cadastro');
    });
});

describe('🚨 o cadastro do admin VENCE o catálogo — é a permissão pedida', () => {
    it('federal: DCTFWeb cadastrada no dia 20 sai no dia 20 (e o catálogo diz último dia útil)', () => {
        const cad = [{
            esfera: 'federal', obrigacao: 'DCTFWEB', diaVencimento: 20, mesesApos: 1,
            ajusteDiaNaoUtil: 'antecipa', baseLegal: 'teste de sobreposição', vigenciaInicio: '2026-01-01',
        }];
        const m: any = mesDoCliente({ ...presumido, prazosMunicipais: cad }, '08/2026');
        const d: any = m.obrigacoes.find((r: any) => r.obrigacao === 'DCTFWEB');
        expect(d.vencimento.getDate()).toBe(18);          // 20/09/2026 é domingo → antecipa para sexta 18
        expect(d.prazoAdmin).toBeTruthy();
        expect(m.federaisResolvidas.map((r: any) => r.obrigacao)).toEqual(['DCTFWEB']);
        // fora da vigência, volta ao catálogo
        const antes: any = mesDoCliente({ ...presumido, prazosMunicipais: cad }, '12/2025').obrigacoes.find((r: any) => r.obrigacao === 'DCTFWEB');
        expect(antes.prazoAdmin).toBeUndefined();
        expect(antes.vencimento.getDate()).toBe(30);       // 30/01/2026, sexta
    });
    it('estadual da PRÓPRIA UF: o SPED de SP também pode ser corrigido pelo admin', () => {
        const cad = [{
            esfera: 'estadual', uf: 'SP', obrigacao: 'SPED', diaVencimento: 20, mesesApos: 1,
            ajusteDiaNaoUtil: 'antecipa', baseLegal: 'teste', vigenciaInicio: '2026-01-01',
        }];
        const s: any = mesDoCliente({ ...presumido, prazosMunicipais: cad }, '08/2026').obrigacoes.find((r: any) => r.obrigacao === 'SPED');
        expect(s.prazoEstadual).toBeTruthy();
        expect(s.vencimento.getMonth()).toBe(8);
        expect(s.vencimento.getDate()).toBe(18);           // 20/09 domingo → 18
    });
    it('sem cadastro nada muda: o catálogo continua respondendo', () => {
        const s: any = mesDoCliente(presumido, '08/2026').obrigacoes.find((r: any) => r.obrigacao === 'SPED');
        expect(s.prazoEstadual).toBeUndefined();
    });
});

describe('a rota e a TELA existem — o erro de ligar meia ponta não se repete', () => {
    it('a rota grava esfera federal, "último dia útil" e reaplica nas tarefas abertas', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/prazos-municipais-routes.js'), 'utf8');
        expect(src).toContain("['estadual', 'federal'].includes");
        expect(src).toContain('ultimoDiaUtilDoMes');
        expect(src).toContain('reaplicarNasTarefas');
        // concluída e cancelada NÃO mudam de data
        expect(src).toMatch(/status === 'concluida' \|\| t\.status === 'cancelada'\) return/);
    });
    it('a tela oferece a esfera federal, o último dia útil e a reaplicação', () => {
        const src = readFileSync(join(RAIZ, 'components/PrazosMunicipaisPanel.tsx'), 'utf8');
        expect(src).toContain("'federal'");
        expect(src).toContain('ultimoDiaUtilDoMes');
        expect(src).toContain('reaplicarNasTarefas');
        expect(src).toContain('OBRIGACOES_FEDERAIS');
    });
    it('o cron e o auto-gerar já passam os cadastros ao mesDoCliente — o federal viaja no mesmo balde', () => {
        expect(readFileSync(join(RAIZ, 'sefaz-backend/tarefas-orchestrator.js'), 'utf8')).toContain('prazosMunicipais,');
        expect(readFileSync(join(RAIZ, 'services/tarefasAutoGerar.ts'), 'utf8')).toContain('prazosMunicipais');
    });
});
