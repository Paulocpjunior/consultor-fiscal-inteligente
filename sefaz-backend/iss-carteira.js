// ============================================================================
// sefaz-backend/iss-carteira.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Painel do ISS próprio da CARTEIRA INTEIRA, competência a competência.
//
// A aba 🏛️ ISS SP responde UMA empresa por vez — serve pra fechar o cliente que
// está na mão, não pra saber quem falta. E a onda 1 da migração são 157
// empresas de serviço puro: perguntar "quem tem ISS a recolher este mês?" 157
// vezes não acontece, então na prática ninguém pergunta.
//
// REGRAS QUE MANDAM AQUI (todas já custaram caro em outro painel):
//
// 1. ZERO NÃO É RESPOSTA SOZINHO. "Nenhuma nota" e "não conseguimos buscar"
//    ficam idênticos na tela — o primeiro encerra o assunto, o segundo é uma
//    guia que não vai sair. Só se conclui "sem movimento" quando a captura
//    daquele mês rodou e teve sucesso (`zeroConfiavel`).
// 2. SEM CCM A CAPTURA NEM RODA (#311). Essa empresa não é "sem movimento":
//    é BLOQUEADA, e o bloqueio é de cadastro — some da conta de quem deve.
// 3. ISS FIXO (SUP) NÃO SE APURA POR FATURAMENTO. O valor da guia é qtde de
//    profissionais × valor por profissional; somar o ISS das notas dele no
//    total da carteira inventaria dinheiro que ninguém deve daquele jeito.
// 4. RETIDO PELO TOMADOR NÃO É DO PRESTADOR (Lei 13.701/03 art. 9º).
// ============================================================================

import { resumirCausasIssZerado, divergenciaRegimePelaNota } from './iss-zerado-causa.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Situações possíveis de uma empresa no mês. A ordem é a de prioridade. */
export const SITUACOES = [
    'sem-ccm', 'captura-incerta', 'iss-zerado', 'a-recolher', 'so-tomado',
    'iss-no-das', 'iss-fixo', 'so-retido', 'iss-zerado-explicado', 'sem-movimento',
];

const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);

/** Primeiro candidato numérico de verdade. Ausente ≠ zero: sem candidato, `undefined`. */
const primeiroNumero = (...cands) => {
    for (const x of cands) {
        if (x === undefined || x === null || x === '') continue;
        if (Number.isFinite(Number(x))) return Number(x);
    }
    return undefined;
};

const ehNfse = (d) => /NFSe/i.test(String(d?.tipoDoc || d?.tipo || ''));

/**
 * ISS de uma competência, POR EMPRESA, lido dos documentos.
 *
 * MORA AQUI porque já são DOIS painéis lendo a mesma coisa (a aba 🏛️ ISS SP da
 * carteira e a Rotina do mês) — e o jeito de ler é justamente a armadilha que
 * já mordeu seis vezes: a NFS-e do PORTAL vem ACHATADA (`valorIss`,
 * `issDevido`, `issRetido`) e a do XML vem em OBJETO (`valores.iss`). Painel
 * com conta própria erra sozinho; é a lição do card 4 e do relatório.
 *
 * @param {Array} documentos docs da competência (qualquer direção)
 * @param {(d:object)=>string|null} resolverEmpresaId de quem é o documento
 * @returns {Array} [{empresaId, notas, issDevido, issRetido, semValorGravado,
 *                    tomadoRetido, tomadoNotas, aRecolher}]
 */
