// ============================================================================
// Bloco D do EFD ICMS/IPI — Servicos de Transporte (CTe, modelo 57).
//
// Registros gerados:
//   D001 — Abertura do Bloco D
//   D100 — Aquisicao de Servicos de Transporte (1 por CTe)
//   D190 — Registro Analitico (agregacao por CST/CFOP/aliquota)
//   D990 — Encerramento do Bloco D
//
// MDFe (modelo 58) NAO tem registro proprio no SPED Fiscal — eh documento
// auxiliar de transporte, nao fiscal. Apuracao do ICMS-frete eh via CTe.
//
// Layout: Guia Pratico EFD ICMS/IPI 3.2.2 - Bloco D.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
import { selecionarCtesBlocoD, codSitDoDocumento, serieDoDocumento, numeroDoDocumento } from './sped-selecao-documentos.js';
// Réguas DONAS da leitura do documento — o CT-e capturado grava os campos
// achatados, e ler só a forma aninhada fazia o COD_PART cair num literal.
import {
    docCancelado, direcaoEfetivaDoc, valorDoDocumentoServico,
} from './xml-metadata-helper.js';
import { participanteDoDocumento, ehEmissaoPropriaDoc } from './participante-doc-helper.js';
import { normalizarParticipantesDoc } from './dipam-produtor-rural.js';
// A correlação de CFOP é a MESMA do C190 — o CT-e traz o código do
// transportador, e quem toma o frete escritura na ótica de entrada.
import { cfopDoLancamento } from './cfop-correlacao.js';
// 🚚 O CT-e COMO ITEM (21/09, EDUARDO GUERRA): o cabeçalho do conhecimento é
// o único "item" dele, e é por essa forma que o frete passa pela MESMA régua
// de CST e de crédito de ICMS do C170/C190 — o CST INFORMADO na nota vence, o
// REGIME de quem escritura decide o crédito, e só então o destaque do
// documento. Escrever uma versão "para CT-e" seria a segunda cópia.
import {
    cfopDoCte as cfopDoCteDoDono, cstDoCte as cstDoCteDoDono, itemSinteticoDoCte,
    icmsDestacadoDoCte, avisosDeCteSemCredito,
} from './cte-escrituracao.js';
import { icmsDoItemNoArquivo, cstDoItemNoArquivo, creditoIcmsDoItem } from './sped-fiscal-blocoC.js';
import { regimeDaEmpresa } from './regime-tributario.js';

/** Valor do documento; 0 quando não há valor em forma nenhuma (o aviso é do chamador). */
const valorDoDoc = (nota) => {
    const v = valorDoDocumentoServico(nota);
    return Number.isFinite(v) ? v : 0;
};

/**
 * CFOP/CST do cabeçalho do CT-e — o DONO é `cte-escrituracao.js` (a tela lê de
 * lá também); aqui só a re-exportação, para quem já importava daqui.
 */
export const cfopDoCte = cfopDoCteDoDono;
export const cstDoCte = cstDoCteDoDono;

/** O regime de quem escritura, no vocabulário de `regime-tributario.js` (só para a frase do aviso). */
function regimeDoArquivoD(dados) {
    if (dados?.regimeEscrituracao) return String(dados.regimeEscrituracao);
    const empresa = dados?.empresa;
    if (!empresa) return '';
    const colecao = empresa.colecao
        || (empresa._regime === 'simples' ? 'simples_empresas' : (empresa._regime === 'lucro' ? 'lucro_empresas' : ''));
    const r = regimeDaEmpresa({ ...empresa, colecao }).regime;
    return r === 'INDEFINIDO' ? '' : r;
}

/**
 * Mapeia status interno -> COD_SIT do registro D100 (mesmo do C100).
 */

/**
 * Filtra documentos que entram no Bloco D.
 * - Modelo 57 (CTe)
 * - Tipo 'CTe' (defensivo - se modelo bate, tipo ja deve estar ok)
 */
function filtrarNotasBlocoD(notas) {
    // O modelo sai da RÉGUA, não do campo cru: o importer principal não grava
    // `modelo`, e ler o campo deixava todo CT-e capturado fora do bloco (mesma
    // causa do caso PS VIDROS no bloco C, 19/08).
    return selecionarCtesBlocoD(notas);
}

