// ============================================================================
// sefaz-backend/cte-cabecalho.js  (PURO — testável)
// ----------------------------------------------------------------------------
// O CABEÇALHO DO CT-e — CFOP, CST, alíquota e ICMS —, e a régua de quando a
// releitura do XML guardado recupera isso.
//
// ═══ POR QUE EXISTE (17/09, EDUARDO GUERRA · 08/2026) ═══════════════════════
//
// O `|D001|0|` foi corrigido e o arquivo passou a IMPORTAR no PVA — e o frete
// continuou fora: o bloco D saiu VAZIO, com o registro D100 em branco na tela
// do validador. A causa está medida e é de CAPTURA, não de geração: o CFOP do
// conhecimento mora no **CABEÇALHO** do XML (`<ide><CFOP>`), e até 21/08 a
// captura só lia o de dentro de `<prod>`, que o CT-e não tem. CT-e capturado
// antes daquela data está gravado SEM `cfop` — e `cfopDoCte` o descarta, com
// razão (cravar um valor declararia a NATUREZA da operação de transporte no
// escuro: foi o `5352` em 100% dos conhecimentos, e o `1405` antes dele).
//
// 🚨 E OS DOIS ♻️ QUE EXISTIAM NÃO ALCANÇAM O CT-e — medido, não deduzido:
//
//   · **♻️ Reler itens dos XMLs** (`backfill-itens-fiscais`) só mexe em campos
//     de ITEM, e o CT-e não tem `itens[]` — `parearItens` devolve vazio com
//     "sem itens de um dos lados";
//   · **♻️ Reler XMLs guardados** (`releitura-notas-vazias`) devolve
//     `'fora-do-escopo'` para CT-e, dito no próprio comentário de lá.
//
// Ou seja: a régua existia, o XML estava no Storage, e **não havia caminho**
// para trazer o dado — enquanto o aviso da geração mandava rodar o ♻️. É o
// achado 18 (21/08) na forma mais cara: aviso apontando um lugar que não
// resolve, e quem o escreveu fui eu.
//
// ⚠️ BACKFILL NÃO APAGA E NÃO SOBRESCREVE (régua de 13/08): só preenche o que
// está VAZIO. Divergência entre o gravado e a fonte é ALERTA (06/08), e alerta
// não se resolve por escrita silenciosa.
//
// ⚠️ AUSENTE ≠ ZERO, e aqui isso decide o LIVRO: alíquota que o XML não traz
// fica `null` (o gerador já lê 0 na falta); alíquota que o XML declara **0**
// é FATO e é gravada. O gabarito prova que o caso existe — o EFD de 05/2026
// desta mesma empresa, gerado pelo e-Fiscal e ACEITO, traz os 34 D190 com CST
// 090, alíquota 0 e ICMS ZERO.
// ============================================================================

import { ehConhecimentoDeTransporte } from './sped-selecao-documentos.js';

/**
 * Sobe quando este módulo aprende a ler um campo novo do cabeçalho.
 *
 * O carimbo é de VERSÃO, nunca "tem algum campo preenchido" (13/08): a
 * condição-alvo NÃO se limpa sozinha — um CT-e isento nunca vai ter `vICMS`,
 * e julgar pela presença faria o backfill rebaixar o mesmo documento para
 * sempre.
 *
 * **2** (18/09) — passou a ler `cMunIni`/`cMunFim`, os campos 24 e 25 do D100
 * do EFD ICMS/IPI. Subir o número recoloca na fila o que já foi relido na v1.
 */
export const VERSAO_RELEITURA_CTE = 2;

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** Vazio = ausente. `0` e `'0'` NÃO são vazios: zero é resposta. */
function vazio(v) {
    return v === undefined || v === null || v === '';
}

function bloco(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return m ? m[1] : '';
}

