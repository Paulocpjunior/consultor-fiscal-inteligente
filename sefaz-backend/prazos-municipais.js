// ============================================================================
// sefaz-backend/prazos-municipais.js  (ESM, puro)
// ----------------------------------------------------------------------------
// O CALENDÁRIO MUNICIPAL — o buraco maior do mês do colaborador.
//
// Paulo, 11/08: *"os vencimentos são datas definidas pelos órgãos
// governamentais, sempre separados por esferas — federal, estadual, municipal;
// isso nunca se altera e é onde deve ser feita a consulta"*.
//
// O federal está completo, o estadual tem só SP (e desde 15/08 o app DENUNCIA
// quando entrega o prazo paulista a cliente de outra UF). O municipal era
// buraco inteiro: **não existe "dia do ISS" nacional**, cada prefeitura tem o
// seu, e carimbar o de SP seria inventar prazo. Por isso o ISS entrou no
// catálogo como PENDÊNCIA NOMEADA em vez de virar tarefa com data chutada.
//
// São ~157 empresas de serviço puro — as que NÃO fecham o mês no DAS. Para
// elas, a obrigação que mais importa é justamente a que o app não sabia datar.
//
// ═══ ESTE MÓDULO NÃO INVENTA PRAZO. ELE GUARDA O QUE ALGUÉM CONFERIU ════════
//
// A régua é a MESMA do IVA-ST (`ncm-parametros.js`), e pela mesma razão: prazo
// de tributo MUDA por lei municipal, então o cadastro tem VIGÊNCIA e a
// resolução é **pela data do fato**, nunca "o mais recente". Sem isso, uma
// competência antiga seria recalculada com a regra nova e o erro só apareceria
// na fiscalização.
//
// TRÊS TRAVAS QUE OS TESTES PROTEGEM:
//  (1) cadastro SEM base legal é RECUSADO — prazo órfão não se confere depois,
//      e daqui a três meses ninguém lembra de onde veio aquele dia 15;
//  (2) município SEM cadastro NÃO herda o de ninguém: continua pendência
//      nomeada, que é o estado honesto;
//  (3) quem cadastrou e quando ficam gravados — data de pagamento que muda
//      sozinha é multa de um lado ou "atrasada" falsa do outro.
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const ehData = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// ═══ GENERALIZAÇÃO PARA A ESFERA ESTADUAL (15/08) ═══════════════════════════
//
// De manhã o app passou a DENUNCIAR que o prazo do SPED (`UF:SP`, CAT
// 147/2009) era entregue a cliente de qualquer estado. Denunciar sem dar saída
// é meia correção: quem é do Paraná via o alerta e não tinha onde cadastrar o
// prazo do Paraná.
//
// O calendário municipal já resolvia isso para a esfera municipal, com
// vigência e base legal. A esfera ESTADUAL tem a MESMA necessidade e a mesma
// régua — então é o mesmo núcleo, com o ESCOPO variando: 'IBGE:3550308' para
// município, 'UF:PR' para estado. Duas cópias da resolução por vigência seria
// o defeito que este projeto mais paga.

/** Escopo canônico de um cadastro: 'IBGE:3550308' ou 'UF:PR'. */
export function escopoDoPrazo(p) {
    const mun = soDigitos(p?.codMunIBGE);
    if (mun.length === 7) return `IBGE:${mun}`;
    const uf = String(p?.uf || '').trim().toUpperCase();
    if (uf.length === 2) return `UF:${uf}`;
    return '';
}

/** Escopo do CLIENTE para uma obrigação, pela abrangência dela. */
export function escopoDoCliente({ esfera, uf, codMunIBGE }) {
    if (esfera === 'estadual') {
        const u = String(uf || '').trim().toUpperCase();
        return u.length === 2 ? `UF:${u}` : '';
    }
    const m = soDigitos(codMunIBGE);
    return m.length === 7 ? `IBGE:${m}` : '';
}

/** Código IBGE de município tem 7 dígitos. */
export function ehCodigoIbgeMunicipio(v) {
    return soDigitos(v).length === 7;
}

/**
 * Valida um cadastro de prazo municipal.
 *
 * @returns {{ok: boolean, erros: string[]}}
 */
