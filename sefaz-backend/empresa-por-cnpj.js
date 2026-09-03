import { limparCnpj } from './documento-dv.js';
// ============================================================================
// sefaz-backend/empresa-por-cnpj.js  (PURO — testável)
// ----------------------------------------------------------------------------
// ACHAR A EMPRESA PELO CNPJ — e o motivo desta casca existir é um defeito real.
//
// A rota do R-4020 nasceu (07/08) consultando por igualdade:
//
//     db.collection('simples_empresas').where('cnpj', '==', soDigitos(cnpj))
//
// e devolvia "CNPJ não cadastrado no Consultor Fiscal" para uma empresa que
// ESTÁ cadastrada. O CNPJ não é gravado num formato só: parte do cadastro tem
// `51227692000146`, parte tem `51.227.692/0001-46`. Consulta por igualdade
// casa com um e ignora o outro.
//
// A leitura correta varre e normaliza (`soDigitos(d.cnpj)`) — não é desleixo,
// é a única forma correta enquanto o dado tiver duas formas.
//
// 🚨 ESTE COMENTÁRIO DIZIA "nenhuma outra rota do CFI consulta por igualdade",
// e em 22/08 a varredura achou OITO que consultavam — seis sem fallback
// nenhum. Regra escrita não é regra travada: quem fecha a classe agora é
// `empresa-cadastro-lookup.js` (a casca que fala com o Firestore) mais o teste
// que barra `where('cnpj','==' | 'in')` fora dela. Este módulo continua sendo
// o dono do lado PURO — quem já tem a lista de empresas na mão usa ele.
//
// E o pior desse defeito não era falhar — era CULPAR O CADASTRO. A mensagem
// dizia "sem cadastro não há captura" e mandava a pessoa procurar um problema
// que não existia. Erro que aponta para o lugar errado custa mais caro que
// erro que só falha.
// ============================================================================

// ⚠️ O nome ficou pelos consumidores, mas desde 07/2026 o CNPJ pode ter LETRAS
// (IN RFB 2.229/2024): `\D` apagava as letras e o CNPJ novo virava "curto",
// ou seja "não cadastrado" sobre cliente cadastrado. Quem normaliza é o dono.
export const soDigitosCnpj = (v) => limparCnpj(v);

/**
 * A empresa cujo CNPJ bate, comparando SEMPRE por dígitos.
 *
 * @param {Array} empresas  [{ id, ...dados }] das coleções de cadastro
 * @param {string} cnpj     em qualquer formato
 * @returns {object|null}   a empresa, ou null
 */
export function acharEmpresaPorCnpj(empresas, cnpj) {
    const alvo = soDigitosCnpj(cnpj);
    if (alvo.length !== 14) return null;
    for (const e of empresas || []) {
        // Lápide e fusão ficam de fora: empresa excluída não é "encontrada",
        // e a fundida responde pela outra (regra do soft-delete, #290).
        if (!e || e._deleted || e._merged_into) continue;
        if (soDigitosCnpj(e.cnpj) === alvo) return e;
    }
    return null;
}

/**
 * Filiais da MESMA raiz que estão cadastradas — o SN-Entregar exige todos os
 * estabelecimentos, e o R-2055/R-4020 declaram por estabelecimento.
 */
export function filiaisDaRaiz(empresas, cnpj) {
    const alvo = soDigitosCnpj(cnpj);
    if (alvo.length !== 14) return [];
    const raiz = alvo.slice(0, 8);
    return (empresas || [])
        .filter((e) => e && !e._deleted && !e._merged_into)
        .map((e) => soDigitosCnpj(e.cnpj))
        .filter((c) => c.length === 14 && c.startsWith(raiz) && c !== alvo);
}
