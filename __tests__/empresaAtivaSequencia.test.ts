// ============================================================================
// A SEQUÊNCIA: LOGIN → ATIVAR EMPRESA → MÓDULOS.
//
// Paulo, 15/08, depois de eu errar o entendimento DUAS vezes:
//
//   *"já começou errado, eu falei MIL VEZES! o começo de tudo é com a
//   sequência: login colaborador → ATIVAR EMPRESA. Ativar empresa é o que
//   determina o que a pessoa vai ou não fazer, é o que determina o que ela
//   pode ou não fazer."*
//
// ═══ O QUE EU TINHA ENTENDIDO ERRADO, E POR QUE ISTO EXISTE ═════════════════
//
// Eu li "não carregamos nada do banco até ativar" como CARGA PREGUIÇOSA e
// implementei duas vezes — Simples (PR #676) e Lucro (PR #684) — cada painel
// com o seu ⚡ Ativar e o seu seletor. Ganhou velocidade e não entregou o que
// importa: a frase não é sobre CARGA, é sobre **ESCOPO DA SESSÃO**.
//
// A prova de que estava errado veio de um print: entrar no card do Lucro
// mostrava a LISTA de ~400 empresas, como se a ativação nunca tivesse
// acontecido — porque `selecionarTipo` fazia `setSelectedLucroEmpresaId(null)`.
//
// Estes testes travam a SEQUÊNCIA, não a aparência.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { SearchType } from '../types';
import {
    exigeEmpresaAtiva, DISPENSAM_EMPRESA_ATIVA, rotuloEmpresaAtiva, fmtCnpjAtiva,
    lerEmpresaAtiva, gravarEmpresaAtiva, limparEmpresaAtiva, type EmpresaAtiva,
} from '../services/empresaAtiva';

const RAIZ = join(__dirname, '..');
const semComentarios = (f: string) => f
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const NOVA: EmpresaAtiva = {
    id: 'e1', nome: 'NOVA ERA', cnpj: '29240822000121', fonte: 'simples', codCliente: '1154',
};

describe('o padrão é EXIGIR empresa ativa', () => {
    it('módulo que trabalha sobre um cliente exige', () => {
        expect(exigeEmpresaAtiva(SearchType.SIMPLES_NACIONAL)).toBe(true);
        expect(exigeEmpresaAtiva(SearchType.LUCRO_PRESUMIDO_REAL)).toBe(true);
        expect(exigeEmpresaAtiva(SearchType.SPED_FISCAL)).toBe(true);
        expect(exigeEmpresaAtiva(SearchType.IMPORTA_XML)).toBe(true);
    });

    it('consulta de TABELA não exige — não tem cliente', () => {
        // Trancar um CFOP atrás de um cliente é trava sem motivo, e trava sem
        // motivo é a que a equipe aprende a contornar.
        expect(exigeEmpresaAtiva(SearchType.CFOP)).toBe(false);
        expect(exigeEmpresaAtiva(SearchType.NCM)).toBe(false);
        expect(exigeEmpresaAtiva(SearchType.SERVICO)).toBe(false);
    });

    it('visão de CARTEIRA não exige — ela responde sobre o CONJUNTO', () => {
        // Prender a Rotina do Mês a um cliente trocaria um erro por outro: ela
        // existe justamente para dizer por onde começar entre TODOS.
        expect(exigeEmpresaAtiva(SearchType.ROTINA_FISCAL)).toBe(false);
        expect(exigeEmpresaAtiva(SearchType.CARTEIRA)).toBe(false);
        expect(exigeEmpresaAtiva(SearchType.OBRIGACOES_FISCAIS)).toBe(false);
    });

    it('a lista de dispensados é CURTA — o padrão é exigir', () => {
        // Esquecer de incluir aqui trava um card, e isso aparece na hora.
        // Esquecer o contrário deixa um módulo trabalhar sem cliente definido,
        // e isso só aparece quando alguém lança no cliente errado.
        expect(DISPENSAM_EMPRESA_ATIVA.length).toBeLessThan(12);
    });
});

describe('a ativação é da PESSOA e some no logout', () => {
    beforeEach(() => localStorage.clear());

    it('grava e lê por uid', () => {
        gravarEmpresaAtiva('u1', NOVA);
        expect(lerEmpresaAtiva('u1')?.id).toBe('e1');
        // Outro colaborador no mesmo navegador NÃO herda a empresa ativa.
        expect(lerEmpresaAtiva('u2')).toBeNull();
    });

    it('limpar apaga — é o que o logout faz', () => {
        gravarEmpresaAtiva('u1', NOVA);
        limparEmpresaAtiva('u1');
        expect(lerEmpresaAtiva('u1')).toBeNull();
    });

    it('registro torto no armazenamento não vira empresa ativa', () => {
        // Empresa sem id faria um módulo trabalhar com escopo vazio — pior que
        // não ter ativação nenhuma, porque a tela diria que tem.
        localStorage.setItem('cfi_empresa_ativa:u1', JSON.stringify({ nome: 'SÓ NOME' }));
        expect(lerEmpresaAtiva('u1')).toBeNull();
        localStorage.setItem('cfi_empresa_ativa:u1', 'isto não é json');
        expect(lerEmpresaAtiva('u1')).toBeNull();
    });

    it('sem uid não lê nem grava nada', () => {
        expect(lerEmpresaAtiva(null)).toBeNull();
        expect(lerEmpresaAtiva(undefined)).toBeNull();
    });
});

