// ============================================================================
// sefaz-backend/rotina-fiscal.js  (PURO — sem io, testável)
// ----------------------------------------------------------------------------
// A ROTINA MENSAL do departamento fiscal, em ordem (Paulo, 28/07/2026: "o
// colaborador não está seguindo uma linha de processo"):
//
//   1. CAPTURAR as notas do cliente no período
//   2. VALIDAR o que entrou (resumo sem completa, sem valor, cancelada)
//   3. APURAR o imposto (ficha/histórico da competência)
//   4. ENTREGAR as obrigações (DCTFWeb, SPED, FGTS…)
//   5. EMITIR e ENVIAR a guia (com o rito #293: SharePoint, gestor, baixa)
//
// O app já tinha TODAS as telas — o que faltava era a LINHA: onde este cliente
// está, o que falta e onde se resolve. Cada etapa é derivada de dado real
// (documentos, apuração, tarefas, envios). Nada aqui "marca como feito" na
// mão: se a etapa não tem prova, ela não está concluída.
//
// Farol honesto: etapa seguinte NUNCA fica verde por si. O `proximoPasso` é
// sempre a PRIMEIRA etapa não fechada na ordem — é isso que dá a linha.
// ============================================================================

import { classificarUrgencia, diasAteVencimento, urgenciaDominante, URGENCIA_LABEL } from './urgencia-vencimento.js';
import { docCancelado } from './xml-metadata-helper.js';
import { varrerCcesDoPeriodo } from './cce-escrituracao.js';
import { conferirFichaContraDocumentos } from './ficha-x-documentos.js';
import { acharFichaCompetencia } from './ipi-varredura.js';

export const ETAPAS_ROTINA = [
    { id: 'captura',    ordem: 1, nome: 'Capturar notas',        onde: 'Central de XMLs → Captura' },
    { id: 'validacao',  ordem: 2, nome: 'Validar as notas',      onde: 'Central de XMLs → XMLs (Entrada/Saída)' },
    { id: 'apuracao',   ordem: 3, nome: 'Apurar impostos',       onde: 'Simples Nacional / Lucro Presumido' },
    { id: 'obrigacoes', ordem: 4, nome: 'Entregar obrigações',   onde: 'Vencimentos e Obrigações' },
    { id: 'guias',      ordem: 5, nome: 'Emitir e enviar guias', onde: 'Vencimentos e Obrigações → Envios (rito)' },
];

/**
 * Status de etapa:
 *   'pendente'  — falta fazer (vermelho, trava a linha)
 *   'atencao'   — feito pela metade / com ressalva (âmbar, trava a linha)
 *   'concluida' — tem prova de que fechou
 *   'na'        — não se aplica a este cliente/mês (não trava)
 */
const FECHADAS = new Set(['concluida', 'na']);

const etapa = (id, status, resumo, acao = null, extra = {}) => {
    const base = ETAPAS_ROTINA.find((e) => e.id === id);
    return { ...base, status, resumo, acao, ...extra };
};

// Cancelamento é decidido pela régua da LEITURA (status OU cStat OU evento
// 110111) — o campo cru mente quando o cancelamento chega por evento, que é
// como ele chega. Denegado/inutilizado ficam aqui porque são outros estados,
// não cancelamento.
const cancelado = (d) => docCancelado(d)
    || d?.status === 'denegado' || d?.status === 'inutilizado';

// Resumo (resNFe) x completa — MESMA regra do importer (decidirGravacaoNFe):
// modelos 57/58 nunca têm itens, então `temItens === false` só significa
// "resumo" pra 55/65. Sem isso toda CTe capturada viraria pendência falsa.
const modeloComItens = (chave) => {
    const m = String(chave || '').slice(20, 22);
    return m === '55' || m === '65';
};

export function ehResumoSemCompleta(d) {
    if (!d || cancelado(d)) return false;
    if (/^res(NFe|NFCe|CTe|MDFe)/.test(String(d.schema || ''))) return true;
    if (/^res/.test(String(d.tipoDoc || ''))) return true;
    if (d.temItens === false && modeloComItens(d.chave)) return true;
    return d.valorTotal == null;
}

