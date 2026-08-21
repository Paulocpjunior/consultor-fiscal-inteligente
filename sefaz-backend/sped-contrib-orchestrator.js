// ============================================================================
// sefaz-backend/sped-contrib-orchestrator.js
//
// Coleta dados do Firestore + monta os blocos do SPED Contribuicoes
// (EFD PIS/COFINS).
//
// Reutiliza a mesma logica de coleta do SPED Fiscal, com adaptacoes pro
// leiaute da EFD Contribuicoes (Guia Pratico 1.35, vigente 2026).
// ============================================================================

import admin from 'firebase-admin';
import { buildBloco0Contrib } from './sped-contrib-bloco0.js';
// 🚨 O CONTABILISTA DO 0100 TEM DONO. Este arquivo tinha a SEGUNDA CÓPIA da
// função — sem o e-mail padrão e sem o `codMunIBGE` sequer existir —, e por
// isso o EFD-Contribuições da PWR saiu com o 0100 vazio depois do CRC, que é
// a MESMA recusa que o PVA já tinha dado no EFD ICMS/IPI dela (19/08).
import { getContadorPadrao } from './contador-escrituracao.js';
import {
    buildBlocoA, buildBlocoC_Contrib, buildBlocoD_Contrib,
    buildBlocoF, buildBlocoM, buildBloco1_Contrib, buildBloco9_Contrib,
    filtrarNotasBlocoA, COD_ITEM_SERVICO_GENERICO,
} from './sped-contrib-blocos.js';
import { enrichParticipantesViaBrasilApi } from './brasilapi-cache.js';
import { normalizarParticipantesDoc } from './dipam-produtor-rural.js';
// A receita de aluguel não tem documento — ela entra pelo F550.
import { receitaDeLocacao, receitaDeDocumentosNoPeriodo } from './receita-sem-documento-f550.js';
// Competência da ficha normalizada pela régua EXISTENTE (YYYY-MM · YYYY-MM-DD ·
// MM/YYYY) — igualdade estrita perderia a ficha em silêncio.
import { normalizarCompetencia } from './ipi-varredura.js';
import { direcaoEfetivaDoc } from './xml-metadata-helper.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Coleta os dados necessarios pra montar o SPED Contribuicoes de uma empresa
 * num determinado periodo (mensal).
 *
 * @param {object} args
 * @param {string} args.empresaId
 * @param {string} args.competencia 'YYYY-MM'
 *
 * @returns {Promise<object>}
 */
