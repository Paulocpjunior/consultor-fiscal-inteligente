/**
 * 🚨 "FALHA INTERNA" COM CAUSA (15/10, A CASTELLANO 09/2026).
 *
 * A geração do SPED respondia só "Falha interna" e a causa ficava no log do
 * Cloud Run, que ninguém da equipe lê. Fatos cobrados: a mensagem leva o erro
 * e o primeiro ponto do código do CFI na pilha (pulando node_modules e o
 * núcleo do Node); sem pilha legível, sai só a mensagem — nunca inventa lugar.
 */
import { ondeQuebrou, textoDaFalhaInterna } from '../sefaz-backend/falha-interna.js';

const PILHA = [
    "TypeError: Cannot read properties of undefined (reading 'uf')",
    '    at Array.map (<anonymous>)',
    '    at fmt (/app/node_modules/qualquer/lib/x.js:10:5)',
    '    at montarLinhasStBlocoE (/app/sefaz-backend/sped-bloco-e-st.js:321:40)',
    '    at buildBlocoE (/app/sefaz-backend/sped-fiscal-blocoE.js:260:20)',
    '    at node:internal/process/task_queues:95:5',
].join('\n');

it('diz o erro e ONDE, no código do CFI', () => {
    const e = Object.assign(new TypeError("Cannot read properties of undefined (reading 'uf')"), { stack: PILHA });
    expect(ondeQuebrou(PILHA)).toBe('sped-bloco-e-st.js:321');
    expect(textoDaFalhaInterna(e)).toBe("Falha interna: Cannot read properties of undefined (reading 'uf') (em sped-bloco-e-st.js:321)");
});

it('sem pilha legível: só a mensagem, sem lugar inventado', () => {
    expect(textoDaFalhaInterna({ message: 'quota excedida', stack: 'Error: quota excedida\n    at <anonymous>' })).toBe('Falha interna: quota excedida');
    expect(textoDaFalhaInterna(null)).toBe('Falha interna: erro sem mensagem');
});
