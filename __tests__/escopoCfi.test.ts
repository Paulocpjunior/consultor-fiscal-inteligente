// ============================================================================
// Recorte "só o CFI" da auditoria do dono (Paulo, 22/09: "voce esta
// aglutinando todos os usuarios de todos os APPs nao podemos misturar").
// O que este teste protege: quem é do CFI é regra DITA (departamento Fiscal,
// admin ou carteira), o que sai NÃO some em silêncio (contado, com motivo) e
// o evento de app irmão sai mesmo quando o autor é do CFI.
// ============================================================================
import {
    classificarUsuarioCfi, conjuntoCfi, classificarEscopoCfi, filtrarEscopoCfi, ressalvaEscopoCfi,
} from '../sefaz-backend/escopo-cfi.js';
import { TRILHAS, montarAuditoria } from '../sefaz-backend/auditoria-dono.js';
import { TIPOS_ATO, normalizarAto, montarDesempenho } from '../sefaz-backend/desempenho-colaboradores.js';

const usuarios = [
    { id: 'uid-paulo', email: 'paulo@sp.com.br', role: 'admin' },
    { id: 'uid-sandra', email: 'sandra@sp.com.br', role: 'colaborador', departamentos: ['fiscal'] },
    { id: 'uid-joao', email: 'joao@sp.com.br', role: 'colaborador' },                                   // sem departamento, MAS com carteira
    { id: 'uid-rh', email: 'rhsp@sp.com.br', role: 'colaborador', departamentos: ['dp-folha'] },
    { id: 'uid-recepcao', email: 'recepcao@sp.com.br', role: 'colaborador' },                           // sem departamento, sem carteira
];
const vinculos = [{ colaboradorUid: 'uid-joao', empresaId: 'e3', empresaNome: 'WALDESA' }];
const conjunto = conjuntoCfi({ usuarios, vinculos });

describe('quem é do CFI é regra dita', () => {
    it('departamento Fiscal, admin e carteira entram; DP e "sem departamento" ficam fora com motivo', () => {
        expect(classificarUsuarioCfi(usuarios[1]).ehCfi).toBe(true);
        expect(classificarUsuarioCfi(usuarios[0])).toEqual({ ehCfi: true, motivo: 'admin' });
        expect(classificarUsuarioCfi(usuarios[3])).toMatchObject({ ehCfi: false, motivo: expect.stringContaining('dp-folha') });
        expect(classificarUsuarioCfi(usuarios[4])).toMatchObject({ ehCfi: false, motivo: expect.stringContaining('sem departamento') });
        expect(conjunto.emails.has('joao@sp.com.br')).toBe(true);          // carteira vale
        expect(conjunto.emails.has('recepcao@sp.com.br')).toBe(false);
        expect(conjunto.uids.has('uid-rh')).toBe(false);
    });
});

describe('classificarEscopoCfi', () => {
    it('projetoOrigem de app irmão sai, mesmo com autor do CFI', () => {
        expect(classificarEscopoCfi({ quem: 'sandra@sp.com.br', projetoOrigem: 'sp-connect' }, conjunto).dentro).toBe(false);
        expect(classificarEscopoCfi({ quem: 'sandra@sp.com.br', projetoOrigem: 'consultor-dp-folha' }, conjunto).motivo).toContain('consultor-dp-folha');
        expect(classificarEscopoCfi({ quem: 'sandra@sp.com.br', projetoOrigem: 'cfi' }, conjunto).dentro).toBe(true);
        expect(classificarEscopoCfi({ quem: 'sandra@sp.com.br', projetoOrigem: 'CONSULTORFISCALAPP' }, conjunto).dentro).toBe(true);
    });
    it('sem autor e "sistema" ficam dentro; uid resolve pelo cadastro', () => {
        expect(classificarEscopoCfi({ quem: null }, conjunto).dentro).toBe(true);
        expect(classificarEscopoCfi({ quem: 'envio-imposto' }, conjunto).dentro).toBe(true);
        expect(classificarEscopoCfi({ quem: 'uid-sandra' }, conjunto).dentro).toBe(true);
        expect(classificarEscopoCfi({ quem: 'uid-rh' }, conjunto).dentro).toBe(false);
        expect(classificarEscopoCfi({ quem: 'RECEPCAO@sp.com.br' }, conjunto).dentro).toBe(false);
    });
    it('autor DESCONHECIDO: fora em trilha compartilhada, dentro em trilha exclusiva do CFI (ex-colaborador)', () => {
        expect(classificarEscopoCfi({ quem: 'vilson@sp.com.br' }, conjunto, { compartilhada: true })).toMatchObject({ dentro: false, motivo: expect.stringContaining('compartilhada') });
        expect(classificarEscopoCfi({ quem: 'vilson@sp.com.br' }, conjunto, {}).dentro).toBe(true);
    });
});