/**
 * D100 — Nota Fiscal de Servico de Transporte (CTe)
 *
 * Campos principais:
 *  01 REG          'D100'
 *  02 IND_OPER     0=Aquisicao (entrada), 1=Prestacao (saida)
 *  03 IND_EMIT     0=Emissao propria, 1=Terceiros
 *  04 COD_PART     Codigo do participante (do 0150)
 *  05 COD_MOD      '57'
 *  06 COD_SIT      Status (00 regular, 02 cancelado, etc)
 *  07 SER          Serie (max 4)
 *  08 SUB          Subserie (max 3, vazio se nao houver)
 *  09 NUM_DOC      Numero do CTe
 *  10 CHV_CTE      Chave de acesso (44 digitos)
 *  11 DT_DOC       Data emissao (DDMMAAAA)
 *  12 DT_A_P       Data aquisicao/prestacao (DDMMAAAA)
 *  13 TP_CT_E      Tipo CTe (0=normal, 1=complemento, 2=anulacao, 3=substituto)
 *  14 CHV_CTE_REF  Chave CTe referenciado (vazio se TP_CT_E=0)
 *  15 VL_DOC       Valor total do documento
 *  16 VL_DESC      Valor desconto
 *  17 IND_FRT      0=CIF, 1=FOB, 2=Tercer., 9=Sem cobranca
 *  18 VL_SERV      Valor da prestacao do servico (vTPrest)
 *  19 VL_BC_ICMS   Base calculo ICMS
 *  20 VL_ICMS      Valor ICMS
 *  21 VL_NT        Valor nao-tributado
 *  22 COD_INF      Codigo informacao complementar (vazio)
 *  23 COD_CTA      Codigo conta contabil (vazio)
 *  24 COD_MUN_ORIG Municipio de ORIGEM do servico (IBGE)
 *  25 COD_MUN_DEST Municipio de DESTINO do servico (IBGE)
 *
 * 🚨 ESTE REGISTRO TEM 25 CAMPOS AQUI E 23 NO EFD-CONTRIBUIÇÕES — e o gerador
 * parava no 23 (18/09, EDUARDO GUERRA · 08/2026: **23 recusas de importação**,
 * todas *"o número de campos informado no registro difere do número de campos
 * especificado no leiaute"*, com *Valor Esperado 25 · Conteúdo do Campo 23*).
 * É a MESMA confusão que já custou recibo no 1010 (17/08) e no 0500 (24/08):
 * mesmo número de registro, arquivo diferente, leiaute diferente.
 */
