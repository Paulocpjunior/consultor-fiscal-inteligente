// ============================================================================
// __tests__/desempenhoColaboradores.test.ts — colaborador × empresa × ato.
//
// 22/09/2026, Paulo: "auditoria completa, capaz de mapear o desempenho, por
// colaborador x empresas, o que cada colaborador efetivamente executou nos
// últimos 2 meses". O módulo LÊ carimbos; não deduz autor, não recalcula.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    TIPOS_ATO, normalizarAto, resolverColaborador, montarDesempenho, periodoPadrao, paraIso,
} from '../sefaz-backend/desempenho-colaboradores.js';

const RAIZ = join(__dirname, '..');
const tipo = (id: string) => TIPOS_ATO.find((t) => t.id === id)!;
const usuarios = [
    { id: 'uid-sandra', name: 'Sandra', email: 'sandra@sp.com.br', role: 'colaborador' },
    { id: 'uid-joao', name: 'João', email: 'joao@sp.com.br', role: 'colaborador' },
];
const vinculos = [
    { colaboradorUid: 'uid-sandra', colaboradorNome: 'Sandra', empresaId: 'e1', empresaNome: 'AFFITTARE', papel: 'principal' },
    { colaboradorUid: 'uid-sandra', colaboradorNome: 'Sandra', empresaId: 'e2', empresaNome: 'MANTOAN', papel: 'principal' },
    { colaboradorUid: 'uid-joao', colaboradorNome: 'João', empresaId: 'e3', empresaNome: 'WALDESA', papel: 'principal' },
];
const ts = (iso: string) => ({ toDate: () => new Date(iso) });

describe('normalizarAto lê os carimbos de cada trilha', () => {
    it('tarefa concluída: uid + Timestamp + obrigação', () => {
        const a = normalizarAto(tipo('tarefa-concluida'), 't1', {
            concluidaPor: 'uid-sandra', concluidaEm: ts('2026-09-10T12:00:00Z'), empresaId: 'e1', empresaNome: 'AFFITTARE', obrigacao: 'DCTFWEB',
        });
        expect(a).toMatchObject({ tipo: 'tarefa-concluida', quem: 'uid-sandra', empresaId: 'e1', detalhe: 'DCTFWEB' });
        expect(a.em).toBe('2026-09-10T12:00:00.000Z');
    });
    it('XML importado à mão: e-mail vence o uid, e NFS-e por PDF é subtipo', () => {
        const x = normalizarAto(tipo('xml-importado'), 'd1', { importadoPor: 'uid-joao', importadoPorEmail: 'joao@sp.com.br', importadoEm: Date.parse('2026-09-01T10:00:00Z'), empresaId: 'e3', tipo: 'NFe' });
        expect(x.quem).toBe('joao@sp.com.br');
        expect(x.tipo).toBe('xml-importado');
        const n = normalizarAto(tipo('xml-importado'), 'd2', { createdBy: 'uid-joao', createdByEmail: 'joao@sp.com.br', importadoEm: 1756720000000, empresaId: 'e3', tipo: 'nfse' });
        expect(n.tipo).toBe('nfse-pdf-importada');
    });
    it('fim de mês: quem mora em fechadoPor.email; ISO passa direto', () => {
        const a = normalizarAto(tipo('fim-de-mes'), 'f1', { fechadoPor: { uid: 'u', email: 'sandra@sp.com.br' }, fechadoEm: '2026-09-05T20:00:00.000Z', empresaId: 'e2' });
        expect(a.quem).toBe('sandra@sp.com.br');
        expect(a.em).toBe('2026-09-05T20:00:00.000Z');
    });
    it('sem carimbo, quem é null — nunca inventado', () => {
        expect(normalizarAto(tipo('das-emitido'), 'x', { emitidoEm: '2026-09-01T00:00:00Z', empresaId: 'e1' }).quem).toBeNull();
        expect(paraIso('lixo')).toBeNull();
    });
});

