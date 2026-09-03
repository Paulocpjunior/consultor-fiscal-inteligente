// ============================================================================
// sefaz-backend/dipam-produtor-rural.js  (PURO — sem I/O, testável)
// ----------------------------------------------------------------------------
// COMPRA DE PRODUTOR RURAL: o que o app tem de saber sozinho.
//
// Duas obrigações NASCEM da mesma nota de entrada e hoje são digitadas na mão
// no SAGE (prints do Paulo, 31/07/2026):
//
//   1) DIPAM 1.1 — Manual da DIPAM 2026 v1.3 (Portaria SRE 94/2022, art. 17).
//      Quem compra de PRODUTOR RURAL PESSOA FÍSICA PAULISTA informa o montante
//      MENSAL, agrupado POR MUNICÍPIO PAULISTA DE ORIGEM, na ficha
//      "Informações para a DIPAM B" da GIA **e** no Registro 1400 da EFD
//      (código SPDIPAM11). É o que define a fatia do município no rateio do
//      ICMS (IPM) — omitir tira dinheiro do município; inflar dá multa
//      (RICMS/SP art. 527, VII, "b" e "e") e desde 2025 a SEFAZ cruza os
//      lançamentos com as próprias NF-e.
//
//   2) FUNRURAL por SUB-ROGAÇÃO — a empresa adquirente recolhe no lugar do
//      produtor PF (Lei 8.212/91, art. 30, IV): contribuição previdenciária +
//      GILRAT + SENAR sobre a receita da comercialização. No SAGE são os
//      campos "Seguro Social s/ Produção Rural Sub-rogação".
//
// REGRAS QUE ESTE MÓDULO PROTEGE (todas do Manual, pág. 12-13 e 29):
//   • Só entra produto AGROPECUÁRIO de remetente PRODUTOR RURAL PESSOA FÍSICA.
//     Fornecedor PJ (RPA/Simples) NUNCA entra — é o erro mais comum e a SEFAZ
//     desconsidera o lançamento inteiro.
//   • CNPJ não descaracteriza produtor PF (Comunicado CAT 45/2008): quem diz é
//     a natureza jurídica no CADESP, não o tipo de documento.
//   • DIPAM 1.1 é só para produtor PAULISTA. Nota de produtor de outro estado
//     (o caso MG do print) NÃO gera DIPAM — mas gera FUNRURAL igual.
//   • Cooperativa que adquire do produtor usa 1.3, não 1.1.
//   • Devolução/cancelamento DEDUZ do município (não some do cálculo).
//   • Depósito, armazenagem, retorno simbólico e fixação de preço (1131) NÃO
//     entram.
//   • Farol honesto: o que o app não consegue provar vira PENDÊNCIA com a ação,
//     nunca um número silencioso. Fornecedor de natureza indefinida fica FORA
//     do total e aparece na lista de "confirmar no CADESP".
// ============================================================================

// "Evento não é nota" mora no helper de metadados, junto de `docCancelado` e
// `direcaoEfetivaDoc` — as outras duas réguas que decidem na LEITURA o que o
// campo gravado não conta direito. Reescrever aqui seria a segunda cópia.
import { ehRegistroDeEvento, ehNotaPropriaDeEntrada, docCancelado, valorDoDocumento } from './xml-metadata-helper.js';

/**
 * Rótulo de cada causa que segura nota fora do total.
 *
 * Elas têm AÇÕES DIFERENTES, e é por isso que o valor bloqueado é quebrado por
 * causa em vez de sair como um número só: CADESP é conferência de cadastro,
 * município se resolve relendo o XML, e contraparte ausente é buraco de captura.
 */
const ROTULO_BLOQUEIO = {
    'fornecedor-indefinido': 'Fornecedor sem prova de produtor rural PF — confirmar a natureza jurídica no CADESP',
    'fornecedor-sociedade': 'Fornecedor é sociedade pela razão social (LTDA/S.A./EIRELI) — confirmar como pessoa jurídica, 1 clique',
    'cadastro-contraditorio': 'Cadastrado como produtor rural PF, mas a razão social é de sociedade — CORRIGIR o cadastro (estava somando FUNRURAL indevido)',
    'funrural-sem-producao-rural': 'Compra de pessoa física que NÃO é produção rural — sem sub-rogação (Lei 8.212/91 art. 25)',
    'funrural-documento-de-servico': 'Nota de SERVIÇO, não de mercadoria — serviço de pessoa física não gera FUNRURAL (é R-2010)',
    'municipio-ausente': 'Nota sem o município de origem — reler o XML guardado (♻️)',
    'contraparte-ausente': 'Documento sem fornecedor lido — buraco de captura, conferir em Erros & Logs',
};

/** Código DIPAM → código equivalente do Registro 1400 da EFD (Manual pág. 29). */
export const CODIGOS_DIPAM = {
    '1.1': 'SPDIPAM11',
    '1.2': 'SPDIPAM12',
    '1.3': 'SPDIPAM13',
};

/** UF cujas compras de produtor geram DIPAM (a declaração é paulista). */
export const UF_DIPAM = 'SP';

/** Prefixo do código IBGE dos municípios de São Paulo. */
const PREFIXO_IBGE_SP = '35';

// ─── CFOP: a régua de quem entra, quem deduz e quem NÃO entra ───────────────
//
// Manual, caput do grupo 1: "compras, aquisições ou entradas por bonificação de
// mercadorias de gênero agropecuário (…) proveniente de produtores rurais".

/** Entradas que representam COMPRA/AQUISIÇÃO (somam no município de origem). */
export const CFOPS_COMPRA = new Set([
    '1101', '1102', '1111', '1113', '1116', '1117', '1118', '1120', '1121',
    '1122', '1124', '1125', '1126', '1128',
    '1401', '1403',   // compra com ST
    '1910',           // entrada de bonificação/doação/brinde
]);

/**
 * CFOP de COMPRA para efeito de FUNRURAL — inclui o gêmeo INTERESTADUAL.
 *
 * `CFOPS_COMPRA` é a régua da DIPAM, que é obrigação PAULISTA: por isso ela só
 * tem os 1xxx (entrada interna). O FUNRURAL é FEDERAL e alcança produtor de
 * QUALQUER estado — o caso MG do print de 31/07 gera FUNRURAL e não gera DIPAM.
 *
 * Reusar a lista da DIPAM aqui mataria toda compra interestadual de produtor
 * (CFOP 2102 e irmãos), que é erro na direção mais cara: deixar de recolher.
 * Em vez de uma SEGUNDA lista — que divergiria da primeira no primeiro CFOP
 * novo —, o gêmeo é DERIVADO: 2102 vale se 1102 vale.
 */
export function ehCfopCompraProducao(cfop) {
    const d = soDigitos(cfop);
    if (d.length !== 4) return false;
    if (d[0] !== '1' && d[0] !== '2') return false;
    return CFOPS_COMPRA.has(`1${d.slice(1)}`);
}

/** Saídas de DEVOLUÇÃO de compra — deduzem do município (Manual, pág. 12). */
export const CFOPS_DEVOLUCAO = new Set([
    '5201', '5202', '5208', '5209', '5210', '5410', '5411', '5412', '5413',
]);

/**
 * Entradas que o Manual manda NÃO lançar, com o motivo que vai na tela.
 * Sem isso a equipe lança armazenagem e retorno como se fosse compra.
 */
export const CFOPS_NAO_LANCAR = {
    '1131': 'Entrada para posterior fixação de preço — o Manual recomenda não lançar (se lançar, tem de abater na fixação).',
    '1905': 'Entrada para depósito fechado — não há transferência de propriedade.',
    '1906': 'Retorno de depósito fechado — não há transferência de propriedade.',
    '1907': 'Retorno simbólico de depósito — não há transferência de propriedade.',
    '1917': 'Entrada em consignação — a propriedade só passa na venda.',
    '1918': 'Devolução de consignação.',
    '1919': 'Devolução simbólica de consignação.',
    '1934': 'Remessa para depósito — não é compra.',
    '1503': 'Entrada decorrente de exportação (devolução) — não é compra de produtor.',
    '1504': 'Entrada decorrente de exportação indireta — não é compra de produtor.',
};

/**
 * NCM de gênero agropecuário / hortifrutigranjeiro (capítulo = 2 primeiros
 * dígitos). Capítulos 01-14 são o núcleo (animais vivos, carnes, pescado,
 * leite/ovos/mel, produtos de origem animal, plantas, hortaliças, frutas, café/
 * chá/especiarias, cereais, moagem, oleaginosas, gomas, matérias trançáveis).
 *
 * Alguns produtos rurais crus vivem fora dessa faixa e entram por posição.
 */
const CAPITULOS_AGRO = new Set([
    '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14',
]);
const POSICOES_AGRO_EXTRA = new Set([
    '2401',                     // fumo em folha
    '4101', '4102', '4103',     // couros e peles brutos
    '4401', '4403',             // lenha e madeira em bruto
    '5101', '5201', '5301',     // lã, algodão e linho em bruto
]);

/**
 * Alíquotas do FUNRURAL por sub-rogação (produtor rural PESSOA FÍSICA).
 *
 * ATENÇÃO — este é o único ponto do módulo que depende de alíquota vigente, e
 * por isso ele é TABELA COM VIGÊNCIA, não número solto no meio do cálculo:
 * quando a lei mudar, muda aqui (e o teste da competência antiga continua
 * verde). O app nunca "confia e segue": toda nota é conferida contra o FUNRURAL
 * que o próprio emitente declarou no campo de informações complementares, e a
 * divergência vira pendência na tela em vez de um valor errado no SAGE.
 */
export const ALIQUOTAS_FUNRURAL_PF = [
    {
        desde: '2018-01',
        inss: 1.2, gilrat: 0.1, senar: 0.2,
        fonte: 'Lei 8.212/1991, art. 25, com a redação da Lei 13.606/2018 (1,2% previdenciária + 0,1% GILRAT/RAT) e Lei 9.528/1997 (0,2% SENAR) — total 1,5%.',
        revisar: false,
    },
    {
        // Base legal confirmada pelo Paulo (31/07/2026): LC 224/2025, vigência
        // 1º/04/2026. Bate com a NF-e 425.231 de 03/06/2026, cujo próprio campo
        // de informações complementares declara "FUNRURAL 1.63% do total"
        // = R$ 909,47 sobre R$ 55.796,00, e com o lançamento do SAGE.
        //
        // A vigência é pela DATA DA VENDA (não pela colheita) — como ela começa
        // no 1º dia de um mês, comparar por competência 'AAAA-MM' dá o mesmo
        // resultado: nota de 31/03/2026 fica em 1,5%, a de 01/04 em diante em
        // 1,63%.
        desde: '2026-04',
        inss: 1.32, gilrat: 0.11, senar: 0.20,
        fonte: 'Lei 8.212/1991, art. 25, com as alíquotas da LC 224/2025 — vigência 1º/04/2026 (1,32% previdenciária + 0,11% GILRAT/RAT + 0,20% SENAR = 1,63%).',
        revisar: false,
    },
];

