// ============================================================================
// sefaz-backend/participante-doc-helper.js  (PURO — testável)
// ----------------------------------------------------------------------------
// RÉGUA ÚNICA pra ler o EMITENTE de um documento capturado.
//
// O mesmo defeito já mordeu três vezes (28/07 Exportar SAGE, 04/08 E010 sem UF,
// 04/08 DIFAL "0 clientes com compra interestadual"): a CAPTURA grava os campos
// ACHATADOS (`cnpjEmit`, `xNomeEmit`, `ufEmit`) e a IMPORTAÇÃO por XML monta os
// OBJETOS (`emitente.cnpjCpf`, `emitente.uf`). Quem lê só uma das formas
// descarta metade da base em silêncio — e "0 resultados" parece "não tem nada".
//
// A UF do EMITENTE tem uma terceira fonte que nunca falha: as duas primeiras
// posições da CHAVE de acesso são o código da UF (cUF). Documento capturado
// pela SEFAZ sempre tem chave. Por isso `ufEmitente` responde mesmo em doc
// antigo, sem depender do backfill.
// ============================================================================

import { ehNotaPropriaDeEntrada } from './xml-metadata-helper.js';

const so = (v) => String(v || '').replace(/\D/g, '');

/** cUF (2 primeiras posições da chave) → sigla. */
export const UF_POR_CUF = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
    '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
    '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

/** UF pelo código IBGE do município (2 primeiros dígitos = cUF). */
export function ufDoMunicipioIBGE(codMunIBGE) {
    const d = so(codMunIBGE);
    return d.length === 7 ? (UF_POR_CUF[d.slice(0, 2)] || '') : '';
}

/** CNPJ/CPF do emitente, nas duas formas de gravação. */
export function cnpjEmitente(d) {
    return so(d?.emitente?.cnpjCpf || d?.emitente?.cnpj || d?.cnpjEmit);
}

/** Nome do emitente, nas duas formas. */
export function nomeEmitente(d) {
    return String(d?.emitente?.nome || d?.xNomeEmit || '').trim();
}

/**
 * UF do emitente: objeto → campo achatado → município IBGE → CHAVE (cUF).
 * A chave é a fonte que não falha em documento capturado da SEFAZ.
 */
export function ufEmitente(d) {
    const uf = String(
        d?.emitente?.uf
        || d?.ufEmit
        || d?.ufEmitente
        || '',
    ).toUpperCase();
    if (uf) return uf;

    const porMunicipio = ufDoMunicipioIBGE(d?.emitente?.codMunIBGE || d?.codMunEmit);
    if (porMunicipio) return porMunicipio;

    return UF_POR_CUF[String(d?.chave || '').slice(0, 2)] || '';
}

/** Modelo do documento: campo → chave (posições 21-22) → tipo. */
export function modeloDoDoc(d) {
    const direto = so(d?.modelo);
    if (direto) return direto;
    const daChave = String(d?.chave || '').slice(20, 22);
    if (/^\d{2}$/.test(daChave)) return daChave;
    return d?.tipo === 'NFCe' ? '65' : '55';
}

/**
 * CFOP na ÓTICA DE QUEM RECEBE.
 *
 * O XML traz o CFOP do EMITENTE: venda interestadual sai como 6xxx, e a mesma
 * operação, pra quem recebe, é 2xxx. Filtro de entrada que compara direto com
 * o CFOP do XML não acha nada (caso 04/08: NF 110497 RJ→SP com CFOP 6101 —
 * o painel dizia "0 clientes com compra interestadual").
 *
 * Só troca a FAIXA (1º dígito); os outros três são os mesmos nas duas óticas.
 * CFOP que já é de entrada (1/2/3) passa intacto.
 */
export function cfopNaOticaDeEntrada(cfop) {
    const c = so(cfop);
    if (c.length !== 4) return '';
    const faixa = c[0];
    if (faixa === '5') return `1${c.slice(1)}`;
    if (faixa === '6') return `2${c.slice(1)}`;
    if (faixa === '7') return `3${c.slice(1)}`;
    return c;
}

/**
 * A CONTRAPARTE de um documento — o participante que o C100 declara e o 0150
 * cadastra. RÉGUA ÚNICA dos dois lugares (caso REALITY 0899 · 07/2026): o
 * orquestrador e o buildC100 escolhiam o lado cada um por si, e os dois erravam
 * juntos na NOTA PRÓPRIA DE ENTRADA (tpNF=0 emitida pela empresa — importação,
 * compra de produtor rural): pegavam o EMITENTE, que ali é a própria empresa.
 * A contraparte da nota própria mora no DESTINATÁRIO.
 *
 * ⚠️ Na IMPORTAÇÃO o destinatário também é a própria empresa — o exportador
 * estrangeiro NÃO vem no XML da nota de entrada. A função devolve o que o
 * documento TEM; quem monta o arquivo avisa (não se inventa participante).
 */