export function acumularIssPorEmpresa(documentos, resolverEmpresaId) {
    const acc = new Map();
    const pegar = (id) => {
        let a = acc.get(id);
        if (!a) {
            a = {
                empresaId: id, notas: 0, issDevido: 0, issRetido: 0, semValorGravado: 0,
                tomadoRetido: 0, tomadoNotas: 0,
                // Notas de SAÍDA com o ISS zerado, guardadas pra dizer POR QUÊ
                // (iss-zerado-causa.js). Sem isso o painel junta 67 empresas
                // sob a mesma frase e ninguém sabe por onde começar.
                zeradas: [], saidas: [],
            };
            acc.set(id, a);
        }
        return a;
    };

    for (const d of documentos || []) {
        if (!ehNfse(d)) continue;
        if (CANCELADOS.has(String(d.status || '').toLowerCase())) continue;
        const empresaId = resolverEmpresaId ? resolverEmpresaId(d) : d.empresaId;
        if (!empresaId) continue;
        const v = d.valores || {};

        // ENTRADA com retenção = ISS que a empresa recolhe COMO TOMADORA.
        // Outra obrigação, outra guia — mas ela precisa APARECER, senão empresa
        // que só tem tomado fica como "sem movimento".
        if (d.direcao === 'entrada') {
            const flag = v.issRetido === true || d.issRetido === true;
            const ret = primeiroNumero(v.valorIssRetido, d.valorIssRetido);
            const iss = primeiroNumero(v.iss, d.valorIss, d.issDevido, d.totais?.vISS);
            const valor = ret !== undefined ? ret : (flag && iss !== undefined ? iss : 0);
            if (!valor) continue;
            const a = pegar(empresaId);
            a.tomadoRetido += valor;
            a.tomadoNotas += 1;
            continue;
        }
        if (d.direcao !== 'saida') continue;

        const devido = primeiroNumero(v.iss, d.valorIss, d.issDevido, d.totais?.vISS);
        const flag = v.issRetido === true || d.issRetido === true;
        const ret = primeiroNumero(v.valorIssRetido, d.valorIssRetido);
        const retido = ret !== undefined ? ret : (flag ? (devido || 0) : 0);

        const a = pegar(empresaId);
        a.notas += 1;
        a.issDevido += devido || 0;
        a.issRetido += retido || 0;
        a.saidas.push(d);
        // Nota sem NENHUM campo de ISS não é nota de ISS zero: é nota sem o
        // valor gravado. Vira bloqueio, não parcela do total.
        if (devido === undefined) a.semValorGravado += 1;
        else if (devido === 0) a.zeradas.push(d);
    }

    return [...acc.values()].map((a) => ({
        ...a,
        issDevido: r2(a.issDevido),
        issRetido: r2(a.issRetido),
        tomadoRetido: r2(a.tomadoRetido),
        // Retido pelo tomador não é recolhido pelo prestador (Lei 13.701/03).
        aRecolher: Math.max(0, r2(a.issDevido - a.issRetido)),
    }));
}

const PESO = Object.fromEntries(SITUACOES.map((s, i) => [s, i]));

/**
 * @param {object} p
 * @param {Array}  p.empresas   [{empresaId, nome, cnpj, ccm, issFixoSup, codMunIBGE}]
 * @param {Array}  p.apuracoes  [{empresaId, notas, issDevido, issRetido, aRecolher, semValorGravado}]
 * @param {(cnpj:string)=>boolean} [p.zeroConfiavelPara] captura daquele CNPJ é confiável?
 */
