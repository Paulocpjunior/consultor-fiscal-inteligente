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
// 🏠 A receita de LOCAÇÃO — ela não tem documento por natureza (é o caso
// AFFITTARE, e foi dele que o F550 nasceu). Sem ela a etapa de captura cobra
// uma nota de saída que NUNCA vai existir.
import { receitaDeLocacao } from './receita-sem-documento-f550.js';
// 🔒 O carimbo do fim de mês — quem responde "esta competência foi fechada?".
import { competenciaFechada } from './fim-de-mes.js';
// 🔒 Duas perguntas, dois donos: "este envio fechou o RITO?" e "o canal PROVA
// a saída?". A etapa 5 reimplementava a primeira e ignorava a segunda.
import { conferirRitoDosEnvios, canalComprovaEnvio } from './envio-imposto-painel.js';
import { CANAL_FORA_DO_APP } from './envio-fora-do-app.js';
// 📋 A entrega DECLARADA da obrigação que o catálogo não cobre (28/08, MANTOAN):
// sem ela a etapa 4 mandava, para SEMPRE, não fechar o mês.
import { podeDeclararCobertura, coberturaDeclarada } from './obrigacao-fora-do-catalogo.js';

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

/**
 * ESTA etapa está fechada?
 *
 * Exportada porque o **fim de mês** (26/08) usa exatamente esta pergunta como
 * PRÉ-CONDIÇÃO — e a régua da casa é dura: quem precisa da mesma resposta
 * chama o dono, nunca reescreve o `Set`. Uma segunda cópia divergiria no dia
 * em que nascer um status novo, e divergiria em SILÊNCIO: o mês fecharia com
 * etapa aberta, ou pararia de fechar com etapa que já fechou.
 */
export function etapaFechada(e) {
    return FECHADAS.has(String(e?.status || ''));
}

/**
 * 🏠 A RECEITA DESTA COMPETÊNCIA É INTEIRAMENTE DE LOCAÇÃO?
 *
 * Nasce do caso **AC MASON** (Paulo, 27/08: *"essa empresa é só aluguel, a
 * obrigação já foi entregue e as guias enviadas para o cliente — como atualizar
 * para ficar verde?"*). A Rotina cobrava dela uma **nota de SAÍDA** que nunca
 * vai existir: aluguel não gera documento, é por isso que o **F550** existe.
 *
 * ⚠️ A COMPARAÇÃO É COM O TOTAL, e isso é a trava: empresa que aluga E vende
 * TEM documento a capturar, e exemplá-la silenciaria livro a menor — o erro
 * caro. `faturamentoMesTotal` inclui a locação da matriz (conferido em
 * `handleSaveFicha`), então "locação ≥ total" significa "não há outra receita".
 *
 * ⚠️ E receita ILEGÍVEL não exime: ausência não é prova, e aqui a dúvida cai
 * para o lado de continuar acendendo.
 */
