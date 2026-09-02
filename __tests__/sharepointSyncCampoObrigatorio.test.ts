// ============================================================================
// 🚨 O BOTÃO DISPARAVA COM CAMPO OBRIGATÓRIO VAZIO — e o app já sabia
//
// 02/09, print do Paulo. A tela mostrava, em vermelho:
//
//   Empresas//DEPARTAMENTO FISCAL/2026/09-2026//XML SAÍDA
//   ⚠ Falta preencher: Grupo, Empresa (pasta).
//
// …e o botão "Sincronizar agora" continuava clicável. O caminho saiu com
// segmentos VAZIOS (as barras duplas) e o Graph respondeu:
//
//   Failed to list folder (404) … {"code":"itemNotFound"}
//
// 🔴 "A pasta não existe" manda procurar a PASTA no SharePoint — sobre uma
// pasta que pode estar perfeita. É a primeira parada errada, e o app tinha a
// resposta certa na tela um centímetro acima.
//
// ⚠️ Botão apagado tem de DIZER o que falta (régua de 20/08: "parece
// desabilitado" e "está desabilitado" são a mesma coisa para quem usa).
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const FONTE = readFileSync(join(__dirname, '..', 'components', 'xml', 'XmlSharePoint.tsx'), 'utf8');

// ⚠️ Lê CÓDIGO, nunca a prosa que o explica — o comentário acima da correção
// repete as palavras dela, e casar com ele passaria verde sobre o defeito.
const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🚨 caminho com pedaço vazio não vai ao SharePoint', () => {
    it('o botão fica apagado quando falta campo obrigatório', () => {
        expect(CODIGO).toMatch(/disabled=\{[^}]*faltando\.length > 0[^}]*\}/);
    });

    it('e ele DIZ o que falta — botão apagado sem motivo se lê como função inexistente', () => {
        expect(CODIGO).toMatch(/title=/);
        expect(CODIGO).toMatch(/Falta preencher: \$\{faltando\.join/);
    });

    // 🚨 A recusa vive no handler também: é ela que nomeia o campo, e o botão
    // sozinho não explica nada para quem chegou pelo teclado.
    it('a recusa nomeia o campo e diz que o problema NÃO é a pasta', () => {
        expect(CODIGO).toMatch(/if \(faltando\.length > 0\)/);
        expect(CODIGO).toMatch(/o problema não é a pasta/);
    });

    // ⚠️ No modo "caminho personalizado" não há campo obrigatório — `faltando`
    // é vazio de propósito. Bloquear ali impediria justamente o link.
    it('o modo caminho personalizado não é bloqueado', () => {
        expect(CODIGO).toMatch(/const faltando = useCustom \? \[\]/);
    });
});