export function montarPainelIssCarteira({ empresas, apuracoes, zeroConfiavelPara } = {}) {
    const porEmpresa = new Map();
    for (const a of apuracoes || []) {
        if (a?.empresaId) porEmpresa.set(a.empresaId, a);
    }

    const linhas = [];
    for (const e of empresas || []) {
        const a = porEmpresa.get(e.empresaId) || {};
        const notas = Number(a.notas || 0);
        const issDevido = r2(a.issDevido);
        const issRetido = r2(a.issRetido);
        const aRecolher = r2(a.aRecolher);
        const semValorGravado = Number(a.semValorGravado || 0);
        // ISS retido COMO TOMADORA: outra obrigação, outra guia. Entrou na
        // tela da empresa no mesmo dia, mas a carteira não sabia dele — e
        // empresa que SÓ tem tomado aparecia como "sem movimento", que é o
        // mesmo falso-negativo que acabamos de corrigir no ISS próprio.
        const tomadoRetido = r2(a.tomadoRetido);
        const tomadoNotas = Number(a.tomadoNotas || 0);
        const temCcm = !!String(e.ccm || '').replace(/\D/g, '').replace(/^0+$/, '');
        // OPTANTE DO SIMPLES não recolhe o ISS próprio em guia do município: ele
        // já está DENTRO do DAS (LC 123 art. 13). Somar esse ISS no "a recolher"
        // da carteira inventa uma guia que ninguém emite — e é dinheiro contado
        // duas vezes, porque o DAS da mesma competência já o contém.
        // Continua VALENDO pra optante: ISS retido como TOMADORA (outra guia),
        // ISS fixo/SUP (guia do município) e o retido pelo tomador nas saídas.
        const regimeSimples = String(e.regime || '').toLowerCase() === 'simples';
        // POR QUE o ISS está zerado, e se o cadastro discorda da própria nota.
        const causas = a.zeradas?.length ? resumirCausasIssZerado(a.zeradas) : null;
        const divergencia = divergenciaRegimePelaNota(e.regime, a.saidas || []);
        // A captura só é "confiável" pra quem tem CCM: sem ele a varredura do
        // portal nem tenta a empresa, então o zero dela não vale nada.
        const zeroConfiavel = temCcm && (zeroConfiavelPara ? !!zeroConfiavelPara(e.cnpj) : false);

        let situacao;
        let acao = null;
        if (!temCcm) {
            situacao = 'sem-ccm';
            acao = 'Sem CCM a captura da NFS-e no portal nem roda — cadastre em Dados fiscais → CCM antes de concluir qualquer coisa sobre esta empresa.';
        } else if (e.issFixoSup) {
            situacao = 'iss-fixo';
            acao = 'ISS fixo (sociedade uniprofissional): a guia é por profissional, não sai do faturamento. O ISS das notas é informativo.';
        } else if (semValorGravado > 0) {
            situacao = 'captura-incerta';
            acao = `${semValorGravado} nota(s) sem o ISS gravado — ausência NÃO é zero. Reimporte a competência antes de emitir a guia.`;
        } else if (notas === 0 && !zeroConfiavel) {
            situacao = 'captura-incerta';
            acao = 'Zero notas E a captura do mês não teve sucesso — não dá pra afirmar que o cliente não emitiu. Rode a captura antes de dizer que não há guia.';
        } else if (regimeSimples && aRecolher > 0) {
            situacao = 'iss-no-das';
            acao = 'Optante do Simples: este ISS já é recolhido DENTRO do DAS — não há guia do município. '
                + 'Só confira se a empresa não foi impedida pelo sublimite (aí o ISS passa a ser recolhido à parte).';
        } else if (aRecolher > 0) {
            situacao = 'a-recolher';
        } else if (notas > 0 && issRetido > 0) {
            situacao = 'so-retido';
            acao = 'Todo o ISS do mês foi retido pelo tomador — quem recolhe é quem contratou. Não há guia do prestador.';
        } else if (notas === 0 && tomadoRetido > 0) {
            // Não prestou, mas CONTRATOU com retenção: tem guia a recolher —
            // só que a do ISS retido na fonte.
            situacao = 'so-tomado';
            acao = `Não emitiu nota no mês, mas reteve ISS de ${tomadoNotas} prestador(es). `
                + 'Há guia de ISS RETIDO a recolher — é outra guia, não a do ISS próprio.';
        } else if (regimeSimples && notas > 0) {
            // ACHADO 06/08 (2ª varredura, com o ISS já ligado): "dentro do DAS"
            // deu ZERO empresa e "ISS zerado" pulou pra 67. É que a NFS-e do
            // optante sai com o ISS ZERADO — justamente PORQUE ele vai no DAS.
            // Então o caso real do optante não é "ISS destacado que não vira
            // guia", é "nota sem ISS destacado". Mandar conferir isso é alarme
            // sem ação: o valor do ISS na nota de um optante não muda guia
            // nenhuma, o DAS sai do faturamento.
            situacao = 'iss-no-das';
            acao = `${notas} nota(s) emitida(s) com o ISS zerado — no optante do Simples isso é o ESPERADO: `
                + 'o ISS vai dentro do DAS e a nota sai sem valor destacado. Não é pendência. '
                + 'Só confira se a empresa não foi impedida pelo sublimite.';
        } else if (notas > 0) {
            // ACHADO 06/08 (varredura real do Paulo): empresa com 29 NOTAS
            // aparecia como "sem movimento". Isso é o farol MENTINDO — ela tem
            // movimento; o que está zerado é o ISS.
            //
            // Mas parar aqui era MEIO farol: 67 empresas com a mesma frase
            // "confira isenção/imunidade ou falha na captura". As causas são
            // muito diferentes e a maioria não pede ação nenhuma — quem decide
            // é `iss-zerado-causa.js`, com o motivo dominante AO LADO.
            if (causas?.explicado) {
                // O zero está EXPLICADO pelo próprio documento (retido, fora de
                // SP, dedução integral, alíquota zero). Isso é resposta, não
                // pendência — continuar cobrando conferência aqui é o alarme
                // que a equipe aprende a ignorar.
                situacao = 'iss-zerado-explicado';
                acao = `${notas} nota(s) com ISS zerado, e o motivo está na própria nota: `
                    + `${causas.dominante?.texto || ''} Nada a recolher.`;
            } else {
                situacao = 'iss-zerado';
                acao = causas?.dominante
                    ? `${notas} nota(s) com ISS zerado · ${causas.exigemAcao} pede(m) conferência: ${causas.dominante.texto}`
                    : `${notas} nota(s) emitida(s) no mês e ISS ZERADO em todas. `
                        + 'Isso pode ser isenção, imunidade, alíquota não gravada na captura ou serviço fora de SP — '
                        + 'confira antes de concluir que não há guia.';
            }
        } else {
            // Só aqui é "sem movimento": ZERO nota, com a captura confiável.
            situacao = 'sem-movimento';
        }

        // Fica FORA do total quem não gera guia municipal por faturamento:
        // o ISS fixo (guia por profissional) e o optante do Simples (dentro do
        // DAS). O valor não some da tela — vai em campo próprio, pra conferir.
        const foraDoTotal = situacao === 'iss-fixo' || situacao === 'iss-no-das';
        linhas.push({
            ...e,
            notas, issDevido, issRetido,
            aRecolher: foraDoTotal ? 0 : aRecolher,
            issForaDoTotal: foraDoTotal ? aRecolher : 0,
            tomadoRetido, tomadoNotas,
            temCcm, zeroConfiavel, situacao, acao,
            causasIssZerado: causas,
            // Cadastro diz X e a nota diz Y ⇒ ACENDE, não escolhe sozinho.
            divergenciaRegime: divergencia?.divergente ? divergencia : null,
        });
    }

    // Quem precisa de ação primeiro fica em cima; dentro da mesma situação, o
    // maior valor primeiro.
    linhas.sort((a, b) => (PESO[a.situacao] - PESO[b.situacao])
        || (b.aRecolher - a.aRecolher)
        || String(a.nome).localeCompare(String(b.nome)));

    const conta = (s) => linhas.filter((l) => l.situacao === s).length;
    const resumo = {
        empresas: linhas.length,
        aRecolher: conta('a-recolher'),
        totalARecolher: r2(linhas.reduce((t, l) => t + l.aRecolher, 0)),
        semCcm: conta('sem-ccm'),
        capturaIncerta: conta('captura-incerta'),
        issZerado: conta('iss-zerado'),
        // O tomado NÃO entra no totalARecolher: são guias diferentes, e somar
        // inventaria um valor que ninguém paga junto.
        comIssTomado: linhas.filter((l) => l.tomadoRetido > 0).length,
        totalIssTomado: r2(linhas.reduce((t, l) => t + l.tomadoRetido, 0)),
        issNoDas: conta('iss-no-das'),
        totalIssNoDas: r2(linhas.filter((l) => l.situacao === 'iss-no-das').reduce((t, l) => t + l.issForaDoTotal, 0)),
        issFixo: conta('iss-fixo'),
        soRetido: conta('so-retido'),
        // Zero EXPLICADO pela própria nota (retido, fora de SP, dedução,
        // alíquota zero): é resposta, não pendência — por isso conta separado
        // de `issZerado` e não acende o farol.
        issZeradoExplicado: conta('iss-zerado-explicado'),
        divergenciaRegime: linhas.filter((l) => l.divergenciaRegime).length,
        semMovimento: conta('sem-movimento'),
    };

    return { linhas, resumo, farol: farolDaCarteira(resumo), avisos: avisosDaCarteira(resumo) };
}

