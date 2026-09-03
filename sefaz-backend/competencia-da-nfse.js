// ============================================================================
// sefaz-backend/competencia-da-nfse.js  (PURO)
// ----------------------------------------------------------------------------
// "A que MÊS esta NFS-e pertence?" — e a resposta NÃO é a data de emissão.
//
// 🚨 O CASO (03/09, Paulo, painel **NFS-e RECEBIDAS** da Prefeitura de SP,
// CASA DA CRIANCA BETINHO, com o filtro `Período: Incidência 08/2026`):
//   `S&P ASSESSORIA CONTABIL · Emissão 02/09/2026 08:36:34 · Data Fato Gerador
//    31/08/2026`
//
// Ele nomeou a regra: *"em SP eu posso emitir uma nota com data de 31/08 até o
// dia 10/09; se ela tiver retido, até o dia 05/09"*. A NFS-e paulistana tem
// DUAS datas, e a que decide o mês é a do **FATO GERADOR** — é por ela que o
// próprio portal filtra, e ele chama isso de **INCIDÊNCIA**.
//
// 🔴 A CLASSE APARECEU EM QUATRO TRILHOS, e nos quatro o dado CHEGAVA:
//   1. `nfse-sp-importer.js` (WS/XML de SP) — recortava `dhEmi` com o
//      `DataFatoGeradorNFe` lido na LINHA DE CIMA e jogado fora;
//   2. `nfse-sp-csv-importer.js` (CSV do portal — o trilho principal hoje) —
//      `dataHoraEmissao.slice(0, 7)`, com `dataFatoGerador` (coluna 8 do
//      layout) parseado e ignorado;
//   3. `nfse-nacional-gravacao.js` (ADN) — `competenciaDaEmissao(dataEmissao)`,
//      com o **`dCompet`** já lido pelo `nfse-nacional-leitura.js`;
//   4. `services/xmlParserService.ts` (ABRASF pelo navegador) — a mais crua:
//      `const competenciaTag = getTextContent(infNfse, 'Competencia')` e a
//      variável **nunca usada em lugar nenhum**.
//
// É a família do `localErroAviso` (12/08): **o dado chega e o leitor
// descarta** — e o campo descartado é justamente o que RECORTA O MÊS.
//
// 🚨 O CUSTO É A AUSÊNCIA PLAUSÍVEL, a mais cara desta casa: a nota emitida em
// setembro com fato gerador em agosto é gravada como `2026-09` e **sai de TODO
// recorte de agosto** — a lista, o Livro de Serviços, o ISS da competência, o
// bloco A do EFD-Contribuições — e entra em setembro, onde não deveria estar.
// Não há erro nenhum na tela: há um livro a MENOS num mês e a MAIS no outro.
// É o defeito de 01/09 (MARCOS ANTONIO ZAMBOLIN) pela outra ponta: lá a
// competência saía numa FORMA que nenhum filtro casava; aqui ela sai na forma
// certa e no MÊS ERRADO.
//
// 📌 E A CORREÇÃO É COERENTE COM O QUE O RESTO DO APP JÁ FAZ: o R-2010, o
// R-4020 e o movimento entregue ao Contábil já leem `dataFatoGerador || dhEmi`
// — o fato gerador é o FATO, e a emissão é quando o papel saiu. A competência
// era o último leitor lendo a data errada.
//
// ⚠️ O QUE **NÃO** PASSA POR AQUI, e o motivo escrito:
//   · `services/nfsePdfRecorte.ts` (importador de PDF) — ele JÁ honra a
//     precedência (campo de competência > emissão) e sua leitura de data é
//     deliberadamente mais ESTRITA (`.slice(0, 10)` + âncora, "é ela que barra
//     lixo"). Este dono é mais tolerante: delegar ali trocaria o `impedimento`
//     — que hoje manda preencher a competência à mão — por competência
//     CHUTADA a partir de texto ilegível, o que é o defeito na direção cara.
//   · `xml-importer.js` e `sharepoint-auto-sync.js` — os dois só produzem NF-e
//     e CT-e (medido: nenhum lê `InfNfse`/`infNFSe`), e nesses documentos a
//     data de emissão É a competência. Alarme sobre código certo é o jeito
//     conhecido de a equipe desligar a trava.
// ============================================================================
import { dataDeclaradaDoDocumento } from './xml-metadata-helper.js';
// A FORMA da competência tem dono próprio (AAAA-MM · AAAA-MM-DD · MM/AAAA ·
// AAAAMM · DD/MM/AAAA). São duas perguntas: QUAL campo decide o mês (aqui) e
// que FORMAS o campo assume (lá) — e cada uma no seu dono.
import { normalizarCompetencia } from './competencia.js';

