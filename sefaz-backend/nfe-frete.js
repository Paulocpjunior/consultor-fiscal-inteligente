import { modeloDoDoc } from './participante-doc-helper.js';
// C100 campo 17: leiautes vigentes desde 2018 (ICMS/IPI) e 10/2017 (Contribuicoes).
export function normalizarModalidadeFrete(valor) {
    const codigo = valor == null ? '' : String(valor).trim();
    return ['0', '1', '2', '3', '4', '9'].includes(codigo) ? codigo : null;
}

export function indicadorFrete(nota) {
    if (modeloDoDoc(nota) === '65') return '9';
    return normalizarModalidadeFrete(nota.modFrete) ?? '';
}
