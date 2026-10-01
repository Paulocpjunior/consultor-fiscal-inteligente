// ─────────────────────────────────────────────────────────────────────────────
// sefaz-backend/obrigacao-efd-icms.js  (PURO — testável)
//
// 🔒 A EMPRESA DO LUCRO ENTREGA SPED FISCAL (EFD ICMS/IPI)? — dono único (01/10).
//
// Paulo, 01/10, com os Dados Fiscais da A CASTELLANO (cód. 25, IE
// 103.460.625.111) e da CLINICA MANTOAN (cód. 40, IE "ISENTO"):
//   *"quando existe a obrigação = LP/LR COM I.E PARA COMÉRCIO CADASTRADA EM
//    DADOS FISCAIS (com particularidade as empresas de Brasília, que entregam
//    SPED) · quando não existe a obrigação = quando não houver I.E cadastrada"*.
//
// Até aqui o catálogo punha SPED em TODO cliente do Lucro (COMUNS_LUCRO), e a
// clínica sem IE recebia tarefa e pendência de um arquivo que ela não entrega.
//
// A régua, nesta ordem:
//  1. UF = DF ⇒ entrega (a particularidade de Brasília: lá a EFD ICMS/IPI é
//     entregue também pela empresa de serviço — é o caso das clínicas do DF que
//     a casa já atende, 28/08 —, com ou sem IE de comércio);
//  2. IE com dígitos ⇒ entrega;
//  3. IE "ISENTO" ⇒ não entrega, dito;
//  4. IE vazia ⇒ não entrega, dito (o cadastro é a resposta: sem IE não há EFD).
//
// ⚠️ Não confundir com `contribuinteIcms` (migracao-prontidao.js): aquele
// responde se a empresa APURA ICMS (E110/E116); este, se ela ENTREGA o
// arquivo. A clínica do DF entrega SPED e não apura ICMS — as duas respostas
// são verdadeiras ao mesmo tempo.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} empresa lê `dadosFiscais.{inscricaoEstadual,uf}` ou as mesmas
 *   chaves no topo (as duas formas que o app projeta).
 * @returns {{obrigada: boolean, via: 'df'|'ie'|'isento'|'sem-ie', motivo: string}}
 */
export function decidirEfdIcmsIpi(empresa) {
    const df = empresa?.dadosFiscais || {};
    const uf = String(df.uf ?? empresa?.uf ?? '').trim().toUpperCase();
    const ie = String(df.inscricaoEstadual ?? empresa?.inscricaoEstadual ?? '').trim();
    if (uf === 'DF') {
        return { obrigada: true, via: 'df', motivo: 'Empresa do DF: entrega a EFD ICMS/IPI (particularidade de Brasília), com ou sem IE de comércio.' };
    }
    if (/\d/.test(ie) && !/^ISENT/i.test(ie)) {
        return { obrigada: true, via: 'ie', motivo: `Inscrição estadual cadastrada (${ie}) nos Dados Fiscais.` };
    }
    if (/^ISENT/i.test(ie)) {
        return { obrigada: false, via: 'isento', motivo: 'Inscrição estadual "ISENTO" nos Dados Fiscais — não entrega SPED Fiscal.' };
    }
    return { obrigada: false, via: 'sem-ie', motivo: 'Sem inscrição estadual nos Dados Fiscais — não entrega SPED Fiscal. Se a empresa tem IE, cadastre-a em Dados Fiscais.' };
}

/**
 * 🧹 A tarefa de SPED deve ser cancelada? (Paulo, 01/10: *"sim, faz a limpeza
 * automática das tarefas"*). Só a ABERTA e AUTOMÁTICA de empresa que o dono
 * diz não entregar — concluída, cancelada e MANUAL não se tocam (manual é
 * decisão de alguém, e a regra não a desfaz).
 *
 * @param {{obrigacao?: string, status?: string, origem?: string}} t
 * @param {object|null} empresa o doc da empresa (com `dadosFiscais`)
 */
export function tarefaSpedParaCancelar(t, empresa) {
    if (!t || String(t.obrigacao || '') !== 'SPED') return false;
    if (t.status === 'concluida' || t.status === 'cancelada') return false;
    if (String(t.origem || 'automatica') !== 'automatica') return false;
    if (!empresa) return false; // empresa não lida: não se cancela no escuro
    return !decidirEfdIcmsIpi(empresa).obrigada;
}