function tag(xml, nome) {
    const m = String(xml || '').match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`, 'i'));
    return m ? m[1].trim() : null;
}

/** Número do XML; `null` quando a tag não existe — ausência não vira zero. */
function numeroOuNulo(txt) {
    if (txt === null || txt === undefined || txt === '') return null;
    const n = parseFloat(String(txt).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

/** O arquivo é um CT-e? (a raiz do documento, não o rótulo gravado no banco) */
export function xmlEhCte(xml) {
    return /<(infCte|cteProc|CTe)\b/i.test(String(xml || ''));
}

/**
 * Lê o cabeçalho de um CT-e.
 *
 * 🚨 Devolve `null` para qualquer coisa que não seja CT-e, e isso é a trava:
 * numa NF-e uma busca solta por `<CFOP>`/`<vBC>` acharia os do PRIMEIRO ITEM —
 * dado do item ocupando a casa do documento, que numa nota mista é falso.
 *
 * @returns {null|{cfop:string|null, cstIcms:string|null, aliqIcms:number|null,
 *                 vBC:number|null, vICMS:number|null,
 *                 codMunIni:string|null, codMunFim:string|null}}
 */
export function lerCabecalhoCte(xml) {
    if (!xmlEhCte(xml)) return null;

    // O CFOP do CT-e vive em <ide>; recortar antes evita casar com um <CFOP>
    // que venha em outro grupo do documento.
    const ide = bloco(xml, 'ide');
    const cfopCru = soDigitos(tag(ide, 'CFOP') || tag(xml, 'CFOP'));

    // 🚨 OS MUNICÍPIOS DA PRESTAÇÃO — campos 24/25 do D100 (EFD ICMS/IPI).
    //
    // O Guia 3.2.3 os define como *"código do município de ORIGEM do serviço"*
    // e *"de DESTINO"*, conforme a tabela IBGE, e é o `<ide>` do CT-e que
    // declara os dois: `cMunIni` e `cMunFim`.
    //
    // ⚠️ NÃO SÃO O MUNICÍPIO DOS PARTICIPANTES, e confundi-los seria afirmar
    // outra coisa: `codMunEmit`/`codMunDest` dizem onde cada parte está
    // DOMICILIADA, e o frete pode começar e terminar longe dos dois. Por isso
    // os campos têm nome próprio, e ausência devolve `null` em vez de cair no
    // município do emitente.
    const codMunIni = soDigitos(tag(ide, 'cMunIni'));
    const codMunFim = soDigitos(tag(ide, 'cMunFim'));

    // ICMS do conhecimento: <imp><ICMS><ICMS00|ICMS20|ICMS45|ICMS60|ICMS90|
    // ICMSOutraUF|ICMSSN>. Os campos do grupo "OutraUF" levam sufixo próprio,
    // e ICMS45 (isento/não tributado/diferido) traz SÓ o CST — por isso cada
    // leitura devolve `null` quando a tag não existe, em vez de 0.
    const imp = bloco(xml, 'imp');
    const icms = bloco(imp, 'ICMS') || imp;

    const cstCru = soDigitos(tag(icms, 'CST'));
    const aliq = numeroOuNulo(tag(icms, 'pICMS') ?? tag(icms, 'pICMSOutraUF'));
    const vBC = numeroOuNulo(tag(icms, 'vBC') ?? tag(icms, 'vBCOutraUF'));
    const vICMS = numeroOuNulo(tag(icms, 'vICMS') ?? tag(icms, 'vICMSOutraUF'));

    return {
        cfop: cfopCru.length === 4 ? cfopCru : null,
        cstIcms: cstCru || null,
        aliqIcms: aliq,
        vBC,
        vICMS,
        codMunIni: codMunIni.length === 7 ? codMunIni : null,
        codMunFim: codMunFim.length === 7 ? codMunFim : null,
    };
}

/**
 * Classifica um documento ANTES de baixar o arquivo — cada causa tem ação
 * própria e o resultado do botão responde POR CAUSA.
 *
 * @returns {'fora-do-escopo'|'completo'|'ja-relido'|'sem-arquivo'|'alvo'}
 */
export function classificarCteParaCabecalho(d) {
    if (!ehConhecimentoDeTransporte(d)) return 'fora-do-escopo';

    const temCfop = soDigitos(d?.cfop).length === 4;
    const temCst = !!soDigitos(d?.cstIcms);
    const temAliq = !vazio(d?.aliqIcms);
    const t = d?.totais || {};
    const temIcms = !vazio(t.vBC) && !vazio(t.vICMS);
    // Os municípios da prestação entram na conta do "completo" porque são
    // campos OBRIGATÓRIOS do D100 nas entradas (Guia 3.2.3, campos 24 e 25):
    // sem eles o arquivo passa na contagem e o PVA recusa por campo vazio.
    const temMunicipios = !!soDigitos(d?.codMunIniCte) && !!soDigitos(d?.codMunFimCte);
    if (temCfop && temCst && temAliq && temIcms && temMunicipios) return 'completo';

    if (Number(d?.cabecalhoCteVersao) >= VERSAO_RELEITURA_CTE) return 'ja-relido';
    if (!d?.storagePath) return 'sem-arquivo';
    return 'alvo';
}

/**
 * Patch da releitura — SÓ preenche o que está vazio.
 *
 * @param {object} d      documento como está no banco
 * @param {object} lido   saída de `lerCabecalhoCte`
 * @returns {object}      campos a gravar (vazio = nada a preencher)
 */
export function patchDoCabecalhoCte(d, lido) {
    const patch = {};
    if (!lido) return patch;

    if (!soDigitos(d?.cfop) && lido.cfop) patch.cfop = lido.cfop;
    if (!soDigitos(d?.cstIcms) && lido.cstIcms) patch.cstIcms = lido.cstIcms;
    if (!soDigitos(d?.codMunIniCte) && lido.codMunIni) patch.codMunIniCte = lido.codMunIni;
    if (!soDigitos(d?.codMunFimCte) && lido.codMunFim) patch.codMunFimCte = lido.codMunFim;
    // Zero DECLARADO entra (é a resposta do documento isento); ausente, não.
    if (vazio(d?.aliqIcms) && lido.aliqIcms !== null) patch.aliqIcms = lido.aliqIcms;

    // `totais` do CT-e não vem de <ICMSTot> (isso é NF-e), então o documento
    // capturado fica com ele nulo e o D190 sai com base e ICMS 0,00. Aqui o
    // que o conhecimento DESTACA volta para o livro — sem tocar no que já
    // estiver gravado.
    const t = d?.totais || {};
    const totais = {};
    if (vazio(t.vBC) && lido.vBC !== null) totais.vBC = lido.vBC;
    if (vazio(t.vICMS) && lido.vICMS !== null) totais.vICMS = lido.vICMS;
    if (Object.keys(totais).length) patch.totais = { ...t, ...totais };

    return patch;
}
