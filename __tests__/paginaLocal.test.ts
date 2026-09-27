// 🧊 Dez telas desenhavam o array inteiro com `.map(` e uma tabela de 20.000
// linhas travou a aba (semana de 21/09). A régua pura cobra o FATO: páginas
// de 200, crescimento sob demanda sem passar do total e rodapé honesto.
import { LINHAS_POR_PAGINA_PADRAO, linhasVisiveis, textoDaContagem } from '../services/paginaLocal';

describe('a tabela desenha por páginas', () => {
    it('200 por página por padrão, crescendo sob demanda, sem passar do total', () => {
        expect(LINHAS_POR_PAGINA_PADRAO).toBe(200);
        expect(linhasVisiveis(20000, 1)).toBe(200);
        expect(linhasVisiveis(20000, 3)).toBe(600);
        expect(linhasVisiveis(150, 2)).toBe(150);
        expect(linhasVisiveis(0, 1)).toBe(0);
    });
    it('página inválida vale como a primeira; tamanho de página é parâmetro', () => {
        expect(linhasVisiveis(500, 0)).toBe(200);
        expect(linhasVisiveis(500, -2)).toBe(200);
        expect(linhasVisiveis(500, 1, 50)).toBe(50);
        expect(linhasVisiveis(500, 2, 50)).toBe(100);
        expect(linhasVisiveis(30, 1, 50)).toBe(30);
    });
});

describe('o rodapé é farol honesto', () => {
    it('lista cortada diz "mostrando X de N"', () => {
        expect(textoDaContagem({ visiveis: 200, total: 20000, rotulo: 'notas' })).toBe('mostrando 200 de 20000 notas');
    });
    it('lista inteira diz só o total', () => {
        expect(textoDaContagem({ visiveis: 150, total: 150, rotulo: 'empresas' })).toBe('150 empresas');
        expect(textoDaContagem({ visiveis: 0, total: 0, rotulo: 'tarefas' })).toBe('0 tarefas');
    });
    it('com filtro em memória, diz o que sobrou do filtro e o total', () => {
        expect(textoDaContagem({ visiveis: 200, total: 5000, filtradas: 900, rotulo: 'notas' }))
            .toBe('mostrando 200 de 900 notas (5000 no total)');
        expect(textoDaContagem({ visiveis: 900, total: 5000, filtradas: 900, rotulo: 'notas' }))
            .toBe('900 de 5000 notas');
    });
    it('nunca afirma mais visível do que existe', () => {
        expect(textoDaContagem({ visiveis: 999, total: 10, rotulo: 'linhas' })).toBe('10 linhas');
    });
});