/**
 * Prova de APURAÇÃO da competência, lida do próprio doc da empresa.
 *
 * Cada regime guarda de um jeito (e é assim que o app já grava hoje):
 *   Lucro   → `fichaFinanceira[]`, uma ficha por mesReferencia 'AAAA-MM', com
 *             o totalImpostos calculado;
 *   Simples → o faturamento lançado do mês (`faturamentoManual['AAAA-MM']` ou
 *             `faturamentoMensalDetalhado['MM-AAAA']`). O histórico de cálculo
 *             NÃO serve de prova: `saveHistoricoCalculo` não é chamado por
 *             nenhuma tela — quem lança o faturamento é quem apura.
 *
 * @returns {null | {fonte: string, totalImpostos: number|null, receita: number|null}}
 */
export function acharApuracaoDaCompetencia(empresa, competencia) {
    if (!empresa || !/^\d{4}-\d{2}$/.test(String(competencia || ''))) return null;
    const [ano, mes] = String(competencia).split('-');

    // RÉGUA ÚNICA (`acharFichaCompetencia`): `mesReferencia` aparece em
    // 'YYYY-MM', 'YYYY-MM-DD' e 'MM/YYYY' conforme a época do lançamento —
    // igualdade estrita faz a Rotina do Mês dizer "sem apuração" com a ficha
    // lançada, que é o zero silencioso de sempre (caso F550, 21/08).
    const ficha = acharFichaCompetencia(empresa.fichaFinanceira, competencia);
    if (ficha) {
        return {
            fonte: 'lucro',
            totalImpostos: Number.isFinite(Number(ficha.totalImpostos)) ? Number(ficha.totalImpostos) : null,
            receita: Number.isFinite(Number(ficha.faturamentoMesTotal)) ? Number(ficha.faturamentoMesTotal) : null,
        };
    }

    const manual = empresa.faturamentoManual || {};
    if (Object.prototype.hasOwnProperty.call(manual, competencia)) {
        const receita = Number(manual[competencia]) || 0;
        // Receita zero no mês = sem DAS a pagar (a declaração sem movimento
        // continua sendo obrigação, e ela vive na etapa 4).
        return { fonte: 'simples', totalImpostos: receita === 0 ? 0 : null, receita };
    }

    const detalhado = empresa.faturamentoMensalDetalhado || {};
    const chaveDetalhada = `${mes}-${ano}`; // o Simples grava 'MM-AAAA' aqui
    if (Object.prototype.hasOwnProperty.call(detalhado, chaveDetalhada)) {
        return { fonte: 'simples-detalhado', totalImpostos: null, receita: null };
    }
    return null;
}

/**
 * Monta a rotina de UMA empresa numa competência.
 *
 * @param {object} p
 * @param {object}  p.empresa      { id, nome, cnpj, regime }
 * @param {string}  p.competencia  'AAAA-MM'
 * @param {Array}   p.documentos   docs da competência (entrada e saída)
 * @param {object}  p.apuracao     ficha/histórico da competência (null se não há)
 * @param {Array}   p.tarefas      tarefas (obrigações) da competência
 * @param {Array}   p.envios       registros de impostos_enviados da competência
 * @param {boolean} [p.capturaAtiva] a empresa está elegível à captura automática
 * @param {object}  [p.dipam]        { produtores, indefinidos } — compras de
 *   produtor rural detectadas no mês. Entra na etapa de OBRIGAÇÕES porque é lá
 *   que a DIPAM é entregue (ficha da GIA + Registro 1400 da EFD).
 * @param {object} [p.cobertura]   `gerarObrigacoesDoRegime(regime, competencia)` —
 *   o próprio catálogo dizendo se cobre este cliente (trava T1 do escopo).
 * @param {object} [p.iss]         ISS de SP capital daquela empresa, vindo do
 *   MESMO núcleo do painel 🏛️ ISS SP (montarPainelIssCarteira). Ver
 *   `aplicarIssNaRotina` logo abaixo.
 */