function buildD100(notaCrua, dados) {
    // 🚨 CINCO LEITURAS CRUAS NUM REGISTRO SÓ (21/08, varredura dos leitores de
    // documento). Este bloco lia `nota.emitente?.cnpj` — e a régua monta
    // `.cnpjCpf` enquanto a captura grava `cnpjEmit`: NENHUMA das duas era
    // lida, então `indEmit` saía sempre '1' e o COD_PART caía no literal
    // 'PARTSEM' — um participante INVENTADO, que o 0150 nunca teria.
    const nota = normalizarParticipantesDoc(notaCrua);
    const t = nota.totais || {};
    // COD_SIT pela régua ÚNICA — a mesma do C100 (a tabela é a mesma). Este
    // bloco tinha a SEGUNDA cópia, e ela devolvia '08' (regime especial) para
    // status desconhecido: afirmação sobre a natureza do documento, feita por
    // default. Cobre o cancelamento por evento.
    const codSit = codSitDoDocumento(nota, dados.empresa?.dadosFiscais?.uf);

    const indOper = direcaoEfetivaDoc(nota) === 'saida' ? '1' : '0';

    // Emissão própria pela MESMA régua do bloco C (cobre a nota própria de
    // entrada, que é emissão própria mesmo entrando).
    const indEmit = ehEmissaoPropriaDoc(nota, dados.empresa?.cnpj) ? '0' : '1';

    // Código do participante: o "outro lado" pela régua ÚNICA — a mesma que o
    // C100 e o coletor do 0150 usam, senão o D100 aponta para quem o 0150 não
    // cadastrou. Sem participante legível o campo sai VAZIO, nunca inventado.
    const participante = participanteDoDocumento(nota, dados.empresa?.cnpj);
    // 🚨 CANCELADA/DENEGADA SAI QUASE VAZIA — Guia 3.2.3, D100, Exceção 1:
    // *"preencher somente os campos REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT,
    // SER, SUB, NUM_DOC e CHV_CTE. Demais campos deverão ser apresentados com
    // conteúdo VAZIO. Não deverão ser informados registros filhos."* É a mesma
    // recusa que o PVA deu 19× no C100 da ELS (11/09); o D100 tinha o defeito
    // inteiro, esperando o primeiro CT-e cancelado.
    const ehCancelada = ['02', '03', '04'].includes(codSit);
    const soCancelavel = (valor) => (ehCancelada ? '' : valor);
    const codPart = ehCancelada ? '' : String(participante?.cnpjCpf || participante?.cnpj || '').replace(/\D/g, '');

    // Tipo CTe: campo tpCTe do XML; default 0 (normal)
    const tpCte = String(nota.tpCTe || '0').slice(0, 1);
    // Base e ICMS COMO VÃO PARA O ARQUIVO — a régua do item, pelo item sintético.
    const icmsNoArquivo = icmsDoItemNoArquivo(itemSinteticoDoCte(nota), { ...nota, _dados: dados });

    return fmt.buildLine([
        'D100',
        indOper,
        indEmit,
        codPart,
        '57',
        codSit,
        // SER — a régua, nunca o '1' inventado: sem o campo gravado a série
        // sai da CHAVE (posições 23-25), e '000' quando não há série.
        serieDoDocumento(nota),
        '',  // SUB
        // NUM_DOC pelo DONO — o gravado, ou o número que a CHAVE carrega
        // (posições 26-34). O CT-e capturado não tinha `numero` (a captura lia
        // `nNF`, e o conhecimento traz `nCT`) e o campo saía VAZIO em 100% das
        // linhas; ver `numeroDoDocumento`.
        fmt.sanitizeString(numeroDoDocumento(nota), 9),
        fmt.sanitizeString(nota.chave || nota.chaveAcesso || '', 44),
        soCancelavel(fmt.formatDate(nota.dataEmissao || nota.dhEmi)),
        soCancelavel(fmt.formatDate(nota.dataEntrada || nota.dataEmissao || nota.dhEmi)),
        soCancelavel(tpCte),
        soCancelavel(fmt.sanitizeString(nota.chaveCTeRef || '', 44)),
        // VL_DOC pela régua do VALOR: o CT-e capturado grava `valorTotal` na
        // raiz (o XML traz <vTPrest>), e `t.vNF || t.valor` não existe nele —
        // era o mesmo VL_DOC 0,00 do bloco D do EFD-Contribuições.
        soCancelavel(fmt.formatValue(valorDoDoc(nota), 2)),
        soCancelavel(fmt.formatValue(t.vDesc || 0, 2)),
        soCancelavel('9'),  // IND_FRT default sem cobranca (CTe nao tem o conceito de frete sobre frete)
        soCancelavel(fmt.formatValue(t.vTPrest || t.vServ || valorDoDoc(nota), 2)),
        // 🚚 VL_BC_ICMS/VL_ICMS pelo MESMO dono do D190 (21/09): o PVA cruza
        // os dois (Guia 3.2.3, D190 campos 06/07 = os do D100 pai — a R33 da
        // prevalidação). Com CST informado 90 o D190 sai zero; se o pai
        // continuasse lendo os `totais`, o arquivo se desmentiria por dentro.
        soCancelavel(fmt.formatValue(icmsNoArquivo.vBC || 0, 2)),
        soCancelavel(fmt.formatValue(icmsNoArquivo.vICMS || 0, 2)),
        soCancelavel(fmt.formatValue(t.vNT || 0, 2)),
        '',  // COD_INF
        '',  // COD_CTA
        // 24/25 — COD_MUN_ORIG e COD_MUN_DEST, os dois campos que faltavam.
        //
        // ⚠️ O APP NÃO OS DEDUZ: o Guia manda o município da PRESTAÇÃO (o
        // `cMunIni`/`cMunFim` do `<ide>` do CT-e), e o do EMITENTE/DESTINATÁRIO
        // é outro fato — o frete pode começar e terminar longe dos dois. Cair
        // no `codMunEmit` faria o arquivo AFIRMAR uma origem que o documento
        // não declara, e o PVA aceita (é a família do `1405` e do `5352`).
        // Sem o dado o campo sai VAZIO e a geração DIZ, com a ação: ausência o
        // PVA acusa, município errado não.
        soCancelavel(fmt.sanitizeString(codMunDaPrestacao(nota, 'ini'), 7)),
        soCancelavel(fmt.sanitizeString(codMunDaPrestacao(nota, 'fim'), 7)),
    ]);
}

