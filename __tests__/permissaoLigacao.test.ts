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

// ═══ 24/08 — "enviei o pedido mas nada aconteceu" ═══════════════════════════
// O cartão não chegou no cliente e a tela não disse por quê. Três defeitos
// de uma vez, e nenhum deles era o botão:
//  · a CHAMADA falava a v20 do Graph, que não conhece o call_permission_request;
//  · 2xx SEM `messages[0].id` era lido como falha ("HTTP 200") — o cartão
//    TERIA chegado e a tela mostraria erro, que é o pior desfecho;
//  · a recusa morava numa linha âmbar de 10px, sem o código da Meta.
describe('☎️ pedido de permissão: versão, aceite sem id e recusa visível', () => {
    const cloud = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-cloud.js'), 'utf8');
    const rotas = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = fs.readFileSync(path.join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');

    it('o pedido usa a base do Graph da CHAMADA, não a v20 do envio', () => {
        expect(cloud).toMatch(/deps\.base \|\| graphBaseChamadas\(deps\.env\)/);
        expect(cloud).toMatch(/WHATSAPP_GRAPH_VERSAO_CHAMADAS \|\| 'v23\.0'/);
        // E só ELE muda de versão: texto, template e mídia seguem no GRAPH_BASE.
        expect(cloud).toMatch(/export const GRAPH_BASE = 'https:\/\/graph\.facebook\.com\/v20\.0'/);
    });

    it('2xx sem id da Meta é ACEITE, e a linha ainda entra no histórico', () => {
        expect(cloud).toMatch(/semIdDaMeta: true/);
        expect(rotas).toMatch(/envio\.messageId \|\| `permreq_/);
    });

    it('a recusa volta com CÓDIGO, vai pro log e aparece em vermelho', () => {
        expect(rotas).toMatch(/code: envio\.code \?\? null/);
        expect(rotas).toMatch(/console\.warn\('\[whatsapp\/permissao-ligacao\] recusa da Meta:/);
        expect(tela).toMatch(/setPermLigErro\(/);
        expect(tela).toMatch(/permLigErro && \(/);
        expect(tela).toMatch(/código \$\{\(r as any\)\.code\}/);
    });
});

// A recusa por CONDUÇÃO é a que mais acontece (a conversa quase sempre tem
// dono) — e foi ela que apareceu no 1º teste real. Trava COM caminho: o
// erro traz o botão de assumir, senão a pessoa lê "está em condução por
// fulano" e não tem o que fazer na própria tela.
describe('recusa por condução oferece o caminho', () => {
    const tela = fs.readFileSync(path.join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');
    const svc = fs.readFileSync(path.join(process.cwd(), 'services/spConnectService.ts'), 'utf8');

    it('a resposta de erro chega INTEIRA na tela (acao, code, emConducaoPor)', () => {
        // Sem o spread, só `error` sobrevivia — a tela mostrava o problema
        // sem o caminho, em TODA recusa do Connect.
        expect(svc).toMatch(/return \{ \.\.\.data, ok: false, error: data\.error/);
    });

    it('condução acende o botão de assumir dentro do próprio erro', () => {
        expect(tela).toMatch(/setPermLigConducao\(Boolean\(\(r as any\)\.emConducaoPor\)\)/);
        expect(tela).toMatch(/Assumir a conversa e tentar de novo/);
        expect(tela).toMatch(/acaoAssumir\(\); setPermLigErro\(null\)/);
    });
});

// 24/08 — o cliente AUTORIZOU e o painel continuou dizendo "aguardando".
describe('a conversa aberta não vive de foto velha', () => {
    const tela = fs.readFileSync(path.join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');
    const cloud = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-cloud.js'), 'utf8');

    it('o refresh de 30s ressincroniza a conversa SELECIONADA com o servidor', () => {
        expect(tela).toMatch(/find\(\(c\) => c\.numero === selRef\.current\?\.numero\)/);
        expect(tela).toMatch(/if \(abertaAgora\) setSel\(abertaAgora\)/);
    });

    it('o listar devolve o status da permissão (sem ele a tela nunca saberia)', () => {
        const rotas = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');
        expect(rotas).toMatch(/permissaoLigacao: x\.permissaoLigacao \|\| null/);
    });

    it('138009 (limite de pedidos) vira orientação, não "tente novamente"', () => {
        expect(cloud).toMatch(/code === 138009/);
        expect(cloud).toMatch(/a autorização vale/);
    });
});

// ═══ 📞 A SAÍDA (Paulo, 24/08: "e agora como ligar?") ══════════════════════
// A permissão foi aceita e a tela dizia "ligue pelo ramal 221" — frase MINHA,
// que o app não cumpria: não havia caminho de saída. O botão passa a existir
// e a régua da Meta (só liga com o "Permitir") é trava do BACKEND, nunca só
// da tela — quem some com o botão não impede a rota.
describe('📞 ligar para o cliente', () => {
    const rotas = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const cloud = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-cloud.js'), 'utf8');
    const tela = fs.readFileSync(path.join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');
    const rota = rotas.slice(rotas.indexOf("router.post('/conversas/:numero/ligar'"));

    it('sem o "Permitir" do cliente a ROTA recusa — e diz o que fazer', () => {
        expect(rota).toMatch(/perm\?\.status !== 'aceita'/);
        expect(rota).toMatch(/ainda não autorizou ligações/);
        // Recusa do cliente NÃO vira "peça de novo": insistir é o que faz
        // ele bloquear o número.
        expect(rota).toMatch(/respeite a recusa/);
    });

    it('autorização EXPIRADA é recusa própria, não "sem permissão"', () => {
        expect(rota).toMatch(/EXPIROU/);
        expect(rota).toMatch(/permissao: 'expirada'/);
    });

    it('condução vale aqui também (duas vozes ligando é pior que duas escrevendo)', () => {
        expect(rota).toMatch(/Assuma a conversa \(🙋\) antes de ligar/);
    });

    it('a chamada sai no endpoint /calls e na base da CHAMADA, sem SDP inventado', () => {
        expect(cloud).toMatch(/\$\{base\}\/\$\{cfg\.phoneNumberId\}\/calls/);
        expect(cloud).toMatch(/deps\.base \|\| graphBaseChamadas\(deps\.env\)/);
        const chamadas = fs.readFileSync(path.join(process.cwd(), 'sefaz-backend/whatsapp-chamadas.js'), 'utf8');
        const corpo = chamadas.slice(chamadas.indexOf('export function montarChamadaParaCliente'));
        expect(corpo.slice(0, 300)).not.toMatch(/sdp/i);
    });

    it('a rede caída NÃO manda tentar de novo (o telefone pode estar tocando)', () => {
        expect(cloud).toMatch(/a chamada PODE ter saído/);
    });

    // ⚠️ Premissa TROCADA pela RESPOSTA DA META (24/08, código 131055):
    // "Graph API calls are not allowed for SIP enabled numbers". O botão que
    // eu tinha acabado de escrever seria um botão que nunca funciona — em
    // modo SIP a saída sai pelo TRONCO. A rota fica (ela é a prova, e o dia
    // em que o número sair do modo SIP ela volta a valer), mas a tela não
    // oferece o clique: ela DIZ como se liga.
    it('a tela NÃO oferece ligar por API — ela diz que a saída é pelo ramal', () => {
        expect(tela).not.toMatch(/📞 Ligar para o cliente \(atende no ramal 221\)/);
        expect(tela).toMatch(/A ligação de saída sai pelo <strong>tronco SIP<\/strong>/);
        expect(tela).toMatch(/permissaoLigacao\?\.status === 'aceita' \?/);
    });

    // 🚨 TRAVA LITERAL TROCADA PELA INTENÇÃO (25/08, 2ª vez neste mesmo bloco).
    // Ela prendia a frase "Em validação: falta a primeira ligação RECEBIDA" —
    // e essa frase virou o defeito: com o gravador do SBC provado ligado, a
    // chamada das 14h52 (dentro da janela) não produziu CDR nem INVITE em três
    // conferências seguidas, ou seja a Meta ACEITA e NÃO ENTREGA no tronco.
    // Mandar esperar a primeira ligação era mandar esperar o que não acontece
    // sozinho. O que a trava garante agora é o COMPORTAMENTO: a linha diz o
    // estado MEDIDO e não devolve espera ao colaborador.
    it('o estado da ligação é o MEDIDO, e não manda esperar ligação que não chega', () => {
        expect(tela).not.toMatch(/Em validação: falta a primeira ligação RECEBIDA/);
        expect(tela).toMatch(/Ligação ainda NÃO funciona nos dois sentidos/);
        expect(tela).toMatch(/não entrega no nosso tronco/);
        // Estado sem saída é beco: a linha diz o que dá pra fazer HOJE.
        expect(tela).toMatch(/Fale por mensagem enquanto isso/);
    });

    // 🚨 CÓDIGO MORTO COM CARA DE ENTREGA: a ação de ligar e a porta de fetch
    // ficaram órfãs quando o botão saiu (24/08). Órfã é a isca para alguém
    // religar um caminho que a Meta recusa POR DESENHO — as duas foram
    // deletadas em 25/08. Se voltarem, é junto do botão, e o botão só existe
    // quando o número sair do modo SIP.
    it('não sobra ação nem porta de fetch órfã de ligar por API', () => {
        expect(tela).not.toMatch(/const acaoLigar/);
        expect(tela).not.toMatch(/ligarParaCliente/);
        const servico = fs.readFileSync(path.join(process.cwd(), 'services/spConnectService.ts'), 'utf8');
        expect(servico).not.toMatch(/export const ligarParaCliente/);
    });

    it('131055 é traduzido com a arquitetura, não com "tente de novo"', () => {
        expect(cloud).toMatch(/code === 131055/);
        expect(cloud).toMatch(/quem disca é o tronco/);
    });

    it('o SBC tem a perna de saída, e ela RECUSA sem destino provado', () => {
        const sbc = fs.readFileSync(path.join(process.cwd(), 'scripts/setup-sbc-whatsapp.sh'), 'utf8');
        expect(sbc).toMatch(/META_SIP_DESTINO/);
        expect(sbc).toMatch(/SAIDA BLOQUEADA/);
        // Endpoint com contato vazio quebraria o pjsip e derrubaria a ENTRADA,
        // que já funciona — por isso ele nem é escrito.
        expect(sbc).toMatch(/saída desligada: META_SIP_DESTINO vazio/);
    });
});