export function participanteDoDocumento(d, empresaCnpj) {
    if (!d) return null;
    if (ladoDaContraparte(d, empresaCnpj) === 'destinatario') {
        return d.destinatario || d.tomador || (d.direcao === 'saida' ? null : d.emitente) || null;
    }
    return d.emitente || d.prestador || null;
}

/**
 * EM QUAL LADO do documento está a contraparte — `'emitente'` ou
 * `'destinatario'`.
 *
 * É a MESMA régua do `participanteDoDocumento`, na forma que a TELA precisa: o
 * arquivo quer o objeto do participante, a lista e o PDF querem escolher entre
 * as duas colunas já normalizadas da view. Duas implementações da mesma
 * pergunta é como a tela começa a discordar do arquivo.
 *
 * 🚨 **NÃO SE RESOLVE PELA DIREÇÃO EFETIVA** — e é aqui que a leitura "óbvia"
 * erra. Na nota PRÓPRIA DE ENTRADA (art. 136) a direção efetiva é ENTRADA, e
 * mesmo assim a contraparte mora no **DESTINATÁRIO**: o emitente ali é a
 * própria empresa. Trocar este `d.direcao` cru por `direcaoEfetivaDoc` faria a
 * lista passar a mostrar o nome do PRÓPRIO CLIENTE na coluna da contraparte —
 * a correção "certa" produzindo o defeito.
 *
 * ⚠️ Por isso o campo cru fica, com o caso da própria entrada tratado
 * explicitamente na linha seguinte. É a mesma decisão declarada em
 * `contraparteDoc`.
 */
export function ladoDaContraparte(d, empresaCnpj) {
    if (!d) return 'emitente';
    if (d.direcao === 'saida') return 'destinatario';
    if (ehNotaPropriaDeEntrada(d, empresaCnpj).sim) return 'destinatario';
    return 'emitente';
}

/**
 * O documento é de EMISSÃO PRÓPRIA? (IND_EMIT = 0)
 *
 * RÉGUA ÚNICA de três decisões que TÊM que concordar entre si, senão o arquivo
 * se contradiz: o `IND_EMIT` do C100, a existência do `C170` e a coleta de
 * itens do `0200`.
 *
 * Guia Prático 3.2.3, C100, **Exceção 2** (literal): *"Notas Fiscais
 * Eletrônicas - NF-e de emissão própria: regra geral, devem ser apresentados
 * somente os registros C100 e C190 … somente será admitida a informação do
 * registro C170 quando também houver sido informado o registro C176, C180,
 * C181 ou o Registro C177"*.
 *
 * ⚠️ SAÍDA NÃO É A ÚNICA EMISSÃO PRÓPRIA: a nota própria de ENTRADA (tpNF=0
 * emitida pela empresa — importação, compra de produtor rural) também é.
 * Corroborado pelo EFD ICMS/IPI **aceito** da REALITY 0899 · 07/2026: as duas
 * notas de importação saem `|C100|0|0|…|` e com **ZERO** C170.
 */
export function ehEmissaoPropriaDoc(d, empresaCnpj) {
    if (!d) return false;
    if (d.direcao === 'saida') return true;
    return ehNotaPropriaDeEntrada(d, empresaCnpj).sim;
}

/**
 * UF do DESTINATÁRIO — nas duas formas em que o documento chega.
 *
 * 🚨 A UF é campo de DECISÃO no ICMS-ST: o E200/E210 é POR UF de destino, e
 * cada UF é uma GNRE. O agrupamento do bloco E lia só `destinatario.uf`
 * (ANINHADA) e o importer principal grava **`ufDest` ACHATADO** — em toda nota
 * capturada a UF vinha vazia e caía na UF da EMPRESA, mandando o recolhimento
 * do ST para o estado errado, calado (21/08).
 *
 * ⚠️ POR QUE NÃO PASSA PELO `normalizarParticipantesDoc`: aquele dono decide o
 * lado pela IDENTIDADE (nome/CNPJ/CPF), então um `destinatario: { uf: 'MG' }`
 * — sem nome e sem documento, que é como a nota de balcão chega — é DESCARTADO
 * por ele e a UF se perde. Aqui a pergunta é só sobre a UF.
 */
export function ufDoDestinatarioDoc(d) {
    return String(
        d?.destinatario?.uf || d?.tomador?.uf || d?.ufDest || d?.ufDestinatario || '',
    ).trim().toUpperCase();
}
