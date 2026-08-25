// ============================================================================
// 🔌 "TUDO VERDE E A LIGAÇÃO É RECUSADA" — a sonda que responde a pergunta certa
// ----------------------------------------------------------------------------
// Estado em 24/08: ligações HABILITADAS, ícone VISÍVEL, horário batendo, tronco
// SIP salvo — e o cliente ouve "SP Assessoria não pode receber ligações do
// WhatsApp". A recusa acontece ANTES de qualquer INVITE chegar ao nosso SBC, e
// é por isso que o log do Asterisk fica mudo.
//
// A sonda de settings responde OUTRA pergunta: "o que a Meta tem GRAVADO?".
// Ter gravado o hostname não é a Meta CONSEGUIR abrir TLS nele — em modo SIP
// quem liga para o nosso servidor é ela. Esta sonda faz o que ela faz: ABRE A
// CONEXÃO e devolve fatos (DNS, porta, TLS, cadeia do certificado, nome no
// certificado, SIP OPTIONS).
//
// É a mesma família do farol honesto: STATUS não é RESULTADO.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    montarSipOptions, lerRespostaSip, nomeCasaComCertificado,
    interpretarCertificado, concluirSondaSbc, PORTA_SIP_TLS,
} from '../sefaz-backend/sbc-sonda.js';

describe('SIP OPTIONS — o "está aí?" do protocolo', () => {
    const msg = montarSipOptions({ host: 'sbc.sp.com.br', porta: 5061, origem: 'sonda.invalid', id: 'ID1', ramo: 'R1' });

    it('sai com as linhas obrigatórias e termina em linha em branco', () => {
        expect(msg.startsWith('OPTIONS sip:sbc.sp.com.br:5061 SIP/2.0\r\n')).toBe(true);
        expect(msg).toContain('Via: SIP/2.0/TLS sonda.invalid;branch=z9hG4bKR1;rport');
        expect(msg).toContain('CSeq: 1 OPTIONS');
        expect(msg).toContain('Content-Length: 0');
        expect(msg.endsWith('\r\n\r\n')).toBe(true);
    });

    it('usa CRLF — LF sozinho não é SIP e alguns servidores calam', () => {
        expect(msg.split('\r\n').length).toBeGreaterThan(8);
        expect(/[^\r]\n/.test(msg)).toBe(false);
    });
});

describe('ler a resposta: QUALQUER código SIP é um SIM', () => {
    it('200 OK responde, e o servidor sai nomeado quando ele se identifica', () => {
        const r = lerRespostaSip('SIP/2.0 200 OK\r\nServer: Asterisk PBX 20.5\r\n\r\n');
        expect(r).toMatchObject({ respondeu: true, codigo: 200, frase: 'OK', servidor: 'Asterisk PBX 20.5' });
    });

    it('401/404 também PROVAM que há SIP vivo — exigir 200 acusaria SBC saudável', () => {
        // Um SBC mais estrito responde 401/403 a um OPTIONS anônimo. Isso não
        // é defeito: a pergunta aqui é "existe pilha SIP atendendo?".
        expect(lerRespostaSip('SIP/2.0 401 Unauthorized\r\n')).toMatchObject({ respondeu: true, codigo: 401 });
        expect(lerRespostaSip('SIP/2.0 404 Not Found\r\n')).toMatchObject({ respondeu: true, codigo: 404 });
    });

    it('o que REPROVA é o silêncio — e "outra coisa na porta" é dito à parte', () => {
        expect(lerRespostaSip('')).toMatchObject({ respondeu: false });
        const outro = lerRespostaSip('HTTP/1.1 200 OK\r\n');
        expect(outro.respondeu).toBe(false);
        // Porta aberta ≠ SIP vivo: essa distinção é o que evita mandar alguém
        // procurar defeito de rede quando o serviço é que é outro.
        expect((outro as { motivo: string }).motivo).toMatch(/não com SIP/);
    });
});

describe('o nome do certificado tem que ser o nome que a Meta disca', () => {
    it('casa por nome exato e por curinga de UM nível', () => {
        expect(nomeCasaComCertificado('sbc.sp.com.br', { sujeitoCN: 'sbc.sp.com.br' })).toBe(true);
        expect(nomeCasaComCertificado('sbc.sp.com.br', { alternativos: ['DNS:*.sp.com.br'] })).toBe(true);
        // Curinga NÃO vale para dois níveis — aceitar seria afirmar validade
        // que a própria TLS recusa.
        expect(nomeCasaComCertificado('a.b.sp.com.br', { alternativos: ['DNS:*.sp.com.br'] })).toBe(false);
        expect(nomeCasaComCertificado('sbc.sp.com.br', { sujeitoCN: 'outro.com.br' })).toBe(false);
    });
});

