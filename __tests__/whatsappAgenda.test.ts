// ============================================================================
// ⏰ MENSAGEM AGENDADA E FOLLOW-UP (29/09) — item 2 da comparação com o Clerk
// Chat (Paulo: "Concordo, vamos implementar 1, 2 e 3").
//
// O que se prova: a validação do pedido (hora no futuro, teto, follow-up em
// horas), a DECISÃO do tick (esperar / enviar / dispensar / falhar) com o
// relógio por parâmetro, as notas que a conversa mostra, e a fiação (rotas,
// tick, guarda de condução, cron no setup do Scheduler, tela).
// ============================================================================
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
    validarAgendamento, decidirAgendamento, janelaAberta, idDoAgendamento, notaDoAgendamento, notaDoDesfecho,
    resumoDoAgendamento, formatarQuando, MAX_DIAS_AGENDAMENTO, MAX_HORAS_FOLLOW_UP, LOTE_TICK_AGENDA,
} from '../sefaz-backend/whatsapp-agenda.js';

const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');
// 🕒 Relógio PINADO: nada aqui lê a hora da máquina.
const AGORA = new Date('2026-09-29T12:00:00.000Z');
const daqui = (h: number) => new Date(AGORA.getTime() + h * 3600_000).toISOString();

describe('validarAgendamento — o pedido vira documento, ou recusa nomeada', () => {
    it('mensagem para daqui a 2 h: id determinístico, status agendado, criadoPor', () => {
        const r = validarAgendamento({ conversaId: '5511999990000', texto: 'Bom dia! Segue a guia.', enviarEm: daqui(2), agora: AGORA, criadoPor: 'ana@sp.com' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.agendamento).toMatchObject({
            id: 'ag_5511999990000_202609291400', conversaId: '5511999990000', tipo: 'mensagem', status: 'agendado',
            enviarEm: '2026-09-29T14:00:00.000Z', criadoEm: AGORA.toISOString(), criadoPor: 'ana@sp.com', aposHoras: null, tentativas: 0,
        });
        expect(idDoAgendamento('5511999990000', '2026-09-29T14:00:00.000Z')).toBe('ag_5511999990000_202609291400');
    });

    it('follow-up de 24 h: enviarEm = agora + 24 h, aposHoras guardado', () => {
        const r = validarAgendamento({ conversaId: '5511999990000', texto: 'Conseguiu ver?', tipo: 'follow-up', aposHoras: 24, agora: AGORA });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.agendamento.enviarEm).toBe(daqui(24));
        expect(r.agendamento.aposHoras).toBe(24);
    });

    it('recusa: sem texto, hora passada/agora, além do teto, follow-up fora de 1..336 h, tipo torto', () => {
        const base = { conversaId: '5511999990000', texto: 'x', agora: AGORA };
        expect(validarAgendamento({ ...base, texto: '  ', enviarEm: daqui(1) }).ok).toBe(false);
        expect(validarAgendamento({ ...base, enviarEm: daqui(-1) }).ok).toBe(false);
        expect(validarAgendamento({ ...base, enviarEm: AGORA.toISOString() }).ok).toBe(false);
        expect(validarAgendamento({ ...base, enviarEm: daqui((MAX_DIAS_AGENDAMENTO + 1) * 24) }).ok).toBe(false);
        expect(validarAgendamento({ ...base, enviarEm: 'amanhã' }).ok).toBe(false);
        expect(validarAgendamento({ ...base, tipo: 'follow-up', aposHoras: 0 }).ok).toBe(false);
        expect(validarAgendamento({ ...base, tipo: 'follow-up', aposHoras: MAX_HORAS_FOLLOW_UP + 1 }).ok).toBe(false);
        expect(validarAgendamento({ ...base, tipo: 'follow-up', aposHoras: 1.5 }).ok).toBe(false);
        expect(validarAgendamento({ ...base, tipo: 'lembrete' as any, enviarEm: daqui(1) }).ok).toBe(false);
        expect(validarAgendamento({ ...base, texto: 'a'.repeat(4097), enviarEm: daqui(1) }).ok).toBe(false);
    });
});

