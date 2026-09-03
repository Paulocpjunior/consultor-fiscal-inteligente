// ============================================================================
// sefaz-backend/prova-captura.js  (PURO — sem io, testável)
// ----------------------------------------------------------------------------
// "A captura DESTE CNPJ está completa?" — respondido contra a FONTE, não
// contra concorrente.
//
// Paulo, 28/07/2026 (caso NOVA ERA): 79 notas no CFI × 502 na SIEG. O app não
// tinha como responder sozinho, e por isso a equipe abria a SIEG pra conferir.
// A resposta própria existe e vem do cursor do DistDFe:
//
//   ultNSU  = até onde JÁ LEMOS da SEFAZ
//   maxNSU  = até onde a SEFAZ diz que TEM documento
//   maxNSU > ultNSU  ⇒  a captura está INCOMPLETA e o app SABE disso.
//
// Duas verdades estruturais que este módulo sempre declara, porque sem elas
// qualquer número engana:
//
//  1. MATRIZ e FILIAL são CNPJs DIFERENTES na SEFAZ. Cada um tem seu cursor e
//     seus documentos. Ver a filial e concluir sobre a matriz é o erro mais
//     fácil de cometer — por isso a prova sai SEMPRE por CNPJ da raiz, lado a
//     lado.
//  2. O DistDFe só entrega os documentos dos ÚLTIMOS ~90 DIAS, e só a partir
//     do primeiro acesso daquele CNPJ. Nota mais antiga que isso NUNCA virá
//     pela SEFAZ — só por importação (cofre de e-mail, XML do cliente,
//     migração). Um total menor que o de um sistema que acumula histórico há
//     anos pode ser exatamente isto, e não perda de captura.
// ============================================================================

import { modeloComItens } from './gravacao-nfe-regua.js';

const DIA_MS = 24 * 3600 * 1000;
export const JANELA_DISTDFE_DIAS = 90;

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const num = (v) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? n : null; };

const cancelado = (d) => ['cancelado', 'cancelada', 'denegado', 'inutilizado'].includes(d?.status);

// `modeloComItens` vem do dono (`gravacao-nfe-regua.js`) — estava recopiado aqui.

/** Resumo (resNFe) — nota que existe mas ainda sem o XML completo. */
export function ehResumo(d) {
    if (!d) return false;
    if (/^res(NFe|NFCe|CTe|MDFe)/.test(String(d.schema || ''))) return true;
    if (/^res/.test(String(d.tipoDoc || ''))) return true;
    return d.temItens === false && modeloComItens(d.chave);
}

/**
 * Veredito de UM CNPJ. A ordem importa: o primeiro problema encontrado é o que
 * trava a captura — mostrar "em dia" com o cadastro faltando seria mentira.
 */
