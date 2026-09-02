/**
 * email-destinatarios-helper.js (PURO — testável em jest)
 *
 * As env vars de destinatário dos crons de notificação (CAPTURA_RESUMO_TO,
 * CERT_ALERT_TO, HEALTH_ALERT_TO) eram tratadas como e-mail ÚNICO — uma
 * lista com vírgula virava um endereço inválido no Graph. Este helper
 * aceita lista separada por vírgula/ponto-e-vírgula e valida cada item.
 * enviarEmail (graph-provider.js) já aceita string[] em `para`.
 *
 * Ex.: CAPTURA_RESUMO_TO="junior@sp.com.br, sandra@sp.com.br; alex@sp.com.br"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 DUAS POLÍTICAS SOBRE O MESMO PARSE — e é isso que este módulo carrega
 * (02/09, print da colaboradora no Teams: *"a opção de envio ABRIR PELO OUTLOOK
 * WEB dá erro"*, com o Outlook respondendo **"Something went wrong"** e um 500).
 *
 * A URL do print traz `to=marcio07%2FMD%40gmail.com` — ou seja, uma **BARRA
 * dentro do e-mail** do cliente, que é o jeito clássico de dois endereços
 * ficarem colados num campo só. O app mandava o campo CRU para a URL, e o
 * `EMAIL_RE` aqui **aceitava** (a barra não tem espaço nem segundo `@`).
 *
 * · Para **ENV VAR** (cron), descartar em silêncio é aceitável: existe
 *   fallback e o destinatário é da CASA.
 * · Para o **E-MAIL DO CLIENTE**, descartar em silêncio significa **o cliente
 *   não receber a guia** e ninguém saber. Ali a régua tem de DIZER qual
 *   endereço está torto e por quê — "Something went wrong" do Outlook não diz
 *   nada, e manda procurar defeito no app quando o problema é o cadastro.
 *
 * Por isso o PARSE é um só e as políticas são duas, declaradas:
 * `parseDestinatarios` (descarta, para env) e `lerDestinatarios` +
 * `recusaDeDestinatario` (denuncia, para envio ao cliente).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Caracteres que na prática NUNCA aparecem num endereço real e que os clientes
// de e-mail recusam. `/` e `\` são o caso do print; `<>` vem de "Nome <a@b>"
// colado errado; aspas e parênteses vêm de colagem de lista.
const LIXO_NO_ENDERECO = /[/\\<>()[\]"']/;

/**
 * Lê o campo de destinatário e devolve o DIAGNÓSTICO, sem descartar calado.
 *
 * @param {string|undefined} raw
 * @returns {{validos: string[], invalidos: Array<{valor: string, motivo: string}>, vazio: boolean}}
 */
export function lerDestinatarios(raw) {
    const texto = String(raw == null ? '' : raw).trim();
    if (!texto) return { validos: [], invalidos: [], vazio: true };

    const vistos = new Set();
    const validos = [];
    const invalidos = [];

    // Separadores que a equipe de fato usa. ⚠️ A BARRA NÃO é separador: ela
    // pode ser engano de digitação OU dois e-mails colados, e o app não tem
    // como saber qual — partir no escuro mandaria a guia para um endereço que
    // ninguém digitou. Ela vira RECUSA com o motivo.
    for (const bruto of texto.split(/[,;|\s]+/)) {
        const token = bruto.trim();
        if (!token) continue;
        // Forma "Nome <a@b.com>" é legítima: fica o que está entre < >.
        const emAngulo = token.match(/^<?([^<>]+)>$/);
        const valor = emAngulo ? emAngulo[1].trim() : token;

        if (!valor.includes('@')) {
            invalidos.push({ valor, motivo: 'não tem @ — isto não é um e-mail.' });
            continue;
        }
        if ((valor.match(/@/g) || []).length > 1) {
            invalidos.push({
                valor,
                motivo: 'tem mais de um @ — parecem DOIS e-mails colados. Separe por ponto e vírgula.',
            });
            continue;
        }
        if (LIXO_NO_ENDERECO.test(valor)) {
            invalidos.push({
                valor,
                motivo: 'tem um caractere que endereço de e-mail não costuma ter (barra, sinal de maior/menor, '
                    + 'aspas ou parêntese) — quase sempre é erro de digitação ou dois e-mails colados.',
            });
            continue;
        }
        if (!EMAIL_RE.test(valor)) {
            invalidos.push({ valor, motivo: 'não tem a forma de um e-mail (falta o domínio ou o ponto).' });
            continue;
        }
        const k = valor.toLowerCase();
        if (vistos.has(k)) continue;
        vistos.add(k);
        validos.push(valor);
    }
    return { validos, invalidos, vazio: false };
}

/**
 * A frase de RECUSA quando o campo não serve para enviar ao cliente — ou
 * `null` quando dá para enviar.
 *
 * ⚠️ Endereço torto NÃO é descartado em silêncio nem quando há um válido do
 * lado: se a equipe pôs dois, é porque os dois têm de receber. Mandar só para
 * um e não dizer nada é a guia chegando pela metade sem ninguém saber.
 */
export function recusaDeDestinatario(lidos) {
    const r = lidos || { validos: [], invalidos: [], vazio: true };
    if (r.vazio || (!r.validos.length && !r.invalidos.length)) {
        return 'E-mail do cliente ausente — preencha o e-mail no cadastro da empresa (Dados Fiscais).';
    }
    if (r.invalidos.length) {
        const lista = r.invalidos.map((i) => `"${i.valor}" (${i.motivo})`).join(' · ');
        return `O e-mail do cliente no cadastro não serve para enviar: ${lista} `
            + 'Corrija em Dados Fiscais e tente de novo — o Outlook responde só "Something went wrong" '
            + 'quando o endereço está torto, e isso faz procurar defeito no app.';
    }
    return null;
}

/**
 * @param {string|undefined} raw      valor da env var (lista com , ou ;)
 * @param {string} [fallback]         usado se a lista ficar vazia
 * @returns {string[]}                destinatários válidos, sem duplicatas
 */
export function parseDestinatarios(raw, fallback) {
    // Mesmo PARSE, política de ENV: descarta o inválido e cai no fallback.
    const lista = lerDestinatarios(raw).validos;
    if (lista.length === 0 && fallback && EMAIL_RE.test(fallback)) return [fallback];
    return lista;
}
