/**
 * 🔔 Aviso NATIVO do Teams (Paulo, 23/08: "ativar popup de notificacoes e
 * audio de msg" dentro do Teams — o webview não deixa a página mostrar popup;
 * quem mostra é o PRÓPRIO Teams, via Graph sendActivityNotification).
 *
 * O que fica travado:
 *  · a AUDIÊNCIA é a MESMA do push (uma régua, vetoDoAviso) — Teams e celular
 *    não podem avisar pessoas diferentes da mesma mensagem;
 *  · a recusa do Graph volta NOMEADA (etapa) e o app-não-instalado não é
 *    engolido;
 *  · o GUID do manifest NUNCA muda, e o ZIP não pode envelhecer em silêncio
 *    (ele é o que o Paulo sobe no Teams — manifest novo com zip velho é a
 *    entrega que parece feita e não foi).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { destinatariosDoAvisoTeams, destinatariosDoPush } from '../sefaz-backend/whatsapp-push';
import {
    enviarAvisoTeams, statusAvisoTeams, TEAMS_APP_EXTERNAL_ID, ACTIVITY_TYPE_MENSAGEM, _internals,
} from '../sefaz-backend/teams-aviso';

const usuario = (extra: Record<string, unknown> = {}) => ({
    uid: 'u1', email: 'ana@spassessoriacontabil.com.br', role: 'colaborador',
    papelAtendimento: null, departamentos: [], filasAtendimento: ['recepcao'],
    prefs: {}, tokens: [], ...extra,
});
const conversa = { fila: 'recepcao' };

describe('🔔 destinatariosDoAvisoTeams — mesma régua do push, outra porta', () => {
    it('quem NÃO registrou celular ainda recebe no Teams (o endereço é o e-mail)', () => {
        const r = destinatariosDoAvisoTeams({ usuarios: [usuario()], conversa });
        expect(r.alvos).toEqual([{ uid: 'u1', email: 'ana@spassessoriacontabil.com.br' }]);
        // ...enquanto o push FCM exclui o mesmo usuário por falta de token:
        expect(destinatariosDoPush({ usuarios: [usuario()], conversa }).alvos).toHaveLength(0);
    });

    it('opt-out próprio (prefs.avisoTeams=false) e falta de e-mail saem NOMEADOS', () => {
        const r = destinatariosDoAvisoTeams({
            usuarios: [usuario({ prefs: { avisoTeams: false } }), usuario({ uid: 'u2', email: null })],
            conversa,
        });
        expect(r.alvos).toHaveLength(0);
        expect(r.fora.map((f) => f.motivo).join(' ')).toMatch(/desligado por ele/);
        expect(r.fora.map((f) => f.motivo).join(' ')).toMatch(/sem e-mail/);
    });

    it('🚨 as regras de AUDIÊNCIA são as mesmas do push: fila, autor e 📷 vetam igual', () => {
        const cfgIg = { instagramAtendentes: ['so.ela@spassessoriacontabil.com.br'] };
        const casos = [
            { u: usuario({ filasAtendimento: ['fiscal'] }), c: { fila: 'dp' }, motivo: /fila que ele não atende/ },
            { u: usuario(), c: conversa, autor: 'ana@spassessoriacontabil.com.br', motivo: /autor da mensagem/ },
            { u: usuario(), c: { fila: 'recepcao', canal: 'instagram' }, cfg: cfgIg, motivo: /lista restrita/ },
        ];
        for (const caso of casos) {
            const r = destinatariosDoAvisoTeams({
                usuarios: [caso.u], conversa: caso.c,
                autorDaMensagem: caso.autor || null, config: (caso.cfg as never) || null,
            });
            expect(r.alvos).toHaveLength(0);
            expect(r.fora[0].motivo).toMatch(caso.motivo);
        }
    });

    it('fora do expediente é opt-in, como no push', () => {
        const config = { horario: { dias: [1], turnos: [{ inicio: '08:00', fim: '09:00' }] } };
        const sabado = new Date('2026-08-23T18:00:00-03:00'); // sábado — fora da grade (dias: [segunda])
        const r = destinatariosDoAvisoTeams({ usuarios: [usuario()], conversa, config: config as never, agora: sabado });
        expect(r.alvos).toHaveLength(0);
        expect(r.fora[0].motivo).toContain('fora do expediente');
    });
});

describe('enviarAvisoTeams — a recusa volta NOMEADA', () => {
    const fetchFake = (respostas: Record<string, { status: number; corpo: unknown }>) =>
        (async (url: string) => {
            const hit = Object.entries(respostas).find(([k]) => String(url).includes(k));
            if (!hit) throw new Error(`URL inesperada no teste: ${url}`);
            return { status: hit[1].status, json: async () => hit[1].corpo } as never;
        }) as never;

    beforeEach(() => _internals.cache.clear());

    it('caminho feliz: users → installedApps → 204', async () => {
        const r = await enviarAvisoTeams(
            { email: 'ana@spassessoriacontabil.com.br', titulo: '💬 Teste', corpo: 'oi' },
            {
                configurado: true, token: 't',
                fetch: fetchFake({
                    '/users/ana%40spassessoriacontabil.com.br': { status: 200, corpo: { id: 'aad-1' } },
                    'installedApps?': { status: 200, corpo: { value: [{ id: 'inst-9' }] } },
                    'sendActivityNotification': { status: 204, corpo: {} },
                }),
            },
        );
        expect(r).toEqual({ ok: true });
    });

    it('🚨 app não instalado no Teams da pessoa não é engolido — volta com a ação', async () => {
        const r = await enviarAvisoTeams(
            { email: 'ana@spassessoriacontabil.com.br' },
            {
                configurado: true, token: 't',
                fetch: fetchFake({
                    'installedApps?': { status: 200, corpo: { value: [] } },
                    '/users/': { status: 200, corpo: { id: 'aad-1' } },
                }),
            },
        );
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.etapa).toBe('app-nao-instalado');
            expect(r.erro).toMatch(/instale/i);
        }
    });

    it('recusa do Graph (ex.: consent faltando) volta CRUA, com a etapa', async () => {
        const r = await enviarAvisoTeams(
            { email: 'ana@spassessoriacontabil.com.br' },
            {
                configurado: true, token: 't',
                fetch: fetchFake({
                    'sendActivityNotification': { status: 403, corpo: { error: { message: 'Missing role permissions on the request. API requires TeamsActivity.Send' } } },
                    'installedApps?': { status: 200, corpo: { value: [{ id: 'inst-9' }] } },
                    '/users/': { status: 200, corpo: { id: 'aad-1' } },
                }),
            },
        );
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.etapa).toBe('envio');
            expect(r.erro).toContain('TeamsActivity.Send');
        }
    });

    it('🔁 "insufficient privileges" com token cacheado RENOVA o token e tenta de novo (consent recém-dado no Azure)', async () => {
        const invalidou = jest.fn();
        const fetchPorToken = (async (url: string, opts: { headers: Record<string, string> }) => {
            const token = String(opts?.headers?.Authorization || '');
            if (String(url).includes('installedApps?')) return { status: 200, json: async () => ({ value: [{ id: 'inst-9' }] }) };
            if (String(url).includes('/users/')) {
                if (String(url).includes('sendActivityNotification')) {
                    // token velho (do cache) leva a recusa de permissão; o novo passa
                    return token.includes('t-velho')
                        ? { status: 403, json: async () => ({ error: { message: 'Insufficient privileges to complete the operation.' } }) }
                        : { status: 204, json: async () => ({}) };
                }
                return { status: 200, json: async () => ({ id: 'aad-1' }) };
            }
            throw new Error(`URL inesperada: ${url}`);
        }) as never;
        const r = await enviarAvisoTeams(
            { email: 'ana@spassessoriacontabil.com.br' },
            { configurado: true, token: 't-velho', tokenNovo: 't-novo', invalidarToken: invalidou, fetch: fetchPorToken },
        );
        expect(r).toEqual({ ok: true });
        expect(invalidou).toHaveBeenCalled();
    });

    it('Graph não configurado é dito, nunca tentado', async () => {
        const r = await enviarAvisoTeams({ email: 'x@y.br' }, { configurado: false });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.etapa).toBe('graph-nao-configurado');
    });

    it('statusAvisoTeams diz os pré-requisitos e o clientId (identificador público, não segredo)', () => {
        const s = statusAvisoTeams({ GRAPH_CLIENT_ID: 'cid', GRAPH_TENANT_ID: 'tid', GRAPH_CLIENT_SECRET: 's' });
        expect(s).toEqual({ graphConfigurado: true, clientId: 'cid', teamsAppId: TEAMS_APP_EXTERNAL_ID });
        expect(statusAvisoTeams({}).graphConfigurado).toBe(false);
    });
});

describe('📦 manifest do Teams — o pacote acompanha o código', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'teams-app/manifest.json'), 'utf8'));

    it('🚨 o GUID NUNCA muda entre versões (usuários acham o app por ele; o Graph acha a instalação por ele)', () => {
        expect(manifest.id).toBe(TEAMS_APP_EXTERNAL_ID);
    });

    it('as activities existem com o MESMO type que o backend envia', () => {
        const tipos = (manifest.activities?.activityTypes || []).map((a: { type: string }) => a.type);
        expect(tipos).toContain(ACTIVITY_TYPE_MENSAGEM);
        const atividade = manifest.activities.activityTypes.find((a: { type: string }) => a.type === ACTIVITY_TYPE_MENSAGEM);
        // O backend manda templateParameters [{name:'resumo'}] — o template tem que usá-lo.
        expect(atividade.templateText).toContain('{resumo}');
    });

    it('🚨 o ZIP servido em /sp-connect-teams.zip carrega ESTE manifest — zip velho é entrega que parece feita', () => {
        const doZip = execFileSync('unzip', ['-p', join(__dirname, '..', 'public/sp-connect-teams.zip'), 'manifest.json']).toString();
        expect(JSON.parse(doZip)).toEqual(manifest);
    });
});

describe('🔌 fiação', () => {
    const fs = require('fs');
    const path = require('path');

    it('notificarMensagem só chama o Teams com a chave ligada, e ANTES do early-return do FCM', () => {
        const envio = fs.readFileSync(path.join(__dirname, '..', 'sefaz-backend/whatsapp-push-envio.js'), 'utf8');
        expect(envio).toContain('destinatariosDoAvisoTeams');
        expect(envio).toMatch(/config\?\.avisoTeamsAtivo/);
        // Quem não registrou celular ainda pode ter o Teams aberto: o bloco do
        // Teams vem antes do `if (!alvos.length) return` do FCM.
        expect(envio.indexOf('destinatariosDoAvisoTeams({ usuarios')).toBeLessThan(envio.indexOf('if (!alvos.length) return'));
    });

    it('🚨 a rota de teste só avisa o PRÓPRIO usuário logado — não aceita destinatário do body', () => {
        const rotas = fs.readFileSync(path.join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');
        const i = rotas.indexOf("'/teams-aviso/testar'");
        expect(i).toBeGreaterThan(-1);
        const trecho = rotas.slice(i, i + 1200);
        expect(rotas.slice(i - 120, i + 60)).toMatch(/router\.post\('\/teams-aviso\/testar',\s*requireAuth/);
        expect(trecho).toContain('req.user?.email');
        expect(trecho).not.toContain('req.body');
    });

    it('🚨 a chave nasce LIGADA (Paulo, 23/08: "OS ALERTAS NASCEM LIGADOS SEMPRE") e a ⚙️ tem o teste', () => {
        const { configPadraoAtendimento, resolverConfig } = require('../sefaz-backend/whatsapp-atendimento');
        expect(configPadraoAtendimento().avisoTeamsAtivo).toBe(true);
        // Config gravada ANTES do campo existir também fica ligada (o merge
        // cai no padrão) — e quem desligar de propósito é respeitado.
        expect(resolverConfig({}).avisoTeamsAtivo).toBe(true);
        expect(resolverConfig({ avisoTeamsAtivo: false }).avisoTeamsAtivo).toBe(false);
        const tela = fs.readFileSync(path.join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');
        expect(tela).toContain('Testar no meu Teams');
        expect(tela).toContain('alternarAvisoTeams');
    });
});
