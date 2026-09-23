// ============================================================================
// ✅ ATENDIMENTO ENCERRADO SAI DA CAIXA DO COLABORADOR
//
// Paulo, 23/09: *"devemos criar uma ABA em especial com acesso aos admin
// somente para atendimentos encerrados/finalizados para que não ocupe a caixa
// do colaborador"*.
//
// 🚨 A METADE QUE QUASE FICOU: tirar da caixa só é seguro se o cliente que
// VOLTA reabre o atendimento. O caminho do WhatsApp já fazia isso inline
// desde 25/08 (veio de um print dele) — **o do Instagram e o da LIGAÇÃO
// PERDIDA não faziam**: os dois somavam `naoLidas` e deixavam
// `status: 'resolvida'`. Com a aba escondendo as resolvidas, uma DM ou uma
// chamada perdida de cliente viraria pendência que ninguém vê.
//
// É a régua de sempre: **meia correção não deixa o defeito pela metade, ela
// troca "caixa cheia" por "cliente perdido"**.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { conversaEncerrada, patchDeReabertura, podeVerEncerrados } from '../sefaz-backend/whatsapp-atendimento.js';
import { filtrarConversas } from '../services/spConnect';
import type { ConversaResumo } from '../services/spConnect';

const raiz = process.cwd();

describe('✅ quem responde "esta conversa está encerrada?"', () => {
    it('lê as DUAS formas — `status` no banco, `situacao` na lista', () => {
        // ⚠️ A armadilha das duas formas atacando o MESMO fato: a rota devolve
        // `situacao`, o Firestore guarda `status`. Ler uma só faria a tela e o
        // backend discordarem sobre a mesma conversa.
        expect(conversaEncerrada({ status: 'resolvida' })).toBe(true);
        expect(conversaEncerrada({ situacao: 'resolvida' })).toBe(true);
        expect(conversaEncerrada({ status: 'aberta' })).toBe(false);
    });

    it('ausência NÃO é "encerrada" — conversa antiga sem o campo é ABERTA', () => {
        // Conversa gravada antes de o campo existir não pode sumir da caixa.
        expect(conversaEncerrada({})).toBe(false);
        expect(conversaEncerrada(null)).toBe(false);
    });
});