export function montarRotinaFiscal({
    empresa, competencia, documentos = [], apuracao = null, tarefas = [], envios = [], capturaAtiva = true,
    dipam = null, iss = null, cobertura = null, agoraMs = Date.now(),
    // 🚨 A empresa captura por certificado **A3** — pelo agente local
    // `cfi-a3`, que o cron em nuvem não alcança. São **202 das 404** da
    // carteira (painel de captura, 23/08), então mandar essa metade "rodar a
    // captura e conferir o Diagnóstico" é mandar procurar defeito onde não há.
    // Muda a CAUSA e a primeira parada; a etapa continua acendendo igual.
    capturaPorAgenteLocal = false,
}) {
    const docs = documentos || [];
    const entradas = docs.filter((d) => d.direcao === 'entrada').length;
    const saidas = docs.filter((d) => d.direcao === 'saida').length;

    // ── 1. CAPTURA ──────────────────────────────────────────────────────────
    let eCaptura;
    if (docs.length === 0) {
        eCaptura = etapa('captura', 'pendente',
            capturaPorAgenteLocal
                ? 'Nenhuma nota capturada nesta competência — e esta empresa captura por certificado A3.'
                : 'Nenhuma nota capturada nesta competência.',
            capturaPorAgenteLocal
                ? 'Ela é capturada pelo agente local cfi-a3, que o cron em nuvem não alcança: confira se o '
                  + 'agente rodou nesta competência (📋 Status por Empresa) antes de procurar outro bloqueio.'
                : (capturaAtiva
                    ? 'Rode a captura do cliente e confira o Diagnóstico — pode ser certificado, procuração ou município sem trilho.'
                    : 'A empresa não está elegível à captura automática — confira o cadastro em Status por Empresa.'),
            { entradas, saidas, total: 0, capturaPorAgenteLocal });
    } else if (saidas === 0) {
        // Saída não vem pela SEFAZ (Rejeição 641): depende do cofre/autXML.
        eCaptura = etapa('captura', 'atencao',
            `${entradas} entrada(s) capturada(s), nenhuma nota de SAÍDA.`,
            'Saída mod 55 só chega pelo cofre de e-mail ou pelo autXML. Confira a ligação do cliente na Cobertura de Saída.',
            { entradas, saidas, total: docs.length });
    } else {
        eCaptura = etapa('captura', 'concluida', `${entradas} entrada(s) e ${saidas} saída(s).`, null,
            { entradas, saidas, total: docs.length });
    }

    // ── 2. VALIDAÇÃO ────────────────────────────────────────────────────────
    // Resumo sem a completa não tem valor nem itens: entra na apuração a menor.
    const resumos = docs.filter(ehResumoSemCompleta).length;
    const canceladas = docs.filter(cancelado).length;
    // CARTA DE CORREÇÃO é validação: ela pode ter mudado o CFOP/natureza, e o
    // livro é gerado do XML ORIGINAL. Estava sendo capturada e ninguém via.
    const cce = varrerCcesDoPeriodo(docs).resumo;
    let eValidacao;
    if (docs.length === 0) {
        eValidacao = etapa('validacao', 'pendente', 'Sem notas para validar.',
            'Conclua a captura primeiro — a validação vem depois.', { resumos: 0, canceladas: 0, cce });
    } else if (resumos > 0) {
        eValidacao = etapa('validacao', 'atencao',
            `${resumos} nota(s) sem valor/itens (resumo da SEFAZ, aguardando a completa).`,
            'Manifeste a ciência (libera o XML completo) ou importe o arquivo do cliente. Sem isso a apuração sai a menor.',
            { resumos, canceladas, cce });
    } else {
        eValidacao = etapa('validacao', 'concluida',
            `${docs.length} nota(s) com valor${canceladas ? ` · ${canceladas} cancelada(s) fora do cálculo` : ''}.`,
            null, { resumos, canceladas, cce });
    }

    // CC-e que pede conferência trava a validação: o livro sai do XML ORIGINAL,
    // e a correção pode ser justamente do CFOP. Âmbar e não vermelho — o app
    // não aplica a correção sozinho (texto livre), então quem fecha é a pessoa.
    if (cce.exigemConferencia > 0 && docs.length > 0) {
        eValidacao = piorar(eValidacao,
            `${cce.exigemConferencia} carta(s) de correção a conferir`
            + `${cce.indevidaSuspeita ? ` (${cce.indevidaSuspeita} mencionam algo que a CC-e não pode corrigir)` : ''}.`,
            'A CC-e pode ter mudado CFOP/natureza e o livro sai do XML ORIGINAL — abra a nota e confira antes de apurar.');
    }

    // ── 3. APURAÇÃO ─────────────────────────────────────────────────────────
    let eApuracao = apuracao
        ? etapa('apuracao', 'concluida',
            `Apuração registrada${apuracao.totalImpostos != null ? ` · ${fmtBRL(apuracao.totalImpostos)}` : ''}.`,
            null, { totalImpostos: apuracao.totalImpostos ?? null, fonte: apuracao.fonte || null })
        : etapa('apuracao', 'pendente', 'Sem apuração para esta competência.',
            'Abra a ficha do cliente (Simples ou Lucro) e feche o cálculo do mês.');

    // 🚨 APURAÇÃO COM VALOR E ZERO DOCUMENTO É NÚMERO SEM LASTRO.
    //
    // Isto fechava VERDE só por existir ficha — com a etapa de CAPTURA logo
    // acima dizendo "nenhuma nota capturada". Duas leituras do MESMO mês
    // discordando na MESMA tela, e a de baixo era a que virava "mês fechado".
    // É o caso EXPERTE 06/2026 generalizado: a ficha e a escrituração são
    // trilhos independentes, e ninguém cruzava os dois (Paulo: *"a empresa teve
    // IPI, geramos o imposto e relatório: como não houve captura de XML?"*).
    //
    // ÂMBAR, não vermelho: o número pode estar certíssimo — a ficha é digitada
    // de propósito e há cliente cuja escrituração ainda não migrou. O que não
    // pode é passar por CONCLUÍDO sem ninguém ver. E âmbar já impede o "mês
    // fechado", que é o que decide se alguém pode parar de olhar.
    //
    // A régua é a MESMA do farol da Varredura de IPI (ficha-x-documentos.js):
    // valor zerado não fala (é "sem movimento", outro assunto, outra ação) e
    // contagem indisponível não vira zero.
    if (apuracao) {
        // No Lucro o número da ficha é o IMPOSTO; no Simples o que a pessoa
        // lança é a RECEITA (o `totalImpostos` fica null porque o DAS ainda
        // não foi calculado). Os dois são "número digitado que precisa de
        // documento por trás" — usar só o imposto deixaria justamente o
        // Simples, que é a maior parte da carteira, sem farol nenhum.
        // `Number(null)` é 0 e `isFinite(0)` é true — sem o `!= null` o Simples
        // (que grava totalImpostos null) cairia no ramo do imposto e nunca
        // acenderia. Pego pelo teste do próprio caso.
        const temImposto = apuracao.totalImpostos != null && Number.isFinite(Number(apuracao.totalImpostos));
        const lastro = conferirFichaContraDocumentos({
            valorApurado: temImposto ? apuracao.totalImpostos : apuracao.receita,
            documentos: docs.length,
            rotulo: temImposto ? 'Imposto apurado' : 'Receita lançada',
            capturaPorAgenteLocal,
        });
        // ⚠️ AS DUAS situações de ausência acendem. A do A3 (`-agente-local`)
        // só muda a CAUSA e a primeira parada — deixá-la de fora silenciaria
        // 202 das 404 empresas da carteira, e a Rotina voltaria a dar a
        // competência por fechada sem lastro.
        if (lastro.situacao === 'sem-documento' || lastro.situacao === 'sem-documento-agente-local') {
            eApuracao = piorar(eApuracao, lastro.mensagem, lastro.acao);
        }
        eApuracao.lastro = lastro;
    }

    // ── 4. OBRIGAÇÕES ───────────────────────────────────────────────────────
    const concluidas = tarefas.filter((t) => t.status === 'concluida').length;
    const abertas = tarefas.filter((t) => t.status !== 'concluida' && t.status !== 'cancelada');
    // PRAZO das que estão abertas. A rotina já lia as tarefas e jogava a DATA
    // fora — só contava quantas. Sem prazo, "2/5 entregues" não diz se sobra
    // uma semana ou se venceu ontem, e é justamente o prazo que decide por
    // onde o colaborador começa o dia.
    const prazos = abertas.map((t) => {
        const dias = diasAteVencimento(t.vencimento, agoraMs);
        return {
            obrigacao: t.obrigacao || t.titulo || '—',
            vencimento: t.vencimento || null,
            dias,
            // Sem data legível NÃO vira 'futura' silenciosa: fica nulo e o
            // painel mostra "sem data" (ausente ≠ no prazo).
            urgencia: dias === null ? null : classificarUrgencia(dias),
        };
    });
    const comData = prazos.filter((p) => p.urgencia);
    const semData = prazos.length - comData.length;
    const dominante = urgenciaDominante(comData.map((p) => p.urgencia));
    const proximo = dominante
        ? comData.filter((p) => p.urgencia === dominante).sort((a, b) => a.dias - b.dias)[0]
        : null;
    const atrasadas = comData.filter((p) => p.urgencia === 'atrasada').length;
    let eObrigacoes;
    if (tarefas.length === 0) {
        // Sem tarefa NÃO é "tudo certo" — é sinal de que o cron mensal não gerou.
        eObrigacoes = etapa('obrigacoes', 'atencao',
            'Nenhuma obrigação cadastrada nesta competência.',
            'As tarefas do mês não foram geradas. Rode a geração mensal em Vencimentos e Obrigações antes de dar qualquer coisa por entregue.',
            { concluidas: 0, total: 0, prazo: null, atrasadas: 0, semData: 0 });
    } else if (abertas.length > 0) {
        // ATRASADA é vermelho e vem no resumo, não escondida na lista: é a
        // única faixa em que o prazo já foi perdido.
        const selo = atrasadas > 0
            ? ` · ${atrasadas} ATRASADA(S)`
            : (proximo ? ` · próxima ${URGENCIA_LABEL[proximo.urgencia]} (${proximo.obrigacao})` : '');
        eObrigacoes = etapa('obrigacoes', 'pendente',
            `${concluidas}/${tarefas.length} obrigação(ões) entregue(s)${selo}.`,
            `Falta: ${abertas.map((t) => t.obrigacao || t.titulo || '—').join(', ')}.`,
            {
                concluidas, total: tarefas.length,
                abertas: abertas.map((t) => t.obrigacao || t.titulo || '—'),
                prazo: proximo ? { ...proximo, dominante } : null,
                atrasadas, semData,
            });
    } else {
        eObrigacoes = etapa('obrigacoes', 'concluida', `${tarefas.length} obrigação(ões) entregue(s).`, null,
            { concluidas, total: tarefas.length, abertas: [], prazo: null, atrasadas: 0, semData: 0 });
    }

    // 🚨 TRAVA T1 DO ESCOPO: O CATÁLOGO ADMITE QUE NÃO COBRE ESTE CLIENTE.
    //
    // `gerarObrigacoesDoRegime` já devolve `coberturaIncompleta` desde 11/08,
    // com o comentário dizendo "a etapa 4 não pode dar verde nesse caso" — e
    // NINGUÉM lia a flag. A trava estava escrita e não aplicada: regra escrita
    // sem trava é regra que envelhece em silêncio, igual ao selo das Novidades.
    //
    // O que ela cobre são os dois casos em que o app SABE que está incompleto:
    //  · regime INDEFINIDO — `lucro_empresas` sem `regimePadrao`, que recebe só
    //    o comum aos dois regimes (adivinhar regime é adivinhar imposto);
    //  · obrigação PROPOSTA — existe, mas depende de informação que o app não
    //    tem. Hoje: o ISS (calendário do MUNICÍPIO, e não existe "dia do ISS"
    //    nacional — carimbar o de SP seria inventar prazo) e o INSS patronal
    //    (depende da folha). São 157 empresas de serviço puro na carteira.
    //
    // Sem isto, a cadeia era: obrigação não vira tarefa ⇒ não aparece em
    // Vencimentos ⇒ não aparece no Guia do mês ⇒ o farol diz "mês fechado" com
    // obrigação que nunca foi listada. Âmbar, porque o que falta não é entrega:
    // é o app admitindo que não sabe o prazo — e quem entrega é a pessoa.
    if (cobertura?.coberturaIncompleta) {
        const props = (cobertura.propostas || [])
            .map((r) => `${r.label || r.obrigacao}${r.dependeDe ? ` (depende de ${r.dependeDe})` : ''}`);
        const indefinido = cobertura.regime === 'INDEFINIDO';
        // As DUAS causas podem valer ao mesmo tempo, e elas têm ações
        // DIFERENTES — regime indefinido se resolve na ficha, obrigação
        // proposta se entrega por fora. Fundir numa frase só repetiria o erro
        // do "sem movimento" sem causa.
        const resumos = [];
        const acoes = [];
        // PRAZO DE OUTRA UF é a causa mais perigosa das três: a data ESTÁ na
        // tela, parece certa, e é de outro estado. Vem primeiro.
        const outraUf = cobertura.prazoDeOutraUf || [];
        const semUf = cobertura.prazoSemUfDoCliente || [];
        if (outraUf.length) {
            resumos.push(`${outraUf.length} obrigação(ões) com prazo cadastrado de OUTRA UF: `
                + outraUf.map((r) => `${r.label || r.obrigacao} (${r.abrangencia})`).join(', '));
            acoes.push('A data que aparece é a de SP — confira na SEFAZ do estado do cliente antes de entregar.');
        }
        if (semUf.length) {
            resumos.push('a UF do cliente não está cadastrada, então o prazo estadual não é confiável');
            acoes.push('Preencha a UF nos Dados Fiscais — é ela que decide qual calendário estadual vale.');
        }
        if (indefinido) {
            resumos.push('regime INDEFINIDO — o catálogo entregou só o que é comum aos dois regimes do Lucro');
            acoes.push('Defina o Regime padrão (Presumido ou Real) na ficha do cliente no card Lucro.');
        }
        if (props.length) {
            resumos.push(`o catálogo NÃO cobre ${props.length} obrigação(ões) deste regime: ${props.join(', ')}`);
            acoes.push('Estas NÃO viram tarefa automática: confira e entregue por fora, e não dê o mês por fechado por causa da lista.');
        }
        eObrigacoes = piorar(eObrigacoes, resumos.join(' · '), acoes.join(' '));
        eObrigacoes.coberturaIncompleta = true;
        eObrigacoes.regimeIndefinido = indefinido;
        eObrigacoes.propostas = props;
        eObrigacoes.prazoDeOutraUf = outraUf.map((r) => r.label || r.obrigacao);
    }

    // DIPAM: a compra de produtor rural entra na GIA e no Registro 1400 da EFD
    // — ou seja, é entrega de obrigação. Fornecedor não confirmado NÃO deixa a
    // etapa fechar: o arquivo sairia com valor a menos e ninguém veria.
    const dipamProdutores = Number(dipam?.produtores || 0);
    const dipamIndefinidos = Number(dipam?.indefinidos || 0);
    if (dipamProdutores > 0 || dipamIndefinidos > 0) {
        const acaoDipam = 'Abra XMLs → 🌾 DIPAM / Produtor rural: confirme os fornecedores e leve o Registro 1400 para a GIA/EFD.';
        if (dipamIndefinidos > 0) {
            eObrigacoes = etapa('obrigacoes', 'atencao',
                `${eObrigacoes.resumo} · DIPAM: ${dipamIndefinidos} fornecedor(es) a confirmar.`,
                acaoDipam,
                {
                    concluidas: eObrigacoes.concluidas, total: eObrigacoes.total, abertas: eObrigacoes.abertas || [],
                    prazo: eObrigacoes.prazo ?? null,
                    atrasadas: eObrigacoes.atrasadas ?? 0,
                    semData: eObrigacoes.semData ?? 0,
                    dipam: { produtores: dipamProdutores, indefinidos: dipamIndefinidos },
                });
        } else {
            eObrigacoes = { ...eObrigacoes,
                resumo: `${eObrigacoes.resumo} · DIPAM: ${dipamProdutores} compra(s) de produtor rural.`,
                acao: eObrigacoes.acao || acaoDipam,
                dipam: { produtores: dipamProdutores, indefinidos: 0 } };
        }
    }

    // ── 5. GUIAS ────────────────────────────────────────────────────────────
    // Completo = enviada COM o rito (arquivada no SharePoint e com baixa).
    const enviosOk = envios.filter((e) => e.sharePoint?.status === 'arquivado' && e.baixa?.status === 'baixada').length;
    // Apuração fechada em ZERO não gera guia — cobrar envio aqui seria pendência
    // falsa (empresa sem movimento no mês).
    const semImpostoAPagar = !!apuracao && Number(apuracao.totalImpostos) === 0;
    let eGuias;
    if (envios.length === 0 && semImpostoAPagar) {
        eGuias = etapa('guias', 'na', 'Apuração fechou sem imposto a pagar — não há guia a enviar.', null,
            { envios: 0, completos: 0 });
    } else if (envios.length === 0) {
        eGuias = etapa('guias', 'pendente', 'Nenhuma guia enviada ao cliente.',
            'Envie a guia pelo app — a cópia na pasta IMPOSTOS, o gestor em cópia e a baixa da obrigação saem automáticos.',
            { envios: 0, completos: 0 });
    } else if (enviosOk < envios.length) {
        eGuias = etapa('guias', 'atencao',
            `${envios.length} envio(s), ${enviosOk} completo(s) pelo rito.`,
            'Veja em Envios (rito) o que ficou sem cópia no SharePoint ou sem baixa da obrigação.',
            { envios: envios.length, completos: enviosOk });
    } else {
        eGuias = etapa('guias', 'concluida', `${envios.length} guia(s) enviada(s) com o rito completo.`, null,
            { envios: envios.length, completos: enviosOk });
    }

    // ── ISS de SP capital, DENTRO da linha ──────────────────────────────────
    const ajusteIss = aplicarIssNaRotina({ iss, envios, captura: eCaptura, validacao: eValidacao, guias: eGuias });
    eCaptura = ajusteIss.captura;
    eValidacao = ajusteIss.validacao;
    eGuias = ajusteIss.guias;

    const etapas = [eCaptura, eValidacao, eApuracao, eObrigacoes, eGuias];

    // PRÓXIMO PASSO = a primeira etapa não fechada, na ordem. É a "linha" que
    // faltava: o colaborador não precisa decidir por onde começar.
    const proxima = etapas.find((e) => !FECHADAS.has(e.status)) || null;
    const fechadas = etapas.filter((e) => FECHADAS.has(e.status)).length;

    return {
        empresa: empresa || null,
        competencia,
        iss: ajusteIss.iss,
        etapas,
        proximoPasso: proxima
            ? { id: proxima.id, ordem: proxima.ordem, nome: proxima.nome, onde: proxima.onde, acao: proxima.acao, resumo: proxima.resumo }
            : null,
        progresso: { concluidas: fechadas, total: etapas.length },
        // Só é 'ok' quando as CINCO fecham — mês pela metade não é mês fechado.
        farol: fechadas === etapas.length ? 'ok'
            : etapas.some((e) => e.status === 'pendente') ? 'pendente' : 'atencao',
    };
}

