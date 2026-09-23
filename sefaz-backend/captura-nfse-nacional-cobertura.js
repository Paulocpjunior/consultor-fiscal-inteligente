// ============================================================================
// sefaz-backend/captura-nfse-nacional-cobertura.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 O TERCEIRO TRILHO TAMBÉM AFIRMAVA CAPTURA A PARTIR DO CADASTRO.
//
// 29/08, LAV COMERCIO DE AUTOPECAS. Depois de o CCM e o farol do portal de SP
// serem corrigidos, Paulo mandou a LINHA dela: *"a empresa em questão está com
// o cadastro ok"* — e estava mesmo. A linha diz `A1 · ✓ marcada · **— ADN** ·
// ✓ ativa · ✓ NFe · ✓ NFSe SP · ✓ NFSe Nac · ✓ Captura OK`.
//
// 🔴 **O `— ADN` é a resposta que faltava**: o trilho do portal da capital NÃO
// SE APLICA a ela (não é de SP capital, não tem nem precisa de CCM). A NFS-e
// dela vem pelo **Padrão Nacional (ADN)** — e é justamente o ADN que decidia
// por CADASTRO: `classificarCapturaNfseNacionalAdn` pergunta só *"a flag está
// ativa e existe certificado?"*. **Nada ali olha se o ADN alguma vez entregou
// um documento desta empresa.**
//
// É a MESMA família do `temA3Proprio` (23/08) e do `capturaNfseSpOk` (29/08,
// horas antes) — a primeira regra permanente deste projeto invertida pela
// TERCEIRA vez, no último dos três trilhos.
//
// ═══ O QUE O ESTADO DO ADN RESPONDE ═════════════════════════════════════════
//
// `nfse_nacional_dfe_state/{cnpj}` guarda `ultNSU`, `maxNSU` e `ultimaSync`. O
// par de NSU distingue **três fatos com ações diferentes**:
//
//  · **nunca visitada** — não há documento de estado: o cron nunca rodou para
//    esta empresa. É o único caso em que a primeira parada é o nosso lado.
//  · **visitada e o ADN não tem nada** (`maxNSU` = 0) — o provedor RESPONDEU e
//    disse que não há documento. Isso NÃO é falha nossa, e a causa mais
//    provável é o **município não transcrever ao Padrão Nacional**: em 22/08 a
//    medição da carteira mostrou 272 dos 394 municípios com sistema próprio, e
//    o trilho com histórico total ZERO.
//  · **entregou** (`ultNSU` > 0) — o cursor andou, então documento chegou.
//
// ⚠️ **"SEM MOVIMENTO" NÃO É ALARME, É EXPLICAÇÃO.** Pintar de âmbar as
// centenas de empresas cujo município não usa o ADN seria o alarme que ninguém
// consegue apagar — o jeito conhecido de a equipe parar de olhar o farol (a
// lição do aluguel na Rotina, 27/08). O que o app faz é **DIZER o fato** na
// linha, para quem procura a nota entender por que ela não está lá.
//
// ⚠️ **E O FATO NÃO VIRA VEREDITO SOBRE O MUNICÍPIO.** `maxNSU = 0` prova que
// **o ADN não tem nada para este CNPJ** — não prova que a empresa não teve
// nota, nem afirma qual sistema a prefeitura usa. Cravar isso seria inventar o
// que o app não mediu; a frase diz a causa como POSSIBILIDADE e nomeia a saída
// (importar do município).
//
// ⚠️ **NENHUM SLA INVENTADO**: a régua devolve a DATA da última rodada e
// quantos dias faz, nunca um veredito de "parado".
// ============================================================================

const DIA_MS = 24 * 60 * 60 * 1000;

