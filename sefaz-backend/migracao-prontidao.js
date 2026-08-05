// ============================================================================
// sefaz-backend/migracao-prontidao.js  (PURO — testável)
//
// F0 AUTOMÁTICO da migração E-Fiscal → CFI (03/08): as próprias notas
// capturadas dizem quem usa o quê — ST, IPI/indústria, compra interestadual,
// emissão própria — e o painel aponta sozinho os CANDIDATOS A PILOTO do SPED
// (fase F1 do plano), sem esperar levantamento manual.
//
// O que os DADOS não contam (fica de pergunta à equipe, e a tela lista):
// SAT/CF-e (mod 59 não é capturado), regime de CAIXA do Presumido (opção de
// cadastro), CIAP (controle interno) e DeSTDA (hábito de entrega).
//
// Farol honesto: detecção por competência — mês atípico pode esconder sinal.
// O painel diz o período olhado e nunca chama a lista de "definitiva".
// ============================================================================

const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);

/**
 * CFOPs de venda interestadual a NÃO CONTRIBUINTE — a operação da EC 87/15,
 * que obriga o remetente a partilhar o DIFAL com a UF de destino e a
 * escriturar E310/E316. Eles existem exatamente pra essa operação, então
 * servem de sinal sem depender de campo que a captura ainda não grava
 * (idDest/indFinal/indIEDest).
 *   6107 — venda de produção do estabelecimento a não contribuinte
 *   6108 — venda de mercadoria de terceiros a não contribuinte
 */
const CFOP_VENDA_NAO_CONTRIBUINTE = new Set(['6107', '6108']);

/**
 * Tipo do documento a partir do modelo (fonte forte) ou do campo `tipo`.
 * 55 NF-e · 65 NFC-e · 57 CT-e · 58 MDF-e · NFS-e não tem modelo numérico.
 */
function tipoDoDoc(d) {
    const modelo = so(d?.modelo);
    if (modelo === '55') return 'NFe';
    if (modelo === '65') return 'NFCe';
    if (modelo === '57') return 'CTe';
    if (modelo === '58') return 'MDFe';
    const t = String(d?.tipoDoc || d?.tipo || '').replace(/^res/, '');
    if (/^NFCe/i.test(t)) return 'NFCe';
    if (/^NFSe/i.test(t)) return 'NFSe';
    if (/^CTe/i.test(t)) return 'CTe';
    if (/^MDFe/i.test(t)) return 'MDFe';
    if (/^NFe/i.test(t)) return 'NFe';
    return 'outro';
}

/**
 * O que a ponte .FML leva pro E-Fiscal: SÓ NF-e e NFC-e (o exportador filtra
 * `['NFe','NFCe']`). CT-e e NFS-e o CFI captura e a ponte NUNCA mandou — se
 * ninguém digita lá (Paulo, 05/08: "o que mais o e-fiscal importa? nada"),
 * esses documentos não estão no livro de lá. É crédito de frete e retenção de
 * serviço fora da escrituração, no mês corrente.
 */
const TIPOS_NA_PONTE_FML = new Set(['NFe', 'NFCe']);
const so = (v) => String(v || '').replace(/\D/g, '');

/**
 * Avalia a prontidão de migração por empresa a partir dos docs do período.
 * @param {Array} docs      campos mínimos: empresaId, direcao, tpNF, status,
 *                          modelo, totais{vST,vBCST,vIPI}, emitente{cnpjCpf,uf}
 * @param {Array} empresas  {id, nome, cnpj, regime, uf, industriaCadastro}
 */
