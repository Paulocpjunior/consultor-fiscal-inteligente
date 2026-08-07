// ============================================================================
// sefaz-backend/fila-migracao.js  (PURO — testável)
// ----------------------------------------------------------------------------
// QUEM PODE MIGRAR HOJE, e o que falta pra quem não pode.
//
// Paulo, 07/08: "precisamos acelerar". O que trava não é falta de ferramenta —
// é que a resposta está espalhada em TRÊS telas, e ninguém abre três abas
// vezes 388 clientes:
//
//   🔎 Prova de captura   entrada está completa contra a SEFAZ? (cursor NSU)
//   ✅ Aptidão da saída   o cliente ligou o autXML/cofre? (hoje 0/388)
//   🚦 Migração           de quais blocos do SPED este cliente precisa?
//
// Aqui vira UMA fila, ordenada, com UM próximo passo por cliente. É o mesmo
// desenho da Rotina do mês, aplicado à migração: o colaborador não escolhe por
// onde começar, ele pega o de cima.
//
// REGRAS QUE MANDAM (todas já custaram caro em outro painel):
//
// 1. AUSÊNCIA NUNCA É PRONTIDÃO. Cliente sem sinal nenhum não é "pronto": é
//    "não sabemos". Sinal que não chegou vira bloqueio, não silêncio verde.
// 2. UM PRÓXIMO PASSO, NÃO UMA LISTA. Cliente com 4 bloqueios recebe o
//    primeiro na ordem — lista de 4 coisas ninguém começa.
// 3. A ORDEM DA FILA É POR ESFORÇO, não por nome. Quem está a um passo de
//    migrar vem antes de quem está a quatro: é assim que a onda anda.
// 4. ONDA SEPARADA. Quem NÃO entrega EFD ICMS/IPI (serviço puro, sem IE) não
//    é bloqueado por bloco nenhum do SPED — misturar as duas ondas faz a fila
//    parecer travada quando metade dela já podia ter migrado.
// ============================================================================

/** Áreas de bloqueio, na ordem em que se resolve. A 1ª é o próximo passo. */
export const AREAS_BLOQUEIO = ['captura-entrada', 'captura-saida', 'blocos'];

const ONDE = {
    'captura-entrada': 'Central de XMLs → Captura → 🔎 Prova de captura',
    'captura-saida': 'Central de XMLs → Importar → ✅ O cliente fez certo?',
    blocos: 'Central de XMLs → 🚦 Migração',
};

/**
 * Bloqueio de ENTRADA: a captura contra a SEFAZ está completa?
 *
 * A prova é o cursor do DistDFe (`vereditoDoCnpj`), não comparação com
 * concorrente. Farol 'atencao' TAMBÉM bloqueia: resumo sem completa entra na
 * apuração a menor, e migrar com o livro a menor é levar o erro junto.
 */
function bloqueioEntrada(veredito) {
    if (!veredito) {
        return {
            area: 'captura-entrada',
            motivo: 'Sem prova de captura para este CNPJ — não sabemos se a entrada está completa.',
            acao: 'Rode a prova de captura antes de migrar. Ausência de sinal não é captura em dia.',
        };
    }
    if (veredito.farol === 'ok') return null;
    return {
        area: 'captura-entrada',
        motivo: veredito.motivo,
        acao: veredito.acao || 'Feche a captura de entrada antes de migrar.',
        codigo: veredito.codigo || null,
    };
}

/**
 * Bloqueio de SAÍDA: o cliente ligou o escritório na emissão dele?
 *
 * A prova é o autXML/cofre (`aptidao-saida.js`), e vale de QUALQUER data —
 * uma nota basta. 'apto-sem-fluxo' é APTO: configurou e não vendeu no mês, e
 * cobrar quem já fez queima a relação.
 */
function bloqueioSaida(aptidao) {
    if (!aptidao) {
        return {
            area: 'captura-saida',
            motivo: 'Sem leitura de aptidão da saída — não sabemos se a emissão do cliente chega ao escritório.',
            acao: 'Rode a aptidão da saída. Sem essa prova, a saída pode estar fora do livro e ninguém veria.',
        };
    }
    // Não emite mod 55: não há o que ligar. Isso é resposta, não pendência.
    if (aptidao.status === 'sem-saida-55') return null;
    if (aptidao.apto && aptidao.status !== 'apto-parou') return null;
    return {
        area: 'captura-saida',
        motivo: aptidao.status === 'apto-parou'
            ? 'A saída chegava por trilho automático e PAROU — suspeita de regressão.'
            : 'Nenhuma nota de saída chegou por trilho automático: o cliente não ligou o autXML nem o cofre.',
        acao: aptidao.acao || 'Envie as instruções da Cobertura de Saída e confirme com o cliente.',
        codigo: aptidao.status,
    };
}

/**
 * Bloqueio TÉCNICO: blocos do SPED que o cliente precisa e o CFI ainda não
 * fecha. Só vale pra quem ENTREGA EFD ICMS/IPI — sem IE não há livro pra
 * migrar, e bloquear serviço puro por bloco de ICMS trava a onda 1 inteira à
 * toa.
 */
