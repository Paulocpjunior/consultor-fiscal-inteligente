// ============================================================================
// sefaz-backend/auditoria-dono.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// RELATÓRIO DE AUDITORIA DO DONO (Paulo, 16/08: "só eu devo ter acesso").
// Consolida as trilhas que o app já grava numa LINHA DO TEMPO única: quem
// fez o quê, quando, em qual cliente — as ações que MEXEM COM DINHEIRO, com
// obrigação declarada ou com PODER dentro do app.
//
// DECISÕES QUE MANDAM:
// - **Acesso: ausência de configuração FECHA.** É o contrário do painel
//   Sistema→Banco (que abre pra todo admin quando a env não existe): aqui
//   "só eu" é o pedido, então sem lista válida ninguém entra. Um relatório
//   que mostra o que cada colaborador fez, aberto a todo admin, seria o
//   oposto do que foi pedido.
// - **Trilha que FALHOU a leitura vira `null`, nunca zero.** "Nenhuma
//   transmissão" com o banco fora do ar é a mentira mais cara deste
//   relatório — quem lê conclui que ninguém fez nada.
// - **Toda trilha diz DESDE QUANDO existe.** Auditoria de permissão nasceu
//   em 16/08; sem essa ressalva, "nenhuma mudança de acesso" seria lido
//   como "ninguém mexeu nas permissões", quando na verdade é "não havia
//   quem anotasse".
// - O relatório NÃO recalcula nada: lê o que as telas já produziram (mesma
//   régua dos Relatórios — relatório nunca tem conta própria).
// ============================================================================

/** Quem pode abrir. Sem env, valem os donos do escritório (default). */
export const DONOS_PADRAO = ['junior@spassessoriacontabil.com.br', 'p.c.pereira@me.com'];

