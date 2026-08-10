// ============================================================================
// sefaz-backend/whatsapp-templates.js  (ESM, núcleo PURO)
// ----------------------------------------------------------------------------
// CADASTRO DE TEMPLATES DO WHATSAPP POR DEPARTAMENTO (Paulo, 10/08): a MESMA
// API da Meta (uma WABA, um token, guardado só no CFI) atende os 5 módulos —
// mas cada DEPARTAMENTO tem SEU template aprovado, e novos podem ser criados.
// Este módulo é o de-para: qual template cada departamento usa e o que cada
// variável ({{1}}, {{2}}…) significa.
//
// POR QUE UM CADASTRO (e não uma constante): template aprovado pela Meta é
// dado que MUDA (aprova, reprova, cria novo, muda idioma). Carimbar em código
// exigiria deploy a cada template. O cadastro deixa o admin LINKAR um template
// já aprovado (nome + idioma + o que cada variável quer dizer) e o app irmão
// só escolhe o dele.
//
// A TRAVA QUE IMPORTA: o remetente passa variáveis NOMEADAS
// ({cliente, competencia, ...}); este núcleo as ordena conforme o schema do
// template ({{1}}=cliente, {{2}}=competencia…). Passar posicional é a classe
// de erro do R-4020 (nome/posição sem prova) — variável faltando ou sobrando
// RECUSA o envio, nunca manda meio preenchido.
// ============================================================================

// Os 5 departamentos = 5 apps (mesma lista do gate de departamento).
export const DEPARTAMENTOS_WHATSAPP = new Set([
    'fiscal', 'contabil', 'dp-folha', 'legalizacao', 'financeiro',
]);

const RE_NOME_TEMPLATE = /^[a-z0-9_]{1,512}$/;   // regra da Meta: minúsculas, dígitos e _
const RE_IDIOMA = /^[a-z]{2}(_[A-Z]{2})?$/;      // pt_BR, en, es_ES…
const RE_CHAVE_VAR = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

/** id determinístico: departamento + nome (um template por par). */
export function idDoTemplate(departamento, nome) {
    return `${String(departamento || '').trim().toLowerCase()}__${String(nome || '').trim().toLowerCase()}`;
}

/**
 * Valida o cadastro de UM template. Retorna { ok, erros:[], template }.
 * Nome/idioma/variáveis fora do padrão da Meta são RECUSADOS (índice órfão
 * não se confere depois — mesma regra do cadastro de NCM/IVA-ST).
 */
export function validarTemplate(entrada) {
    const e = [];
    const t = entrada && typeof entrada === 'object' ? entrada : {};
    const departamento = String(t.departamento || '').trim().toLowerCase();
    const nome = String(t.nome || '').trim().toLowerCase();
    const idioma = String(t.idioma || 'pt_BR').trim();

    if (!DEPARTAMENTOS_WHATSAPP.has(departamento)) {
        e.push(`departamento desconhecido: "${t.departamento}" (use ${[...DEPARTAMENTOS_WHATSAPP].join(', ')})`);
    }
    if (!RE_NOME_TEMPLATE.test(nome)) {
        e.push(`nome do template inválido: "${t.nome}" — a Meta exige minúsculas, dígitos e "_"`);
    }
    if (!RE_IDIOMA.test(idioma)) {
        e.push(`idioma inválido: "${t.idioma}" (ex.: pt_BR)`);
    }
    const variaveis = Array.isArray(t.variaveis) ? t.variaveis : [];
    const chavesVistas = new Set();
    variaveis.forEach((v, i) => {
        const chave = String((v && v.chave) || '').trim();
        if (!RE_CHAVE_VAR.test(chave)) e.push(`variável [${i + 1}] com chave inválida: "${chave}"`);
        else if (chavesVistas.has(chave)) e.push(`variável [${i + 1}] repete a chave "${chave}"`);
        else chavesVistas.add(chave);
    });

    if (e.length) return { ok: false, erros: e, template: null };
    return {
        ok: true,
        erros: [],
        template: {
            id: idDoTemplate(departamento, nome),
            departamento,
            nome,
            idioma,
            descricao: String(t.descricao || '').trim().slice(0, 200),
            temDocumento: t.temDocumento === true,
            // ordem = {{1}}, {{2}}… — é o schema posicional do template
            variaveis: variaveis.map((v) => ({
                chave: String(v.chave).trim(),
                rotulo: String((v && v.rotulo) || v.chave).trim().slice(0, 60),
            })),
            ativo: t.ativo !== false,
        },
    };
}

/**
 * Ordena as variáveis NOMEADAS conforme o schema do template. Retorna
 * { ok, variaveis:[...], faltando:[...] }. Variável do schema ausente nos
 * valores = FALTANDO (recusa) — a Meta rejeita template com nº de variáveis
 * diferente, e mandar meio preenchido é pior. Valor extra que não está no
 * schema é ignorado (não quebra), mas não vai no envio.
 */
export function montarVariaveisPorSchema(template, valoresNomeados) {
    const valores = valoresNomeados && typeof valoresNomeados === 'object' ? valoresNomeados : {};
    const faltando = [];
    const variaveis = [];
    for (const def of (template.variaveis || [])) {
        const bruto = valores[def.chave];
        if (bruto === undefined || bruto === null || String(bruto).trim() === '') {
            faltando.push(def.chave);
            variaveis.push('');
        } else {
            variaveis.push(String(bruto));
        }
    }
    return { ok: faltando.length === 0, variaveis, faltando };
}

/**
 * Escolhe o template a usar a partir do que o remetente pediu:
 * - templateNome explícito vence;
 * - senão, o ÚNICO ativo do departamento;
 * - se houver vários e nenhum escolhido, é ambíguo (recusa nomeando as opções).
 */
export function resolverTemplate(cadastro, { departamento, templateNome } = {}) {
    const dep = String(departamento || '').trim().toLowerCase();
    const doDep = (cadastro || []).filter((t) => t.departamento === dep && t.ativo !== false);
    if (templateNome) {
        const alvo = doDep.find((t) => t.nome === String(templateNome).trim().toLowerCase());
        if (!alvo) {
            return { ok: false, erro: `Template "${templateNome}" não está cadastrado para o departamento ${dep}.`, opcoes: doDep.map((t) => t.nome) };
        }
        return { ok: true, template: alvo };
    }
    if (doDep.length === 1) return { ok: true, template: doDep[0] };
    if (doDep.length === 0) {
        return { ok: false, erro: `Nenhum template de WhatsApp cadastrado para o departamento ${dep}.`, opcoes: [] };
    }
    return { ok: false, erro: `O departamento ${dep} tem ${doDep.length} templates — informe qual usar.`, opcoes: doDep.map((t) => t.nome) };
}

export const _internals = { RE_NOME_TEMPLATE, RE_IDIOMA, RE_CHAVE_VAR };