export function vereditoDoCnpj(linha, agoraMs) {
    const { cadastro, state, docs } = linha;

    if (!cadastro) {
        return {
            farol: 'falha', codigo: 'nao-cadastrado',
            motivo: 'Este CNPJ não está cadastrado no CFI.',
            acao: 'Nada é capturado para um CNPJ que o app não conhece. Cadastre a empresa (matriz e filial são cadastros separados) e rode a captura.',
        };
    }
    if (cadastro.capturarSefaz === false) {
        return {
            farol: 'falha', codigo: 'captura-desligada',
            motivo: 'A captura automática está DESLIGADA para este CNPJ.',
            acao: 'Ligue em Central de XMLs → Captura → Status por Empresa.',
        };
    }
    if (Array.isArray(cadastro.motivosBloqueio) && cadastro.motivosBloqueio.length > 0) {
        return {
            farol: 'falha', codigo: 'bloqueada',
            motivo: `Captura NFe bloqueada: ${cadastro.motivosBloqueio.join(' · ')}.`,
            acao: 'Resolva o bloqueio (certificado A1 próprio ou da mesma raiz) — sem isso a SEFAZ não é consultada.',
        };
    }
    if (state?.nsuTravado) {
        return {
            farol: 'falha', codigo: 'travada',
            motivo: `A leitura parou no NSU ${state.nsuTravado} (documento que a SEFAZ não entrega).`,
            acao: 'Rode a captura desta empresa: o cursor pula o NSU travado depois das tentativas. Se persistir, use o reset de 90 dias.',
        };
    }

    const ult = num(state?.ultNSU);
    const max = num(state?.maxNSU);
    const pendencia = state?.pendenciaNSU != null
        ? Math.max(0, Number(state.pendenciaNSU) || 0)
        : (max != null && ult != null ? Math.max(0, max - ult) : 0);

    if (!state || ult == null || (ult === 0 && docs.total === 0)) {
        return {
            farol: 'falha', codigo: 'nunca-sincronizou',
            motivo: 'Nenhuma consulta ao DistDFe registrada para este CNPJ.',
            acao: 'Rode a captura agora. Se continuar zerado, confira certificado e o cadastro do CNPJ na SEFAZ.',
        };
    }
    if (pendencia > 0) {
        return {
            farol: 'falha', codigo: 'incompleta-na-fonte',
            motivo: `A SEFAZ tem ${pendencia} documento(s) ALÉM do que já lemos (lido até NSU ${ult}, disponível até ${max}).`,
            acao: 'Captura incompleta — rode a sincronização desta empresa até o cursor alcançar o máximo. Não é preciso conferir com ninguém: a própria SEFAZ está dizendo que falta.',
        };
    }
    if (max == null) {
        return {
            farol: 'atencao', codigo: 'sem-cursor',
            motivo: `Lemos até o NSU ${ult}, mas a última consulta não registrou o máximo da SEFAZ.`,
            acao: 'Rode a captura uma vez para gravar o cursor — sem o máximo não dá para afirmar que está completa.',
        };
    }

    const desatualizadaDias = state.ultimaSyncMs ? (agoraMs - state.ultimaSyncMs) / DIA_MS : null;
    if (desatualizadaDias != null && desatualizadaDias > 2) {
        return {
            farol: 'atencao', codigo: 'cursor-em-dia-mas-parada',
            motivo: `Alcançamos tudo que a SEFAZ tinha (NSU ${ult}), mas a última consulta foi há ${Math.floor(desatualizadaDias)} dia(s).`,
            acao: 'Rode a captura para trazer o que entrou depois disso.',
        };
    }
    // 🚨 CONFERIR RESUMO CUSTA VARRER OS DOCUMENTOS, e a varredura da CARTEIRA
    // não faz isso (seriam ~390 leituras). Quando o chamador não conferiu, ele
    // manda `null` — e o veredito DIZ que não conferiu, em vez de devolver
    // "em dia" por omissão. Verde por coisa que ninguém olhou é o pior farol.
    if (docs.resumosSemCompleta === null || docs.resumosSemCompleta === undefined) {
        return {
            farol: 'ok', codigo: 'cursor-em-dia',
            motivo: `Lemos tudo que a SEFAZ tem para este CNPJ (NSU ${ult} de ${max}).`,
            acao: null,
            // O que ESTE veredito não olhou. A conferência de resumo sem
            // completa é a etapa de VALIDAÇÃO da Rotina, não a de captura.
            naoConferido: 'resumo sem a NF-e completa',
        };
    }
    if (docs.resumosSemCompleta > 0) {
        return {
            farol: 'atencao', codigo: 'resumos-sem-completa',
            motivo: `Lemos tudo que a SEFAZ tinha, mas ${docs.resumosSemCompleta} nota(s) estão só como RESUMO (sem valor e sem itens).`,
            acao: 'Manifeste a ciência para liberar o XML completo — sem isso a apuração sai a menor.',
        };
    }
    return {
        farol: 'ok', codigo: 'em-dia-na-fonte',
        motivo: `Lemos tudo que a SEFAZ tem para este CNPJ (NSU ${ult} de ${max}).`,
        acao: null,
    };
}

/**
 * Prova de captura de uma RAIZ de CNPJ (matriz + filiais), lado a lado.
 *
 * @param {object} p
 * @param {string} p.cnpjAlvo   CNPJ consultado (a raiz dele manda)
 * @param {Array}  p.empresas   cadastros conhecidos [{cnpj, id, nome, regime, capturarSefaz, motivosBloqueio, certValido, tipoCert}]
 * @param {object} p.states     sefaz_state por CNPJ
 * @param {Array}  p.docs       documentos_fiscais da raiz
 * @param {number} p.agoraMs
 */
