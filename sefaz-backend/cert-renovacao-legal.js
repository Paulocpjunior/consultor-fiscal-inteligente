// ============================================================================
// sefaz-backend/cert-renovacao-legal.js  (PURO — testável)
// ----------------------------------------------------------------------------
// RENOVAÇÃO DO CERTIFICADO PELO DEPARTAMENTO LEGAL (Paulo, 04/10).
//
// *"O módulo de folha de pagamento bem como os outros app devem ter acesso
// ao cofre dos certificados … quando um certificado de um determinado
// cliente for renovado ou vencido todos dentro do SaaS terão a mesma
// informação."* Decisões dele: o .pfx renovado sobe pelo app Legal, gravando
// NESTE cofre; quem sobe é a equipe do Legal (admin ou departamento
// 'legalizacao'); e a validade acompanhada passa a vir do PRÓPRIO arquivo.
//
// Regras que este módulo carrega:
// 1. Só sobe certificado do CNPJ pedido — e-CNPJ de outro cliente no cofre
//    deste é o pior erro possível (assina em nome do cliente errado).
// 2. Certificado já vencido não entra como "renovação".
// 3. O A1 do escritório não passa por aqui (Secret Manager, cert-manager.js).
// 4. A validade lida do arquivo vai ao Legal num campo PRÓPRIO
//    (`dataVencimentoCofre`): o sync do Jotform grava por merge e não o
//    apaga, e o que vale é a data mais tarde entre as duas.
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const dia = (v) => (v ? String(v).slice(0, 10) : null);

/** Admin do CFI ou quem tem o departamento 'legalizacao' (equipe do Legal). */
export function podeRenovarPeloLegal(user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return Array.isArray(user.departamentos) && user.departamentos.includes('legalizacao');
}

/**
 * O certificado lido do .pfx pode entrar como renovação deste CNPJ?
 * Devolve a mensagem de recusa, ou null.
 */
export function motivoRecusaRenovacao({ cnpjAlvo, meta, agora = new Date(), cnpjEscritorio = '44388152000189' }) {
    const alvo = soDigitos(cnpjAlvo);
    if (alvo.length !== 14) return 'Informe o CNPJ da empresa com 14 dígitos.';
    if (alvo === soDigitos(cnpjEscritorio)) {
        return 'Este é o certificado do escritório: ele é enviado pelo Consultor Fiscal (Configurações → Certificado Digital), não por aqui.';
    }
    const doArquivo = soDigitos(meta?.cnpj);
    if (!doArquivo) return 'Não foi possível ler o CNPJ do certificado: confira se é um e-CNPJ A1.';
    if (doArquivo !== alvo) {
        return `Este certificado é do CNPJ ${doArquivo}, não do ${alvo}. Confira o arquivo: certificado de outro cliente não entra no cofre desta empresa.`;
    }
    const fim = meta?.notAfter ? new Date(meta.notAfter) : null;
    if (!fim || Number.isNaN(fim.getTime())) return 'Não foi possível ler a validade do certificado.';
    if (fim.getTime() <= agora.getTime()) return `Este certificado já venceu em ${dia(meta.notAfter)}: não é a renovação.`;
    return null;
}

/**
 * O que gravar no acompanhamento do Legal depois do upload:
 * - em cada linha de certificado deste CNPJ (Jotform), a validade lida do
 *   arquivo (`dataVencimentoCofre`), quem e quando;
 * - um registro em `legalizacao_renovacoes` (id = item_dataNova, o mesmo
 *   formato do sync, para não notificar a mesma renovação duas vezes).
 * `itens`: docs de `legalizacao_vencimentos` deste CNPJ ({ id, ...dados }).
 * `anterior`: validade do A1 que estava no cofre (ou null).
 */
export function registrosDaRenovacao({ cnpj, notAfter, anterior = null, itens = [], autor }) {
    const alvo = soDigitos(cnpj);
    const nova = dia(notAfter);
    const validos = (itens || []).filter((i) => i && i.categoria === 'certificado' && !i.removidoDoJotform && soDigitos(i.cnpj) === alvo);
    const atualizacoes = validos.map((i) => ({ id: i.id, dados: { dataVencimentoCofre: nova, cofreAtualizadoPor: autor || null } }));
    const base = validos.slice().sort((a, b) => String(b.dataVencimento || '').localeCompare(String(a.dataVencimento || '')))[0] || null;
    const dataAntiga = dia(anterior) || dia(base?.dataVencimento) || null;
    const itemId = base?.id || `cofre_${alvo}`;
    return {
        atualizacoes,
        renovacao: {
            id: `${itemId}_${nova}`,
            dados: {
                itemId,
                empresaNome: base?.empresaNome || null,
                cnpj: alvo,
                tipoDetalhe: base?.tipoDetalhe || 'Certificado A1',
                dataAntiga,
                dataNova: nova,
                origem: 'upload-cofre',
                autor: autor || null,
                cofre: { status: 'cofre-cfi' },
            },
        },
    };
}

/** A data que vale no acompanhamento: a mais tarde entre a digitada (Jotform) e a lida do arquivo. */
export function vencimentoEfetivo(item) {
    const a = dia(item?.dataVencimento);
    const b = dia(item?.dataVencimentoCofre);
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
}