/**
 * Farol da carteira. all-failed nunca é verde e "tudo zero" nunca é sucesso:
 * carteira em que NINGUÉM tem nota é sintoma de captura quebrada, não de mês
 * sem movimento (lição da NFS-e SP com 0 sucessos e 121 falhas).
 */
export function farolDaCarteira(resumo) {
    if (!resumo || !resumo.empresas) return 'sem-dados';
    if (resumo.semCcm > 0 || resumo.capturaIncerta > 0 || resumo.issZerado > 0
        || resumo.divergenciaRegime > 0) return 'atencao';
    // Ninguém com nota na carteira inteira: não se conclui "mês parado".
    if (resumo.aRecolher === 0 && resumo.soRetido === 0 && resumo.issFixo === 0
        && !resumo.issNoDas && !resumo.issZerado && !resumo.issZeradoExplicado
        && !resumo.comIssTomado) return 'atencao';
    return 'ok';
}

function avisosDaCarteira(r) {
    const avisos = [];
    if (r.semCcm > 0) {
        avisos.push(
            `${r.semCcm} empresa(s) de SP capital SEM CCM — a captura da NFS-e não roda pra elas e o zero delas não significa nada.`,
        );
    }
    if (r.issZerado > 0) {
        avisos.push(
            `${r.issZerado} empresa(s) com ISS zerado que a própria nota NÃO explica — alíquota ausente na captura `
            + 'ou nota que diz tributar e veio com ISS zero. É aqui que se confere; o resto do zerado já tem motivo.',
        );
    }
    if (r.issZeradoExplicado > 0) {
        avisos.push(
            `${r.issZeradoExplicado} empresa(s) com ISS zerado JÁ EXPLICADO pela nota (retido, serviço fora de SP, `
            + 'dedução integral ou alíquota zero) — não é pendência, não precisa conferir.',
        );
    }
    if (r.divergenciaRegime > 0) {
        avisos.push(
            `🚨 ${r.divergenciaRegime} empresa(s) em que o CADASTRO e a NOTA discordam sobre optar pelo Simples. `
            + 'Uma das duas está errada, e as duas respostas dão guias diferentes — corrija o cadastro antes de emitir.',
        );
    }
    if (r.comIssTomado > 0) {
        avisos.push(
            `${r.comIssTomado} empresa(s) retiveram ISS como TOMADORAS (R$ ${r.totalIssTomado.toFixed(2)}) — `
            + 'é OUTRA guia, que elas recolhem no lugar do prestador. Não soma com o ISS próprio.',
        );
    }
    if (r.capturaIncerta > 0) {
        avisos.push(
            `${r.capturaIncerta} empresa(s) com captura incerta no mês — não prometa (nem descarte) guia antes de rodar a captura.`,
        );
    }
    if (r.issFixo > 0) {
        avisos.push(
            `${r.issFixo} empresa(s) de ISS fixo (SUP) ficam FORA do total: a guia delas é por profissional, não por faturamento.`,
        );
    }
    if (r.issNoDas > 0) {
        avisos.push(
            `${r.issNoDas} empresa(s) do SIMPLES emitiram nota no mês e o ISS delas vai DENTRO do DAS `
            + (r.totalIssNoDas > 0 ? `(R$ ${r.totalIssNoDas.toFixed(2)} destacado nas notas) ` : '(nota sai com ISS zerado, que é o esperado) ')
            + '— não gera guia do município e fica FORA do total. Cobrar essa guia seria cobrar duas vezes.',
        );
    }
    // Este alarme é de CAPTURA QUEBRADA — e empresa com nota TEM movimento,
    // mesmo que o ISS dela esteja zerado. Sem contar as zeradas, o alarme dizia
    // "ninguém teve nota" numa carteira cheia de notas.
    if (r.empresas > 0 && r.aRecolher === 0 && r.soRetido === 0 && r.issFixo === 0
        && !r.issNoDas && !r.issZerado && !r.issZeradoExplicado && !r.comIssTomado) {
        avisos.push(
            'NENHUMA empresa da carteira teve nota nesta competência. Isso quase nunca é mês parado — confira a captura antes de fechar o mês.',
        );
    }
    return avisos;
}
