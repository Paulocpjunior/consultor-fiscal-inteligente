// ============================================================================
// sefaz-backend/darf-departamentos.js   (PURO — sem io, testável)
//
// DE QUEM É CADA DÉBITO DO DARF DA DCTFWEB.
//
// 🚨 O CASO QUE ORIGINOU (Paulo, 17/08, HYPE CAFE 07/2026 — *"ERRO GRAVÍSSIMO"*):
// ele ia enviar o DARF de PIS/COFINS ao cliente e, *"por desencargo"*, abriu o
// PDF. Dentro vinha também o **1082 — CONTR PREV DESCONTA SEGURADO-EMPREGADO**,
// que é do DP/Folha. Se o DP mandar a guia dele, o cliente paga o 1082 DUAS
// VEZES. O app não dizia nada: o botão "Enviar pelo sistema" estava ali, e só o
// olho do dono pegou.
//
// ─── A VERDADE FISCAL QUE MANDA NO DESENHO ──────────────────────────────────
//
// **Não existe "escolher os impostos" de um DARF.** A Receita consolida os
// débitos por VENCIMENTO: um vencimento, uma cobrança, com todos os códigos
// daquela data. O que se pode fazer é emitir uma guia POR VENCIMENTO — e é
// exatamente por isso que a aba DARF já tem "Guias separadas por vencimento".
//
// No caso da HYPE isso RESOLVE por inteiro: o 1082 vence 20/08 e PIS/COFINS
// vencem 25/08, então as guias separadas produzem um DARF só do DP (20/08) e
// outro só do Fiscal (25/08). O que faltava não era a opção — era o app DIZER,
// antes do envio, que o DARF unificado mistura departamentos.
//
// ⚠️ E quando dois departamentos caem no MESMO vencimento, a guia É uma só por
// determinação da Receita. Aí não há o que separar, e o app precisa dizer isso
// em vez de prometer um recorte que não existe: a combinação passa a ser humana
// (um departamento envia, e o outro sabe que não deve).
//
// ─── COMO CLASSIFICA (a mesma régua do irrf-dctfweb-familias) ───────────────
//
//   1. quem manda é a DESCRIÇÃO do próprio débito — é o que a declaração AFIRMA;
//   2. o código de receita CORROBORA. Código e descrição discordando NÃO viram
//      escolha silenciosa: vai pra `nao-classificado`, nomeado;
//   3. código E descrição desconhecidos também são `nao-classificado` — e isso
//      **ACENDE o alerta**, nunca o apaga: débito que não sei de quem é pode
//      ser de outro departamento, e o silêncio aqui é o que dobra a cobrança.
//
// O de-para código → departamento NÃO é tabela oficial. Cada entrada carrega a
// FONTE, e entrada nova entra com o documento do lado.
// ============================================================================

/** Código de receita (raiz) → departamento, com a origem da informação. */
const CODIGO_DEPARTAMENTO = {
    // Conferido no DARF REAL da HYPE CAFE 07/2026 (PDF da Receita, 17/08).
    1082: { dep: 'dp-folha', fonte: 'DARF real (HYPE 07/2026)', confianca: 'alta' },
    2172: { dep: 'fiscal', fonte: 'DARF real (HYPE 07/2026)', confianca: 'alta' },
    8109: { dep: 'fiscal', fonte: 'DARF real (HYPE 07/2026)', confianca: 'alta' },
    // Conferido contra XML real do CONSXMLDECLARACAO (dctfweb-retencao-normalizer).
    1708: { dep: 'contabil', fonte: 'XML real da declaração (R-4020)', confianca: 'alta' },
    5610: { dep: 'dp-folha', fonte: 'XML real da declaração (folha)', confianca: 'alta' },
    // Lidos do extrato do e-CAC (DCTFWeb 07/2026).
    561: { dep: 'dp-folha', fonte: 'descrição da declaração (e-CAC)', confianca: 'media' },
    588: { dep: 'contabil', fonte: 'descrição da declaração (e-CAC)', confianca: 'media' },
    3208: { dep: 'contabil', fonte: 'descrição da declaração (e-CAC)', confianca: 'media' },
    // FUNRURAL — vieram do RECIBO do R-2099 (VINCENZO 07/2026, 13/08).
    1656: { dep: 'contabil', fonte: 'recibo do R-2099 (VINCENZO 07/2026)', confianca: 'alta' },
    1646: { dep: 'contabil', fonte: 'recibo do R-2099 (VINCENZO 07/2026)', confianca: 'alta' },
    1213: { dep: 'contabil', fonte: 'recibo do R-2099 (VINCENZO 07/2026)', confianca: 'alta' },
};