/**
 * O ISS de SP capital dentro da linha do mês.
 *
 * A rotina nasceu cega pro ISS: ela fecha o mês olhando DAS/DARF/obrigações, e
 * a onda 1 da migração são 157 empresas de SERVIÇO PURO — justamente aquelas
 * cujo mês NÃO fecha no DAS. Empresa de SP capital que devia ISS aparecia com
 * "✓ Mês fechado".
 *
 * TRÊS ligações, cada uma na etapa a que pertence:
 *
 *  1. CAPTURA — sem CCM a captura da NFS-e paulistana nem roda (#311), e mês
 *     com a captura falha deixa o zero sem valor. Nos dois casos a etapa NÃO
 *     pode ficar verde só porque a NFe do cliente entrou.
 *  2. VALIDAÇÃO — nota emitida com ISS zerado é conferência pendente (isenção,
 *     imunidade ou valor que não veio na captura), nunca silêncio.
 *  3. GUIAS — ISS próprio e ISS RETIDO como tomadora são DUAS guias, de
 *     naturezas diferentes, e nenhuma das duas é o DAS. Enquanto não houver
 *     envio registrado pelo rito, a etapa fica em ÂMBAR: o app não emite a guia
 *     do município (isso é no portal da PMSP), então ele não pode PROVAR que
 *     ela saiu — e o que não se prova não fica verde.
 *
 * Âmbar e não vermelho de propósito: vermelho eterno em coisa que o app não
 * consegue fechar vira ruído, e ruído a equipe aprende a ignorar. Âmbar já
 * impede o "mês fechado" e mantém a empresa no funil.
 */
