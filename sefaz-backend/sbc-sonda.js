// ============================================================================
// sefaz-backend/sbc-sonda.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// ☎️ POR QUE A META RECUSA A LIGAÇÃO ANTES DE ELA CHEGAR NO NOSSO SBC?
//
// Estado em 24/08: o número está com ligações HABILITADAS, o ícone VISÍVEL, o
// horário batendo e o tronco SIP salvo — a sonda do painel é toda verde — e
// mesmo assim o cliente ouve *"SP Assessoria não pode receber ligações do
// WhatsApp"*. Ou seja: a recusa acontece ANTES de qualquer INVITE chegar aqui,
// e por isso o log do Asterisk fica mudo.
//
// 🚨 A SONDA VERDE RESPONDE OUTRA PERGUNTA. Ela pergunta *"o que a Meta tem
// GRAVADO?"* — e ter gravado o hostname não é a Meta CONSEGUIR falar com ele.
// Em modo SIP quem liga para o nosso servidor é ela; se o TLS não fecha, se o
// certificado não é confiável ou se o nome não bate, ela não tem para onde
// mandar a chamada e recusa na origem. Nada disso aparece em `GET settings`.
//
// ✂️ Então esta sonda faz o que a Meta faz: ABRE A CONEXÃO. Ela responde com
// FATOS, não com dedução — DNS, porta, aperto de mão TLS, cadeia do
// certificado, nome no certificado, validade, e um SIP OPTIONS para provar que
// há um SIP vivo do outro lado, não só uma porta aberta.
//
// DECISÕES QUE MANDAM:
// - **Qualquer resposta SIP é um SIM.** OPTIONS que volta 200, 401 ou 404
//   prova a mesma coisa que interessa aqui: existe uma pilha SIP atendendo. O
//   que reprova é o SILÊNCIO. Exigir 200 acusaria SBC saudável que só é mais
//   estrito — alarme sobre configuração certa é o que ensina a ignorar alarme.
// - **Falha de rede DAQUI é `indeterminado`, nunca "o SBC está fora".** O
//   caminho Cloud Run → VM não é o caminho Meta → VM; afirmar queda a partir
//   de um timeout nosso mandaria alguém reinstalar servidor que está de pé.
//   O que a sonda diz é o que ela mediu, com o limite escrito na frase.
// - **Certificado NÃO CONFIÁVEL é achado DURO, e é o suspeito nº 1.** A Meta
//   exige cadeia pública; um autoassinado fecha TLS entre nós dois (o Node
//   aceita se mandarmos) e é recusado por ela — o sintoma seria exatamente
//   este: tudo verde do nosso lado e ligação recusada na origem.
// - **A sonda não conserta nada.** Ela nomeia a causa e diz onde arrumar —
//   régua da casa desde 06/08.
// ============================================================================

/** Porta padrão do SIP sobre TLS (a única que o nosso SBC expõe à Meta). */
export const PORTA_SIP_TLS = 5061;

/**
 * Monta um SIP OPTIONS — o "está aí?" do protocolo. `id` e `ramo` entram por
 * fora para o teste poder fixar a mensagem inteira (SIP exige valores únicos
 * por transação; quem chama gera).
 */
export function montarSipOptions({ host, porta = PORTA_SIP_TLS, origem = 'sonda.invalid', id, ramo }) {
    const alvo = `sip:${host}:${porta}`;
    return [
        `OPTIONS ${alvo} SIP/2.0`,
        `Via: SIP/2.0/TLS ${origem};branch=z9hG4bK${ramo};rport`,
        'Max-Forwards: 70',
        `From: <sip:sonda@${origem}>;tag=${id}`,
        `To: <${alvo}>`,
        `Call-ID: ${id}@${origem}`,
        'CSeq: 1 OPTIONS',
        `Contact: <sip:sonda@${origem}>`,
        'User-Agent: SP Connect (sonda do SBC)',
        'Accept: application/sdp',
        'Content-Length: 0',
        '', '',
    ].join('\r\n');
}

