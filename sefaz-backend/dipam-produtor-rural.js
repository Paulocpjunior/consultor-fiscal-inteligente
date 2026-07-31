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
export function identificarNaturezaFornecedor(participante, cadastro = null) {
    const p = participante || {};
    const doc = soDigitos(p.cnpjCpf || p.cnpj || p.cpf);
    const ie = p.ie || p.inscricaoEstadual || '';
    const sinais = [];

    if (cadastro && cadastro.natureza) {
        // Confirmação humana vence tudo — inclusive o "não é produtor".
        const ehProdutor = cadastro.natureza === 'produtor_rural_pf';
        sinais.push('cadastro-confirmado');
        return {
            ehProdutorRuralPF: ehProdutor,
            confianca: 'confirmada',
            sinais,
            motivo: ehProdutor
                ? 'Confirmado no cadastro como Produtor Rural (Pessoa Física).'
                : `Confirmado no cadastro como "${cadastro.natureza}" — não gera DIPAM 1.1 nem sub-rogação.`,
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
    return {
        ehProdutorRuralPF: false,
        confianca: 'indefinida',
        sinais,
        motivo: 'Emitente com CNPJ e sem IE de produtor. CNPJ não descaracteriza produtor PF '
            + '(Comunicado CAT 45/2008) — confirme a natureza jurídica no CADESP e marque no cadastro.',
    };
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
    const notaPropriaEntrada = String(d.tpNF ?? '') === '0'
        && (d.direcao === 'saida'
            || (empresa.cnpj && soDigitos(emitente.cnpjCpf || emitente.cnpj) === soDigitos(empresa.cnpj)));
    const direcao = notaPropriaEntrada ? 'entrada' : d.direcao;
    // Na devolução quem emite é a nossa empresa: o produtor está do outro lado.
    const ehDevolucaoSaida = direcao === 'saida';
    // O produtor é sempre o OUTRO lado: emitente na compra normal, mas
    // destinatário/remetente na nota própria de entrada e na devolução.
    const contraparte = (ehDevolucaoSaida || notaPropriaEntrada) ? destinatario : emitente;

    const cfops = Array.from(new Set((d.itens || []).map((i) => soDigitos(i.cfop)).filter(Boolean)));
    const cfopPrincipal = cfops[0] || '';
    const valor = round2(num(d.valorTotal ?? d.totais?.vNF ?? d.totais?.vProd));
    const natureza = identificarNaturezaFornecedor(contraparte, cadastro);

    const base = {
        chave: d.chave || d.id || '',
        numero: d.numero || '',
        serie: d.serie || '',
        dhEmi: d.dhEmi || '',
        competencia: d.competencia || '',
        direcao,
        cfops,
        valor,
        fornecedor: {
            doc: soDigitos(contraparte.cnpjCpf || contraparte.cnpj),
            nome: contraparte.nome || contraparte.razaoSocial || '—',
            ie: contraparte.ie || '',
            uf: (contraparte.uf || '').toUpperCase(),
            codMunIBGE: soDigitos(cadastro?.codMunIBGE || contraparte.codMunIBGE),
            municipio: cadastro?.municipio || contraparte.municipio || '',
        },
        natureza,
        cadastrado: !!cadastro,
        pendencias: [],
    };

    // Cancelada/denegada não é operação — sai da conta sem virar pendência.
    if (['cancelado', 'cancelada', 'denegado', 'inutilizado'].includes(d.status)) {
        return { ...base, dipam: naoAplica('Nota cancelada/denegada.'), funrural: naoAplica('Nota cancelada/denegada.') };
    }

    // ─── FUNRURAL (federal: vale para produtor de QUALQUER estado) ───────────
    const funrural = avaliarFunrural({ base, doc: d, cadastro, empresa, tabelaFunrural, ehDevolucaoSaida });

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

function avaliarFunrural({ base, doc, cadastro, empresa, tabelaFunrural, ehDevolucaoSaida }) {
    const pendencias = [];
    const fora = (motivo) => ({ aplica: false, motivo, pendencias });

    if (ehDevolucaoSaida) return fora('Devolução — o ajuste do FUNRURAL segue a nota de compra original.');
    if (empresa.funruralSubRogacao === 'nao_aplica') {
        return fora('Sub-rogação desligada no cadastro do cliente.');
    }
    if (empresa.ehProdutorRuralPF) {
        return fora('Adquirente é produtor rural PF — a sub-rogação é obrigação da empresa adquirente (Lei 8.212/91, art. 30, IV).');
    }
    if (!base.natureza.ehProdutorRuralPF) {
        if (base.natureza.confianca === 'indefinida') {
            return fora('Natureza do fornecedor indefinida — não calcula sub-rogação até confirmar.');
        }
        return fora('Fornecedor não é produtor rural pessoa física — quem recolhe é o próprio emitente.');
    }
    // Opção do produtor por recolher sobre a FOLHA (Lei 13.606/2018): não há
    // sub-rogação. Só o cadastro sabe disso — a nota não diz.
    if (cadastro?.funrural === 'folha') {
        return fora('Produtor optou por recolher sobre a folha de salários — sem sub-rogação (registrado no cadastro).');
    }
    if (cadastro?.funrural === 'nao_aplica') {
        return fora('Sub-rogação marcada como não aplicável no cadastro do produtor.');
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
export function montarDipamCompetencia({ documentos = [], competencia, empresa = {}, fornecedores = {}, tabelaFunrural = ALIQUOTAS_FUNRURAL_PF }) {
    const notas = (documentos || [])
        .filter((d) => d && !d._merged_into && !d._deleted)
        .map((d) => classificarNota(d, {
            cadastro: fornecedores[soDigitos((d.emitente || d.prestador || {}).cnpjCpf)]
                || fornecedores[soDigitos((d.destinatario || d.tomador || {}).cnpjCpf)]
                || null,
            empresa,
            tabelaFunrural,
        }));

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
    const fornecedorJaListado = new Set();
    for (const n of notas) {
        for (const p of n.pendencias) {
            const porFornecedor = p.codigo === 'fornecedor-indefinido' || p.codigo === 'municipio-ausente';
            const chaveDedup = `${p.codigo}|${n.fornecedor.doc}`;
            if (porFornecedor) {
                if (fornecedorJaListado.has(chaveDedup)) continue;
                fornecedorJaListado.add(chaveDedup);
            }
            pendencias.push({ ...p, chave: n.chave, numero: n.numero, fornecedor: n.fornecedor.nome, doc: n.fornecedor.doc });
        }
    }
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
    const bloqueantes = pendencias.filter((p) => p.codigo === 'fornecedor-indefinido' || p.codigo === 'municipio-ausente');

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
                base: n.funrural.base,
                aliquotas: n.funrural.aliquotas,
                inss: n.funrural.inss, gilrat: n.funrural.gilrat, senar: n.funrural.senar,
                total: n.funrural.total,
                declarado: n.funrural.declarado || null,
                divergencia: n.funrural.divergencia || null,
            })),
            revisarAliquotas: doFunrural.some((n) => n.funrural.revisar),
        },
        notas,
        pendencias,
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
