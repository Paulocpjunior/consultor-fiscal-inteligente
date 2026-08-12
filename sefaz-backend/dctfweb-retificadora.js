// ============================================================================
// sefaz-backend/dctfweb-retificadora.js   (PURO — sem io, testável)
//
// "ESTA COMPETÊNCIA PRECISA DE RETIFICADORA?"
//
// POR QUE EXISTE (Paulo, 12/08/2026): a DCTFWeb é UMA declaração por CNPJ e
// competência, alimentada por TRÊS departamentos que terminam em dias
// diferentes — eSocial (DP), EFD-Reinf (Contábil) e MIT (Fiscal) — enquanto as
// guias vencem em datas distintas dentro do mês. Quem tem guia vencendo cedo
// transmite pra conseguir a guia, e nesse ato FECHA a declaração para os outros
// dois. Quando o insumo do outro chega, a declaração já está transmitida a
// menos: falta uma retificadora.
//
// E isso hoje é INVISÍVEL. Ninguém erra por má-fé — erra porque nada na tela
// diz que o eSocial fechou no dia 18 numa declaração transmitida no dia 12.
//
// ─── O QUE ESTE MÓDULO SE RECUSA A FAZER ────────────────────────────────────
//
// · NÃO ACUSA SEM DATA DOS DOIS LADOS. Insumo recebido sem carimbo de quando
//   entrou não vira "chegou depois" — vira ressalva nomeada. Acusar aqui manda
//   retificar uma declaração correta, que é pior que não avisar.
// · NÃO DECIDE PELO MESMO DIA. Insumo que entrou no MESMO dia da transmissão
//   pode ter entrado antes ou depois; sem hora nos dois lados, a resposta é
//   "não dá pra dizer", com o dia à mostra.
// · `sem-movimento` NUNCA gera retificadora: não ter o que entregar não é
//   entrega atrasada.
// · `indeterminado` (consulta falhou) não vira nem culpa nem alívio.
// ============================================================================

