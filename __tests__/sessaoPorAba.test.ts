/**
 * sessaoPorAba.test.ts — o login NÃO pode sobreviver ao fechamento.
 *
 * Paulo, 23/08: "devem SEMPRE forçar login do usuário toda vez que sair e
 * voltar ao sistema". O padrão do Firebase é browserLocalPersistence, que
 * mantém a sessão por DIAS num computador que pode ser compartilhado.
 *
 * Varredura de FONTE (não de comportamento): jsdom não reproduz o ciclo de
 * vida do navegador, então o que dá pra travar é a configuração estar
 * escrita — e é justamente ela que alguém remove sem perceber num refactor.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const bruto = readFileSync(resolve(__dirname, '../services/firebaseConfig.ts'), 'utf-8');

/** Comentário NÃO é código: o texto que explica a decisão cita as opções
 *  descartadas, e sem isto a varredura acusaria o próprio comentário
 *  (mesma lição do check-backend-nomes do CFI). */
const semComentarios = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

const fonte = semComentarios(bruto);

describe('persistência da sessão', () => {
    it('fixa browserSessionPersistence — some ao fechar a aba/navegador', () => {
        expect(fonte).toContain('browserSessionPersistence');
        expect(fonte).toMatch(/setPersistence\(\s*auth\s*,\s*browserSessionPersistence\s*\)/);
    });

    it('NÃO usa persistência local nem indexedDB (sobreviveriam ao fechamento)', () => {
        expect(fonte).not.toContain('browserLocalPersistence');
        expect(fonte).not.toContain('indexedDBLocalPersistence');
    });

    it('não usa inMemoryPersistence — o F5 derrubaria o usuário no meio do trabalho', () => {
        // O UpdateBanner aplica atualização com hard reload; em memória, todo
        // deploy expulsaria quem estivesse usando o app.
        expect(fonte).not.toContain('inMemoryPersistence');
    });

    it('falha ao fixar a persistência NÃO trava o login — mas é dita', () => {
        expect(fonte).toMatch(/setPersistence[\s\S]{0,400}catch/);
        expect(fonte).toMatch(/console\.(warn|error)/);
    });
});
