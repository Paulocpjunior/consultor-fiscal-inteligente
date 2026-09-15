/**
 * documentosVazioMotivo.ts
 *
 * 🚨 LISTA VAZIA DE SAÍDA: A PRIMEIRA PARADA MUDA COM O MODELO.
 *
 * (15/09, Paulo, PRONTO SOCORRO 0896 · 08/2026: *"essa empresa tem NFCE, mas o
 * relatório de saída mostra todas as notas, porém na base não aparece essas
 * notas de NFCE, não deveria aparecer?"*). O filtro estava em NFCe + Saída e a
 * tela respondia com a frase do modelo 55: *"NF-e emitidas pela empresa não são
 * distribuídas por esse canal — importe-as pela aba Importação Manual"*.
 *
 * Duas coisas erradas na mesma frase, e as duas mandam procurar no lugar que
 * não resolve — o achado 18 (21/08):
 *
 *  1. a aba nomeada **não existe com esse nome**: o rótulo real é
 *     `📥 Manual & Cofre (saída 55)`, e quem lê "saída 55" com o filtro em
 *     NFCe conclui, com razão, que aquilo não serve para o modelo 65;
 *  2. existe uma aba PRÓPRIA para NFC-e — `🧾 NFC-e Saída (SP)` — e a frase
 *     não a menciona. Quem traz NFC-e é o **SAE-NFC-e**, que conecta com o A1
 *     do PRÓPRIO emitente; com A3 a chave vive no cartão e não roda no Cloud
 *     Run, então quem traz é o Agente A3 (a medição de 02/09, MV LIDER).
 *
 * ⚠️ E A RESSALVA É O QUE IMPEDE A FRASE DE AFIRMAR DEMAIS: zero aqui **não
 * prova que faltam notas** — a empresa pode simplesmente não emitir aquele
 * modelo. O que a tela diz é por qual PORTA elas entrariam, nunca que houve
 * nota perdida. Dizer "faltam notas" sobre quem não emite é alarme sobre
 * estado correto, que é o jeito conhecido de a equipe parar de ler a tela.
 *
 * Módulo PURO de propósito: régua dentro de `.tsx` é régua sem prova (a lição
 * do E116, do `rotina-empresa-insumo` e do `reconferenciaEncadeada`). Os
 * rótulos de aba saem de `CentralDocumentosFiscais.tsx` e um teste os cobra de
 * lá — aviso que aponta aba renomeada envelhece em SILÊNCIO, levando a pessoa
 * ao lugar errado sem nada acusar.
 */

/** Causa da lista vazia — id estável, para teste e para a tela não decidir. */
export type CausaVazioSaida = 'saida-nfce' | 'saida-nfse' | 'saida-cte' | 'saida-nfe';

export interface MotivoVazioSaida {
    causa: CausaVazioSaida;
    /** Frase principal: o FATO, sem causa inventada. */
    titulo: string;
    /** Por que o documento não chega sozinho por este filtro. */
    explicacao: string;
    /** Onde se resolve — SEMPRE uma aba que existe, nomeada como ela aparece. */
    acao: string;
    /** Ausência não é prova: o que este zero NÃO afirma. */
    ressalva: string;
}

/** Rótulos EXATOS das abas, como o menu os escreve. */
export const ABA_NFCE_SAIDA = '🛰️ Captura → 🧾 NFC-e Saída (SP)';
export const ABA_STATUS_EMPRESA = '🛰️ Captura → 📋 Status por Empresa';
export const ABA_PORTAL_SP = '🛰️ Captura → 🛰️ Portal SP';
export const ABA_MANUAL_COFRE = '📥 Importar → 📥 Manual & Cofre';
export const ABA_NFSE_PDF = '📥 Importar → NFSe (PDF)';
export const ABA_NFSE_CSV = '📥 Importar → NFSe SP (CSV)';

const RESSALVA_PADRAO =
    'Zero aqui não afirma que faltam notas: a empresa pode não emitir esse modelo. '
    + 'O que esta tela diz é por qual porta elas entrariam.';

/**
 * Decide a frase da lista VAZIA quando o filtro é de SAÍDA.
 *
 * Devolve `null` para qualquer outro recorte — entrada e busca sem direção
 * continuam com as frases que a tela já tinha. Inventar causa ali seria
 * afirmar sobre um caso que este módulo não mediu.
 */
export function motivoDaListaVaziaDeSaida(filtros: {
    direcao?: string | null;
    tipoDoc?: string | null;
}): MotivoVazioSaida | null {
    if (String(filtros?.direcao || '').toLowerCase() !== 'saida') return null;

    const tipo = String(filtros?.tipoDoc || '').trim().toLowerCase();

    if (tipo === 'nfce') {
        return {
            causa: 'saida-nfce',
            titulo: 'Nenhuma NFC-e de saída encontrada para este filtro.',
            explicacao:
                'A Distribuição DF-e da SEFAZ não entrega nota emitida pela própria empresa, e recusa o '
                + 'modelo 65 mesmo quando se pergunta pela chave. Quem traz NFC-e é o SAE-NFC-e, que se '
                + 'conecta com o A1 do PRÓPRIO emitente.',
            acao:
                `Rode a captura em ${ABA_NFCE_SAIDA}. Com certificado A3 a chave fica dentro do cartão e `
                + 'não roda no servidor: quem traz é o Agente A3, na máquina onde o cartão está. O '
                + `certificado de cada empresa aparece em ${ABA_STATUS_EMPRESA}. O XML do emissor também `
                + `entra por ${ABA_MANUAL_COFRE}, que aceita o modelo 65 apesar de o rótulo citar o 55.`,
            ressalva: RESSALVA_PADRAO,
        };
    }

    if (tipo === 'nfse') {
        return {
            causa: 'saida-nfse',
            titulo: 'Nenhuma NFS-e de saída (serviço prestado) encontrada para este filtro.',
            explicacao:
                'NFS-e não passa pela Distribuição DF-e: ela é MUNICIPAL. Em São Paulo capital ela vem '
                + 'pelo portal da Prefeitura, que usa CCM e autorização, sem certificado. Fora da capital '
                + 'o caminho é o Padrão Nacional ou o portal do próprio município.',
            acao:
                `Confira ${ABA_PORTAL_SP}. Para trazer à mão, use ${ABA_NFSE_PDF} ou ${ABA_NFSE_CSV}.`,
            ressalva: RESSALVA_PADRAO,
        };
    }

    if (tipo === 'cte') {
        return {
            causa: 'saida-cte',
            titulo: 'Nenhum CT-e de saída encontrado para este filtro.',
            explicacao:
                'CT-e de saída é o que a própria empresa emitiu, e a Distribuição DF-e não entrega '
                + 'documento emitido por ela. A captura automática de CT-e traz o frete que a empresa '
                + 'TOMA, em que ela é a contraparte.',
            acao: `Traga o XML do emissor por ${ABA_MANUAL_COFRE}.`,
            ressalva: RESSALVA_PADRAO,
        };
    }

    return {
        causa: 'saida-nfe',
        titulo: 'Nenhuma nota de saída encontrada para este filtro.',
        explicacao:
            'A captura automática usa a Distribuição DF-e da SEFAZ, que entrega apenas notas onde a '
            + 'empresa é DESTINATÁRIA (entrada) e os eventos. Nota emitida pela empresa não sai por '
            + 'esse canal.',
        acao:
            `Traga o XML do emissor por ${ABA_MANUAL_COFRE} ou pelo SharePoint. O cofre de e-mail `
            + 'também recebe, quando o escritório está no autXML da nota.',
        ressalva: RESSALVA_PADRAO,
    };
}