export const DEPARTAMENTOS_DARF = {
    'fiscal': { rotulo: '🧾 Fiscal', origem: 'MIT / apuração do faturamento' },
    'dp-folha': { rotulo: '👥 DP / Folha', origem: 'eSocial' },
    'contabil': { rotulo: '📊 Contábil', origem: 'EFD-Reinf (retenções)' },
    'nao-classificado': { rotulo: '❓ Não classificado', origem: 'origem não identificada' },
};

const norm = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase();

/**
 * O que a DESCRIÇÃO do débito afirma sobre o departamento de origem.
 *
 * ⚠️ A ORDEM É A REGRA, não detalhe de implementação:
 *
 * - **RETENÇÃO vem primeiro**: "CP RETIDA" / "RETENÇÃO 11%" é contribuição
 *   previdenciária, mas de SERVIÇO TOMADO — vai pela EFD-Reinf (Contábil), não
 *   pela folha. Se "CONTR PREV" fosse testado antes, a retenção do Contábil
 *   seria carimbada como DP e a mistura passaria batida na direção contrária.
 * - **FATURAMENTO** identifica o Fiscal com segurança: PIS/COFINS/IRPJ/CSLL
 *   sobre receita saem do MIT.
 * - **SEGURADO / PATRONAL / ASSALARIADO** é folha.
 */
export function departamentoPelaDescricao(descricao) {
    const d = norm(descricao);
    if (!d) return null;

    // 1) Retenção/recolhimento sobre terceiros ⇒ Reinf (Contábil).
    if (/\bRETID/.test(d) || /\bRETEN/.test(d) || /\bRETIDA\b/.test(d)) return 'contabil';
    if (d.includes('SERV PRESTADOS POR PJ') || d.includes('SERVICOS PRESTADOS POR PJ')) return 'contabil';
    if (d.includes('AQUISICAO DE PRODUCAO RURAL') || d.includes('PRODUCAO RURAL')) return 'contabil';

    // 2) Tributo sobre FATURAMENTO ⇒ apuração do Fiscal.
    if (d.includes('FATURAMENTO') || d.includes('RECEITA BRUTA')) return 'fiscal';
    if (/\bIRPJ\b/.test(d) || /\bCSLL\b/.test(d)) return 'fiscal';

    // 3) Contribuição previdenciária da própria folha ⇒ DP.
    if (d.includes('SEGURADO') || d.includes('EMPREGAD') || d.includes('PATRONAL')
        || /\bASSAL/.test(d) || d.includes('FOLHA') || d.includes('AVULSO')) return 'dp-folha';
    if (d.includes('CONTR PREV') || d.includes('CONTRIBUICAO PREVIDENCIARIA')) return 'dp-folha';

    return null;
}

/**
 * Classifica UM débito do DARF.
 *
 * @param {{codReceita?:string, codigo?:string, descricao?:string, valor?:number}} debito
 */