export function aplicarIssNaRotina({ iss, envios = [], captura, validacao, guias }) {
    if (!iss || iss.aplicavel !== true) return { captura, validacao, guias, iss: null };

    const aRecolher = Number(iss.aRecolher || 0);
    const tomado = Number(iss.tomadoRetido || 0);
    const tomadoNotas = Number(iss.tomadoNotas || 0);

    // Prova de envio: registro no rito (#293) com o tipo dizendo ISS. Guia
    // própria e guia de retido fecham SEPARADAS — conflatar as duas é o erro
    // que a carteira já cometeu somando uma na outra.
    const tiposIss = (envios || []).map((e) => String(e?.tipo || '')).filter((t) => /iss/i.test(t));
    const proprioEnviado = tiposIss.some((t) => !/retid/i.test(t));
    const retidoEnviado = tiposIss.some((t) => /retid/i.test(t));

    // — 1. captura —
    let eCaptura = captura;
    if (iss.situacao === 'sem-ccm') {
        eCaptura = piorar(captura,
            'NFS-e de SP NÃO capturada: empresa sem CCM.',
            'Cadastre o CCM em Dados fiscais (SP capital). Sem ele a varredura do portal nem tenta a empresa — '
            + 'o ISS do mês fica invisível e "zero nota" não significa nada.');
    } else if (iss.situacao === 'captura-incerta') {
        eCaptura = piorar(captura,
            'NFS-e de SP com captura incerta neste mês.',
            iss.acao || 'A captura da NFS-e do mês não teve sucesso — rode a captura antes de concluir qualquer coisa sobre o ISS.');
    }

    // — 2. validação —
    let eValidacao = validacao;
    if (iss.situacao === 'iss-zerado') {
        eValidacao = piorar(validacao,
            `${Number(iss.notas || 0)} NFS-e emitida(s) com o ISS ZERADO.`,
            iss.acao || 'Confira isenção, imunidade ou valor que não veio na captura antes de fechar o mês.');
    }

    // — 3. guias —
    let eGuias = guias;
    const pendentes = [];
    if (aRecolher > 0 && !proprioEnviado) pendentes.push(`ISS próprio ${fmtBRL(aRecolher)}`);
    if (tomado > 0 && !retidoEnviado) {
        pendentes.push(`ISS RETIDO de ${tomadoNotas} prestador(es) ${fmtBRL(tomado)}`);
    }
    if (pendentes.length) {
        eGuias = piorar(guias,
            `${pendentes.join(' · ')} — guia(s) do município, fora do DAS/DARF.`,
            'Apure em Central de XMLs → 🏛️ ISS SP e emita no portal da PMSP (vence dia 10 do mês seguinte). '
            + 'Registre o envio pelo rito para esta etapa fechar.');
    }

    return {
        captura: eCaptura,
        validacao: eValidacao,
        guias: eGuias,
        iss: {
            situacao: iss.situacao || null,
            notas: Number(iss.notas || 0),
            aRecolher,
            // ISS de optante do Simples e de SUP fixo não vira guia por
            // faturamento — vem separado, pra conferir sem entrar em total.
            foraDoTotal: Number(iss.issForaDoTotal || 0),
            tomadoRetido: tomado,
            tomadoNotas,
            proprioEnviado,
            retidoEnviado,
            pendencias: pendentes,
        },
    };
}