export function montarProvaCaptura({ cnpjAlvo, empresas = [], states = {}, docs = [], agoraMs = Date.now() }) {
    const raiz = soDigitos(cnpjAlvo).slice(0, 8);
    if (raiz.length !== 8) {
        return { ok: false, error: 'Informe um CNPJ válido (14 dígitos) para provar a captura.' };
    }

    // O universo é a UNIÃO de cadastro, cursor e documentos: um CNPJ com nota
    // capturada mas sem cadastro precisa aparecer — é justamente o caso que
    // faz o total "não bater".
    const cnpjs = new Set();
    for (const e of empresas) { const c = soDigitos(e.cnpj); if (c.slice(0, 8) === raiz) cnpjs.add(c); }
    for (const c of Object.keys(states)) { const n = soDigitos(c); if (n.slice(0, 8) === raiz) cnpjs.add(n); }
    for (const d of docs) { const c = soDigitos(d.empresaCnpj); if (c.slice(0, 8) === raiz) cnpjs.add(c); }
    const alvo14 = soDigitos(cnpjAlvo);
    if (alvo14.length === 14) cnpjs.add(alvo14);

    const porCnpj = new Map([...cnpjs].map((c) => [c, {
        cnpj: c,
        matriz: c.slice(8, 12) === '0001',
        cadastro: null,
        state: null,
        docs: {
            total: 0, entradas: 0, saidas: 0, resumosSemCompleta: 0, canceladas: 0,
            porCompetencia: {}, primeiraEmissao: null, ultimaEmissao: null,
        },
    }]));

    for (const e of empresas) {
        const linha = porCnpj.get(soDigitos(e.cnpj));
        if (linha) linha.cadastro = e;
    }
    for (const [c, st] of Object.entries(states)) {
        const linha = porCnpj.get(soDigitos(c));
        if (linha) linha.state = st;
    }

    let semDono = 0;
    for (const d of docs) {
        const linha = porCnpj.get(soDigitos(d.empresaCnpj));
        if (!linha) { semDono++; continue; }
        const alvoDocs = linha.docs;
        alvoDocs.total++;
        if (d.direcao === 'entrada') alvoDocs.entradas++;
        else if (d.direcao === 'saida') alvoDocs.saidas++;
        if (cancelado(d)) alvoDocs.canceladas++;
        else if (ehResumo(d)) alvoDocs.resumosSemCompleta++;
        if (d.competencia) alvoDocs.porCompetencia[d.competencia] = (alvoDocs.porCompetencia[d.competencia] || 0) + 1;
        const t = d.dhEmi ? new Date(d.dhEmi).getTime() : NaN;
        if (Number.isFinite(t)) {
            if (alvoDocs.primeiraEmissao == null || t < alvoDocs.primeiraEmissao) alvoDocs.primeiraEmissao = t;
            if (alvoDocs.ultimaEmissao == null || t > alvoDocs.ultimaEmissao) alvoDocs.ultimaEmissao = t;
        }
    }

    const linhas = [...porCnpj.values()]
        .map((l) => ({ ...l, veredito: vereditoDoCnpj(l, agoraMs) }))
        .sort((a, b) => (b.matriz - a.matriz) || a.cnpj.localeCompare(b.cnpj));

    const totalDocs = linhas.reduce((s, l) => s + l.docs.total, 0);
    const pendenciaTotal = linhas.reduce((s, l) => s + (Number(l.state?.pendenciaNSU) || 0), 0);
    const comFalha = linhas.filter((l) => l.veredito.farol === 'falha');
    const farol = comFalha.length > 0 ? 'falha'
        : linhas.some((l) => l.veredito.farol === 'atencao') ? 'atencao' : 'ok';

    // Corte real do DistDFe: nada anterior a isto chega pela SEFAZ.
    const corteMs = agoraMs - JANELA_DISTDFE_DIAS * DIA_MS;
    const docsAntesDoCorte = docs.filter((d) => {
        const t = d.dhEmi ? new Date(d.dhEmi).getTime() : NaN;
        return Number.isFinite(t) && t < corteMs;
    }).length;

    return {
        ok: true,
        raiz,
        cnpjAlvo: alvo14 || null,
        linhas,
        totalDocs,
        docsSemDono: semDono,
        farol,
        resumo: farol === 'ok'
            ? `Captura em dia na fonte: lemos tudo que a SEFAZ tem para os ${linhas.length} CNPJ(s) desta raiz (${totalDocs} documento(s)).`
            : comFalha.length > 0
                ? `${comFalha.length} de ${linhas.length} CNPJ(s) desta raiz com captura INCOMPLETA${pendenciaTotal > 0 ? ` — a SEFAZ tem ${pendenciaTotal} documento(s) que ainda não lemos` : ''}.`
                : `Captura alcançou o cursor da SEFAZ, mas há ressalvas nos ${linhas.length} CNPJ(s) desta raiz.`,
        // Sempre presente: sem isto, comparar totais com outro sistema engana.
        ressalvas: [
            'Matriz e filial são CNPJs diferentes na SEFAZ, com cursor e documentos próprios — compare sempre o mesmo CNPJ.',
            `O DistDFe entrega apenas os últimos ${JANELA_DISTDFE_DIAS} dias, e só a partir do primeiro acesso deste CNPJ. Documento mais antigo que isso não vem pela SEFAZ — só por importação (cofre de e-mail, XML do cliente).`,
            'Nota de SAÍDA não é entregue ao próprio emitente (Rejeição 641): ela chega pelo cofre de e-mail ou pelo autXML.',
        ],
        janelaDistDfeDias: JANELA_DISTDFE_DIAS,
        docsAntesDoCorte,
    };
}

