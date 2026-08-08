// ============================================================================
// sefaz-backend/cadastro-central-departamentos.js  (PURO — testável)
// ----------------------------------------------------------------------------
// O USUÁRIO É UM SÓ, E O DEPARTAMENTO DIZ QUAL MÓDULO ELE ABRE.
//
// Decisão do Paulo (08/08), fechando o desenho do SaaS: *"cadastro de usuários
// unificado, mas devemos definir obrigatoriamente a qual departamento a pessoa
// pertence — após selecionado, ele passa a ter acesso ao módulo do app que ele
// foi vinculado"*. E tudo VIA TÚNEL: cada módulo fica no projeto dele (são
// projetos pagos); quem guarda o vínculo é o CFI, dono do cadastro.
//
// ═══ DEPARTAMENTO ≠ modulosPermitidos, e os dois convivem ═══════════════════
//
// `modulosPermitidos` libera CARDS dentro do CFI (Consulta Situação Fiscal,
// Emissão de Tributos…). O DEPARTAMENTO libera MÓDULO do SaaS — o app inteiro
// (Fiscal, Contábil, DP/Folha, Legalização, Financeiro). Misturar os dois numa
// lista só faria "liberar um card" e "liberar um app" parecerem a mesma
// decisão, e não são: uma é do dia a dia, a outra define onde a pessoa
// trabalha.
//
// ═══ AS REGRAS QUE NÃO SE AFROUXAM ══════════════════════════════════════════
//
// 1. Departamento DESCONHECIDO é RECUSADO na gravação, não descartado em
//    silêncio (a lição da whitelist #382: campo engolido = "salvo" que não
//    salvou).
// 2. Usuário SEM departamento NÃO some da lista — é pendência de vínculo, e o
//    módulo consultado nega o acesso DIZENDO isso (não "usuário inexistente").
// 3. Admin do CFI enxerga todos os módulos — mesma regra do resto do app.
// 4. Só admin grava departamento, e NUNCA via túnel: app irmão pergunta, não
//    define. Deixar o outro módulo gravar seria auto-concessão com uma
//    máquina no meio.
// ============================================================================

/**
 * O catálogo. `id` é o que viaja e o que fica gravado em users/{uid};
 * `modulo` é o nome do app como o Paulo o chama.
 */
export const DEPARTAMENTOS = [
    { id: 'fiscal', modulo: 'Consultor Fiscal', emoji: '🧾' },
    { id: 'contabil', modulo: 'Consultor Contábil', emoji: '📊' },
    { id: 'dp-folha', modulo: 'Consultor DP Folha de Pagamentos', emoji: '👥' },
    { id: 'legalizacao', modulo: 'Consultor Legalização', emoji: '📋' },
    { id: 'financeiro', modulo: 'Consultor Financeiro', emoji: '💰' },
];

const IDS_VALIDOS = new Set(DEPARTAMENTOS.map((d) => d.id));

const texto = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
};

/**
 * Valida uma lista de departamentos para GRAVAÇÃO.
 *
 * Desconhecido NÃO é descartado em silêncio: é recusa com a lista válida na
 * mensagem. Descartar faria o admin marcar uma caixa, ler "salvo" e o vínculo
 * não existir — o mesmo buraco da whitelist #382.
 */
export function validarDepartamentos(lista) {
    if (!Array.isArray(lista)) {
        return { ok: false, erro: 'Envie `departamentos` como lista (pode ser vazia para remover todos).' };
    }
    const limpos = [...new Set(lista.map((d) => String(d ?? '').trim().toLowerCase()).filter(Boolean))];
    const invalidos = limpos.filter((d) => !IDS_VALIDOS.has(d));
    if (invalidos.length) {
        return {
            ok: false,
            erro: `Departamento(s) desconhecido(s): ${invalidos.join(', ')}. `
                + `Válidos: ${[...IDS_VALIDOS].join(', ')}.`,
        };
    }
    return { ok: true, departamentos: limpos };
}

/**
 * Um doc de `users` → a forma que o túnel entrega. Sem hash de senha, sem
 * nada além do que o outro módulo precisa pra decidir acesso e falar com a
 * pessoa.
 */
