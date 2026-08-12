/**
 * services/toastTom.ts — o TOM do toast sai da MENSAGEM, não do componente.
 *
 * Paulo, 12/08/2026: o envio do DAS por WhatsApp falhou ("template não existe
 * nesse idioma") e o toast apareceu com um ✓ VERDE do lado. O componente pintava
 * check verde em TUDO — sucesso, alerta e falha — porque o tom nunca foi um
 * parâmetro.
 *
 * É a regra da casa quebrada no lugar mais visível: farol honesto vale pra
 * TODO painel, e um check verde ao lado de "Falha no envio" é a definição de
 * farol mentiroso. Pior: o colaborador lê o ícone antes do texto.
 *
 * ─── POR QUE CLASSIFICAR PELO TEXTO ─────────────────────────────────────────
 *
 * O ideal seria cada chamada passar o tom. Só que `onShowToast(msg)` é chamado
 * em dezenas de pontos, e enquanto UM deles não passar, o padrão volta a
 * mentir. Então a régua é a mensagem, com uma decisão importante:
 *
 *   MENSAGEM QUE NÃO SE DECLARA NÃO VIRA SUCESSO — vira NEUTRA.
 *
 * Um ✓ verde é uma AFIRMAÇÃO ("deu certo"). Afirmar por omissão é exatamente o
 * defeito que estamos corrigindo; na dúvida, o ícone é neutro e o texto fala.
 */
export type ToastTom = 'sucesso' | 'alerta' | 'erro' | 'neutro';

const norm = (s: string) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Falha explícita — vence tudo, inclusive quando a frase também tem "enviado". */
const ERRO = /(^|\s)(falha|falhou|erro|nao foi possivel|nao pode|nao consegui|nao deu|recusad|rejeitad|bloquead|indisponivel|expirad)/;
/** Alerta: aconteceu, mas com ressalva. */
const ALERTA = /(atencao|pendente|parcial|divergen|sem prova|nao prova|confira|verifique|precisa de|incompleto|em andamento|aguardando)/;
/** Sucesso: o ato se completou e há prova. */
const SUCESSO = /(sucesso|enviad|transmitid|salvo|salva|gerad|concluid|atualizad|importad|marcad|registrad|copiad|baixa dada|removid|excluid)/;

/**
 * Tom de um toast a partir do texto.
 *
 * A ordem é deliberada: ERRO vence ALERTA, que vence SUCESSO. "Falha no envio
 * por WhatsApp: template não existe" contém "envio" — classificar por sucesso
 * primeiro devolveria verde para uma falha, que é o bug que originou isto.
 */
export function tomDoToast(mensagem: string): ToastTom {
    const m = norm(mensagem);
    if (!m.trim()) return 'neutro';
    // Emoji/sinal explícito na frase manda mais que qualquer palavra.
    if (/✗|🛑|❌/.test(mensagem)) return 'erro';
    if (/⚠️|⚠/.test(mensagem)) return 'alerta';
    if (ERRO.test(m)) return 'erro';
    if (ALERTA.test(m)) return 'alerta';
    if (/✓|✅/.test(mensagem)) return 'sucesso';
    if (SUCESSO.test(m)) return 'sucesso';
    return 'neutro';
}

export const TOAST_ESTILO: Record<ToastTom, {
    icone: string; corIcone: string; fundoIcone: string; borda: string; rotulo: string;
}> = {
    sucesso: {
        icone: '✓', rotulo: 'Sucesso',
        corIcone: 'text-green-700 dark:text-green-300',
        fundoIcone: 'bg-green-100 dark:bg-green-900/30',
        borda: 'border-green-200 dark:border-green-900/40',
    },
    alerta: {
        icone: '!', rotulo: 'Atenção',
        corIcone: 'text-amber-700 dark:text-amber-300',
        fundoIcone: 'bg-amber-100 dark:bg-amber-900/30',
        borda: 'border-amber-300 dark:border-amber-800',
    },
    erro: {
        icone: '✕', rotulo: 'Falha',
        corIcone: 'text-red-700 dark:text-red-300',
        fundoIcone: 'bg-red-100 dark:bg-red-900/30',
        borda: 'border-red-300 dark:border-red-800',
    },
    neutro: {
        icone: 'i', rotulo: 'Aviso',
        corIcone: 'text-slate-600 dark:text-slate-300',
        fundoIcone: 'bg-slate-100 dark:bg-slate-700',
        borda: 'border-slate-200 dark:border-slate-700',
    },
};