describe('🚨 o cliente que volta REABRE o atendimento', () => {
    it('mensagem de ENTRADA em conversa resolvida devolve o patch', () => {
        const p = patchDeReabertura({ status: 'resolvida' }, { direcao: 'entrada', agora: '2026-09-23T12:00:00Z' });
        expect(p).not.toBeNull();
        expect(p!.status).toBe('aberta');
        expect(p!.reabertaPor).toBe('cliente');
    });

    it('e o atendimento é NOVO: sem dono, sem fila, sem submenu', () => {
        // Herdar o dono antigo mandaria a conversa para a caixa de quem já deu
        // o caso por fechado — e que pode nem estar mais na fila. `fila: null`
        // devolve à Recepção, que é onde a triagem roda.
        const p = patchDeReabertura({ status: 'resolvida' }, { direcao: 'entrada' })!;
        expect(p.atribuidoA).toBeNull();
        expect(p.fila).toBeNull();
        expect(p.submenuAberto).toBeNull();
        expect(p.aguardandoAvaliacao).toBe(false);
    });

    it('⚠️ SAÍDA não reabre — eco nosso não é o cliente voltando', () => {
        // Ressuscitar a conversa por causa de um eco (resposta nossa por outra
        // plataforma) encheria a caixa de volta sem ninguém ter escrito.
        expect(patchDeReabertura({ status: 'resolvida' }, { direcao: 'saida' })).toBeNull();
    });

    it('e conversa ABERTA não devolve patch — não há o que reabrir', () => {
        // Sem isto, toda mensagem limparia `atribuidoA` de uma conversa EM
        // ANDAMENTO, tirando da mesa de quem está atendendo a conversa que ele
        // está atendendo — a cada mensagem do cliente.
        expect(patchDeReabertura({ status: 'aberta' }, { direcao: 'entrada' })).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 A VARREDURA É O QUE FECHA A CLASSE.
//
// Eram TRÊS escritores da mesma conversa e só um reabria. Lista de arquivos
// envelheceria no próximo canal (um WhatsApp Business novo, um webhook de
// outra rede) — e envelheceria em SILÊNCIO, que é como este buraco nasceu.
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 todo caminho que recebe do cliente sabe reabrir', () => {
    const webhook = readFileSync(join(raiz, 'sefaz-backend/whatsapp-webhook-routes.js'), 'utf8');

    it('o webhook do Instagram e o da ligação chamam o DONO', () => {
        const chamadas = (webhook.match(/patchDeReabertura\(/g) || []).length;
        // Duas chamadas: ligação perdida e DM do Instagram. O WhatsApp faz
        // inline desde 25/08 — ver o teste seguinte, que exige que ele
        // continue fazendo.
        expect(chamadas).toBeGreaterThanOrEqual(2);
    });

    it('e o caminho do WhatsApp continua reabrindo (ele já fazia)', () => {
        // ⚠️ Esta trava existe porque a correção de 25/08 é INLINE: se alguém
        // "limpar" aquele bloco achando que o dono novo cobre tudo, o caminho
        // principal para de reabrir e ninguém percebe.
        expect(webhook).toMatch(/MENSAGEM NOVA REABRE/);
        expect(webhook).toMatch(/eraResolvida/);
    });

    it('⚠️ e o ECO do Instagram NÃO reabre', () => {
        // Eco é resposta nossa por outra plataforma. O guard tem de estar
        // escrito: sem ele, responder pelo Business Suite traria a conversa
        // de volta para a caixa.
        expect(webhook).toMatch(/eco \? \{\} : \(patchDeReabertura/);
    });
});

describe('✅ quem ABRE a aba de encerrados', () => {
    it('admin e GESTOR abrem; colaborador não', () => {
        // 📌 Paulo, 23/09, corrigindo o primeiro desenho ("admin somente"):
        // *"gestor vê ABAS encerramos"*. É a régua do `podeEncerrar`: gestor
        // encerra qualquer atendimento desde 16/08 — sem a aba ele fecharia
        // no escuro, sem ver o resultado do próprio ato.
        expect(podeVerEncerrados('admin')).toBe(true);
        expect(podeVerEncerrados('gestor')).toBe(true);
        expect(podeVerEncerrados('colaborador')).toBe(false);
    });

    it('e papel ausente ou desconhecido NÃO abre', () => {
        // Ausência não vira permissão: se o perfil não carregar, o padrão é
        // a porta fechada, nunca a lista de encerrados da carteira inteira.
        expect(podeVerEncerrados(null)).toBe(false);
        expect(podeVerEncerrados(undefined)).toBe(false);
        expect(podeVerEncerrados('')).toBe(false);
        expect(podeVerEncerrados('Gerente')).toBe(false);
    });
});

describe('🔒 a aba de encerrados é recusada pela ROTA, não pela tela', () => {
    const rotas = readFileSync(join(raiz, 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = readFileSync(join(raiz, 'components/SpConnect/index.tsx'), 'utf8');

    it('pedir ?situacao=resolvida sem poder devolve 403', () => {
        // Esconder o chip no navegador é conveniência. Se a trava fosse só da
        // tela, qualquer colaborador com o link leria os atendimentos
        // encerrados da carteira inteira — é a régua do `allow write: if false`
        // do fim de mês.
        expect(rotas).toMatch(/soEncerradas && !podeVerEncerrados\(papel\)/);
        expect(rotas).toMatch(/A aba de encerrados é para admin e gestor/);
    });

    it('🚨 e a TELA lê o MESMO dono — não uma segunda cópia da regra', () => {
        // ⚠️ Esta é a trava que importa no dia em que a regra mudar de novo
        // (ela já mudou uma vez, hoje). Com `papel === 'admin' || papel ===
        // 'gestor'` escrito também no React, mexer só no backend deixa o chip
        // aceso contra uma rota que recusa — e isso chega como "não
        // funciona", sem erro nenhum no log.
        expect(tela).toMatch(/podeVerEncerrados/);
        expect(tela).toMatch(/veEncerrados && chip\('encerrados'/);
        // O rodapé do farol segue a MESMA permissão: número que o colaborador
        // vê sem poder abrir a aba é alarme sem ação.
        expect(tela).toMatch(/veEncerrados && aba !== 'encerrados'/);
    });

    it('e a lista normal exclui as encerradas pelo DONO, não por comparação solta', () => {
        expect(rotas).toMatch(/visiveis\.filter\(\(cv\) => !conversaEncerrada\(cv\)\)/);
    });

    it('o número das ocultas NÃO some — farol honesto', () => {
        // Lista que encolhe sem dizer por quê vira suspeita de conversa
        // perdida, e aí a equipe deixa de confiar na caixa.
        expect(rotas).toMatch(/encerradasOcultas/);
    });
});

describe("⚠️ 'encerrados' não é id de fila", () => {
    const conversa = (over: Partial<ConversaResumo>): ConversaResumo => ({
        numero: '5511999999999',
        nome: 'Padaria Bela Massa',
        empresaId: null,
        fila: null,
        atribuidoA: null,
        situacao: 'resolvida',
        janela24hAte: null,
        ultimaMensagem: null,
        naoLidas: 0,
        atualizadoEm: null,
        ...over,
    } as ConversaResumo);

    it('a aba mostra o que o servidor devolveu, sem filtrar por fila', () => {
        // 🐛 Sem o caso explícito, 'encerrados' cairia no filtro de fila
        // (`fila !== 'encerrados'`), daria falso em TODAS e a aba apareceria
        // VAZIA — com o servidor tendo devolvido a lista certa. Botão que
        // acende e não mostra nada é pior que botão nenhum.
        const lista = [conversa({}), conversa({ numero: '5511888888888', fila: 'fiscal' })];
        expect(filtrarConversas(lista, { busca: '', aba: 'encerrados' })).toHaveLength(2);
    });

    it('e a busca continua valendo DENTRO da aba', () => {
        const lista = [conversa({}), conversa({ numero: '5511888888888', nome: 'Outro' })];
        expect(filtrarConversas(lista, { busca: 'padaria', aba: 'encerrados' })).toHaveLength(1);
    });
});
