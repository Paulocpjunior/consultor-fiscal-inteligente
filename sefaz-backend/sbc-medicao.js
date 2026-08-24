// ============================================================================
// sefaz-backend/sbc-medicao.js  (ESM — I/O puro-sangue: só MEDE, não julga)
// ----------------------------------------------------------------------------
// A casca que abre a conexão com o SBC do jeito que a Meta abre: DNS → TCP →
// TLS → SIP OPTIONS. Ela devolve FATOS crus; quem os traduz em veredito é o
// núcleo puro (`sbc-sonda.js`), que é testável. Misturar as duas coisas faria
// a régua morar num arquivo que o jest não consegue exercitar — foi assim que
// o parser do e-Fiscal passou meses errando por coordenada (17/08).
//
// ⚠️ `rejectUnauthorized: false` NÃO afrouxa nada aqui, e o motivo é o
// contrário do que parece: se a conexão caísse no aperto de mão, a sonda
// devolveria "TLS falhou" e esconderia a informação que interessa — QUAL é o
// problema do certificado. Nós fechamos a conexão de propósito para poder LER
// o veredito da cadeia (`authorized`/`authorizationError`) e dizer, com nome,
// que ele é autoassinado ou está fora do nome. É diagnóstico, não confiança:
// nada é enviado por este socket além de um OPTIONS sem segredo nenhum.
// ============================================================================
import { promises as dns } from 'dns';
import tls from 'tls';
import { randomUUID } from 'crypto';
import { montarSipOptions, lerRespostaSip, PORTA_SIP_TLS } from './sbc-sonda.js';

const TEMPO_LIMITE_MS = 8000;

/**
 * Mede o caminho até o SBC. Nunca lança: toda falha vira `{ ok: false, erro }`
 * na etapa em que aconteceu — sonda que explode não diz em que ponto parou.
 */
export async function medirSbc({ hostname, porta = PORTA_SIP_TLS }) {
    const resultado = {
        dns: { ok: false, erro: null, enderecos: [] },
        tcp: { ok: false, erro: null },
        tls: { ok: false, erro: null, protocolo: null },
        cert: {},
        sip: null,
    };

    try {
        const achados = await dns.lookup(hostname, { all: true });
        resultado.dns = { ok: achados.length > 0, erro: null, enderecos: achados.map((a) => a.address) };
    } catch (e) {
        resultado.dns = { ok: false, erro: e.code || e.message, enderecos: [] };
        return resultado; // sem DNS não há o que conectar
    }

    await new Promise((resolver) => {
        let encerrado = false;
        const fim = (fn) => { if (!encerrado) { encerrado = true; fn(); resolver(); } };
        const socket = tls.connect({
            host: hostname,
            port: porta,
            servername: hostname,
            // Ver o comentário do cabeçalho: fechamos para poder LER o motivo.
            rejectUnauthorized: false,
            timeout: TEMPO_LIMITE_MS,
        });

        let resposta = '';
        const guardaTempo = setTimeout(() => {
            fim(() => {
                if (!resultado.tls.ok) resultado.tcp = { ok: false, erro: `sem resposta em ${TEMPO_LIMITE_MS}ms` };
                else if (!resultado.sip) resultado.sip = lerRespostaSip('');
                socket.destroy();
            });
        }, TEMPO_LIMITE_MS);

        socket.on('secureConnect', () => {
            resultado.tcp = { ok: true, erro: null };
            resultado.tls = { ok: true, erro: null, protocolo: socket.getProtocol() };
            const cert = socket.getPeerCertificate(true) || {};
            resultado.cert = {
                autorizado: socket.authorized === true,
                erroAutorizacao: socket.authorizationError ? String(socket.authorizationError) : null,
                sujeitoCN: cert.subject?.CN || null,
                emissor: cert.issuer?.CN || cert.issuer?.O || null,
                alternativos: String(cert.subjectaltname || '')
                    .split(',').map((s) => s.trim()).filter(Boolean),
                validoAte: cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
            };
            socket.write(montarSipOptions({
                host: hostname, porta, origem: 'sonda.spconnect.invalid',
                id: randomUUID(), ramo: randomUUID().replace(/-/g, ''),
            }));
        });

        socket.on('data', (b) => {
            resposta += b.toString('utf8');
            // A primeira linha já responde a pergunta — não esperar o corpo
            // inteiro evita ficar pendurado em SBC que não fecha a conexão.
            if (/\r?\n/.test(resposta)) {
                clearTimeout(guardaTempo);
                fim(() => { resultado.sip = lerRespostaSip(resposta); socket.destroy(); });
            }
        });

        socket.on('error', (e) => {
            clearTimeout(guardaTempo);
            fim(() => {
                const msg = e.code || e.message;
                // Erro ANTES do handshake é da porta; depois dele, do SIP.
                if (!resultado.tcp.ok) resultado.tcp = { ok: false, erro: msg };
                else if (!resultado.tls.ok) resultado.tls = { ok: false, erro: msg };
                else if (!resultado.sip) resultado.sip = { respondeu: false, motivo: `A conexão caiu depois do TLS (${msg}).` };
                socket.destroy();
            });
        });

        socket.on('close', () => {
            clearTimeout(guardaTempo);
            fim(() => {
                if (resultado.tls.ok && !resultado.sip) resultado.sip = lerRespostaSip(resposta);
            });
        });
    });

    return resultado;
}
