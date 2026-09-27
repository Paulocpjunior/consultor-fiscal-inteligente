// ============================================================================
// sefaz-backend/desempenho-colaboradores.js  (ESM, PURO — testável)
// ----------------------------------------------------------------------------
// 📊 DESEMPENHO POR COLABORADOR × EMPRESA — o que cada um EFETIVAMENTE executou.
//
// Paulo, 22/09: *"crie uma auditoria completa, capaz de mapear o desempenho,
// por colaborador x empresas, o que cada colaborador efetivamente executou nos
// últimos 2 meses, desde importações de xml, entrega de obrigações, envio de
// impostos, geração de guias, etc."*
//
// ═══ O QUE ESTE MÓDULO É, E O QUE NÃO É ═════════════════════════════════════
//
// Ele LÊ os carimbos que as telas já gravam (quem, quando, em qual empresa) e
// os cruza com a CARTEIRA. Não recalcula, não deduz e não "atribui" ato a
// ninguém: ato sem autor gravado vai para o balde "não identificado", ato do
// cron vai para "sistema", e cada trilha diz DESDE QUANDO carimba — silêncio
// antes disso é "não havia quem anotasse", nunca "não fez".
//
// A pergunta que ele responde é a do Paulo: *"o que cada colaborador fez, em
// quais empresas"* — e a que ele deixa visível é a inversa: *"quais empresas
// da carteira dele não receberam ato nenhum no período"*.
// ============================================================================

import { conjuntoCfi, filtrarEscopoCfi, ressalvaEscopoCfi, motivoInclusaoCfi } from './escopo-cfi.js';

/** As trilhas que contam como ATO de colaborador. `campoData` pode ser lista. */
export const TIPOS_ATO = Object.freeze([
    {
        id: 'xml-importado', rotulo: 'XML importado à mão', grupo: 'Documentos',
        colecao: 'documentos_fiscais', filtroIgual: { origem: 'manual' },
        campoData: ['importadoEm', 'createdAt', 'dataImportacao'], campoQuem: ['importadoPorEmail', 'importadoPor', 'createdByEmail', 'createdBy'],
        desde: null, carimbaQuem: true, leituraPorRange: false,
    },
    {
        // Concluir no Kanban é um CLIQUE — não prova entrega (Paulo, 22/09:
        // "não existe 1800 obrigações entregues por uma só pessoa"). A baixa
        // pelo rito de envio (`baixaOrigem: 'envio-imposto'`) sai como tipo
        // derivado próprio; a prova de entrega mora nas transmissões.
        id: 'tarefa-concluida', rotulo: 'Tarefa concluída no Kanban (clique)', grupo: 'Obrigações',
        colecao: 'tarefas', campoData: ['concluidaEm'], campoQuem: ['concluidaPor'],
        desde: null, carimbaQuem: true, leituraPorRange: true, tipoData: 'timestamp',
    },
    {
        id: 'imposto-enviado', rotulo: 'Guia enviada ao cliente', grupo: 'Guias',
        colecao: 'impostos_enviados', campoData: ['enviadoEm'], campoQuem: ['enviadoPor'],
        desde: '2026-07-24', carimbaQuem: true, leituraPorRange: true, tipoData: 'timestamp',
    },
    {
        id: 'das-emitido', rotulo: 'DAS emitido', grupo: 'Guias',
        colecao: 'das_emitidos', campoData: ['emitidoEm'], campoQuem: ['emitidoPor'],
        desde: '2026-06-01', carimbaQuem: false, leituraPorRange: true, tipoData: 'iso',
    },
    {
        id: 'dare-solicitada', rotulo: 'DARE solicitada', grupo: 'Guias',
        colecao: 'dare_solicitacoes', campoData: ['solicitadoEm'], campoQuem: ['solicitadoPor'],
        desde: null, carimbaQuem: true, leituraPorRange: true, tipoData: 'timestamp',
    },
    {
        id: 'dctfweb-transmitida', rotulo: 'DCTFWeb transmitida', grupo: 'Declarações',
        colecao: 'dctfweb_transmissoes', campoData: ['transmitidoEm', 'em'], campoQuem: ['transmitidoPor'],
        desde: '2026-08-12', carimbaQuem: true, leituraPorRange: false,
    },
    {
        id: 'reinf-lote', rotulo: 'EFD-Reinf transmitida', grupo: 'Declarações',
        colecao: 'reinf_gateway_lotes', campoData: ['em'], campoQuem: ['por'],
        desde: '2026-08-08', carimbaQuem: true, leituraPorRange: true, tipoData: 'timestamp',
        // O Consultor Contábil transmite pelo mesmo gateway (túnel) — `projetoOrigem` diz de quem é.
        compartilhada: true,
    },
    {
        id: 'pgdas-sem-movimento', rotulo: 'PGDAS-D sem movimento', grupo: 'Declarações',
        colecao: 'pgdas_sem_movimento', campoData: ['declaradoEm'], campoQuem: ['declaradoPor'],
        desde: '2026-08-07', carimbaQuem: true, leituraPorRange: false,
    },
    {
        id: 'fim-de-mes', rotulo: 'Fim de mês dado', grupo: 'Fechamento',
        colecao: 'fechamentos_competencia', campoData: ['fechadoEm'], campoQuem: ['fechadoPor.email', 'fechadoPor.uid'],
        desde: '2026-08-26', carimbaQuem: true, leituraPorRange: true, tipoData: 'iso',
    },
]);

