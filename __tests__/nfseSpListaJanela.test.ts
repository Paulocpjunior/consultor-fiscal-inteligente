// 🧊 A lista de NFS-e SP que travava o navegador (25/09): 20.000 docs de uma
// vez e 20.000 linhas desenhadas. As réguas cobram o FATO: período padrão,
// páginas de 200 e o rodapé que diz quando pode haver mais.
import {
    periodoPadrao, linhasVisiveis, textoDaContagem, LINHAS_POR_PAGINA, LIMITE_DOCS_NFSE_SP,
} from '../services/nfseSpListaJanela';

describe('a primeira carga é do mês corrente, não do acervo inteiro', () => {
    it('primeiro dia do mês de hoje, fim aberto', () => {
        expect(periodoPadrao('2026-09-25')).toEqual({ dataInicio: '2026-09-01', dataFim: '' });
        expect(periodoPadrao('2026-01-03')).toEqual({ dataInicio: '2026-01-01', dataFim: '' });
    });
    it('data ilegível não inventa período', () => {
        expect(periodoPadrao('')).toEqual({ dataInicio: '', dataFim: '' });
    });
});

describe('a tabela desenha por páginas', () => {
    it('200 por página, crescendo sob demanda, sem passar do total', () => {
        expect(LINHAS_POR_PAGINA).toBe(200);
        expect(linhasVisiveis(5000, 1)).toBe(200);
        expect(linhasVisiveis(5000, 3)).toBe(600);
        expect(linhasVisiveis(150, 2)).toBe(150);
        expect(linhasVisiveis(0, 1)).toBe(0);
        expect(linhasVisiveis(500, 0)).toBe(200);
    });
});

describe('o rodapé é farol honesto', () => {
    it('sem teto: X de Y carregadas', () => {
        expect(textoDaContagem({ filtradas: 120, carregadas: 120, visiveis: 120, truncado: false })).toBe('120 de 120 carregadas');
    });
    it('paginado: mostrando X de Y', () => {
        const t = textoDaContagem({ filtradas: 1200, carregadas: 1500, visiveis: 200, truncado: false });
        expect(t).toMatch(/mostrando 200 de 1200/);
        expect(t).toMatch(/1500 carregadas/);
    });
    it('teto atingido: DIZ que pode haver mais e o que fazer', () => {
        const t = textoDaContagem({ filtradas: 5000, carregadas: 5000, visiveis: 200, truncado: true });
        expect(t).toMatch(new RegExp(`teto de ${LIMITE_DOCS_NFSE_SP}`));
        expect(t).toMatch(/pode haver mais/);
        expect(t).toMatch(/estreite o período/);
    });
});
