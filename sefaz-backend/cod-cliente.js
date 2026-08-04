// ============================================================================
// sefaz-backend/cod-cliente.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Cod.Cliente — o código da empresa no E-Fiscal.
//
// Paulo, 04/08: "todas as empresas no E-Fiscal trabalham com código da empresa
// antes do nome, os códigos devem permanecer OS MESMOS ... toda amarração será
// pelo CNPJ, esse será o ponto de confronto ... campo com 4 dígitos 0000
// respeitando o zero à esquerda, começamos com 0001 até 9999".
//
// Este campo é a CHAVE da migração do PG12: cada schema do E-Fiscal é e{código}
// (e0001–e9996) e o confronto na extração será CNPJ ↔ código. Por isso:
//
//   • o valor é TEXTO de exatamente 4 dígitos — "0001" nunca pode virar 1
//     (número perde o zero à esquerda e quebra o casamento com o schema);
//   • a faixa é 0001–9999; 0000 não existe;
//   • DUPLICADO É RECUSADO na gravação: dois clientes com o mesmo código
//     tornariam o confronto ambíguo, e o erro só apareceria na extração.
//
// O mesmo código é o "Nº Empresa no E-Fiscal" (E001) que a equipe digitava de
// cabeça no Exportar SAGE — cadastrado aqui, a tela passa a preencher sozinha.
// ============================================================================

/**
 * Normaliza e valida o Cod.Cliente digitado.
 *
 * @returns {{ok:true, valor:string}|{ok:false, erro:string}}
 *   ok + valor '0001'…'9999' — pronto pra gravar (dígito curto ganha zeros à
 *   esquerda: "1" vira "0001");
 *   ok + valor ''            — campo limpo = ordem de APAGAR (mesma regra do
 *   CCM: '' apaga, undefined não mexe);
 *   erro                      — mensagem pronta pro colaborador.
 */
export function normalizarCodCliente(bruto) {
    if (bruto == null) return { ok: true, valor: '' };
    const s = String(bruto).trim();
    if (s === '') return { ok: true, valor: '' };

    if (!/^\d+$/.test(s)) {
        return {
            ok: false,
            erro: `Cod.Cliente "${s}" inválido: use só números (o código da empresa no E-Fiscal, ex.: 0001).`,
        };
    }
    if (s.length > 4) {
        return {
            ok: false,
            erro: `Cod.Cliente "${s}" inválido: o código do E-Fiscal tem no máximo 4 dígitos (0001–9999).`,
        };
    }
    const n = parseInt(s, 10);
    if (n === 0) {
        return {
            ok: false,
            erro: 'Cod.Cliente 0000 não existe — a faixa do E-Fiscal começa em 0001. Deixe vazio se a empresa não tem código lá.',
        };
    }
    return { ok: true, valor: String(n).padStart(4, '0') };
}

/**
 * O código serve pro confronto da migração? (4 dígitos exatos, 0001–9999.)
 * Usado na leitura: valor gravado fora da régua (legado, importação) não pode
 * casar schema em silêncio.
 */
export function codClienteValido(v) {
    return typeof v === 'string' && /^\d{4}$/.test(v) && v !== '0000';
}

/** Nome do schema do E-Fiscal correspondente (e0001…e9999) — o alvo do confronto. */
export function schemaDoCodCliente(v) {
    return codClienteValido(v) ? `e${v}` : null;
}