describe('decidirAgendamento — o tick decide, e a régua da Meta manda', () => {
    const ag = (over: Record<string, unknown> = {}): any => ({
        id: 'ag_x', conversaId: '5511999990000', tipo: 'mensagem', texto: 'oi', enviarEm: daqui(-0.1), status: 'agendado', criadoEm: daqui(-5), ...over,
    });
    const conversaAberta = { janela24hAte: daqui(3), status: 'aberta', ultimaMensagem: { direcao: 'entrada', em: daqui(-10) } };

    it('ainda não é hora ⇒ esperar; já saiu/cancelado ⇒ nada', () => {
        expect(decidirAgendamento(ag({ enviarEm: daqui(1) }), conversaAberta, AGORA).acao).toBe('esperar');
        expect(decidirAgendamento(ag({ status: 'enviado' }), conversaAberta, AGORA).acao).toBe('nada');
        expect(decidirAgendamento(null, conversaAberta, AGORA).acao).toBe('nada');
    });

    it('na hora, janela aberta ⇒ enviar', () => {
        expect(decidirAgendamento(ag(), conversaAberta, AGORA).acao).toBe('enviar');
        expect(janelaAberta(conversaAberta, AGORA)).toBe(true);
    });

    it('🚨 janela de 24h fechada ⇒ FALHAR nomeado — texto livre não vira template por dedução', () => {
        const d = decidirAgendamento(ag(), { ...conversaAberta, janela24hAte: daqui(-1) }, AGORA);
        expect(d.acao).toBe('falhar');
        expect(d.motivo).toBe('janela-fechada');
        expect(d.detalhe).toMatch(/template/);
        expect(decidirAgendamento(ag(), { status: 'aberta' }, AGORA).acao).toBe('falhar');   // sem janela nenhuma
    });

    it('🚨 follow-up: cliente respondeu DEPOIS do pedido ⇒ dispensar (não se cobra quem respondeu)', () => {
        const d = decidirAgendamento(ag({ tipo: 'follow-up', criadoEm: daqui(-5) }), { ...conversaAberta, ultimaMensagem: { direcao: 'entrada', em: daqui(-2) } }, AGORA);
        expect(d).toEqual({ acao: 'dispensar', motivo: 'cliente-respondeu' });
        // Resposta ANTES do pedido não conta; a última sendo NOSSA não conta.
        expect(decidirAgendamento(ag({ tipo: 'follow-up', criadoEm: daqui(-5) }), { ...conversaAberta, ultimaMensagem: { direcao: 'entrada', em: daqui(-8) } }, AGORA).acao).toBe('enviar');
        expect(decidirAgendamento(ag({ tipo: 'follow-up', criadoEm: daqui(-5) }), { ...conversaAberta, ultimaMensagem: { direcao: 'saida', em: daqui(-2) } }, AGORA).acao).toBe('enviar');
    });

    it('follow-up de conversa ENCERRADA é dispensado; mensagem comum não olha o status', () => {
        expect(decidirAgendamento(ag({ tipo: 'follow-up' }), { ...conversaAberta, status: 'resolvida' }, AGORA)).toEqual({ acao: 'dispensar', motivo: 'conversa-encerrada' });
        expect(decidirAgendamento(ag(), { ...conversaAberta, status: 'resolvida' }, AGORA).acao).toBe('enviar');
    });
});

describe('as notas que a conversa mostra — em hora de São Paulo, por parâmetro', () => {
    it('formatarQuando usa o fuso passado (nunca o da máquina)', () => {
        expect(formatarQuando('2026-09-29T14:00:00.000Z', 'America/Sao_Paulo')).toBe('29/09 11:00');
        expect(formatarQuando('2026-09-29T14:00:00.000Z', 'UTC')).toBe('29/09 14:00');
        expect(formatarQuando('lixo')).toBe('?');
    });

    it('a nota de agendamento diz quem, quando e o começo do texto; a de desfecho diz o motivo', () => {
        const ag: any = { tipo: 'mensagem', texto: 'Segue a guia do DAS', enviarEm: '2026-09-29T14:00:00.000Z', criadoPor: 'ana@sp.com', aposHoras: null };
        expect(notaDoAgendamento(ag, 'America/Sao_Paulo')).toBe('⏰ Mensagem agendada por ana para 29/09 11:00: "Segue a guia do DAS"');
        expect(notaDoAgendamento({ ...ag, tipo: 'follow-up', aposHoras: 24 }, 'America/Sao_Paulo')).toMatch(/Follow-up agendado por ana: se o cliente não responder até 29\/09 11:00 \(24 h\)/);
        expect(notaDoDesfecho(ag, { acao: 'dispensar', motivo: 'cliente-respondeu' }, 'America/Sao_Paulo')).toMatch(/dispensado: o cliente respondeu antes/);
        expect(notaDoDesfecho(ag, { acao: 'falhar', motivo: 'janela-fechada', detalhe: 'A janela fechou' }, 'America/Sao_Paulo')).toMatch(/NÃO saiu: A janela fechou/);
    });

    it('resumoDoAgendamento não vaza campo interno', () => {
        const r = resumoDoAgendamento({ id: 'a', tipo: 'mensagem', texto: 't', enviarEm: 'x', status: 'agendado', messageId: 'segredo', criadoPor: 'p' } as any);
        expect(r).not.toHaveProperty('messageId');
        expect(r).toMatchObject({ id: 'a', status: 'agendado', criadoPor: 'p', aposHoras: null });
    });
});

