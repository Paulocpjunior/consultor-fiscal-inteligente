// ============================================================================
// sefaz-backend/forma-do-segredo.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 UM DIA INTEIRO PERGUNTANDO "QUAL DOS DOIS TEXTOS VOCÊ COPIOU?" — e a
// resposta estava no próprio segredo gravado, do lado do app.
//
// 01-02/09. Os DOIS apps do Azure recusavam com `AADSTS7000215`, e o CFI
// repetia a frase da Microsoft — *"o que está gravado é o ID, não o VALOR"* —
// como se fosse diagnóstico. **Não é**: essa sentença vem colada em TODO
// 7000215, inclusive quando o segredo está certo e foi mandado para o app
// errado, ou quando a colagem veio truncada. O app afirmava a causa a partir
// de um texto padrão — é a mesma família do *"o segredo EXPIROU"* que a tela
// do Azure desmentiu dizendo 2028.
//
// 📌 E o que fechou a questão não foi ler a mensagem: foi MEDIR o que estava
// gravado. `graph-client-secret` e `graph-notificacoes-secret` tinham os dois
// **36 bytes, formato de GUID** — ou seja o *Secret ID*. A medição custou um
// comando; a leitura da mensagem custou o dia.
//
// ✂️ Este módulo faz essa medição DENTRO do app, e ele é o dono de "que FORMA
// tem o segredo que está gravado?".
//
// 🔒 **NADA DO CONTEÚDO SAI DAQUI.** Sai a forma, o comprimento e o
// diagnóstico — nunca o valor, nem um pedaço dele. É a mesma regra do
// `diagnostico-config-routes.js` (*"não expõe VALORES das envs"*): o que muda
// é que ele respondia só *"está preenchido?"*, que é STATUS, e esta régua
// responde *"o que está preenchido tem a forma certa?"*, que é RESULTADO.
//
// ⚠️ **SÓ ACUSA O QUE DÁ PARA PROVAR.** O *Secret ID* tem formato EXATO
// (GUID de 36 caracteres, só hexadecimal e hífen) e espaço/quebra de linha
// nunca pertence a um segredo — essas duas são provas. Todo o resto vira
// `'nao-reconhecida'`, que **não é acusação**: cravar "curto demais" ou
// "caractere estranho" por conta própria acusaria segredo VÁLIDO, e alarme
// sobre credencial correta é o jeito conhecido de a equipe desligar a trava.
// ============================================================================

/** O *Secret ID* do Azure é um GUID — e é ele que a tela deixa copiável para sempre. */
const FORMA_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Espaço, tabulação ou quebra de linha — nunca faz parte de um client secret. */
const TEM_ESPACO = /\s/;

/**
 * Que forma tem o segredo gravado.
 *
 * @param {unknown} valor  o segredo (nunca sai daqui)
 * @returns {{
 *   forma: 'vazio'|'id-secreto'|'com-espaco-ou-quebra'|'nao-reconhecida',
 *   caracteres: number,
 *   ehProblema: boolean,
 *   diagnostico: string|null
 * }}
 */
export function formaDoClientSecret(valor) {
    const bruto = valor == null ? '' : String(valor);

    if (bruto.trim() === '') {
        return {
            forma: 'vazio',
            caracteres: 0,
            ehProblema: true,
            diagnostico: 'Não há segredo gravado — a Microsoft recusa toda chamada.',
        };
    }

    // A colagem com espaço/quebra vem ANTES do formato: um GUID com espaço no
    // fim continua sendo o ID, e a ação (criar segredo novo e copiar o Valor)
    // é a mesma — mas um segredo VÁLIDO com espaço colado tem ação PRÓPRIA
    // (regravar sem o espaço), e as duas não podem virar a mesma frase.
    if (TEM_ESPACO.test(bruto)) {
        const semEspaco = bruto.replace(/\s/g, '');
        if (FORMA_GUID.test(semEspaco)) {
            return {
                forma: 'id-secreto',
                caracteres: bruto.length,
                ehProblema: true,
                diagnostico: 'O que está gravado é o ID do segredo (GUID de 36 caracteres), com espaço ou '
                    + 'quebra de linha junto — não é o Valor. É preciso criar um segredo NOVO no Azure e '
                    + 'copiar a coluna Valor no instante em que ela aparece.',
            };
        }
        return {
            forma: 'com-espaco-ou-quebra',
            caracteres: bruto.length,
            ehProblema: true,
            diagnostico: 'O segredo gravado tem espaço ou quebra de linha — a Microsoft compara caractere a '
                + 'caractere e recusa. Regrave o mesmo valor sem o espaço (a colagem costuma trazer um \\n no fim).',
        };
    }

    if (FORMA_GUID.test(bruto)) {
        return {
            forma: 'id-secreto',
            caracteres: bruto.length,
            ehProblema: true,
            diagnostico: 'O que está gravado é o ID do segredo (GUID de 36 caracteres), não o Valor dele. '
                + 'No Azure o Secret ID fica copiável para sempre e o Valor aparece SÓ no instante da criação — '
                + 'por isso quem volta na tela para "pegar o segredo" copia o campo errado. Não há como '
                + 'recuperar o Valor: crie um segredo NOVO e copie a coluna Valor na hora.',
        };
    }

    // ⚠️ Aqui o app NÃO afirma que está certo — ele afirma que não reconhece a
    // forma. Segredo com a forma certa e do app ERRADO recusa igual, e isso
    // nenhuma medição de forma alcança.
    return {
        forma: 'nao-reconhecida',
        caracteres: bruto.length,
        ehProblema: false,
        diagnostico: null,
    };
}

/**
 * As envs de client secret do Azure, achadas por VARREDURA.
 *
 * ⚠️ Por varredura e não por lista: lista envelhece na primeira credencial
 * nova, e envelhece em SILÊNCIO. O recorte `_CLIENT_SECRET` é a convenção de
 * nome do Azure — `SERPRO_CONSUMER_SECRET` fica de fora de propósito, porque
 * lá um GUID não prova nada.
 */
export function segredosDeClientSecret(env) {
    const e = env || {};
    return Object.keys(e).filter((k) => /_CLIENT_SECRET$/.test(k)).sort();
}