function bloqueioBlocos(prontidao) {
    if (!prontidao) return null;
    if (!prontidao.entregaEfdIcms) return null;
    const lista = Array.isArray(prontidao.bloqueios) ? prontidao.bloqueios.filter(Boolean) : [];
    if (!lista.length) return null;
    return {
        area: 'blocos',
        motivo: `Bloco(s) do SPED ainda não fechado(s) para este perfil: ${lista.join(' · ')}.`,
        acao: 'Feche o bloco no card SPED Fiscal e valide no PVA antes de migrar este cliente.',
    };
}

/**
 * Fila de migração de UMA empresa.
 *
 * @param {object} p
 * @param {object} p.empresa    { id, nome, cnpj, regime }
 * @param {object} [p.veredito] saída de `vereditoDoCnpj` (prova de captura)
 * @param {object} [p.aptidao]  linha de `montarAptidaoSaida`
 * @param {object} [p.prontidao] linha de `montarProntidaoMigracao`
 */
export function montarFilaEmpresa({ empresa, veredito = null, aptidao = null, prontidao = null }) {
    const bloqueios = [
        bloqueioEntrada(veredito),
        bloqueioSaida(aptidao),
        bloqueioBlocos(prontidao),
    ].filter(Boolean);

    // Ressalva ≠ bloqueio: aparece, mas não segura a migração.
    const ressalvas = (prontidao?.entregaEfdIcms && Array.isArray(prontidao.atencoes))
        ? prontidao.atencoes.filter(Boolean)
        : [];

    const proximo = bloqueios[0] || null;
    return {
        empresaId: empresa?.id || null,
        nome: empresa?.nome || '—',
        cnpj: String(empresa?.cnpj || '').replace(/\D/g, ''),
        regime: empresa?.regime || null,
        // A onda é o que decide se bloco de ICMS pesa neste cliente.
        onda: prontidao?.entregaEfdIcms ? 'efd-icms' : 'servico-puro',
        pronta: bloqueios.length === 0,
        esforco: bloqueios.length,
        bloqueios,
        ressalvas,
        proximoPasso: proximo
            ? { area: proximo.area, motivo: proximo.motivo, acao: proximo.acao, onde: ONDE[proximo.area] }
            : null,
    };
}

/**
 * A fila da carteira, ordenada por quem está mais perto de migrar.
 *
 * @param {object} p
 * @param {Array} p.empresas
 * @param {Map|object} p.vereditos  empresaId → veredito da prova de captura
 * @param {Map|object} p.aptidoes   empresaId → linha de aptidão
 * @param {Map|object} p.prontidoes empresaId → linha de prontidão
 */
export function montarFilaMigracao({ empresas = [], vereditos, aptidoes, prontidoes } = {}) {
    const ler = (fonte, id) => {
        if (!fonte || !id) return null;
        if (typeof fonte.get === 'function') return fonte.get(id) || null;
        return fonte[id] || null;
    };

    const linhas = (empresas || []).map((e) => montarFilaEmpresa({
        empresa: e,
        veredito: ler(vereditos, e.id),
        aptidao: ler(aptidoes, e.id),
        prontidao: ler(prontidoes, e.id),
    }));

    // Quem está a UM passo vem antes de quem está a três: é assim que a onda
    // anda. Alfabético aqui seria uma lista, não uma fila.
    linhas.sort((a, b) => (a.esforco - b.esforco)
        || AREAS_BLOQUEIO.indexOf(a.proximoPasso?.area) - AREAS_BLOQUEIO.indexOf(b.proximoPasso?.area)
        || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    return { linhas, resumo: resumirFila(linhas) };
}

/** Onde a carteira está travada, e qual é o gargalo dominante. */
export function resumirFila(linhas) {
    const total = (linhas || []).length;
    const prontas = (linhas || []).filter((l) => l.pronta).length;
    const porArea = {};
    for (const l of linhas || []) {
        const a = l.proximoPasso?.area;
        if (a) porArea[a] = (porArea[a] || 0) + 1;
    }
    const dominante = AREAS_BLOQUEIO
        .filter((a) => porArea[a])
        .sort((x, y) => porArea[y] - porArea[x])[0] || null;

    // Carteira inteira "pronta" sem sinal nenhum seria o falso-verde clássico:
    // quem não tem prova NÃO chega aqui como pronta (bloqueioEntrada/Saida
    // devolvem bloqueio quando a leitura falta), então este número é honesto.
    return {
        total,
        prontas,
        bloqueadas: total - prontas,
        porArea,
        gargalo: dominante ? { area: dominante, qtd: porArea[dominante], onde: ONDE[dominante] } : null,
        // Onda 1 (serviço puro) não depende de bloco nenhum do SPED — separar
        // é o que impede a fila de PARECER travada quando metade já podia ir.
        servicoPuro: (linhas || []).filter((l) => l.onda === 'servico-puro').length,
        servicoPuroPronto: (linhas || []).filter((l) => l.onda === 'servico-puro' && l.pronta).length,
        resumo: total === 0
            ? 'Nenhuma empresa na seleção.'
            : `${prontas} de ${total} empresa(s) prontas para migrar`
                + (dominante ? ` — o gargalo é ${dominante} (${porArea[dominante]} empresa(s)).` : '.'),
    };
}