export function classificarDebitoDarf(debito) {
    const cod = String(debito?.codigo || debito?.codReceita || '').replace(/\D/g, '').slice(0, 4);
    const raiz = Number(cod);
    const daTabela = Number.isFinite(raiz) && raiz > 0 ? CODIGO_DEPARTAMENTO[raiz] : null;
    const daDescricao = departamentoPelaDescricao(debito?.descricao);

    if (!daTabela && !daDescricao) {
        return {
            departamento: 'nao-classificado',
            motivo: `Código ${cod || '?'} não está no de-para e a descrição não diz a origem `
                + `("${debito?.descricao || 'sem descrição'}"). Pode ser de outro departamento — confira antes de enviar.`,
            fonte: null, confianca: null,
        };
    }
    if (daTabela && daDescricao && daTabela.dep !== daDescricao) {
        return {
            departamento: 'nao-classificado',
            motivo: `Código ${cod} está mapeado como ${DEPARTAMENTOS_DARF[daTabela.dep].rotulo}, mas a descrição `
                + `("${debito?.descricao || ''}") indica ${DEPARTAMENTOS_DARF[daDescricao].rotulo}. `
                + 'Não escolho por você: confira antes de enviar.',
            fonte: null, confianca: null,
        };
    }
    const escolhida = daTabela || { dep: daDescricao, fonte: 'descrição da declaração', confianca: 'media' };
    return {
        departamento: escolhida.dep,
        motivo: `${DEPARTAMENTOS_DARF[escolhida.dep].rotulo} — ${DEPARTAMENTOS_DARF[escolhida.dep].origem}.`,
        fonte: escolhida.fonte,
        confianca: escolhida.confianca,
    };
}

const dinheiro = (n) => Number(n || 0);

/**
 * O DARF que está sobre a mesa mistura departamentos?
 *
 * `misturado` é a resposta que decide se o envio pode sair sem confirmação — e
 * ele é TRUE também quando há débito não classificado: não saber de quem é não
 * é o mesmo que saber que é meu.
 */
export function separarDarfPorDepartamento(debitos = []) {
    const grupos = new Map();
    let total = 0;

    for (const d of debitos || []) {
        const c = classificarDebitoDarf(d);
        const valor = dinheiro(d?.valor);
        total += valor;
        if (!grupos.has(c.departamento)) {
            grupos.set(c.departamento, {
                departamento: c.departamento,
                rotulo: DEPARTAMENTOS_DARF[c.departamento].rotulo,
                origem: DEPARTAMENTOS_DARF[c.departamento].origem,
                total: 0, linhas: [],
            });
        }
        const g = grupos.get(c.departamento);
        g.total += valor;
        g.linhas.push({
            codigo: String(d?.codigo || d?.codReceita || '').trim(),
            descricao: String(d?.descricao || '').trim(),
            valor,
            motivo: c.motivo,
            fonte: c.fonte,
        });
    }

    // Maior primeiro: é o que domina a guia.
    const lista = [...grupos.values()].sort((a, b) => b.total - a.total);
    const naoClassificados = grupos.get('nao-classificado')?.linhas || [];
    const reconhecidos = lista.filter(g => g.departamento !== 'nao-classificado');

    return {
        grupos: lista,
        total,
        departamentos: reconhecidos.map(g => g.departamento),
        naoClassificados,
        /**
         * TRUE quando a guia carrega mais de um departamento OU quando há débito
         * de origem desconhecida. Ausência de prova não é prova de ausência: o
         * silêncio aqui é justamente o que faria a cobrança dobrar.
         */
        misturado: reconhecidos.length > 1 || naoClassificados.length > 0,
    };
}

/**
 * A frase que vai na tela e na confirmação do envio.
 *
 * Diz o QUE está junto, QUANTO é de cada um, e a ÚNICA saída que a Receita
 * permite. Não promete escolher imposto — isso não existe.
 */
export function avisoDeMistura(separacao) {
    if (!separacao?.misturado) return null;
    const partes = (separacao.grupos || [])
        .map(g => `${g.rotulo} R$ ${g.total.toFixed(2).replace('.', ',')}`)
        .join(' + ');
    return {
        titulo: 'Esta guia NÃO é só do seu departamento',
        texto: `O DARF unificado soma ${partes} — total R$ ${Number(separacao.total || 0).toFixed(2).replace('.', ',')}. `
            + 'Se outro departamento enviar a guia dele, o cliente paga o mesmo débito DUAS VEZES.',
        acao: 'A Receita não deixa escolher imposto: ela consolida por VENCIMENTO. '
            + 'Use "Emitir guias separadas por vencimento" abaixo — quando os vencimentos diferem, cada '
            + 'departamento fica na sua guia. Se caírem no MESMO vencimento, a guia é uma só por determinação '
            + 'da Receita: combine quem envia, e envie UMA vez.',
    };
}
