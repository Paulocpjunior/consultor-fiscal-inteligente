// ============================================================================
// sefaz-backend/trilho-saida-modelo.js  (PURO)
// ----------------------------------------------------------------------------
// "Por qual trilho a SAÍDA desta empresa chega — e por que a NFC-e não veio?"
//
// 🚨 O CASO (02/09, Paulo na MV LIDER 0639 · 08/2026): *"se observar aí não
// puxou todas as NFC-E, só puxou 1"*. A tabela do painel mostrava
// `65 · série 1 · 347–347 · 1 autorizada` ao lado de 126 notas do modelo 55 —
// e o buraco se lê como **falha do app**.
//
// 📌 A CAUSA É O CERTIFICADO, e ela é MEDIDA: a captura de NFC-e roda pelo
// **SAE-NFC-e**, que é mTLS com o A1 do PRÓPRIO contribuinte
// (`sefaz-sp-nfce-orchestrator` → `loadCertEmpresa`/`loadCertEmpresaPorCnpjBase`,
// que carregam um **.pfx**). Com **A3** a chave vive dentro do cartão e **não
// roda no Cloud Run** — quem traz é o **Agente A3**, na máquina onde o cartão
// está inserido. Enquanto ninguém rodar o agente, o buraco do modelo 65
// continua, e não há defeito nenhum a procurar no app.
//
// ⚠️ ESTE MÓDULO NÃO AFIRMA QUE FALTAM NOTAS: ele diz **por qual porta** elas
// entrariam. Empresa que simplesmente não emite NFC-e tem o mesmo "1 nota" sem
// nada de errado — dizer "faltam notas" ali seria alarme sobre arquivo correto.
// ============================================================================

/**
 * @param {object} p
 * @param {string} [p.tipoCert]              'A1' | 'A3' | 'escritorio' | 'nenhum'
 * @param {boolean} [p.certUploaded]
 * @param {boolean} [p.certValido]
 * @param {boolean} [p.temA1MesmaRaizValido] filial coberta pelo A1 da matriz
 * @param {boolean} [p.ehEscritorio]
 * @returns {{via: string, rodaNaNuvem: boolean, titulo: string, motivo: string, acao: string|null}}
 */
export function trilhoDaNfceSaida({
    tipoCert = 'nenhum',
    certUploaded = false,
    certValido = false,
    temA1MesmaRaizValido = false,
    ehEscritorio = false,
} = {}) {
    const SAE = 'A NFC-e (modelo 65) de saída vem do SAE-NFC-e da SEFAZ-SP, que exige o certificado '
        + 'A1 do PRÓPRIO emitente';

    if (ehEscritorio || (tipoCert === 'A1' && certUploaded && certValido)) {
        return {
            via: 'cloud-a1',
            rodaNaNuvem: true,
            titulo: 'NFC-e capturada pelo servidor (A1 próprio)',
            motivo: `${SAE} — e ele está no cofre. A captura roda sozinha.`,
            acao: null,
        };
    }

    // ⚠️ O A1 DA MATRIZ COBRE A FILIAL (mesma raiz, regra de 27/08 — J.N.
    // VINATEX): ele é testado ANTES do A3, então chegar no ramo do A3 significa
    // que ele não existe.
    if (temA1MesmaRaizValido) {
        return {
            via: 'cloud-a1-raiz',
            rodaNaNuvem: true,
            titulo: 'NFC-e capturada pelo servidor (A1 da matriz, mesma raiz)',
            motivo: `${SAE}; aqui vale o A1 da matriz, que tem a mesma raiz de CNPJ.`,
            acao: null,
        };
    }

    if (tipoCert === 'A3' && certUploaded) {
        return {
            via: 'agente-a3',
            rodaNaNuvem: false,
            titulo: 'NFC-e NÃO é capturada pelo servidor — esta empresa usa A3',
            motivo: `${SAE}. Com A3 a chave vive dentro do CARTÃO e não roda no Cloud Run: quem traz a `
                + 'NFC-e desta empresa é o Agente A3, executado na máquina onde o cartão está inserido. '
                + 'Enquanto ele não rodar na competência, a numeração do modelo 65 fica com buraco aqui — '
                + 'e isso não é falha de captura do app.',
            acao: 'Rode o Agente A3 na máquina do cartão (Central de XMLs → Captura → NFC-e Saída (SP) → '
                + '“⬇ Baixar Agente A3”). Um A1 próprio (ou o da matriz, mesma raiz) faria a captura rodar '
                + 'sozinha no servidor.',
        };
    }

    if (certUploaded && !certValido) {
        return {
            via: 'bloqueada',
            rodaNaNuvem: false,
            titulo: 'NFC-e bloqueada — certificado vencido',
            motivo: `${SAE}, e o que está no cofre está vencido.`,
            acao: 'Renove o A1 e reenvie o .pfx no cofre de certificados.',
        };
    }

    return {
        via: 'bloqueada',
        rodaNaNuvem: false,
        titulo: 'NFC-e bloqueada — sem certificado próprio',
        motivo: `${SAE}. O certificado do escritório e a procuração e-CAC NÃO servem: o SAE exige que a `
            + 'chave consultada pertença ao CNPJ do certificado.',
        acao: 'Cadastre o A1 próprio da empresa (ou o da matriz, mesma raiz de CNPJ) no cofre.',
    };
}

/**
 * A frase que a tabela de modelos mostra na linha do 65.
 *
 * ⚠️ Só fala quando há o que dizer: no caso normal (A1 no cofre, captura
 * rodando) devolve **null** — aviso em cima de captura que funciona é o jeito
 * conhecido de a equipe parar de ler os avisos que importam.
 */
export function avisoDaLinhaNfce(trilho) {
    if (!trilho || trilho.rodaNaNuvem) return null;
    return `${trilho.titulo}. ${trilho.motivo}${trilho.acao ? ` ${trilho.acao}` : ''}`;
}
