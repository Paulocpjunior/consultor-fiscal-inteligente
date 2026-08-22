// ============================================================================
// sefaz-backend/sped-fiscal-orchestrator.js
//
// Coleta dados do Firestore + monta os blocos do SPED Fiscal EFD ICMS/IPI.
// Blocos implementados: 0 (abertura), B (ISS/RJ — placeholder), C (NFe entrada/saida),
// D (CTe/conhec. transporte), E (apuracao ICMS/IPI), G (CIAP), H (inventario),
// K (producao), 1 (outras informacoes), 9 (encerramento/totais).
// ============================================================================

import admin from 'firebase-admin';
import { buildBloco0 } from './sped-fiscal-bloco0.js';
import { buildBlocoC } from './sped-fiscal-blocoC.js';
import { buildBloco9 } from './sped-fiscal-bloco9.js';
import {
    buildBlocoB,
    buildBlocoG, buildBlocoK, buildBloco1,
} from './sped-fiscal-blocos-vazios.js';
import { buildBlocoD } from './sped-fiscal-blocoD.js';
import { buildBlocoE, somarIcmsPorDirecao, somarImpostoPorDirecao } from './sped-fiscal-blocoE.js';
// 🧮 A cronologia do saldo credor: abertura do SPED ENTREGUE + transporte
// calculado com a MESMA matemática do E110/E520.
import { resolverSaldoAnterior, competenciasEntre } from './saldo-abertura.js';
import { buildBlocoH } from './sped-fiscal-blocoH.js';
import { dataInventario } from './sped-bloco-h.js';
import { apurarCiap, classificarSaidasCiap, montarLinhasBlocoG } from './sped-bloco-g.js';
import * as fmtSped from './sped-fiscal-format.js';
import { classificarAjustes } from './sped-ajustes-apuracao.js';
import { enrichParticipantesViaBrasilApi } from './brasilapi-cache.js';
import { montarDipamCompetencia } from './dipam-produtor-rural.js';
import { carregarProdutoresRurais, lerCondicaoRural, documentosDaContraparte } from './dipam-store.js';
import { varrerCcesDoPeriodo } from './cce-escrituracao.js';
// Régua ÚNICA de quem entra em cada bloco — o 0150 tem que casar com ela,
// senão o PVA acusa participante que nenhum registro referencia.
import {
    selecionarNotasBlocoC, selecionarCtesBlocoD, tipoItemDoDocumento, codItemDoItem,
} from './sped-selecao-documentos.js';
import { getContadorPadrao } from './contador-escrituracao.js';
import { modeloDoDoc, participanteDoDocumento, ehEmissaoPropriaDoc } from './participante-doc-helper.js';
// RÉGUA ÚNICA da leitura da ficha por competência (mesReferencia tem 3 formas).
import { acharFichaCompetencia } from './ipi-varredura.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Coleta os dados necessarios pra montar o SPED Fiscal de uma empresa
 * num determinado periodo.
 *
 * @param {object} args
 * @param {string} args.empresaId
 * @param {string} [args.competencia]       'YYYY-MM' (modo mensal)
 * @param {string} [args.competenciaInicio] 'YYYY-MM' (modo trimestre)
 * @param {string} [args.competenciaFim]    'YYYY-MM' (modo trimestre)
 *
 * @returns {Promise<{
 *   empresa: object,
 *   contador: object,
 *   competenciaInicio: string,
 *   competenciaFim: string,
 *   notas: object[],
 *   itens: object[],
 *   participantes: object[],
 *   unidades: object[],
 *   warnings: string[],
 * }>}
 */
