/**
 * O TOM do toast sai da MENSAGEM.
 *
 * Paulo, 12/08/2026: o envio do DAS por WhatsApp falhou ("template não existe
 * nesse idioma") e o toast apareceu com um ✓ VERDE do lado — o componente
 * pintava check verde em tudo. Ícone é AFIRMAÇÃO: verde ao lado de "Falha" é
 * farol mentiroso, e o colaborador lê o ícone antes do texto.
 */
import { tomDoToast } from '../services/toastTom';

describe('falha nunca vira verde', () => {
    it('a mensagem real do caso — que ainda por cima contém "envio"', () => {
        expect(tomDoToast(
            'Falha no envio por WhatsApp: template name (envio_guia_imposto) does not exist in pt_BR',
        )).toBe('erro');
    });

    it('erro vence sucesso mesmo quando as duas palavras aparecem', () => {
        expect(tomDoToast('Erro ao transmitir: declaração já transmitida')).toBe('erro');
        expect(tomDoToast('Não foi possível declarar: o SN-Entregar recusou')).toBe('erro');
    });

    it('recusa e bloqueio também são falha', () => {
        expect(tomDoToast('Envio recusado pela Receita')).toBe('erro');
        expect(tomDoToast('Transmissão bloqueada: falta insumo do DP')).toBe('erro');
    });

    // Onde o app SABE o tom, ele carimba — e o carimbo vence a palavra. A
    // recusa da T1 é uma frase afirmativa ("a DCTFWeb é transmitida pelo
    // fiscal") que nenhuma régua de texto classificaria como falha.
    it('carimbo explícito vence o texto', () => {
        expect(tomDoToast('🛑 A DCTFWeb é transmitida pelo departamento FISCAL')).toBe('erro');
        expect(tomDoToast('⚠️ Esta competência já foi transmitida por sandra@sp.com.br')).toBe('alerta');
    });
});

describe('alerta é o meio-termo', () => {
    it('ressalva não é sucesso nem falha', () => {
        expect(tomDoToast('DCTFWeb RETIFICADA ⚠️ Nenhum débito mudou — confira se o insumo chegou')).toBe('alerta');
        expect(tomDoToast('Conferência concluída — há divergências')).toBe('alerta');
        expect(tomDoToast('Eventos lidos — DCTFWeb não pôde ser lida')).toBe('erro');
    });
});

describe('sucesso só quando o ato se completou', () => {
    it('reconhece as frases de conclusão do app', () => {
        expect(tomDoToast('DCTFWeb transmitida (recibo 202608.12345)')).toBe('sucesso');
        expect(tomDoToast('Guia enviada ao cliente com PDF anexado')).toBe('sucesso');
    });
});

describe('o que não se declara NÃO vira sucesso', () => {
    // Afirmar por omissão é o defeito que estamos corrigindo.
    it('mensagem neutra fica neutra, não verde', () => {
        expect(tomDoToast('Competência 2026-07 · 8 produtores')).toBe('neutro');
        expect(tomDoToast('')).toBe('neutro');
    });
});
