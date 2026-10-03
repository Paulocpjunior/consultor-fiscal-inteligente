/**
 * Selo "novo" do 📣 Novidades.
 *
 * O que precisa ficar travado: versão nova REACENDE o aviso sozinha (senão o
 * comunicado atualizado passa batido, que é o caso oposto do relato de 04/08).
 */
import {
    NOVIDADES_VERSAO, temNovidadeNaoLida,
} from '../services/novidadesService';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('temNovidadeNaoLida', () => {
    it('quem nunca abriu vê o selo', () => {
        expect(temNovidadeNaoLida('2026-08-04', null)).toBe(true);
        expect(temNovidadeNaoLida('2026-08-04', undefined)).toBe(true);
        expect(temNovidadeNaoLida('2026-08-04', '')).toBe(true);
    });

    it('quem abriu a versão atual não vê', () => {
        expect(temNovidadeNaoLida('2026-08-04', '2026-08-04')).toBe(false);
        expect(temNovidadeNaoLida('2026-08-04', ' 2026-08-04 ')).toBe(false);
    });

    it('versão NOVA reacende o selo mesmo pra quem já tinha lido a anterior', () => {
        expect(temNovidadeNaoLida('2026-08-04', '2026-08-03')).toBe(true);
    });

    it('sem versão configurada não inventa aviso', () => {
        expect(temNovidadeNaoLida('', '2026-08-03')).toBe(false);
    });

    it('a constante segue o formato AAAA-MM-DD.N (data do "atualizado em" + itens da seção atual)', () => {
        expect(NOVIDADES_VERSAO).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    });

    it('item novo no MESMO dia reacende o selo de quem já abriu a página naquele dia (03/10)', () => {
        expect(temNovidadeNaoLida('2026-10-03.4', '2026-10-03.3')).toBe(true);
    });
});

describe('🚨 a página e o selo andam em PAR', () => {
    // Paulo, 15/08: *"o botão novidade do CFI você não está inserindo o detalhe
    // em vermelho que sinaliza que algo foi feito"*. Estava certo: onze dias de
    // entrega com o selo apagado, porque a regra do par estava escrita e não
    // tinha trava. Par que envelhece em SILÊNCIO é o pior jeito de envelhecer.
    const html = readFileSync(join(__dirname, '..', 'public/novidades-cfi.html'), 'utf8');

    it('o "atualizado em" da página é a MESMA data da constante', () => {
        const m = html.match(/atualizado em (\d{2})\/(\d{2})\/(\d{4})/);
        expect(m).toBeTruthy();
        const [, dd, mm, aaaa] = m!;
        expect(`${aaaa}-${mm}-${dd}`).toBe(NOVIDADES_VERSAO.split('.')[0]);
    });

    it('a página tem conteúdo da revisão atual — versão nova sem texto novo é selo mentiroso', () => {
        // Não basta trocar a data: o selo aceso promete que há o que ler.
        const [, mm, dd] = NOVIDADES_VERSAO.split('.')[0].split('-');
        expect(html).toContain(`${dd}/${mm}`);
    });

    it('o N da versão é quantos itens a seção "🆕 O que mudou agora" tem — item novo no dia muda a versão', () => {
        const ini = html.indexOf('<h2>🆕 O que mudou agora');
        expect(ini).toBeGreaterThan(0);
        const fim = html.indexOf('<h2>', ini + 5);
        const secao = html.slice(ini, fim > 0 ? fim : undefined);
        const itens = (secao.match(/<h3>/g) || []).length;
        expect(itens).toBeGreaterThan(0);
        expect(NOVIDADES_VERSAO.split('.')[1]).toBe(String(itens));
    });
});
