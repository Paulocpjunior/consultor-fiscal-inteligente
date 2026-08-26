/**
 * Sonda de chamada de voz/vídeo (Calling API da Meta).
 *
 * O que precisa ficar travado aqui é UMA coisa acima de todas:
 * **indeterminado nunca vira "desligado"**. Se a rede piscar ou o token não
 * alcançar, e o app responder "a chamada está desligada", alguém vai ligar à
 * mão um recurso que talvez já estivesse ligado — ou concluir que a conta não
 * tem algo que ela tem. É a mesma régua da sonda do Gemini (falha devolve
 * null, nunca false) e do farol honesto: ausência de resposta não é resposta.
 */
import {
    interpretarSondaChamadas, concluirSonda, acharBlocoDeChamada,
    CANDIDATOS_SONDA, ANTES_DE_LIGAR,
    montarCallHoursDoAtendimento, validarSipDestino, montarPayloadChamadas,
    lerCallingDasSettings, conferirCallHours,
    extrairEventosChamada, resumoDaChamada, traduzirEventoChamada,
} from '../sefaz-backend/whatsapp-chamadas';
import { configPadraoAtendimento } from '../sefaz-backend/whatsapp-atendimento';
// @ts-ignore — módulo JS do backend sem tipos próprios
import { naturezaDoEventoCru } from '../sefaz-backend/whatsapp-chamadas.js';

describe('interpretarSondaChamadas', () => {
    it('a Meta dizendo ENABLED é LIGADO, e a resposta diz em qual campo', () => {
        const r = interpretarSondaChamadas(200, { calling: { status: 'ENABLED' } });
        expect(r.situacao).toBe('ligado');
        expect(r.campo).toBe('calling');
        expect(r.motivo).toContain('LIGADA');
    });

    it('DISABLED é desligado', () => {
        expect(interpretarSondaChamadas(200, { calling: { status: 'DISABLED' } }).situacao).toBe('desligado');
    });

    it('acha o bloco mesmo aninhado (a forma da resposta não é contrato nosso)', () => {
        const r = interpretarSondaChamadas(200, { data: [{ settings: { calling: { status: 'ENABLED' } } }] });
        expect(r.situacao).toBe('ligado');
        expect(r.campo).toContain('calling');
    });

    it('🚨 erro de rede é INDETERMINADO, nunca "desligado"', () => {
        expect(interpretarSondaChamadas(null, null).situacao).toBe('indeterminado');
        expect(interpretarSondaChamadas(500, { error: { message: 'oops' } }).situacao).toBe('indeterminado');
    });

    it('🚨 token sem permissão é SEM-PERMISSAO — e a resposta DIZ que isso não fala da chamada', () => {
        const r = interpretarSondaChamadas(403, { error: { message: 'permissão faltando' } });
        expect(r.situacao).toBe('sem-permissao');
        expect(r.acao).toMatch(/não diz nada sobre a chamada/i);
    });

    it('respondeu sem campo de chamada é NAO-DECLARADO (e leva o cru junto)', () => {
        const r = interpretarSondaChamadas(200, { id: '123', display_phone_number: '+55 11 3337-1554' });
        expect(r.situacao).toBe('nao-declarado');
        expect(r.bruto).toEqual({ id: '123', display_phone_number: '+55 11 3337-1554' });
    });

    it('bloco de chamada em formato desconhecido NÃO é chutado — vira nao-reconhecido com o cru', () => {
        const r = interpretarSondaChamadas(200, { calling: { modo: 'algo_novo_da_meta' } });
        expect(r.situacao).toBe('nao-reconhecido');
        expect(r.bruto).toBeTruthy();
        expect(r.acao).toMatch(/crua/i);
    });

    it('a busca do bloco não confunde palavra parecida (callback não é calling)', () => {
        expect(acharBlocoDeChamada({ callback_url: 'x', calling: { status: 'ENABLED' } }))
            .toEqual([{ caminho: 'calling', valor: { status: 'ENABLED' } }]);
    });
});

