// ============================================================================
// 🚨 CONFERIR OS NÚMEROS DO RESUMO EXIGIA DISPARAR O E-MAIL DE VERDADE
//
// `/previa-resumo` ("so coleta, NAO envia e-mail", diz o comentário da rota)
// existia e nenhuma tela a chamava — a varredura de rotas achou em 22/08. O
// único botão era o "Testar resumo diário", que ENVIA. Ou seja: conferir e
// enviar eram a mesma ação, e quem só queria ver o número enchia a própria
// caixa — o mesmo vício do "Já importado" sem estado, na direção oposta.
//
// ⚠️ ESTE TESTE É DE PORTA, não de tela, e o motivo é declarado: a Carteira
// puxa Firebase inteiro e não monta em jest. O que ele prova é o contrato da
// porta (método, caminho, e o que ela faz com a recusa) — e a varredura de
// `rotaTemChamada` é quem garante que a tela a chama.
// ============================================================================
import { previaResumoDiario } from '../services/notificacoesService';

jest.mock('firebase/auth', () => ({
    getAuth: () => ({ currentUser: { getIdToken: async () => 'tok' } }),
}));

describe('🚨 prévia do resumo — coleta sem enviar', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        (global as any).fetch = fetchMock;
    });

    it('vai por GET em /previa-resumo — a rota que NÃO manda e-mail', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ totalCapturas: 7 }) });
        const r = await previaResumoDiario();
        expect(r.ok).toBe(true);
        expect(r.resumo?.totalCapturas).toBe(7);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/previa-resumo');
        // POST aqui seria a rota de ENVIO; o método é parte do contrato.
        expect(init?.method === undefined || init.method === 'GET').toBe(true);
    });

    it('recusa sai NOMEADA, nunca como resumo vazio', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Somente admin' }) });
        const r = await previaResumoDiario();
        expect(r).toEqual({ ok: false, error: 'Somente admin' });
    });

    it('rede caída não vira "zero captura"', async () => {
        fetchMock.mockRejectedValue(new Error('Failed to fetch'));
        const r = await previaResumoDiario();
        expect(r.ok).toBe(false);
        expect(r.resumo).toBeUndefined();
    });
});