/**
 * Tipos DERIVADOS de uma trilha (mesma coleção, ato diferente). `apos` diz
 * atrás de qual tipo base a coluna entra na tela.
 */
export const TIPOS_DERIVADOS = Object.freeze([
    { id: 'nfse-pdf-importada', rotulo: 'NFS-e importada por PDF', grupo: 'Documentos', base: 'xml-importado', apos: 'xml-importado' },
    { id: 'tarefa-baixada-rito', rotulo: 'Obrigação baixada pelo rito de envio', grupo: 'Obrigações', base: 'tarefa-concluida', apos: 'tarefa-concluida' },
]);

/** O tipo BASE (da trilha) de um id de ato — derivado ou não. */
export function tipoBaseDe(id) {
    const d = TIPOS_DERIVADOS.find((t) => t.id === id);
    return TIPOS_ATO.find((t) => t.id === (d ? d.base : id)) || null;
}

/** Lista de tipos para a tela: base + derivados, na ordem em que as colunas entram. */
export function tiposParaTela() {
    const out = [];
    for (const t of TIPOS_ATO) {
        out.push({ id: t.id, rotulo: t.rotulo, grupo: t.grupo, desde: t.desde, carimbaQuem: t.carimbaQuem });
        for (const d of TIPOS_DERIVADOS.filter((x) => x.apos === t.id)) {
            out.push({ id: d.id, rotulo: d.rotulo, grupo: d.grupo, desde: t.desde, carimbaQuem: t.carimbaQuem });
        }
    }
    return out;
}

/** Rajada: 10+ atos do MESMO tipo, da MESMA pessoa, no MESMO minuto = ação em lote, não N entregas. */
export const RAJADA_MINIMO_POR_MINUTO = 10;

/** Autores que são o SISTEMA, não uma pessoa. */
const AUTORES_DE_SISTEMA = new Set(['sistema', 'system', 'envio-imposto', 'cron', 'auto', 'automatico', 'automático']);