describe('o rótulo diz em quem a pessoa está mexendo', () => {
    it('mostra o Cod.Cliente antes do nome — é por ele que a equipe busca', () => {
        expect(rotuloEmpresaAtiva(NOVA)).toBe('1154 · NOVA ERA');
    });

    it('sem empresa, DIZ que não há — nunca fica em branco', () => {
        expect(rotuloEmpresaAtiva(null)).toBe('Nenhuma empresa ativa');
    });

    it('CNPJ torto não quebra a tela', () => {
        expect(fmtCnpjAtiva('29240822000121')).toBe('29.240.822/0001-21');
        expect(fmtCnpjAtiva('')).toBe('—');
        expect(fmtCnpjAtiva('123')).toBe('123');
    });
});

// ─── A SEQUÊNCIA, NO APP ────────────────────────────────────────────────────

describe('o App para na ativação antes de mostrar os módulos', () => {
    const app = semComentarios(readFileSync(join(RAIZ, 'App.tsx'), 'utf8'));

    it('sem empresa ativa, a tela é a de ATIVAR — não o menu', () => {
        expect(app).toMatch(/if \(!empresaAtiva \|\| trocandoEmpresa\) \{/);
        expect(app).toMatch(/<AtivarEmpresaScreen/);
    });

    it('e esse portão vem DEPOIS do login — a ordem é login → ativar', () => {
        const posLogin = app.indexOf('if (!currentUser)');
        const posAtivar = app.indexOf('if (!empresaAtiva');
        expect(posLogin).toBeGreaterThan(-1);
        expect(posAtivar).toBeGreaterThan(posLogin);
    });

    it('o logout LIMPA a ativação — a sequência recomeça no próximo login', () => {
        const i = app.indexOf('const handleLogout');
        expect(app.slice(i, i + 400)).toMatch(/limparEmpresaAtiva/);
    });

    it('trocar de empresa LIMPA a seleção dos painéis', () => {
        // Dado de um cliente na tela de outro é o pior erro possível aqui, e
        // ele é silencioso.
        const i = app.indexOf('const ativarEmpresa');
        const bloco = app.slice(i, i + 600);
        expect(bloco).toMatch(/setSelectedSimplesEmpresaId/);
        expect(bloco).toMatch(/setSelectedLucroEmpresaId/);
        expect(bloco).toMatch(/setResult\(null\)/);
    });

    it('o cabeçalho DIZ qual empresa está ativa, sempre', () => {
        // Escopo invisível que decide onde o lançamento cai é como se lança no
        // cliente errado sem ninguém desconfiar.
        expect(app).toMatch(/rotuloEmpresaAtiva\(empresaAtiva\)/);
        expect(app).toMatch(/Trocar empresa/);
    });
});

describe('🚨 entrar no módulo NÃO volta para a lista de empresas', () => {
    const app = semComentarios(readFileSync(join(RAIZ, 'App.tsx'), 'utf8'));

    it('o card do Lucro abre NA empresa ativa, não em null', () => {
        // Era literalmente `setSelectedLucroEmpresaId(null)` — e foi o que o
        // print do Paulo mostrou: a lista de ~400 empresas depois de ativar.
        const i = app.indexOf('const selecionarTipo');
        const bloco = app.slice(i, app.indexOf('};', i));
        expect(bloco).not.toMatch(/setSelectedLucroEmpresaId\(null\);/);
        expect(bloco).toMatch(/empresaAtiva\?\.fonte === 'lucro' \? empresaAtiva\.id : null/);
    });

    it('e o card do Simples também', () => {
        const i = app.indexOf('const selecionarTipo');
        const bloco = app.slice(i, app.indexOf('};', i));
        expect(bloco).toMatch(/empresaAtiva\?\.fonte === 'simples' \? empresaAtiva\.id : null/);
    });

    it('mas o módulo de CARTEIRA continua vendo o conjunto', () => {
        const i = app.indexOf('const selecionarTipo');
        const bloco = app.slice(i, app.indexOf('};', i));
        expect(bloco).toMatch(/exigeEmpresaAtiva\(type\)/);
    });
});
