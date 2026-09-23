// ============================================================================
// sefaz-backend/sped-a100-declaravel.js  (PURO)
// ----------------------------------------------------------------------------
// "Este documento de serviço PODE ser declarado no bloco A?"
//
// 🚨 O CASO (03/09, INSTITUTO HAYAY CIENCIA E FE · 08/2026 — recibo do PVA):
//   `Total de Erros 1 — Campo obrigatório na entrada.`
//   `Linha 16 · Campo 4 - COD_PART · Registro A100`
//   `|A100|0|1||00|||23||25082026|25082026|3000,00|0||3000,00|19,50|...`
//
// O documento é um serviço **TOMADO** (`IND_OPER=0`) e o **COD_PART saiu
// VAZIO**: a NFS-e entrou pelo importador de PDF no leiaute **DANFSe** que o
// leitor não sabe nomear (o caso RADIO E TV SUL AMERICANA, 02/09 — *"o PDF veio
// com prestador e tomador VAZIOS"*), e o gerador emitiu a linha assim mesmo.
//
// 🚨 O CUSTO É O MAIOR DE TODOS: o PVA **não importa o arquivo**. Não é recusa
// de um registro que se conserta e reenvia — é o arquivo inteiro barrado na
// porta por causa de UMA nota, e nada avisava antes.
//
// ⚠️ **SÓ A ENTRADA ACUSA, e isso é a recusa falando**: a mensagem é literal —
// *"Campo obrigatório **na entrada**"*. Na SAÍDA o campo sai vazio há meses em
// arquivos que o PVA ACEITOU (MANTOAN 07/2026, HS 05/2026), então acusar ali
// seria alarme sobre arquivo correto — o jeito conhecido de a equipe desligar a
// prevalidação.
//
// 🚨 **E A EXCLUSÃO SUSTENTA O 0200 — medido, não deduzido.** Tirar o A100
// tira o A170 dele, e o A170 do documento SEM `itens[]` é o único que
// referencia o item sintético `SERV-GENERICO`. Se o 0200 continuasse a
// declará-lo, o arquivo trocaria esta recusa pela do **item ÓRFÃO** (*"Não
// informar item, se não referenciado em pelo menos um dos demais blocos"* — a
// que a PWR já pagou em 19/08). É a régua de 24/08: **antes de tirar um
// registro do arquivo, medir o que ele SUSTENTA** — por isso a decisão mora
// AQUI, num dono só, e o bloco A e o coletor do 0200 leem dele.
// ============================================================================
import { codPartDoDocumento } from './participante-doc-helper.js';
import { direcaoEfetivaDoc } from './xml-metadata-helper.js';
import { normalizarParticipantesDoc } from './dipam-produtor-rural.js';

/** Como a nota aparece no aviso — é por este número que a pessoa a acha. */
function identificarDoc(d) {
    return String(d?.numero || d?.nfseNumero || d?.chave || '(sem número)');
}

/**
 * Confere UM documento do bloco A.
 *
 * @param {object} doc          documento de `documentos_fiscais`
 * @param {string} [empresaCnpj]
 * @returns {{declaravel: boolean, direcao: string|undefined, codPart: string,
 *            identificacao: string, causa: string|null}}
 */
export function conferirA100Declaravel(doc, empresaCnpj) {
    // A forma do documento se normaliza ANTES: a NFS-e do portal entra ACHATADA
    // e a do PDF em `prestador`/`tomador`. Ler uma forma só foi o defeito de
    // 17/08 (37 A100 da MANTOAN com COD_PART vazio) — e chamar o normalizador
    // aqui é o que faz a resposta deste dono valer para os dois leitores.
    const d = normalizarParticipantesDoc(doc || {});
    const direcao = direcaoEfetivaDoc(d);
    const codPart = codPartDoDocumento(d, empresaCnpj);
    const identificacao = identificarDoc(d);

    if (direcao !== 'saida' && !codPart) {
        return {
            declaravel: false, direcao, codPart, identificacao,
            causa: 'entrada-sem-participante',
        };
    }
    return { declaravel: true, direcao, codPart, identificacao, causa: null };
}

/**
 * Separa o que ENTRA no bloco A do que fica FORA — a resposta que o bloco A e o
 * coletor do 0200 têm de compartilhar.
 *
 * @param {Array} notasDoBlocoA  já filtradas por `filtrarNotasBlocoA`
 */
export function separarDeclaraveisNoBlocoA(notasDoBlocoA, empresaCnpj) {
    const declaraveis = [];
    const foras = [];
    for (const n of (notasDoBlocoA || [])) {
        const r = conferirA100Declaravel(n, empresaCnpj);
        if (r.declaravel) declaraveis.push(n);
        // ⚠️ Sai NOMEADO, com o nome do prestador quando o documento o trouxe:
        // "1 nota ficou de fora" manda varrer a competência inteira atrás dela.
        else {
            foras.push({
                identificacao: r.identificacao,
                nome: String(n?.emitente?.nome || n?.prestador?.nome || n?.xNomeEmit || '').trim(),
                causa: r.causa,
            });
        }
    }
    return { declaraveis, foras };
}

/**
 * A frase do aviso da geração — a CAUSA junto do número, com a ação.
 *
 * ⚠️ **O REGIME MUDA O QUE SE PERDE, então ele muda a frase**: no CUMULATIVO a
 * aquisição não gera crédito nenhum (o A170 dela sai com CST 70 e valores
 * zerados), então tirar a nota **não muda um centavo** — o que muda é o arquivo
 * passar. No NÃO-CUMULATIVO ela geraria crédito, e aí a exclusão declara **a
 * MAIOR**: isso vai dito, senão o crédito some em silêncio.
 */
export function avisoDoBlocoASemParticipante(foras, regimeApuracao) {
    if (!foras?.length) return null;
    const lista = foras.slice(0, 10)
        .map(f => (f.nome ? `${f.nome} (nota ${f.identificacao})` : `nota ${f.identificacao}`))
        .join(', ');
    const naoCumulativo = String(regimeApuracao) === '1';
    return `Bloco A: ${foras.length} documento(s) de serviço TOMADO ficaram FORA porque o COD_PART está `
        + 'VAZIO — o PVA recusa o ARQUIVO INTEIRO com "Campo obrigatório na entrada · 4 - COD_PART", e '
        + `com a nota o arquivo nem importa: ${lista}`
        + `${foras.length > 10 ? ` e mais ${foras.length - 10}` : ''}. `
        + 'Isso NÃO é falta de cadastro do cliente: é o documento que entrou sem o CNPJ do PRESTADOR '
        + '(acontece no PDF da NFS-e cujo leiaute o leitor não sabe nomear). Preencha o CNPJ do prestador '
        + 'reimportando o PDF em Central de XMLs → Importar → NFS-e (PDF) com "↻ Substituir os que já '
        + 'estão no banco", e gere o arquivo de novo. '
        + (naoCumulativo
            ? '🚨 ATENÇÃO: esta empresa é do NÃO-CUMULATIVO, então o crédito de PIS/COFINS desta '
              + 'aquisição NÃO entra na apuração — o arquivo declara a MAIOR enquanto a nota estiver fora.'
            : 'No regime cumulativo a aquisição não gera crédito, então nenhum valor muda: o A170 dela '
              + 'sairia com CST 70 e zeros.');
}