/** Firestore Timestamp · Date · número (ms) · string ISO → ISO. Ilegível → null. */
export function paraIso(v) {
    if (v == null || v === '') return null;
    if (typeof v?.toDate === 'function') { try { return v.toDate().toISOString(); } catch { return null; } }
    if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null;
    if (typeof v === 'object' && Number.isFinite(Number(v.seconds))) return new Date(Number(v.seconds) * 1000).toISOString();
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? new Date(v).toISOString() : null;
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function lerCaminho(obj, caminho) {
    return String(caminho).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function primeiro(obj, campos) {
    for (const c of campos || []) {
        const v = lerCaminho(obj, c);
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
}

/** Normaliza um doc de uma trilha para um ATO. */
export function normalizarAto(tipo, id, dados = {}) {
    const d = dados || {};
    const quemCru = primeiro(d, tipo.campoQuem);
    let tipoId = tipo.id;
    // A NFS-e importada por PDF e o XML importado à mão dividem a coleção; a
    // diferença é o tipo do documento — e para quem mede trabalho, são atos
    // diferentes.
    if (tipo.id === 'xml-importado' && String(d.tipo || '').toLowerCase() === 'nfse') tipoId = 'nfse-pdf-importada';
    if (tipo.id === 'tarefa-concluida' && String(d.baixaOrigem || '').toLowerCase() === 'envio-imposto') tipoId = 'tarefa-baixada-rito';
    return {
        id: `${tipoId}:${id}`,
        tipo: tipoId,
        em: paraIso(primeiro(d, tipo.campoData)),
        quem: quemCru == null ? null : String(quemCru).trim(),
        empresaId: d.empresaId ? String(d.empresaId) : null,
        empresaNome: d.empresaNome || d.razaoSocial || null,
        empresaCnpj: String(d.empresaCnpj || d.cnpj || '').replace(/\D/g, '') || null,
        competencia: d.competencia || (d.anoPA && d.mesPA ? `${String(d.mesPA).padStart(2, '0')}/${d.anoPA}` : null),
        detalhe: d.obrigacao || d.tipo || d.canal || null,
        projetoOrigem: d.projetoOrigem ? String(d.projetoOrigem) : null,
    };
}

export const ROTULOS_TIPO = Object.freeze({
    ...Object.fromEntries(TIPOS_ATO.map((t) => [t.id, t.rotulo])),
    ...Object.fromEntries(TIPOS_DERIVADOS.map((t) => [t.id, t.rotulo])),
});

/**
 * Resolve QUEM é o colaborador de um ato: e-mail (canônico) ou uid via
 * `usuarios`. Devolve a chave e o nome; 'sistema' e '(não identificado)' são
 * baldes próprios — nunca se atribui ato a uma pessoa por dedução.
 */
export function resolverColaborador(quem, usuarios = []) {
    const cru = String(quem || '').trim();
    if (!cru) return { chave: '(não identificado)', nome: '(não identificado)', email: null, uid: null, pessoa: false };
    const baixo = cru.toLowerCase();
    if (AUTORES_DE_SISTEMA.has(baixo)) return { chave: 'sistema', nome: 'sistema (cron/automático)', email: null, uid: null, pessoa: false };
    const porEmail = usuarios.find((u) => String(u?.email || '').toLowerCase() === baixo);
    if (porEmail) return { chave: baixo, nome: porEmail.name || porEmail.nome || baixo, email: baixo, uid: porEmail.id || porEmail.uid || null, pessoa: true };
    const porUid = usuarios.find((u) => String(u?.id || u?.uid || '') === cru);
    if (porUid) {
        const email = String(porUid.email || '').toLowerCase() || cru;
        return { chave: email, nome: porUid.name || porUid.nome || email, email: porUid.email ? email : null, uid: cru, pessoa: true };
    }
    // E-mail que não está no cadastro de usuários (ex-colaborador): continua
    // sendo uma pessoa, com o que se sabe dela.
    if (baixo.includes('@')) return { chave: baixo, nome: baixo, email: baixo, uid: null, pessoa: true };
    return { chave: `uid:${cru}`, nome: `(uid ${cru.slice(0, 8)}…)`, email: null, uid: cru, pessoa: true };
}

/**
 * A matriz colaborador × empresa × tipo de ato.
 *
 * @param {object} p
 * @param {Array}  p.atos       atos normalizados (`normalizarAto`)
 * @param {Array}  p.usuarios   docs de `users` ({id, name, email, role})
 * @param {Array}  p.vinculos   docs de `carteiras` ({colaboradorUid, colaboradorNome, empresaId, empresaNome, papel})
 * @param {Array}  p.naoLidas   trilhas que falharam ({tipo, rotulo, motivo})
 * @param {string} p.de  ISO   @param {string} p.ate ISO
 */
export function montarDesempenho({ atos = [], usuarios = [], vinculos = [], naoLidas = [], de = null, ate = null }) {
    // SÓ O CFI (Paulo, 22/09): `users` é o cadastro central de TODOS os
    // módulos — quem não é do Fiscal sai daqui, contado e nomeado.
    const conjunto = conjuntoCfi({ usuarios, vinculos });
    const { dentro: atosCfi, foraDoEscopo } = filtrarEscopoCfi(atos, conjunto, (a) => tipoBaseDe(a.tipo) || {});
    const dentro = atosCfi.filter((a) => {
        if (!a.em) return false;               // sem data não entra no período — vai contado à parte
        if (de && a.em < de) return false;
        if (ate && a.em > ate) return false;
        return true;
    });
    const semData = atosCfi.filter((a) => !a.em).length;

    // uid → e-mail da carteira: o vínculo grava o uid, e a chave do relatório é o e-mail.
    const chaveDoUid = (uid) => resolverColaborador(uid, usuarios).chave;

    const colaboradores = new Map();
    const garantir = (r) => {
        if (!colaboradores.has(r.chave)) {
            colaboradores.set(r.chave, {
                chave: r.chave, nome: r.nome, email: r.email, pessoa: r.pessoa,
                total: 0, porTipo: {}, empresas: new Map(), carteira: [],
                porque: null, minutos: new Map(),
            });
        }
        return colaboradores.get(r.chave);
    };

    // A carteira entra ANTES dos atos: colaborador com carteira e zero atos
    // precisa aparecer com zero, não sumir.
    for (const v of vinculos || []) {
        const chave = chaveDoUid(v.colaboradorUid);
        const r = resolverColaborador(v.colaboradorUid, usuarios);
        const c = garantir({ ...r, chave, nome: r.pessoa ? (r.nome === r.chave ? (v.colaboradorNome || r.nome) : r.nome) : r.nome });
        if (!c.carteira.some((e) => e.empresaId === v.empresaId)) {
            c.carteira.push({ empresaId: String(v.empresaId), empresaNome: v.empresaNome || '', papel: v.papel || null });
        }
    }

    for (const a of dentro) {
        const r = resolverColaborador(a.quem, usuarios);
        const c = garantir(r);
        c.total++;
        c.porTipo[a.tipo] = (c.porTipo[a.tipo] || 0) + 1;
        if (!c.porque) c.porque = motivoInclusaoCfi(a.quem, conjunto, tipoBaseDe(a.tipo) || {});
        // Rajada: mesmo tipo, mesmo minuto — a evidência de ação em lote.
        const chaveMin = `${a.tipo}|${String(a.em).slice(0, 16)}`;
        c.minutos.set(chaveMin, (c.minutos.get(chaveMin) || 0) + 1);
        const eid = a.empresaId || (a.empresaCnpj ? `cnpj:${a.empresaCnpj}` : '(sem empresa)');
        if (!c.empresas.has(eid)) {
            c.empresas.set(eid, { empresaId: eid, empresaNome: a.empresaNome || a.empresaCnpj || '(sem empresa)', total: 0, porTipo: {}, ultimoEm: null });
        }
        const e = c.empresas.get(eid);
        e.total++;
        e.porTipo[a.tipo] = (e.porTipo[a.tipo] || 0) + 1;
        if (!e.ultimoEm || a.em > e.ultimoEm) e.ultimoEm = a.em;
        if (!e.empresaNome || e.empresaNome === '(sem empresa)') e.empresaNome = a.empresaNome || e.empresaNome;
    }

    const totaisPorTipo = {};
    for (const a of dentro) totaisPorTipo[a.tipo] = (totaisPorTipo[a.tipo] || 0) + 1;

    const lista = [...colaboradores.values()].map((c) => {
        const empresas = [...c.empresas.values()].sort((x, y) => y.total - x.total || x.empresaNome.localeCompare(y.empresaNome));
        const idsComAto = new Set(empresas.map((e) => e.empresaId));
        const carteiraSemAto = c.carteira.filter((e) => !idsComAto.has(e.empresaId))
            .sort((x, y) => x.empresaNome.localeCompare(y.empresaNome));
        // Empresas em que agiu mas que NÃO são da carteira dele — informação,
        // não acusação: cobrir colega é trabalho.
        const idsCarteira = new Set(c.carteira.map((e) => e.empresaId));
        // Em lote: soma dos minutos com RAJADA_MINIMO_POR_MINUTO+ atos do mesmo tipo.
        const emLote = {};
        for (const [k, n] of c.minutos.entries()) {
            if (n < RAJADA_MINIMO_POR_MINUTO) continue;
            const tipo = k.split('|')[0];
            emLote[tipo] = (emLote[tipo] || 0) + n;
        }
        return {
            chave: c.chave, nome: c.nome, email: c.email, pessoa: c.pessoa,
            porque: c.porque || (c.carteira.length ? 'carteira de empresas vinculada' : null),
            emLote,
            total: c.total, porTipo: c.porTipo,
            empresasComAto: empresas.length,
            empresasDaCarteira: c.carteira.length,
            empresasDaCarteiraSemAto: carteiraSemAto,
            empresas: empresas.map((e) => ({ ...e, naCarteira: idsCarteira.has(e.empresaId) })),
        };
    }).sort((x, y) => {
        if (x.pessoa !== y.pessoa) return x.pessoa ? -1 : 1;
        return y.total - x.total || x.nome.localeCompare(y.nome);
    });

    return {
        periodo: { de, ate },
        totalAtos: dentro.length,
        semData,
        totaisPorTipo,
        colaboradores: lista,
        naoLidas,
        foraDoEscopo,
        ressalvas: ressalvasDoDesempenho({ de, naoLidas, semData, atos: dentro, foraDoEscopo, colaboradores: lista }),
    };
}

/** As ressalvas que impedem ler silêncio como inação. São produto, não rodapé. */
export function ressalvasDoDesempenho({ de, naoLidas = [], semData = 0, atos = [], foraDoEscopo = null, colaboradores = [] }) {
    const r = [];
    if (naoLidas.length) {
        r.push(`⚠️ ${naoLidas.length} trilha(s) NÃO foram lidas (${naoLidas.map((n) => n.rotulo).join(', ')}) — os totais estão INCOMPLETOS e ausência aqui não é prova de inação.`);
    }
    for (const t of TIPOS_ATO) {
        if (de && t.desde && t.desde > String(de).slice(0, 10)) {
            r.push(`"${t.rotulo}" só é carimbado desde ${t.desde.split('-').reverse().join('/')} — antes disso o app não anotava.`);
        }
        if (!t.carimbaQuem) {
            r.push(`"${t.rotulo}" NÃO grava quem fez: esses atos aparecem em "(não identificado)", não na pessoa.`);
        }
    }
    const naoIdentificados = atos.filter((a) => !a.quem).length;
    if (naoIdentificados > 0) r.push(`${naoIdentificados} ato(s) sem autor gravado — registro anterior ao carimbo, ou trilha que não carimba.`);
    if (semData > 0) r.push(`${semData} ato(s) sem data legível ficaram FORA do período (não dá para situá-los).`);
    r.push(ressalvaEscopoCfi(foraDoEscopo, { rotuloEvento: 'ato' }));
    // Rajadas: o número grande que NÃO é trabalho unitário — dito com nome.
    const rajadas = [];
    for (const c of colaboradores || []) {
        for (const [tipo, n] of Object.entries(c.emLote || {})) {
            rajadas.push({ nome: c.nome, tipo, n, total: c.porTipo?.[tipo] || n });
        }
    }
    rajadas.sort((a, b) => b.n - a.n);
    if (rajadas.length) {
        const top = rajadas.slice(0, 6).map((x) => `${x.nome}: ${x.n} de ${x.total} "${ROTULOS_TIPO[x.tipo] || x.tipo}"`);
        r.push(`⚡ AÇÃO EM LOTE, não N entregas: ${top.join('; ')}${rajadas.length > 6 ? `; e mais ${rajadas.length - 6}` : ''} — `
            + `${RAJADA_MINIMO_POR_MINUTO}+ atos do mesmo tipo no MESMO MINUTO. Limpeza ou baixa em massa conta como 1 ação, e a coluna "em lote" mostra quanto do total é isso.`);
    }
    if ((atos || []).some((a) => a.tipo === 'tarefa-concluida')) {
        r.push('"Tarefa concluída no Kanban" é um clique — não prova entrega. A prova está nas transmissões (DCTFWeb, Reinf, PGDAS) e na baixa pelo rito de envio, que saem em colunas próprias.');
    }
    r.push('O que NÃO passa por aqui não conta: SPED gerado, apuração conferida, cadastro corrigido e captura automática não têm carimbo de autor. Silêncio nessas frentes não é inação.');
    r.push('Este relatório LÊ os carimbos que as telas gravam; ele não recalcula nada, não deduz autor e não mede qualidade — mede atos registrados.');
    return r;
}

/** Período padrão: os últimos N meses até agora (ISO). */
export function periodoPadrao(meses = 2, agora = new Date()) {
    const ate = new Date(agora);
    const de = new Date(agora);
    de.setMonth(de.getMonth() - meses);
    return { de: de.toISOString(), ate: ate.toISOString() };
}
