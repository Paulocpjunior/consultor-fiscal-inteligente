// ============================================================================
// 🚦 "TUDO VERDE E A LIGAÇÃO RECUSADA" — os interruptores que o painel não lia
// ----------------------------------------------------------------------------
// 25/08, 09:15 — DENTRO da janela (08:00–12:00), com o SBC provado de pé pelo
// 🔌 (TLS 1.2, certificado público, Asterisk respondendo SIP 200 OK), ícone
// visível e horário conferido: "SP Assessoria não pode receber ligações do
// WhatsApp".
//
// As duas hipóteses anteriores caíram — certificado (o 🔌 provou) e horário (o
// relógio provou). E o painel continuava verde.
//
// 🚨 PORQUE ELE OLHAVA A COISA ERRADA: a tela afirmava "✅ Tronco gravado na
// Meta" só porque `sip.servers[]` EXISTIA. Guardar o endereço do servidor NÃO
// é o SIP estar LIGADO — `calling.status` e `sip.status` são interruptores
// próprios, e NENHUM dos dois aparecia. A escrita manda `status: 'ENABLED'` e
// ninguém RE-LIA se a Meta guardou ligado.
//
// É status passando por resultado DENTRO do nosso painel de diagnóstico — a
// primeira regra permanente deste projeto, invertida no lugar mais irônico.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { lerEstadoDaChamada } from '../sefaz-backend/whatsapp-chamadas.js';

describe('servidor GRAVADO não é tronco LIGADO', () => {
    it('com servidor e sip.status DISABLED, acusa — era o verde falso', () => {
        const r = lerEstadoDaChamada({
            status: 'ENABLED',
            call_icon_visibility: 'DEFAULT',
            sip: { status: 'DISABLED', servers: [{ hostname: 'sip.sp.com.br', port: 5061 }] },
        });
        expect(r.ok).toBe(false);
        expect(r.impedimentos.map((i) => i.campo)).toContain('sip.status');
        expect(r.impedimentos.find((i) => i.campo === 'sip.status')?.motivo)
            .toMatch(/endereço guardado NÃO é tronco ligado/i);
    });

    it('com os quatro certos, não inventa impedimento', () => {
        const r = lerEstadoDaChamada({
            status: 'ENABLED',
            call_icon_visibility: 'DEFAULT',
            call_hours: { status: 'ENABLED' },
            sip: { status: 'ENABLED', servers: [{ hostname: 'sip.sp.com.br', port: 5061 }] },
        });
        // Alarme sobre configuração certa é o que ensina a ignorar alarme.
        expect(r.ok).toBe(true);
        expect(r.impedimentos).toEqual([]);
    });

    it('a CHAMADA desligada é acusada com a frase que o cliente ouve', () => {
        const r = lerEstadoDaChamada({ status: 'DISABLED', sip: { status: 'ENABLED', servers: [{}] } });
        expect(r.impedimentos.find((i) => i.campo === 'calling.status')?.motivo)
            .toMatch(/não pode receber ligações do WhatsApp/);
    });

    it('sem servidor nenhum, diz que a ligação não tem para onde ir', () => {
        const r = lerEstadoDaChamada({ status: 'ENABLED', sip: { status: 'ENABLED', servers: [] } });
        expect(r.impedimentos.map((i) => i.campo)).toContain('sip.servers');
    });
});

describe('⚠️ AUSENTE NUNCA É LIGADO', () => {
    it('campo não declarado sai como `nao-declarado`, não como ENABLED', () => {
        // Assumir o que não foi medido é exatamente o que produziu o verde
        // falso: a tela dizia pronto sobre um campo que ninguém tinha lido.
        const r = lerEstadoDaChamada({ sip: { servers: [{ hostname: 'x', port: 5061 }] } });
        expect(r.estado.chamada).toBe('nao-declarado');
        expect(r.estado.sip).toBe('nao-declarado');
        expect(r.ok).toBe(false);
    });

    it('bloco de chamada AUSENTE não vira "está tudo certo"', () => {
        const r = lerEstadoDaChamada(null);
        expect(r.ok).toBe(false);
        expect(r.impedimentos[0].campo).toBe('calling');
    });
});

describe('o painel MOSTRA os quatro interruptores', () => {
    const tela = readFileSync(join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');
    const rotas = readFileSync(join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');

    it('a sonda leva os interruptores junto', () => {
        expect(rotas).toMatch(/interruptores: lerEstadoDaChamada\(calling\)/);
    });

    it('e a tela imprime calling.status e sip.status, que ela nunca leu', () => {
        expect(tela).toMatch(/calling\.status/);
        expect(tela).toMatch(/sip\.status/);
        expect(tela).toMatch(/O que a Meta tem LIGADO/);
    });

    it('o "✅ Tronco gravado" parou de afirmar verde só por existir servidor', () => {
        expect(tela).toMatch(/const sipLigado = sonda\.horarios\?\.interruptores\?\.estado\.sip === 'ENABLED'/);
        expect(tela).toMatch(/Servidor gravado, mas o SIP NÃO está ligado/);
    });
});

// ═══ 25/08 — A LIGAÇÃO DO CELULAR FUNCIONOU, e revelou uma PROMESSA ═════════
// A tela do celular é OUTRA: fora do horário o cliente recebe
//   "Próximo horário de atendimento por ligação: ter. 13:00 - 17:30
//    Estamos indisponíveis… Peça um retorno de ligação e entraremos em
//    contato assim que possível."
//   [Pedir retorno de ligação] [Conversar com a empresa]
//
// Duas coisas de uma vez: (1) a chamada ESTÁ viva e a grade de horário está
// sendo honrada pela Meta — a recusa era do WhatsApp DESKTOP, que não suporta
// ligar para número da Business API; (2) existe um botão que promete retorno
// EM NOSSO NOME, numa tela que não é nossa.
//
// 🚨 Se esse pedido chega ao webhook e ninguém o lê, o cliente espera um
// retorno que não vem — a família da "nota que entra e some", agora com uma
// promessa explícita em cima.
//
// ⚠️ E o handler NÃO se escreve agora: o leiaute não está provado. Escrever o
// processamento de um payload que ninguém viu é inventar leiaute — a lição do
// 1010, do 0500 e do D100. O que entra é um LOCALIZADOR do evento real.
describe('🔎 o pedido de retorno é ACHADO, não deduzido', () => {
    const rotas = readFileSync(join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = readFileSync(join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');

    it('a rota entrega o evento CRU e não processa nada', () => {
        expect(rotas).toMatch(/router\.get\('\/chamadas\/eventos-crus', requireAdmin/);
        const trecho = rotas.slice(rotas.indexOf("'/chamadas/eventos-crus'"), rotas.indexOf("'/chamadas/eventos-crus'") + 1800);
        // Nada de gravar/derivar: só ler e devolver.
        expect(trecho).not.toMatch(/\.set\(|\.update\(/);
        expect(trecho).toMatch(/payload: d\.data\(\)\?\.payload/);
    });

    it('o recorte é DITO — "0 de 200" é resposta, "0" sozinho é armadilha', () => {
        expect(rotas).toMatch(/amostra: snap\.size/);
        expect(tela).toMatch(/entre os \$\{crus\.amostra\} eventos mais recentes do webhook/);
    });

    it('e a tela tem o botão (rota sem botão é código morto com cara de entrega)', () => {
        expect(tela).toMatch(/Ver eventos de chamada \(crus\)/);
        expect(tela).toMatch(/eventosCrusDeChamada\(\)/);
    });
});
