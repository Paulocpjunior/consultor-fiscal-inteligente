/**
 * Semáforo de insumos da DCTFWeb por departamento (Paulo, 10/08): eSocial
 * (DP/Folha), Reinf (Contábil) e MIT (Fiscal) — quem transmite precisa VER o
 * que já entrou, senão fecha incompleta e retifica com input alheio.
 *
 * O que os testes trancam:
 * 1. Prova por dado real: SERPRO (eSocial/MIT) e gateway+NFS-e (Reinf) —
 *    nenhum estado se marca à mão.
 * 2. FAROL HONESTO no Reinf: ausência de débito ≠ pendência — os estados
 *    'pendente' (há dado esperado) e 'sem-movimento' (nada dos dois lados)
 *    são coisas diferentes, e consulta falha vira 'indeterminado', nunca
 *    afirmação.
 * 3. O veredito nomeia O DEPARTAMENTO que falta — alerta sem dono não age.
 */
import {
    seloEsocial, seloMit, seloReinf, vereditoInsumos, contarRetencoesTomadas,
} from '../sefaz-backend/dctfweb-insumos.js';

describe('seloEsocial', () => {
    test('fechamento transmitido = recebido, com a data', () => {
        const s = seloEsocial({ ok: true, entregue: true, dataEntrega: '2026-08-05' });
        expect(s.estado).toBe('recebido');
        expect(s.departamento).toBe('dp-folha');
        expect(s.quando).toBe('2026-08-05');
    });
    test('sem fechamento = pendente, cobrando o DP e citando o Folhamatic', () => {
        const s = seloEsocial({ ok: true, entregue: false, situacao: 'ABERTO' });
        expect(s.estado).toBe('pendente');
        expect(s.detalhe).toMatch(/Folhamatic/);
    });
    test('consulta caída = indeterminado — o app não afirma o que não leu', () => {
        const s = seloEsocial({ ok: false, erro: 'SERPRO fora' });
        expect(s.estado).toBe('indeterminado');
        expect(s.detalhe).toMatch(/SERPRO fora/);
    });
});

describe('seloMit', () => {
    test('situação 3 = recebido (a mesma régua da retificação #292)', () => {
        expect(seloMit({ ok: true, situacao: 3 }).estado).toBe('recebido');
    });
    test('apuração aberta = pendente com a ação', () => {
        const s = seloMit({ ok: true, situacao: 1, descricao: 'Em edição' });
        expect(s.estado).toBe('pendente');
        expect(s.detalhe).toMatch(/encerrar/i);
    });
});

describe('seloReinf — o caso traiçoeiro do farol', () => {
    test('lote pelo gateway = recebido com protocolo e autor', () => {
        const s = seloReinf({
            lotesGateway: [{ protocolo: '2.2026.77', por: 'vilson.freitas@spassessoriacontabil.com.br', em: 'x' }],
            retencoesApuradas: { totalNotasComRetencao: 5, semCamposGravados: 0 },
        });
        expect(s.estado).toBe('recebido');
        expect(s.detalhe).toMatch(/2\.2026\.77/);
        expect(s.quem).toMatch(/vilson/);
    });
    test('CFI apura retenções E nada saiu pelo gateway = PENDENTE de verdade', () => {
        const s = seloReinf({ lotesGateway: [], retencoesApuradas: { totalNotasComRetencao: 3, semCamposGravados: 0 } });
        expect(s.estado).toBe('pendente');
        expect(s.detalhe).toMatch(/retifica/i);
    });
    test('nada esperado e nada transmitido = sem-movimento (ausência ≠ pendência)', () => {
        const s = seloReinf({ lotesGateway: [], retencoesApuradas: { totalNotasComRetencao: 0, semCamposGravados: 0 } });
        expect(s.estado).toBe('sem-movimento');
    });
    test('sem leitura nenhuma = indeterminado', () => {
        expect(seloReinf({ lotesGateway: [], retencoesApuradas: null }).estado).toBe('indeterminado');
    });
    test('notas antigas sem campos gravados aparecem na ressalva do sem-movimento', () => {
        const s = seloReinf({ lotesGateway: [], retencoesApuradas: { totalNotasComRetencao: 0, semCamposGravados: 4 } });
        expect(s.detalhe).toMatch(/ausência ≠ zero/);
    });
});

describe('vereditoInsumos', () => {
    const recebido = { estado: 'recebido' as const, rotulo: 'A' };
    test('três recebidos = pronto', () => {
        expect(vereditoInsumos([recebido, recebido, recebido]).veredito).toBe('pronto');
    });
    test('um pendente = incompleto, NOMEANDO o departamento', () => {
        const v = vereditoInsumos([recebido, { estado: 'pendente' as const, rotulo: '📊 Contábil — EFD-Reinf' }, recebido]);
        expect(v.veredito).toBe('incompleto');
        expect(v.frase).toMatch(/Contábil/);
    });
    test('indeterminado sem pendente = incerto — decidir é humano', () => {
        const v = vereditoInsumos([recebido, recebido, { estado: 'indeterminado' as const, rotulo: '👥 DP/Folha — eSocial' }]);
        expect(v.veredito).toBe('incerto');
        expect(v.frase).toMatch(/DP\/Folha/);
    });
    test('sem-movimento não trava nada', () => {
        expect(vereditoInsumos([recebido, { estado: 'sem-movimento' as const, rotulo: 'B' }, recebido]).veredito).toBe('pronto');
    });
    test('ignorarDepartamentos tira o MIT da conta na TRAVA do encerramento', () => {
        // O MIT (fiscal) está sendo entregue no ato — pendente nele não deve
        // travar; só DP e Contábil travam.
        const selos = [
            { estado: 'recebido' as const, rotulo: '👥 DP', departamento: 'dp-folha' },
            { estado: 'recebido' as const, rotulo: '📊 Contábil', departamento: 'contabil' },
            { estado: 'pendente' as const, rotulo: '🧾 Fiscal — MIT', departamento: 'fiscal' },
        ];
        expect(vereditoInsumos(selos).veredito).toBe('incompleto');
        expect(vereditoInsumos(selos, { ignorarDepartamentos: ['fiscal'] }).veredito).toBe('pronto');
    });
});

describe('contarRetencoesTomadas', () => {
    const doc = (over: any = {}) => ({
        tipo: 'NFSe', direcao: 'entrada', status: 'autorizado', competencia: '2026-07',
        valores: { ir: 10, inss: 0, csll: 0, valorIssRetido: 0 }, ...over,
    });
    test('conta só NFS-e tomadas da competência com retenção, fora canceladas', () => {
        const r = contarRetencoesTomadas([
            doc(),
            doc({ status: 'cancelado' }),
            doc({ competencia: '2026-06' }),
            doc({ direcao: 'saida' }),
            doc({ valores: { ir: 0, inss: 0, csll: 0, valorIssRetido: 0 } }),
        ] as any, '2026-07');
        expect(r.totalNotasComRetencao).toBe(1);
    });
    test('nota antiga sem campos federais conta em semCamposGravados', () => {
        const r = contarRetencoesTomadas([doc({ valores: { liquido: 100 } })] as any, '2026-07');
        expect(r.semCamposGravados).toBe(1);
    });
});
