// Mesma interpretacao federal para relatorio de servicos e ponte contabil.
// Nao decompoe PCC: preserva o agregado e exclui os componentes duplicados.
import { lerRetencoesFederaisDoDoc } from './reinf-retencoes-pj.js';
import { retencaoEfetivaDaNota } from './retencao-pj-ajuste.js';
import { conferirRetencaoFederal } from './retencao-federal-coerencia.js';

export function federaisDoRelatorio(d, base, ajuste) {
    const bruto = lerRetencoesFederaisDoDoc(d);
    const efetiva = retencaoEfetivaDaNota({ nota: { ...bruto, base }, ajuste });
    const ajustada = efetiva.origem === 'ajuste-declarado';
    const fed = ajustada
        ? { ir: efetiva.ir, pis: efetiva.pis, cofins: efetiva.cofins, csllOuTotal: efetiva.csll, inss: efetiva.inss }
        : bruto;
    const coer = conferirRetencaoFederal({ base, pis: fed.pis, cofins: fed.cofins, csll: fed.csllOuTotal });
    const csllEhTotal = coer.situacao === 'csll-e-o-total';
    const daOperacao = coer.situacao === 'campos-sao-totais-da-operacao';
    const valores = {
        pis: daOperacao ? 0 : (fed.pis ?? 0),
        cofins: daOperacao ? 0 : (fed.cofins ?? 0),
        csll: (csllEhTotal || daOperacao) ? 0 : (fed.csllOuTotal ?? 0),
        ir: fed.ir ?? 0,
        inss: fed.inss ?? 0,
        pccAgregado: (csllEhTotal || daOperacao) ? (fed.csllOuTotal ?? 0) : 0,
        contribuicoesAgregadas: csllEhTotal || daOperacao,
        origem: ajustada ? 'ajuste-declarado' : 'relatorio-cfi',
        situacao: coer.situacao,
    };
    return { fed, efetiva, ajustada, csllEhTotal, daOperacao, valores };
}
