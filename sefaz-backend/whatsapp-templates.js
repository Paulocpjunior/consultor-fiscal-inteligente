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

/**
 * Chave de variável normalizada: minúscula, sem acento e sem separadores.
 * "Competência", "competencia" e "COMPETENCIA" são a mesma variável.
 */
export function normalizarChave(v) {
    return String(v ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

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
    // ── A CHAVE CASA SEM DEPENDER DE CAIXA NEM DE ACENTO ────────────────────
    //
    // Caso 13/08: o template foi cadastrado com "Imposto", "Competencia" e
    // "Vencimento" (maiúscula inicial, como quem preenche um formulário
    // escreve), e o envio manda `imposto`/`competencia`/`vencimento`. O
    // casamento era EXATO, então as três "faltavam" e o WhatsApp recusava —
    // sobre um cadastro que está CERTO.
    //
    // Exigir a grafia exata é exigir julgamento de quem preenche a tela, e a
    // qualificação da equipe é restrição de projeto. Quem tem que se ajustar é
    // o código: "Competência", "competencia" e "COMPETENCIA" são a mesma coisa.
    // O que NÃO se normaliza é o SIGNIFICADO — chave desconhecida continua
    // faltando, com o nome como foi cadastrado.
    const mapa = new Map();
    for (const k of Object.keys(valores)) mapa.set(normalizarChave(k), valores[k]);

    const faltando = [];
    const variaveis = [];
    for (const def of (template.variaveis || [])) {
        const bruto = mapa.get(normalizarChave(def.chave));
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

// ─── 📝 Criar template NOVO na Meta (Paulo, 21/08: "existe a possibilidade
// de cadastro pelo nosso app?" — existe: a Graph API aceita a submissão).
// AQUI é só a VALIDAÇÃO (pura); quem fala com a Meta é o whatsapp-cloud.
// A recusa sai ANTES da rede, nomeada — template recusado pela Meta por
// forma é retrabalho de 24h de fila de aprovação.

/** Categorias que este cadastro aceita. AUTHENTICATION fica FORA nomeada:
 * é o formato especial de OTP (corpo gerado pela Meta), outro fluxo. */
export const CATEGORIAS_TEMPLATE_META = ['UTILITY', 'MARKETING'];

/**
 * Valida a SUBMISSÃO de um template novo. Devolve { ok, erros[], variaveis }.
 * As variáveis do corpo são {{1}},{{2}}… e têm que ser SEQUENCIAIS a partir
 * de 1 (a Meta recusa buraco); com variável no corpo, o EXEMPLO de cada uma
 * é obrigatório — é ele que o revisor da Meta lê.
 */
export function validarNovoTemplateMeta(entrada) {
    const e = [];
    const t = entrada && typeof entrada === 'object' ? entrada : {};
    const nome = String(t.nome || '').trim().toLowerCase();
    const idioma = String(t.idioma || 'pt_BR').trim();
    const categoria = String(t.categoria || 'UTILITY').trim().toUpperCase();
    const corpo = String(t.corpo || '').trim();
    const exemplos = (Array.isArray(t.exemplos) ? t.exemplos : []).map((x) => String(x ?? '').trim());

    if (!RE_NOME_TEMPLATE.test(nome)) {
        e.push(`nome inválido: "${t.nome}" — a Meta exige minúsculas, dígitos e "_" (ex.: aviso_guia_pronta)`);
    }
    if (!RE_IDIOMA.test(idioma)) e.push(`idioma inválido: "${t.idioma}" (ex.: pt_BR)`);
    if (!CATEGORIAS_TEMPLATE_META.includes(categoria)) {
        e.push(`categoria "${t.categoria}" não é aceita aqui — use UTILITY (aviso de serviço) ou MARKETING; AUTHENTICATION é o fluxo de OTP da Meta, outro cadastro`);
    }
    if (!corpo) e.push('o corpo da mensagem é obrigatório');
    if (corpo.length > 1024) e.push(`corpo com ${corpo.length} caracteres — a Meta aceita até 1024`);

    const posicoes = [...new Set((corpo.match(/\{\{\s*(\d+)\s*\}\}/g) || [])
        .map((m) => Number(m.replace(/\D/g, ''))))].sort((a, b) => a - b);
    const n = posicoes.length;
    if (n && (posicoes[0] !== 1 || posicoes[n - 1] !== n)) {
        e.push(`as variáveis do corpo têm que ser {{1}}…{{${n}}} sem buraco — vieram {{${posicoes.join('}}, {{')}}}`);
    }
    if (n && (exemplos.length !== n || exemplos.some((x) => !x))) {
        e.push(`o corpo tem ${n} variável(is) — informe UM exemplo para cada (é o que o revisor da Meta lê)`);
    }
    if (!n && exemplos.length) e.push('exemplos sem variável no corpo — apague os exemplos ou use {{1}} no texto');

    return {
        ok: e.length === 0,
        erros: e,
        variaveis: n,
        template: { nome, idioma, categoria, corpo, exemplos: n ? exemplos : [] },
    };
}

export const _internals = { RE_NOME_TEMPLATE, RE_IDIOMA, RE_CHAVE_VAR };