export async function coletarDadosEmpresa({ empresaId, competencia, competenciaInicio, competenciaFim }) {
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

    // Validacao critica: precisa ter dadosFiscais
    if (!empresa.dadosFiscais || !empresa.dadosFiscais.uf || !empresa.dadosFiscais.codMunIBGE) {
        const err = new Error(
            `Empresa "${empresa.nome}" nao tem dadosFiscais cadastrados (UF e codMunIBGE sao obrigatorios). ` +
            `Clique no botao "Dados Fiscais" no header da empresa pra preencher.`
        );
        err.code = 'DADOS_FISCAIS_INCOMPLETOS';
        throw err;
    }

    // ─── 2. Define o range de competencia ───
    const periodoInicio = competenciaInicio || competencia;
    const periodoFim = competenciaFim || competencia;

    // ─── 3. Le documentos_fiscais filtrados por empresaId + competencia ───
    let notasQuery = db.collection('documentos_fiscais')
        .where('empresaId', '==', empresaId);

    // Quando eh mes unico, da pra usar where exato. Quando eh range, le
    // todos do empresa e filtra em memoria (Firestore nao aceita range +
    // outras condicoes facilmente).
    let notas;
    if (periodoInicio === periodoFim) {
        notasQuery = notasQuery.where('competencia', '==', periodoInicio);
        const snap = await notasQuery.get();
        notas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
        const snap = await notasQuery.get();
        notas = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(n => n.competencia >= periodoInicio && n.competencia <= periodoFim);
    }
    // Ignora docs marcados como duplicata (vencedor do merge fica na lista).
    notas = notas.filter(n => !n._merged_into);

    // ─── 4. Extrai participantes unicos (entrada + saida) ───
    //
    // 🚨 SÓ ENTRA QUEM ALGUM REGISTRO REFERENCIA (PVA da PWR e da PS VIDROS,
    // 19/08: *"Não informar participante, se não referenciado em pelo menos um
    // dos demais blocos"*). Duas fontes de participante órfão:
    //
    //   · NFC-e — o C100 dela NÃO PODE ter COD_PART (venda de balcão), então
    //     nenhum consumidor de cupom é referenciado. Declará-lo no 0150 é erro
    //     garantido, e ainda arrasta o "campo obrigatório para contribuintes
    //     domiciliados no Brasil" (o cupom não traz endereço do comprador).
    //   · Nota que NÃO foi escriturada (só o resumo na base, ou sem itens) —
    //     ela sai do bloco C nomeada, e o participante dela vai junto.
    //
    // Mesma régua do 0200 logo abaixo, que já fazia isso pelos itens.
    const nfceOuNaoEscriturada = (() => {
        const escrituradas = new Set(
            selecionarNotasBlocoC(notas)
                .notas.filter(n => modeloDoDoc(n) !== '65')
                .map(n => n.id || n.chave),
        );
        for (const c of selecionarCtesBlocoD(notas)) escrituradas.add(c.id || c.chave);
        return (n) => !escrituradas.has(n.id || n.chave);
    })();
    const participantesMap = new Map();
    let participantesOrfaos = 0;
    for (const nota of notas) {
        if (nfceOuNaoEscriturada(nota)) { participantesOrfaos += 1; continue; }
        // Identifica o "outro lado" da nota (nao a empresa) — RÉGUA ÚNICA com
        // o buildC100 (participanteDoDocumento): o 0150 tem que cadastrar
        // exatamente quem o C100 referencia, senão o PVA acusa COD_PART órfão.
        // Cobre a nota própria de entrada (contraparte no DESTINATÁRIO).
        const participanteRaw = participanteDoDocumento(nota, empresa.cnpj);

        if (!participanteRaw) continue;
        const cnpjBruto = participanteRaw.cnpjCpf || participanteRaw.cnpj || participanteRaw.CNPJ || '';
        if (!cnpjBruto) continue;

        const docLimpo = String(cnpjBruto).replace(/\D/g, '');
        if (!docLimpo) continue;
        if (participantesMap.has(docLimpo)) continue;

        // Detecta PF (CPF 11 digitos) vs PJ (CNPJ 14 digitos) pelo tamanho.
        // Documentos com outros tamanhos sao invalidos — loga e pula.
        let cnpjFinal = '';
        let cpfFinal = '';
        if (docLimpo.length === 14) {
            cnpjFinal = docLimpo;
        } else if (docLimpo.length === 11) {
            cpfFinal = docLimpo;
        } else {
            console.warn(`[sped-fiscal] participante com documento invalido (${docLimpo.length} digitos): ${docLimpo} — pulado`);
            continue;
        }

        // codPart = documento limpo (suficiente como identificador unico)
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

    // ─── 4b. Enriquece participantes legados via BrasilAPI ───
    // Notas processadas pelo parser antigo nao tem codMunIBGE/endereco.
    // BrasilAPI preenche por CNPJ. Parser novo ja extrai do XML.
    try {
        const stats = await enrichParticipantesViaBrasilApi(participantes);
        console.log(`[sped-fiscal] BrasilAPI enrich: ${JSON.stringify(stats)}`);
    } catch (err) {
        console.warn(`[sped-fiscal] BrasilAPI falhou: ${err.message}`);
    }

    // ─── 5. Extrai itens unicos (produtos/servicos) e unidades ───
    // Importante: itens de nota de EMISSÃO PRÓPRIA (IND_EMIT=0) NÃO geram
    // C170 (Guia 3.2.3, Exceção 2) — então não podem aparecer no 0200, senão
    // viram item ÓRFÃO e o PVA recusa. A régua é a MESMA que decide o IND_EMIT
    // e a existência do C170 (`ehEmissaoPropriaDoc`): a nota própria de
    // ENTRADA também é emissão própria, e lê-la pela direção crua deixaria os
    // itens dela no 0200 sem nenhum C170 apontando para eles.
    const itensMap = new Map();
    const unidadesMap = new Map();
    for (const nota of notas) {
        if (ehEmissaoPropriaDoc(nota, empresa.cnpj)) continue;
        for (const item of (nota.itens || [])) {
            const codItem = codItemDoItem(item);
            if (!itensMap.has(codItem)) {
                itensMap.set(codItem, {
                    codItem,
                    descricao: item.xProd || item.descricao || codItem,
                    codBarra: item.cEAN && item.cEAN !== 'SEM GTIN' ? item.cEAN : '',
                    unidade: (item.uCom || item.unidade || 'UN').toUpperCase().substring(0, 6),
                    // TIPO_ITEM pela régua: serviço é '09' (Guia 3.2.3). A
                    // MERCADORIA continua '00' porque a destinação real
                    // (matéria-prima, produto acabado) não está no XML — ver a
                    // pendência nomeada em `tipoItemDoDocumento`.
                    tipo: tipoItemDoDocumento(nota),
                    ncm: item.NCM || item.ncm || '',
                    codGen: '',
                    codLst: '',
                    aliqIcms: '',
                    cest: item.CEST || item.cest || '',
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
    const itens = Array.from(itensMap.values());

    const unidades = Array.from(unidadesMap.values());

    // 0190 deve listar APENAS unidades efetivamente referenciadas em algum
    // 0200 ou C170. Forcar 'UN' quando ninguem usa gera erro no PVA:
    // "Codigo invalido. Informar codigo da unidade de medida (UNID) se
    //  referenciado em pelo menos um dos blocos ou no Registro 0200 ou 0220."

    // ─── 6. Warnings ───
    const warnings = [];
    if (notas.length === 0) {
        warnings.push(`Empresa "${empresa.nome}" nao tem documentos fiscais no periodo. Arquivo sera gerado com estrutura minima (apenas registros 0000-0100 + Bloco 9).`);
    }

    // CARTA DE CORREÇÃO: o livro sai do XML ORIGINAL, e a CC-e pode ter
    // corrigido justamente o CFOP/natureza (Ajuste SINIEF 07/05 14-A §1º) — que
    // manda no C190, no DIFAL e na DIPAM. A CC-e era capturada e NENHUM ponto
    // da escrituração olhava pra ela. O app NÃO aplica a correção (o texto é
    // livre; deduzir o campo seria inventar dado fiscal): ele AVISA.
    try {
        const cce = varrerCcesDoPeriodo(notas);
        for (const aviso of cce.avisos) warnings.push(`Carta de correção: ${aviso}`);
        for (const l of cce.linhas.filter((x) => x.exigeConferencia).slice(0, 20)) {
            warnings.push(
                `CC-e na nota ${l.numero || l.chave}: "${l.texto || '(sem texto)'}" — ${l.motivo}`,
            );
        }
        const restantes = cce.resumo.exigemConferencia - Math.min(20, cce.resumo.exigemConferencia);
        if (restantes > 0) warnings.push(`Carta de correção: +${restantes} outra(s) pedindo conferência.`);
    } catch (err) {
        warnings.push(`Cartas de correção não puderam ser lidas (${err.message}) — confira manualmente se alguma nota do período foi corrigida.`);
    }

    // ─── 6b. Contagem física do inventário (Bloco H) ──────────────────────
    // O inventário NÃO sai das notas: é a contagem que a empresa fez, gravada
    // na aba 📦 Inventário. Sem ela o bloco H sai VAZIO — nunca zerado, que
    // declararia ao Fisco que não havia estoque (correção de 06/08).
    let inventarioMotInv = null;
    try {
        const dtInv = dataInventario(periodoFim);
        if (dtInv) {
            const invSnap = await admin.firestore().collection('sped_inventario')
                .doc(`${empresaId}_${dtInv.replace(/\D/g, '')}`).get();
            if (invSnap.exists) {
                const inv = invSnap.data() || {};
                const porItem = new Map((inv.itens || []).map((i) => [String(i.codItem), i]));
                for (const it of itens) {
                    const c = porItem.get(String(it.codItem));
                    if (!c) continue;
                    it.qtdInventario = c.qtdInventario;
                    it.vlUnitInventario = c.vlUnitInventario;
                    it.indPropInventario = c.indPropInventario || '0';
                    it.codPartInventario = c.codPartInventario || '';
                }
                inventarioMotInv = inv.motInv || null;
                // Contado que NÃO está no 0200 do período: o item existe no
                // estoque mas não teve movimento no mês — sumiria do arquivo em
                // silêncio se ninguém dissesse.
                const foraDo0200 = (inv.itens || []).filter((i) => !itens.some((x) => String(x.codItem) === String(i.codItem)));
                if (foraDo0200.length) {
                    warnings.push(
                        `Inventário: ${foraDo0200.length} item(ns) contado(s) não aparecem nas notas do período `
                        + '(sem movimento no mês) e por isso não entram no 0200/H010. Confira se deveriam estar lá.',
                    );
                }
            }
        }
    } catch (e) {
        // Falhar em LER o inventário não pode virar "não tem inventário".
        warnings.push(`Não consegui ler a contagem do inventário (${e.message}) — o bloco H pode sair incompleto.`);
    }

    // ─── 7. Saldos credores que vêm de trás (E110 c.10 e E520 VL_SD_ANT) ────
    //
    // 🚨 A FICHA NÃO MORA EM COLEÇÃO NENHUMA — ela é EMBUTIDA no documento da
    // empresa, em `fichaFinanceira[]`, com a competência em `mesReferencia`
    // ('AAAA-MM'). Este trecho consultava `db.collection('lucro_fichas')`, que
    // NÃO EXISTE: a query voltava vazia SEMPRE e os dois saldos saíam 0,00,
    // calados. Foi por isso que o E520 da PWR 07/2026 continuou 0,00 depois da
    // correção de 19/08 — o campo passou a ser passado, mas com o valor de uma
    // leitura que nunca achava nada. Consulta que só devolve vazio é
    // indistinguível de "não tem saldo": o defeito da ausência plausível outra
    // vez, agora do lado da leitura.
    //
    // ⚠️ E TRANSPORTAR é o campo do MÊS ANTERIOR: `saldoCredor*Transportar` é o
    // que SOBROU dele (calculado, 18/08 — caso KROYA), enquanto `saldoCredor*`
    // é o que ENTROU. Preferir o "transportar" da anterior corrige a defasagem
    // registrada em 17/08; o outro fica de reserva, carimbado na origem.
    let saldoCredorIcmsAnterior = 0;
    let saldoCredorIpiAnterior = 0;
    let origemSaldoIcms = '';
    let origemSaldoIpi = '';
    let saldoVeioDaAbertura = false;

    // ─── 7-A. A CRONOLOGIA DE VERDADE: abertura carimbada + transporte ──────
    //
    // 🧮 Quando existe um SALDO DE ABERTURA cadastrado (o E110 c.14 / E520 c.7
    // do último SPED ENTREGUE, colado na tela 🧮 do card SPED), ele VENCE a
    // ficha: a ficha é digitada e transporta defasado; a abertura é o número
    // que a própria empresa afirmou à SEFAZ, e daí em diante o transporte é
    // CALCULADO mês a mês com a MESMA matemática do E110 (`saldo-abertura.js`).
    //
    // ⚠️ Falha de leitura NUNCA derruba a geração nem vira zero calado: cai no
    // caminho da ficha, com o motivo no warning.
    if (regime === 'lucro') {
        try {
            const snapAb = await db.collection('sped_saldos_abertura').doc(String(empresaId)).get();
            if (snapAb.exists) {
                const abertura = snapAb.data() || {};
                const mesesCadeia = competenciasEntre(String(abertura.competencia || ''), periodoInicio);
                if (mesesCadeia.length > 12) {
                    // Cadeia longa = N consultas de notas por geração. Não é
                    // recusa técnica, é freio: acima de 1 ano o certo é colar
                    // um SPED entregue mais recente.
                    warnings.push(
                        `🧮 Saldo de abertura de ${abertura.competencia} está a ${mesesCadeia.length} meses desta `
                        + 'competência — cadeia longa demais para calcular a cada geração. Cole na tela 🧮 um SPED '
                        + 'ENTREGUE mais recente. Enquanto isso o saldo anterior sai da FICHA, como antes.',
                    );
                } else {
                    // Movimento de cada mês intermediário: as MESMAS somas do
                    // E110/E520 (somarIcmsPorDirecao / somarImpostoPorDirecao)
                    // sobre as notas daquele mês + os ajustes E111 lançados.
                    const movimentos = {};
                    for (const comp of mesesCadeia) {
                        const [snapNotas, snapAj] = await Promise.all([
                            db.collection('documentos_fiscais')
                                .where('empresaId', '==', empresaId)
                                .where('competencia', '==', comp).get(),
                            db.collection('sped_ajustes_apuracao').doc(`${empresaId}_${comp}`).get(),
                        ]);
                        const notasMes = snapNotas.docs.map((d) => ({ id: d.id, ...d.data() }))
                            .filter((n) => !n._merged_into);
                        const cls = classificarAjustes(
                            snapAj.exists ? (snapAj.data().ajustes || []) : [],
                            (empresa.dadosFiscais?.uf || '').toUpperCase(),
                        );
                        movimentos[comp] = {
                            icms: {
                                debitos: somarIcmsPorDirecao(notasMes, 'saida'),
                                creditos: somarIcmsPorDirecao(notasMes, 'entrada'),
                                cls,
                            },
                            ipi: {
                                debitos: somarImpostoPorDirecao(notasMes, 'saida', 'vIPI', 'vIPI'),
                                creditos: somarImpostoPorDirecao(notasMes, 'entrada', 'vIPI', 'vIPI'),
                            },
                        };
                    }
                    const r = resolverSaldoAnterior({ abertura, competencia: periodoInicio, movimentos });
                    if (r.aplicavel) {
                        saldoCredorIcmsAnterior = r.icms;
                        saldoCredorIpiAnterior = r.ipi;
                        origemSaldoIcms = r.origem;
                        origemSaldoIpi = r.origem;
                        saldoVeioDaAbertura = true;
                        warnings.push(
                            `🧮 Saldo credor anterior pela CRONOLOGIA: ICMS ${r.icms.toFixed(2)} · IPI `
                            + `${r.ipi.toFixed(2)} — origem: ${r.origem}. A ficha NÃO foi usada para este campo.`,
                        );
                    } else {
                        warnings.push(`🧮 Saldo de abertura cadastrado mas NÃO aplicado: ${r.motivo} `
                            + 'O saldo anterior sai da FICHA, como antes.');
                    }
                }
            }
        } catch (err) {
            console.warn(`[sped-fiscal] cronologia do saldo falhou: ${err.message}`);
            warnings.push(
                `🧮 A cronologia do saldo de abertura falhou na leitura (${err.message}) — o saldo anterior `
                + 'sai da FICHA, como antes. Confira antes de transmitir.',
            );
        }
    }

    if (regime === 'lucro' && !saldoVeioDaAbertura) {
        try {
            // RÉGUA ÚNICA da leitura por competência — igualdade estrita
            // perderia a ficha (e com ela o saldo credor) em silêncio.
            const daComp = (comp) => acharFichaCompetencia(empresa.fichaFinanceira, comp);
            const anterior = daComp(computarCompetenciaAnterior(periodoInicio));
            const atual = daComp(periodoInicio);

            const num = (v) => {
                const n = parseFloat(v);
                return Number.isFinite(n) && n > 0 ? n : 0;
            };
            if (num(anterior?.saldoCredorIcmsTransportar)) {
                saldoCredorIcmsAnterior = num(anterior.saldoCredorIcmsTransportar);
                origemSaldoIcms = 'saldo A TRANSPORTAR da ficha da competência anterior';
            } else if (num(anterior?.saldoCredorIcms)) {
                saldoCredorIcmsAnterior = num(anterior.saldoCredorIcms);
                origemSaldoIcms = 'campo "Saldo Credor ICMS (mês anterior)" da ficha da competência ANTERIOR '
                    + '— é o que ENTROU naquele mês, não o que sobrou dele';
            }

            if (num(anterior?.saldoCredorIpiTransportar)) {
                saldoCredorIpiAnterior = num(anterior.saldoCredorIpiTransportar);
                origemSaldoIpi = 'saldo de IPI A TRANSPORTAR da ficha da competência anterior';
            } else if (num(atual?.saldoCredorIpi)) {
                saldoCredorIpiAnterior = num(atual.saldoCredorIpi);
                origemSaldoIpi = 'campo "Cred. IPI do mês anterior (compensado)" da ficha desta competência';
            }
        } catch (err) {
            console.warn(`[sped-fiscal] saldos anteriores falharam: ${err.message}`);
            warnings.push(
                `Não consegui ler os saldos credores da ficha (${err.message}) — o E110 e o E520 saem com `
                + 'saldo anterior 0,00. Confira a ficha antes de transmitir.',
            );
        }
    }

    // ─── 7b. Ajustes da apuração (Registro E111) — lançados na aba do card ──
    // Coleção sped_ajustes_apuracao, doc {empresaId}_{competencia}. No modo
    // trimestral concatena os meses do período. Erro de código NÃO entra
    // calado no arquivo: vira warning e a linha fica de fora (farol honesto).
    let ajustesApuracao = [];
    // Config do DIFAL de aquisição (C197) mora no MESMO doc dos ajustes — é
    // ajuste de documento, não merece coleção própria. Sem o código da tabela
    // 5.3 do estado, o C197 não é gerado (o aviso sai na geração).
    let difalCfg = {};
    // 🚨 E250 — a obrigação do ICMS-ST a recolher, POR UF. O gerador lia
    // `dados.obrigacoesStPorUf` e **ninguém passava** (varredura de 21/08):
    // o E250 nunca saía e o aviso mandava "informe no cadastro", um cadastro
    // que não existia. Mora no MESMO doc dos ajustes, como o código do C197.
    let obrigacoesStPorUf = {};
    if (regime === 'lucro') {
        try {
            const comps = listarCompetenciasPeriodo(periodoInicio, periodoFim);
            const snaps = await Promise.all(
                comps.map((c) => db.collection('sped_ajustes_apuracao').doc(`${empresaId}_${c}`).get()),
            );
            for (const s of snaps) {
                if (s.exists) ajustesApuracao.push(...(s.data().ajustes || []));
                if (s.exists && s.data().difalCodigoAjusteC197) difalCfg = s.data();
                if (s.exists && s.data().obrigacoesStPorUf) {
                    obrigacoesStPorUf = { ...obrigacoesStPorUf, ...s.data().obrigacoesStPorUf };
                }
            }
            const clsPrev = classificarAjustes(ajustesApuracao, (empresa.dadosFiscais?.uf || '').toUpperCase());
            for (const erro of clsPrev.erros) {
                warnings.push(`Ajuste E111 IGNORADO: ${erro}`);
            }
        } catch (err) {
            console.warn(`[sped-fiscal] ajustes E111 falharam: ${err.message}`);
            warnings.push(`Ajustes de apuração (E111) não puderam ser lidos (${err.message}) — o arquivo sai SEM eles. Confira antes de transmitir.`);
            ajustesApuracao = [];
        }
    }

    // ─── 7c. CIAP / Bloco G — crédito de ICMS do ativo permanente ───────────
    // Coleção sped_ciap_bens, doc {empresaId}: os bens ficam no CADASTRO (não
    // na competência) porque atravessam 48 meses — o que muda mês a mês é o
    // número da parcela. Empresa sem bens cadastrados segue com o bloco VAZIO,
    // que é o caso da maioria (só a EXPERTE tem CIAP hoje).
    let ciap = null;
    if (regime === 'lucro') {
        try {
            const snap = await db.collection('sped_ciap_bens').doc(String(empresaId)).get();
            const bens = snap.exists ? (snap.data().bens || []) : [];
            if (bens.length > 0) {
                const cfg = snap.data() || {};
                // As saídas saem das MESMAS notas do arquivo; se a equipe
                // informar os valores à mão no cadastro, o informado vence
                // (fecha com o controle próprio do cliente).
                const derivadas = classificarSaidasCiap(notas);
                ciap = apurarCiap({
                    bens,
                    saldoInicial: cfg.saldoInicial || 0,
                    saidasTributadas: cfg.saidasTributadasManual ?? derivadas.tributadasEExportacao,
                    saidasTotais: cfg.saidasTotaisManual ?? derivadas.total,
                    outrosCreditos: cfg.outrosCreditos || 0,
                });
                for (const aviso of ciap.avisos) warnings.push(`CIAP (Bloco G): ${aviso}`);
            }
        } catch (err) {
            console.warn(`[sped-fiscal] CIAP falhou: ${err.message}`);
            warnings.push(`CIAP (Bloco G) não pôde ser lido (${err.message}) — o arquivo sai com o bloco VAZIO. Confira antes de transmitir.`);
            ciap = null;
        }
    }

    // ─── 8. DIPAM (Registro 1400) — compras de produtor rural paulista ──────
    // O Manual da DIPAM 2026 (pág. 29) manda informar o valor MENSAL por
    // município de origem no Registro 1400. Sem isso o município perde a fatia
    // do IPM e a empresa fica sujeita à multa do art. 527, VII do RICMS/SP.
    let dipam = null;
    try {
        const fornecedores = await carregarProdutoresRurais(documentosDaContraparte(notas));
        dipam = montarDipamCompetencia({
            documentos: notas,
            competencia: periodoInicio,
            empresa: lerCondicaoRural(empresa),
            fornecedores,
        });
        if (dipam.pendencias.length > 0) {
            // Pendência de DIPAM não pode passar em silêncio: o arquivo sai
            // com valor a MENOS e ninguém percebe até a SEFAZ cruzar as NF-e.
            warnings.push(
                `DIPAM: ${dipam.pendencias.length} ponto(s) a resolver antes de entregar `
                + `(veja em XMLs → 🌾 DIPAM / Produtor rural). ${dipam.pendencias[0].mensagem}`,
            );
        }
    } catch (err) {
        console.warn(`[sped-fiscal] DIPAM falhou: ${err.message}`);
        warnings.push(`DIPAM não pôde ser apurada (${err.message}) — o Registro 1400 sai vazio. Confira antes de transmitir.`);
    }

    return {
        empresa,
        contador: getContadorPadrao(),
        competenciaInicio: periodoInicio,
        competenciaFim: periodoFim,
        notas,
        itens,
        // MOT_INV vem do doc do inventário (a pessoa escolhe ao contar); o
        // cadastro da empresa fica de reserva pra quem já usava.
        inventarioMotInv,
        participantes,
        unidades,
        saldoCredorIcmsAnterior,
        saldoCredorIpiAnterior,
        origemSaldoIcms,
        origemSaldoIpi,
        ajustesApuracao,
        difalCodigoAjusteC197: difalCfg.difalCodigoAjusteC197 || '',
        obrigacoesStPorUf,
        difalCodObservacao: difalCfg.difalCodObservacao || '',
        difalAliqInternaPadrao: difalCfg.difalAliqInternaPadrao || 18,
        difalAliqInternaPorChave: difalCfg.difalAliqInternaPorChave || {},
        ciap,
        dipam,
        warnings,
    };
}

/**
 * Monta o arquivo .txt completo do SPED Fiscal a partir dos dados coletados.
 *
 * Fase 1: Bloco 0 + Bloco 9.
 *
 * @returns {Promise<string>} arquivo .txt em encoding Windows-1252.
 */
export async function montarBlocos({ dados }) {
    const linhasBloco0 = buildBloco0(dados);
    const linhasBlocoB = buildBlocoB();   // vazio
    const linhasBlocoC = buildBlocoC(dados);
    const linhasBlocoD = buildBlocoD(dados);  // CTe modelo 57
    const linhasBlocoE = buildBlocoE(dados);  // ICMS (E100/E110/E116) + IPI (E200/E210 se houver)
    // Bloco G — CIAP real quando a empresa tem bens cadastrados; senão, vazio.
    const linhasBlocoG = dados.ciap
        ? montarLinhasBlocoG({
            apuracao: dados.ciap,
            dtIni: fmtSped.formatCompetenciaInicio(dados.competenciaInicio),
            dtFin: fmtSped.formatCompetenciaFim(dados.competenciaFim),
        })
        : buildBlocoG();
    const linhasBlocoH = buildBlocoH(dados);   // inventario (Bloco H real)
    const linhasBlocoK = buildBlocoK();   // vazio
    // Bloco 1 traz o Registro 1400 (DIPAM por município) quando houver compra
    // de produtor rural paulista — e só aí o 1010 liga o IND_VA.
    const linhasBloco1 = buildBloco1(dados.dipam?.dipam?.registro1400 || []);

    // Bloco 9 precisa contar registros de TODOS os blocos anteriores.
    // Ordem oficial: 0 -> B -> C -> D -> E -> G -> H -> K -> 1 -> 9
    const linhasAteAqui = [
        ...linhasBloco0,
        ...linhasBlocoB,
        ...linhasBlocoC,
        ...linhasBlocoD,
        ...linhasBlocoE,
        ...linhasBlocoG,
        ...linhasBlocoH,
        ...linhasBlocoK,
        ...linhasBloco1,
    ];
    const linhasBloco9 = buildBloco9(linhasAteAqui);

    const todas = [...linhasAteAqui, ...linhasBloco9];
    return todas.join('');
}

// ─── Helpers ────────────────────────────────────────────────────────────

const UNIDADES_PADRAO = {
    'UN': 'UNIDADE',
    'KG': 'QUILOGRAMA',
    'L': 'LITRO',
    'LT': 'LITRO',
    'M': 'METRO',
    'M2': 'METRO QUADRADO',
    'M3': 'METRO CUBICO',
    'CX': 'CAIXA',
    'PC': 'PECA',
    'PCT': 'PACOTE',
    'PAR': 'PAR',
    'DZ': 'DUZIA',
    'TON': 'TONELADA',
    'G': 'GRAMA',
    'ML': 'MILILITRO',
    'CM': 'CENTIMETRO',
};

function descreverUnidade(codigo) {
    return UNIDADES_PADRAO[codigo.toUpperCase()] || codigo.toUpperCase();
}


/**
 * Computa competencia YYYY-MM do mes anterior.
 * Ex: '2026-01' -> '2025-12'. Ex: '2026-04' -> '2026-03'.
 */
function computarCompetenciaAnterior(competenciaYYYYMM) {
    const m = (competenciaYYYYMM || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    let ano = parseInt(m[1], 10);
    let mes = parseInt(m[2], 10);
    mes -= 1;
    if (mes === 0) { mes = 12; ano -= 1; }
    return `${ano}-${String(mes).padStart(2, '0')}`;
}

/** Lista as competências YYYY-MM de inicio a fim (inclusive). */
function listarCompetenciasPeriodo(inicio, fim) {
    const out = [];
    let atual = inicio;
    for (let i = 0; i < 12 && atual && atual <= fim; i++) {
        out.push(atual);
        const m = atual.match(/^(\d{4})-(\d{2})$/);
        if (!m) break;
        let ano = parseInt(m[1], 10);
        let mes = parseInt(m[2], 10) + 1;
        if (mes > 12) { mes = 1; ano += 1; }
        atual = `${ano}-${String(mes).padStart(2, '0')}`;
    }
    return out;
}

