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
// A TERCEIRA fonte de receita sem documento: aplicação financeira (CF BANK).
import { receitaFinanceiraDaFicha } from './receita-aplicacao-financeira.js';
// RÉGUA ÚNICA da leitura da ficha por competência (YYYY-MM · YYYY-MM-DD ·
// MM/YYYY) — igualdade estrita perderia a ficha em silêncio, e uma segunda
// cópia da normalização é o começo de duas respostas divergentes.
import { acharFichaCompetencia } from './ipi-varredura.js';
import { direcaoEfetivaDoc } from './xml-metadata-helper.js';
// TIPO_ITEM do 0200 — serviço é 09, e o item de serviço não leva NCM. O '00'
// cravado declarava "mercadoria para revenda" até no item sintético da NFS-e.
import {
    tipoItemDoDocumento, TIPO_ITEM_SERVICO, codItemDoItem, unidadeDoItem, descreverUnidade,
    levaC170NoContribuicoes, ehNfce,
} from './sped-selecao-documentos.js';
// O participante do 0150 é o MESMO que o C100/A100 referenciam — dono único.
import { participanteDoDocumento } from './participante-doc-helper.js';

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
    let notas = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // ─── 3b. A RECEITA SEM DOCUMENTO decide o PERFIL — e o perfil decide quem
    //         entra (por isso ela é lida AQUI, antes de coletar participante e
    //         item; a coleta de quem vai sair deixaria 0150/0200 órfãos). ───
    //
    // 🚨 PVA da AFFITTARE 1139 · 07/2026 (21/08, Paulo: *"está puxando a NFS
    // de serviços tomados… tem que ter a opção apenas para o que gera
    // receita"*): com o arquivo CONSOLIDADO (F550 + IND_REG_CUM 2), o A010/
    // A100 do serviço TOMADO volta com *"O registro não deve ser informado
    // para esse perfil e/ou tipo de operação"*. No regime CUMULATIVO o serviço
    // tomado não gera crédito nenhum — tirá-lo não muda um centavo da apuração
    // — e o aceito de 05/2026 da própria empresa tem o bloco A VAZIO.
    // ⚠️ Só o caminho CONSOLIDADO exclui: no detalhado (MANTOAN, IND_REG_CUM
    // 9) o PVA ACEITOU as entradas — mudar arquivo aceito sem recusa que mande
    // é inventar leiaute. E documento de SAÍDA nunca é excluído aqui: se ele
    // convive com o F550, quem avisa é a trava de dupla contagem, abaixo.
    // A competência casa pela RÉGUA ÚNICA (`acharFichaCompetencia`):
    // mesReferencia aparece como 'YYYY-MM', 'YYYY-MM-DD' e 'MM/YYYY' conforme a
    // época do lançamento, e igualdade estrita perderia a ficha em silêncio.
    const fichaDaComp = acharFichaCompetencia(empresa.fichaFinanceira, competencia);
    const receitaSemDocumento = receitaDeLocacao(fichaDaComp);
    // 🚨 Rendimento financeiro NÃO gera documento — e sem ele o arquivo da
    // empresa cuja receita inteira é aplicação (CF BANK 1109) saía com
    // M200/M600 ZERADOS. Alíquota, CST e código de receita são PRÓPRIOS.
    const receitaAplicacaoFinanceira = receitaFinanceiraDaFicha(fichaDaComp);
    // 🚨 O PERFIL DO ARQUIVO SE DECIDE AQUI, e ele decide TRÊS coisas: o
    // IND_REG_CUM do 0110, se o aluguel vai no F550 ou no F100, e se os
    // documentos ficam ou saem.
    //
    // CONSOLIDADO só quando NÃO há documento de receita. A premissa
    // "aluguel ⇒ consolidado" era da AFFITTARE e quebrou na PEC PRONTA
    // ENTREGA (07/2026), que tem serviços prestados E aluguel: o arquivo saiu
    // consolidado declarando A010/A100 e o PVA recusou os seis registros com
    // "O registro não deve ser informado para esse perfil e/ou tipo de
    // operação". O EFD assinado da própria PEC (05/2026) mostra a saída certa:
    // detalhado (9), os cinco A100 de pé, e o aluguel no F100.
    const docsDeReceita = receitaDeDocumentosNoPeriodo(notas, direcaoEfetivaDoc).quantidade;
    const escrituracaoConsolidada = receitaSemDocumento > 0 && docsDeReceita === 0;
    let entradasForaDaConsolidada = 0;
    // ⚠️ A exclusão de ENTRADAS só vale no consolidado — que é o arquivo que
    // não escritura documento NENHUM. No detalhado tirar a entrada seria
    // apagar escrituração legítima.
    if (escrituracaoConsolidada && regimeApuracao === '2') {
        const antes = notas.length;
        notas = notas.filter(n => direcaoEfetivaDoc(n) === 'saida');
        entradasForaDaConsolidada = antes - notas.length;
    }

    // ─── 4. Extrai participantes unicos ───
    const participantesMap = new Map();
    for (const notaCrua of notas) {
        // MESMA régua do bloco A: o documento chega em DUAS formas e ler só a
        // aninhada deixava o 0150 VAZIO — e sem 0150 o COD_PART do A100 aponta
        // para um cadastro que não existe. Foi o arquivo de 17/08 (CLINICA
        // MANTOAN): 37 documentos e nenhum participante.
        const nota = normalizarParticipantesDoc(notaCrua);
        // 🚨 O MESMO DONO QUE O C100 e o A100 usam. Escolher aqui pela direção
        // crua colocaria no 0150 o participante ERRADO da nota própria de
        // entrada (tpNF=0) — e aí o C100 referenciaria um COD_PART que a Tabela
        // de Cadastro do Participante não tem, que é recusa do PVA.
        const participanteRaw = participanteDoDocumento(nota, empresa.cnpj);

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
    //
    // 🚨 SÓ DE QUEM VAI REFERENCIÁ-LOS. O 0200 é a Tabela de Identificação do
    // Item e o 0190 a de Unidades: quem aponta para elas é o C170/A170. Item
    // declarado e referenciado por ninguém é item ÓRFÃO — recusa que a PWR já
    // pagou em 19/08 —, e desde 24/08 a **NFC-e não leva C170** neste arquivo
    // (HYPE CAFE, 572 recusas do PVA). Sem esta linha, corrigir o C170 trocaria
    // 572 recusas por outras tantas de item órfão: na HYPE seriam quatro itens
    // (`10`, `11`, `20`, `101`), que só existem em cupom.
    //
    // ⚠️ Quem responde é o MESMO dono que decide o C170 — duas perguntas
    // ligadas não podem ter duas respostas. Item que também aparece numa nota
    // 55 continua entrando, por ela.
    const itensMap = new Map();
    const unidadesMap = new Map();
    let itensSoEmNfce = 0;
    for (const nota of notas) {
        if (!levaC170NoContribuicoes(nota)) {
            itensSoEmNfce += (nota.itens || []).length;
            continue;
        }
        for (const item of (nota.itens || [])) {
            const codItem = codItemDoItem(item);
            if (!itensMap.has(codItem)) {
                itensMap.set(codItem, {
                    codItem,
                    descricao: item.xProd || item.descricao || codItem,
                    codBarra: item.cEAN && item.cEAN !== 'SEM GTIN' ? item.cEAN : '',
                    unidade: unidadeDoItem(item),
                    tipo: tipoItemDoDocumento(nota),
                    ncm: item.NCM || item.ncm || '',
                });
            }
            const unidade = unidadeDoItem(item);
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
            // Este item EXISTE porque o documento é de SERVIÇO — declará-lo
            // como '00' (mercadoria para revenda) era o documento se
            // desmentindo dentro do próprio arquivo.
            tipo: TIPO_ITEM_SERVICO,
            ncm: '',
        });
        if (!unidadesMap.has('UN')) {
            unidadesMap.set('UN', { codigo: 'UN', descricao: descreverUnidade('UN') });
        }
    }

    const itens = Array.from(itensMap.values());
    const unidades = Array.from(unidadesMap.values());

    // ─── 5b. (A receita sem documento é lida na seção 3b — ela decide o
    //         PERFIL do arquivo e por isso vem antes da coleta.) ───
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

    // ─── 6. Warnings ───
    const warnings = [];
    if (entradasForaDaConsolidada > 0) {
        warnings.push(
            `${entradasForaDaConsolidada} documento(s) de ENTRADA (serviço tomado/aquisição) ficaram FORA da `
            + 'escrituração: o arquivo sai CONSOLIDADO (F550 + IND_REG_CUM 2) e o PVA recusa documento nesse '
            + 'perfil ("O registro não deve ser informado para esse perfil e/ou tipo de operação"). No regime '
            + 'cumulativo o serviço tomado não gera crédito — nada deixa de ser apurado.',
        );
    }
    if (notas.length === 0 && !receitaSemDocumento) {
        warnings.push(`Empresa "${empresa.nome}" nao tem documentos fiscais no periodo ${competencia}. Arquivo sera gerado com estrutura minima.`);
    }
    // 🚨 A CAUSA VAI JUNTO DO NÚMERO. Quem conferir o arquivo vai ver o item do
    // cupom sumido do 0200 e a NFC-e sem detalhe — e sem esta frase vai
    // procurar buraco de captura. A receita continua declarada: ela está no
    // VL_DOC/VL_PIS/VL_COFINS do C100 e no bloco M.
    const nfceNoArquivo = notas.filter(ehNfce).length;
    if (nfceNoArquivo > 0 && itensSoEmNfce > 0) {
        warnings.push(
            `${nfceNoArquivo} NFC-e (modelo 65) foram escrituradas SEM C170, e os ${itensSoEmNfce} item(ns) `
            + 'delas ficaram fora do 0200/0190. É o leiaute: o PVA recusa o C170 de cupom com "O registro não '
            + 'deve ser informado para o modelo de documento do Registro Pai", e item declarado sem ninguém '
            + 'referenciá-lo vira item órfão — a recusa seguinte. A receita das NFC-e continua declarada no '
            + 'C100 (VL_DOC/VL_PIS/VL_COFINS) e no bloco M: nada deixa de ser apurado.',
        );
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
        warnings.push(escrituracaoConsolidada
            ? `Receita de LOCAÇÃO da ficha (R$ ${receitaSemDocumento.toFixed(2)}) entrou no F550 — aluguel não `
              + 'gera documento fiscal, e sem isto o M200/M600 sairia ZERADO. Não há documento de receita no '
              + 'período, então o arquivo é CONSOLIDADO: o 0110 acompanha (IND_REG_CUM 2) e o registro 1900 '
              + 'consolida a receita.'
            : `Receita de LOCAÇÃO da ficha (R$ ${receitaSemDocumento.toFixed(2)}) entrou no **F100** — o período `
              + `também tem ${doc.quantidade} documento(s) de receita, então o arquivo é DETALHADO `
              + '(IND_REG_CUM 9) e os documentos ficam escriturados no bloco A/C. Arquivo consolidado não pode '
              + 'declarar documento: o PVA recusa com "O registro não deve ser informado para esse perfil".');
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
        receitaAplicacaoFinanceira,
        contaContabilReceitaFinanceira: empresa?.dadosFiscais?.contaContabilReceitaFinanceira || '',
        contaContabilReceitaFinanceiraNome: empresa?.dadosFiscais?.contaContabilReceitaFinanceiraNome || '',
        contaContabilReceitaFinanceiraNivel: empresa?.dadosFiscais?.contaContabilReceitaFinanceiraNivel || '',
        escrituracaoConsolidada,
        // 🚨 Havendo F550, o 1900 é OBRIGATÓRIO (recusa do PVA na AFFITTARE
        // 07/2026). COD_MOD e COD_SIT são de TABELA OFICIAL e dependem de qual
        // documento a empresa emite pelo aluguel — vêm do cadastro, nunca de
        // dedução. Gerador que lê campo que ninguém passa foi o defeito do
        // `saldoCredorIpiAnterior` (19/08, PWR): os dois viajam aqui.
        contrib1900CodMod: empresa?.dadosFiscais?.contrib1900CodMod || '',
        contrib1900CodSit: empresa?.dadosFiscais?.contrib1900CodSit || '',
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