export function montarProntidaoMigracao(docs, empresas) {
    const porEmpresa = new Map();
    for (const e of empresas || []) {
        porEmpresa.set(e.id, {
            empresaId: e.id,
            nome: e.nome || '—',
            cnpj: so(e.cnpj),
            regime: e.regime || null,
            uf: String(e.uf || '').toUpperCase(),
            industriaCadastro: !!e.industriaCadastro,
            docs: 0,
            emiteProprio: 0,        // mod 55/65 com emitente == empresa
            stSaidas: 0,            // saída própria com ST → SUBSTITUTO (E220/GIA-ST)
            stEntradas: 0,          // entrada com ST → substituído (coberto: CST 60 em Outras)
            ipiSaidas: 0,           // IPI destacado em saída → indústria/equiparado
            entradasInterestaduais: 0, // candidata a DIFAL de aquisição
            saidasNaoContribuinte: 0,  // EC 87/15 → precisa E310/E316
            // Cobertura documental: o que a ponte .FML leva × o que fica.
            porTipo: { NFe: 0, NFCe: 0, CTe: 0, NFSe: 0, MDFe: 0, outro: 0 },
        });
    }

    // Sem `itens` na leitura, o sinal do E310 (CFOP 6107/6108) não existe —
    // e reportar 0 seria dizer "ninguém faz essa operação" quando na verdade
    // NÃO SE OLHOU. Farol honesto: ausente ≠ zero.
    let algumDocComItens = false;

    for (const d of docs || []) {
        const emp = porEmpresa.get(d.empresaId);
        if (!emp || CANCELADOS.has(d.status)) continue;
        emp.docs++;
        if (Array.isArray(d.itens) && d.itens.length > 0) algumDocComItens = true;
        const tipo = tipoDoDoc(d);
        emp.porTipo[tipo] = (emp.porTipo[tipo] || 0) + 1;
        const t = d.totais || {};
        const emitEhEmpresa = so(d.emitente?.cnpjCpf) === emp.cnpj;
        const propriaEntrada = String(d.tpNF ?? '') === '0';
        const saidaPropria = emitEhEmpresa && !propriaEntrada;
        const temSt = (Number(t.vST) || 0) > 0 || (Number(t.vBCST) || 0) > 0;

        if (emitEhEmpresa && ['55', '65'].includes(String(d.modelo))) emp.emiteProprio++;
        if (temSt) { if (saidaPropria) emp.stSaidas++; else emp.stEntradas++; }
        if (saidaPropria && (Number(t.vIPI) || 0) > 0) emp.ipiSaidas++;
        // Venda interestadual a não contribuinte (EC 87/15): o CFOP é a prova
        // — 6107/6108 só existem pra essa operação.
        if (saidaPropria && (d.itens || []).some(
            (it) => CFOP_VENDA_NAO_CONTRIBUINTE.has(so(it?.cfop)),
        )) emp.saidasNaoContribuinte++;
        if (!saidaPropria && !emitEhEmpresa) {
            const ufEmit = String(d.emitente?.uf || '').toUpperCase();
            if (ufEmit && emp.uf && ufEmit !== emp.uf) emp.entradasInterestaduais++;
        }
    }

    const linhas = Array.from(porEmpresa.values())
        .filter((e) => e.docs > 0)
        .map((e) => {
            const foraDaPonte = Object.entries(e.porTipo)
                .filter(([t, n]) => n > 0 && !TIPOS_NA_PONTE_FML.has(t) && t !== 'outro')
                .reduce((s, [, n]) => s + n, 0);
            const bloqueios = [];
            if (e.stSaidas > 0) bloqueios.push(`ST em ${e.stSaidas} saída(s) — precisa E220/apuração ST`);
            if (e.ipiSaidas > 0 || e.industriaCadastro) bloqueios.push(e.industriaCadastro
                ? 'indústria no cadastro — avaliar bloco K'
                : `IPI destacado em ${e.ipiSaidas} saída(s) — avaliar bloco K/CIAP`);
            if (algumDocComItens && e.saidasNaoContribuinte > 0) bloqueios.push(
                `${e.saidasNaoContribuinte} venda(s) interestadual(is) a não contribuinte (CFOP 6107/6108) `
                + '— EC 87/15: precisa E310/E316, que o CFI ainda não gera',
            );
            const atencoes = [];
            if (foraDaPonte > 0) atencoes.push(
                `${foraDaPonte} documento(s) que a ponte .FML NÃO leva ao E-Fiscal`
                + ` (${e.porTipo.CTe > 0 ? `${e.porTipo.CTe} CT-e` : ''}`
                + `${e.porTipo.CTe > 0 && e.porTipo.NFSe > 0 ? ' + ' : ''}`
                + `${e.porTipo.NFSe > 0 ? `${e.porTipo.NFSe} NFS-e` : ''})`
                + ' — o CFI escritura, o E-Fiscal não recebeu',
            );
            if (e.entradasInterestaduais > 0) atencoes.push(`${e.entradasInterestaduais} compra(s) interestadual(is) — conferir DIFAL de aquisição`);
            if (e.stEntradas > 0) atencoes.push(`${e.stEntradas} entrada(s) com ST (substituído — coberto pelo CFI)`);
            return {
                ...e,
                foraDaPonte,
                // null = NÃO APURADO (a leitura não trouxe itens), não "zero".
                saidasNaoContribuinte: algumDocComItens ? e.saidasNaoContribuinte : null,
                bloqueios,
                atencoes,
                candidataPiloto: e.regime === 'lucro' && bloqueios.length === 0,
            };
        })
        .sort((a, b) => {
            // Candidatas primeiro (mais movimento no topo); depois as bloqueadas.
            if (a.candidataPiloto !== b.candidataPiloto) return a.candidataPiloto ? -1 : 1;
            return b.docs - a.docs;
        });

    return {
        linhas,
        resumo: {
            comMovimento: linhas.length,
            candidatasPiloto: linhas.filter((l) => l.candidataPiloto).length,
            comStSaida: linhas.filter((l) => l.stSaidas > 0).length,
            comIpiOuIndustria: linhas.filter((l) => l.ipiSaidas > 0 || l.industriaCadastro).length,
            comInterestadual: linhas.filter((l) => l.entradasInterestaduais > 0).length,
            comVendaNaoContribuinte: algumDocComItens
                ? linhas.filter((l) => l.saidasNaoContribuinte > 0).length
                : null,
            vendaNaoContribuinteApurada: algumDocComItens,
            // Cobertura documental — a pergunta do Paulo (05/08).
            comCte: linhas.filter((l) => l.porTipo.CTe > 0).length,
            comNfse: linhas.filter((l) => l.porTipo.NFSe > 0).length,
            docsForaDaPonte: linhas.reduce((s, l) => s + l.foraDaPonte, 0),
        },
        // Respostas da equipe (03/08) — o que os dados não viam, agora visto.
        perguntasEquipe: [
            'SAT: NÃO existe mais na carteira — virou NFC-e mod 65, que o CFI já captura e escritura. Lacuna C800 DESCARTADA (equipe, 03/08).',
            'Regime de CAIXA no Presumido: NENHUM cliente optante (equipe, 03/08) — descartado.',
            'CIAP: SÓ a EXPERTE controla (equipe, 03/08) — o bloco G é caso único; a EXPERTE fica pra onda final da migração.',
            'DIFAL de aquisição: EXISTE — clientes compram de fora e pagam DIFAL (equipe, 03/08). As compras interestaduais marcadas ⚠ acima são o rastro; plano no de-para.',
            'E310/E316 (EC 87/15, DIFAL de VENDA a não contribuinte): os dados respondem sozinhos — '
            + 'ZERO empresa marcada acima significa que a carteira não faz essa operação e o bloco pode '
            + 'ser descartado como o SAT. Uma que seja, ele vira alvo de construção.',
        ],
    };
}