describe('concluirSonda', () => {
    it('resposta afirmativa manda, mesmo com outro caminho mudo', () => {
        const c = concluirSonda([
            { situacao: 'nao-declarado', motivo: 'x' },
            { situacao: 'ligado', motivo: 'A Meta diz que a chamada está LIGADA (calling).' },
        ]);
        expect(c.veredito).toBe('ligado');
    });

    it('🚨 nenhum caminho conclusivo NÃO vira desligado', () => {
        expect(concluirSonda([]).veredito).toBe('indeterminado');
        expect(concluirSonda([{ situacao: 'indeterminado', motivo: 'x' }]).veredito).toBe('indeterminado');
    });

    it('todos respondendo sem campo de chamada vira nao-declarado, com a ação de conferir na Meta', () => {
        const c = concluirSonda([
            { situacao: 'nao-declarado', motivo: 'a' },
            { situacao: 'nao-declarado', motivo: 'b' },
        ]);
        expect(c.veredito).toBe('nao-declarado');
        expect(c.acao).toMatch(/Gerenciador de WhatsApp/i);
    });

    it('formato desconhecido vence "não declarado" — é ele que tem informação nova', () => {
        const c = concluirSonda([
            { situacao: 'nao-declarado', motivo: 'a' },
            { situacao: 'nao-reconhecido', motivo: 'veio bloco estranho', acao: 'olhe o cru' },
        ]);
        expect(c.veredito).toBe('nao-reconhecido');
    });
});

describe('a decisão vai junto da sonda', () => {
    it('o app avisa o que acontece ANTES de ligar — inclusive o efeito no cliente', () => {
        const texto = JSON.stringify(ANTES_DE_LIGAR);
        expect(ANTES_DE_LIGAR.length).toBeGreaterThanOrEqual(3);
        // Ligar abre uma porta no WhatsApp do CLIENTE; e chamada sem quem
        // atenda é lida como "a SP não me atende", não como recurso desligado.
        expect(texto).toMatch(/cliente/i);
        expect(texto).toMatch(/atend/i);
    });

    it('os candidatos levam a HIPÓTESE escrita — sonda sem hipótese é chute com log', () => {
        expect(CANDIDATOS_SONDA.length).toBeGreaterThanOrEqual(2);
        CANDIDATOS_SONDA.forEach((c) => {
            expect(c.hipotese.length).toBeGreaterThan(20);
            expect(c.caminho('123456')).toContain('123456');
        });
    });
});