/** Agrava uma etapa sem apagar o que ela já dizia. Verde nunca sobrevive. */
function piorar(e, resumoExtra, acao) {
    const status = e.status === 'pendente' ? 'pendente' : 'atencao';
    return {
        ...e,
        status,
        resumo: `${e.resumo} · ${resumoExtra}`,
        acao: e.acao ? `${e.acao} · ${acao}` : acao,
    };
}

function fmtBRL(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Funil da carteira: quantos clientes estão parados em cada etapa, na ordem.
 * É a visão do gestor — "onde a carteira está travada hoje".
 */
export function resumirFunil(rotinas) {
    const funil = ETAPAS_ROTINA.map((e) => ({ id: e.id, ordem: e.ordem, nome: e.nome, empresas: [] }));
    let completos = 0;
    for (const r of rotinas || []) {
        if (!r?.proximoPasso) { completos++; continue; }
        const alvo = funil.find((f) => f.id === r.proximoPasso.id);
        if (alvo) alvo.empresas.push(r.empresa?.nome || r.empresa?.cnpj || '—');
    }
    const total = (rotinas || []).length;
    return {
        total,
        completos,
        etapas: funil.map((f) => ({ ...f, qtd: f.empresas.length, empresas: f.empresas.slice(0, 100) })),
        resumo: total === 0
            ? 'Nenhuma empresa na seleção.'
            : completos === total
                ? `${total} empresa(s) com o mês fechado.`
                : `${completos} de ${total} empresa(s) com o mês fechado — ${total - completos} paradas em alguma etapa.`,
    };
}
