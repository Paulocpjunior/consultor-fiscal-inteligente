// ============================================================================
// 🚨 "✓ CAPTURA OK" AFIRMADO A PARTIR DE UM CAMPO DE CADASTRO — em 202 empresas
//
// O painel 📋 Status de Captura por Empresa decidia assim:
//
//     const temA3Proprio = tipoCert === 'A3' && certUploaded;
//     const capturaNfeOk = ... || temA3Proprio || ...;   // ⇒ "✓ Captura OK"
//
// Ou seja: alguém marcou **A3** no cadastro e subiu o arquivo ⇒ a tela AFIRMA
// que a captura está OK. Nada ali olha se o agente local `cfi-a3` — que é quem
// de fato captura essas empresas, porque o cron em nuvem não as alcança —
// alguma vez entregou um documento.
//
// É a **primeira regra permanente deste projeto invertida**: *"validação por
// RESULTADO, não por status"*. E é a mesma família do trilho NFS-e SP que
// ficou semanas VERDE com 0 sucessos e 121 falhas.
//
// 🔴 O custo é duplo, e a segunda metade é minha: em 23/08 o farol de lastro e
// a Rotina do Mês passaram a mandar essas 202 empresas para *"confira se o
// agente cfi-a3 rodou (📋 Status por Empresa)"* — e a tela apontada respondia
// **✓ Captura OK** para todas elas, tivesse o agente rodado ou não. Aviso que
// aponta um lugar que não responde é o achado 18 de 21/08 outra vez.
//
// ⚠️ **O QUE O APP SABE, E O QUE ELE NÃO SABE.** O agente grava
// `sefaz_state/{cnpj}.ultimaSync` + `ultimaSyncFonte: 'agent-a3'` — mas
// **só quando trouxe NSU** (`agent-routes.js`: a gravação está dentro do
// `if (ultNSU)`). Então a ausência prova que o agente **nunca ENTREGOU
// documento desta empresa**; ela NÃO prova que ele não rodou (rodada sem
// movimento não deixa rastro). A frase diz exatamente isso — `ausência não é
// prova` é regra da casa, e afirmar "o agente não rodou" seria afirmar o que
// não se mediu.
//
// ⚠️ **E POR ISSO É ÂMBAR, NÃO VERMELHO.** Vermelho afirmaria mais do que o
// app sabe. O que não pode é continuar **VERDE**: ausência de alarme não pode
// ser indistinguível de "está tudo certo".
//
// ⚠️ **NENHUM SLA INVENTADO.** O agente roda na máquina de alguém e o app não
// conhece a agenda dele — então "entregou há 40 dias" NÃO vira veredito de
// "parado". A régua entrega a DATA e quantos dias faz; quem julga é quem lê.
// Cravar uma janela aqui seria inventar prazo, que é o que este projeto se
// recusa a fazer com vencimento, com município e com código de tabela.
// ============================================================================

/** O documento de `sefaz_state` foi escrito pelo agente local, não pelo cron. */
export const FONTE_AGENTE_A3 = 'agent-a3';

const DIA_MS = 24 * 60 * 60 * 1000;

const fmtDataBr = (ms) => {
    if (!Number.isFinite(Number(ms))) return null;
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

/**
 * A empresa é capturada pelo agente local `cfi-a3` — e ele já entregou algo?
 *
 * Devolve `nao-se-aplica` para quem não é A3: a régua não opina sobre os
 * outros caminhos (A1 próprio, A1 da mesma raiz, cert do escritório), que
 * continuam decididos onde já eram.
 */
export function coberturaAgenteA3({
    tipoCert,
    certUploaded = false,
    ultimaSyncMs = null,
    ultimaSyncFonte = null,
    agoraMs = Date.now(),
} = {}) {
    const ehA3 = tipoCert === 'A3' && !!certUploaded;
    if (!ehA3) {
        return {
            situacao: 'nao-se-aplica', cor: 'neutro', ehA3: false,
            texto: null, acao: null, entregueEm: null, diasDesdeEntrega: null,
        };
    }

    // Sync de OUTRA fonte (o cron em nuvem, numa marcação antiga) não prova o
    // agente. Perguntar só pela data faria a captura de antes da marcação A3
    // passar por entrega do agente — a armadilha das duas formas, aqui entre
    // dois ESCRITORES do mesmo campo.
    const doAgente = ultimaSyncFonte === FONTE_AGENTE_A3
        && Number.isFinite(Number(ultimaSyncMs));

    if (!doAgente) {
        return {
            situacao: 'a3-sem-entrega',
            cor: 'atencao',
            ehA3: true,
            entregueEm: null,
            diasDesdeEntrega: null,
            texto: 'Capturada pelo agente local cfi-a3 — que nunca entregou documento desta empresa.',
            acao: 'Rode o agente cfi-a3 para esta empresa. ⚠️ Isto não prova que ele não rodou: '
                + 'rodada sem movimento não deixa registro — prova que documento nenhum chegou por ele.',
        };
    }

    const ms = Number(ultimaSyncMs);
    const dias = Math.max(0, Math.floor((Number(agoraMs) - ms) / DIA_MS));
    const data = fmtDataBr(ms);
    return {
        situacao: 'a3-entregue',
        cor: 'ok',
        ehA3: true,
        entregueEm: ms,
        diasDesdeEntrega: dias,
        // A DATA é o produto — o app não conhece a agenda do agente, então não
        // grada "recente" × "parado". Quem lê julga.
        texto: `Capturada pelo agente local cfi-a3 · última entrega em ${data}`
            + `${dias > 0 ? ` (há ${dias} dia${dias === 1 ? '' : 's'})` : ' (hoje)'}.`,
        acao: null,
    };
}

/** Contagem para o cabeçalho do painel — sem entrega é o número que interessa. */
export function resumirCoberturaA3(coberturas) {
    const lista = Array.isArray(coberturas) ? coberturas : [];
    const doA3 = lista.filter((c) => c?.ehA3);
    return {
        a3Total: doA3.length,
        a3SemEntrega: doA3.filter((c) => c.situacao === 'a3-sem-entrega').length,
        a3ComEntrega: doA3.filter((c) => c.situacao === 'a3-entregue').length,
    };
}
