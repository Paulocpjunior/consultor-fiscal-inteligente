// ============================================================================
// sefaz-backend/captura-nfse-sp-cobertura.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 "✓ NFSe SP" AFIRMADO A PARTIR DE DOIS CAMPOS DE CADASTRO.
//
// 29/08, Paulo, na LAV COMERCIO DE AUTOPECAS: *"foi detectado que não está
// capturando as NFS-e de serviços tomados pelo cliente e isso já deveria ter
// sido resolvido"*. A linha de status da empresa dizia, no mesmo print,
// `✓ NFSe SP · ✓ Captura OK`.
//
// A decisão era esta, em `empresa-status-routes.js`:
//
//     capturaNfseSpOk = !!emp.ccmSp && !!emp.nfseSpAutorizadoEm;
//
// Ou seja: **alguém preencheu o CCM e marcou a data de autorização ⇒ a tela
// AFIRMA que a captura está OK.** Nada ali olha se o trilho alguma vez baixou
// um CSV desta empresa.
//
// É a **primeira regra permanente deste projeto invertida** — *"validação por
// RESULTADO, não por status"* — e é literalmente a mesma família do trilho
// NFS-e SP que ficou semanas verde com 0 sucessos e 121 falhas, e do
// `temA3Proprio` que pintava 202 empresas de verde em 23/08
// (`captura-a3-cobertura.js`, de quem este módulo é irmão).
//
// ═══ O QUE O APP SABE, E O QUE ELE NÃO SABE ═════════════════════════════════
//
// O `nfse-sp-portal-orchestrator` grava, por CNPJ, em `nfsesp_portal_state`:
// `ultimaSync`, `ultimoPeriodo`, `prestadasUlt`, `tomadasUlt`, `erroPrestadas`,
// `erroTomadas`. Isso é mais do que o agente A3 entrega — dá para distinguir
// **três** fatos que pedem ações diferentes:
//
//  · **nunca visitada** — não há documento de estado. O laço do portal é
//    dirigido pelo DROPDOWN de prestadores e cruza com o nosso cadastro POR
//    CCM: quem não casa não gera sequer uma linha de `detalhes`. Não é
//    "falhou", é como se a empresa não existisse. Foi este o caso da LAV.
//  · **rodou e ERROU** — o download tem mensagem de erro gravada. Aqui o
//    número zero não diz nada sobre o movimento.
//  · **rodou e trouxe zero** — resposta LEGÍTIMA: a empresa pode não ter tido
//    nota no período. É o único caso em que "0 notas" não é alarme.
//
// ⚠️ **ZERO NOTAS NÃO É FALHA, e é por isso que o verde continua existindo.**
// Empresa de comércio tem meses sem NFS-e tomada — pintar de âmbar por isso
// seria alarme que ninguém consegue apagar, que é o jeito conhecido de a
// equipe parar de olhar o farol (a lição do aluguel na Rotina, 27/08).
//
// ⚠️ **NUNCA VISITADA É ÂMBAR, NÃO VERMELHO.** Vermelho afirmaria que o trilho
// está quebrado; o que o app mediu é que ele **nunca entregou nada desta
// empresa** — o que pode ser CCM que não casa com o portal, autorização que a
// empresa nunca concluiu do lado dela, ou trilho que ainda não rodou desde o
// cadastro. A frase diz as três, porque a primeira parada é diferente em cada.
//
// ⚠️ **NENHUM SLA INVENTADO.** O cron tem agenda, mas "entregou há 40 dias"
// NÃO vira veredito de "parado": a régua entrega a DATA e quantos dias faz, e
// quem julga é quem lê. Cravar janela aqui seria inventar prazo — o que esta
// casa se recusa a fazer com vencimento, município e código de tabela.
// ============================================================================

const DIA_MS = 24 * 60 * 60 * 1000;