describe('resolverColaborador: e-mail é a chave; uid vira e-mail pelo cadastro; sistema é balde próprio', () => {
    it('uid → e-mail', () => {
        expect(resolverColaborador('uid-sandra', usuarios)).toMatchObject({ chave: 'sandra@sp.com.br', nome: 'Sandra', pessoa: true });
    });
    it('e-mail com caixa diferente → mesma pessoa', () => {
        expect(resolverColaborador('Sandra@SP.com.br', usuarios).chave).toBe('sandra@sp.com.br');
    });
    it('sistema/envio-imposto NÃO é pessoa; vazio é "(não identificado)"', () => {
        expect(resolverColaborador('envio-imposto', usuarios)).toMatchObject({ chave: 'sistema', pessoa: false });
        expect(resolverColaborador('', usuarios)).toMatchObject({ chave: '(não identificado)', pessoa: false });
    });
    it('ex-colaborador (e-mail fora do cadastro) continua pessoa, com o que se sabe', () => {
        expect(resolverColaborador('antiga@sp.com.br', usuarios)).toMatchObject({ chave: 'antiga@sp.com.br', pessoa: true, uid: null });
    });
});

describe('montarDesempenho: a matriz, a carteira e o farol honesto', () => {
    const atos = [
        normalizarAto(tipo('tarefa-concluida'), 't1', { concluidaPor: 'uid-sandra', concluidaEm: ts('2026-09-10T12:00:00Z'), empresaId: 'e1', empresaNome: 'AFFITTARE', obrigacao: 'FGTS' }),
        normalizarAto(tipo('tarefa-concluida'), 't2', { concluidaPor: 'sandra@sp.com.br', concluidaEm: ts('2026-09-11T12:00:00Z'), empresaId: 'e1', empresaNome: 'AFFITTARE', obrigacao: 'DCTFWEB' }),
        normalizarAto(tipo('imposto-enviado'), 'i1', { enviadoPor: 'sandra@sp.com.br', enviadoEm: ts('2026-09-12T12:00:00Z'), empresaId: 'e9', empresaNome: 'CLIENTE DO JOÃO', tipo: 'DAS' }),
        normalizarAto(tipo('xml-importado'), 'd1', { importadoPorEmail: 'joao@sp.com.br', importadoEm: Date.parse('2026-09-01T10:00:00Z'), empresaId: 'e3', empresaNome: 'WALDESA', tipo: 'NFe' }),
        normalizarAto(tipo('tarefa-concluida'), 't3', { concluidaPor: 'envio-imposto', concluidaEm: ts('2026-09-13T12:00:00Z'), empresaId: 'e3', empresaNome: 'WALDESA' }),
        normalizarAto(tipo('tarefa-concluida'), 't4', { concluidaPor: 'uid-sandra', concluidaEm: ts('2026-06-01T12:00:00Z'), empresaId: 'e2', empresaNome: 'MANTOAN' }), // fora do período
        normalizarAto(tipo('das-emitido'), 'g1', { emitidoEm: '2026-09-02T00:00:00Z', empresaId: 'e1' }),                                  // sem autor
        normalizarAto(tipo('tarefa-concluida'), 't5', { concluidaPor: 'uid-joao', empresaId: 'e3' }),                                       // sem data
    ];
    const r = montarDesempenho({ atos, usuarios, vinculos, de: '2026-07-22T00:00:00.000Z', ate: '2026-09-22T23:59:59.000Z' });

    it('uid e e-mail da MESMA pessoa somam na mesma linha', () => {
        const s = r.colaboradores.find((c) => c.chave === 'sandra@sp.com.br')!;
        expect(s.total).toBe(3);
        expect(s.porTipo['tarefa-concluida']).toBe(2);
        expect(s.porTipo['imposto-enviado']).toBe(1);
    });
    it('por empresa: AFFITTARE 2 atos (na carteira); a empresa de outro colaborador aparece marcada "fora da carteira"', () => {
        const s = r.colaboradores.find((c) => c.chave === 'sandra@sp.com.br')!;
        const aff = s.empresas.find((e) => e.empresaId === 'e1')!;
        expect(aff).toMatchObject({ total: 2, naCarteira: true, empresaNome: 'AFFITTARE' });
        expect(s.empresas.find((e) => e.empresaId === 'e9')!.naCarteira).toBe(false);
    });
    it('🚨 a empresa da carteira SEM ato sai NOMEADA (MANTOAN: o ato de junho está fora do período)', () => {
        const s = r.colaboradores.find((c) => c.chave === 'sandra@sp.com.br')!;
        expect(s.empresasDaCarteira).toBe(2);
        expect(s.empresasDaCarteiraSemAto.map((e) => e.empresaNome)).toEqual(['MANTOAN']);
    });
    it('sistema e "(não identificado)" são baldes próprios, depois das pessoas', () => {
        const chaves = r.colaboradores.map((c) => c.chave);
        expect(chaves.slice(0, 2)).toEqual(['sandra@sp.com.br', 'joao@sp.com.br']);
        expect(chaves).toContain('sistema');
        expect(chaves).toContain('(não identificado)');
        expect(r.colaboradores.find((c) => c.chave === 'sistema')!.pessoa).toBe(false);
    });
    it('totais e contagens à parte: fora do período não conta; sem data vai contado', () => {
        expect(r.totalAtos).toBe(6);
        expect(r.semData).toBe(1);
        expect(r.totaisPorTipo['tarefa-concluida']).toBe(3);
    });
    it('as ressalvas dizem o que a trilha não carimba e o que fica fora', () => {
        const txt = r.ressalvas.join(' ');
        expect(txt).toMatch(/"DAS emitido" NÃO grava quem fez/);
        expect(txt).toMatch(/1 ato\(s\) sem autor gravado/);
        expect(txt).toMatch(/1 ato\(s\) sem data legível/);
        expect(txt).toMatch(/só é carimbado desde/);
        expect(txt).toMatch(/SPED gerado/);
    });
    it('colaborador com carteira e ZERO atos aparece com zero, não some', () => {
        const r2 = montarDesempenho({ atos: [], usuarios, vinculos, de: '2026-07-22T00:00:00.000Z', ate: '2026-09-22T00:00:00.000Z' });
        const j = r2.colaboradores.find((c) => c.chave === 'joao@sp.com.br')!;
        expect(j.total).toBe(0);
        expect(j.empresasDaCarteiraSemAto.map((e) => e.empresaNome)).toEqual(['WALDESA']);
    });
    it('trilha não lida entra nomeada e NÃO vira zero', () => {
        const r3 = montarDesempenho({ atos: [], usuarios, vinculos, naoLidas: [{ tipo: 'imposto-enviado', rotulo: 'Guia enviada ao cliente', motivo: 'timeout' }] });
        expect(r3.ressalvas[0]).toMatch(/NÃO foram lidas \(Guia enviada ao cliente\)/);
    });
    it('período padrão: 2 meses até agora', () => {
        const p = periodoPadrao(2, new Date('2026-09-22T12:00:00Z'));
        expect(p.de.slice(0, 10)).toBe('2026-07-22');
        expect(p.ate.slice(0, 10)).toBe('2026-09-22');
    });
});

describe('a rota e a tela existem, com a MESMA trava do dono', () => {
    it('GET /desempenho passa por requireAdmin e requireDono', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/auditoria-dono-routes.js'), 'utf8');
        expect(src).toMatch(/router\.get\('\/desempenho', requireAdmin, requireDono/);
        expect(src).toContain('periodoPadrao(2)');
        // trilha que falha NÃO derruba o relatório
        expect(src).toMatch(/naoLidas\.push\(\{ tipo: tipo\.id/);
    });
    it('a tela é uma aba do painel do dono e mostra as ressalvas antes dos números', () => {
        const idx = readFileSync(join(RAIZ, 'components/AuditoriaDono/index.tsx'), 'utf8');
        expect(idx).toContain("import Desempenho from './Desempenho'");
        const tela = readFileSync(join(RAIZ, 'components/AuditoriaDono/Desempenho.tsx'), 'utf8');
        expect(tela).toContain('empresasDaCarteiraSemAto');
        expect(tela).toContain('dados.ressalvas.map');
        expect(tela).toContain('gerarRelatorioPdf');
    });
});