// ============================================================================
// A CARTEIRA INTEIRA — "como estão as capturas?" numa resposta só.
// ----------------------------------------------------------------------------
// Paulo, 15/08: *"me atualize sobre as capturas de XML, como estão?"*
//
// A Prova de captura responde por UM CNPJ, e responde bem — mas para saber como
// está a CARTEIRA era preciso abrir a tela ~390 vezes. Ou seja: a pergunta mais
// natural do dono não tinha resposta no app, e a única saída era estimar de
// memória — que é o vício do "0/388" carimbado neste projeto.
//
// NENHUMA CONTA NOVA: cada CNPJ passa pelo MESMO `vereditoDoCnpj` da tela
// individual. Painel com conta própria diverge sozinho (lição do card 4).
//
// O agrupamento é POR VEREDITO, não por empresa, porque veredito é o que tem
// AÇÃO: "12 travadas no NSU" e "3 com certificado bloqueado" se resolvem de
// jeitos diferentes, e uma lista de 390 nomes não diz por onde começar.
// ============================================================================

/** Ordem de gravidade — quem exige ação primeiro aparece primeiro. */
const PESO_CODIGO = {
    'incompleta-na-fonte': 0,   // a SEFAZ DIZ que falta documento
    'travada': 1,
    'bloqueada': 2,
    'nunca-sincronizou': 3,
    'captura-desligada': 4,
    'nao-cadastrado': 5,
    'sem-cursor': 6,
    'cursor-em-dia-mas-parada': 7,
    'resumos-sem-completa': 8,
    'cursor-em-dia': 9,
    'em-dia-na-fonte': 10,
};

/**
 * @param {object} p
 * @param {Array}  p.empresas  cadastros [{cnpj, id, nome, regime, capturarSefaz, motivosBloqueio}]
 * @param {object} p.states    sefaz_state por CNPJ
 * @param {number} [p.limitePorGrupo] quantos nomes listar por grupo (o resto vai CONTADO)
 */