/**
 * Lê a primeira linha de uma resposta SIP. Devolve `respondeu: false` quando o
 * texto não é SIP — dado que chega mas não é SIP é outro serviço na porta, e
 * essa distinção importa (porta aberta ≠ SIP vivo).
 */
export function lerRespostaSip(texto) {
    const primeira = String(texto || '').split(/\r?\n/)[0] || '';
    const m = primeira.match(/^SIP\/2\.0\s+(\d{3})\s*(.*)$/);
    if (!m) {
        return {
            respondeu: false,
            motivo: primeira
                ? `A porta respondeu, mas não com SIP (primeira linha: "${primeira.slice(0, 60)}").`
                : 'Nada voltou na conexão.',
        };
    }
    const codigo = Number(m[1]);
    const servidor = (String(texto).match(/^(?:Server|User-Agent):\s*(.+)$/im) || [])[1] || null;
    return { respondeu: true, codigo, frase: m[2].trim() || null, servidor: servidor ? servidor.trim() : null };
}

/** O nome bate com o certificado? Aceita curinga de UM nível (*.dominio). */
export function nomeCasaComCertificado(hostname, { sujeitoCN = null, alternativos = [] } = {}) {
    const alvo = String(hostname || '').trim().toLowerCase();
    if (!alvo) return false;
    const nomes = [...(alternativos || []), sujeitoCN]
        .filter(Boolean).map((n) => String(n).replace(/^DNS:/i, '').trim().toLowerCase());
    return nomes.some((n) => (n.startsWith('*.')
        // Curinga cobre UM nível: *.a.com vale para x.a.com e não para y.x.a.com.
        ? alvo.endsWith(n.slice(1)) && alvo.slice(0, -(n.length - 1)).split('.').length === 1
        : n === alvo));
}

/**
 * Traduz o que se mediu do certificado. `autorizado` é o veredito da CADEIA
 * feito pelo Node contra as CAs do sistema — é ele que responde a pergunta da
 * Meta ("esta cadeia é pública?"), e por isso ele vem de fora, medido.
 */
export function interpretarCertificado({
    autorizado, erroAutorizacao = null, sujeitoCN = null, alternativos = [],
    validoAte = null, hostname, agora = new Date(),
} = {}) {
    if (autorizado !== true) {
        return {
            situacao: 'cadeia-nao-confiavel',
            grave: true,
            motivo: `O certificado da ${hostname} não é aceito por uma autoridade pública${erroAutorizacao ? ` (${erroAutorizacao})` : ''}.`,
            // Este é o suspeito nº 1 do sintoma "tudo verde e a Meta recusa":
            // entre nós dois o TLS fecha; para ela, não.
            acao: 'A Meta exige cadeia pública. Rode o setup do SBC de novo para emitir/renovar o Let\'s Encrypt — e confira se a porta 80 está aberta, que é por onde ele valida.',
        };
    }
    if (!nomeCasaComCertificado(hostname, { sujeitoCN, alternativos })) {
        return {
            situacao: 'nome-nao-bate',
            grave: true,
            motivo: `O certificado é válido, mas foi emitido para ${sujeitoCN || alternativos.join(', ') || '(sem nome legível)'} — e a Meta liga para ${hostname}.`,
            acao: `Emita o certificado para ${hostname}, ou cadastre na Meta exatamente o nome que está no certificado. Os dois têm que ser o MESMO.`,
        };
    }
    const fim = validoAte ? new Date(validoAte) : null;
    if (fim && Number.isFinite(fim.getTime())) {
        const dias = Math.floor((fim.getTime() - agora.getTime()) / 86_400_000);
        if (dias < 0) {
            return {
                situacao: 'vencido', grave: true,
                motivo: `O certificado venceu em ${fim.toISOString().slice(0, 10)}.`,
                acao: 'Renove (o Let\'s Encrypt renova sozinho se a porta 80 estiver aberta e o timer do certbot ativo).',
            };
        }
        if (dias <= 15) {
            return {
                situacao: 'vencendo', grave: false,
                motivo: `O certificado vence em ${dias} dia(s) (${fim.toISOString().slice(0, 10)}).`,
                acao: 'Confira a renovação automática antes que ela vire recusa de ligação.',
            };
        }
    }
    return {
        situacao: 'ok', grave: false,
        motivo: `Certificado público válido para ${hostname}${fim ? `, até ${fim.toISOString().slice(0, 10)}` : ''}.`,
        acao: null,
    };
}