describe('filtrarEscopoCfi e a ressalva: nada some em silêncio', () => {
    const eventos = [
        { quem: 'sandra@sp.com.br', trilha: 'whatsapp-envio' },
        { quem: 'rhsp@sp.com.br', trilha: 'whatsapp-envio' },
        { quem: 'rhsp@sp.com.br', trilha: 'whatsapp-envio' },
        { quem: 'recepcao@sp.com.br', trilha: 'whatsapp-envio' },
        { quem: 'vilson@sp.com.br', trilha: 'whatsapp-envio' },
        { quem: 'joao@sp.com.br', trilha: 'imposto-enviado', projetoOrigem: 'sp-connect' },
    ];
    const r = filtrarEscopoCfi(eventos, conjunto, (e) => TRILHAS.find((t) => t.id === e.trilha) || {});
    it('conta o que saiu por autor, com motivo, do maior para o menor', () => {
        expect(r.dentro.map((e) => e.quem)).toEqual(['sandra@sp.com.br']);
        expect(r.foraDoEscopo.eventos).toBe(5);
        expect(r.foraDoEscopo.autores[0]).toMatchObject({ quem: 'rhsp@sp.com.br', quantidade: 2, motivo: expect.stringContaining('dp-folha') });
        expect(r.foraDoEscopo.autores.map((a) => a.quem)).toContain('vilson@sp.com.br');
    });
    it('a ressalva diz o recorte e nomeia quem ficou de fora, com "e mais N" quando corta', () => {
        const txt = ressalvaEscopoCfi(r.foraDoEscopo, { maxNomes: 2, rotuloEvento: 'evento' });
        expect(txt).toContain('SOMENTE o Consultor Fiscal');
        expect(txt).toContain('5 evento(s) de 4 autor(es)');
        expect(txt).toContain('rhsp@sp.com.br (2:');
        expect(txt).toContain('e mais 2');
        expect(txt).toContain('Gerenciar Usuários');
        expect(ressalvaEscopoCfi({ eventos: 0, autores: [] })).not.toContain('Ficaram de fora');
    });
});