export function montarProvaCarteira({ empresas = [], states = {}, agoraMs = Date.now(), limitePorGrupo = 25 }) {
    const porCnpj = new Map();
    for (const e of empresas) {
        const c = soDigitos(e.cnpj);
        if (c.length !== 14) continue;
        porCnpj.set(c, { cnpj: c, cadastro: e, state: null, docs: { total: 0, resumosSemCompleta: null } });
    }
    // CNPJ com cursor e SEM cadastro não some: é justamente o caso que faz o
    // total não bater, e sumir dele é o que faz alguém achar que está tudo lá.
    for (const [c, st] of Object.entries(states)) {
        const n = soDigitos(c);
        if (n.length !== 14) continue;
        if (!porCnpj.has(n)) porCnpj.set(n, { cnpj: n, cadastro: null, state: st, docs: { total: 0, resumosSemCompleta: null } });
        else porCnpj.get(n).state = st;
    }

    const linhas = [...porCnpj.values()].map((l) => ({
        cnpj: l.cnpj,
        nome: l.cadastro?.nome || '—',
        regime: l.cadastro?.regime || null,
        matriz: l.cnpj.slice(8, 12) === '0001',
        // O NÚMERO QUE FALTA vai junto: "incompleta" sem quantos documentos a
        // SEFAZ ainda tem não diz se é 1 nota ou 500.
        pendenciaNSU: l.state?.pendenciaNSU != null
            ? Math.max(0, Number(l.state.pendenciaNSU) || 0)
            : (num(l.state?.maxNSU) != null && num(l.state?.ultNSU) != null
                ? Math.max(0, num(l.state.maxNSU) - num(l.state.ultNSU)) : null),
        veredito: vereditoDoCnpj(l, agoraMs),
    }));

    const grupos = new Map();
    for (const l of linhas) {
        const cod = l.veredito.codigo;
        if (!grupos.has(cod)) {
            grupos.set(cod, {
                codigo: cod, farol: l.veredito.farol,
                motivo: l.veredito.motivo, acao: l.veredito.acao,
                empresas: [], total: 0, documentosPendentes: 0,
            });
        }
        const g = grupos.get(cod);
        g.total++;
        g.documentosPendentes += Number(l.pendenciaNSU) || 0;
        g.empresas.push({ cnpj: l.cnpj, nome: l.nome, regime: l.regime, matriz: l.matriz, pendenciaNSU: l.pendenciaNSU });
    }

    const ordenados = [...grupos.values()]
        .sort((a, b) => (PESO_CODIGO[a.codigo] ?? 99) - (PESO_CODIGO[b.codigo] ?? 99))
        .map((g) => ({
            ...g,
            // LISTA CORTADA SEMPRE DIZ QUANTOS FICARAM (regra de 30/07): o
            // `slice` mudo é o que faz o painel contradizer o próprio número.
            empresas: g.empresas
                .sort((a, b) => (Number(b.pendenciaNSU) || 0) - (Number(a.pendenciaNSU) || 0)
                    || String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
                .slice(0, limitePorGrupo),
            mostrando: Math.min(limitePorGrupo, g.total),
            truncado: g.total > limitePorGrupo,
        }));

    const emDia = linhas.filter((l) => l.veredito.farol === 'ok').length;
    const comFalha = linhas.filter((l) => l.veredito.farol === 'falha').length;
    const comAtencao = linhas.filter((l) => l.veredito.farol === 'atencao').length;
    const documentosPendentes = linhas.reduce((s, l) => s + (Number(l.pendenciaNSU) || 0), 0);

    return {
        total: linhas.length,
        emDia, comFalha, comAtencao,
        /** Documentos que a SEFAZ tem e o app ainda não leu, somados. */
        documentosPendentes,
        // ALL-FAILED NUNCA É VERDE (regra do farol honesto). E carteira sem
        // ninguém em dia, com gente em falha, é vermelho — não âmbar.
        farol: linhas.length === 0 ? 'neutro'
            : comFalha > 0 ? (emDia === 0 ? 'falha' : 'atencao')
                : comAtencao > 0 ? 'atencao' : 'ok',
        grupos: ordenados,
        // O QUE ESTA VARREDURA NÃO OLHOU — dizer o escopo é o que impede
        // alguém de ler "em dia" como "nada a fazer neste cliente".
        escopo: 'Confere o CURSOR do DistDFe (entrada). NÃO confere: resumo sem a NF-e completa '
            + '(é a etapa de Validação da Rotina) nem a SAÍDA mod 55, que não vem pela SEFAZ '
            + '(Rejeição 641) e se prova no painel ✅ O cliente fez certo?.',
    };
}
