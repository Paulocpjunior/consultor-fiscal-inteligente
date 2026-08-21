// ============================================================================
// reconferir-cancelamento.js  (PURO — sem Express, sem Firebase, sem rede)
// ----------------------------------------------------------------------------
// PERGUNTAR À SEFAZ SE A NOTA FOI CANCELADA — porque para a SAÍDA não há
// nenhum outro jeito de saber.
//
// ═══ O CASO (Eunice, 11/08 — LANCHONETE JO BRAS) ════════════════════════════
//
// *"quando lançamos uma nota cancelada aqui no consultor, como é feito o
// reconhecimento dessa nota? Porque no e-Fiscal as notas são reconhecidas como
// canceladas, mas no consultor está contabilizando para o faturamento."*
//
// A leitura do CFI está certa e é única (`docCancelado`): status, cStat 101/151
// da própria nota, ou evento 110111 com cStat 135/155. O problema é ANTERIOR —
// o cancelamento NUNCA CHEGOU.
//
// É estrutural, não descuido: a SEFAZ **não entrega ao emitente** os documentos
// que ele mesmo emitiu (Rejeição 641), então a saída entra pelo COFRE DE E-MAIL.
// E o cofre traz o que o cliente manda — que é o XML AUTORIZADO. Ninguém manda,
// por e-mail, o evento de cancelamento do dia seguinte. Resultado: a nota entra
// 'autorizado' e fica assim para sempre, contando no faturamento.
//
// O painel da empresa dizendo "0 cancelada(s)" não é a SEFAZ dizendo que não há
// cancelamento — é o app dizendo que nunca soube de nenhum. São coisas
// diferentes, e é essa diferença que o colaborador não tem como ver.
//
// ═══ A SOLUÇÃO É PERGUNTAR, NÃO DEDUZIR ════════════════════════════════════
//
// Mesma técnica da sonda do PGDAS-D e das sondas do R-2055: existe um oráculo
// GRÁTIS (a consulta por chave já implementada, `consultaNFePorChave`), e ele
// devolve os EVENTOS junto do documento. Perguntar é PROVA.
//
// ═══ AS TRAVAS ══════════════════════════════════════════════════════════════
//
// 1. **FALHA DE CONSULTA NUNCA VIRA "não cancelada".** Rede caída, certificado
//    recusado, cStat inesperado ⇒ `indeterminado`, e o doc fica COMO ESTÁ. O
//    oposto (concluir que está válida porque a pergunta falhou) transformaria
//    uma falha de infraestrutura em faturamento a maior — exatamente o defeito
//    que este módulo existe para matar.
// 2. **NÃO EXISTE "DESCANCELAR".** A reconferência só sabe ACRESCENTAR o
//    cancelamento. Se o app tem a nota como cancelada e a SEFAZ não mostra o
//    evento, isso é DIVERGÊNCIA para a tela — nunca reversão automática: a
//    consulta pode ter respondido por outro ambiente/UF, e desfazer um
//    cancelamento reintroduz receita que já foi (corretamente) excluída.
// 3. **A CONTA DA CONSULTA APARECE ANTES.** Cada nota é uma chamada à SEFAZ com
//    o certificado do cliente. O painel diz quantas serão consultadas antes de
//    começar — varredura silenciosa de 700 notas é o tipo de coisa que derruba
//    o acesso da empresa por excesso (cStat 656).
// 4. **SÓ NF-e (modelo 55) — a própria SEFAZ que provou isso.** Paulo, MV
//    LIDER 639 · 18/08, rodou a reconferência e voltou 20 de 20
//    "[indeterminado] ... cStat 618 — Rejeicao: Chave de Acesso invalida
//    (modelo diferente de 55)". A seleção ordena por `numero` e não separava
//    por modelo — a série de NFC-e (mod 65) daquela empresa tem numeração
//    BAIXA (293-345) e ficava na FRENTE da fila, ordenada antes da série de
//    NF-e (mod 55, 3736-3897) que era o alvo de verdade. Rodada após rodada
//    consultava NFC-e, que este webservice (NFeDistribuicaoDFe) **nunca**
//    responde — não é falha de rede nem de certificado, é modelo errado, e a
//    SEFAZ diz isso na cara. `modeloDoDoc` filtra mod 65 pra fora ANTES da
//    fila, e a contagem some pelo motivo, nunca em silêncio (senão pareceria
//    "20 indeterminadas" outra vez, sem dizer que 20/20 nem podiam responder).
// ============================================================================

