// ============================================================================
// ♻️ RELER PARTICIPANTE, ENDEREÇO E MUNICÍPIO — o dono da rodada e da frase
//
// 18/09, Paulo, J.N. VINATEX · 08/2026, com o print da aba ✏️ CFOP por nota:
// *"no consultor não tem essa opção — só tem esses"*. Ele estava no lugar que
// o AVISO mandou (*"rode o ♻️ Reler participante e município dos XMLs em
// Relatórios → ✏️ CFOP por nota"*), e lá havia três botões: **Reler XMLs
// guardados**, **Reler itens dos XMLs** e **Reler cabeçalho dos CT-e**.
//
// 🔴 **MEDIDO: o botão existia numa aba que aquela empresa NUNCA abre.** Ele
// mora no painel da 🌾 DIPAM/Produtor rural, dentro do bloco de *Pendências*,
// e só renderiza quando há pendência de **produtor rural** (`semMunicipio > 0
// || semContraparte > 0`). A VINATEX é comércio de tecidos: o bloco inteiro
// não aparece, e a ferramenta que recupera os 732 endereços do 0150 era
// **inalcançável** para ela.
//
// 🚨 É o achado 18 (21/08) na forma mais cara — *aviso que aponta um lugar que
// não resolve* —, e é a MESMA régua que ficou escrita ontem no caso do 🚚
// (17/09): **aviso que manda rodar um BOTÃO se prova contra o botão**. Repeti o
// defeito no dia seguinte, e desta vez a frase apontava a aba certa e faltava
// o botão nela.
//
// ✂️ A correção não é trocar o texto para "🌾 DIPAM": lá ele também não
// alcança. É pôr a ferramenta ONDE A PENDÊNCIA NASCE — a ✏️ CFOP por nota já é
// a casa dos outros três ♻️ do acervo, e o backfill não tem nada de produtor
// rural (ele varre `documentos_fiscais` por empresa + competência).
//
// 📌 **DUAS PORTAS, UMA RÉGUA.** O painel da 🌾 continua com o dele — é o
// caminho de quem está resolvendo pendência de produtor. O que não pode
// duplicar é a FRASE: duas telas descrevendo o mesmo resultado divergem no
// primeiro campo novo, e foi assim que o "0 recuperadas · 664 já tinham"
// sobreviveu ao lado de 427 pendências (13/08). Por isso a frase mora aqui.
// ============================================================================

/** O que a rota `/api/admin/dipam/reler-municipios` devolve. */
export interface ReleituraParticipantes {
    examinadas: number;
    preenchidas: number;
    semXml: number;
    jaTinham: number;
    ganharamMunicipio: number;
    ganharamFornecedor: number;
    /** Os que ganharam LOGRADOURO — é este que responde a recusa 0150.10. */
    ganharamEndereco: number;
    semDadoNoXml: number;
    /**
     * Documentos da competência que não couberam no lote. `-1` = há mais e a
     * contagem falhou; `0` é resposta ("a fila acabou"), nunca default.
     */
    restaram: number;
    acao?: string | null;
}

