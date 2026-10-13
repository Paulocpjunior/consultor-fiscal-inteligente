// ============================================================================
// sefaz-backend/bloco-k-importacao.js  (PURO — testável, roda no navegador)
// ----------------------------------------------------------------------------
// 📥 IMPORTAR O BLOCO K DO TXT DO SPED (13/10).
//
// Paulo, WALDESA: *"precisa habilitar a opção de importação do arquivo, para
// subir para o SPED"*. O apontamento de produção e estoque vem do sistema do
// cliente, que já gera o SPED (EFD) com o Bloco K — digitar linha a linha na
// aba 🏭 Bloco K era refazer à mão o que o arquivo já traz.
//
// O LEIAUTE NÃO SE CHUTA: os campos lidos são os do Guia Prático (os mesmos
// que o gerador do CFI escreve — `sped-bloco-k.js`):
//   |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|…
//   |K200|DT_EST|COD_ITEM|QTD|IND_EST|COD_PART|
//   |K220|DT_MOV|COD_ITEM_ORI|COD_ITEM_DEST|QTD_ORI|QTD_DEST|
//   |K230|DT_INI_OP|DT_FIN_OP|COD_DOC_OP|COD_ITEM|QTD_ENC|
//   |K235|DT_SAIDA|COD_ITEM|QTD|COD_INS_SUBST|   (filho do K230 anterior)
//
// A régua (alerta, nunca contorno):
//  · arquivo de OUTRO CNPJ ou de OUTRA competência é recusado, dito — o
//    apontamento de uma empresa não entra na outra;
//  · campo ausente fica AUSENTE (quantidade vazia não vira zero; o K220 de
//    leiaute antigo, sem QTD_DEST, entra sem ela e a tela o mostra incompleto);
//  · registro do bloco K que o CFI não gera (K250, K280, K290…) é CONTADO e
//    dito — ele precisa ir ao PVA por fora, como o gerador já avisa.
// O resultado preenche a tela; quem grava é a pessoa (💾 Gravar apontamento).
// ============================================================================

/** Registros do bloco K que a tela recebe. */
export const REGISTROS_IMPORTADOS = ['K200', 'K220', 'K230', 'K235'];

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** DDMMAAAA → AAAA-MM-DD (a forma do campo de data da tela); inválida → ''. */
export function dataSpedParaIso(v) {
    const d = soDigitos(v);
    if (d.length !== 8) return '';
    const dia = d.slice(0, 2); const mes = d.slice(2, 4); const ano = d.slice(4);
    if (Number(mes) < 1 || Number(mes) > 12 || Number(dia) < 1 || Number(dia) > 31) return '';
    return `${ano}-${mes}-${dia}`;
}

/** Número do SPED ("1234,567") → number; vazio/ilegível → '' (ausente ≠ zero). */
export function numeroSped(v) {
    const t = String(v ?? '').trim();
    if (!t) return '';
    if (!/^-?\d+(,\d+)?$/.test(t)) return '';
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) ? n : '';
}

/**
 * Lê o bloco K de um TXT do SPED.
 *
 * @param {string} texto  conteúdo do arquivo (já decodificado)
 * @param {{cnpjEmpresa?: string, competencia?: string}} [alvo]  'AAAA-MM'
 * @returns {{ok: true, cnpj: string, competencia: string, estoques: object[], movimentacoes: object[],
 *   producao: object[], naoImportados: Record<string, number>, avisos: string[]} | {ok: false, erro: string}}
 */