export function validarPrazoMunicipal(p) {
    const erros = [];

    // MUNICIPAL pede IBGE; ESTADUAL pede UF. Um dos dois, nunca nenhum —
    // cadastro sem escopo não casa com cliente nenhum e vira lixo silencioso.
    if (!escopoDoPrazo(p)) {
        erros.push(String(p?.esfera || '') === 'estadual'
            ? 'Informe a UF (2 letras) — é ela que casa com o cadastro do cliente.'
            : 'Informe o código IBGE do município (7 dígitos) — é ele que casa com o cadastro do cliente.');
    }
    if (!String(p?.obrigacao || '').trim()) {
        erros.push('Informe a obrigação (ex.: ISS).');
    }

    const dia = Number(p?.diaVencimento);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
        erros.push('Dia de vencimento deve ser um número de 1 a 31.');
    }

    const mesesApos = p?.mesesApos;
    if (mesesApos !== undefined && mesesApos !== null
        && (!Number.isInteger(Number(mesesApos)) || Number(mesesApos) < 0 || Number(mesesApos) > 12)) {
        erros.push('“Meses após a competência” deve ser um inteiro de 0 a 12.');
    }

    // 🚨 SEM BASE LEGAL NÃO ENTRA. É a mesma recusa do IVA-ST sem Portaria:
    // número guardado sem a norma de origem é número que ninguém consegue
    // conferir depois — e prazo é o que decide se há multa.
    if (String(p?.baseLegal || '').trim().length < 5) {
        erros.push('Informe a base legal (lei/decreto municipal ou o link do calendário oficial). '
            + 'Prazo sem a norma de origem não se confere depois.');
    }

    const ini = String(p?.vigenciaInicio || '').slice(0, 10);
    const fim = String(p?.vigenciaFim || '').slice(0, 10);
    if (ini && !ehData(ini)) erros.push('Vigência inicial deve ser AAAA-MM-DD.');
    if (fim && !ehData(fim)) erros.push('Vigência final deve ser AAAA-MM-DD.');
    if (ini && fim && ehData(ini) && ehData(fim) && fim < ini) {
        erros.push('Vigência final anterior à inicial.');
    }

    const ajuste = p?.ajusteDiaNaoUtil;
    if (ajuste && !['antecipa', 'prorroga'].includes(ajuste)) {
        erros.push('Ajuste de dia não útil deve ser "antecipa" ou "prorroga".');
    }

    return { ok: erros.length === 0, erros };
}

/**
 * A competência cai dentro da vigência do cadastro?
 *
 * Compara por COMPETÊNCIA ('AAAA-MM'), que é o eixo do mês fiscal — a vigência
 * é gravada como data e cortada no mês. Prazo publicado no meio do mês vale
 * para a competência inteira: quem paga não recolhe "meio mês" pela regra
 * velha e meio pela nova.
 */
export function vigenteNaCompetencia(cadastro, competencia) {
    const comp = String(competencia || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(comp)) return false;
    const ini = String(cadastro?.vigenciaInicio || '').slice(0, 7);
    const fim = String(cadastro?.vigenciaFim || '').slice(0, 7);
    if (ini && comp < ini) return false;
    if (fim && comp > fim) return false;
    return true;
}

/**
 * Resolve o prazo de UMA obrigação municipal para UM cliente.
 *
 * @param {Array}  cadastros  prazos cadastrados
 * @param {object} p
 * @param {string} p.codMunIBGE   município do cliente
 * @param {string} p.obrigacao    'ISS'
 * @param {string} p.competencia  'AAAA-MM'
 * @returns {{achou: boolean, prazo: object|null, motivo: string,
 *            situacao: 'cadastrado'|'municipio-sem-cadastro'|'municipio-ausente'|'fora-de-vigencia'}}
 */