import { modeloDoDoc } from './participante-doc-helper.js';

/** Chave de NF-e/NFC-e: 44 dígitos, nada além disso serve para consultar. */
const chaveValida = (v) => /^\d{44}$/.test(String(v || '').replace(/\D/g, ''));

/** cStat de EVENTO 110111 aceito: registrado (135) ou fora de prazo (155). */
const CSTAT_EVENTO_OK = new Set(['135', '155']);
/** cStat da PRÓPRIA nota que já significa cancelamento (legado pré-evento). */
const CSTAT_NOTA_CANCELADA = new Set(['101', '151']);

/**
 * Decide QUEM vale a pena consultar, e nomeia quem ficou de fora.
 *
 * Só saída da própria empresa (é a que não recebe evento) e só o que ainda não
 * se sabe cancelado — reconsultar o que já está cancelado gasta chamada para
 * confirmar o que já se sabe.
 *
 * @param {Array} docs      documentos da competência, já filtrados por empresa
 * @param {object} opts
 * @param {(d:any)=>boolean} opts.jaCancelado   régua da casa (docCancelado)
 * @param {(d:any)=>string}  opts.direcaoEfetiva régua da casa
 * @param {number} [opts.limite]  teto de chamadas nesta rodada
 */
export function selecionarParaReconferir(
    docs, { jaCancelado, direcaoEfetiva, limite = 200, conferidaEm = () => null } = {},
) {
    const aConsultar = [];
    let jaCanceladas = 0;
    let semChave = 0;
    let naoSaida = 0;
    let naoMod55 = 0;
    let nuncaConferidas = 0;

    for (const d of docs || []) {
        if (direcaoEfetiva(d) !== 'saida') { naoSaida += 1; continue; }
        if (jaCancelado(d)) { jaCanceladas += 1; continue; }
        const chave = String(d?.chave || '').replace(/\D/g, '');
        if (!chaveValida(chave)) { semChave += 1; continue; }
        // Este webservice (NFeDistribuicaoDFe) só responde por NF-e mod 55 — a
        // própria SEFAZ confirmou (cStat 618, MV LIDER 18/08): NFC-e (mod 65)
        // volta sempre "Chave de Acesso invalida (modelo diferente de 55)",
        // gastando a conta da consulta sem nunca poder resolver nada.
        if (modeloDoDoc({ ...d, chave }) !== '55') { naoMod55 += 1; continue; }
        const em = Number(conferidaEm(d)) || 0;
        if (!em) nuncaConferidas += 1;
        aConsultar.push({
            id: d.id, chave, numero: d.numero ?? null, valorTotal: Number(d.valorTotal) || 0, conferidaEm: em,
        });
    }

    // 🚨 QUEM NUNCA FOI PERGUNTADA VEM PRIMEIRO — senão "rode de novo" não anda.
    //
    // Paulo, 20/08 (MV LIDER 639): *"não mudou! já tínhamos dado como
    // ajustada"*. A fila era ordenada só por NÚMERO e cortada no teto da
    // rodada, e **só a nota CANCELADA era carimbada**. Resultado: rodada após
    // rodada o app consultava exatamente as MESMAS 60 primeiras, enquanto a
    // própria tela prometia *"rode de novo para continuar — são 3 rodadas para
    // cobrir as 162"*. Promessa que a ferramenta não cumpria: a 2ª rodada
    // refazia a 1ª, e as 102 do fim nunca eram perguntadas.
    //
    // ⚠️ E NÃO É "PERGUNTOU UMA VEZ, NUNCA MAIS": o cancelamento tem prazo
    // legal e uma nota válida hoje pode ser cancelada amanhã. Por isso a ordem
    // é por ANTIGUIDADE da pergunta (nunca perguntada primeiro, depois a mais
    // antiga) em vez de exclusão — a fila gira sozinha e nenhuma nota fica
    // fora para sempre. Empate desempata pelo número, que é como a conferência
    // humana acompanha o talão.
    aConsultar.sort((a, b) => (a.conferidaEm - b.conferidaEm)
        || ((Number(a.numero) || 0) - (Number(b.numero) || 0)));

    const cortadas = Math.max(0, aConsultar.length - limite);
    return {
        aConsultar: aConsultar.slice(0, limite),
        total: aConsultar.length,
        /** Quantas ainda não foram perguntadas NENHUMA vez — o que falta de verdade. */
        nuncaConferidas,
        // Truncamento NUNCA é silencioso: lista cortada sem dizer o quanto é
        // lida como "conferi tudo".
        cortadas,
        jaCanceladas,
        // Sem chave de 44 dígitos não há o que consultar. A NFS-e do portal é o
        // caso normal disso (não tem chave); NF-e sem chave é buraco de captura.
        semChave,
        naoSaida,
        // NFC-e (mod 65) e qualquer outro modelo ≠ 55 saem daqui NOMEADOS —
        // este webservice não os consulta, e silêncio faria a próxima leitura
        // achar que "sobrou pouco" quando na verdade sobrou o de sempre.
        naoMod55,
    };
}

