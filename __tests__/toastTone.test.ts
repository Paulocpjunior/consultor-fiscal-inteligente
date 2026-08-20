/**
 * toastTone.test.ts — o toast não pode vender falha como sucesso.
 * Caso real (print do Paulo, 20/08): "Falha na análise: IA indisponível…"
 * chegou na colaboradora com ✓ verde. Mesmo defeito existia aqui.
 */
import { tomDoToast, duracaoDoToast, TOM_META } from '../services/toastTone';

describe('tomDoToast', () => {
    it('o caso relatado é ERRO, não sucesso', () => {
        expect(tomDoToast('Falha na análise: IA indisponível: Your prepayment credits are depleted.')).toBe('erro');
    });

    it('reconhece as falhas que o app realmente emite', () => {
        const falhas = [
            'Erro ao carregar tipos: HTTP 500',
            'Falha na captura: SEFAZ recusou o certificado',
            'Não deu pra emitir a guia: serviço indisponível',
            'Erro ao salvar empresa: permissão negada',
            'Sessão expirada — faça login novamente',
            'a consulta passou de 45s sem resposta do servidor',
            'Falha de conexão em o resumo do painel',
        ];
        for (const f of falhas) expect(tomDoToast(f)).toBe('erro');
    });

    it('sucesso continua sucesso', () => {
        const oks = [
            'Captura concluída: 645 documentos gravados.',
            'Configurações salvas.',
            'Resumo copiado.',
            'Guia enviada ao cliente com o gestor em cópia.',
        ];
        for (const o of oks) expect(tomDoToast(o)).toBe('sucesso');
    });

    it('aviso não é erro nem sucesso', () => {
        expect(tomDoToast('⚠️ Captura pausada nas configurações')).toBe('alerta');
        expect(tomDoToast('Nenhum documento no período')).toBe('alerta');
    });

    it('erro fica bem mais tempo na tela (a mensagem traz a ação)', () => {
        expect(duracaoDoToast('erro')).toBeGreaterThanOrEqual(15000);
        expect(duracaoDoToast('erro')).toBeGreaterThan(duracaoDoToast('alerta'));
        expect(duracaoDoToast('alerta')).toBeGreaterThan(duracaoDoToast('sucesso'));
    });

    it('cada tom tem cor e ícone próprios (verde só no sucesso)', () => {
        expect(TOM_META.erro.emoji).not.toBe(TOM_META.sucesso.emoji);
        expect(TOM_META.erro.corBorda).not.toBe(TOM_META.sucesso.corBorda);
        expect(TOM_META.sucesso.corBorda).toBe('#16A34A');
    });
});
