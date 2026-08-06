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

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Situações possíveis de uma empresa no mês. A ordem é a de prioridade. */
export const SITUACOES = ['sem-ccm', 'captura-incerta', 'iss-zerado', 'a-recolher', 'iss-fixo', 'so-retido', 'sem-movimento'];

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
        const temCcm = !!String(e.ccm || '').replace(/\D/g, '').replace(/^0+$/, '');
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
        } else if (aRecolher > 0) {
            situacao = 'a-recolher';
        } else if (notas > 0 && issRetido > 0) {
            situacao = 'so-retido';
            acao = 'Todo o ISS do mês foi retido pelo tomador — quem recolhe é quem contratou. Não há guia do prestador.';
        } else if (notas > 0) {
            // ACHADO 06/08 (varredura real do Paulo): empresa com 29 NOTAS
            // aparecia como "sem movimento". Isso é o farol MENTINDO — ela tem
            // movimento; o que está zerado é o ISS. Pode ser isenção, imunidade
            // ou nota que veio sem o valor, e nenhuma dessas é "nada a fazer".
            situacao = 'iss-zerado';
            acao = `${notas} nota(s) emitida(s) no mês e ISS ZERADO em todas. `
                + 'Isso pode ser isenção, imunidade, alíquota não gravada na captura ou serviço fora de SP — '
                + 'confira antes de concluir que não há guia.';
        } else {
            // Só aqui é "sem movimento": ZERO nota, com a captura confiável.
            situacao = 'sem-movimento';
        }

        linhas.push({
            ...e,
            notas, issDevido, issRetido,
            // ISS fixo não entra no total por faturamento: o valor da guia dele
            // não está nestas notas.
            aRecolher: situacao === 'iss-fixo' ? 0 : aRecolher,
            temCcm, zeroConfiavel, situacao, acao,
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
        issFixo: conta('iss-fixo'),
        soRetido: conta('so-retido'),
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
    if (resumo.semCcm > 0 || resumo.capturaIncerta > 0 || resumo.issZerado > 0) return 'atencao';
    // Ninguém com nota na carteira inteira: não se conclui "mês parado".
    if (resumo.aRecolher === 0 && resumo.soRetido === 0 && resumo.issFixo === 0) return 'atencao';
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
            `${r.issZerado} empresa(s) TÊM nota no mês com o ISS zerado em todas — isso não é "sem movimento". `
            + 'Confira isenção/imunidade ou falha na captura do valor antes de fechar o mês.',
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
    if (r.empresas > 0 && r.aRecolher === 0 && r.soRetido === 0 && r.issFixo === 0) {
        avisos.push(
            'NENHUMA empresa da carteira teve nota nesta competência. Isso quase nunca é mês parado — confira a captura antes de fechar o mês.',
        );
    }
    return avisos;
}