const ZERO: ReleituraParticipantes = {
    examinadas: 0, preenchidas: 0, semXml: 0, jaTinham: 0,
    ganharamMunicipio: 0, ganharamFornecedor: 0, ganharamEndereco: 0,
    semDadoNoXml: 0, restaram: 0, acao: null,
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Soma duas rodadas do encadeamento.
 *
 * ⚠️ O `restaram` NÃO se soma — ele é o estado de AGORA (quanto falta depois
 * desta rodada). Somá-lo faria o acumulado crescer a cada volta e a tela
 * afirmar uma fila que já foi drenada.
 */
export function acumular(
    a: Partial<ReleituraParticipantes>,
    b: Partial<ReleituraParticipantes>,
): ReleituraParticipantes {
    return {
        examinadas: n(a.examinadas) + n(b.examinadas),
        preenchidas: n(a.preenchidas) + n(b.preenchidas),
        semXml: n(a.semXml) + n(b.semXml),
        jaTinham: n(a.jaTinham) + n(b.jaTinham),
        ganharamMunicipio: n(a.ganharamMunicipio) + n(b.ganharamMunicipio),
        ganharamFornecedor: n(a.ganharamFornecedor) + n(b.ganharamFornecedor),
        ganharamEndereco: n(a.ganharamEndereco) + n(b.ganharamEndereco),
        semDadoNoXml: n(a.semDadoNoXml) + n(b.semDadoNoXml),
        restaram: b.restaram === undefined ? n(a.restaram) : Number(b.restaram),
        acao: b.acao ?? a.acao ?? null,
    };
}

/**
 * A frase do resultado, POR CAUSA.
 *
 * "0 recuperadas" sozinho não responde nada, e já foi pior que isso: em 13/08
 * o texto dizia "já tinham" sobre documentos que o backfill nem tinha aberto.
 * Cada número aqui tem uma AÇÃO diferente do lado.
 */
export function fraseDoResultado(r: Partial<ReleituraParticipantes>): string {
    const partes = [
        // O ENDEREÇO vem primeiro: é a recusa que trouxe o dono aqui.
        n(r.ganharamEndereco) ? `${n(r.ganharamEndereco)} ganharam o ENDEREÇO do 0150` : '',
        n(r.ganharamFornecedor) ? `${n(r.ganharamFornecedor)} ganharam o participante` : '',
        n(r.ganharamMunicipio) ? `${n(r.ganharamMunicipio)} ganharam o município` : '',
        n(r.jaTinham) ? `${n(r.jaTinham)} já relida(s) nesta versão do leitor` : '',
        n(r.semDadoNoXml)
            ? `${n(r.semDadoNoXml)} relida(s) e o XML REALMENTE não traz o dado — aí a correção é no cadastro `
              + 'do participante, não na releitura'
            : '',
        n(r.semXml)
            ? `${n(r.semXml)} sem arquivo guardado (buraco de captura — 📋 Status por Empresa)`
            : '',
    ].filter(Boolean);

    const corpo = partes.length
        ? `♻️ ${n(r.examinadas)} examinada(s): ${partes.join(' · ')}.`
        : `♻️ ${n(r.examinadas)} examinada(s) — nada a recuperar nesta competência.`;

    // Recuperou endereço ⇒ o arquivo MUDA, e o PVA guarda a escrituração
    // importada: regerar sem apagar a competência lá deixa o número velho na
    // tela (a lição dos quatro dias da PWR, 25/08).
    const regerar = n(r.ganharamEndereco) || n(r.preenchidas)
        ? ' Regere o SPED — e, no PVA, apague a competência antes de importar o arquivo novo.'
        : '';

    return corpo + regerar + (r.acao ? ` ${r.acao}` : '');
}

export interface EncadeamentoOpts {
    /** Teto de rodadas — sem ele, backend que não progride vira laço infinito. */
    maxRodadas?: number;
    /** Chamado a cada rodada, para o acumulado subir ao vivo na tela. */
    aoProgredir?: (acumulado: ReleituraParticipantes, rodada: number) => void;
}

/**
 * Encadeia as rodadas até a fila zerar.
 *
 * 🚨 **O TETO DE LOTE É DO APP, NUNCA DA PESSOA** (a régua de 02/09, do teto
 * da reconferência): a competência da VINATEX tem **3501 documentos** e o
 * backfill varre 1000 por direção. Deixar o colaborador clicar quatro vezes é
 * entregar uma trava que, na escala real, ninguém aciona — e o carimbo de
 * versão faz cada rodada avançar de verdade, porque o já-relido é pulado.
 *
 * ⚠️ **PARA QUANDO NÃO PROGRIDE.** Rodada que não examina nada e não drena a
 * fila significa backend parado: insistir seria o laço infinito no navegador
 * do colaborador.
 */
export async function encadearReleitura(
    rodada: () => Promise<ReleituraParticipantes>,
    { maxRodadas = 12, aoProgredir }: EncadeamentoOpts = {},
): Promise<{ total: ReleituraParticipantes; rodadas: number; parouPorTeto: boolean }> {
    let total: ReleituraParticipantes = { ...ZERO };
    let rodadas = 0;

    while (rodadas < maxRodadas) {
        const r = await rodada();
        rodadas++;
        const antes = total.examinadas;
        total = acumular(total, r);
        aoProgredir?.(total, rodadas);

        // Fila drenada — o caso normal e o fim do laço.
        if (Number(r.restaram) === 0) return { total, rodadas, parouPorTeto: false };
        // Não progrediu: nada examinado nesta volta. Continuar só repetiria.
        if (total.examinadas === antes) return { total, rodadas, parouPorTeto: false };
    }

    return { total, rodadas, parouPorTeto: true };
}
