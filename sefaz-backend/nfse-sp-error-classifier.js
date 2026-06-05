// ============================================================================
// nfse-sp-error-classifier.js
//
// Modulo PURO — classifica erros do login headless NFSe SP em categorias com
// significado operacional, e define se a categoria justifica retry.
//
// Categorias:
//   - manutencao       portal 5xx / "em manutencao" no body — retry vale
//   - timeout-rede     navigation timeout / ECONN* — retry vale
//   - selector-mudou   PMSP_NFeID ausente / botao ENTRAR sumiu — NAO retry
//   - cert-rejeitado   redirect /relogin.aspx / aviso — NAO retry
//   - desconhecido     nao classificado (NAO retry pra nao loopar a toa)
//
// Vive separado de nfse-sp-headless-login.js (que importa playwright +
// secret-manager) pra ser testavel em jest sem puxar essas dependencias.
// ============================================================================

export class HeadlessLoginError extends Error {
    constructor(tipo, mensagem, opts = {}) {
        super(`[${tipo}] ${mensagem}`);
        this.name = 'HeadlessLoginError';
        this.tipo = tipo;
        this.tentativas = opts.tentativas || 1;
        this.ultimaMensagem = opts.ultimaMensagem || mensagem;
        this.retentavel = ['manutencao', 'timeout-rede'].includes(tipo);
    }
}

/**
 * Heuristica de classificacao por substring no message. Errar aqui = ou ficar
 * em loop de retry inutil ou desistir cedo demais. Testes em
 * __tests__/nfseSpHeadlessClassifier.test.ts travam cada categoria.
 */
export function classificarErro(err) {
    if (err instanceof HeadlessLoginError) return err;
    const msg = String(err?.message || err || '');
    // Cert / autenticacao
    if (/relogin\.aspx|avisoacesso|cert.* rejeit|certificate.*reject/i.test(msg)) {
        return new HeadlessLoginError('cert-rejeitado', msg);
    }
    // Selector mudou / PMSP_NFeID ausente
    if (/PMSP_NFeID|bot[aã]o.*n[aã]o encontrado|button not found|element.*not found|no element/i.test(msg)) {
        return new HeadlessLoginError('selector-mudou', msg);
    }
    // Manutencao do portal (5xx / texto explicito)
    if (/em manuten[cç][aã]o|sistema.*indispon[ií]vel|503|502|504/i.test(msg)) {
        return new HeadlessLoginError('manutencao', msg);
    }
    // Timeout / rede
    if (/timeout|ECONNRESET|ETIMEDOUT|ENETUNREACH|ENOTFOUND|net::|navigation.*timeout/i.test(msg)) {
        return new HeadlessLoginError('timeout-rede', msg);
    }
    return new HeadlessLoginError('desconhecido', msg);
}