export async function coletarDadosContribuicoes({ empresaId, competencia }) {
    const db = fa().firestore();

    // ─── 1. Le empresa (tenta simples_empresas, depois lucro_empresas) ───
    let empresaSnap = await db.collection('simples_empresas').doc(empresaId).get();
    let regime = 'simples';
    if (!empresaSnap.exists) {
        empresaSnap = await db.collection('lucro_empresas').doc(empresaId).get();
        regime = 'lucro';
    }
    if (!empresaSnap.exists) {
        const err = new Error(`Empresa ${empresaId} nao encontrada em simples_empresas nem lucro_empresas.`);
        err.code = 'EMPRESA_NAO_ENCONTRADA';
        throw err;
    }
    const empresa = { id: empresaId, ...empresaSnap.data(), _regime: regime };

    // Validacao critica
    if (!empresa.dadosFiscais || !empresa.dadosFiscais.uf || !empresa.dadosFiscais.codMunIBGE) {
        const err = new Error(
            `Empresa "${empresa.nome}" nao tem dadosFiscais cadastrados (UF e codMunIBGE sao obrigatorios). ` +
            `Clique no botao "Dados Fiscais" no header da empresa pra preencher.`
        );
        err.code = 'DADOS_FISCAIS_INCOMPLETOS';
        throw err;
    }

    // ─── 2. Define regime de apuracao PIS/COFINS ───
    const regimeApuracao = determinarRegimeApuracao(empresa);

    // ─── 3. Le documentos_fiscais filtrados ───
    const notasQuery = db.collection('documentos_fiscais')
        .where('empresaId', '==', empresaId)
        .where('competencia', '==', competencia);
    const snap = await notasQuery.get();
    const notas = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // ─── 4. Extrai participantes unicos ───
    const participantesMap = new Map();
    for (const notaCrua of notas) {
        // MESMA régua do bloco A: o documento chega em DUAS formas e ler só a
        // aninhada deixava o 0150 VAZIO — e sem 0150 o COD_PART do A100 aponta
        // para um cadastro que não existe. Foi o arquivo de 17/08 (CLINICA
        // MANTOAN): 37 documentos e nenhum participante.
        const nota = normalizarParticipantesDoc(notaCrua);
        const direcao = nota.direcao;
        const participanteRaw = direcao === 'saida' ? nota.destinatario : nota.emitente;

        if (!participanteRaw) continue;
        const cnpjBruto = participanteRaw.cnpjCpf || participanteRaw.cnpj || participanteRaw.CNPJ || '';
        if (!cnpjBruto) continue;

        const docLimpo = String(cnpjBruto).replace(/\D/g, '');
        if (!docLimpo) continue;
        if (participantesMap.has(docLimpo)) continue;

        let cnpjFinal = '';
        let cpfFinal = '';
        if (docLimpo.length === 14) {
            cnpjFinal = docLimpo;
        } else if (docLimpo.length === 11) {
            cpfFinal = docLimpo;
        } else {
            continue;
        }

        participantesMap.set(docLimpo, {
            codPart: docLimpo,
            nome: participanteRaw.nome || participanteRaw.razaoSocial || participanteRaw.xNome || 'SEM NOME',
            cnpj: cnpjFinal,
            cpf: cpfFinal,
            ie: participanteRaw.ie || participanteRaw.inscricaoEstadual || '',
            codMunIBGE: participanteRaw.codMunIBGE || '',
            logradouro: participanteRaw.logradouro || participanteRaw.endereco || '',
            numero: participanteRaw.numero || '',
            complemento: participanteRaw.complemento || '',
            bairro: participanteRaw.bairro || '',
        });
    }
    const participantes = Array.from(participantesMap.values());

    // Enriquece participantes via BrasilAPI
    try {
        const stats = await enrichParticipantesViaBrasilApi(participantes);
        console.log(`[sped-contrib] BrasilAPI enrich: ${JSON.stringify(stats)}`);
    } catch (err) {
        console.warn(`[sped-contrib] BrasilAPI falhou: ${err.message}`);
    }

    // ─── 5. Extrai itens unicos e unidades ───
    const itensMap = new Map();
    const unidadesMap = new Map();
    for (const nota of notas) {
        for (const item of (nota.itens || [])) {
            const codItem = item.cProd || item.codigo || item.cFiscal || `ITEM-${item.nItem || '?'}`;
            if (!itensMap.has(codItem)) {
                itensMap.set(codItem, {
                    codItem,
                    descricao: item.xProd || item.descricao || codItem,
                    codBarra: item.cEAN && item.cEAN !== 'SEM GTIN' ? item.cEAN : '',
                    unidade: (item.uCom || item.unidade || 'UN').toUpperCase().substring(0, 6),
                    tipo: '00',
                    ncm: item.NCM || item.ncm || '',
                });
            }
            const unidade = (item.uCom || item.unidade || 'UN').toUpperCase().substring(0, 6);
            if (!unidadesMap.has(unidade)) {
                unidadesMap.set(unidade, {
                    codigo: unidade,
                    descricao: descreverUnidade(unidade),
                });
            }
        }
    }
    // Documento de serviço sem itens capturados (NFS-e do portal, que grava
    // `valorTotal` em vez de `itens[]`) vira UM item sintético no A170 — cod
    // `COD_ITEM_SERVICO_GENERICO` — e ele precisa constar do 0200, senão o
    // A170 aponta pra um item que a Tabela de Identificação não cadastrou.
    if (!itensMap.has(COD_ITEM_SERVICO_GENERICO)
        && filtrarNotasBlocoA(notas).some(n => !(n.itens || []).length)) {
        itensMap.set(COD_ITEM_SERVICO_GENERICO, {
            codItem: COD_ITEM_SERVICO_GENERICO,
            descricao: 'Prestação de serviços sem discriminação de itens no documento',
            codBarra: '',
            unidade: 'UN',
            tipo: '00',
            ncm: '',
        });
        if (!unidadesMap.has('UN')) {
            unidadesMap.set('UN', { codigo: 'UN', descricao: descreverUnidade('UN') });
        }
    }

    const itens = Array.from(itensMap.values());
    const unidades = Array.from(unidadesMap.values());

    // ─── 5b. A RECEITA QUE NÃO TEM DOCUMENTO (aluguel) ───
    //
    // 🚨 Paulo, 20/08 (AFFITTARE 1139): *"o faturamento dela é aluguel, então
    // não tem captura de notas, apenas a informação do valor em Locação de Bens
    // na ficha financeira; para efeito de EFD CONTRIBUIÇÕES a informação vai no
    // bloco F550"*. Sem ler a ficha, o arquivo saía com M200/M600 ZERADOS numa
    // empresa que fatura todo mês — declarando à Receita que não há contribuição
    // a pagar. Mesma classe do M200 zerado da MANTOAN.
    //
    // ⚠️ A ficha é EMBUTIDA no documento da empresa (`fichaFinanceira[]`, chave
    // `mesReferencia`) — não existe coleção `lucro_fichas`, e consultá-la
    // devolvia vazio SEMPRE (lição de 19/08, saldo credor de IPI).
    const fichas = Array.isArray(empresa.fichaFinanceira) ? empresa.fichaFinanceira : [];
    // A competência casa NORMALIZADA (régua existente do ipi-varredura):
    // mesReferencia aparece como 'YYYY-MM', 'YYYY-MM-DD' e 'MM/YYYY' conforme a
    // época do lançamento, e igualdade estrita perderia a ficha em silêncio.
    const compNorm = normalizarCompetencia(competencia) || String(competencia || '');
    const fichaDaComp = fichas.find(f => normalizarCompetencia(f?.mesReferencia) === compNorm) || null;
    const receitaSemDocumento = receitaDeLocacao(fichaDaComp);

    // ─── 6. Warnings ───
    const warnings = [];
    if (notas.length === 0 && !receitaSemDocumento) {
        warnings.push(`Empresa "${empresa.nome}" nao tem documentos fiscais no periodo ${competencia}. Arquivo sera gerado com estrutura minima.`);
    }
    // 🚨 PERÍODO SEM RECEITA NENHUMA NÃO PASSA CALADO (21/08, AFFITTARE: o
    // arquivo saiu F001|1 + M200/M600 zerados com a locação lançada na ficha —
    // a régua lia o campo errado e o zero era indistinguível de "não faturou").
    // Documento de ENTRADA não é receita: se só há entradas e a ficha não tem
    // locação, o M200/M600 vai declarar zero — e isso é uma AFIRMAÇÃO à
    // Receita, então sai DITO.
    if (!(receitaSemDocumento > 0)) {
        const doc = receitaDeDocumentosNoPeriodo(notas, direcaoEfetivaDoc);
        if (doc.quantidade === 0) {
            warnings.push(
                'M200/M600 vão declarar ZERO: nenhum documento de SAÍDA no período e nenhuma receita de '
                + 'LOCAÇÃO na ficha financeira desta competência. Se a empresa faturou (ex.: aluguel), lance '
                + 'a ficha do mês ANTES de gerar — é dela que sai o F550.',
            );
        }
    }
    if (receitaSemDocumento > 0) {
        const doc = receitaDeDocumentosNoPeriodo(notas, direcaoEfetivaDoc);
        warnings.push(
            `Receita de LOCAÇÃO da ficha (R$ ${receitaSemDocumento.toFixed(2)}) entrou no F550 — aluguel não `
            + 'gera documento fiscal, e sem isto o M200/M600 sairia ZERADO. O 0110 acompanha: escrituração '
            + 'CONSOLIDADA (IND_REG_CUM 2).',
        );
        if (doc.quantidade > 0) {
            // ⚠️ DUPLA CONTAGEM É O RISCO DESTE CAMINHO, e o app não escolhe:
            // se a locação também virou documento de saída, a contribuição sai
            // declarada duas vezes. Quem decide é quem olha a ficha.
            warnings.push(
                `⚠ O período tem ${doc.quantidade} documento(s) de SAÍDA além da receita de locação da ficha. `
                + 'Se algum deles for da própria locação, a contribuição vai DUPLICADA (uma vez no F550, outra '
                + 'no bloco A/C). Confira antes de transmitir — o app não tem como saber.',
            );
        }
    }
    if (regime === 'simples') {
        warnings.push('Empresas do Simples Nacional geralmente NAO entregam EFD Contribuicoes. Verifique a obrigatoriedade.');
    }

    return {
        empresa,
        contador: getContadorPadrao(),
        competencia,
        competenciaInicio: competencia,
        competenciaFim: competencia,
        regimeApuracao,
        notas,
        itens,
        participantes,
        unidades,
        receitaSemDocumento,
        warnings,
    };
}