export function resolverPrazoMunicipal(cadastros, { codMunIBGE, obrigacao, competencia }) {
    const mun = soDigitos(codMunIBGE);
    const obr = String(obrigacao || '').trim().toUpperCase();

    if (!ehCodigoIbgeMunicipio(mun)) {
        // AUSENTE ≠ SEM PRAZO. Sem o município do cliente não dá para procurar
        // o calendário dele — e a ação é no CADASTRO, não no calendário.
        return {
            achou: false, prazo: null, situacao: 'municipio-ausente',
            motivo: 'O município do cliente não está cadastrado (código IBGE), então não há calendário a consultar. '
                + 'Preencha o município nos Dados Fiscais.',
        };
    }

    const doMunicipio = (cadastros || []).filter((c) =>
        escopoDoPrazo(c) === `IBGE:${mun}`
        && String(c?.obrigacao || '').trim().toUpperCase() === obr
        && c?.ativo !== false);

    if (doMunicipio.length === 0) {
        return {
            achou: false, prazo: null, situacao: 'municipio-sem-cadastro',
            motivo: `O calendário de ${obr} deste município ainda não está cadastrado no CFI. `
                + 'O app NÃO usa o prazo de outro município — cada prefeitura tem o seu.',
        };
    }

    // 🚨 VIGÊNCIA RESOLVE PELA DATA DO FATO, nunca "o mais recente". Competência
    // antiga tem que sair com a regra que valia NELA — é a régua do IVA-ST, e
    // ela existe porque o erro contrário só aparece na fiscalização.
    const vigentes = doMunicipio.filter((c) => vigenteNaCompetencia(c, competencia));
    if (vigentes.length === 0) {
        return {
            achou: false, prazo: null, situacao: 'fora-de-vigencia',
            motivo: `Há calendário de ${obr} cadastrado para este município, mas nenhum vigente em ${competencia}. `
                + 'Cadastre a vigência que cobre esta competência — o app não usa a regra de outro período.',
        };
    }

    // Empate: vence a vigência que começou DEPOIS (a mais específica para o
    // período). Cadastro sem início é o genérico e perde para o datado.
    const escolhido = [...vigentes].sort((a, b) =>
        String(b.vigenciaInicio || '').localeCompare(String(a.vigenciaInicio || '')))[0];

    return {
        achou: true,
        prazo: {
            codMunIBGE: mun,
            obrigacao: obr,
            diaVencimento: Number(escolhido.diaVencimento),
            mesesApos: Number.isFinite(Number(escolhido.mesesApos)) ? Number(escolhido.mesesApos) : 1,
            // Política do escritório (Paulo, 11/08): SEMPRE ANTECIPA. Pagar no
            // dia útil anterior nunca gera multa; o inverso, sim.
            ajusteDiaNaoUtil: escolhido.ajusteDiaNaoUtil || 'antecipa',
            baseLegal: escolhido.baseLegal,
            municipioNome: escolhido.municipioNome || null,
            vigenciaInicio: escolhido.vigenciaInicio || null,
            vigenciaFim: escolhido.vigenciaFim || null,
            // De quem é a decisão — prazo que muda sozinho é o que faz
            // desconfiar do número certo.
            cadastradoPorEmail: escolhido.cadastradoPorEmail || null,
            cadastradoEm: escolhido.cadastradoEm || null,
        },
        situacao: 'cadastrado',
        motivo: `Calendário de ${obr} de ${escolhido.municipioNome || mun} — ${escolhido.baseLegal}.`,
    };
}

/** Id determinístico: 1 doc por escopo × obrigação × início de vigência. */
export function idPrazoMunicipal(p) {
    const ini = String(p?.vigenciaInicio || 'sem-inicio').slice(0, 10);
    const escopo = escopoDoPrazo(p);
    // Municipal mantém o id HISTÓRICO (só os dígitos do IBGE): mudar a fórmula
    // orfanaria o que já estiver cadastrado. Estadual nasce com o prefixo.
    const chave = escopo.startsWith('IBGE:') ? escopo.slice(5) : escopo;
    return `${chave}_${String(p?.obrigacao || '').trim().toUpperCase()}_${ini}`;
}

/**
 * Resolve o prazo de uma obrigação de QUALQUER esfera cadastrável.
 *
 * O municipal continua com a porta própria (`resolverPrazoMunicipal`) porque
 * as causas de ausência dele são específicas — "cliente sem município" manda
 * ao cadastro do cliente, não ao calendário.
 */