export function receitaSoDeLocacao(apuracao) {
    const locacao = Number(apuracao?.receitaDeLocacao || 0);
    if (!(locacao > 0)) return false;
    // 🐛 `Number(null)` é **0** e `Number.isFinite(0)` é **true** — a 1ª versão
    // deste `if` deixava a receita AUSENTE passar por "receita zero", e aí
    // "locação ≥ 0" eximia a empresa inteira. É a MESMA pegadinha do farol de
    // lastro (15/08) e do regime do catálogo. O `== null` vem SEMPRE primeiro.
    if (apuracao?.receita == null) return false;
    const receita = Number(apuracao.receita);
    if (!Number.isFinite(receita)) return false;
    return locacao >= receita - 0.01;
}

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
            // 🏠 A RECEITA DE LOCAÇÃO viaja junto (27/08, caso AC MASON): ela é
            // receita SEM DOCUMENTO, então a etapa de captura não pode cobrar
            // nota de saída de quem só tem aluguel. Sem este campo a Rotina não
            // tinha como saber — ela só via `faturamentoMesTotal`.
            receitaDeLocacao: receitaDeLocacao(ficha) || 0,
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
    // 🔒 O CARIMBO DO FIM DE MÊS (`fechamentos_competencia`). Quando ele existe
    // e está 'fechada', o mês é FATO fechado — a página virou. Ver o bloco no
    // fim desta função.
    fechamento = null,
    // 📋 A declaração de que as obrigações FORA DO CATÁLOGO foram entregues por
    // fora (empresa + competência). Ausente, nada muda.
    declaracaoCobertura = null,
}) {
    const docs = documentos || [];
    const entradas = docs.filter((d) => d.direcao === 'entrada').length;
    const saidas = docs.filter((d) => d.direcao === 'saida').length;
    // 🏠 Aluguel puro: a receita não tem documento por natureza.
    const soLocacao = receitaSoDeLocacao(apuracao);
    const locacao = Number(apuracao?.receitaDeLocacao || 0);

    // ── 1. CAPTURA ──────────────────────────────────────────────────────────
    let eCaptura;
    if (soLocacao && saidas === 0) {
        // 🏠 NÃO HÁ NOTA DE SAÍDA A CAPTURAR — e dizer o contrário é o alarme
        // que a pessoa não tem como apagar (a família do `tipoTributacao`).
        // 'na' quando não entrou NADA (não se afirma captura que não houve) e
        // 'concluida' quando as entradas vieram — ali a captura de fato rodou.
        const frase = `Receita de LOCAÇÃO de ${fmtBRL(locacao)} — aluguel não gera nota fiscal `
            + '(é a receita que vai ao F550), então não há saída a capturar.';
        eCaptura = docs.length === 0
            ? etapa('captura', 'na', frase, null,
                { entradas: 0, saidas: 0, total: 0, receitaSemDocumento: locacao })
            : etapa('captura', 'concluida', `${entradas} entrada(s) capturada(s) · ${frase}`, null,
                { entradas, saidas: 0, total: docs.length, receitaSemDocumento: locacao });
    } else if (docs.length === 0) {
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
    if (docs.length === 0 && soLocacao) {
        // 🏠 Sem documento porque não há documento — não é "falta validar",
        // é "não há o que validar". Vermelho aqui seria o mesmo alarme sem
        // ação um degrau abaixo.
        eValidacao = etapa('validacao', 'na', 'Não há nota nesta competência — a receita é de locação.',
            null, { resumos: 0, canceladas: 0, cce });
    } else if (docs.length === 0) {
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
            // 🏠 O lastro do aluguel é a PRÓPRIA ficha: ele não tem documento
            // por natureza. Sem isto a empresa de locação pura acende "sem
            // lastro" todo mês sobre um número certo — e quem decide se a
            // receita é TODA de locação é a régua acima, nunca o farol.
            receitaSemDocumento: soLocacao ? locacao : 0,
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
        // O estado ANTES da piora — é para ele que a etapa volta quando a
        // entrega é declarada. Recalcular ali seria uma segunda montagem.
        const statusAntesDaCobertura = eObrigacoes.status;
        const resumoAntesDaCobertura = eObrigacoes.resumo;
        const acaoAntesDaCobertura = eObrigacoes.acao;
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

        // 📋 A ENTREGA DECLARADA TIRA A TRAVA — e a obrigação continua NOMEADA.
        //
        // 28/08 (MANTOAN): *"o catálogo NÃO cobre 1 obrigação: INSS Patronal
        // (depende de folha)"* com a ação *"não dê o mês por fechado por causa
        // da lista"*. Essa etapa NUNCA ia fechar: o INSS patronal depende da
        // folha, que vive no módulo de DP. O app mandava, para sempre, não
        // fechar o mês de quem já tinha feito o trabalho.
        //
        // ⚠️ A declaração só alcança a obrigação PROPOSTA (`podeDeclararCobertura`
        // decide). Regime indefinido, prazo de outra UF e UF ausente TÊM
        // conserto — declarar por cima deles apagaria o caminho.
        eObrigacoes.podeDeclararCobertura = podeDeclararCobertura(eObrigacoes);
        const dec = coberturaDeclarada(eObrigacoes, declaracaoCobertura);
        if (dec.cobre) {
            // Volta ao que a etapa era ANTES da piora, com a ressalva na frase:
            // o mês fecha, e quem ler depois sabe que aquelas obrigações não
            // viraram tarefa e não têm prova no app.
            eObrigacoes = {
                ...eObrigacoes,
                status: statusAntesDaCobertura,
                resumo: `${resumoAntesDaCobertura} · ${props.length} obrigação(ões) fora do catálogo `
                    + `DECLARADA(S) como entregue(s) por ${declaracaoCobertura.declaradoPor}`,
                acao: acaoAntesDaCobertura,
                coberturaDeclarada: true,
                declaracaoCobertura,
                podeDeclararCobertura: false,
            };
        }
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
    // 🔒 QUEM DIZ SE O RITO FECHOU É O DONO (`envioCompletoPeloRito`), nunca
    // uma segunda leitura aqui.
    //
    // Até 27/08 esta linha era `sharePoint === 'arquivado' && baixa ===
    // 'baixada'` — e o PAINEL do rito, ao lado, já tratava `sem-pdf` e
    // `sem-tarefa` como desfechos LEGÍTIMOS (envio sem anexo não tem o que
    // arquivar; tipo sem obrigação mensal não tem o que baixar). Resultado:
    // o painel dava o envio por completo e a Rotina o deixava em ÂMBAR para
    // sempre, travando o fim de mês de uma empresa cujo rito fechou.
    //
    // 🚨 E A BAIXA É DA OBRIGAÇÃO, NÃO DO ENVIO (27/08, VINCENZO GUERRA):
    // `3 envio(s), 1 completo(s)` sobre um DAS que o app ENVIOU e o cliente
    // PAGOU. Os outros dois são o MESMO DAS indo de novo, e na segunda vez a
    // baixa não acha tarefa PENDENTE — a primeira já concluiu. Quem responde
    // pelo conjunto é `conferirRitoDosEnvios`.
    const rito = conferirRitoDosEnvios(envios);
    const enviosOk = rito.filter((r) => r.completo).length;
    const reenvios = rito.filter((r) => r.baixaJaFeitaNaObrigacao).length;
    // ⚠️ CAUSA JUNTO DO NÚMERO: *"veja em Envios (rito) o que ficou sem cópia
    // ou sem baixa"* é "vá procurar" — e quem lê a Rotina está justamente
    // tentando saber o que falta. As causas já vêm nomeadas pelo dono.
    const causas = [...new Set(rito.flatMap((r) => r.pendencias.map((p) => p.causa)))];
    // ⚠️ E A AÇÃO VIAJA JUNTO DA CAUSA (28/08, VINCENZO). O dono já devolve as
    // duas — *"Preencha grupo + pasta em Central de XMLs → Integrações →
    // SharePoint"*, *"Gere as tarefas da competência e dê baixa manual"* — e a
    // Rotina jogava a ação FORA, ficando com um genérico *"Resolva em Envios
    // (rito)"*. Só que em Envios (rito) não se cria pasta de SharePoint nem se
    // gera tarefa: era "vá procurar" com mais passos, na tela de quem está
    // justamente tentando saber o que fazer.
    const acoesDoRito = [...new Set(rito.flatMap((r) => r.pendencias.map((p) => p.acao)))];
    const naoConferidos = rito.filter((r) => !r.completo && r.naoConferido).length;
    // ⚠️ O QUE O APP NÃO PODE AFIRMAR sai CONTADO, nunca escondido: mailto,
    // WhatsApp e o envio DECLARADO só provam que a composição abriu (ou que
    // alguém disse que enviou). Isso NÃO trava — a etapa nunca exigiu prova de
    // ENTREGA, ela exige o RITO —, mas vai dito na linha e viaja no carimbo.
    const semProva = envios.filter((e) => !canalComprovaEnvio(e.canal)).length;
    const declarados = envios.filter((e) => String(e.canal || '') === CANAL_FORA_DO_APP).length;
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
        const oQueFalta = [
            ...causas,
            naoConferidos > 0
                ? `${naoConferidos} envio(s) sem registro das etapas do rito (auditoria anterior ao rito #293)`
                : null,
        ].filter(Boolean);
        eGuias = etapa('guias', 'atencao',
            `${envios.length} envio(s), ${enviosOk} completo(s) pelo rito.`,
            // CAUSA **e** AÇÃO. A causa junto do número é regra da casa; o que
            // faltava era a ação de CADA causa — antes vinha um genérico
            // "Resolva em Envios (rito)", e em Envios (rito) não se cria pasta
            // de SharePoint nem se gera tarefa.
            `${oQueFalta.join(' · ')}.`
            + (acoesDoRito.length
                ? ` → ${acoesDoRito.join(' · ')}`
                : ' Resolva em Vencimentos e Obrigações → Envios (rito).'),
            { envios: envios.length, completos: enviosOk, semProva, declarados, reenvios, causas });
    } else {
        eGuias = etapa('guias', 'concluida',
            `${envios.length} guia(s) enviada(s) com o rito completo`
            // O reenvio vai DITO: sem ele, quem contou 3 envios não entende
            // por que a linha fala de 1 obrigação.
            + (reenvios > 0 ? ` · ${reenvios} reenvio(s) da mesma guia` : '')
            + (declarados > 0 ? ` · ${declarados} DECLARADA(S) como enviada(s) por fora do app` : '')
            + '.',
            null,
            { envios: envios.length, completos: enviosOk, semProva, declarados, reenvios, causas });
    }

    // ── ISS de SP capital, DENTRO da linha ──────────────────────────────────
    const ajusteIss = aplicarIssNaRotina({ iss, envios, captura: eCaptura, validacao: eValidacao, guias: eGuias });
    eCaptura = ajusteIss.captura;
    eValidacao = ajusteIss.validacao;
    eGuias = ajusteIss.guias;

    // 📋 DECLARAR ENVIO POR FORA só faz sentido para guia que o app NÃO enviou.
    //
    // A saída nasce onde a trava aparece — mas quando o registro do envio EXISTE
    // e o que falta é o RITO (a cópia na pasta), declarar OUTRO envio não fecha
    // nada e convida a declarar o que o app já fez. É a mesma família da
    // recusa que o Paulo apontou na VINCENZO: o app enviou, e a tela oferecia
    // "já enviei por fora".
    //
    // Continua valendo onde a guia de fato não saiu pelo app: nenhum envio na
    // competência, ou ISS do município pendente (o app não emite guia da PMSP).
    eGuias = {
        ...eGuias,
        podeDeclararEnvio: envios.length === 0 || (ajusteIss.iss?.pendencias?.length || 0) > 0,
    };

    const etapas = [eCaptura, eValidacao, eApuracao, eObrigacoes, eGuias];

    // PRÓXIMO PASSO = a primeira etapa não fechada, na ordem. É a "linha" que
    // faltava: o colaborador não precisa decidir por onde começar.
    const proxima = etapas.find((e) => !etapaFechada(e)) || null;
    const fechadas = etapas.filter(etapaFechada).length;

    // ═══════════════════════════════════════════════════════════════════════
    // 🔒 PÁGINA VIRADA — o carimbo VENCE as etapas (Paulo, 27/08: *"empresa
    // fechada, imposto enviado, página virada! Não pode ficar em vermelho"*).
    //
    // As cinco etapas são a PRÉ-CONDIÇÃO do fim de mês, e o ato só passa com
    // todas fechadas (a decisão de BLOQUEAR, 26/08). Depois do carimbo elas
    // continuam sendo RECALCULADAS a cada abertura da tela — e qualquer coisa
    // que mude depois (uma tarefa reaberta, uma nota que chegou atrasada) fazia
    // a empresa voltar ao vermelho num mês que a pessoa já entregou.
    //
    // O carimbo é FATO — quem fechou, quando, com qual acervo e quais valores.
    // Uma etapa recalculada é DEDUÇÃO. Fato vence dedução: sem `proximoPasso`
    // (não há próximo passo num mês fechado) e farol próprio, que não é
    // 'pendente' nem 'atencao'.
    //
    // ⚠️ 'reaberta' NÃO conta como fechada (`competenciaFechada`): a reabertura
    // existe justamente para permitir a edição, e tratá-la como fechada
    // esconderia o retrabalho que ela abre.
    //
    // ⚠️ E as etapas CONTINUAM sendo entregues como estão — o mês fechado não
    // apaga o que mudou depois, ele só para de COBRAR. Quem quiser ver o que
    // mudou abre o card; quem reabrir volta a receber o próximo passo.
    // ═══════════════════════════════════════════════════════════════════════
    const mesFechado = competenciaFechada(fechamento);

    return {
        empresa: empresa || null,
        competencia,
        iss: ajusteIss.iss,
        etapas,
        fechamento: fechamento || null,
        proximoPasso: (mesFechado || !proxima) ? null
            : { id: proxima.id, ordem: proxima.ordem, nome: proxima.nome, onde: proxima.onde, acao: proxima.acao, resumo: proxima.resumo },
        progresso: { concluidas: fechadas, total: etapas.length },
        // 'fechado' é FATO (o carimbo). 'ok' passou a querer dizer **pronto
        // para fechar** desde 26/08 — as cinco etapas fecharam e ninguém deu o
        // fim de mês ainda.
        farol: mesFechado ? 'fechado'
            : fechadas === etapas.length ? 'ok'
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
    // 🚨 "MÊS FECHADO" ERA DEDUÇÃO AQUI — e era leitura MINHA deixada para trás.
    //
    // O contador antigo era `if (!r.proximoPasso) completos++`, ou seja "as
    // cinco etapas fecharam ⇒ o mês fechou". Em 26/08 o card parou de deduzir
    // isso (`✓ Mês fechado` virou o ato) e o FUNIL continuou deduzindo: a MESMA
    // tela com duas leituras do mesmo fato, que é o defeito que esta casa mais
    // paga. É a régua de 23/08 outra vez — **quando um booleano muda de
    // significado, os LEITORES dele entram no mesmo PR**, e este eu esqueci.
    //
    // Agora são DOIS números, porque pedem ações OPOSTAS: `fechados` é fato
    // (nada a fazer) e `prontos` é um CLIQUE que ninguém deu — fundir os dois
    // faria N empresas prontas passarem por entregues.
    let fechados = 0;
    let prontos = 0;
    for (const r of rotinas || []) {
        if (competenciaFechada(r?.fechamento)) { fechados++; continue; }
        if (!r?.proximoPasso) { prontos++; continue; }
        const alvo = funil.find((f) => f.id === r.proximoPasso.id);
        if (alvo) alvo.empresas.push(r.empresa?.nome || r.empresa?.cnpj || '—');
    }
    const total = (rotinas || []).length;
    const parados = total - fechados - prontos;
    return {
        total,
        fechados,
        prontos,
        // Compatibilidade do payload: `completos` era "não tem próximo passo",
        // e é isso que ele continua sendo — fechados + prontos.
        completos: fechados + prontos,
        etapas: funil.map((f) => ({ ...f, qtd: f.empresas.length, empresas: f.empresas.slice(0, 100) })),
        resumo: total === 0
            ? 'Nenhuma empresa na seleção.'
            : `${fechados} de ${total} empresa(s) com o mês FECHADO`
                + (prontos > 0 ? ` · ${prontos} pronta(s) para dar fim de mês` : '')
                + (parados > 0 ? ` · ${parados} parada(s) em alguma etapa` : '')
                + '.',
    };
}