export function lerBlocoKDoSped(texto, { cnpjEmpresa = '', competencia = '' } = {}) {
    const linhas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('|'));
    if (!linhas.length) return { ok: false, erro: 'O arquivo não tem linhas de SPED (|REG|…|).' };
    const campos = (l) => l.split('|').slice(1, -1);

    const l0000 = linhas.find((l) => l.startsWith('|0000|'));
    if (!l0000) return { ok: false, erro: 'O arquivo não tem o registro 0000 — não é um SPED Fiscal (EFD ICMS/IPI) completo.' };
    const c0 = campos(l0000);
    const cnpj = soDigitos(c0[6]);
    const dtIni = dataSpedParaIso(c0[3]);
    const compArquivo = dtIni ? dtIni.slice(0, 7) : '';

    const alvoCnpj = soDigitos(cnpjEmpresa);
    if (alvoCnpj && cnpj && cnpj !== alvoCnpj) {
        return { ok: false, erro: `O arquivo é do CNPJ ${cnpj} e a empresa ativa é ${alvoCnpj} — o apontamento de uma empresa não entra na outra.` };
    }
    if (competencia && compArquivo && compArquivo !== competencia) {
        return { ok: false, erro: `O arquivo é da competência ${compArquivo.split('-').reverse().join('/')} e a tela está em ${competencia.split('-').reverse().join('/')} — troque a competência ou o arquivo.` };
    }

    const estoques = [];
    const movimentacoes = [];
    const producao = [];
    const naoImportados = {};
    const avisos = [];
    let k235Orfaos = 0;
    for (const l of linhas) {
        const c = campos(l);
        const reg = c[0];
        if (!/^K\d{3}$/.test(reg)) continue;
        if (reg === 'K200') {
            estoques.push({ codItem: String(c[2] || '').trim(), qtd: numeroSped(c[3]), indEst: String(c[4] || '0').trim() || '0', codPart: String(c[5] || '').trim() });
        } else if (reg === 'K220') {
            movimentacoes.push({
                dtMov: dataSpedParaIso(c[1]), codItemOri: String(c[2] || '').trim(), codItemDest: String(c[3] || '').trim(),
                qtdOri: numeroSped(c[4]), qtdDest: numeroSped(c[5]),
            });
        } else if (reg === 'K230') {
            producao.push({
                dtIniOp: dataSpedParaIso(c[1]), dtFinOp: dataSpedParaIso(c[2]), codDocOp: String(c[3] || '').trim(),
                codItem: String(c[4] || '').trim(), qtdEnc: numeroSped(c[5]), insumos: [],
            });
        } else if (reg === 'K235') {
            const pai = producao[producao.length - 1];
            if (!pai) { k235Orfaos++; continue; }
            pai.insumos.push({ dtSaida: dataSpedParaIso(c[1]), codItem: String(c[2] || '').trim(), qtd: numeroSped(c[3]), codInsSubst: String(c[4] || '').trim() });
        } else if (!['K001', 'K010', 'K100', 'K990'].includes(reg)) {
            naoImportados[reg] = (naoImportados[reg] || 0) + 1;
        }
    }

    if (k235Orfaos) avisos.push(`${k235Orfaos} K235 sem K230 antes deles — não há ordem de produção para pendurá-los, ficaram de fora.`);
    const outros = Object.entries(naoImportados);
    if (outros.length) {
        avisos.push(`Registros do bloco K que o CFI não gera e NÃO foram importados: ${outros.map(([r, n]) => `${r} (${n})`).join(', ')} — lance-os no PVA antes de transmitir.`);
    }
    const semQtd = estoques.filter((e) => e.qtd === '').length + movimentacoes.filter((m) => m.qtdOri === '' || m.qtdDest === '').length
        + producao.filter((p) => p.qtdEnc === '').length;
    if (semQtd) avisos.push(`${semQtd} linha(s) sem quantidade legível — ficam na tela para completar; sem quantidade não entram no arquivo.`);
    if (!estoques.length && !movimentacoes.length && !producao.length) {
        return { ok: false, erro: 'O arquivo não tem K200, K220 nem K230 — não há apontamento para importar.' };
    }
    return { ok: true, cnpj, competencia: compArquivo, estoques, movimentacoes, producao, naoImportados, avisos };
}