const fmtDataBr = (ms) => {
    if (!Number.isFinite(Number(ms))) return null;
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

/** NSU é string no ADN ('000000000000123'); compara como NÚMERO. */
const nsuNum = (v) => {
    const n = Number(String(v ?? '').replace(/\D/g, ''));
    return Number.isFinite(n) ? n : 0;
};

/**
 * O trilho do Padrão Nacional já ENTREGOU para esta empresa?
 *
 * @param {object} p
 * @param {boolean} p.aplicavel  o ADN é o caminho de NFS-e desta empresa E há
 *                               caminho de captura (flag + certificado)
 * @param {object|null} p.state  doc de `nfse_nacional_dfe_state/{cnpj}`
 * @param {number} [p.agoraMs]
 */
export function coberturaNfseNacional({ aplicavel, state = null, agoraMs = Date.now() } = {}) {
    if (!aplicavel) {
        return {
            situacao: 'nao-se-aplica', cor: 'neutro', aplicavel: false, entregou: null,
            texto: null, acao: null, entregueEm: null, diasDesdeEntrega: null,
        };
    }

    const ms = Number(state?.ultimaSyncMs);
    const visitada = Number.isFinite(ms) && ms > 0;

    if (!visitada) {
        return {
            situacao: 'adn-sem-visita',
            cor: 'atencao',
            aplicavel: true,
            entregou: false,
            entregueEm: null,
            diasDesdeEntrega: null,
            texto: 'Padrão Nacional (ADN) — que nunca rodou para esta empresa.',
            acao: 'Rode a captura da NFS-e Nacional para este CNPJ (Central de XMLs → Captura). '
                + 'Enquanto ela não rodar, o app não sabe dizer se há documento no ADN.',
        };
    }

    const dias = Math.max(0, Math.floor((Number(agoraMs) - ms) / DIA_MS));
    const data = fmtDataBr(ms);
    const quando = `última rodada em ${data}${dias > 0 ? ` (há ${dias} dia${dias === 1 ? '' : 's'})` : ' (hoje)'}`;
    const ult = nsuNum(state?.ultNSU);
    const max = nsuNum(state?.maxNSU);

    if (ult === 0 && max === 0) {
        // 🚨 O CASO QUE EXPLICA A LAV. O ADN respondeu e não tem nada — e isso
        // é informação, não alarme: a cor fica NEUTRA, porque acusar toda
        // empresa de município que não usa o Padrão Nacional seria o alarme
        // que ninguém consegue apagar.
        return {
            situacao: 'adn-sem-movimento',
            cor: 'neutro',
            aplicavel: true,
            entregou: false,
            entregueEm: ms,
            diasDesdeEntrega: dias,
            ultNSU: ult,
            maxNSU: max,
            texto: `Padrão Nacional (ADN) · ${quando} · o ADN respondeu e NÃO tem documento desta empresa (NSU 0/0).`,
            // A causa vai como POSSIBILIDADE, com a saída nomeada — o app não
            // mediu qual sistema a prefeitura usa.
            acao: 'Isto não é falha da captura: o ADN não recebeu nada para este CNPJ. A causa mais comum é o '
                + 'MUNICÍPIO não transcrever a NFS-e ao Padrão Nacional (boa parte da carteira usa sistema '
                + 'próprio). Para ter a nota no app, importe pelo município — Central de XMLs → Importar.',
        };
    }

    if (ult === 0 && max > 0) {
        // O ADN TEM documento e o nosso cursor não andou: aqui a pendência é
        // nossa, e é outra ação — rodar a captura.
        return {
            situacao: 'adn-nao-lido',
            cor: 'atencao',
            aplicavel: true,
            entregou: false,
            entregueEm: ms,
            diasDesdeEntrega: dias,
            ultNSU: ult,
            maxNSU: max,
            texto: `Padrão Nacional (ADN) · ${quando} · o ADN TEM documento (NSU ${ult}/${max}) e nada foi lido.`,
            acao: 'Rode a captura da NFS-e Nacional para este CNPJ — há documento disponível que o app ainda não baixou.',
        };
    }

    return {
        situacao: 'adn-entregue',
        cor: 'ok',
        aplicavel: true,
        entregou: true,
        entregueEm: ms,
        diasDesdeEntrega: dias,
        ultNSU: ult,
        maxNSU: max,
        texto: `Padrão Nacional (ADN) · ${quando} · NSU ${ult}${max ? `/${max}` : ''} lido.`,
        acao: null,
    };
}

/** Contagem para o cabeçalho do painel. */
export function resumirCoberturaNfseNacional(coberturas) {
    const lista = Array.isArray(coberturas) ? coberturas : [];
    const aplic = lista.filter((c) => c?.aplicavel);
    return {
        nfseNacTotal: aplic.length,
        nfseNacSemVisita: aplic.filter((c) => c.situacao === 'adn-sem-visita').length,
        nfseNacNaoLido: aplic.filter((c) => c.situacao === 'adn-nao-lido').length,
        // Contado à parte de propósito: é EXPLICAÇÃO, não pendência.
        nfseNacSemMovimento: aplic.filter((c) => c.situacao === 'adn-sem-movimento').length,
        nfseNacEntregue: aplic.filter((c) => c.situacao === 'adn-entregue').length,
    };
}