const mesDaData = (bruto) => {
    const d = dataDeclaradaDoDocumento(bruto);
    return d ? d.slice(0, 7) : '';
};

/** O campo de competência que o documento DECLARA (ABRASF `<Competencia>`,
 *  nacional `dCompet`) — nas formas em que ele chega. */
const mesDeclarado = (bruto) => normalizarCompetencia(bruto) || mesDaData(bruto);

const ddmmaaaa = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

/**
 * A competência (`AAAA-MM`) de uma NFS-e, com a ORIGEM carimbada.
 *
 * PRECEDÊNCIA: **campo de competência declarado > fato gerador > emissão**. O
 * mais específico vence — quem declara a competência é o documento; o fato
 * gerador é o fato que a define; a emissão é só quando o papel saiu.
 *
 * @param {object} p
 * @param {*} [p.competenciaDeclarada] `<Competencia>` (ABRASF) · `dCompet` (ADN)
 * @param {*} [p.dataFatoGerador]      a data da INCIDÊNCIA (o serviço prestado)
 * @param {*} [p.dataEmissao]          a data em que a nota foi emitida
 * @returns {{competencia: string|null, origem: 'declarada'|'fato-gerador'|'emissao'|null,
 *            diverge: boolean, motivo: string|null}}
 */
export function competenciaDaNfse({ competenciaDeclarada, dataFatoGerador, dataEmissao } = {}) {
    const em = dataDeclaradaDoDocumento(dataEmissao);
    const mesEmissao = em ? em.slice(0, 7) : '';

    const declarada = mesDeclarado(competenciaDeclarada);
    if (declarada) {
        return montar(declarada, 'declarada', mesEmissao, em,
            'porque é a COMPETÊNCIA que o próprio documento declara');
    }

    const fg = dataDeclaradaDoDocumento(dataFatoGerador);
    if (fg) {
        return montar(fg.slice(0, 7), 'fato-gerador', mesEmissao, em,
            `porque o FATO GERADOR é ${ddmmaaaa(fg)}`);
    }

    // ⚠️ SEM NENHUM DOS DOIS A EMISSÃO RESPONDE — e a origem sai CARIMBADA,
    // porque número derivado não se apresenta como lido. O portal de SP e o
    // ADN trazem o campo; documento de prefeitura própria pode não trazer.
    if (mesEmissao) {
        return {
            competencia: mesEmissao,
            origem: 'emissao',
            diverge: false,
            motivo: 'O documento não traz competência nem data de fato gerador — a competência saiu da '
                + 'data de EMISSÃO. Se o serviço foi prestado no mês anterior, confira antes de fechar o mês.',
        };
    }

    // 🚨 NUNCA UM CHUTE: nota sem competência some de TODO recorte de mês, que
    // é este mesmo defeito com outra roupa (a régua de 01/09).
    return {
        competencia: null,
        origem: null,
        diverge: false,
        motivo: 'Nem a competência, nem a data do fato gerador, nem a de emissão são legíveis — sem '
            + 'competência a nota fica fora de todo recorte de mês. Reimporte o documento.',
    };
}

function montar(mes, origem, mesEmissao, isoEmissao, porque) {
    const diverge = !!mesEmissao && mesEmissao !== mes;
    return {
        competencia: mes,
        origem,
        diverge,
        // ⚠️ A divergência é FATO NORMAL em SP, nunca alarme: a nota de 31/08
        // pode ser emitida até 10/09 (05/09 quando há retenção). Dizer que é
        // erro faria conferir o que está certo — o que a frase faz é EXPLICAR
        // por que a nota aparece num mês diferente do da emissão, que é a
        // pergunta de quem olha as duas colunas do portal lado a lado.
        motivo: diverge
            ? `Emitida em ${ddmmaaaa(isoEmissao)} e escriturada na competência ${mes} ${porque} — é assim `
              + 'que a Prefeitura de SP recorta ("Incidência"), e em SP a nota de fim de mês pode ser '
              + 'emitida no mês seguinte (até o dia 10, ou o dia 5 quando há retenção).'
            : null,
    };
}