export function donosConfigurados(env = process.env) {
    const daEnv = String(env.AUDITORIA_DONO_EMAILS || '')
        .split(/[;,]/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'));
    return daEnv.length ? daEnv : DONOS_PADRAO;
}

/**
 * O e-mail é de um dono? Ausência de e-mail (sessão sem claim) NUNCA passa —
 * indeterminado aqui FECHA, ao contrário do gate de departamento dos apps
 * irmãos (onde trancar o escritório por um serviço que piscou é o dano
 * maior). Aqui o dano maior é o inverso.
 */
export function ehDono(email, env = process.env) {
    const e = String(email || '').trim().toLowerCase();
    if (!e.includes('@')) return false;
    return donosConfigurados(env).includes(e);
}

// ─── Catálogo das trilhas ───────────────────────────────────────────────────
// `desde` = quando a trilha passou a ser gravada. Não é enfeite: é o que
// impede ler silêncio como ausência de ação.

export const TRILHAS = [
    {
        id: 'imposto-enviado', colecao: 'impostos_enviados', rotulo: 'Guia enviada ao cliente',
        peso: 'alto', desde: '2026-07-24', campoData: 'enviadoEm', campoQuem: 'enviadoPor',
    },
    {
        id: 'dctfweb-transmissao', colecao: 'dctfweb_transmissoes', rotulo: 'DCTFWeb transmitida',
        peso: 'critico', desde: '2026-08-12', campoData: 'transmitidoEm', campoQuem: 'transmitidoPor',
    },
    {
        id: 'mit-retificacao', colecao: 'dctfweb_mit_retificacoes', rotulo: 'MIT retificado',
        peso: 'critico', desde: '2026-07-24', campoData: 'em', campoQuem: 'por',
    },
    {
        id: 'reinf-lote', colecao: 'reinf_gateway_lotes', rotulo: 'Evento EFD-Reinf transmitido',
        peso: 'critico', desde: '2026-08-08', campoData: 'em', campoQuem: 'por',
    },
    {
        id: 'pgdas-sem-movimento', colecao: 'pgdas_sem_movimento', rotulo: 'PGDAS-D sem movimento declarado',
        peso: 'critico', desde: '2026-08-07', campoData: 'declaradoEm', campoQuem: 'declaradoPor',
    },
    {
        id: 'das-emitido', colecao: 'das_emitidos', rotulo: 'DAS emitido',
        peso: 'alto', desde: '2026-06-01', campoData: 'emitidoEm', campoQuem: 'emitidoPor',
    },
    {
        id: 'whatsapp-envio', colecao: 'whatsapp_envios', rotulo: 'Mensagem/guia por WhatsApp',
        peso: 'medio', desde: '2026-08-09', campoData: 'em', campoQuem: 'por',
    },
    {
        id: 'permissao', colecao: 'auditoria_permissoes', rotulo: 'Permissão alterada',
        peso: 'critico', desde: '2026-08-16', campoData: 'em', campoQuem: 'por',
    },
];

/** Firestore Timestamp · Date · string ISO → ISO. Ilegível → null. */
export function paraIso(v) {
    if (!v) return null;
    if (typeof v?.toDate === 'function') { try { return v.toDate().toISOString(); } catch { return null; } }
    if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null;
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Resumo humano do evento — o que a linha do tempo mostra. */
export function descreverEvento(trilhaId, d = {}) {
    const comp = d.competencia ? ` ${d.competencia}` : '';
    const emp = d.empresaNome || d.empresaCnpj || d.cnpj || d.empresaId || '';
    switch (trilhaId) {
        case 'imposto-enviado': return `${d.tipo || 'guia'}${comp} → ${d.para || 'cliente'}${d.canal ? ` (${d.canal})` : ''}`;
        case 'dctfweb-transmissao': return `${emp}${comp}${d.retificadora ? ' · RETIFICADORA' : ''}${d.justificativa ? ` · "${String(d.justificativa).slice(0, 60)}"` : ''}`;
        case 'mit-retificacao': return `${emp}${comp} · retificação do MIT`;
        case 'reinf-lote': return `${d.elementos || d.evento || 'evento'}${d.protocolo ? ` · protocolo ${d.protocolo}` : ''}${emp ? ` · ${emp}` : ''}`;
        case 'pgdas-sem-movimento': return `${emp}${comp} · declarado SEM MOVIMENTO`;
        case 'das-emitido': return `${emp}${comp}`;
        case 'whatsapp-envio': return `${d.template || d.referencia || 'mensagem'} → ${d.numeroEnviado || ''}`;
        case 'permissao': return `${d.alvoEmail || d.alvoUid || 'usuário'}: ${d.campo} ${JSON.stringify(d.de)} → ${JSON.stringify(d.para)}`;
        default: return '';
    }
}

/** Normaliza um doc de qualquer trilha para a linha do tempo. */
export function normalizarEvento(trilha, id, dados = {}) {
    return {
        id: `${trilha.id}:${id}`,
        trilha: trilha.id,
        rotulo: trilha.rotulo,
        peso: trilha.peso,
        em: paraIso(dados[trilha.campoData]) || paraIso(dados.em) || paraIso(dados.criadoEm),
        quem: dados[trilha.campoQuem] || dados.por || dados.enviadoPor || null,
        empresa: dados.empresaNome || dados.empresaCnpj || dados.cnpj || dados.empresaId || null,
        descricao: descreverEvento(trilha.id, dados),
    };
}

/**
 * Monta o relatório. `leituras` = [{trilha, docs}] ou [{trilha, erro}] — a
 * trilha que FALHOU entra em `naoLidas` e NÃO vira zero.
 */
export function montarAuditoria({ leituras = [], de = null, ate = null, quemFiltro = null }) {
    const eventos = [];
    const naoLidas = [];
    for (const l of leituras) {
        if (l.erro) { naoLidas.push({ trilha: l.trilha.id, rotulo: l.trilha.rotulo, motivo: l.erro }); continue; }
        for (const doc of l.docs || []) {
            eventos.push(normalizarEvento(l.trilha, doc.id, doc.dados));
        }
    }
    const dentro = eventos.filter((e) => {
        if (!e.em) return true;                        // sem data NÃO some: aparece e é contado
        if (de && e.em < de) return false;
        if (ate && e.em > ate) return false;
        return true;
    }).filter((e) => !quemFiltro || String(e.quem || '').toLowerCase() === String(quemFiltro).toLowerCase());

    dentro.sort((a, b) => String(b.em || '').localeCompare(String(a.em || '')));

    const porPessoa = new Map();
    const porTrilha = new Map();
    for (const e of dentro) {
        const p = e.quem || '(não registrado)';
        porPessoa.set(p, (porPessoa.get(p) || 0) + 1);
        porTrilha.set(e.trilha, (porTrilha.get(e.trilha) || 0) + 1);
    }

    return {
        total: dentro.length,
        semAutor: dentro.filter((e) => !e.quem).length,
        semData: dentro.filter((e) => !e.em).length,
        porPessoa: [...porPessoa.entries()].map(([quem, quantidade]) => ({ quem, quantidade }))
            .sort((a, b) => b.quantidade - a.quantidade),
        porTrilha: [...porTrilha.entries()].map(([trilha, quantidade]) => ({
            trilha, quantidade, rotulo: (TRILHAS.find((t) => t.id === trilha) || {}).rotulo || trilha,
        })).sort((a, b) => b.quantidade - a.quantidade),
        eventos: dentro,
        naoLidas,
        ressalvas: ressalvasDoPeriodo({ de, naoLidas, semAutor: dentro.filter((e) => !e.quem).length }),
    };
}

/**
 * As ressalvas que impedem a leitura errada do silêncio. Elas são o produto
 * tanto quanto os números.
 */
export function ressalvasDoPeriodo({ de, naoLidas = [], semAutor = 0 }) {
    const r = [];
    if (naoLidas.length) {
        r.push(`⚠️ ${naoLidas.length} trilha(s) NÃO foram lidas (${naoLidas.map((n) => n.rotulo).join(', ')}) — o total abaixo está INCOMPLETO, e ausência aqui não é prova de que nada aconteceu.`);
    }
    // Trilha mais nova que o início do período: o silêncio dela é "não havia
    // quem anotasse", não "ninguém fez".
    const novas = TRILHAS.filter((t) => de && t.desde > de);
    for (const t of novas) {
        r.push(`"${t.rotulo}" só é registrado desde ${t.desde.split('-').reverse().join('/')} — antes disso o app não anotava, então a ausência no início do período não significa que não houve.`);
    }
    if (semAutor > 0) {
        r.push(`${semAutor} evento(s) sem autor gravado — registro antigo, de antes de a trilha carimbar quem fez.`);
    }
    r.push('Este relatório LÊ as trilhas que as telas já gravam; ele não recalcula nada e não prova ausência de ação fora delas.');
    return r;
}
