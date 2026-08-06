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

import { cnpjEmitente, ufEmitente, modeloDoDoc } from './participante-doc-helper.js';

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
 * Sinais do BLOCO K (controle da produção e do estoque). O de-para marcava o
 * bloco como 🔴 "depende do F0 (quantas indústrias reais)" — e essa pergunta
 * os DADOS respondem, como já respondiam a do E310.
 *
 * IPI destacado não basta: o comércio equiparado destaca IPI e NÃO industrializa.
 * O que caracteriza produção é o CFOP —
 *   5101/6101 venda de produção DO ESTABELECIMENTO
 *   5124/5125/6124/6125 industrialização efetuada PARA outra empresa
 *   5901/5902/6901/6902 remessa/retorno de industrialização por encomenda
 */
const CFOP_PRODUCAO_PROPRIA = new Set(['5101', '6101']);
const CFOP_INDUSTRIALIZACAO = new Set([
    '5124', '5125', '6124', '6125',
    '5901', '5902', '6901', '6902',
]);

/**
 * Tipo do documento a partir do modelo (fonte forte) ou do campo `tipo`.
 * 55 NF-e · 65 NFC-e · 57 CT-e · 58 MDF-e · NFS-e não tem modelo numérico.
 */
function tipoDoDoc(d) {
    // NFS-e não tem chave de 44 dígitos — `modeloDoDoc` chutaria '55' pra ela.
    // Por isso o tipo declarado decide ANTES de derivar o modelo.
    const declarado = String(d?.tipoDoc || d?.tipo || '').replace(/^res/, '');
    if (/^NFSe/i.test(declarado)) return 'NFSe';
    // `modelo` NÃO é campo gravado no documento (a captura deriva da chave) —
    // ler `d.modelo` direto dava undefined pra TODA nota capturada, e foi o
    // que manteve "emissão própria 0" mesmo depois de arrumar o CNPJ (05/08).
    const modelo = so(d?.chave || d?.modelo) ? modeloDoDoc(d) : '';
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

/**
 * A empresa é contribuinte de ICMS? (Paulo, 05/08: "essas empresas são
 * prestadoras de serviços, não têm Inscrição Estadual".)
 *
 * Sem IE — ou com IE 'ISENTO' — ela NÃO entrega EFD ICMS/IPI. Não há SPED
 * Fiscal para gerar nem para conferir, então ela não é alvo da migração do
 * SPED: o que ela entrega é EFD Contribuições (PIS/COFINS) e ISS municipal.
 * Tratar essas empresas como "candidatas a piloto" foi o erro que este campo
 * corrige — o piloto seria comparar dois arquivos que não existem.
 */
export function entregaEfdIcms(empresa) {
    // Simples Nacional NÃO entrega EFD ICMS/IPI (a escrituração dele é o
    // PGDAS-D). Sinal de bloco do SPED Fiscal em empresa do Simples é RUÍDO:
    // aparece como atenção informativa, nunca como bloqueio de piloto.
    return contribuinteIcms(empresa) && empresa?.regime === 'lucro';
}

export function contribuinteIcms(empresa) {
    const ie = String(empresa?.inscricaoEstadual || '').trim().toUpperCase();
    if (!ie) return false;
    if (/^ISENT/.test(ie)) return false;
    return /\d/.test(ie);
}
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
            contribuinteIcms: contribuinteIcms(e),
            entregaEfdIcms: entregaEfdIcms(e),
            docs: 0,
            emiteProprio: 0,        // mod 55/65 com emitente == empresa
            stSaidas: 0,            // saída própria com ST → SUBSTITUTO (E220/GIA-ST)
            stEntradas: 0,          // entrada com ST → substituído (coberto: CST 60 em Outras)
            ipiSaidas: 0,           // IPI destacado em saída → indústria/equiparado
            entradasInterestaduais: 0, // candidata a DIFAL de aquisição
            saidasNaoContribuinte: 0,  // EC 87/15 → precisa E310/E316
            // BLOCO K: produção própria e industrialização por encomenda. IPI
            // sozinho não serve — comércio equiparado destaca IPI sem produzir.
            producaoPropria: 0,
            industrializacao: 0,
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
        // RÉGUA ÚNICA (participante-doc-helper): o documento vem em DUAS
        // formas — captura SEFAZ grava achatado (cnpjEmit/ufEmit), importação
        // de XML grava objeto (emitente.cnpjCpf/uf). Ler só o objeto zerava
        // TUDO que depende de "a empresa é a emitente": emissão própria, ST em
        // saída, IPI, E310 e compra interestadual. Caso 05/08: os 198 clientes
        // apareceram com "emissão própria 0", inclusive um com 4.527 notas.
        const emitEhEmpresa = cnpjEmitente(d) === emp.cnpj;
        const propriaEntrada = String(d.tpNF ?? '') === '0';
        const saidaPropria = emitEhEmpresa && !propriaEntrada;
        const temSt = (Number(t.vST) || 0) > 0 || (Number(t.vBCST) || 0) > 0;

        // Usa o tipo já resolvido (campo → chave → tipoDoc), não `d.modelo`.
        if (emitEhEmpresa && (tipo === 'NFe' || tipo === 'NFCe')) emp.emiteProprio++;
        if (temSt) { if (saidaPropria) emp.stSaidas++; else emp.stEntradas++; }
        if (saidaPropria && (Number(t.vIPI) || 0) > 0) emp.ipiSaidas++;
        // Venda interestadual a não contribuinte (EC 87/15): o CFOP é a prova
        // — 6107/6108 só existem pra essa operação.
        if (saidaPropria && (d.itens || []).some(
            (it) => CFOP_VENDA_NAO_CONTRIBUINTE.has(so(it?.cfop)),
        )) emp.saidasNaoContribuinte++;
        // Bloco K: o CFOP é a prova de que há PRODUÇÃO, e não só IPI.
        const cfops = (d.itens || []).map((it) => so(it?.cfop));
        if (saidaPropria && cfops.some((c) => CFOP_PRODUCAO_PROPRIA.has(c))) emp.producaoPropria++;
        if (cfops.some((c) => CFOP_INDUSTRIALIZACAO.has(c))) emp.industrializacao++;
        if (!saidaPropria && !emitEhEmpresa) {
            const ufEmit = ufEmitente(d);
            if (ufEmit && emp.uf && ufEmit !== emp.uf) emp.entradasInterestaduais++;
        }
    }

    const linhas = Array.from(porEmpresa.values())
        .filter((e) => e.docs > 0)
        .map((e) => {
            const foraDaPonte = Object.entries(e.porTipo)
                .filter(([t, n]) => n > 0 && !TIPOS_NA_PONTE_FML.has(t) && t !== 'outro')
                .reduce((s, [, n]) => s + n, 0);
            // Sinais de BLOCO do SPED Fiscal só bloqueiam quem entrega EFD
            // ICMS/IPI. Para o resto (Simples, prestadora sem IE) eles viram
            // atenção — o dado continua visível, sem fingir que trava algo.
            const bloqueios = [];
            const atencoesEfd = [];
            const paraEfd = (texto) => (e.entregaEfdIcms ? bloqueios : atencoesEfd).push(texto);
            if (e.stSaidas > 0) paraEfd(`ST em ${e.stSaidas} saída(s) — precisa E220/apuração ST`);
            // BLOCO K com PROVA nos CFOPs — diferente de "tem IPI, avalie".
            // Só se pode afirmar isso com itens lidos: sem eles, ausente ≠ zero.
            const sinalK = algumDocComItens && (e.producaoPropria > 0 || e.industrializacao > 0);
            if (sinalK) paraEfd(
                'PRODUÇÃO detectada pelos CFOPs ('
                + [
                    e.producaoPropria > 0 ? `${e.producaoPropria} venda(s) de produção própria` : null,
                    e.industrializacao > 0 ? `${e.industrializacao} de industrialização por encomenda` : null,
                ].filter(Boolean).join(' · ')
                + ') — é candidata REAL a bloco K, que o CFI ainda não gera',
            );
            else if (e.ipiSaidas > 0 || e.industriaCadastro) paraEfd(e.industriaCadastro
                ? 'indústria no cadastro, mas SEM CFOP de produção no período — confirmar se industrializa'
                : `IPI destacado em ${e.ipiSaidas} saída(s) sem CFOP de produção — provável equiparado (não é bloco K)`);
            if (algumDocComItens && e.saidasNaoContribuinte > 0) paraEfd(
                `${e.saidasNaoContribuinte} venda(s) interestadual(is) a não contribuinte (CFOP 6107/6108) `
                + '— EC 87/15: precisa E310/E316, que o CFI ainda não gera',
            );
            const atencoes = [...atencoesEfd];
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
                // Piloto do SPED FISCAL só faz sentido para contribuinte de
                // ICMS: sem IE não há EFD ICMS/IPI para comparar.
                candidataPiloto: e.regime === 'lucro' && e.contribuinteIcms && bloqueios.length === 0,
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
            // A resposta do F0 pro bloco K: zero aqui = bloco descartável como
            // o SAT; um que seja = alvo nomeado, sem levantamento manual.
            comProducaoParaBlocoK: linhas.filter((l) => l.producaoPropria > 0 || l.industrializacao > 0).length,
            comInterestadual: linhas.filter((l) => l.entradasInterestaduais > 0).length,
            comVendaNaoContribuinte: algumDocComItens
                ? linhas.filter((l) => l.saidasNaoContribuinte > 0).length
                : null,
            vendaNaoContribuinteApurada: algumDocComItens,
            // Cobertura documental — a pergunta do Paulo (05/08).
            contribuintesIcms: linhas.filter((l) => l.contribuinteIcms).length,
            semInscricaoEstadual: linhas.filter((l) => !l.contribuinteIcms).length,
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