/** Dia (AAAA-MM-DD) de um carimbo que pode vir como data ou ISO completo. */
function dia(v) {
    const s = String(v || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // dd/mm/aaaa (formato que algumas consultas devolvem)
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    return null;
}

/** Instante completo, quando os DOIS lados têm hora — aí a ordem é certa. */
function instante(v) {
    const s = String(v || '').trim();
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s : null;
}

/**
 * @param {object} p
 * @param {object|null} p.declaracao  doc de `dctfweb_declaracoes`
 *        ({ situacao, transmitidoEm, transmitidoPor, numeroRecibo })
 * @param {Array} p.selos             selos do semáforo (dctfweb-insumos)
 */
export function avaliarRetificadora({ declaracao, selos = [] } = {}) {
    const transmitidaEm = declaracao?.transmitidoEm || null;
    const foiTransmitida = !!transmitidaEm
        || String(declaracao?.situacao || '').toUpperCase() === 'ATIVA';

    const pendentes = selos.filter((s) => s?.estado === 'pendente');
    const incertos = selos.filter((s) => s?.estado === 'indeterminado');

    if (!foiTransmitida) {
        return {
            situacao: 'nao-transmitida',
            precisaRetificar: false,
            severidade: pendentes.length ? 'atencao' : 'ok',
            transmitidaEm: null,
            transmitidaPor: null,
            tardios: [], pendentes: rotulos(pendentes), semData: [], mesmoDia: [],
            mensagem: pendentes.length
                ? `A declaração ainda NÃO foi transmitida e ${pendentes.length} insumo(s) não chegaram — `
                  + 'transmitir agora fecharia a competência a menos.'
                : 'A declaração ainda não foi transmitida — não há o que retificar.',
            acao: pendentes.length
                ? 'Espere os insumos pendentes. Se a guia vence antes, emita o DARF com a declaração EM ANDAMENTO: '
                  + 'pagar não exige transmitir.'
                : 'Siga o rito normal: transmita quando os três insumos estiverem dentro.',
            ressalvas: ressalvas({ incertos }),
        };
    }

    // Transmitida: comparar a entrada de cada insumo com o momento da transmissão.
    const tardios = [];
    const mesmoDia = [];
    const semData = [];
    for (const s of selos) {
        if (s?.estado !== 'recebido') continue;
        if (!s.quando) { semData.push(rotulo(s)); continue; }
        const iT = instante(transmitidaEm), iS = instante(s.quando);
        if (iT && iS) {
            if (iS > iT) tardios.push({ ...rotulo(s), quando: s.quando });
            continue;
        }
        const dT = dia(transmitidaEm), dS = dia(s.quando);
        if (!dT || !dS) { semData.push(rotulo(s)); continue; }
        if (dS > dT) tardios.push({ ...rotulo(s), quando: s.quando });
        // MESMO DIA sem hora dos dois lados: não dá pra dizer a ordem.
        else if (dS === dT) mesmoDia.push({ ...rotulo(s), quando: s.quando });
    }

    const quem = declaracao?.transmitidoPor || null;
    const base = {
        transmitidaEm,
        transmitidaPor: quem,
        tardios,
        pendentes: rotulos(pendentes),
        semData,
        mesmoDia,
        ressalvas: ressalvas({ incertos, semData, mesmoDia, quem }),
    };

    if (tardios.length) {
        const nomes = tardios.map((t) => t.rotulo).join(', ');
        return {
            ...base,
            situacao: 'precisa-retificar',
            precisaRetificar: true,
            severidade: 'alta',
            mensagem: `Insumo entrou DEPOIS da transmissão: ${nomes}. A declaração foi transmitida `
                + `${quem ? `por ${quem} ` : ''}em ${transmitidaEm} e está a MENOS.`,
            acao: 'Transmita a retificadora desta competência com o insumo que faltava. '
                + 'Enquanto isso, o débito declarado é menor que o devido.',
        };
    }

    if (pendentes.length) {
        return {
            ...base,
            situacao: 'vai-precisar',
            precisaRetificar: false,
            severidade: 'atencao',
            mensagem: `A declaração já foi transmitida${quem ? ` por ${quem}` : ''} e ${pendentes.length} `
                + 'insumo(s) ainda não chegaram — quando chegarem, esta competência VAI precisar de retificadora.',
            acao: 'Avise o departamento responsável e acompanhe: assim que o insumo entrar, retifique.',
        };
    }

    return {
        ...base,
        situacao: 'em-dia',
        precisaRetificar: false,
        // Não é verde cego: se algum insumo não tem data ou caiu no mesmo dia,
        // o "em dia" é o que dá pra afirmar, não uma garantia.
        severidade: (semData.length || mesmoDia.length || incertos.length) ? 'atencao' : 'ok',
        mensagem: (semData.length || mesmoDia.length)
            ? 'Nenhum insumo comprovadamente entrou depois da transmissão — mas há insumo sem data conferível.'
            : 'Todos os insumos entraram antes da transmissão. Nada a retificar.',
        acao: (semData.length || mesmoDia.length)
            ? 'Confira no e-CAC os insumos listados abaixo antes de dar a competência por encerrada.'
            : 'Nada a fazer neste item.',
    };
}

function rotulo(s) {
    return { rotulo: s?.rotulo || s?.departamento || 'insumo', departamento: s?.departamento || null };
}
function rotulos(lista) {
    return lista.map(rotulo);
}

function ressalvas({ incertos = [], semData = [], mesmoDia = [], quem = undefined } = {}) {
    const out = [];
    if (incertos.length) {
        out.push(`${incertos.length} insumo(s) com consulta indisponível — não dá pra afirmar nem que entraram, `
            + 'nem que faltam. Eles não entram nesta conclusão.');
    }
    if (semData.length) {
        out.push(`${semData.map((s) => s.rotulo).join(', ')}: entrada confirmada, mas SEM data — `
            + 'não dá pra dizer se foi antes ou depois da transmissão.');
    }
    if (mesmoDia.length) {
        out.push(`${mesmoDia.map((s) => s.rotulo).join(', ')}: entrou no MESMO dia da transmissão — `
            + 'sem hora dos dois lados, a ordem não é conferível.');
    }
    if (quem === null) {
        out.push('Esta declaração não guarda QUEM transmitiu (é anterior ao registro do responsável) — '
            + 'a partir de agora o app grava.');
    }
    return out;
}
