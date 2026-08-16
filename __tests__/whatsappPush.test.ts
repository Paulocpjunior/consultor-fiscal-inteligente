// ============================================================================
// Push no celular — a última bloqueante do corte. O ponto fino não é enviar:
// é QUEM recebe. Push que ignora a fila vaza conversa de cliente pra quem o
// próprio inbox esconde.
// ============================================================================
import {
    destinatariosDoPush, montarPushMensagem, registrarToken, tokenMorreu,
} from '../sefaz-backend/whatsapp-push.js';
import { configPadraoAtendimento } from '../sefaz-backend/whatsapp-atendimento.js';

const base = { tokens: ['tk1'], prefs: {}, departamentos: [], filasAtendimento: [] };
const fiscal = { uid: 'u1', email: 'fis@sp', role: 'colaborador', ...base, filasAtendimento: ['fiscal'] };
const juridico = { uid: 'u2', email: 'jur@sp', role: 'colaborador', ...base, filasAtendimento: ['juridico'] };
const recepcao = { uid: 'u3', email: 'rec@sp', role: 'colaborador', ...base, filasAtendimento: ['recepcao'] };
const DENTRO = new Date('2026-08-17T09:00:00-03:00');   // segunda, 9h
const NOITE = new Date('2026-08-17T23:00:00-03:00');

describe('quem recebe — a MESMA régua de fila do inbox', () => {
    it('conversa do Fiscal vai pro Fiscal e pra Recepção; o Jurídico NÃO recebe', () => {
        const r = destinatariosDoPush({
            usuarios: [fiscal, juridico, recepcao],
            conversa: { fila: 'fiscal' },
            config: configPadraoAtendimento(), agora: DENTRO,
        });
        expect(r.alvos.map((a: any) => a.uid).sort()).toEqual(['u1', 'u3']);
        expect(r.fora[0]).toMatchObject({ uid: 'u2' });
        expect(r.fora[0].motivo).toContain('fila que ele não atende');
    });

    it('conversa SEM fila (Recepção) alcança todo mundo que atende', () => {
        const r = destinatariosDoPush({
            usuarios: [fiscal, juridico, recepcao], conversa: { fila: null },
            config: configPadraoAtendimento(), agora: DENTRO,
        });
        expect(r.alvos).toHaveLength(3);
    });

    it('ninguém recebe push da PRÓPRIA mensagem', () => {
        const r = destinatariosDoPush({
            usuarios: [fiscal], conversa: { fila: 'fiscal' }, autorDaMensagem: 'fis@sp',
            config: configPadraoAtendimento(), agora: DENTRO,
        });
        expect(r.alvos).toHaveLength(0);
        expect(r.fora[0].motivo).toContain('autor');
    });

    it('sem celular registrado ou com push desligado por ele: fora, e o motivo fica NOMEADO', () => {
        const r = destinatariosDoPush({
            usuarios: [
                { ...fiscal, uid: 'a', tokens: [] },
                { ...fiscal, uid: 'b', prefs: { push: false } },
            ],
            conversa: { fila: 'fiscal' }, config: configPadraoAtendimento(), agora: DENTRO,
        });
        expect(r.alvos).toHaveLength(0);
        expect(r.fora.map((f: any) => f.motivo)).toEqual(['sem celular registrado', 'push desligado por ele']);
    });
});

describe('fora do expediente é OPT-IN', () => {
    it('à noite ninguém recebe por padrão — celular apitando de madrugada faz desligar TUDO', () => {
        const r = destinatariosDoPush({
            usuarios: [fiscal], conversa: { fila: 'fiscal' },
            config: configPadraoAtendimento(), agora: NOITE,
        });
        expect(r.noExpediente).toBe(false);
        expect(r.alvos).toHaveLength(0);
        expect(r.fora[0].motivo).toContain('fora do expediente');
    });

    it('quem LIGOU o 24h recebe', () => {
        const r = destinatariosDoPush({
            usuarios: [{ ...fiscal, prefs: { pushForaDoExpediente: true } }],
            conversa: { fila: 'fiscal' }, config: configPadraoAtendimento(), agora: NOITE,
        });
        expect(r.alvos).toHaveLength(1);
    });

    it('sem config de horário, não inventa restrição (avisa)', () => {
        const r = destinatariosDoPush({ usuarios: [fiscal], conversa: { fila: 'fiscal' }, agora: NOITE });
        expect(r.noExpediente).toBe(true);
        expect(r.alvos).toHaveLength(1);
    });
});

describe('conteúdo e tokens', () => {
    it('a prévia é CURTA — ela aparece na tela bloqueada do celular', () => {
        const m = montarPushMensagem({ nomeContato: 'Juliana', numero: '5511964440000', resumo: 'x'.repeat(300) });
        expect(m.titulo).toBe('💬 Juliana');
        expect(m.corpo).toHaveLength(100);
        expect(m.tag).toBe('spconnect-5511964440000');       // mesma conversa ATUALIZA
        expect(m.link).toContain('/connect?conversa=');
    });

    it('sem nome, o número; com 2º número, o canal no título', () => {
        const m = montarPushMensagem({ nomeContato: '', numero: '5511964440000', resumo: 'oi', canalRotulo: 'RH' });
        expect(m.titulo).toBe('💬 5511964440000 · RH');
    });

    it('token novo não duplica, fica em primeiro e a lista tem teto', () => {
        expect(registrarToken(['a', 'b'], 'c')).toEqual({ ok: true, tokens: ['c', 'a', 'b'] });
        expect(registrarToken(['a', 'b'], 'a')).toEqual({ ok: true, tokens: ['a', 'b'] });
        expect((registrarToken(['1', '2', '3'], 'novo', 2) as any).tokens).toEqual(['novo', '1']);
        expect(registrarToken(['a'], '  ').ok).toBe(false);
    });

    it('só token MORTO é apagado — falha de rede não tira o aviso de quem espera', () => {
        expect(tokenMorreu('messaging/registration-token-not-registered')).toBe(true);
        expect(tokenMorreu('messaging/server-unavailable')).toBe(false);
        expect(tokenMorreu(null)).toBe(false);
    });
});
