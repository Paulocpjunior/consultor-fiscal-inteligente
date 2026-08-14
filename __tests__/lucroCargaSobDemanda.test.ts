// ============================================================================
// A OUTRA METADE DO "ATIVAR EMPRESA É O PRIMEIRO PASSO".
//
// Paulo, 14/08: *"Ativar Empresa é o primeiro passo do colaborador, é isso que
// define o que ele pode ou não fazer e em qual empresa; além disso NÃO
// CARREGAMOS NENHUMA INFORMAÇÃO DO BANCO DE DADOS até que o colaborador ative a
// empresa — ganhamos tempo e agilidade"*.
//
// No Simples bastou parar de ler `simples_notas` — o movimento morava em OUTRA
// coleção. No Lucro não dá: a `fichaFinanceira[]` é **EMBUTIDA no documento da
// empresa**, um registro de ~46 campos POR MÊS. Abrir o painel baixava todos os
// meses de todas as empresas, e o SDK do navegador **não projeta campos**.
//
// Daí a rota: `.select()` existe no Admin SDK e não existe no do navegador.
//
// ═══ A TRAVA QUE MAIS IMPORTA AQUI NÃO É DE VELOCIDADE, É DE PERDA DE DADO ══
//
// `LucroEmpresaResumo` não tem `fichaFinanceira`. Se ele fosse o MESMO tipo de
// `LucroPresumidoEmpresa`, dava para espalhar um resumo num `updateEmpresa` e
// **apagar a ficha financeira inteira de um cliente** — em silêncio, e sem
// volta. Tipos distintos fazem o `tsc` recusar, e trava que o compilador aplica
// não depende de ninguém lembrar dela.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { montarResumoLucro, lapideDaEmpresa, CAMPOS_RESUMO } from '../sefaz-backend/lucro-empresas-resumo.js';

const RAIZ = join(__dirname, '..');

const doc = (id: string, data: Record<string, unknown> = {}) => ({ id, data });

describe('a lista leve traz o cadastro e NÃO traz a ficha', () => {
    it('devolve os campos de escolha da empresa', () => {
        const r = montarResumoLucro([
            doc('a', { nome: 'ALFA LTDA', cnpj: '11.222.333/0001-81', uf: 'sp', codCliente: '1154' }),
        ]);
        expect(r.empresas[0]).toEqual({
            id: 'a',
            nome: 'ALFA LTDA',
            cnpj: '11222333000181',   // dígitos: o cadastro guarda nas DUAS formas
            uf: 'SP',
            regimePadrao: null,
            codCliente: '1154',
            fichas: 0,
            capturarSefaz: true,
        });
    });

    it('a ficha financeira NUNCA sai daqui — nem se vier no documento', () => {
        // É o ponto da rota inteira. Se um campo novo escapar para o resumo,
        // este teste cai antes de a lentidão voltar sem ninguém perceber.
        const r = montarResumoLucro([
            doc('a', { nome: 'ALFA', fichaFinanceira: [{ competencia: '2026-07', receita: 1 }, { competencia: '2026-06' }] }),
        ]);
        expect(JSON.stringify(r.empresas)).not.toContain('receita');
        expect((r.empresas[0] as any).fichaFinanceira).toBeUndefined();
        expect(r.semFichaFinanceira).toBe(true);
        // Só o NÚMERO atravessa.
        expect(r.empresas[0].fichas).toBe(2);
    });

    it('a CONTAGEM de fichas atravessa — e ela decide qual cadastro APAGAR', () => {
        // O selo de duplicata diz "0 fichas — excluir este" × "N ficha(s) —
        // manter". Um zero que significasse "não carreguei" mandaria excluir o
        // cadastro BOM, e empresa com ficha financeira não volta fácil. É por
        // isso que o `.select()` pede a ficha: para contá-la no servidor.
        expect(CAMPOS_RESUMO).toContain('fichaFinanceira');
        const r = montarResumoLucro([
            doc('a', { nome: 'COM FICHA', fichaFinanceira: [{}, {}, {}] }),
            doc('b', { nome: 'CADASTRO-LIXO' }),
        ]);
        const porNome = (n: string) => r.empresas.find((e: any) => e.nome === n)!;
        expect(porNome('COM FICHA').fichas).toBe(3);
        expect(porNome('CADASTRO-LIXO').fichas).toBe(0);
    });

    it('o `.select()` pede as lápides — senão empresa excluída volta para a lista', () => {
        expect(CAMPOS_RESUMO).toEqual(expect.arrayContaining(['_deleted', '_merged_into']));
    });

    it('codCliente vem dos DOIS lugares — o cadastro guarda nos dois', () => {
        // Ler só um faz metade da carteira aparecer sem código, e é por código
        // que o colaborador busca (mesma armadilha do `empresaOption`).
        const r = montarResumoLucro([
            doc('a', { nome: 'A', codCliente: '10' }),
            doc('b', { nome: 'B', dadosFiscais: { codCliente: '20' } }),
        ]);
        expect(r.empresas.map((e: any) => e.codCliente)).toEqual(['10', '20']);
    });
});