describe('as duas montagens aplicam o recorte', () => {
    it('linha do tempo: WhatsApp do RH e da Recepção some da contagem por pessoa e vai para foraDoEscopo', () => {
        const zap = TRILHAS.find((t: any) => t.id === 'whatsapp-envio')!;
        const guia = TRILHAS.find((t: any) => t.id === 'imposto-enviado')!;
        const r = montarAuditoria({
            leituras: [
                { trilha: zap, docs: [
                    { id: 'w1', dados: { em: '2026-09-01T10:00:00Z', por: 'rhsp@sp.com.br', template: 'x' } },
                    { id: 'w2', dados: { em: '2026-09-01T10:00:00Z', por: 'recepcao@sp.com.br', template: 'x' } },
                    { id: 'w3', dados: { em: '2026-09-01T10:00:00Z', por: 'sandra@sp.com.br', template: 'x', projetoOrigem: 'cfi' } },
                ] },
                { trilha: guia, docs: [{ id: 'g1', dados: { enviadoEm: '2026-09-02T10:00:00Z', enviadoPor: 'joao@sp.com.br' } }] },
            ],
            escopo: { usuarios, vinculos },
        });
        expect(r.total).toBe(2);
        expect(r.porPessoa.map((p: any) => p.quem).sort()).toEqual(['joao@sp.com.br', 'sandra@sp.com.br']);
        expect(r.foraDoEscopo).toMatchObject({ eventos: 2 });
        expect(r.ressalvas.join(' ')).toContain('rhsp@sp.com.br (1:');
    });
    it('desempenho: o lote Reinf do Contábil (projetoOrigem) e o ato do RH ficam fora; a Sandra fica', () => {
        const tipo = (id: string) => TIPOS_ATO.find((t) => t.id === id)!;
        const ts = (iso: string) => ({ toDate: () => new Date(iso) });
        const atos = [
            normalizarAto(tipo('reinf-lote'), 'r1', { por: 'sandra@sp.com.br', em: ts('2026-09-01T10:00:00Z'), projetoOrigem: 'projetos-app-sp', empresaId: 'e1' }),
            normalizarAto(tipo('reinf-lote'), 'r2', { por: 'sandra@sp.com.br', em: ts('2026-09-01T10:00:00Z'), projetoOrigem: 'cfi', empresaId: 'e1' }),
            normalizarAto(tipo('tarefa-concluida'), 't1', { concluidaPor: 'uid-rh', concluidaEm: ts('2026-09-01T10:00:00Z'), empresaId: 'e1' }),
        ];
        const r = montarDesempenho({ atos, usuarios, vinculos, de: '2026-08-01T00:00:00Z', ate: '2026-09-30T00:00:00Z' });
        expect(r.totalAtos).toBe(1);
        expect(r.colaboradores.find((c) => c.chave === 'sandra@sp.com.br')!.total).toBe(1);
        expect(r.colaboradores.find((c) => c.chave === 'rhsp@sp.com.br')).toBeUndefined();
        expect(r.foraDoEscopo.eventos).toBe(2);
        expect(r.ressalvas.join(' ')).toContain('SOMENTE o Consultor Fiscal');
    });
    it('a tela mostra o que ficou de fora nas duas abas (não é rodapé escondido)', () => {
        const fs = require('fs'); const path = require('path');
        const raiz = path.join(__dirname, '..', 'components', 'AuditoriaDono');
        expect(fs.readFileSync(path.join(raiz, 'index.tsx'), 'utf8')).toContain('<ForaDoEscopo');
        expect(fs.readFileSync(path.join(raiz, 'Desempenho.tsx'), 'utf8')).toContain('<ForaDoEscopo');
        expect(fs.readFileSync(path.join(__dirname, '..', 'sefaz-backend', 'auditoria-dono-routes.js'), 'utf8')).toContain("collection('carteiras')");
    });
});

// ── 22/09, segunda rodada: "2 erros visíveis" ───────────────────────────────
import { motivoWhatsappForaDoCfi, motivoInclusaoCfi } from '../sefaz-backend/escopo-cfi.js';
import { tiposParaTela, RAJADA_MINIMO_POR_MINUTO } from '../sefaz-backend/desempenho-colaboradores.js';

describe('WhatsApp: conversa iniciada e template de outra fila são atendimento, não CFI', () => {
    it('regra de conteúdo', () => {
        expect(motivoWhatsappForaDoCfi({ referencia: 'conversa-iniciada' })).toContain('SP Connect');
        expect(motivoWhatsappForaDoCfi({ departamento: 'recepcao', template: 'x' })).toContain('"recepcao"');
        expect(motivoWhatsappForaDoCfi({ departamento: 'fiscal', template: 'guia_das' })).toBeNull();
        expect(motivoWhatsappForaDoCfi({})).toBeNull();
    });
    it('na linha do tempo, "iniciarconversa" sai mesmo com autor que tem conta no Fiscal — e a pessoa que fica diz POR QUE conta', () => {
        const zap = TRILHAS.find((t: any) => t.id === 'whatsapp-envio')!;
        const r = montarAuditoria({
            leituras: [{ trilha: zap, docs: [
                { id: 'w1', dados: { em: '2026-09-22T13:55:00Z', por: 'sandra@sp.com.br', template: 'iniciarconversa', referencia: 'conversa-iniciada', departamento: 'fiscal', projetoOrigem: 'cfi' } },
                { id: 'w2', dados: { em: '2026-09-22T13:56:00Z', por: 'sandra@sp.com.br', template: 'guia_das', departamento: 'fiscal', temDocumento: true, projetoOrigem: 'cfi' } },
                { id: 'w3', dados: { em: '2026-09-22T13:57:00Z', por: 'paulo@sp.com.br', template: 'x', departamento: 'juridico', projetoOrigem: 'cfi' } },
            ] }],
            escopo: { usuarios, vinculos },
        });
        expect(r.total).toBe(1);
        expect(r.porPessoa[0]).toEqual({ quem: 'sandra@sp.com.br', quantidade: 1, porque: 'departamento Fiscal' });
        expect(r.foraDoEscopo.eventos).toBe(2);
        expect(r.foraDoEscopo.autores.find((a: any) => a.quem === 'sandra@sp.com.br')!.motivo).toContain('conversa iniciada');
    });
    it('motivoInclusaoCfi diz de onde veio o vínculo', () => {
        expect(motivoInclusaoCfi('paulo@sp.com.br', conjunto)).toBe('admin');
        expect(motivoInclusaoCfi('uid-joao', conjunto)).toBe('carteira de empresas vinculada');
        expect(motivoInclusaoCfi('alguem@sp.com.br', conjunto, {})).toContain('exclusiva do CFI');
        expect(motivoInclusaoCfi('', conjunto)).toBe('sem autor gravado');
    });
});