/**
 * Lê a resposta da SEFAZ para UMA chave.
 *
 * Devolve sempre uma de QUATRO:
 *   · `cancelada`                — a SEFAZ disse (evento 110111, cStat legado ou 653);
 *   · `nao-cancelada`            — ela ENTREGOU o documento e não há evento (prova positiva);
 *   · `nao-cancelada-por-recusa` — ela recusou por permissão (640), e não disse 653 (prova negativa);
 *   · `indeterminado`            — ela não respondeu, ou respondeu algo que não decide.
 *
 * Nunca inventa "não cancelada" a partir do SILÊNCIO — mas 640 não é silêncio,
 * é resposta, e essa diferença é o que separa a 2ª e a 3ª da 4ª.
 */
export function lerRespostaCancelamento(resp) {
    if (!resp || resp.erro) {
        return {
            situacao: 'indeterminado',
            motivo: `Não foi possível perguntar à SEFAZ${resp?.erro ? `: ${resp.erro}` : '.'} `
                + 'A nota fica como está — falha de consulta não prova que a nota é válida.',
        };
    }

    const cStat = String(resp.cStat || '');
    const xmls = Array.isArray(resp.xmls) ? resp.xmls : [];

    // 🚨 cStat 653 — "Rejeição: NF-e Cancelada, arquivo indisponível para
    // download". Paulo, 18/08 (MV LIDER 639): provou nas 3 chaves suspeitas,
    // uma a uma, na tela "Consultar NFe por chave" — as três voltaram
    // `cStat=653 · Rejeicao: NF-e Cancelada, arquivo indisponivel para
    // download`. É a SEFAZ dizendo, sem ambiguidade, que a nota está
    // cancelada — e por estar cancelada, ela não entrega mais o docZip (por
    // isso `xmls` vem VAZIO). Este código caía direto no ramo genérico de
    // "sem documento ⇒ indeterminado" logo abaixo, que existe pra cobrir
    // certificado sem autorização/UF errada — e são coisas MUITO diferentes:
    // ali a SEFAZ não respondeu quem é a nota; aqui ela respondeu que a nota
    // não vale mais. Corrobora pelo TEXTO (não só o número), porque um cStat
    // isolado sem a palavra "cancelad" no xMotivo pode ser outra rejeição
    // reaproveitando o código numa NT futura — nesse caso cai no genérico.
    if (cStat === '653' && /cancelad/i.test(String(resp.xMotivo || ''))) {
        return {
            situacao: 'cancelada',
            cStat,
            evento: { tpEvento: '110111', tipo: 'cancelamento', cStat: '653', dhEvento: null, nProt: null, xJust: null },
            motivo: `SEFAZ recusou a consulta com cStat 653 (${resp.xMotivo}) — a nota está cancelada e por `
                + 'isso o arquivo não é mais entregue. Sem protocolo/data do evento (a SEFAZ não manda nesta '
                + 'resposta), só a confirmação do cancelamento.',
        };
    }

    // 🚨 cStat 640 — "CNPJ/CPF do interessado não possui permissão para
    // consultar esta NF-e". ISTO É RESPOSTA, e o app estava chamando de
    // silêncio.
    //
    // Paulo, 20/08 (MV LIDER 639 · 07/2026): *"não mudou! já tínhamos dado
    // como ajustada"* — a tela trazia **20 notas, todas [indeterminado] com
    // cStat 640**, e "indeterminado" lê-se como "a ferramenta não conseguiu".
    // Ela conseguiu: a SEFAZ respondeu.
    //
    // O que 640 significa aqui sai da PROVA de 18/08, na MESMA empresa, com o
    // MESMO certificado (o do escritório, que não é parte de nenhum desses
    // documentos): as três chaves canceladas voltaram **653 (NF-e Cancelada)**.
    // Ou seja, a SEFAZ informa o CANCELAMENTO antes de barrar por permissão —
    // se ela barrou por permissão, é porque não havia cancelamento a informar.
    //
    // ⚠️ POR QUE NÃO É O MESMO `nao-cancelada` DO CAMINHO NORMAL: lá a SEFAZ
    // ENTREGOU o documento e nós lemos que não há evento — prova positiva.
    // Aqui a prova é NEGATIVA (ela não disse 653), então a situação tem nome
    // próprio e é contada à parte. Fundir as duas apagaria a diferença
    // justamente onde ela importa.
    //
    // ⚠️ E corrobora pelo TEXTO, como o 653: um cStat isolado pode ser
    // reaproveitado por uma NT futura para outra coisa.
    if (cStat === '640' && /permiss|interessad/i.test(String(resp.xMotivo || ''))) {
        return {
            situacao: 'nao-cancelada-por-recusa',
            cStat,
            motivo: `A SEFAZ recusou a consulta por PERMISSÃO (cStat 640 — ${resp.xMotivo}). Isso responde `
                + 'sobre cancelamento: nota cancelada ela informa com cStat 653 mesmo a quem não é parte '
                + '(provado na MV LIDER em 18/08, três chaves, com este mesmo certificado). Como não veio '
                + '653, a nota NÃO está cancelada. O documento em si continua indisponível — o que não se '
                + 'sabe é o conteúdo, não a validade.',
        };
    }

    // cStat 137 = "nenhum documento localizado". Isso NÃO é "não cancelada":
    // costuma ser certificado sem autorização para consultar em nome daquele
    // CNPJ, ou UF errada. Concluir "válida" aqui manteria a receita a maior.
    if (!xmls.length) {
        return {
            situacao: 'indeterminado',
            cStat,
            motivo: `A SEFAZ não devolveu documento para esta chave (cStat ${cStat || '—'}`
                + `${resp.xMotivo ? ` — ${resp.xMotivo}` : ''}). Não dá para concluir nada sobre `
                + 'cancelamento: pode ser certificado sem autorização para este CNPJ ou UF diferente.',
        };
    }

    for (const x of xmls) {
        const xml = String(x?.xml || '');
        if (!xml) continue;

        // Evento de cancelamento registrado.
        if (/<tpEvento>\s*110111\s*<\/tpEvento>/.test(xml)) {
            const cStatEvento = (xml.match(/<cStat>\s*(\d+)\s*<\/cStat>/) || [])[1] || '';
            if (CSTAT_EVENTO_OK.has(cStatEvento)) {
                const dh = (xml.match(/<dhRegEvento>\s*([^<]+)\s*<\/dhRegEvento>/) || [])[1]
                    || (xml.match(/<dhEvento>\s*([^<]+)\s*<\/dhEvento>/) || [])[1] || null;
                const nProt = (xml.match(/<nProt>\s*(\d+)\s*<\/nProt>/) || [])[1] || null;
                const just = (xml.match(/<xJust>\s*([^<]*)\s*<\/xJust>/) || [])[1] || null;
                return {
                    situacao: 'cancelada',
                    cStat: cStatEvento,
                    evento: { tpEvento: '110111', tipo: 'cancelamento', cStat: cStatEvento, dhEvento: dh, nProt, xJust: just },
                    motivo: cStatEvento === '155'
                        ? 'Cancelamento homologado FORA DE PRAZO (cStat 155) — cancelamento igual, e era '
                          + 'justamente este que o importer antigo deixava passar.'
                        : 'Cancelamento registrado na SEFAZ (cStat 135).',
                };
            }
        }
    }

    // A própria nota já veio com cStat de cancelamento (formato legado).
    for (const x of xmls) {
        const xml = String(x?.xml || '');
        const m = xml.match(/<cStat>\s*(\d+)\s*<\/cStat>/);
        if (m && CSTAT_NOTA_CANCELADA.has(m[1]) && /<infNFe|<NFe/.test(xml)) {
            return {
                situacao: 'cancelada',
                cStat: m[1],
                evento: { tpEvento: '110111', tipo: 'cancelamento', cStat: '135', dhEvento: null, nProt: null, xJust: null },
                motivo: `Protocolo da própria nota com cStat ${m[1]} — cancelamento no formato legado `
                    + '(anterior ao evento 110111).',
            };
        }
    }

    return {
        situacao: 'nao-cancelada',
        cStat,
        motivo: 'A SEFAZ devolveu o documento e nenhum evento de cancelamento. A nota vale.',
    };
}