describe('lápide: some da CONTA, não da TELA', () => {
    it('excluída e fundida ficam fora da lista', () => {
        const r = montarResumoLucro([
            doc('a', { nome: 'VIVA' }),
            doc('b', { nome: 'MORTA', _deleted: true }),
            doc('c', { nome: 'FUNDIDA', _merged_into: 'a' }),
        ]);
        expect(r.empresas.map((e: any) => e.id)).toEqual(['a']);
    });

    it('mas vêm CONTADAS, e separadas por causa', () => {
        // Lista que encolhe sem dizer por quê faz procurar cadastro que foi
        // excluído de propósito. E excluir ≠ fundir: ações diferentes.
        const r = montarResumoLucro([
            doc('a', { nome: 'VIVA' }),
            doc('b', { _deleted: true }),
            doc('c', { _merged_into: 'a' }),
        ]);
        expect(r.ocultas).toEqual({ excluidas: 1, fundidas: 1 });
    });

    it('lapideDaEmpresa nomeia a causa', () => {
        expect(lapideDaEmpresa({ _deleted: true })).toBe('excluida');
        expect(lapideDaEmpresa({ _merged_into: 'x' })).toBe('fundida');
        expect(lapideDaEmpresa({})).toBeNull();
    });
});

describe('cadastro torto NÃO some da lista', () => {
    it('empresa sem nome e sem CNPJ continua aparecendo', () => {
        // Sumir do seletor faz o colaborador concluir que a empresa não existe
        // (regra de 07/08). Cadastro incompleto é alerta na tela de cadastro.
        const r = montarResumoLucro([doc('a', {}), doc('b', { nome: 'BETA' })]);
        expect(r.total).toBe(2);
        expect(r.empresas.find((e: any) => e.id === 'a')).toBeTruthy();
    });
});

// ─── A TRAVA DE PERDA DE DADO ───────────────────────────────────────────────

describe('o resumo não pode ser gravado de volta', () => {
    const servico = readFileSync(join(RAIZ, 'services/lucroPresumidoService.ts'), 'utf8');

    it('`LucroEmpresaResumo` é um tipo PRÓPRIO, sem fichaFinanceira', () => {
        expect(servico).toMatch(/export interface LucroEmpresaResumo/);
        const bloco = servico.slice(
            servico.indexOf('export interface LucroEmpresaResumo'),
            servico.indexOf('export interface LucroResumoResposta'),
        );
        expect(bloco).not.toMatch(/fichaFinanceira/);
    });

    it('e o arquivo diz POR QUE ele é separado — senão alguém "simplifica" unindo os dois', () => {
        expect(servico).toMatch(/apagar a ficha\s*\n?\s*\/\/ financeira inteira|apagar a ficha financeira/);
    });

    it('o documento completo é buscado por ID, sob demanda', () => {
        expect(servico).toMatch(/export const getEmpresaCompleta/);
        expect(servico).toMatch(/getDoc\(doc\(db, 'lucro_empresas', id\)\)/);
        // Empresa com lápide não volta pelo caminho do id.
        expect(servico).toMatch(/if \(d\._deleted \|\| d\._merged_into\) return null;/);
    });

    it('falha da rota NÃO devolve lista vazia — cai no caminho antigo e AVISA', () => {
        // Lista vazia seria lida como "não há empresas no Lucro", que manda
        // procurar cadastro que está lá.
        expect(servico).toMatch(/degradado/);
        expect(servico).toMatch(/caminho antigo/i);
    });
});