/**
 * SEGURADO ESPECIAL (agricultura familiar) NÃO subiu: a LC 224/2025 manteve o
 * total em 1,5%. Usar a tabela geral nele cobraria 0,13 ponto a mais em toda
 * nota — e quem paga é o cliente adquirente, por sub-rogação. A condição não
 * está na nota: vem do cadastro do produtor (`seguradoEspecial`).
 */
export const ALIQUOTAS_FUNRURAL_SEGURADO_ESPECIAL = [
    {
        desde: '2018-01',
        inss: 1.2, gilrat: 0.1, senar: 0.2,
        fonte: 'Segurado especial (agricultura familiar): a LC 224/2025 manteve o total em 1,5% (1,2% + 0,1% GILRAT/RAT + 0,2% SENAR).',
        revisar: false,
    },
];

/** Tabela que vale para ESTE produtor (o segurado especial tem a sua). */
export function tabelaDoProdutor(cadastro, tabelaPadrao = ALIQUOTAS_FUNRURAL_PF) {
    return cadastro?.seguradoEspecial ? ALIQUOTAS_FUNRURAL_SEGURADO_ESPECIAL : tabelaPadrao;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
/**
 * Contribuição previdenciária DESPREZA as frações de centavo (IN RFB 971/2009)
 * — e é assim que o SAGE lança: 55.796,00 × 1,32% = 736,5072 vira 736,50, não
 * 736,51. Arredondar para cima deixaria o app 1 centavo acima do sistema atual
 * em toda nota e a conferência acusaria divergência falsa.
 */
const trunc2 = (n) => Math.trunc((Number(n) + 1e-9) * 100) / 100;

/**
 * Inscrição Estadual de PRODUTOR RURAL paulista começa com "P"
 * (ex.: P-01100424.3/002). É o sinal mais forte que a nota carrega: quem tem
 * IE "P" está inscrito no CADESP como Produtor Rural (Pessoa Física).
 */
export function ehIeProdutorRuralSP(ie) {
    const s = String(ie ?? '').trim().toUpperCase();
    return /^P\D*\d/.test(s);
}

/**
 * DOCUMENTO DE SERVIÇO (NFS-e, CT-e) — nunca é aquisição de produção rural.
 *
 * Paulo, 13/08, apontando os que sobraram no FUNRURAL depois das outras travas:
 * *"ainda esses"* — COSME QUEIROZ (BA), RONALDO SOARES (MG), NUNO MONTEIRO (MG),
 * EWERTON RENE, e antes deles o tabelionato ALEXANDRE ARCARO 2º TP.
 *
 * O painel já denunciava sozinho: **DIPAM R$ 729 mil contra uma base de FUNRURAL
 * de R$ 1,89 milhão**. A DIPAM exige CFOP de compra e por isso descarta esses
 * documentos; o FUNRURAL não exigia nada além de o fornecedor ser pessoa física.
 *
 * Documento de serviço não tem CFOP nem NCM — então a prova NEGATIVA de "não é
 * produção rural" (itens lidos e nenhum agro) não alcança ele: passa batido por
 * ausência. A prova aqui é POSITIVA e definitiva: serviço é serviço. A Lei
 * 8.212/91 art. 25 incide sobre a comercialização da PRODUÇÃO RURAL, que é
 * mercadoria e circula em NF-e / nota de produtor — nunca em nota de serviço.
 *
 * Reconhecido pelo que o documento É, não pelo `modelo`: `modeloDoDoc` cai em
 * '55' quando o campo não foi gravado, e a NFS-e não tem chave de 44 dígitos —
 * confiar nele faria justamente a NFS-e passar como NF-e.
 */
export function ehDocumentoDeServico(d) {
    const tipo = String(d?.tipoDoc || d?.tipo || '').toLowerCase().replace(/[^a-z]/g, '');
    if (tipo.includes('nfse') || tipo.includes('servico') || tipo.includes('cte')) return true;
    const modelo = soDigitos(d?.modelo);
    if (['57', '67'].includes(modelo)) return true;              // CT-e e CT-e OS
    // Blocos que só existem em nota de serviço (é como o próprio app já
    // normaliza prestador/tomador da NFS-e).
    if (d?.prestador || d?.tomador) return true;
    if (d?.codigoServicoMunicipal || d?.itemLc116 || d?.discriminacao) return true;
    return false;
}

/** NCM de gênero agropecuário/hortifrutigranjeiro? */
export function ehNcmAgropecuario(ncm) {
    const d = soDigitos(ncm);
    if (d.length < 4) return false;
    return CAPITULOS_AGRO.has(d.slice(0, 2)) || POSICOES_AGRO_EXTRA.has(d.slice(0, 4));
}

/** Município paulista? (código IBGE de 7 dígitos começando em 35) */
export function ehMunicipioPaulista(codMunIBGE) {
    const d = soDigitos(codMunIBGE);
    return d.length === 7 && d.startsWith(PREFIXO_IBGE_SP);
}

/** Alíquotas vigentes na competência 'AAAA-MM'. */
/** Soma das três alíquotas vigentes — a mesma da apuração, nunca escrita à mão. */
export function percentualFunruralVigente(competencia, tabela = ALIQUOTAS_FUNRURAL_PF) {
    const a = aliquotasFunruralVigentes(competencia, tabela);
    return round2(a.inss + a.gilrat + a.senar);
}

export function aliquotasFunruralVigentes(competencia, tabela = ALIQUOTAS_FUNRURAL_PF) {
    const comp = /^\d{4}-\d{2}$/.test(String(competencia || '')) ? competencia : '9999-12';
    const vigentes = tabela.filter((a) => a.desde <= comp).sort((a, b) => a.desde.localeCompare(b.desde));
    return vigentes[vigentes.length - 1] || tabela[0];
}

/**
 * Número em texto livre para float. A nota do print escreve "909.47" (ponto
 * decimal) enquanto o resto do app é pt-BR ("1.234,56") — ler os dois errado
 * dava 90.947 e a conferência do FUNRURAL acusaria divergência falsa.
 */
export function parseValorLivre(txt) {
    const s = String(txt ?? '').trim().replace(/[R$\s]/g, '');
    if (!s || !/\d/.test(s)) return null;
    const temVirgula = s.includes(',');
    const temPonto = s.includes('.');
    let limpo;
    if (temVirgula && temPonto) {
        // O separador DECIMAL é o último que aparece; o outro é milhar.
        limpo = s.lastIndexOf(',') > s.lastIndexOf('.')
            ? s.replace(/\./g, '').replace(',', '.')
            : s.replace(/,/g, '');
    } else if (temVirgula) {
        limpo = s.replace(/\./g, '').replace(',', '.');
    } else if (temPonto) {
        // "1.234" com 3 casas depois do ponto é milhar; "909.47" é decimal.
        limpo = /\.\d{3}(\D|$)/.test(s) ? s.replace(/\./g, '') : s;
    } else {
        limpo = s;
    }
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
}

/**
 * Lê o FUNRURAL que o EMITENTE declarou nas informações complementares.
 * Ex.: "FUNRURAL 1.63% do total Nota Valor.: R$ 909.47".
 *
 * Serve de CONFERÊNCIA independente do nosso cálculo — é a fonte dizendo
 * quanto acha que é.
 */
export function extrairFunruralDeclarado(infAdic) {
    const txt = String(infAdic ?? '');
    if (!/FUNRURAL/i.test(txt)) return null;
    // Recorta do "FUNRURAL" até o fim da frase (o valor vem logo depois).
    const trecho = txt.slice(txt.search(/FUNRURAL/i)).slice(0, 240);
    const mPerc = trecho.match(/(\d{1,2}[.,]\d{1,4})\s*%/);
    const mValor = trecho.match(/R\$\s*([\d.,]+)/i);
    const percentual = mPerc ? parseValorLivre(mPerc[1]) : null;
    const valor = mValor ? parseValorLivre(mValor[1]) : null;
    if (percentual == null && valor == null) return null;
    return { percentual, valor, trecho: trecho.replace(/\s+/g, ' ').trim() };
}

/**
 * Calcula o FUNRURAL por sub-rogação. Os três valores saem SEPARADOS porque é
 * assim que o SAGE (e a EFD-Reinf) pedem: Seguro Social, GILRAT e SENAR têm
 * base e alíquota próprias na tela de "Impostos Retidos".
 */
export function calcularFunrural(base, competencia, tabela = ALIQUOTAS_FUNRURAL_PF) {
    const b = round2(num(base));
    const aliq = aliquotasFunruralVigentes(competencia, tabela);
    const inss = trunc2(b * aliq.inss / 100);
    const gilrat = trunc2(b * aliq.gilrat / 100);
    const senar = trunc2(b * aliq.senar / 100);
    return {
        base: b,
        aliquotas: { inss: aliq.inss, gilrat: aliq.gilrat, senar: aliq.senar },
        percentualTotal: round2(aliq.inss + aliq.gilrat + aliq.senar),
        inss, gilrat, senar,
        total: round2(inss + gilrat + senar),
        fonte: aliq.fonte,
        revisar: !!aliq.revisar,
    };
}

// ─── Natureza do fornecedor: produtor rural PF ou não ───────────────────────

/**
 * Decide se o remetente é PRODUTOR RURAL PESSOA FÍSICA, e com que confiança.
 *
 * Ordem: cadastro confirmado (a equipe olhou o CADESP) > IE de produtor SP >
 * CPF no documento. Quem não tem nenhum sinal fica INDEFINIDO — e indefinido
 * NÃO entra na conta: vira pendência com a ação ("consulte a natureza jurídica
 * no CADESP"), porque lançar PJ no 1.1 é justamente o erro que a SEFAZ pune.
 *
 * @param {object} participante emitente do documento
 * @param {object} [cadastro]   ficha do fornecedor em `produtores_rurais`
 */
/**
 * TIPO SOCIETÁRIO ESCRITO NA PRÓPRIA RAZÃO SOCIAL.
 *
 * Paulo, 13/08, olhando a fila da NOVA ERA: metade das pendências de "consulte
 * o CADESP" é de fornecedor cujo nome **já diz o que ele é** — MIXTER ATACADO E
 * VAREJO DE GENEROS ALIMENTICIOS **LTDA**, PONTUAL COMERCIAL AGRICOLA **LTDA**,
 * FRUTAS DA TERRA HORTIFRUTI **LTDA**. Mandar consultar o CADESP de uma LTDA é
 * gastar o tempo da equipe para descobrir o que está escrito na tela.
 *
 * LTDA, S/A e EIRELI são tipos de **sociedade**, e sociedade é PESSOA JURÍDICA
 * por definição (CC art. 44 e 45): produtor rural pessoa física não se organiza
 * como sociedade. Sem produtor PF não há sub-rogação — quem recolhe é o próprio
 * emitente (Lei 8.212/91 art. 30, IV).
 *
 * ═══ O QUE ESTA FUNÇÃO NÃO FAZ ══════════════════════════════════════════════
 *
 * Ela NÃO decide. Devolve uma SUGESTÃO carimbada com a origem, e a confirmação
 * continua sendo humana — é a regra de 06/08 ("sugerir conhecimento fiscal
 * carimbado com a origem; sugestão nunca sobrescreve o que a pessoa digitou").
 * Nenhum valor muda por causa dela: o fornecedor já ficava fora do total como
 * "indefinido". O que muda é o TRABALHO — de "consulte o CADESP" para
 * "confirme o que o nome já diz".
 *
 * ═══ POR QUE "ME" E "EPP" FICAM DE FORA ═════════════════════════════════════
 *
 * Porque são PORTE, não tipo societário — e empresário individual com CNPJ pode
 * ser justamente o caso do Comunicado CAT 45/2008 (CNPJ não descaracteriza
 * produtor rural PF). Sugerir PJ ali seria repetir o erro que a régua inteira
 * existe para evitar, só que com mais confiança.
 */
const TIPOS_SOCIETARIOS = [
    { re: /\bLTDA\.?\b/i, rotulo: 'LTDA' },
    { re: /\bLIMITADA\b/i, rotulo: 'LIMITADA' },
    { re: /\bEIRELI\b/i, rotulo: 'EIRELI' },
    { re: /\bS\/A\b|\bS\.A\.?\b|\bSOCIEDADE\s+AN[OÔ]NIMA\b/i, rotulo: 'S/A' },
];

export function tipoSocietarioNoNome(nome) {
    const n = String(nome || '').trim();
    if (!n) return null;
    for (const t of TIPOS_SOCIETARIOS) {
        if (t.re.test(n)) return t.rotulo;
    }
    return null;
}

export function identificarNaturezaFornecedor(participante, cadastro = null) {
    const p = participante || {};
    const doc = soDigitos(p.cnpjCpf || p.cnpj || p.cpf);
    const ie = p.ie || p.inscricaoEstadual || '';
    const sinais = [];

    if (cadastro && cadastro.natureza) {
        // Confirmação humana vence tudo — inclusive o "não é produtor".
        const ehProdutor = cadastro.natureza === 'produtor_rural_pf';
        sinais.push('cadastro-confirmado');

        // ── COMBINAÇÃO IMPOSSÍVEL: LTDA CONFIRMADA COMO PRODUTOR RURAL PF ──
        //
        // Paulo, 13/08, apontando o FUNRURAL: *"tem que tirar esses caras"* —
        // BELA VISTA COMERCIO DE FRUTAS E VERDURAS **LTDA** somando sub-rogação
        // nota a nota. LTDA é sociedade, sociedade é pessoa jurídica (CC art.
        // 44), e pessoa jurídica NÃO é produtor rural pessoa física: a
        // sub-rogação do art. 30, IV da Lei 8.212/91 não alcança essa compra —
        // quem recolhe é o próprio emitente.
        //
        // Como isso aconteceu: a fila de pendências oferece três botões e o
        // PRIMEIRO é "Produtor Rural (PF)". Limpando 293 linhas, clicar no
        // primeiro faz a pendência sumir — e ADICIONA imposto que não existe.
        //
        // Aqui a confirmação humana NÃO vence, e é a única exceção da regra:
        // ela não vence porque não é opinião contra opinião, é uma marcação
        // legalmente impossível. Recusar não inventa nada — só deixa de
        // declarar contribuição sobre quem não a deve. E o motivo vai junto,
        // para o cadastro ser corrigido em vez de o número ser discutido.
        if (ehProdutor && sinais.includes('cadastro-confirmado')) {
            const tipoSocietario = tipoSocietarioNoNome(p.nome || p.razaoSocial || cadastro.nome);
            if (tipoSocietario && doc.length === 14) {
                return {
                    ehProdutorRuralPF: false,
                    confianca: 'cadastro-contraditorio',
                    sinais: [...sinais, 'cadastro-x-razao-social'],
                    motivo: `O cadastro marca este fornecedor como Produtor Rural (PF), mas a razão social diz `
                        + `${tipoSocietario} — sociedade é pessoa jurídica (CC art. 44) e não pode ser produtor `
                        + 'rural PF. Enquanto isso não for corrigido, a sub-rogação NÃO é calculada: declarar '
                        + 'FUNRURAL sobre pessoa jurídica é imposto que não existe.',
                };
            }
        }
        return {
            ehProdutorRuralPF: ehProdutor,
            confianca: 'confirmada',
            sinais,
            motivo: ehProdutor
                ? 'Confirmado no cadastro como Produtor Rural (Pessoa Física).'
                : `Confirmado no cadastro como "${cadastro.natureza}" — não gera DIPAM 1.1 nem sub-rogação.`,
        };
    }

    // A NOTA NÃO TRAZ CONTRAPARTE NENHUMA — e isso NÃO é "CNPJ sem IE de
    // produtor". Caso VINCENZO 07/2026 (12/08): a pendência saía como
    // "—: vende gênero agropecuário, mas não dá para provar que é Produtor
    // Rural" e mandava consultar o CADESP **de ninguém** — sem nome, sem
    // documento e sem o botão de confirmar. Alarme que não identifica o alvo
    // não tem como ser atendido.
    //
    // A causa é outra e a ação é outra: o participante não foi gravado no
    // documento (é buraco de CAPTURA/leitura do XML), e o conserto é reler a
    // FONTE — o mesmo ♻️ que recupera o município.
    if (!doc && !String(p.nome || p.razaoSocial || '').trim()) {
        return {
            ehProdutorRuralPF: false,
            confianca: 'sem-contraparte',
            sinais,
            motivo: 'A nota não traz o fornecedor (sem CNPJ/CPF e sem nome). Não é caso de cadastro: '
                + 'o participante não foi gravado a partir do XML.',
        };
    }

    if (ehIeProdutorRuralSP(ie)) sinais.push('ie-produtor-sp');
    if (doc.length === 11) sinais.push('cpf');
    if (doc.length === 14) sinais.push('cnpj');

    if (sinais.includes('ie-produtor-sp')) {
        return {
            ehProdutorRuralPF: true,
            confianca: 'alta',
            sinais,
            motivo: `IE ${ie} é de Produtor Rural (Pessoa Física) — inscrição paulista começa com "P".`,
        };
    }
    if (sinais.includes('cpf')) {
        return {
            ehProdutorRuralPF: true,
            confianca: 'media',
            sinais,
            motivo: 'Emitente com CPF — pessoa física. Confirme a natureza jurídica no CADESP.',
        };
    }
    // O nome do fornecedor já responde? Então a pergunta não é para o CADESP.
    const tipoSocietario = tipoSocietarioNoNome(p.nome || p.razaoSocial);
    if (tipoSocietario && sinais.includes('cnpj')) {
        return {
            ehProdutorRuralPF: false,
            // NÃO é 'confirmada': confirmação é ato humano, e é ele que tira o
            // fornecedor da fila. Isto é sugestão com origem carimbada.
            confianca: 'sugerida-pj',
            sinais: [...sinais, 'razao-social-sociedade'],
            sugestao: { natureza: 'pessoa_juridica', origem: `razão social ("${tipoSocietario}")` },
            motivo: `A razão social diz ${tipoSocietario} — sociedade é pessoa jurídica (CC art. 44), e produtor `
                + 'rural pessoa física não se organiza como sociedade. Sem produtor PF não há sub-rogação: quem '
                + 'recolhe é o próprio emitente.',
        };
    }

    return {
        ehProdutorRuralPF: false,
        confianca: 'indefinida',
        sinais,
        motivo: 'Emitente com CNPJ e sem IE de produtor. CNPJ não descaracteriza produtor PF '
            + '(Comunicado CAT 45/2008) — confirme a natureza jurídica no CADESP e marque no cadastro.',
    };
}

// ─── Normalização da FORMA do documento ─────────────────────────────────────
// O documento de `documentos_fiscais` chega em DUAS formas conforme o trilho de
// captura: o importer PRINCIPAL (xml-importer.js — SEFAZ/cofre/XML manual) grava
// os participantes em campos CHATOS (cnpjEmit/xNomeEmit/ufEmit/cnpjDest/xNomeDest
// /ieDest/ufDest/...), enquanto sync-routes e abrasf gravam ANINHADO
// (emitente/destinatario). classificarNota lê SÓ o aninhado — então a nota vinda
// do importer principal chegava com a contraparte VAZIA e caía sempre em
// "fornecedor indefinido" (FUNRURAL/DIPAM R$ 0,00), MESMO com o CPF do produtor
// já capturado (caso real EDUARDO GUERRA × DAMIÃO, 07/2026: CPF no cnpjDest,
// FUNRURAL saía 0,00 em vez de 136,92). Isto RELÊ o que o importer JÁ capturou
// (recuperação da fonte, não conserto de cadastro — regra de 06/08): monta
// emitente/destinatario a partir dos campos chatos SÓ quando o aninhado não veio.
// Idempotente: doc já aninhado passa intacto.
export function normalizarParticipantesDoc(doc) {
    const d = doc || {};
    const temLado = (p) => !!(p && (p.cnpjCpf || p.cnpj || p.cpf || p.nome || p.razaoSocial));
    const emitente = temLado(d.emitente) ? d.emitente : (temLado(d.prestador) ? d.prestador : {
        cnpjCpf: d.cnpjEmit || d.cnpjEmitente || '',
        nome: d.xNomeEmit || d.nomeEmit || '',
        ie: d.ieEmit || '',
        uf: d.ufEmit || '',
        codMunIBGE: d.codMunEmit || '',
    });
    const destinatario = temLado(d.destinatario) ? d.destinatario : (temLado(d.tomador) ? d.tomador : {
        cnpjCpf: d.cnpjDest || d.cnpjDestinatario || '',
        nome: d.xNomeDest || d.nomeDest || '',
        ie: d.ieDest || '',
        uf: d.ufDest || '',
        codMunIBGE: d.codMunDest || '',
    });
    return { ...d, emitente, destinatario };
}

// ─── Classificação de um documento ──────────────────────────────────────────

const pendencia = (codigo, mensagem, acao) => ({ codigo, mensagem, acao });

/**
 * Classifica UMA nota diante das duas obrigações.
 *
 * @param {object} doc               documento de `documentos_fiscais`
 * @param {object} [opts]
 * @param {object} [opts.cadastro]   ficha do fornecedor (`produtores_rurais`)
 * @param {object} [opts.empresa]    { ehCooperativa, ehProdutorRuralPF, funruralSubRogacao }
 * @param {Array}  [opts.tabelaFunrural]
 */
export function classificarNota(doc, opts = {}) {
    const { cadastro = null, empresa = {}, tabelaFunrural = ALIQUOTAS_FUNRURAL_PF } = opts;
    const d = doc || {};
    const emitente = d.emitente || d.prestador || {};
    const destinatario = d.destinatario || d.tomador || {};

    // NOTA PRÓPRIA DE ENTRADA (tpNF=0): o CLIENTE emite a nota da compra
    // porque o produtor rural PF não emite NF-e (RICMS/SP art. 136 — é o
    // formato da NF 425.231 do caso de referência). Aqui emitente = cliente e
    // o PRODUTOR está no bloco destinatário/remetente. O importer antigo
    // gravava direcao='saida' (só olhava o CNPJ do emitente) e a compra sumia
    // da DIPAM — por isso a direção efetiva é decidida AQUI, pelo tpNF, sem
    // confiar no campo gravado.
    //
    // ⚠️ E o tpNF pode NÃO ESTAR GRAVADO: o import manual do frontend nunca
    // gravou o campo até 14/08, então nas notas antigas a prova é o CFOP de
    // ENTRADA numa nota emitida pela própria empresa. A régua das duas provas
    // mora em `ehNotaPropriaDeEntrada` — aqui só se lê o veredito.
    const provaNotaPropria = ehNotaPropriaDeEntrada(
        {
            ...d,
            cnpjEmit: emitente.cnpjCpf || emitente.cnpj || d.cnpjEmit,
            empresaCnpj: d.empresaCnpj || empresa.cnpj,
        },
        empresa.cnpj,
    );
    const notaPropriaEntrada = provaNotaPropria.sim;
    const direcao = notaPropriaEntrada ? 'entrada' : d.direcao;
    // Na devolução quem emite é a nossa empresa: o produtor está do outro lado.
    const ehDevolucaoSaida = direcao === 'saida';
    // O produtor é sempre o OUTRO lado: emitente na compra normal, mas
    // destinatário/remetente na nota própria de entrada e na devolução.
    const contraparte = (ehDevolucaoSaida || notaPropriaEntrada) ? destinatario : emitente;

    const cfops = Array.from(new Set((d.itens || []).map((i) => soDigitos(i.cfop)).filter(Boolean)));
    const cfopPrincipal = cfops[0] || '';
    // O valor pelo DONO (seis formas) — a leitura de três formas deixava a nota
    // gravada em `valores.total`/`vNF` entrar na base valendo zero, calada.
    const vDoc = valorDoDocumento(d);
    const valor = round2(num(Number.isFinite(vDoc) ? vDoc : d.totais?.vProd));
    const natureza = identificarNaturezaFornecedor(contraparte, cadastro);

    const base = {
        chave: d.chave || d.id || '',
        numero: d.numero || '',
        serie: d.serie || '',
        dhEmi: d.dhEmi || '',
        competencia: d.competencia || '',
        direcao,
        // NOTA PRÓPRIA DE ENTRADA (tpNF=0, o CLIENTE emite — art. 136): é a que
        // se escritura. A NF-e do PRODUTOR (NOTA 1) é documento de origem e NÃO
        // se escritura (RC 33068/2025) — a dedup lá embaixo remove a do produtor
        // quando há a de entrada, pra não dobrar a FUNRURAL.
        notaPropria: notaPropriaEntrada,
        // COMO se soube que é nota própria — 'tpNF' (o documento diz) ou
        // 'cfop-de-entrada' (a prova que alcança o que foi gravado antes de o
        // import manual guardar o campo). Vai até a TELA: o painel mostrava a
        // nota própria e a NF-e do produtor com a MESMA cara, e é por isso que
        // ninguém — nem quem escreveu a régua — conseguia ler na tela qual
        // documento estava somando. Total sem a causa do lado não se confere.
        provaDirecao: notaPropriaEntrada ? provaNotaPropria.prova : null,
        // A direção como está GRAVADA, para a tela poder denunciar a diferença
        // entre o banco e a leitura (é ela que manda no Livro e no SPED).
        direcaoGravada: d.direcao || null,
        cfops,
        valor,
        fornecedor: {
            doc: soDigitos(contraparte.cnpjCpf || contraparte.cnpj),
            nome: contraparte.nome || contraparte.razaoSocial || '—',
            ie: contraparte.ie || '',
            uf: (contraparte.uf || '').toUpperCase(),
            codMunIBGE: soDigitos(cadastro?.codMunIBGE || contraparte.codMunIBGE),
            municipio: cadastro?.municipio || contraparte.municipio || '',
            // CPF do titular quando o produtor está inscrito por CNPJ: é o que
            // o `ideProdutor` do R-2055 pede (tpInscProd=2 é a única forma
            // provada). Vem do CADESP, digitado no cadastro — nunca deduzido.
            cpfTitular: soDigitos(cadastro?.cpfTitular) || null,
        },
        natureza,
        cadastrado: !!cadastro,
        pendencias: [],
    };

    // Cancelada/denegada não é operação — sai da conta sem virar pendência.
    // 🚨 QUEM DECIDE É A RÉGUA (21/08): o cancelamento chega por EVENTO e nesse
    // caminho o campo `status` continua 'autorizado'. Lendo o campo cru, nota
    // cancelada seguia gerando FUNRURAL e DIPAM — imposto sobre operação que
    // não existiu, na direção mais cara.
    if (docCancelado(d)) {
        return { ...base, dipam: naoAplica('Nota cancelada/denegada.'), funrural: naoAplica('Nota cancelada/denegada.') };
    }

    // ─── FUNRURAL (federal: vale para produtor de QUALQUER estado) ───────────
    const funrural = avaliarFunrural({ base, doc: d, cadastro, empresa, tabelaFunrural, ehDevolucaoSaida, cfopPrincipal });

    // ─── DIPAM (paulista: só produtor de SP) ────────────────────────────────
    const dipam = avaliarDipam({ base, cfopPrincipal, cfops, doc: d, empresa, ehDevolucaoSaida });

    const pendencias = [...dipam.pendencias, ...funrural.pendencias];
    return { ...base, dipam: semPendencias(dipam), funrural: semPendencias(funrural), pendencias };
}

const naoAplica = (motivo) => ({ aplica: false, motivo, pendencias: [] });
const semPendencias = ({ pendencias, ...resto }) => resto;

function avaliarDipam({ base, cfopPrincipal, cfops, doc, empresa, ehDevolucaoSaida }) {
    const pendencias = [];
    const codigo = empresa.ehCooperativa ? '1.3' : '1.1';
    const fora = (motivo) => ({ aplica: false, motivo, pendencias });

    // Cliente que É produtor rural PF entrega DIPAM-A (anual, outra
    // declaração) — não lança 1.1 sobre as próprias compras.
    if (empresa.ehProdutorRuralPF) {
        return fora('Cliente é Produtor Rural (PF): declara DIPAM-A anual, não lança o código 1.1.');
    }

    // Contraparte AUSENTE é outra pendência, com outra ação. Ela entra mesmo
    // sem NCM agropecuário: se a nota não tem fornecedor, não dá nem pra saber
    // se é compra de produtor — e é o único caso em que olhar os itens não
    // ajuda a filtrar.
    if (base.natureza.confianca === 'sem-contraparte') {
        pendencias.push(pendencia(
            'contraparte-ausente',
            `Nota ${base.numero || base.chave || '—'}: o documento não traz o fornecedor (sem CNPJ/CPF e sem nome).`,
            'Isso não se resolve no cadastro: use "♻️ Reler município dos XMLs" para reler o participante '
            + 'da FONTE. Se continuar vazio depois disso, o buraco é de captura — confira em Erros & Logs.',
        ));
        return fora('Nota sem fornecedor — fora do total até o participante ser lido do XML.');
    }

    // Cadastro contraditório: NÃO some da tela. Ele mudou um número (tirou
    // FUNRURAL que estava sendo somado), e total que muda sozinho sem dizer por
    // quê faz desconfiar do número certo.
    if (base.natureza.confianca === 'cadastro-contraditorio') {
        pendencias.push(pendencia(
            'cadastro-contraditorio',
            `${base.fornecedor.nome}: está confirmado como Produtor Rural (PF) no cadastro, mas a razão social diz `
            + 'que é sociedade — pessoa jurídica não pode ser produtor rural PF.',
            'Corrija o cadastro do produtor para "Pessoa Jurídica". Enquanto estiver assim, o FUNRURAL deste '
            + 'fornecedor NÃO é calculado — declarar sub-rogação sobre PJ é recolher imposto que não existe.',
        ));
        return fora('Cadastro contraditório: marcado como produtor rural PF, mas a razão social é de sociedade.');
    }

    // A razão social já respondeu: é sociedade ⇒ pessoa jurídica. Continua FORA
    // do total (a confirmação é humana), mas a ação deixa de ser "consulte o
    // CADESP" — vira "confirme o que o nome já diz", que é um clique.
    //
    // MESMA PORTA DO 'indefinida': só quem VENDE GÊNERO AGROPECUÁRIO entra na
    // lista. A primeira versão desta linha pendurava TODA LTDA — a autopeças, a
    // gráfica, o posto —, e um teste de 31/07 pegou: pendência sobre fornecedor
    // que nunca entraria na DIPAM é ruído, e ruído faz ninguém ler a lista.
    if (base.natureza.confianca === 'sugerida-pj') {
        if (!(doc.itens || []).some((i) => ehNcmAgropecuario(i.ncm || i.NCM))) {
            return fora('Fornecedor é sociedade (pessoa jurídica) e não vende gênero agropecuário — fora da DIPAM.');
        }
        pendencias.push({
            ...pendencia(
                'fornecedor-sociedade',
                `${base.fornecedor.nome}: a razão social diz que é sociedade — logo, pessoa jurídica.`,
                'Não precisa de CADESP: confirme "Pessoa Jurídica" no cadastro do produtor e ele sai da lista. '
                + 'Sem produtor rural PF não há sub-rogação — quem recolhe é o próprio emitente.',
            ),
            sugestao: base.natureza.sugestao || null,
        });
        return fora('Fornecedor é sociedade (pessoa jurídica) pela razão social — fora do total até confirmar.');
    }

    if (base.natureza.confianca === 'indefinida') {
        // CUIDADO: "indefinida" é TODO fornecedor com CNPJ e sem IE de produtor
        // — ou seja, a maioria absoluta das compras de qualquer empresa. Virar
        // pendência aí encheria a tela de ruído e ninguém leria mais nenhuma.
        // Só entra na lista de confirmar quem VENDE gênero agropecuário: aí a
        // dúvida é real (atacadista PJ × produtor PF com CNPJ, caso do
        // Comunicado CAT 45/2008). A pendência é por FORNECEDOR, não por nota
        // (a consolidação deduplica), e some assim que o CADESP for confirmado.
        const temAgro = (doc.itens || []).some((i) => ehNcmAgropecuario(i.ncm || i.NCM));
        if (!temAgro) {
            return fora('Fornecedor com CNPJ e sem IE de produtor, vendendo produto não agropecuário — fora da DIPAM.');
        }
        pendencias.push(pendencia(
            'fornecedor-indefinido',
            `${base.fornecedor.nome}: vende gênero agropecuário, mas não dá para provar que é Produtor Rural (Pessoa Física).`,
            'Consulte a natureza jurídica no CADESP e confirme no cadastro do produtor. '
            + 'Lançar fornecedor PJ no DIPAM 1.1 é o erro que a SEFAZ mais desconsidera.',
        ));
        return fora('Natureza do fornecedor indefinida — fora do total até confirmar.');
    }
    if (!base.natureza.ehProdutorRuralPF) {
        return fora(base.natureza.motivo);
    }

    // Só produtor PAULISTA. O caso MG do print gera FUNRURAL, mas não DIPAM.
    const municipioPaulista = ehMunicipioPaulista(base.fornecedor.codMunIBGE);
    if (base.fornecedor.uf && base.fornecedor.uf !== UF_DIPAM) {
        return fora(`Produtor de ${base.fornecedor.uf} — a DIPAM é declaração paulista (só produtor de SP).`);
    }
    if (!base.fornecedor.codMunIBGE) {
        pendencias.push(pendencia(
            'municipio-ausente',
            `${base.fornecedor.nome}: nota sem código IBGE do município de origem.`,
            'Preencha o município no cadastro do produtor — a DIPAM é rateada POR MUNICÍPIO e sem ele o valor não pode ser lançado.',
        ));
        return fora('Município de origem desconhecido.');
    }
    if (!municipioPaulista) {
        return fora(`Município ${base.fornecedor.codMunIBGE} não é paulista — a DIPAM só rateia municípios de SP.`);
    }

    if (ehDevolucaoSaida) {
        if (!CFOPS_DEVOLUCAO.has(cfopPrincipal)) {
            return fora(`Saída CFOP ${cfopPrincipal || '—'} não é devolução de compra.`);
        }
        return {
            aplica: true, deducao: true, codigo, registro1400: CODIGOS_DIPAM[codigo],
            codMunIBGE: base.fornecedor.codMunIBGE, municipio: base.fornecedor.municipio,
            valor: -base.valor,
            motivo: `Devolução de compra (CFOP ${cfopPrincipal}) — DEDUZ do município ${base.fornecedor.municipio || base.fornecedor.codMunIBGE}.`,
            pendencias,
        };
    }

    if (CFOPS_NAO_LANCAR[cfopPrincipal]) {
        return fora(CFOPS_NAO_LANCAR[cfopPrincipal]);
    }
    if (!CFOPS_COMPRA.has(cfopPrincipal)) {
        pendencias.push(pendencia(
            'cfop-fora-da-regua',
            `Nota ${base.numero}: CFOP ${cfopPrincipal || '—'} não está na régua de compra de produtor.`,
            'Classifique a operação manualmente: só compra, aquisição ou entrada por bonificação entra no DIPAM 1.1.',
        ));
        return fora(`CFOP ${cfopPrincipal || '—'} fora da régua de compra.`);
    }

    // Erro frequente II do Manual: lançar compra que nada tem a ver com
    // produção rural (autopeças, combustível…). Aqui é AVISO, não bloqueio:
    // a natureza do remetente é que manda, mas a equipe precisa ver.
    const itens = doc.itens || [];
    const agro = itens.filter((i) => ehNcmAgropecuario(i.ncm || i.NCM));
    if (itens.length > 0 && agro.length === 0) {
        pendencias.push(pendencia(
            'ncm-nao-agro',
            `Nota ${base.numero}: nenhum item com NCM de gênero agropecuário (${itens.map((i) => soDigitos(i.ncm || i.NCM)).filter(Boolean).join(', ') || 'sem NCM'}).`,
            'Confira antes de lançar: o Manual só admite produto agropecuário/hortifrutigranjeiro no DIPAM 1.1.',
        ));
    }

    return {
        aplica: true, deducao: false, codigo, registro1400: CODIGOS_DIPAM[codigo],
        codMunIBGE: base.fornecedor.codMunIBGE, municipio: base.fornecedor.municipio,
        valor: base.valor,
        motivo: `Compra de produtor rural paulista (CFOP ${cfopPrincipal}) — DIPAM ${codigo}, município ${base.fornecedor.municipio || base.fornecedor.codMunIBGE}.`,
        pendencias,
    };
}

/**
 * Esta NOTA foi tirada do FUNRURAL por decisão gravada?
 *
 * 🚨 30/08, Paulo: *"Ao excluir as notas de produtor emitidas pelo fornecedor, o
 * sistema apaga TODAS as notas vinculadas a esse produtor, incluindo a nota de
 * entrada própria da Nova Era, que deveria ser mantida. Como consequência, não
 * consigo conferir nem conciliar"*.
 *
 * Caso COSME QUEIROZ DE SANTANA: a **nota própria de entrada** (art. 136, CFOP
 * 2102, R$ 49.500) tem de FICAR, e as **NF-e do produtor** (CFOP 6101) tinham de
 * sair. O ✕ tirava as três — porque o botão está na linha da NOTA e gravava
 * `funrural: 'nao_aplica'` no **PRODUTOR**. É a promessa que a tela não cumpre,
 * a família do ✕ de 14/08.
 *
 * 📌 São DUAS decisões diferentes, e só existia uma: *"este fornecedor não gera
 * sub-rogação"* (natureza/folha — segue em `cadastro.funrural`, e vale para
 * todas as notas dele) e *"esta nota não entra"*, que é esta.
 *
 * ⚠️ **Sem chave não afirma nada**: documento sem chave legível não pode ser
 * casado com decisão nenhuma, e dizer "foi tirada" ali tiraria nota que ninguém
 * tirou — do total de um imposto.
 */
export function notaForaDoFunruralPorDecisao(cadastro, chave) {
    const c = String(chave || '').trim();
    if (!c) return false;
    const lista = cadastro?.notasForaDoFunrural;
    return Array.isArray(lista) && lista.some((x) => String(x || '').trim() === c);
}

function avaliarFunrural({ base, doc, cadastro, empresa, tabelaFunrural, ehDevolucaoSaida, cfopPrincipal }) {
    const pendencias = [];
    const fora = (motivo, decisao = null) => ({ aplica: false, motivo, decisao, pendencias });

    if (ehDevolucaoSaida) return fora('Devolução — o ajuste do FUNRURAL segue a nota de compra original.');
    if (empresa.funruralSubRogacao === 'nao_aplica') {
        return fora('Sub-rogação desligada no cadastro do cliente.');
    }
    if (empresa.ehProdutorRuralPF) {
        return fora('Adquirente é produtor rural PF — a sub-rogação é obrigação da empresa adquirente (Lei 8.212/91, art. 30, IV).');
    }
    if (!base.natureza.ehProdutorRuralPF) {
        // Sem contraparte não se afirma NADA sobre o fornecedor. Dizer "não é
        // produtor rural" aqui seria conclusão sobre quem o app não leu.
        if (base.natureza.confianca === 'sem-contraparte') {
            return fora('A nota não traz o fornecedor — sem ele não dá pra dizer se há sub-rogação.');
        }
        if (base.natureza.confianca === 'indefinida') {
            return fora('Natureza do fornecedor indefinida — não calcula sub-rogação até confirmar.');
        }
        if (base.natureza.confianca === 'sugerida-pj') {
            return fora('A razão social indica sociedade (pessoa jurídica) — sem sub-rogação, mas confirme no cadastro.');
        }
        if (base.natureza.confianca === 'cadastro-contraditorio') {
            return fora(base.natureza.motivo);
        }
        return fora('Fornecedor não é produtor rural pessoa física — quem recolhe é o próprio emitente.');
    }
    // Documento de SERVIÇO nunca é aquisição de produção rural — e ele não tem
    // CFOP nem NCM, então a prova negativa abaixo não o alcança.
    if (ehDocumentoDeServico(doc)) {
        pendencias.push(pendencia(
            'funrural-documento-de-servico',
            `${base.fornecedor.nome}, documento ${base.numero}: é nota de SERVIÇO, não de mercadoria.`,
            'A sub-rogação é sobre a comercialização da produção rural (Lei 8.212/91 art. 25), que circula em '
            + 'NF-e ou nota de produtor. Serviço prestado por pessoa física não gera FUNRURAL — se houver '
            + 'retenção previdenciária, ela é do R-2010, outro evento.',
        ));
        return fora('Documento de serviço — a sub-rogação é sobre a aquisição de produção rural, que é mercadoria.');
    }

    // ── A SUB-ROGAÇÃO É SOBRE A AQUISIÇÃO DE PRODUÇÃO RURAL ────────────────
    //
    // Paulo, 13/08: *"esses dois também têm que sair"* — EMILIO CAMPIGOTTO
    // (CPF, SC) e ALEXANDRE AUGUSTO ARCARO **2º TP** (um tabelionato) somando
    // FUNRURAL. Nenhum dos dois é erro de cadastro: bastava o fornecedor ser
    // pessoa física para a contribuição ser calculada.
    //
    // E isso não é o que a lei diz. A Lei 8.212/91 art. 25 incide sobre a
    // receita bruta da **comercialização da PRODUÇÃO RURAL** do produtor PF, e
    // o art. 30, IV sub-roga o adquirente **dessa produção**. Comprar qualquer
    // coisa de uma pessoa física — um caminhão usado, uma custa de cartório,
    // um serviço — não gera sub-rogação nenhuma.
    //
    // Aqui a prova é NEGATIVA e por isso é segura: só bloqueia quando o
    // documento DIZ que não é produção rural (itens lidos e nenhum agropecuário,
    // ou CFOP que não é de compra). Nota sem itens capturados não é bloqueada —
    // ausência não é prova, e bloquear no escuro tiraria FUNRURAL legítimo.
    const itensFunrural = doc.itens || [];
    const temAgro = itensFunrural.some((i) => ehNcmAgropecuario(i.ncm || i.NCM));
    if (itensFunrural.length > 0 && !temAgro) {
        pendencias.push(pendencia(
            'funrural-sem-producao-rural',
            `${base.fornecedor.nome}, nota ${base.numero}: nenhum item é gênero agropecuário `
            + `(${itensFunrural.map((i) => soDigitos(i.ncm || i.NCM)).filter(Boolean).join(', ') || 'sem NCM'}).`,
            'A sub-rogação é sobre a aquisição de PRODUÇÃO RURAL (Lei 8.212/91 art. 25 e art. 30, IV) — comprar '
            + 'outra coisa de uma pessoa física não gera FUNRURAL. Se o produto for rural e o NCM estiver errado '
            + 'na nota, confira na origem.',
        ));
        return fora('Nenhum item de gênero agropecuário — a sub-rogação é sobre a aquisição de produção rural.');
    }
    // O CFOP só julga o LADO DA ENTRADA (1xxx/2xxx). CFOP de saída numa nota de
    // entrada é a NF-e do próprio produtor (5101 é o CFOP de quem VENDE) — ela
    // é o documento de origem do art. 136, sai pela dedup e NÃO pode cobrar
    // pendência: essa foi a lição de 12/08 (caso VINCENZO, notas 95-98), e
    // alarme em nota que já não conta ensina a equipe a ignorar a lista.
    const ehEntradaPelaCfop = cfopPrincipal && (cfopPrincipal[0] === '1' || cfopPrincipal[0] === '2');
    if (!ehDevolucaoSaida && ehEntradaPelaCfop
        && !ehCfopCompraProducao(cfopPrincipal) && !CFOPS_NAO_LANCAR[cfopPrincipal]) {
        pendencias.push(pendencia(
            'funrural-cfop-fora-da-regua',
            `${base.fornecedor.nome}, nota ${base.numero}: CFOP ${cfopPrincipal} não é de compra/aquisição.`,
            'Só a aquisição de produção rural gera sub-rogação (Lei 8.212/91 art. 25 e art. 30, IV). '
            + 'Classifique a operação antes de lançar.',
        ));
        return fora(`CFOP ${cfopPrincipal} não é de compra de produção rural.`);
    }

    // Opção do produtor por recolher sobre a FOLHA (Lei 13.606/2018): não há
    // sub-rogação. Só o cadastro sabe disso — a nota não diz.
    // ── DECISÃO HUMANA GRAVADA: some da CONTA, não da TELA ──────────────────
    //
    // Estas duas saídas não são régua fiscal lida do documento — são escolha de
    // alguém, registrada no cadastro do produtor. E escolha errada acontece: o
    // ✕ da fila é um clique, e o produtor sumia da tela junto com o botão que
    // desfaria. Sem caminho de volta na tela, a pessoa vai procurar o lever
    // errado (Paulo, 14/08, tentou REIMPORTAR o XML, que não desfaz nada
    // porque a nota nunca saiu do banco).
    //
    // É a mesma regra que eu já tinha escrito para a dedup do art. 136 e não
    // apliquei aqui: **total que muda sozinho faz desconfiar do número certo**.
    // Por isso a saída vai CARIMBADA (`decisao`), volta nomeada no payload e
    // ganha o botão de reverter na própria linha.
    if (cadastro?.funrural === 'folha') {
        return fora(
            'Produtor optou por recolher sobre a folha de salários — sem sub-rogação (registrado no cadastro).',
            'folha',
        );
    }
    // 🚨 DECISÃO DE UMA NOTA SÓ — e ela vem ANTES da do produtor de propósito:
    // é a mais específica, e o mesmo produtor tem nota que fica e nota que sai.
    if (notaForaDoFunruralPorDecisao(cadastro, doc?.chave || doc?.id)) {
        return fora(
            'Esta NOTA foi tirada da sub-rogação por decisão gravada — as demais notas deste produtor continuam contando.',
            'nota-nao-aplica',
        );
    }
    if (cadastro?.funrural === 'nao_aplica') {
        return fora(
            'Tirado da sub-rogação por decisão gravada no cadastro do produtor.',
            'nao_aplica',
        );
    }

    const calc = calcularFunrural(base.valor, base.competencia, tabelaDoProdutor(cadastro, tabelaFunrural));
    const declarado = extrairFunruralDeclarado(doc.infAdic);

    let divergencia = null;
    if (declarado?.valor != null) {
        const dif = round2(Math.abs(declarado.valor - calc.total));
        // Tolerância de centavos: arredondamento por item x por total.
        if (dif > 0.05) {
            divergencia = {
                declarado: declarado.valor,
                calculado: calc.total,
                diferenca: round2(declarado.valor - calc.total),
            };
            pendencias.push(pendencia(
                'funrural-divergente',
                `Nota ${base.numero}: o emitente declara FUNRURAL de R$ ${declarado.valor.toFixed(2)} e o app calcula R$ ${calc.total.toFixed(2)}.`,
                'Confira a alíquota vigente e a base antes de lançar — a diferença vai direto para a guia da empresa.',
            ));
        }
    }
    // A alíquota "a confirmar" é assunto da TABELA, não desta nota: vira aviso
    // único da competência (montarDipamCompetencia), senão toda nota de 2026
    // nasceria com a mesma pendência repetida e o farol viveria em âmbar.
    return { aplica: true, ...calc, declarado, divergencia, pendencias };
}

// ─── Consolidação da competência ────────────────────────────────────────────

/**
 * Monta o painel da competência: o que vai no DIPAM (por município), o que vai
 * de FUNRURAL (por nota) e o que está travando.
 *
 * @param {object} p
 * @param {Array}  p.documentos    docs da empresa na competência
 * @param {string} p.competencia   'AAAA-MM'
 * @param {object} [p.empresa]     { id, nome, cnpj, ehCooperativa, ehProdutorRuralPF, funruralSubRogacao, adquireDeProdutor }
 * @param {object} [p.fornecedores] mapa { [cpfCnpj]: cadastro }
 */
function chaveProdutorComp(n) {
    return `${soDigitos(n.fornecedor?.doc)}|${n.competencia || ''}`;
}

/**
 * DEDUP art. 136 / RC 33068/2025 — a compra de produtor rural tem DUAS notas da
 * MESMA entrada: a NF-e do PRODUTOR (NOTA 1) e a nota própria de ENTRADA que o
 * cliente emite (NOTA 2, tpNF=0). A SEFAZ é categórica: o adquirente escritura
 * SÓ a que ELE emitiu, NUNCA a do produtor (RC 33068/2025). Como o CFI captura
 * as duas (confirmado no par real DAMIÃO×EDUARDO GUERRA, R$ 8.400 cada, sem
 * refNFe ligando), sem isto a FUNRURAL/DIPAM dobrava (R$ 136,92 → R$ 273,84).
 *
 * Régua por PRODUTOR × COMPETÊNCIA (não há refNFe, então pareia pelo produtor):
 *   · Conta TODAS as notas próprias de entrada (NOTA 2) — são as escrituradas.
 *   · Exclui a NF-e do produtor (NOTA 1) APENAS quando há uma nota de entrada do
 *     mesmo produtor pra cobri-la (é o PAR que dobra).
 *   · NF-e de produtor SEM nota de entrada correspondente fica INTACTA: nada de
 *     alerta. Muitos clientes escrituram a própria nota do produtor direto (só
 *     uma nota por operação — não dobra); nagá-los seria alarme sem ação. A
 *     dedup só desfaz DUPLICIDADE, não impõe processo.
 */
export function dedupNotaProdutorComEntrada(notas) {
    const lista = Array.isArray(notas) ? notas : [];

    // ── QUEM ENTRA NO PAREAMENTO ────────────────────────────────────────────
    //
    // Antes era só `funrural.aplica`, e isso deixava de fora justamente quem
    // está fora do FUNRURAL **por DECISÃO** (o ✕ do cadastro do produtor). O
    // efeito só aparecia no lugar mais caro: o bloco "tirados por decisão"
    // promete, ao lado do ↩, **quanto voltaria ao total** — e somava as DUAS
    // notas da mesma compra, porque a dedup nunca tinha rodado nelas. Caso
    // real 14/08 (NOVA ERA 07/2026): NUNO MONTEIRO apareceu com 11 notas e
    // R$ 309.645,94, prometendo devolver R$ 5.047,23 — sobre uma base que
    // conta cada compra duas vezes.
    //
    // Número que só existe para alguém decidir tem que valer no momento da
    // decisão. "Reverter imposto sem o número do lado é decidir no escuro" —
    // e número inflado é pior que número nenhum, porque não levanta suspeita.
    //
    // O art. 136 é sobre QUAL DOCUMENTO SE ESCRITURA. Isso não depende de o
    // FUNRURAL estar ligado: a NF-e do produtor continua sendo documento de
    // origem mesmo quando alguém decidiu que ali não há sub-rogação.
    const entraNoPar = (n) => !!n.funrural?.aplica || !!n.funrural?.decisao;

    const orcamento = new Map(); // produtor×comp -> quantas notas de entrada há
    for (const n of lista) {
        if (n.notaPropria && entraNoPar(n)) {
            const k = chaveProdutorComp(n);
            orcamento.set(k, (orcamento.get(k) || 0) + 1);
        }
    }
    return lista.map((n) => {
        const ehNotaDoProdutor = !n.notaPropria && n.direcao === 'entrada' && entraNoPar(n);
        if (!ehNotaDoProdutor) return n;
        const k = chaveProdutorComp(n);
        if ((orcamento.get(k) || 0) <= 0) return n; // sem par → não dobra → intacta
        orcamento.set(k, orcamento.get(k) - 1);
        const motivo = 'NF-e do produtor: documento de origem — a escriturada é a nota de entrada própria '
            + '(art. 136, I, "a" do RICMS/SP; RC 33068/2025). Fora da FUNRURAL/DIPAM para não dobrar.';
        return {
            ...n,
            notaOrigemProdutor: true,
            // Só DERRUBA o que estava de pé. Em quem já está fora por decisão,
            // o motivo da saída continua sendo a DECISÃO — sobrescrever aqui
            // faria a tela dizer "art. 136" para quem alguém tirou no ✕, e o
            // caminho de volta (que é do cadastro) sumiria da vista.
            dipam: n.dipam?.aplica ? { ...n.dipam, aplica: false, motivo } : n.dipam,
            funrural: n.funrural?.aplica ? { ...n.funrural, aplica: false, motivo } : n.funrural,
        };
    });
}

/** Rótulo de cada decisão — e ela DIZ se tem volta, porque as duas não são iguais. */
const ROTULO_DECISAO = {
    nao_aplica: 'Tirado do FUNRURAL por decisão gravada no cadastro do produtor.',
    folha: 'Produtor optou por recolher sobre a FOLHA de salários (Lei 13.606/2018) — não há sub-rogação.',
    // 🚨 A decisão de UMA nota (30/08, caso COSME): as demais notas do mesmo
    // produtor continuam contando, e é isso que o rótulo precisa dizer — senão
    // quem lê acha que o produtor inteiro saiu, que era o defeito.
    'nota-nao-aplica': 'Nota(s) tirada(s) do FUNRURAL uma a uma — as demais notas deste produtor continuam contando.',
};

/**
 * Os produtores tirados da sub-rogação por DECISÃO, com o que voltaria ao total.
 *
 * Agrupa por produtor porque é nele que a decisão foi gravada.
 *
 * 📌 ESTE COMENTÁRIO DIZIA *"desfazer nota a nota não existe, e oferecer isso na
 * tela prometeria um controle que o cadastro não tem"* — verdade até 30/08, e
 * FALSO desde que a decisão por NOTA passou a existir (caso COSME). Por isso o
 * grupo carrega as CHAVES: sem elas o ↩ não teria o que devolver, e a tela
 * voltaria a prometer o que não cumpre — só que na direção contrária.
 */
export function agruparTiradosPorDecisao(notas, competencia, tabelaFunrural = ALIQUOTAS_FUNRURAL_PF) {
    const porProdutor = new Map();
    for (const n of notas || []) {
        const doc = soDigitos(n.fornecedor?.doc);
        const chaveGrupo = `${doc || 'sem-doc'}|${n.funrural.decisao}`;
        const g = porProdutor.get(chaveGrupo) || {
            doc: doc || null,
            fornecedor: n.fornecedor?.nome || null,
            decisao: n.funrural.decisao,
            rotulo: ROTULO_DECISAO[n.funrural.decisao] || n.funrural.motivo,
            // Só o ✕ se desfaz por aqui. A opção pela FOLHA é declaração do
            // produtor, não engano de clique: reverter fica no cadastro dele,
            // onde a decisão foi tomada.
            reversivelNaLinha: n.funrural.decisao === 'nao_aplica'
                || n.funrural.decisao === 'nota-nao-aplica',
            notas: 0,
            valor: 0,
            // As chaves das notas tiradas UMA A UMA — é o que o ↩ devolve.
            chaves: [],
        };
        g.notas += 1;
        if (n.funrural.decisao === 'nota-nao-aplica' && n.chave) g.chaves.push(n.chave);
        g.valor = round2(g.valor + (Number(n.valor) || 0));
        porProdutor.set(chaveGrupo, g);
    }
    return [...porProdutor.values()]
        .map((g) => ({
            ...g,
            // O que voltaria ao total se a decisão fosse desfeita. Alíquota
            // VIGENTE na competência, pela mesma régua do cálculo — percentual
            // escrito à mão aqui seria a segunda cópia.
            funruralPotencial: round2(g.valor * (percentualFunruralVigente(competencia, tabelaFunrural) / 100)),
        }))
        .sort((a, b) => b.valor - a.valor);
}

export function montarDipamCompetencia({ documentos = [], competencia, empresa = {}, fornecedores = {}, tabelaFunrural = ALIQUOTAS_FUNRURAL_PF }) {
    // EVENTO NÃO É NOTA. Registro de evento (chave-Id de 53 dígitos começando
    // pelo tpEvento) nunca tem participante — ele cobrava "reler o fornecedor
    // do XML" de um arquivo que não tem fornecedor nenhum, para sempre. Caso
    // 13/08: 435 pendências falsas empurrando as reais para fora da tela.
    const registrosDeEvento = (documentos || []).filter((d) => ehRegistroDeEvento(d));
    const notas = dedupNotaProdutorComEntrada((documentos || [])
        .filter((d) => d && !d._merged_into && !d._deleted && !ehRegistroDeEvento(d))
        .map((raw) => normalizarParticipantesDoc(raw))
        .map((d) => classificarNota(d, {
            cadastro: fornecedores[soDigitos((d.emitente || d.prestador || {}).cnpjCpf)]
                || fornecedores[soDigitos((d.destinatario || d.tomador || {}).cnpjCpf)]
                || null,
            empresa,
            tabelaFunrural,
        })));

    const doDipam = notas.filter((n) => n.dipam.aplica);
    const doFunrural = notas.filter((n) => n.funrural.aplica);

    // Agrupamento POR MUNICÍPIO — é assim que a DIPAM é declarada.
    const porMunicipio = new Map();
    for (const n of doDipam) {
        const k = n.dipam.codMunIBGE;
        if (!porMunicipio.has(k)) {
            porMunicipio.set(k, {
                codMunIBGE: k,
                municipio: n.dipam.municipio || '',
                codigo: n.dipam.codigo,
                registro1400: n.dipam.registro1400,
                valor: 0, compras: 0, devolucoes: 0, notas: [],
            });
        }
        const g = porMunicipio.get(k);
        g.valor = round2(g.valor + n.dipam.valor);
        if (n.dipam.deducao) g.devolucoes += 1; else g.compras += 1;
        if (!g.municipio && n.dipam.municipio) g.municipio = n.dipam.municipio;
        g.notas.push({ chave: n.chave, numero: n.numero, dhEmi: n.dhEmi, valor: n.dipam.valor, fornecedor: n.fornecedor.nome });
    }

    // Município que fechou negativo/zero não vai ao arquivo (Guia Prático,
    // campo 04 do 1400: "se o valor for negativo ou zero, não prestar a
    // informação"). Ele NÃO some: aparece como pendência a compensar.
    const municipios = Array.from(porMunicipio.values()).sort((a, b) => b.valor - a.valor);
    const municipiosDeclaraveis = municipios.filter((m) => m.valor > 0);
    const municipiosZerados = municipios.filter((m) => m.valor <= 0);

    const funruralTotais = doFunrural.reduce((acc, n) => ({
        base: round2(acc.base + n.funrural.base),
        inss: round2(acc.inss + n.funrural.inss),
        gilrat: round2(acc.gilrat + n.funrural.gilrat),
        senar: round2(acc.senar + n.funrural.senar),
        total: round2(acc.total + n.funrural.total),
    }), { base: 0, inss: 0, gilrat: 0, senar: 0, total: 0 });

    // Pendência de FORNECEDOR é por fornecedor, não por nota: confirmar o
    // CADESP uma vez resolve as 40 notas dele. Repetir viraria muro de texto.
    const pendencias = [];
    const fornecedorJaListado = new Map();
    for (const n of notas) {
        // Nota excluída pelo art. 136 (NF-e do produtor, documento de origem)
        // não gera pendência: ela não é escriturada, então não há o que
        // conferir nela. Caso real VINCENZO 07/2026 — as notas 95-98 saíam do
        // total pela dedup E continuavam cobrando "CFOP 5101 não está na régua
        // de compra", que é o CFOP normal de quem VENDE. Alarme sem ação em
        // nota que já não conta ensina a equipe a ignorar a lista inteira.
        if (n.notaOrigemProdutor) continue;
        for (const p of n.pendencias) {
            // Dedup POR FORNECEDOR. 'fornecedor-sociedade' entra aqui junto
            // com os outros dois: sem isso, uma LTDA com 40 notas viraria 40
            // linhas iguais e a fila voltaria a ser muro de texto.
            const porFornecedor = p.codigo === 'fornecedor-indefinido'
                || p.codigo === 'fornecedor-sociedade'
                || p.codigo === 'cadastro-contraditorio'
                || p.codigo === 'municipio-ausente';
            const chaveDedup = `${p.codigo}|${n.fornecedor.doc}`;
            if (porFornecedor) {
                // Fornecedor repetido só ACUMULA o valor: 40 notas do mesmo
                // fornecedor continuam sendo UMA conferência de CADESP, mas o
                // que decide a ordem da fila é a soma delas.
                const jaTem = fornecedorJaListado.get(chaveDedup);
                if (jaTem) {
                    jaTem.valor = round2(jaTem.valor + (Number(n.valor) || 0));
                    jaTem.notas += 1;
                    continue;
                }
            }
            const item = {
                ...p, chave: n.chave, numero: n.numero,
                fornecedor: n.fornecedor.nome, doc: n.fornecedor.doc,
                // O DINHEIRO em cada linha. 293 conferências de CADESP em ordem
                // qualquer é impossível de atacar; ordenadas por valor, a
                // primeira costuma resolver o mês (caso 13/08: o mês inteiro
                // faltava R$ 10,7 mil e a lista tinha R$ 8,5 milhões de
                // compras espalhados em 293 fornecedores).
                valor: round2(n.valor),
                notas: 1,
            };
            if (porFornecedor) fornecedorJaListado.set(chaveDedup, item);
            pendencias.push(item);
        }
    }
    // Alíquota vigente uma vez só — o potencial de cada linha usa a MESMA
    // régua da apuração.
    const pctFunrural = percentualFunruralVigente(competencia, tabelaFunrural);
    for (const p of pendencias) {
        if (p.valor != null) p.funruralPotencial = round2(p.valor * (pctFunrural / 100));
    }
    // Fila ordenada por DINHEIRO. Pendência sem valor (saldo de município) vai
    // pro fim: ela não compete com o que segura a apuração.
    pendencias.sort((a, b) => (Number(b.valor) || -1) - (Number(a.valor) || -1));
    for (const m of municipiosZerados) {
        pendencias.push(pendencia(
            'municipio-saldo-nao-positivo',
            `${m.municipio || m.codMunIBGE}: saldo de ${fmtBRL(m.valor)} no mês (devolução maior que a compra).`,
            'O Registro 1400 não aceita valor zero ou negativo: deduza no próximo mês com saldo suficiente (Manual, pág. 12).',
        ));
    }

    const avisos = [];
    const aliqNota = doFunrural[0]?.funrural;
    if (aliqNota?.revisar) {
        avisos.push(
            `Alíquotas do FUNRURAL em ${competencia}: ${aliqNota.aliquotas.inss}% + ${aliqNota.aliquotas.gilrat}% GILRAT `
            + `+ ${aliqNota.aliquotas.senar}% SENAR (total ${aliqNota.percentualTotal}%). ${aliqNota.fonte}`,
        );
    }

    const total = round2(municipiosDeclaraveis.reduce((s, m) => s + m.valor, 0));
    const bloqueantes = pendencias.filter((p) => p.codigo === 'fornecedor-indefinido'
        || p.codigo === 'fornecedor-sociedade' || p.codigo === 'cadastro-contraditorio'
        || p.codigo === 'municipio-ausente' || p.codigo === 'contraparte-ausente');

    // ── QUANTO está fora do total, e por QUAL causa ─────────────────────────
    //
    // "736 notas fora do total" não diz se o que falta são R$ 200 ou R$ 200 mil,
    // e por isso não diz por onde começar. Paulo, 13/08: o app apurou
    // R$ 17.089,31 de FUNRURAL e o certo eram R$ 27.832,92 — a diferença estava
    // nas notas bloqueadas, mas ninguém tinha como ver isso na tela.
    //
    // O valor abaixo é POTENCIAL, não apuração: são compras que VIRARIAM base
    // se a pendência fosse resolvida. Ele NUNCA é somado ao total — resolver a
    // pendência é que soma, uma a uma, com a prova do lado.
    const bloqueio = new Map();
    for (const n of notas) {
        if (n.notaOrigemProdutor) continue;
        const causa = (n.pendencias || []).find((p) => p.codigo === 'fornecedor-indefinido'
            || p.codigo === 'fornecedor-sociedade' || p.codigo === 'cadastro-contraditorio'
            || p.codigo === 'municipio-ausente' || p.codigo === 'contraparte-ausente');
        if (!causa) continue;
        const g = bloqueio.get(causa.codigo) || { codigo: causa.codigo, notas: 0, valor: 0, fornecedores: new Set() };
        g.notas += 1;
        g.valor = round2(g.valor + (Number(n.valor) || 0));
        if (n.fornecedor.doc) g.fornecedores.add(n.fornecedor.doc);
        bloqueio.set(causa.codigo, g);
    }
    const foraDoTotal = Array.from(bloqueio.values())
        .map((g) => ({
            codigo: g.codigo,
            notas: g.notas,
            valor: g.valor,
            fornecedores: g.fornecedores.size,
            // O potencial usa a alíquota VIGENTE na competência — a mesma régua
            // do cálculo, nunca um percentual escrito à mão aqui.
            funruralPotencial: round2(g.valor * (percentualFunruralVigente(competencia, tabelaFunrural) / 100)),
            rotulo: ROTULO_BLOQUEIO[g.codigo] || g.codigo,
        }))
        .sort((a, b) => b.valor - a.valor);

    return {
        competencia,
        empresa: { id: empresa.id || null, nome: empresa.nome || null, cnpj: empresa.cnpj || null },
        codigo: empresa.ehCooperativa ? '1.3' : '1.1',
        dipam: {
            total,
            municipios: municipiosDeclaraveis,
            municipiosZerados,
            notas: doDipam.length,
            registro1400: montarRegistro1400(municipiosDeclaraveis),
        },
        funrural: {
            ...funruralTotais,
            notas: doFunrural.map((n) => ({
                chave: n.chave, numero: n.numero, dhEmi: n.dhEmi,
                fornecedor: n.fornecedor.nome, doc: n.fornecedor.doc, uf: n.fornecedor.uf,
                ie: n.fornecedor.ie || '',
                cpfTitular: n.fornecedor.cpfTitular || null,
                // A PROVA de que este fornecedor é produtor rural PF viaja junto
                // do número. Quem lê do outro lado (R-2055) não pode ter régua
                // própria: dois critérios pro mesmo fato foi exatamente o
                // defeito do caso VINCENZO (o 🌾 apurava, o R-2055 descartava
                // por contar dígitos). Aqui vai o carimbo da origem.
                naturezaConfianca: n.natureza?.confianca || null,
                naturezaMotivo: n.natureza?.motivo || null,
                // QUAL documento está somando — a nota própria de entrada (a
                // que se escritura, art. 136) ou a NF-e do produtor. A tela
                // mostrava as duas com a MESMA cara, e por isso ninguém
                // conseguia conferir na tela se a régua do art. 136 pegou.
                notaPropria: !!n.notaPropria,
                provaDirecao: n.provaDirecao || null,
                direcaoGravada: n.direcaoGravada || null,
                cfops: n.cfops || [],
                base: n.funrural.base,
                aliquotas: n.funrural.aliquotas,
                inss: n.funrural.inss, gilrat: n.funrural.gilrat, senar: n.funrural.senar,
                total: n.funrural.total,
                declarado: n.funrural.declarado || null,
                divergencia: n.funrural.divergencia || null,
            })),
            revisarAliquotas: doFunrural.some((n) => n.funrural.revisar),
            // NF-e do produtor deduplicadas (art. 136/RC 33068): documento de
            // origem que NÃO se escritura — a de entrada própria já conta. Vem
            // na resposta pra o painel MOSTRAR o porquê (farol honesto), não só
            // um total que mudou sozinho.
            excluidasArt136: notas.filter((n) => n.notaOrigemProdutor).map((n) => ({
                chave: n.chave, numero: n.numero, dhEmi: n.dhEmi,
                fornecedor: n.fornecedor.nome, doc: n.fornecedor.doc, valor: n.valor,
                motivo: n.funrural.motivo || 'Documento de origem — a escriturada é a nota de entrada própria (art. 136/RC 33068).',
            })),
            // ── TIRADOS POR DECISÃO HUMANA ──────────────────────────────────
            //
            // Agrupado por PRODUTOR, que é o eixo da decisão (o ✕ marca o
            // cadastro do produtor, não a nota). Some da CONTA, não da TELA —
            // e é aqui que mora o caminho de volta: sem ele, um clique errado
            // fazia o produtor desaparecer junto com o botão que o desfaria, e
            // a pessoa ia procurar o lever errado.
            //
            // O valor que VOLTARIA ao total vai junto: "reverter" sem número
            // do lado é decidir no escuro sobre imposto.
            tiradosPorDecisao: agruparTiradosPorDecisao(
                notas.filter((n) => !n.notaOrigemProdutor && n.funrural?.decisao),
                competencia,
                tabelaFunrural,
            ),
        },
        notas,
        pendencias,
        // O DINHEIRO que está esperando conferência, por causa. "736 notas fora
        // do total" não diz se falta R$ 200 ou R$ 200 mil — e sem isso não há
        // por onde começar. NUNCA soma no total: resolver a pendência é que
        // soma, uma a uma, com a prova do lado.
        foraDoTotal,
        // Registro de EVENTO que estava sendo contado como nota (chave-Id de
        // mais de 44 dígitos). Some da conta, não da tela — total que muda
        // sozinho faz desconfiar do número certo.
        registrosDeEvento: registrosDeEvento.length,
        avisos,
        farol: farolDipam({ total, notas: doDipam.length, bloqueantes: bloqueantes.length, pendencias: pendencias.length, funruralNotas: doFunrural.length }),
    };
}

/**
 * Farol honesto: nada capturado não é "ok"; valor apurado com fornecedor
 * indefinido em cima NUNCA é verde (é exatamente o número que a SEFAZ
 * desconsidera).
 */
export function farolDipam({ total, notas, bloqueantes, pendencias, funruralNotas }) {
    if (bloqueantes > 0) {
        return { cor: 'falha', resumo: `${bloqueantes} nota(s) fora do total até confirmar o fornecedor ou o município.` };
    }
    if (notas === 0 && funruralNotas === 0) {
        return { cor: 'neutro', resumo: 'Nenhuma compra de produtor rural nesta competência.' };
    }
    if (pendencias > 0) {
        return { cor: 'atencao', resumo: `${fmtBRL(total)} a declarar · ${pendencias} ponto(s) a conferir antes de fechar.` };
    }
    return { cor: 'ok', resumo: `${fmtBRL(total)} a declarar em ${notas} nota(s).` };
}

/**
 * Registro 1400 da EFD (Bloco 1): |1400|COD_ITEM_IPM|MUN|VALOR|
 * Um por município, só valor positivo. O código do item é o SPDIPAMxx.
 */
export function montarRegistro1400(municipios = []) {
    return municipios
        .filter((m) => m.valor > 0 && ehMunicipioPaulista(m.codMunIBGE))
        .map((m) => ({
            registro: '1400',
            codItemIpm: m.registro1400 || CODIGOS_DIPAM['1.1'],
            mun: soDigitos(m.codMunIBGE),
            valor: round2(m.valor),
            linha: `|1400|${m.registro1400 || CODIGOS_DIPAM['1.1']}|${soDigitos(m.codMunIBGE)}|${round2(m.valor).toFixed(2).replace('.', ',')}|`,
        }));
}

function fmtBRL(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