describe('🚨 a sonda NÃO liga nada', () => {
    it('o módulo não tem nenhuma escrita na Meta (POST/DELETE) nem no banco', () => {
        // Mesma prova do `/prazos-municipais/consultar`: o handler que CONSULTA
        // não pode escrever. Aqui o custo de escrever por engano é abrir a
        // chamada no WhatsApp de todos os clientes sem ninguém decidir.
        // (Os construtores de configuração de 23/08 continuam PUROS: quem
        // escreve é a rota /chamadas/configurar, admin, com confirmação.)
        const fonte = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'sefaz-backend/whatsapp-chamadas.js'), 'utf8');
        expect(fonte).not.toMatch(/method:\s*['"](POST|DELETE|PUT|PATCH)['"]/);
        expect(fonte).not.toMatch(/\.set\(|\.update\(|\.doc\(/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// Configuração da chamada (Paulo, 23/08): caminho 1 — SIP → HitPhone, e
// "as ligações devem obedecer os MESMOS horários das mensagens".
// ════════════════════════════════════════════════════════════════════════════

describe('🕒 montarCallHoursDoAtendimento — projeção, nunca segunda grade', () => {
    it('o horário PADRÃO das mensagens (seg–sex, 08–12 e 13–17:30) vira a grade da Meta', () => {
        const r = montarCallHoursDoAtendimento(configPadraoAtendimento().horario);
        if (!r.ok) throw new Error(r.erro);
        expect(r.callHours.status).toBe('ENABLED');
        expect(r.callHours.timezone_id).toBe('America/Sao_Paulo');
        // 5 dias × 2 turnos = 10 janelas, no formato HHMM da Meta.
        expect(r.callHours.weekly_operating_hours).toHaveLength(10);
        expect(r.callHours.weekly_operating_hours).toContainEqual(
            { day_of_week: 'MONDAY', open_time: '0800', close_time: '1200' });
        expect(r.callHours.weekly_operating_hours).toContainEqual(
            { day_of_week: 'FRIDAY', open_time: '1300', close_time: '1730' });
        // Sábado/domingo NÃO entram — mensagens não atendem, ligação também não.
        const dias = new Set(r.callHours.weekly_operating_hours.map((w: { day_of_week: string }) => w.day_of_week));
        expect(dias.has('SATURDAY')).toBe(false);
        expect(dias.has('SUNDAY')).toBe(false);
    });

    it('🚨 turno ilegível RECUSA a projeção INTEIRA — grade meio-projetada abriria a chamada onde a mensagem não atende', () => {
        const r = montarCallHoursDoAtendimento({ dias: [1, 2], turnos: [{ inicio: '08:00', fim: '12:00' }, { inicio: 'oito', fim: '18:00' }] });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.erro).toMatch(/ilegível/i);
    });

    it('sem dias ou sem turnos recusa apontando a aba das mensagens (o dono)', () => {
        const r = montarCallHoursDoAtendimento({ dias: [], turnos: [] });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.erro).toMatch(/Bot e mensagens/i);
    });
});

describe('📞 validarSipDestino — tronco torto é chamada caindo no nada', () => {
    it('aceita hostname + porta e normaliza', () => {
        expect(validarSipDestino({ hostname: ' SIP.HitPhone.com.br ', porta: '5061' }))
            .toEqual({ ok: true, hostname: 'sip.hitphone.com.br', porta: 5061 });
    });
    it('recusa esquema, espaço, porta embutida e porta fora de faixa — com o motivo', () => {
        expect(validarSipDestino({ hostname: 'sip://x.com', porta: 5061 }).ok).toBe(false);
        expect(validarSipDestino({ hostname: 'sip.x.com:5061', porta: 5061 }).ok).toBe(false);
        expect(validarSipDestino({ hostname: 'sip.x.com', porta: 0 }).ok).toBe(false);
        expect(validarSipDestino({ hostname: 'sip.x.com', porta: 99999 }).ok).toBe(false);
        const semPorta = validarSipDestino({ hostname: 'sip.x.com' });
        expect(semPorta.ok).toBe(false);
        if (!semPorta.ok) expect(semPorta.erro).toMatch(/5061/);
    });
});

describe('montarPayloadChamadas — SÓ o pedaço pedido', () => {
    it('ícone não arrasta call_hours nem sip junto', () => {
        const r = montarPayloadChamadas({ iconeVisivel: false });
        if (!r.ok) throw new Error(r.erro);
        expect(r.payload.calling).toEqual({ call_icon_visibility: 'DISABLE_ALL' });
    });
    it('sip vira servers[] com status ENABLED', () => {
        const r = montarPayloadChamadas({ sip: { hostname: 'sip.x.com', porta: 5061 } });
        if (!r.ok) throw new Error(r.erro);
        expect(r.payload.calling).toEqual({ sip: { status: 'ENABLED', servers: [{ hostname: 'sip.x.com', port: 5061 }] } });
    });
    it('pedido vazio é recusa, não payload vazio gravado na Meta', () => {
        expect(montarPayloadChamadas({}).ok).toBe(false);
    });
});

describe('conferirCallHours — validação por RESULTADO (o que a Meta guardou)', () => {
    const horario = configPadraoAtendimento().horario;
    const projecao = () => {
        const p = montarCallHoursDoAtendimento(horario);
        if (!p.ok) throw new Error(p.erro);
        return p.callHours;
    };

    it('Meta com a MESMA grade ⇒ igual', () => {
        expect(conferirCallHours({ call_hours: projecao() }, horario).situacao).toBe('igual');
    });

    it('🚨 grade defasada ⇒ DIVERGE, com o detalhe — é o alarme de quem mudou as mensagens e não reaplicou', () => {
        const gravado = projecao();
        gravado.weekly_operating_hours = gravado.weekly_operating_hours.filter(
            (w: { day_of_week: string }) => w.day_of_week !== 'FRIDAY');
        const r = conferirCallHours({ call_hours: gravado }, horario);
        expect(r.situacao).toBe('diverge');
        expect(r.motivo).toMatch(/FRIDAY/);
    });

    it('sem call_hours gravado ⇒ dito como "vale 24h", nunca como igual', () => {
        const r = conferirCallHours({ status: 'ENABLED' }, horario);
        expect(r.situacao).toBe('sem-call-hours');
        expect(r.motivo).toMatch(/24h/);
    });

    it('lerCallingDasSettings acha o bloco calling (e devolve null dito quando não há)', () => {
        expect(lerCallingDasSettings({ calling: { status: 'ENABLED' } })).toEqual({ status: 'ENABLED' });
        expect(lerCallingDasSettings({ id: '1' })).toBeNull();
    });
});

describe('☎️ extrairEventosChamada — tolerante, com o cru junto (leiaute não provado)', () => {
    const payload = (call: Record<string, unknown>, field = 'calls') => ({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ field, value: { metadata: { phone_number_id: '116' }, calls: [call] } }] }],
    });

    it('chamada do CLIENTE: conversaId sai do from (em dígitos), direção entrada', () => {
        const r = extrairEventosChamada(payload({
            id: 'wacid.1', from: '+55 11 99999-0000', to: '551133371554',
            direction: 'USER_INITIATED', event: 'terminate', timestamp: '1787480000', duration: 65,
        }));
        expect(r.valido).toBe(true);
        expect(r.chamadas).toHaveLength(1);
        const c = r.chamadas[0];
        expect(c.conversaId).toBe('5511999990000');
        expect(c.direcao).toBe('entrada');
        expect(c.evento).toBe('terminate');
        expect(c.duracaoSegundos).toBe(65);
        expect(c.bruto).toBeTruthy(); // é do cru que sai a régua definitiva
    });

    it('chamada NOSSA (BUSINESS_INITIATED): o cliente é o TO, direção saída', () => {
        const c = extrairEventosChamada(payload({
            id: 'wacid.2', from: '551133371554', to: '5511888880000', direction: 'BUSINESS_INITIATED', status: 'missed',
        })).chamadas[0];
        expect(c.conversaId).toBe('5511888880000');
        expect(c.direcao).toBe('saida');
        expect(c.evento).toBe('missed');
    });

    it('🚨 evento sem id não some calado — volta em ilegiveis', () => {
        const r = extrairEventosChamada(payload({ from: '5511999990000', event: 'connect' }));
        expect(r.chamadas).toHaveLength(0);
        expect(r.ilegiveis).toHaveLength(1);
    });

    it('o array calls vale mesmo com o field nomeado diferente — a substância decide', () => {
        const r = extrairEventosChamada(payload({ id: 'x', from: '5511999990000' }, 'calling_events'));
        expect(r.chamadas).toHaveLength(1);
    });

    it('objeto que não é da WABA devolve inválido, sem inventar chamada', () => {
        expect(extrairEventosChamada({ object: 'instagram' }).valido).toBe(false);
    });

    it('a linha da conversa traduz o evento e formata a duração — desconhecido fica visível', () => {
        expect(resumoDaChamada({ direcao: 'entrada', evento: 'missed', duracaoSegundos: null }))
            .toBe('☎️ Ligação de WhatsApp do cliente — perdida');
        expect(resumoDaChamada({ direcao: 'saida', evento: 'terminate', duracaoSegundos: 65 }))
            .toContain('para o cliente — encerrada · 1m05s');
        expect(traduzirEventoChamada('novo_evento_da_meta')).toBe('novo_evento_da_meta');
    });
});

describe('🔌 fiação — a escrita mora na rota, com releitura e sem grade própria', () => {
    const fs = require('fs');
    const path = require('path');
    const rotas = fs.readFileSync(path.join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = fs.readFileSync(path.join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');

    it('POST /chamadas/configurar existe, é admin, e RE-LÊ as settings depois de gravar', () => {
        const i = rotas.indexOf("'/chamadas/configurar'");
        expect(i).toBeGreaterThan(-1);
        const trecho = rotas.slice(i, i + 6000);
        expect(rotas.slice(i - 200, i + 100)).toMatch(/router\.post\('\/chamadas\/configurar',\s*requireAdmin/);
        // Duas idas ao /settings: a escrita e a releitura (validação por resultado).
        expect((trecho.match(/\/settings`/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(trecho).toContain('lerCallingDasSettings');
    });

    it('🚨 a ação "horarios" projeta do ATENDIMENTO (resolverConfig) — nunca recebe grade do body', () => {
        const i = rotas.indexOf("'/chamadas/configurar'");
        const trecho = rotas.slice(i, i + 6000);
        expect(trecho).toContain('montarCallHoursDoAtendimento(cfgAt.horario)');
        // O body não fornece dias/turnos — a grade tem UM dono.
        expect(trecho).not.toMatch(/req\.body[^)\n]*\b(dias|turnos|horario)\b/);
    });

    it('a sonda devolve a CONFERÊNCIA horários-mensagens × Meta', () => {
        const i = rotas.indexOf("'/chamadas/sondar'");
        const trecho = rotas.slice(i, i + 6000);
        expect(trecho).toContain('conferirCallHours');
        expect(trecho).toContain('horarios');
    });

    it('a tela pede CONFIRMAÇÃO com a consequência, e diz a regra dos mesmos horários', () => {
        expect(tela).toContain('mesmos horários das mensagens');
        // Intenção, não forma: a confirmação passou a ser a caixa do app
        // (window.confirm não existe no webview do Teams — 24/08).
        expect(tela).toMatch(/await pedirConfirmacao\(confirmacao/);
        // Ocultar/mostrar o ☎️ com o efeito no cliente escrito antes do clique.
        expect(tela).toContain('Ocultar o botão');
        expect(tela).toContain('tronco SIP');
    });

    it('☎️ o webhook grava o evento de chamada na conversa — e chamada NÃO abre a janela de 24h', () => {
        const webhook = fs.readFileSync(path.join(__dirname, '..', 'sefaz-backend/whatsapp-webhook-routes.js'), 'utf8');
        expect(webhook).toContain('extrairEventosChamada');
        const i = webhook.indexOf('async function gravarEventoChamada');
        expect(i).toBeGreaterThan(-1);
        const corpo = webhook.slice(i, webhook.indexOf('\n}', i));
        // Janela de 24h é de MENSAGEM (regra da Meta): afirmá-la por ligação
        // liberaria texto livre que a Meta recusaria depois.
        expect(corpo).not.toContain('janela24hAte');
        // O cru viaja no doc — é dele que sai a régua quando o 1º evento real chegar.
        expect(corpo).toContain('bruto');
        // Reentrega da Meta não conta não-lida duas vezes.
        expect(corpo).toContain('jaExiste');
    });
});

// ============================================================================
// 🚨 "0 EVENTOS" SÓ VALE SE A AMOSTRA ALCANÇOU A HORA DA LIGAÇÃO
//
// 26/08, Paulo: *"acabei de tentar a ligação, chegou a tocar 1x"* — às 09:30,
// e ela aparece como "Não atendida" no celular dele. A pergunta que decide se
// isso é avanço (a Meta passou a entregar) ou o mesmo bloqueio de 25/08 é uma
// só: **chegou evento no nosso webhook naquele minuto?**
//
// O painel lia os 200 eventos mais recentes. Numa caixa de 300 conversas isso
// pode ser uma janela de MINUTOS — e aí "nenhum evento de chamada" se lê como
// *"a Meta não mandou nada"* quando o certo seria *"não olhei até lá"*. Duas
// conclusões opostas a partir do mesmo zero: uma fecha o chamado com a Meta,
// a outra abre.
// ============================================================================
describe('🚨 o painel de eventos crus diz ATÉ ONDE olhou', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    const rota = fs.readFileSync(path.join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = fs.readFileSync(path.join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');
    const bloco = rota.slice(rota.indexOf("router.get('/chamadas/eventos-crus'"));

    it('a resposta carrega a JANELA de tempo da amostra', () => {
        expect(bloco.slice(0, 2200)).toMatch(/janela: \{/);
        expect(bloco.slice(0, 2200)).toMatch(/de: snap\.docs\[snap\.size - 1\]/);
    });

    it('e a tela MOSTRA a janela, com a ressalva quando não achou nada', () => {
        expect(tela).toMatch(/crus\.janela\?\.de/);
        expect(tela).toMatch(/este zero não responde nada/);
    });

    it('a amostra alcança mais que uma manhã movimentada', () => {
        // 200 numa caixa de 300 conversas não chega em 09:30 depois do almoço.
        expect(bloco.slice(0, 2200)).toMatch(/\.limit\(1000\)/);
    });
});

// ============================================================================
// 🚨 PERMISSÃO NÃO É LIGAÇÃO — o painel respondia a pergunta ERRADA
//
// 26/08, print do Paulo depois do teste de ligação: o painel achou **4
// eventos de chamada** na janela que cobre 09:30. Os quatro eram
// `call_permission_reply` — o "Permitir" do cliente. Quem abre o painel para
// saber se a LIGAÇÃO chegou lê o 4 e conclui que sim.
//
// ⚠️ E a distinção não é cosmética: em modo SIP a Meta NÃO manda evento de
// chamada no webhook (medido em 25/08). Este painel é INCAPAZ de responder "a
// ligação chegou?" — e o certo é ele dizer isso, em vez de deixar um número
// responder por ele. Quem responde é o INVITE/CDR do tronco.
// ============================================================================
describe('🚨 o painel separa permissão de chamada', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs2 = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path2 = require('path') as typeof import('path');
    const tela = fs2.readFileSync(path2.join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');

    it('a natureza distingue permissão, chamada e pedido de retorno', () => {
        expect(naturezaDoEventoCru({ field: 'call_permission_reply' })).toBe('permissao');
        expect(naturezaDoEventoCru({ field: 'call_permission_request' })).toBe('permissao');
        expect(naturezaDoEventoCru({ field: 'calls' })).toBe('chamada');
        expect(naturezaDoEventoCru({ algo: 'callback_request' })).toBe('pedido-de-retorno');
    });

    it('🚨 o "Permitir" do cliente NÃO conta como ligação', () => {
        // Era exatamente esse o payload dos 4 achados do print.
        expect(naturezaDoEventoCru({ field: 'call_permission_reply' })).not.toBe('chamada');
    });

    it('payload ilegível não vira "chamada" por descuido', () => {
        const circular: any = {}; circular.eu = circular;
        expect(naturezaDoEventoCru(circular)).toBe('ilegivel');
    });

    it('🚨 e a tela DIZ que este painel não responde "a ligação chegou?"', () => {
        expect(tela).toMatch(/de PERMISSÃO/);
        expect(tela).toMatch(/não responde "a ligação chegou\?"/);
        expect(tela).toMatch(/INVITE\/CDR do tronco/);
    });
});