const fmtDataBr = (ms) => {
    if (!Number.isFinite(Number(ms))) return null;
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

/**
 * O trilho do portal de SP já ENTREGOU para esta empresa?
 *
 * Devolve `nao-se-aplica` para quem não é da capital: a régua não opina sobre
 * o Padrão Nacional (ADN), que é o caminho das outras cidades e continua
 * decidido onde já era.
 *
 * @param {object} p
 * @param {boolean} p.aplicavel        o trilho da capital vale para esta empresa
 * @param {object|null} p.state        doc de `nfsesp_portal_state/{cnpj}`
 * @param {number} [p.agoraMs]
 */
export function coberturaNfseSpPortal({ aplicavel, state = null, agoraMs = Date.now() } = {}) {
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
            situacao: 'nfsesp-sem-entrega',
            cor: 'atencao',
            aplicavel: true,
            entregou: false,
            entregueEm: null,
            diasDesdeEntrega: null,
            texto: 'Trilho do portal da Prefeitura de SP — que nunca baixou nota desta empresa.',
            // 🚨 As três causas vão NOMEADAS porque a primeira parada é outra
            // em cada uma. "Confira a captura" seria mandar procurar.
            acao: 'O laço do portal cruza o dropdown de prestadores com o nosso cadastro pelo CCM: '
                + 'confira se a Inscrição Municipal (CCM) em Dados Fiscais é a MESMA que aparece no portal, '
                + 'se a empresa concluiu a autorização do escritório em nfe.prefeitura.sp.gov.br, e se o cron '
                + 'do portal já rodou desde o cadastro. Enquanto não casar, ela é pulada sem gerar erro.',
        };
    }

    const dias = Math.max(0, Math.floor((Number(agoraMs) - ms) / DIA_MS));
    const data = fmtDataBr(ms);
    const quando = `última rodada em ${data}${dias > 0 ? ` (há ${dias} dia${dias === 1 ? '' : 's'})` : ' (hoje)'}`;
    const erros = [state?.erroPrestadas, state?.erroTomadas].filter(Boolean);

    if (erros.length) {
        return {
            situacao: 'nfsesp-com-erro',
            cor: 'atencao',
            aplicavel: true,
            entregou: false,
            entregueEm: ms,
            diasDesdeEntrega: dias,
            // ⚠️ O erro da Prefeitura vai INTEIRO: a mensagem dela é o que diz
            // se foi sessão, WAF ou período — deduzir aqui mandaria a pessoa
            // ao lugar errado.
            texto: `Portal de SP · ${quando} · o download falhou: ${erros.join(' · ')}`,
            acao: 'O número de notas desta empresa não diz nada enquanto o download falhar. '
                + 'Veja a rodada em Central de XMLs → Captura → Portal SP.',
            prestadasUlt: state?.prestadasUlt ?? null,
            tomadasUlt: state?.tomadasUlt ?? null,
        };
    }

    const prest = Number(state?.prestadasUlt);
    const tom = Number(state?.tomadasUlt);
    const n = (v) => (Number.isFinite(v) ? v : 0);
    // ⚠️ ZERO É RESPOSTA aqui: o portal respondeu e não havia nota no período.
    // Empresa de comércio tem meses assim, e acusar seria alarme sem ação.
    return {
        situacao: 'nfsesp-entregue',
        cor: 'ok',
        aplicavel: true,
        entregou: true,
        entregueEm: ms,
        diasDesdeEntrega: dias,
        prestadasUlt: Number.isFinite(prest) ? prest : null,
        tomadasUlt: Number.isFinite(tom) ? tom : null,
        texto: `Portal de SP · ${quando} · ${n(prest)} prestada(s) e ${n(tom)} tomada(s) na última rodada`
            + `${state?.ultimoPeriodo?.anoMes ? ` (${state.ultimoPeriodo.anoMes})` : ''}.`,
        acao: null,
    };
}

/** Contagem para o cabeçalho do painel — sem entrega é o número que interessa. */
export function resumirCoberturaNfseSp(coberturas) {
    const lista = Array.isArray(coberturas) ? coberturas : [];
    const aplic = lista.filter((c) => c?.aplicavel);
    return {
        nfseSpTotal: aplic.length,
        nfseSpSemEntrega: aplic.filter((c) => c.situacao === 'nfsesp-sem-entrega').length,
        nfseSpComErro: aplic.filter((c) => c.situacao === 'nfsesp-com-erro').length,
        nfseSpEntregue: aplic.filter((c) => c.situacao === 'nfsesp-entregue').length,
    };
}
