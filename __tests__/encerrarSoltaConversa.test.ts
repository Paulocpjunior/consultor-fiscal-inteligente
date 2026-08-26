// ============================================================================
// 🚨 ENCERRAR TEM QUE SIGNIFICAR A MESMA COISA NOS DOIS LADOS (Paulo, 25/08)
//
// O teste dele: encerrou o atendimento, deu a nota, mandou "bom dia" — *"e
// nada aconteceu, não recebi nada"*.
//
// A causa eram DUAS respostas para o MESMO fato ("o atendimento acabou"):
//  · cliente encerra pelo `#sair` → o bot fazia `resetarTriagem`, limpando a
//    FILA (mas deixando o DONO);
//  · atendente encerra pelo ✅ → NÃO limpava nada.
//
// E o galho da triagem só roda com a conversa SEM fila e SEM dono. Com a fila
// do atendimento anterior grudada, a mensagem seguinte não virava menu, nem
// triagem, nem IA: do lado do cliente, ele escreveu e ninguém respondeu.
//
// 🚨 E o selo se contradizia: "✅ resolvida" com o contador de NÃO LIDAS
// subindo, na mesma linha. Conversa que recebeu mensagem não está resolvida.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import { decidirAutomacao, configPadraoAtendimento, resolverConfig } from '../sefaz-backend/whatsapp-atendimento';

const raiz = (...p: string[]) => path.join(process.cwd(), ...p);
const rotas = fs.readFileSync(raiz('sefaz-backend/whatsapp-routes.js'), 'utf8');
const webhook = fs.readFileSync(raiz('sefaz-backend/whatsapp-webhook-routes.js'), 'utf8');

const CONFIG = resolverConfig({ ...configPadraoAtendimento(), botAtivo: true, botAlcance: 'todos' });
const base = {
    numero: '5511999999999', nomeContato: 'Fulano', config: CONFIG,
    agora: new Date('2026-08-25T10:00:00-03:00'), protocoloNovo: 'P1',
};

describe('🚨 os dois caminhos de encerrar chegam ao MESMO estado', () => {
    it('o #sair do CLIENTE limpa a fila E solta a condução', () => {
        const acoes = decidirAutomacao({ ...base, conversa: { fila: 'fiscal', atribuidoA: 'ana@sp.com.br' }, textoMensagem: '#sair' });
        const tipos = acoes.map((a: { tipo: string }) => a.tipo);
        expect(tipos).toContain('resetarTriagem');
        expect(tipos).toContain('liberarConducao');   // era o que faltava
        expect(tipos).toContain('resolverConversa');
    });

    it('o ✅ do ATENDENTE limpa fila, dono e sub-menu', () => {
        const trecho = rotas.slice(rotas.indexOf("router.post('/conversas/:numero/situacao'"));
        expect(trecho.slice(0, 2600)).toMatch(/s === 'resolvida' \? \{ fila: null, atribuidoA: null, submenuAberto: null \}/);
    });
});

describe('🚨 e o cliente que VOLTA é atendimento novo', () => {
    it('conversa solta + texto livre com a IA certa = encaminha', () => {
        const acoes = decidirAutomacao({
            ...base, conversa: {},   // como fica depois de encerrar
            textoMensagem: 'preciso da guia do INSS',
            filaSugerida: { fila: 'dp-folha', rotulo: 'DP', confianca: 0.9 },
        });
        expect(acoes.map((a: { tipo: string }) => a.tipo)).toContain('definirFila');
    });

    it('e sem a IA ele ao menos recebe o MENU — nunca silêncio', () => {
        // Era esse o sintoma: o cliente escreveu e o app não respondeu NADA.
        const acoes = decidirAutomacao({ ...base, conversa: {}, textoMensagem: 'bom dia', filaSugerida: null });
        expect(acoes.some((a: any) => a.tipo === 'responder' && /Digite uma das seguintes/.test(a.texto))).toBe(true);
    });

    it('🚨 com a FILA grudada do atendimento anterior, o bot fica MUDO', () => {
        // A prova do defeito: é exatamente o estado em que a conversa dele
        // ficou depois do ✅ Encerrar.
        const acoes = decidirAutomacao({ ...base, conversa: { fila: 'recepcao' }, textoMensagem: 'bom dia' });
        expect(acoes.map((a: { tipo: string }) => a.tipo)).not.toContain('responder');
    });
});

describe('🚨 a conversa JÁ ENCERRADA se solta ao receber mensagem', () => {
    // O ✅ Encerrar limpar fila/dono só vale para quem encerrar DAQUI PRA
    // FRENTE. Toda conversa fechada ANTES da correção ficou com a fila e o
    // dono grudados — e o galho da triagem só roda sem fila e sem dono. Sem
    // esta metade, a carteira inteira ficaria muda para sempre: o defeito que
    // a correção existe para fechar, vivo em todo mundo já atendido uma vez.
    const trecho = webhook.slice(webhook.indexOf('async function gravarMensagemRecebida')).slice(0, 5000);

    it('resolvida + mensagem nova = fila, dono e sub-menu limpos', () => {
        expect(trecho).toMatch(/eraResolvida \? \{ fila: null, atribuidoA: null, submenuAberto: null \}/);
    });

    it('🚨 e a leitura vem ANTES da escrita — senão a prova já foi apagada', () => {
        // `status: 'aberta'` é escrito nesta mesma chamada. Ler depois
        // devolveria 'aberta' sempre e a regra nunca dispararia.
        expect(trecho.indexOf('const eraResolvida')).toBeLessThan(trecho.indexOf("status: 'aberta'"));
        expect(trecho).toMatch(/eraResolvida = \(\(await convRef\.get\(\)\)\.data\(\) \|\| \{\}\)\.status === 'resolvida'/);
    });

    it('⚠️ conversa ABERTA não perde o dono — atendimento em andamento continua na mesa', () => {
        // Limpar aqui tiraria de quem está atendendo a conversa que ele está
        // atendendo, a cada mensagem que o cliente mandasse.
        expect(trecho).not.toMatch(/atribuidoA: null,?\s*\n?\s*submenuAberto: null \}\)?\s*,?\s*\n\s*\.\.\./);
        expect(trecho.match(/atribuidoA: null/g) || []).toHaveLength(1);
    });
});

describe('🚨 o selo não pode contradizer o contador', () => {
    it('mensagem do cliente REABRE a conversa', () => {
        const trecho = webhook.slice(webhook.indexOf('async function gravarMensagemRecebida'));
        expect(trecho.slice(0, 5000)).toMatch(/status: 'aberta'/);
    });

    it('⚠️ MENOS a resposta da PESQUISA — ela é a última linha do que fechou', () => {
        // Reabrir por causa da nota devolveria à mesa da equipe uma conversa
        // que fechou certinho, toda vez que alguém avaliasse.
        const trecho = webhook.slice(webhook.indexOf('async function capturarAvaliacao'));
        expect(trecho.slice(0, 3200)).toMatch(/status: 'resolvida'/);
    });

    it('e `resolvidaPor` NÃO é apagado — quem fechou o anterior é histórico', () => {
        const trecho = webhook.slice(webhook.indexOf('async function gravarMensagemRecebida'));
        expect(trecho.slice(0, 5000)).not.toMatch(/resolvidaPor: null/);
    });
});