export function normalizarUsuarioCadastro(doc) {
    if (!doc) return null;
    const uid = texto(doc.uid) || texto(doc.id);
    if (!uid) return null;
    const departamentos = Array.isArray(doc.departamentos)
        ? doc.departamentos.filter((d) => IDS_VALIDOS.has(d))
        : [];
    return {
        uid,
        nome: texto(doc.nome) || texto(doc.name) || texto(doc.displayName),
        email: texto(doc.email)?.toLowerCase() || null,
        role: texto(doc.role) || 'colaborador',
        departamentos,
        semDepartamento: departamentos.length === 0,
    };
}

/**
 * "Este usuário pode abrir este módulo?" — a pergunta que o app irmão faz no
 * login. A resposta SEMPRE tem motivo: negar sem dizer por quê manda a pessoa
 * procurar problema de senha quando o problema é vínculo.
 */
export function acessoAoModulo(usuario, moduloId) {
    const dep = DEPARTAMENTOS.find((d) => d.id === String(moduloId ?? '').trim().toLowerCase());
    if (!dep) {
        return {
            temAcesso: false,
            motivo: `Módulo desconhecido: "${moduloId}". Válidos: ${[...IDS_VALIDOS].join(', ')}.`,
        };
    }
    if (!usuario) {
        return {
            temAcesso: false,
            motivo: 'Usuário não encontrado no cadastro central. Confira o e-mail; se estiver certo, '
                + 'a conta precisa ser criada no Consultor Fiscal.',
        };
    }
    if (usuario.role === 'admin') {
        return { temAcesso: true, motivo: 'Administrador enxerga todos os módulos.' };
    }
    if (usuario.departamentos.includes(dep.id)) {
        return { temAcesso: true, motivo: `Vinculado ao departamento ${dep.modulo}.` };
    }
    if (usuario.semDepartamento) {
        // Pendência de vínculo, não conta inexistente — dizer a coisa errada
        // manda a pessoa redefinir senha à toa.
        return {
            temAcesso: false,
            motivo: `${usuario.nome || usuario.email || 'O usuário'} existe no cadastro mas está SEM `
                + 'departamento. Peça ao admin para vincular em Gerenciar Usuários no Consultor Fiscal.',
        };
    }
    return {
        temAcesso: false,
        motivo: `${usuario.nome || usuario.email || 'O usuário'} pertence a `
            + `${usuario.departamentos.map((d) => DEPARTAMENTOS.find((x) => x.id === d)?.modulo || d).join(', ')} `
            + `— não ao ${dep.modulo}. Se ele passou a atuar nesse módulo, o admin vincula em Gerenciar Usuários.`,
    };
}

/** O cadastro de usuários inteiro, como o túnel entrega. */
export function montarUsuariosCadastro(docs = []) {
    const usuarios = (docs || [])
        .map(normalizarUsuarioCadastro)
        .filter(Boolean)
        .sort((a, b) => String(a.nome || a.email).localeCompare(String(b.nome || b.email), 'pt-BR'));

    const semDepartamento = usuarios.filter((u) => u.semDepartamento && u.role !== 'admin').length;
    const porDepartamento = Object.fromEntries(DEPARTAMENTOS.map((d) => [
        d.id, usuarios.filter((u) => u.departamentos.includes(d.id)).length,
    ]));

    return {
        usuarios,
        departamentosValidos: DEPARTAMENTOS,
        resumo: {
            total: usuarios.length,
            admins: usuarios.filter((u) => u.role === 'admin').length,
            semDepartamento,
            porDepartamento,
        },
        avisos: avisosDosUsuarios({ total: usuarios.length, semDepartamento }),
    };
}

function avisosDosUsuarios({ total, semDepartamento }) {
    const out = [
        'Departamento se grava SÓ no Consultor Fiscal (Gerenciar Usuários), e só por admin. O túnel '
        + 'responde consultas — app irmão pergunta, não define: deixar outro módulo gravar seria '
        + 'auto-concessão com uma máquina no meio.',
    ];
    if (semDepartamento) {
        out.push(`${semDepartamento} colaborador(es) SEM departamento — eles não abrem módulo nenhum além do `
            + 'que o CFI já permitia, e a recusa no outro app diz isso (não "usuário inexistente").');
    }
    if (!total) {
        out.push('NENHUM usuário no cadastro. Isso não é "escritório sem equipe": é falha de leitura.');
    }
    return out;
}