describe('certificado — o suspeito nº 1 do "verde aqui, recusado lá"', () => {
    const agora = new Date('2026-08-24T12:00:00Z');

    it('cadeia NÃO confiável é achado GRAVE (o TLS fecha entre nós e não com a Meta)', () => {
        const r = interpretarCertificado({
            autorizado: false, erroAutorizacao: 'DEPTH_ZERO_SELF_SIGNED_CERT',
            hostname: 'sbc.sp.com.br', agora,
        });
        expect(r.situacao).toBe('cadeia-nao-confiavel');
        expect(r.grave).toBe(true);
        expect(r.acao).toMatch(/Let's Encrypt|porta 80/);
    });

    it('certificado válido com nome ERRADO também reprova, e diz os dois nomes', () => {
        const r = interpretarCertificado({
            autorizado: true, sujeitoCN: 'outro.sp.com.br', hostname: 'sbc.sp.com.br', agora,
        });
        expect(r.situacao).toBe('nome-nao-bate');
        expect(r.motivo).toContain('outro.sp.com.br');
        expect(r.motivo).toContain('sbc.sp.com.br');
    });

    it('vencido reprova; vencendo é RESSALVA, não reprovação', () => {
        const base = { autorizado: true, sujeitoCN: 'sbc.sp.com.br', hostname: 'sbc.sp.com.br', agora };
        expect(interpretarCertificado({ ...base, validoAte: '2026-08-20T00:00:00Z' }).situacao).toBe('vencido');
        const perto = interpretarCertificado({ ...base, validoAte: '2026-09-01T00:00:00Z' });
        expect(perto.situacao).toBe('vencendo');
        // Alarme sobre configuração CERTA é o que ensina a ignorar alarme.
        expect(perto.grave).toBe(false);
        expect(interpretarCertificado({ ...base, validoAte: '2026-11-01T00:00:00Z' }).situacao).toBe('ok');
    });
});

describe('o veredito responde na ORDEM em que a Meta esbarraria', () => {
    it('sem servidor cadastrado não há o que testar — indeterminado, com o caminho', () => {
        const r = concluirSondaSbc({});
        expect(r.veredito).toBe('indeterminado');
        expect(r.acao).toMatch(/⚙️ → ☎️/);
    });

    it('DNS que não resolve vem ANTES do certificado (não mandar consertar o que não é)', () => {
        const r = concluirSondaSbc({
            hostname: 'sbc.sp.com.br', dns: { ok: false, erro: 'ENOTFOUND' },
            certificado: { situacao: 'cadeia-nao-confiavel', grave: true, motivo: 'x', acao: 'y' },
        });
        expect(r.veredito).toBe('reprovado');
        expect(r.motivo).toMatch(/não resolve/);
        expect(r.acao).toMatch(/registro A/);
    });

    it('porta fechada DAQUI é INDETERMINADO — o caminho daqui não é o da Meta', () => {
        const r = concluirSondaSbc({ hostname: 'sbc.sp.com.br', dns: { ok: true }, tcp: { ok: false, erro: 'ETIMEDOUT' } });
        // Afirmar queda a partir de um timeout nosso mandaria alguém
        // reinstalar servidor que está de pé.
        expect(r.veredito).toBe('indeterminado');
        expect(r.acao).toMatch(/NÃO prova que a Meta também não alcança/);
    });

    it('TLS fechado com SIP MUDO reprova — porta aberta parece de pé e não é', () => {
        const r = concluirSondaSbc({
            hostname: 'sbc.sp.com.br', dns: { ok: true }, tcp: { ok: true }, tls: { ok: true },
            certificado: { situacao: 'ok', grave: false, motivo: 'ok', acao: null },
            sip: { respondeu: false, motivo: 'Nada voltou na conexão.' },
        });
        expect(r.veredito).toBe('reprovado');
        expect(r.acao).toMatch(/systemctl status asterisk/);
    });

    it('tudo de pé APROVA — e não promete que a ligação vai funcionar', () => {
        const r = concluirSondaSbc({
            hostname: 'sbc.sp.com.br', porta: PORTA_SIP_TLS,
            dns: { ok: true }, tcp: { ok: true }, tls: { ok: true },
            certificado: { situacao: 'ok', grave: false, motivo: 'ok', acao: null },
            sip: { respondeu: true, codigo: 200, frase: 'OK' },
        });
        expect(r.veredito).toBe('aprovado');
        // 🚨 Aprovado = "o caminho está de pé DAQUI", não "a ligação completa".
        // Prometer o resto seria o farol mentiroso que esta casa já pagou.
        expect(r.acao).toMatch(/suporte da Meta/);
    });

    it('vencendo vira RESSALVA no aprovado, nunca reprovação calada', () => {
        const r = concluirSondaSbc({
            hostname: 'sbc.sp.com.br', dns: { ok: true }, tcp: { ok: true }, tls: { ok: true },
            certificado: { situacao: 'vencendo', grave: false, motivo: 'vence em 9 dia(s)', acao: 'renove' },
            sip: { respondeu: true, codigo: 200, frase: 'OK' },
        });
        expect(r.veredito).toBe('aprovado');
        expect(r.ressalvas).toContain('vence em 9 dia(s)');
    });
});

// ── A régua mora no núcleo PURO; a casca só MEDE ────────────────────────────
// Se o veredito morasse dentro do arquivo que abre socket, ele seria
// inexercitável por teste — foi assim que o parser do e-Fiscal passou meses
// errando por coordenada (17/08).
describe('quem julga é o núcleo, quem abre socket é a casca', () => {
    const medicao = readFileSync(join(process.cwd(), 'sefaz-backend/sbc-medicao.js'), 'utf8');
    // 🐛 A 1ª versão desta trava leu o arquivo INTEIRO e acusou o comentário
    // que EXPLICA o desenho ("poder LER o veredito da cadeia") — ou seja,
    // mandava apagar a explicação para o teste passar. Varredura lê CÓDIGO,
    // não prosa: é a mesma correção que o `reguaUnica` já tinha feito.
    const codigo = medicao.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    it('a casca importa o núcleo e não escreve veredito próprio', () => {
        expect(medicao).toMatch(/from '\.\/sbc-sonda\.js'/);
        expect(codigo).not.toMatch(/veredito|situacao|grave/);
    });

    it('e o rejectUnauthorized:false é DIAGNÓSTICO, com o motivo escrito', () => {
        // Ele existe para PODER LER o erro da cadeia; se a conexão caísse no
        // aperto de mão, a sonda diria "TLS falhou" e esconderia justo a
        // informação que interessa.
        expect(medicao).toMatch(/rejectUnauthorized: false/);
        expect(medicao).toMatch(/NÃO afrouxa nada aqui/);
    });
});

describe('a rota existe e tem BOTÃO (rota sem botão é código morto)', () => {
    const rotas = readFileSync(join(process.cwd(), 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = readFileSync(join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');

    it('a rota é admin — ela mede infraestrutura, não atende cliente', () => {
        expect(rotas).toMatch(/router\.post\('\/chamadas\/sondar-sbc', requireAdmin/);
    });

    it('o alvo sai das SETTINGS da Meta (sondar outro endereço responde por outro servidor)', () => {
        const trecho = rotas.slice(rotas.indexOf("'/chamadas/sondar-sbc'"), rotas.indexOf("'/chamadas/sondar-sbc'") + 3000);
        expect(trecho).toMatch(/lerCallingDasSettings\(corpo\)\?\.sip/);
        expect(trecho).toMatch(/origemDoAlvo/);
    });

    it('a tela chama a rota e mostra a lista de etapas (é ela que diz ONDE parou)', () => {
        expect(tela).toMatch(/sondarSbc\(/);
        expect(tela).toMatch(/Testar o caminho até o SBC/);
        expect(tela).toMatch(/sbc\.sip\?\.respondeu/);
    });
});

// ═══ 24/08 — "TUDO DE PÉ E A LIGAÇÃO RECUSADA": a janela ═══════════════════
// O 🔌 aprovou o caminho — TLS 1.2, certificado público até 2026-11-22,
// Asterisk respondendo SIP 200 OK. Ou seja: a hipótese do certificado, que era
// a minha nº 1, estava ERRADA e o SBC está inteiro.
//
// 🚨 E o print que trouxe essa prova trouxe outra coisa: ele é das 19:51, e a
// grade da chamada (a MESMA das mensagens) é seg–sex 08:00–12:00 e
// 13:00–17:30. Fora dela a Meta recusa a ligação com a frase que se lê como
// defeito — "SP Assessoria não pode receber ligações do WhatsApp". Então o
// teste feito fora da hora responde sobre o HORÁRIO e PARECE resposta sobre o
// tronco: nós dois testamos fora da janela e fomos procurar defeito de
// infraestrutura.
//
// O painel tem a grade e tem o relógio. Calar aqui é deixar quem testa
// concluir a causa errada — é a régua de "causa junto do número".
describe('o painel diz se AGORA vale testar a ligação', () => {
    const tela = readFileSync(join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');

    it('usa a MESMA régua de horário do atendimento, nunca uma segunda cópia', () => {
        expect(tela).toMatch(/dentroDoHorario \} from '\.\.\/\.\.\/sefaz-backend\/whatsapp-atendimento\.js'/);
        expect(tela).toMatch(/dentroDoHorario\(sonda\.horarios\.mensagens, agora\)/);
    });

    it('fora da janela ele DIZ que a recusa é do horário, não do tronco', () => {
        expect(tela).toMatch(/essa recusa é do HORÁRIO, não do tronco/);
    });

    it('e mostra a hora de SP — número que não dá pra conferir não convence', () => {
        expect(tela).toMatch(/timeZone: 'America\/Sao_Paulo', hour: '2-digit', minute: '2-digit'/);
    });
});