describe('🚨 fiação — agendamento sem tick é promessa que ninguém cumpre', () => {
    const rotas = ler('sefaz-backend/whatsapp-routes.js');
    const tela = ler('components/SpConnect/index.tsx');
    const servico = ler('services/spConnectService.ts');

    it('as rotas existem: criar (com guarda de condução), listar, cancelar, e o tick com x-cron-secret OU admin', () => {
        expect(rotas).toMatch(/router\.post\('\/conversas\/:numero\/agendamentos', requireAuth/);
        expect(rotas).toMatch(/router\.get\('\/conversas\/:numero\/agendamentos', requireAuth/);
        expect(rotas).toMatch(/router\.delete\('\/conversas\/:numero\/agendamentos\/:id', requireAuth/);
        expect(rotas).toMatch(/router\.post\('\/agenda\/tick', requireCronOuAdmin/);
        const guarda = rotas.slice(rotas.indexOf("async function requireCronOuAdmin"), rotas.indexOf("router.post('/agenda/tick'"));
        expect(guarda).toMatch(/secretsMatch\(header, process\.env\.SEFAZ_CRON_SECRET\)/);
        expect(guarda).toMatch(/requireAdmin\(req, res, next\)/);
        // Agendar numa conversa de outro é a segunda voz com hora marcada.
        const criar = rotas.slice(rotas.indexOf("router.post('/conversas/:numero/agendamentos'"), rotas.indexOf("router.get('/conversas/:numero/agendamentos'"));
        expect(criar).toMatch(/emConducaoPor: dono/);
        expect(criar).toMatch(/notaDoAgendamento\(ag\)/);
    });

    it('o tick usa a DECISÃO do núcleo, grava o desfecho e deixa nota na conversa quando não envia', () => {
        const exec = rotas.slice(rotas.indexOf('async function executarAgendamento'), rotas.indexOf('async function tickAgenda'));
        expect(exec).toMatch(/decidirAgendamento\(ag, conversa, agora\)/);
        expect(exec).toMatch(/notaDoDesfecho\(ag, decisao\)/);
        expect(exec).toMatch(/enviarTextoLivre\(\{ para: ag\.conversaId, texto: ag\.texto \}/);
        expect(exec).toMatch(/status: 'enviado', enviadoEm: em, messageId: envio\.messageId/);
        // A mensagem enviada entra na thread como saída, assinada por quem agendou.
        expect(exec).toMatch(/enviadoPor: ag\.criadoPor \|\| null, agendamentoId: ag\.id/);
        const tick = rotas.slice(rotas.indexOf('async function tickAgenda'), rotas.indexOf('// ═══ 📣 CAMPANHAS EM LOTE'));
        // 🐛 03/10: a consulta tinha where+where+orderBy e pedia índice composto
        // (FAILED_PRECONDITION em produção; o tick nunca rodava). Agora é UMA
        // igualdade e o vencimento é decidido em memória — regra da casa.
        expect(tick).toMatch(/where\('status', '==', 'agendado'\)\.limit\(/);
        expect(tick).not.toMatch(/where\('enviarEm'/);
        expect(tick).not.toMatch(/orderBy\('enviarEm'/);
        expect(tick).toMatch(/enviarEm \|\| ''\) <= limite/);
        expect(LOTE_TICK_AGENDA).toBeGreaterThan(0);
    });

    it('🕒 o job do Cloud Scheduler existe no setup (sem ele nada sai sozinho) — e a ⚙️ diz quando ele está parado', () => {
        // O job mora no repo que tem o setup do Scheduler (o CFI, até a F3 da
        // separação — o tick bate no serviço que está no ar). No sp-connect o
        // arquivo não existe, e a trava cobra o resto.
        if (existsSync(join(raiz, 'scripts/setup-cloud-schedulers.sh'))) {
            const setup = ler('scripts/setup-cloud-schedulers.sh');
            expect(setup).toMatch(/"connect-agenda-tick"/);
            expect(setup).toMatch(/\/api\/admin\/whatsapp\/agenda\/tick/);
        }
        expect(rotas).toMatch(/router\.get\('\/agenda\/estado', requireAuth/);
        expect(tela).toMatch(/Tick PARADO/);
        expect(tela).toMatch(/O tick NUNCA rodou/);
    });

    it('a tela: botão ⏰ no compositor, painel com mensagem × follow-up, lista de agendados com cancelar', () => {
        expect(tela).toMatch(/onClick=\{abrirAgenda\}/);
        expect(tela).toMatch(/setAgendaTipo\('follow-up'\)/);
        expect(tela).toMatch(/type="datetime-local"/);
        expect(tela).toMatch(/acaoCancelarAgendamento\(a\.id\)/);
        // A régua da Meta está escrita onde a pessoa agenda, não escondida.
        expect(tela).toMatch(/janela de 24h precisa estar aberta na hora/);
        expect(servico).toMatch(/export const agendarMensagem/);
        expect(servico).toMatch(/export const cancelarAgendamento/);
    });
});