describe('Kanban: clique ≠ entrega, e 1800 num período é rajada', () => {
    const tipo = (id: string) => TIPOS_ATO.find((t) => t.id === id)!;
    const ts = (iso: string) => ({ toDate: () => new Date(iso) });
    it('a baixa pelo rito de envio sai como tipo próprio; o clique no Kanban tem rótulo honesto', () => {
        const a = normalizarAto(tipo('tarefa-concluida'), 't1', { concluidaPor: 'sandra@sp.com.br', concluidaEm: ts('2026-09-01T10:00:00Z'), baixaOrigem: 'envio-imposto' });
        expect(a.tipo).toBe('tarefa-baixada-rito');
        expect(normalizarAto(tipo('tarefa-concluida'), 't2', { concluidaPor: 'sandra@sp.com.br', concluidaEm: ts('2026-09-01T10:00:00Z') }).tipo).toBe('tarefa-concluida');
        expect(tipo('tarefa-concluida').rotulo).toMatch(/Kanban \(clique\)/);
        const ids = tiposParaTela().map((t) => t.id);
        expect(ids.indexOf('tarefa-baixada-rito')).toBe(ids.indexOf('tarefa-concluida') + 1);
        expect(ids.indexOf('nfse-pdf-importada')).toBe(ids.indexOf('xml-importado') + 1);
    });
    it('rajada: 10+ do mesmo tipo no mesmo minuto vira "em lote" e ressalva nomeada', () => {
        const atos: any[] = [];
        for (let i = 0; i < 12; i++) {
            atos.push(normalizarAto(tipo('tarefa-concluida'), `r${i}`, { concluidaPor: 'sandra@sp.com.br', concluidaEm: ts(`2026-09-01T10:00:${String(i * 4).padStart(2, '0')}Z`), empresaId: `e${i}` }));
        }
        atos.push(normalizarAto(tipo('tarefa-concluida'), 'solta', { concluidaPor: 'sandra@sp.com.br', concluidaEm: ts('2026-09-02T10:00:00Z'), empresaId: 'e1' }));
        for (let i = 0; i < 3; i++) {
            atos.push(normalizarAto(tipo('tarefa-concluida'), `j${i}`, { concluidaPor: 'joao@sp.com.br', concluidaEm: ts(`2026-09-01T11:00:${String(i * 10).padStart(2, '0')}Z`), empresaId: `e${i}` }));
        }
        const r = montarDesempenho({ atos, usuarios, vinculos, de: '2026-08-01T00:00:00Z', ate: '2026-09-30T00:00:00Z' });
        const s = r.colaboradores.find((c) => c.chave === 'sandra@sp.com.br')!;
        expect(s.porTipo['tarefa-concluida']).toBe(13);
        expect(s.emLote['tarefa-concluida']).toBe(12);
        expect(RAJADA_MINIMO_POR_MINUTO).toBe(10);
        const j = r.colaboradores.find((c) => c.chave === 'joao@sp.com.br')!;
        expect(j.emLote['tarefa-concluida']).toBeUndefined();
        const txt = r.ressalvas.join(' ');
        expect(txt).toContain('AÇÃO EM LOTE');
        expect(txt).toContain('12 de 13');
        expect(txt).toContain('é um clique — não prova entrega');
    });
});