export function resolverPrazoEstadual(cadastros, { uf, obrigacao, competencia }) {
    const escopo = escopoDoCliente({ esfera: 'estadual', uf });
    const obr = String(obrigacao || '').trim().toUpperCase();

    if (!escopo) {
        return {
            achou: false, prazo: null, situacao: 'uf-ausente',
            motivo: 'A UF do cliente não está cadastrada, então não há calendário estadual a consultar. '
                + 'Preencha a UF nos Dados Fiscais.',
        };
    }

    const daUf = (cadastros || []).filter((c) =>
        escopoDoPrazo(c) === escopo
        && String(c?.obrigacao || '').trim().toUpperCase() === obr
        && c?.ativo !== false);

    if (daUf.length === 0) {
        return {
            achou: false, prazo: null, situacao: 'uf-sem-cadastro',
            motivo: `O prazo de ${obr} de ${escopo.slice(3)} ainda não está cadastrado no CFI. `
                + 'O app NÃO usa o prazo de outro estado — cada SEFAZ tem o seu.',
        };
    }

    const vigentes = daUf.filter((c) => vigenteNaCompetencia(c, competencia));
    if (vigentes.length === 0) {
        return {
            achou: false, prazo: null, situacao: 'fora-de-vigencia',
            motivo: `Há prazo de ${obr} cadastrado para ${escopo.slice(3)}, mas nenhum vigente em ${competencia}.`,
        };
    }

    const escolhido = [...vigentes].sort((a, b) =>
        String(b.vigenciaInicio || '').localeCompare(String(a.vigenciaInicio || '')))[0];

    return {
        achou: true,
        prazo: {
            uf: escopo.slice(3),
            obrigacao: obr,
            diaVencimento: Number(escolhido.diaVencimento),
            mesesApos: Number.isFinite(Number(escolhido.mesesApos)) ? Number(escolhido.mesesApos) : 1,
            ajusteDiaNaoUtil: escolhido.ajusteDiaNaoUtil || 'antecipa',
            baseLegal: escolhido.baseLegal,
            vigenciaInicio: escolhido.vigenciaInicio || null,
            vigenciaFim: escolhido.vigenciaFim || null,
            cadastradoPorEmail: escolhido.cadastradoPorEmail || null,
        },
        situacao: 'cadastrado',
        motivo: `Prazo de ${obr} de ${escopo.slice(3)} — ${escolhido.baseLegal}.`,
    };
}

/**
 * Quantos municípios da carteira ainda não têm calendário — a fila de trabalho.
 *
 * Agrupa POR MUNICÍPIO (não por cliente): cadastrar um calendário resolve todos
 * os clientes daquela cidade de uma vez, e é assim que a fila fica curta em vez
 * de ter 157 linhas.
 */
export function municipiosSemCalendario(clientes, cadastros, { obrigacao = 'ISS', competencia } = {}) {
    const faltando = new Map();
    let semMunicipio = 0;

    for (const c of clientes || []) {
        // Optante do Simples NÃO recolhe ISS próprio (LC 123 art. 13, já está
        // no DAS): cobrar calendário por causa dele seria fila inflada com
        // trabalho que não muda guia nenhuma.
        if (String(c?.regime || '').toLowerCase() === 'simples') continue;

        const r = resolverPrazoMunicipal(cadastros, {
            codMunIBGE: c?.codMunIBGE, obrigacao, competencia,
        });
        if (r.achou) continue;
        if (r.situacao === 'municipio-ausente') { semMunicipio++; continue; }

        const mun = soDigitos(c?.codMunIBGE);
        if (!faltando.has(mun)) {
            faltando.set(mun, { codMunIBGE: mun, municipioNome: c?.municipioNome || null, situacao: r.situacao, clientes: [] });
        }
        faltando.get(mun).clientes.push({ id: c?.id || null, nome: c?.nome || '—', cnpj: soDigitos(c?.cnpj) });
    }

    const lista = [...faltando.values()]
        .map((m) => ({ ...m, total: m.clientes.length }))
        // Mais clientes primeiro: cadastrar aquele calendário rende mais.
        .sort((a, b) => b.total - a.total || String(a.codMunIBGE).localeCompare(String(b.codMunIBGE)));

    // COBERTURA ACUMULADA — a informação que decide ONDE PARAR.
    //
    // Uma lista de 57 cidades ordenada por volume ainda não diz quantas valem
    // a pena: o dono precisa saber que as 3 primeiras já cobrem 78% dos
    // clientes. Sem isso, ou ele cadastra 57 (trabalho que não rende) ou
    // cadastra 1 e acha que resolveu.
    const totalClientes = lista.reduce((s, m) => s + m.total, 0);
    let acumulado = 0;
    for (const m of lista) {
        acumulado += m.total;
        m.acumulado = acumulado;
        m.coberturaAcumuladaPct = totalClientes > 0 ? Math.round((acumulado / totalClientes) * 100) : 0;
    }

    return {
        municipios: lista,
        totalMunicipios: lista.length,
        totalClientes,
        /** Quantas cidades bastam para cobrir 80% dos clientes pendentes. */
        cidadesPara80: lista.findIndex((m) => m.coberturaAcumuladaPct >= 80) + 1 || lista.length,
        /** Cliente sem município cadastrado — a ação é OUTRA (é no cadastro). */
        clientesSemMunicipio: semMunicipio,
    };
}
