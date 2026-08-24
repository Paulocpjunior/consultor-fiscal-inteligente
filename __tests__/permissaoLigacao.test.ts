// ============================================================================
// ☎️ PERMISSÃO DE LIGAÇÃO (fase 2 — a saída) · Paulo, 24/08: "pode construir
// o botão, ganhamos tempo"
// ----------------------------------------------------------------------------
// Regra da Meta: empresa só liga pro cliente DEPOIS que ele autoriza — o
// pedido chega como cartão "Permitir" na conversa dele. Aqui se prova o
// núcleo puro (corpo do pedido + leitura tolerante da resposta) e a FIAÇÃO:
// rota com as mesmas travas do responder, webhook carimbando a conversa, e
// o botão existindo na tela com confirmação antes (é mensagem real saindo).
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import {
    montarPedidoPermissaoLigacao, respostaDePermissaoLigacao, resumoDaPermissao,
} from '../sefaz-backend/whatsapp-chamadas.js';

const ler = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('montarPedidoPermissaoLigacao', () => {
    it('monta o interactive/call_permission_request pro número pedido', () => {
        const corpo = montarPedidoPermissaoLigacao('5511999990000');
        expect(corpo).toEqual({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: '5511999990000',
            type: 'interactive',
            interactive: { type: 'call_permission_request', action: { name: 'call_permission_request' } },
        });
    });
});

describe('respostaDePermissaoLigacao (leitura TOLERANTE do webhook)', () => {
    it('accept vira aceita, com o expiration em segundos convertido', () => {
        const r = respostaDePermissaoLigacao({
            type: 'interactive',
            interactive: {
                type: 'call_permission_reply',
                call_permission_reply: { response: 'accept', expiration_timestamp: 1756100000 },
            },
        });
        expect(r?.resposta).toBe('aceita');
        expect(r?.expiraEm).toBe(new Date(1756100000 * 1000).toISOString());
        expect(r?.bruto).toBeTruthy(); // leiaute não provado — o cru viaja junto
    });

    it('qualquer resposta que não seja accept é RECUSA (nunca aceite por engano)', () => {
        const r = respostaDePermissaoLigacao({
            type: 'interactive',
            interactive: { type: 'call_permission_reply', call_permission_reply: { response: 'reject' } },
        });
        expect(r?.resposta).toBe('recusada');
        expect(r?.expiraEm).toBeNull();
    });

    it('mensagem comum (texto, botão de lista) volta null — nada some, nada vira permissão', () => {
        expect(respostaDePermissaoLigacao({ type: 'text', text: { body: 'oi' } })).toBeNull();
        expect(respostaDePermissaoLigacao({
            type: 'interactive', interactive: { type: 'button_reply', button_reply: { title: '1' } },
        })).toBeNull();
        expect(respostaDePermissaoLigacao(null)).toBeNull();
    });

    it('o resumo legível diz o que aconteceu — é a linha da conversa', () => {
        expect(resumoDaPermissao({ resposta: 'aceita', expiraEm: null, bruto: {} } as any)).toContain('AUTORIZOU');
        expect(resumoDaPermissao({ resposta: 'recusada', expiraEm: null, bruto: {} } as any)).toContain('recusou');
        expect(resumoDaPermissao(null)).toBeNull();
    });
});

describe('fiação: rota, webhook e botão', () => {
    const rotas = ler('sefaz-backend/whatsapp-routes.js');
    const webhook = ler('sefaz-backend/whatsapp-webhook.js');
    const webhookRotas = ler('sefaz-backend/whatsapp-webhook-routes.js');
    const tela = ler('components/SpConnect/index.tsx');

    it('a rota existe com as MESMAS travas do responder (janela + condução + IG fora)', () => {
        const rota = rotas.slice(rotas.indexOf("pedir-permissao-ligacao'"), rotas.indexOf("pedir-permissao-ligacao'") + 3200);
        expect(rota).toContain('janela24hAte');
        expect(rota).toContain('emConducaoPor');
        expect(rota).toContain('Instagram');
        expect(rota).toContain('enviarPedidoPermissaoLigacao');
    });

    it('o webhook extrai a resposta e a conversa recebe o carimbo permissaoLigacao', () => {
        expect(webhook).toContain('respostaDePermissaoLigacao(m)');
        expect(webhookRotas).toContain('resumoDaPermissao(msg.permissaoLigacao)');
        expect(webhookRotas).toMatch(/permissaoLigacao: \{\s*\n?\s*status: msg\.permissaoLigacao\.resposta/);
    });

    it('o GET /conversas leva o status pra tela (campo fora da resposta some da leitura)', () => {
        expect(rotas).toMatch(/permissaoLigacao: x\.permissaoLigacao \|\| null/);
    });

    it('o botão existe, confirma ANTES (mensagem real ao cliente) e some quando já autorizado', () => {
        expect(tela).toContain('☎️ Pedir permissão de ligação');
        // ⚠️ A forma MUDOU (24/08): era window.confirm e o webview do Teams
        // o suprime — o botão não fazia nada. O teste prende a INTENÇÃO (há
        // confirmação antes de mandar mensagem ao cliente), nunca a função:
        // travar a forma foi o que reprovaria a própria correção.
        expect(tela).toMatch(/acaoPermissaoLigacao[\s\S]{0,400}await pedirConfirmacao\(/);
        expect(tela).toContain("permissaoLigacao?.status !== 'aceita' && (");
    });
});
