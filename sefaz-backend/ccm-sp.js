// ============================================================================
// sefaz-backend/ccm-sp.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 O CCM SÓ-ZEROS ATRAVESSOU O BACKEND INTEIRO COMO SE FOSSE INSCRIÇÃO.
//
// ═══ O CASO ═════════════════════════════════════════════════════════════════
//
// 21/08, uma colaboradora, na LAV COMERCIO DE AUTOPECAS: *"ali onde deveria
// colocar o CCM de SP coloco uma sequência de 8 zeros"*. Os zeros são contorno
// ANTIGO da equipe, de quando o campo parecia obrigatório — e a régua nasceu
// naquele dia (#311), em `services/empresaDadosFiscaisSanitize.ts`.
//
// 29/08 a mesma empresa voltou, com outro sintoma: *"não está capturando as
// NFS-e de serviços tomados pelo cliente"*. E a causa é que a régua ficou onde
// nasceu: `'00000000'` sobrevive a `.replace(/\D/g,'')` e é **truthy**, então
// TODO leitor do backend que pergunta `if (!ccm)` recebe um "sim, tem CCM"
// sobre um campo que significa "não tem".
//
// ═══ O QUE CADA LEITOR FAZIA COM OS ZEROS ═══════════════════════════════════
//
// 🔴 **O PIOR É O ARQUIVO FISCAL**: o 0000 do EFD ICMS/IPI
// (`sped-fiscal-bloco0.js`) e o 0000 do EFD-Contribuições
// (`sped-contrib-bloco0.js`) escreviam `00000000` no campo **Inscrição
// Municipal** — ou seja, o app AFIRMAVA à Receita uma inscrição que não
// existe. Campo em branco é ausência; oito zeros é uma afirmação falsa, e essa
// é a diferença que este projeto paga caro.
//
// 🔴 **A CAPTURA SUMIA EM SILÊNCIO**: o `nfse-sp-portal-orchestrator` indexa as
// empresas POR CCM (`mapa.set(ccm, …)`) e o laço é dirigido pelo **dropdown de
// prestadores do portal**. Com a chave `'00000000'` a empresa entra no mapa,
// nunca casa com prestador nenhum, e **não gera sequer uma linha em
// `detalhes`** — não é "falhou", é como se ela não existisse. Foi assim que a
// LAV ficou sem as tomadas sem nada acusar.
//
// 🔴 **E A TELA AFIRMAVA O CONTRÁRIO**: em `empresa-status-routes.js`,
// `nfseSpAplicavel` cai em `!!emp.ccmSp` quando não há município cadastrado —
// então os zeros faziam o app DECIDIR que o trilho da capital se aplica —, e
// `capturaNfseSpOk = !!emp.ccmSp && !!emp.nfseSpAutorizadoEm` saía **true**,
// pintando `✓ NFSe SP` e **engolindo o bloqueio** *"falta Inscrição Municipal
// (CCM)"*, que é justamente a frase que resolveria o caso.
//
// ⚠️ E o túnel (`cadastro-central.js`) entregava os zeros aos apps irmãos como
// se fossem inscrição — cadastro central que propaga o contorno é pior que
// cadastro central nenhum.
//
// ═══ A DECISÃO ══════════════════════════════════════════════════════════════
//
// **Zero não é inscrição — é vazio, em TODO leitor.** A régua passa a ter um
// dono só, no backend (que é quem lê em nove lugares), e o `.ts` do sanitize
// IMPORTA daqui em vez de manter a cópia. O espelho escrito à mão em
// `empresas-perfil-routes.js` — que dizia, no próprio comentário, *"o backend
// não importa TS; mudar uma é mudar a outra"* — deixa de existir: era a segunda
// cópia se declarando segunda cópia.
//
// ⚠️ **NÃO se apaga o que já está gravado.** O app IGNORA os zeros na leitura,
// que é a régua desta casa desde 21/08 (`docCancelado`, `modeloDoDoc`,
// `direcaoEfetivaDoc`): campo gravado pode mentir, e quem responde é a régua da
// LEITURA. Varrer a base para reescrever cadastro seria mexer no que a equipe
// digitou sem ninguém pedir.
// ============================================================================

/** Só os dígitos — o CCM da capital é numérico (8 dígitos). */
const digitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * A régua dos SÓ-ZEROS, num lugar só (#311).
 *
 * `''`, `'0'`, `'00000000'`, `'000.000.00-0'` NÃO são inscrição: são o
 * contorno que a equipe digitava num campo que parecia obrigatório.
 *
 * ⚠️ Devolve o valor **ORIGINAL** quando ele vale (sem reformatar): quem
 * precisa de dígitos chama `ccmSpDaEmpresa`. Separar as duas coisas é o que
 * permite a tela mostrar o que a pessoa digitou e o arquivo levar o canônico.
 *
 * @returns {string|null} o valor, ou null quando equivale a vazio
 */
export function soZerosComoVazio(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    // `!/[1-9]/` cobre o caso em que a máscara esconde um dígito: um valor sem
    // nenhum algarismo significativo é vazio, tenha ele ponto, barra ou traço.
    return /^0*$/.test(digitos(s)) && !/[1-9]/.test(s) ? null : s;
}

/**
 * O CCM da empresa, CANÔNICO (só dígitos) — ou `''` quando ela não tem.
 *
 * 🚨 Lê as DUAS formas, e essa é metade do módulo: o modal Dados Fiscais grava
 * em `dadosFiscais.ccmSp` e o cadastro legado guarda `ccmSp` no topo. Leitor
 * que pergunta por uma só devolve "sem CCM" para metade da carteira — a
 * armadilha das duas formas, que nesta casa já mordeu quatorze vezes.
 *
 * @param {object} doc documento de `simples_empresas` / `lucro_empresas`
 * @returns {string} dígitos, ou '' quando não há inscrição
 */
export function ccmSpDaEmpresa(doc) {
    const bruto = doc?.dadosFiscais?.ccmSp ?? doc?.ccmSp;
    const valido = soZerosComoVazio(bruto);
    return valido == null ? '' : digitos(valido);
}

/** `true` quando a empresa TEM inscrição municipal da capital. */
export function temCcmSp(doc) {
    return ccmSpDaEmpresa(doc) !== '';
}

/**
 * O CCM como ele deve sair na GRAVAÇÃO: dígitos, e `''` quando os zeros
 * chegaram (que é a ordem de APAGAR — a lição do DARCY em 26/07: virar
 * `undefined` faz o `JSON.stringify` sumir com a chave e o valor velho fica
 * preso).
 *
 * ⚠️ Campo NUNCA tocado continua `undefined` — é o jeito de dizer "não mexe".
 */
export function ccmSpParaGravar(bruto) {
    if (bruto == null) return undefined;
    const valido = soZerosComoVazio(bruto);
    return valido == null ? '' : digitos(valido);
}