/**
 * Monta o arquivo .txt completo do SPED Contribuicoes.
 */
export async function montarBlocosContribuicoes({ dados }) {
    const linhasBloco0 = buildBloco0Contrib(dados);
    const linhasBlocoA = buildBlocoA(dados);
    const linhasBlocoC = buildBlocoC_Contrib(dados);
    const linhasBlocoD = buildBlocoD_Contrib(dados);
    const linhasBlocoF = buildBlocoF(dados);
    const linhasBlocoM = buildBlocoM(dados);
    const linhasBloco1 = buildBloco1_Contrib(dados);

    const linhasAteAqui = [
        ...linhasBloco0,
        ...linhasBlocoA,
        ...linhasBlocoC,
        ...linhasBlocoD,
        ...linhasBlocoF,
        ...linhasBlocoM,
        ...linhasBloco1,
    ];
    const linhasBloco9 = buildBloco9_Contrib(linhasAteAqui);

    const todas = [...linhasAteAqui, ...linhasBloco9];
    return todas.join('');
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Determina regime de apuracao PIS/COFINS:
 *   1 = Nao-cumulativo (Lucro Real)
 *   2 = Cumulativo (Lucro Presumido)
 *   3 = Ambos
 */
function determinarRegimeApuracao(empresa) {
    const df = empresa.dadosFiscais || {};
    if (df.regimeApuracaoPisCofins) {
        return String(df.regimeApuracaoPisCofins);
    }
    const regimeTrib = (df.regimeTributario || empresa.regimeTributario || '').toLowerCase();
    if (regimeTrib.includes('real')) return '1';
    if (regimeTrib.includes('presumido')) return '2';
    if (empresa._regime === 'lucro') return '2';
    return '2';
}

const UNIDADES_PADRAO = {
    'UN': 'UNIDADE', 'KG': 'QUILOGRAMA', 'L': 'LITRO', 'LT': 'LITRO',
    'M': 'METRO', 'M2': 'METRO QUADRADO', 'M3': 'METRO CUBICO',
    'CX': 'CAIXA', 'PC': 'PECA', 'PCT': 'PACOTE', 'PAR': 'PAR',
    'DZ': 'DUZIA', 'TON': 'TONELADA', 'G': 'GRAMA', 'ML': 'MILILITRO',
};

function descreverUnidade(codigo) {
    return UNIDADES_PADRAO[codigo.toUpperCase()] || codigo.toUpperCase();
}