/**
 * O veredito da sonda inteira. A ordem das perguntas é a ordem em que a Meta
 * esbarraria nelas — devolver a PRIMEIRA que falha é o que evita mandar
 * alguém consertar o certificado quando o DNS é que não resolve.
 */
export function concluirSondaSbc({
    hostname = null, porta = PORTA_SIP_TLS,
    dns = null, tcp = null, tls = null, certificado = null, sip = null,
} = {}) {
    if (!hostname) {
        return {
            veredito: 'indeterminado',
            motivo: 'A Meta não tem nenhum servidor SIP cadastrado para este número.',
            acao: 'Cadastre o tronco na aba ⚙️ → ☎️ antes de sondar — sem servidor não há o que testar.',
        };
    }
    if (dns && dns.ok === false) {
        return {
            veredito: 'reprovado',
            motivo: `O nome ${hostname} não resolve em IP nenhum${dns.erro ? ` (${dns.erro})` : ''}.`,
            acao: 'Crie/corrija o registro A do DNS apontando para o IP estático do SBC. Enquanto ele não resolver, a Meta não tem para onde ligar.',
        };
    }
    if (tcp && tcp.ok === false) {
        return {
            veredito: 'indeterminado',
            // ⚠️ Não afirmar queda: o caminho daqui não é o caminho da Meta.
            motivo: `Daqui eu não consegui abrir a porta ${porta} em ${hostname}${tcp.erro ? ` (${tcp.erro})` : ''}.`,
            acao: 'Confira se a VM do SBC está ligada e se a regra de firewall da 5061/tcp existe. Isto NÃO prova que a Meta também não alcança — prova que este teste não alcançou.',
        };
    }
    if (tls && tls.ok === false) {
        return {
            veredito: 'reprovado',
            motivo: `A porta abriu, mas o TLS não fechou${tls.erro ? ` (${tls.erro})` : ''}.`,
            acao: 'A Meta só fala TLS 1.2+ nesta porta. Confira o transport-tls do pjsip.conf e se os arquivos de certificado estão no lugar.',
        };
    }
    if (certificado && certificado.grave) {
        return { veredito: 'reprovado', motivo: certificado.motivo, acao: certificado.acao };
    }
    if (sip && sip.respondeu === false) {
        return {
            veredito: 'reprovado',
            // Porta aberta com SIP mudo é o caso mais traiçoeiro: parece de pé.
            motivo: `O TLS fechou, mas ninguém respondeu em SIP: ${sip.motivo}`,
            acao: 'O Asterisk pode estar parado ou não escutando na 5061. Na VM: systemctl status asterisk e asterisk -rx "pjsip show transports".',
        };
    }
    const ressalvas = [];
    if (certificado && certificado.situacao === 'vencendo') ressalvas.push(certificado.motivo);
    return {
        veredito: 'aprovado',
        motivo: `${hostname}:${porta} atende em TLS com certificado público e responde SIP${sip?.codigo ? ` (${sip.codigo}${sip.frase ? ` ${sip.frase}` : ''})` : ''}.`,
        // 🚨 Aprovado aqui NÃO é "a ligação vai funcionar" — é "o caminho que a
        // Meta usa está de pé DAQUI". Prometer o resto seria o farol mentiroso
        // que esta casa já pagou caro: com tudo isto verde e a chamada ainda
        // recusada, a causa está do lado da Meta (habilitação da conta para
        // chamada SIP) e o caminho é o suporte, com estes fatos na mão.
        acao: 'Se mesmo assim a ligação for recusada, a causa não está no SBC: leve estes fatos ao suporte da Meta — o caminho até nós está de pé.',
        ressalvas,
    };
}
