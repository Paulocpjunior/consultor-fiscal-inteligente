/**
 * O USUÁRIO É UM SÓ, E O DEPARTAMENTO DIZ QUAL MÓDULO ELE ABRE (08/08).
 *
 * O que os testes trancam:
 * 1. Departamento desconhecido é RECUSADO, nunca descartado em silêncio
 *    (lição da whitelist #382: campo engolido = "salvo" que não salvou).
 * 2. A recusa de acesso SEMPRE diz o motivo — "sem departamento" não pode
 *    parecer "usuário inexistente", senão a pessoa vai redefinir senha à toa.
 * 3. Túnel não define departamento: só o admin do CFI grava.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { DEPARTAMENTOS, validarDepartamentos, normalizarUsuarioCadastro, acessoAoModulo, montarUsuariosCadastro } from '../sefaz-backend/cadastro-central-departamentos';

const ana = { uid: 'u1', nome: 'Ana Souza', email: 'Ana@spassessoriacontabil.com.br', role: 'colaborador', departamentos: ['contabil'] };
const semDep = { uid: 'u2', nome: 'Bruno Lima', email: 'bruno@sp.com', role: 'colaborador', departamentos: [] };
const admin = { uid: 'u3', nome: 'Paulo', email: 'p@sp.com', role: 'admin', departamentos: [] };

describe('o catálogo é a lista dos módulos do SaaS', () => {
    it('os cinco módulos do Paulo, nem mais nem menos', () => {
        expect(DEPARTAMENTOS.map((d: any) => d.id).sort()).toEqual(
            ['contabil', 'dp-folha', 'financeiro', 'fiscal', 'legalizacao'],
        );
    });
});

describe('gravação: desconhecido é RECUSADO, não engolido', () => {
    it('departamento inventado recusa com a lista válida na mensagem', () => {
        const r = validarDepartamentos(['contabil', 'juridico']);
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/juridico/);
        expect(r.erro).toMatch(/Válidos:/);
    });

    it('lista válida normaliza: caixa, espaço e duplicata', () => {
        const r = validarDepartamentos([' Fiscal ', 'fiscal', 'CONTABIL']);
        expect(r.ok).toBe(true);
        expect(r.departamentos).toEqual(['fiscal', 'contabil']);
    });

    it('lista vazia é válida — remove todos os vínculos', () => {
        expect(validarDepartamentos([]).ok).toBe(true);
        expect(validarDepartamentos([]).departamentos).toEqual([]);
    });

    it('não-lista é recusada, não coagida', () => {
        expect(validarDepartamentos('fiscal' as any).ok).toBe(false);
        expect(validarDepartamentos(undefined as any).ok).toBe(false);
    });
});

describe('a pergunta do app irmão: este usuário abre este módulo?', () => {
    it('vinculado ao departamento: sim, com o vínculo nomeado', () => {
        const r = acessoAoModulo(normalizarUsuarioCadastro(ana), 'contabil');
        expect(r.temAcesso).toBe(true);
        expect(r.motivo).toMatch(/Consultor Contábil/);
    });

    it('admin abre todos, como no resto do app', () => {
        for (const d of DEPARTAMENTOS) {
            expect(acessoAoModulo(normalizarUsuarioCadastro(admin), d.id).temAcesso).toBe(true);
        }
    });

    it('de OUTRO departamento: não, dizendo de qual ele é e onde arrumar', () => {
        const r = acessoAoModulo(normalizarUsuarioCadastro(ana), 'dp-folha');
        expect(r.temAcesso).toBe(false);
        expect(r.motivo).toMatch(/pertence a Consultor Contábil/);
        expect(r.motivo).toMatch(/Gerenciar Usuários/);
    });

    it('SEM departamento ≠ usuário inexistente — confundir manda trocar senha à toa', () => {
        const r = acessoAoModulo(normalizarUsuarioCadastro(semDep), 'fiscal');
        expect(r.temAcesso).toBe(false);
        expect(r.motivo).toMatch(/existe no cadastro mas está SEM/);
        expect(r.motivo).not.toMatch(/não encontrado/);
    });

    it('usuário inexistente diz ISSO, com a ação de criar a conta', () => {
        const r = acessoAoModulo(null, 'fiscal');
        expect(r.temAcesso).toBe(false);
        expect(r.motivo).toMatch(/não encontrado no cadastro central/);
    });

    it('módulo desconhecido não vira acesso negado genérico', () => {
        const r = acessoAoModulo(normalizarUsuarioCadastro(ana), 'juridico');
        expect(r.temAcesso).toBe(false);
        expect(r.motivo).toMatch(/Módulo desconhecido/);
    });
});

describe('normalização: o que viaja e o que fica', () => {
    it('e-mail sai minúsculo — é chave de busca do outro lado', () => {
        expect(normalizarUsuarioCadastro(ana).email).toBe('ana@spassessoriacontabil.com.br');
    });

    it('hash de senha e campos estranhos NÃO viajam', () => {
        const u = normalizarUsuarioCadastro({ ...ana, passwordHash: 'x', isVerified: true } as any);
        expect(u).not.toHaveProperty('passwordHash');
        expect(u).not.toHaveProperty('isVerified');
    });

    it('departamento inválido gravado por fora não sobrevive à leitura', () => {
        const u = normalizarUsuarioCadastro({ ...ana, departamentos: ['contabil', 'hacker'] });
        expect(u.departamentos).toEqual(['contabil']);
    });

    it('doc sem uid não vira usuário fantasma', () => {
        expect(normalizarUsuarioCadastro({ nome: 'X' })).toBeNull();
    });
});

describe('o cadastro inteiro', () => {
    it('sem-departamento é contado e avisado — não some', () => {
        const r = montarUsuariosCadastro([ana, semDep, admin]);
        expect(r.resumo.semDepartamento).toBe(1);
        expect(r.avisos.join(' ')).toMatch(/SEM departamento/);
    });

    it('admin sem departamento NÃO é pendência — ele abre tudo', () => {
        const r = montarUsuariosCadastro([admin]);
        expect(r.resumo.semDepartamento).toBe(0);
    });

    it('a contagem por departamento sai pronta', () => {
        const r = montarUsuariosCadastro([ana, semDep]);
        expect(r.resumo.porDepartamento.contabil).toBe(1);
        expect(r.resumo.porDepartamento.fiscal).toBe(0);
    });

    it('o aviso do túnel está sempre lá: app irmão pergunta, não define', () => {
        expect(montarUsuariosCadastro([]).avisos[0]).toMatch(/pergunta, não define/);
    });

    it('cadastro vazio é falha de leitura', () => {
        expect(montarUsuariosCadastro([]).avisos.join(' ')).toMatch(/falha de leitura/);
    });
});