/**
 * Resumo da rodada, com a CAUSA junto do número.
 *
 * Contagem sem leitura é meio farol: "12 consultadas" não diz se o mês mudou.
 */
export function resumirReconferencia({ selecao, resultados, simulado = false, modo = 'distdfe' }) {
    const r = resultados || [];
    const canceladas = r.filter((x) => x.situacao === 'cancelada');
    const indeterminadas = r.filter((x) => x.situacao === 'indeterminado');
    // Prova NEGATIVA: a SEFAZ recusou por permissão (640) em vez de informar
    // cancelamento (653). Conta à parte da prova positiva — ver
    // `lerRespostaCancelamento`.
    const porRecusa = r.filter((x) => x.situacao === 'nao-cancelada-por-recusa');
    const valorRemovido = canceladas.reduce((t, x) => t + (Number(x.valorTotal) || 0), 0);

    const avisos = [];
    // 18/08: empresa sem A1 próprio (MV LIDER, cert é A3) cai neste modo — a
    // pergunta sai com o certificado do ESCRITÓRIO, consultando COMO
    // escritório. Provado em produção no mesmo dia: cStat=653 (NF-e
    // Cancelada) volta mesmo sem o escritório ser parte do documento — mas
    // nota VÁLIDA da qual o escritório não é parte continua indeterminada,
    // então a rodada por este caminho é mais fraca em achar "não cancelada"
    // do que a rodada com o A1 da própria empresa.
    if (modo === 'cert-escritorio' && !simulado && r.length) {
        avisos.push(
            'Esta empresa não tem certificado A1 próprio (nem da mesma raiz) — a rodada perguntou com o '
            + 'certificado do ESCRITÓRIO. A SEFAZ confirma o CANCELAMENTO mesmo assim (cStat 653) e, para '
            + 'nota válida da qual o escritório não é parte, recusa a entrega por permissão (cStat 640) — '
            + 'que é resposta, não silêncio: se houvesse cancelamento, ela teria dito 653. O que este '
            + 'caminho NÃO dá é o conteúdo do documento.',
        );
    }
    if (canceladas.length) {
        avisos.push(
            `${canceladas.length} nota(s) estavam canceladas na SEFAZ e contavam como faturamento aqui — `
            + `R$ ${valorRemovido.toFixed(2)} saem da apuração. Se a competência já teve guia emitida, `
            + 'o valor mudou: confira antes de concluir o mês.',
        );
    }
    if (porRecusa.length) {
        avisos.push(
            `${porRecusa.length} nota(s) a SEFAZ recusou por PERMISSÃO (cStat 640) — e isso as dá como NÃO `
            + 'CANCELADAS: nota cancelada ela informa com cStat 653 mesmo a quem não é parte do documento. '
            + 'A prova aqui é negativa (ela não disse 653), então elas contam separadas das que foram '
            + 'conferidas pelo próprio XML.',
        );
    }
    if (indeterminadas.length) {
        avisos.push(
            `${indeterminadas.length} nota(s) ficaram INDETERMINADAS — a SEFAZ não respondeu ou não `
            + 'localizou o documento. Elas continuam como estavam, e isso NÃO quer dizer que estão '
            + 'válidas. Repita a reconferência; se persistir, o certificado pode não autorizar consulta '
            + 'em nome deste CNPJ.',
        );
    }
    if (selecao?.cortadas) {
        // 🚨 SIMULAÇÃO NÃO FALA NO PASSADO — foi isso que travou a MV LIDER.
        //
        // Paulo, 18/08: *"fui consultar essas notas da MV LIDER pra ver se
        // estavam mesmo canceladas, realmente estão, mas no consultor não"*. O
        // print mostra por quê: ele clicou em **Quantas seriam consultadas?**
        // (a simulação) e a tela respondeu, na MESMA caixa, *"60 de 215 seriam
        // consultadas"* e *"A rodada parou em 60 de 215"*.
        //
        // Dois tempos verbais sobre o mesmo fato, e o segundo AFIRMA que uma
        // rodada rodou. Nenhuma rodou — a consulta à SEFAZ nunca aconteceu.
        // Quem lê conclui que a ferramenta já tentou e não achou nada, e para
        // ali. É a família das "duas leituras do mesmo fato discordando na
        // mesma tela", agora entre o que o app FEZ e o que ele diz ter feito.
        const porRodada = Math.max(1, Number(selecao.aConsultar?.length) || 1);
        const rodadas = Math.ceil((Number(selecao.total) || 0) / porRodada);
        const quantas = rodadas > 1 ? ` São ${rodadas} rodadas para cobrir as ${selecao.total}.` : '';
        // Quantas NUNCA foram perguntadas — é este número que mede o que falta.
        // "Rodadas" sozinho já prometeu progresso que não acontecia (MV LIDER).
        // ⚠️ E o número é o de DEPOIS da rodada (21/08, MV LIDER de novo): a
        // seleção conta ANTES de consultar, e a rodada consome primeiro as
        // nunca perguntadas — dizer o número velho fazia esta caixa mostrar
        // "102" com o cabeçalho da tela mostrando "82", duas leituras do mesmo
        // fato discordando na mesma tela.
        const nuncaAntes = Number(selecao.nuncaConferidas) || 0;
        const consumidas = simulado ? 0 : Math.min(r.length, nuncaAntes);
        const faltam = Math.max(0, nuncaAntes - consumidas);
        const nunca = faltam ? ` Depois desta rodada, ${faltam} nota(s) ainda nunca foram perguntadas — são `
            + 'elas que a próxima rodada pega primeiro.' : ' Todas já foram perguntadas ao menos uma vez; a '
            + 'rodada volta nas mais antigas, porque nota válida hoje pode ser cancelada amanhã.';
        avisos.push(
            simulado
                ? `Ainda NÃO consultamos nada — isto é só a prévia. Ao clicar em "Reconferir na SEFAZ", `
                  + `${porRodada} das ${selecao.total} notas serão perguntadas à SEFAZ nesta rodada.${quantas} `
                  + 'O teto por rodada existe porque cada consulta é uma chamada com o certificado do '
                  + 'cliente, e varrer centenas de uma vez arrisca o bloqueio por excesso (cStat 656).'
                : `A rodada parou em ${porRodada} de ${selecao.total} notas. Rode de novo para `
                  + `continuar.${quantas}${nunca} Cada consulta é uma chamada à SEFAZ com o certificado do `
                  + 'cliente, e varrer centenas de uma vez arrisca o bloqueio por excesso (cStat 656).',
        );
    }

    // ⚠️ E o "nada encontrado" da SIMULAÇÃO não é resposta sobre cancelamento:
    // ela não perguntou nada a ninguém. Sem esta frase, prévia com 0 canceladas
    // lê-se como "a SEFAZ disse que não há" — o oposto do que aconteceu.
    if (simulado && selecao?.total) {
        avisos.unshift(
            'Prévia: mostra QUANTAS notas seriam consultadas, não o resultado. Enquanto a reconferência '
            + 'não rodar, "0 cancelada(s)" continua sendo o que o app sabe — não o que a SEFAZ diz.',
        );
    }
    if (!r.length && !selecao?.total) {
        avisos.push(
            'Nenhuma nota de saída para reconferir nesta competência. Se a empresa emitiu no mês, o '
            + 'problema é de CAPTURA (cofre/autXML), não de cancelamento — veja a Cobertura de Saída.',
        );
    }
    if (selecao?.naoMod55) {
        avisos.push(
            `${selecao.naoMod55} nota(s) ficaram de fora por não serem NF-e (modelo 55) — este `
            + 'webservice só consulta modelo 55; NFC-e (modelo 65) e outros modelos não são perguntados '
            + 'aqui, e não têm como ser: a SEFAZ recusa com "Chave de Acesso inválida (modelo diferente '
            + 'de 55)".',
        );
    }

    return {
        consultadas: r.length,
        canceladas: canceladas.length,
        naoCanceladas: r.filter((x) => x.situacao === 'nao-cancelada').length,
        naoCanceladasPorRecusa: porRecusa.length,
        indeterminadas: indeterminadas.length,
        valorRemovido: Math.round(valorRemovido * 100) / 100,
        avisos,
    };
}