/**
 * Município de ORIGEM/DESTINO da prestação, como o CT-e o declara.
 *
 * Fonte única: `cMunIni`/`cMunFim` do `<ide>`, que a captura grava em
 * `codMunIniCte`/`codMunFimCte` (ver `cte-cabecalho.js`). Devolve **''** quando
 * o documento não traz — e o vazio é a RESPOSTA, não um default.
 */
export function codMunDaPrestacao(nota, lado) {
    const bruto = lado === 'fim' ? nota?.codMunFimCte : nota?.codMunIniCte;
    const cru = String(bruto || '').replace(/\D/g, '');
    return cru.length === 7 ? cru : '';
}

/**
 * D190 — Registro Analitico de Operacoes (Bloco D)
 *
 * Agrega CTes por (CST_ICMS, CFOP, ALIQ_ICMS) com totais.
 * Pelo menos 1 D190 por D100 (mesmo que zerado).
 *
 * Campos:
 *  01 REG          'D190'
 *  02 CST_ICMS     CST do ICMS (3 digitos)
 *  03 CFOP         CFOP (4 digitos)
 *  04 ALIQ_ICMS    Aliquota ICMS
 *  05 VL_OPR       Valor da operacao
 *  06 VL_BC_ICMS   Base de calculo
 *  07 VL_ICMS      Valor ICMS
 *  08 VL_RED_BC    Valor reducao BC (vazio)
 *  09 COD_OBS      Codigo observacao (vazio)
 */
/**
 * @param {object} nota   o CT-e
 * @param {object} dados  os dados da geração (é deles que sai o REGIME)
 * @returns {{linha: string, semCredito: null|{numero: string, destacado: number, por: string}}}
 */
function buildD190PorNota(nota, dados) {
    // 🚨 SEM CFOP/CST INVENTADO (21/08): o CFOP saía CRAVADO em '5352'
    // ("prestação a estabelecimento industrial") em 100% dos conhecimentos,
    // porque a captura só lia o CFOP de dentro de <prod> — e o CT-e o traz no
    // CABEÇALHO. Cravar aqui é afirmar a NATUREZA da operação de transporte,
    // que é justamente o que a fiscalização lê. Quem não tem CFOP legível não
    // entra no bloco (ver `cfopDoCte`): aqui ele já chegou conferido.
    //
    // ⚠️ E o CFOP passa pela MESMA régua do C190: o CT-e traz o CFOP do
    // TRANSPORTADOR (5352/6352 — a prestação, do lado dele), e quem TOMA o
    // frete escritura na ótica de entrada (1352/2352). Preservar o do emitente
    // escrituraria a operação DELE — é a lição da correlação de CFOP.
    const cfop = String(
        // O CT-e não tem ITEM: o CFOP mora no cabeçalho, e o `null` diz isso de
        // propósito (o 5º argumento é obrigatório pelo registro consumidoresMedidos).
        cfopDoLancamento(nota, cfopDoCte(nota), direcaoEfetivaDoc(nota), {}, null) || cfopDoCte(nota),
    ).padStart(4, '0').slice(-4);

    // 🚚 CST, BASE, ALÍQUOTA E ICMS PELA MESMA RÉGUA DO C170/C190 (21/09):
    // o cabeçalho vira o item sintético e passa pelos donos do bloco C —
    // `cstDoItemNoArquivo` (CST informado > conversão > regime > documento) e
    // `icmsDoItemNoArquivo` (sem crédito ⇒ base, alíquota e ICMS ZERO). Até
    // aqui o D190 lia o CST cru e os `totais` do documento: informar CST 90
    // num frete não tirava o crédito do arquivo, e optante saía creditando
    // frete — o C190 ao lado já não fazia nenhuma das duas coisas.
    const item = itemSinteticoDoCte(nota);
    const notaComDados = { ...nota, _dados: dados };
    const cstIcms = String(cstDoItemNoArquivo(item, cfop, notaComDados)).padStart(3, '0').slice(-3);
    const icms = icmsDoItemNoArquivo(item, notaComDados);
    const credito = creditoIcmsDoItem(item, notaComDados);

    const linha = fmt.buildLine([
        'D190',
        cstIcms,
        cfop,
        fmt.formatValue(icms.aliq, 2),
        // VL_OPR pela MESMA régua do VL_DOC do D100 — se os dois lerem formas
        // diferentes, o resumo contradiz o documento que ele resume.
        fmt.formatValue(valorDoDoc(nota), 2),
        fmt.formatValue(icms.vBC || 0, 2),
        fmt.formatValue(icms.vICMS || 0, 2),
        '',  // VL_RED_BC
        '',  // COD_OBS
    ]);
    // O que saiu do crédito vai DITO com o número — só quando havia destaque:
    // zerar o que já era zero não é notícia (o gabarito da EDUARDO GUERRA sai
    // com CST 090, alíquota 0 e ICMS 0 e não pode ganhar aviso).
    const destacado = icmsDestacadoDoCte(nota);
    const semCredito = icms.semCredito && destacado > 0
        ? { numero: String(numeroDoDocumento(nota) || nota.chave || '(sem número)'), destacado, por: credito.por }
        : null;
    return { linha, semCredito };
}

/**
 * Monta o Bloco D completo a partir de dados.notas filtradas por modelo 57.
 */
export function buildBlocoD(dados) {
    // 🚨 A ABERTURA VEM DEPOIS DO CONTEÚDO (17/09, EDUARDO GUERRA): o `D001`
    // saía `0` (bloco COM dados) pela CONTAGEM DA SELEÇÃO, e o laço abaixo
    // podia descartar todos os CT-e — o arquivo prometia movimento e entregava
    // `|D001|0|` seguido de `|D990|2|`. Quem decide o IND_MOV é o que este
    // gerador EMITIU; ver `fmt.abrirBloco`.
    const linhas = [];
    const notas = filtrarNotasBlocoD(dados.notas);

    // D100 + D190 por CTe
    /** CT-e sem CFOP legível: sai NOMEADO em vez de entrar com natureza inventada. */
    const semCfop = [];
    /** Quanto de frete e de ICMS ficou de fora — o aviso DIZ o número, não só a contagem. */
    let valorFora = 0;
    let icmsFora = 0;
    /**
     * CT-e que ENTROU no bloco e saiu sem o município da prestação.
     *
     * ⚠️ Ele NÃO fica de fora por isso: tirar o conhecimento do livro por causa
     * de um campo de cadastro seria trocar uma recusa (campo obrigatório, que
     * se conserta e reenvia) por LIVRO A MENOR, que não se confere depois.
     */
    const semMunicipio = [];
    /** CT-e cujo ICMS destacado ficou FORA do crédito (CST informado ou regime). */
    const semCredito = [];
    for (const nota of notas) {
        try {
            if (!cfopDoCte(nota)) {
                semCfop.push(String(numeroDoDocumento(nota) || nota.chave || '(sem número)'));
                valorFora += valorDoDoc(nota);
                icmsFora += Number(nota?.totais?.vICMS) || 0;
                continue;
            }
            if (!codMunDaPrestacao(nota, 'ini') || !codMunDaPrestacao(nota, 'fim')) {
                semMunicipio.push(String(numeroDoDocumento(nota) || nota.chave || '(sem número)'));
            }
            linhas.push(buildD100(nota, dados));
            // D190 pra cada CTe — agrupamento detalhado pode vir em fase futura.
            // Cancelado/denegado não leva filho (D100, Exceção 1).
            if (!docCancelado(nota) && !['denegado', 'inutilizado'].includes(String(nota.status || ''))) {
                const d190 = buildD190PorNota(nota, dados);
                linhas.push(d190.linha);
                if (d190.semCredito) semCredito.push(d190.semCredito);
            }
        } catch (e) {
            console.error(`[blocoD] erro ao gerar registros do CTe ${nota.chave || nota.numero}:`, e.message);
        }
    }
    if (semCfop.length && Array.isArray(dados.warnings)) {
        // ⚠️ A CONSEQUÊNCIA VAI DITA COM O NÚMERO, não só a contagem: sem o CFOP o
        // conhecimento não vira D100/D190, então aquele VALOR de frete não é
        // escriturado. Quando TODOS caem aqui o bloco sai SEM DADOS — e quem
        // conferir o arquivo precisa saber que o bloco vazio é consequência disto,
        // não ausência de frete no mês.
        // ⚠️ O ICMS SÓ VAI DITO QUANDO EXISTE (17/09, medido no EFD de 05/2026 da
        // EDUARDO GUERRA, gerado pelo e-Fiscal e ACEITO): os 34 CT-e dela saem com
        // CST 090, alíquota 0 e ICMS ZERO. Afirmar "o ICMS fica fora do livro" ali
        // prometeria um crédito que não existe — frase que afirma demais é o
        // `csllOuTotal` com outra roupa (02/09).
        const todos = linhas.length === 0;
        const dinheiro = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        dados.warnings.push(
            `Bloco D: ${semCfop.length} CT-e ficaram FORA porque o CFOP não foi capturado — `
            + `nº ${semCfop.slice(0, 10).join(', ')}${semCfop.length > 10 ? ` e mais ${semCfop.length - 10}` : ''}. `
            + 'O CFOP do CT-e mora no CABEÇALHO do XML e a captura antiga não o lia; cravar um valor aqui '
            + 'declararia a NATUREZA da operação de transporte no escuro. '
            + (todos
                ? `Com isso o bloco D sai SEM DADOS (D001 com IND_MOV=1) e NENHUM frete foi escriturado nesta competência — R$ ${dinheiro(valorFora)} ficaram fora do livro`
                : `O frete desses conhecimentos não foi escriturado — R$ ${dinheiro(valorFora)} ficaram fora do livro`)
            + (icmsFora > 0 ? `, junto com R$ ${dinheiro(icmsFora)} de ICMS. ` : ' (esses CT-e não têm ICMS destacado). ')
            // 🚨 A AÇÃO APONTA O BOTÃO QUE ALCANÇA O CT-e (17/09, medido): esta
            // frase mandava rodar "o ♻️" genérico, e NENHUM dos dois que
            // existiam alcança conhecimento de transporte — o de itens não acha
            // `itens[]` (o CT-e não tem) e o de notas vazias devolve
            // 'fora-do-escopo' para CT-e. É o achado 18 (21/08) na forma mais
            // cara: aviso apontando um lugar que não resolve, num arquivo que o
            // PVA ACEITA sem o frete.
            + 'Rode o 🚚 Reler cabeçalho dos CT-e em Relatórios → ✏️ CFOP por nota (é ele que lê o '
            + 'cabeçalho do XML guardado — o ♻️ de itens não alcança o CT-e), ou reimporte o XML do '
            + 'conhecimento; depois regere o arquivo.',
        );
    }

    // 🚨 A RECUSA SEGUINTE, DITA ANTES (a lição de 24/08: meia correção troca
    // uma recusa por outra, e a segunda chega no mês seguinte parecendo
    // problema novo). Com os campos 24/25 no lugar a CONTAGEM fecha — e o PVA
    // passa a cobrar o CONTEÚDO: *"Campo obrigatório nas entradas, se COD_MOD
    // do registro D100 for 57, 63 ou 67"* (Guia 3.2.3, campos 24 e 25).
    if (semMunicipio.length && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            `Bloco D: ${semMunicipio.length} CT-e saíram SEM o município de origem/destino da `
            + `prestação (campos 24 e 25 do D100) — nº ${semMunicipio.slice(0, 10).join(', ')}`
            + `${semMunicipio.length > 10 ? ` e mais ${semMunicipio.length - 10}` : ''}. `
            + 'Eles CONTINUAM no livro (tirá-los seria livro a menos), mas o PVA recusa cada um: '
            + 'esses campos são obrigatórios nas entradas de CT-e. O código vem do cabeçalho do XML '
            + '(cMunIni/cMunFim) e o app NÃO o deduz do município do emitente — o frete pode começar '
            + 'e terminar longe das partes. Rode o 🚚 Reler cabeçalho dos CT-e em Relatórios → '
            + '✏️ CFOP por nota e regere; se o XML também não trouxer, o dado é com o transportador.',
        );
    }

    // 🚚 O CRÉDITO QUE O FRETE PERDEU VAI DITO, POR CAUSA (21/09): CST informado
    // na nota (decisão de quem escritura) e regime (optante não se credita)
    // pedem ações diferentes, e o número — o ICMS que o transportador destacou
    // — vai junto, senão quem compara o livro do PVA com o DACTE vê base e
    // ICMS zerados e procura captura que não falhou.
    if (semCredito.length && Array.isArray(dados.warnings)) {
        for (const aviso of avisosDeCteSemCredito(semCredito, regimeDoArquivoD(dados))) dados.warnings.push(aviso);
    }

    // D001 — Abertura, DEPOIS do conteúdo (ver o mata-burro no topo da função).
    // D990 — Encerramento; o total INCLUI a abertura e o próprio D990.
    return [
        fmt.abrirBloco('D001', linhas),
        ...linhas,
        fmt.buildLine(['D990', linhas.length + 2]),
    ];
}
