// ============================================================================
// sefaz-backend/reinf-servicos-tomados.js  (PURO — testável)
// ----------------------------------------------------------------------------
// As NFS-e TOMADAS com RETENÇÃO PREVIDENCIÁRIA (11% do art. 31 da Lei
// 8.212/91), no formato que o módulo EFD-Reinf consome para o **R-2010**.
//
// ═══ A FONTE: UM EVENTO ACEITO, NÃO UM LEIAUTE DEDUZIDO ═════════════════════
//
// Paulo mandou em 12/08/2026 o `evtServTom` REAL de 06/2026 (contribuinte
// 32602701, prestador 03222111000130) **com o recibo da Receita ao lado**
// (`cdRetorno 0 — SUCESSO`, `tpEv 2010`, `CRTom 116201`). É a mesma régua que
// destravou o R-2055 e o E510: arquivo aceito vale mais que leiaute deduzido.
//
// Dele saem os fatos que este módulo respeita:
//
//   · `idePrestServ` traz vlrTotalBruto, vlrTotalBaseRet e vlrTotalRetPrinc;
//   · cada `nfs` traz serie, numDocto, dtEmissaoNF, vlrBruto e `infoTpServ`;
//   · `infoTpServ` exige `tpServico` (tabela 06 do Reinf, 9 dígitos);
//   · `ideEstabObra` exige `indObra`;
//   · `idePrestServ` exige `indCPRB`.
//
// ═══ O ACHADO QUE MANDA AQUI: BASE ≠ BRUTO ══════════════════════════════════
//
// No evento aceito o bruto é **5.755,54** e a base retida é **4.604,43** — e a
// própria observação da nota diz por quê: **INSUMOS**. A dedução de material e
// insumo (IN RFB 971, arts. 121-124) reduz a base, e ela **não vem separada na
// NFS-e**.
//
// Declarar base = bruto seria declarar retenção sobre 25% a mais de base. Então
// a base NÃO se supõe: ela se PROVA pela **assinatura de alíquota**, a mesma
// técnica que pegou o PIS/COFINS não-cumulativo virando "retenção" no R-4020.
//
//   retido / bruto ≈ 11%    ⇒ não houve dedução: a base É o bruto (provado)
//   retido / bruto ≈ 3,5%   ⇒ AMBÍGUO e o app NÃO escolhe: pode ser prestador
//                             desonerado (CPRB, indCPRB=1) ou 11% sobre base
//                             muito deduzida. São `indCPRB` diferentes, e
//                             errar esse campo é declarar outra coisa.
//   0 < retido/bruto < 11%  ⇒ houve dedução: a base derivada (retido ÷ 11%) vai
//                             MARCADA como derivada, nunca como a base.
//   fora disso              ⇒ não é a retenção do art. 31 — pendência.
//
// ═══ O QUE ESTA CASCA SE RECUSA A INVENTAR ══════════════════════════════════
//
// `tpServico` e `indObra` NÃO estão no documento — nenhum dos dois. São da
// mesma família do `indAquis` do R-2055 e da natureza do rendimento do R-4020:
// vão **nulos**, nomeados, e são informados UMA VEZ por prestador do outro
// lado. Chutar 0 em `indObra` porque "quase sempre é 0" é exatamente o default
// que a casa proíbe em campo de declaração.
// ============================================================================

const num = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v) => String(v ?? '').trim();

const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);

/** Primeiro valor numérico de verdade. Ausente ≠ zero. */
const primeiro = (...cands) => {
    for (const x of cands) {
        const n = num(x);
        if (n !== undefined) return n;
    }
    return undefined;
};

/**
 * Alíquotas legais da retenção previdenciária sobre serviços.
 *
 * 11%  — regra do art. 31 da Lei 8.212/91 (cessão de mão de obra/empreitada);
 * 3,5% — prestador com CPRB (desoneração da folha), Lei 12.546/2011 art. 7º §6º.
 *
 * A tolerância existe porque a base sai de arredondamento por nota: no evento
 * aceito, 4.604,43 × 11% = 506,4873 → 506,49.
 */
export const ALIQUOTA_ART31 = 11;
export const ALIQUOTA_CPRB = 3.5;
const TOLERANCIA_PP = 0.05; // pontos percentuais

const perto = (a, b) => Math.abs(a - b) <= TOLERANCIA_PP;

/**
 * A BASE DE RETENÇÃO, resolvida pela assinatura de alíquota.
 *
 * Devolve sempre `situacao` + `motivo` + `acao`: número sem causa do lado é
 * exatamente o alarme que a equipe aprende a ignorar.
 */
export function conferirBaseRetencaoInss({ bruto, retido } = {}) {
    const b = num(bruto);
    const rt = num(retido);
    if (b === undefined || !(b > 0) || rt === undefined || !(rt > 0)) {
        return {
            situacao: 'sem-dados',
            aliquotaAparente: null,
            base: null, baseOrigem: null, indCPRB: null,
            exigeAcao: true,
            motivo: 'A nota não tem valor bruto ou retenção legíveis.',
            acao: 'Confira o documento na origem — base de declaração não se estima.',
        };
    }
    const pct = r2((rt / b) * 100);

    if (perto(pct, ALIQUOTA_ART31)) {
        return {
            situacao: 'base-e-o-bruto',
            aliquotaAparente: pct,
            base: r2(b),
            baseOrigem: 'bruto-sem-deducao',
            // A razão bate com os 11% cheios: não houve dedução de material,
            // e prestador desonerado retém 3,5% — logo não é CPRB.
            indCPRB: 0,
            exigeAcao: false,
            motivo: `A retenção é ${pct}% do bruto — os 11% cheios do art. 31, sem dedução de material/insumo.`,
            acao: null,
        };
    }

    if (perto(pct, ALIQUOTA_CPRB)) {
        return {
            situacao: 'aliquota-ambigua-cprb-ou-deducao',
            aliquotaAparente: pct,
            // NÃO escolhe: as duas leituras dão `indCPRB` diferentes, e o campo
            // muda o que está sendo declarado.
            base: null, baseOrigem: null, indCPRB: null,
            exigeAcao: true,
            motivo: `A retenção é ${pct}% do bruto, e esse número tem DUAS leituras possíveis: prestador `
                + 'desonerado (CPRB, 3,5% sobre o bruto) ou os 11% do art. 31 sobre uma base muito '
                + 'deduzida. O app não escolhe — são `indCPRB` diferentes.',
            acao: 'Confirme com a nota/contrato se o prestador está na desoneração (CPRB). '
                + 'Se estiver, a base é o bruto; se não, peça o valor da base de retenção ao prestador.',
        };
    }

    if (pct > 0 && pct < ALIQUOTA_ART31) {
        const derivada = r2(rt / (ALIQUOTA_ART31 / 100));
        return {
            situacao: 'base-deduzida-nao-informada',
            aliquotaAparente: pct,
            // A base derivada NUNCA se apresenta como "a base": ela reverte um
            // arredondamento e volta com centavos que não são os do documento
            // (506,49 ÷ 11% = 4.604,45, e a base real do evento aceito é
            // 4.604,43). Serve pra CONFERIR, não pra declarar.
            base: derivada,
            baseOrigem: 'derivada-da-retencao',
            indCPRB: 0,
            exigeAcao: true,
            motivo: `A retenção é ${pct}% do bruto — abaixo dos 11%, então houve dedução de material/insumo `
                + '(IN RFB 971, arts. 121-124) e a NFS-e não traz a base separada.',
            acao: `Informe a base de retenção da nota (o app estima R$ ${derivada.toFixed(2)} a partir da `
                + 'retenção, mas valor estimado não vai para declaração).',
        };
    }

    return {
        situacao: 'aliquota-fora-da-regua',
        aliquotaAparente: pct,
        base: null, baseOrigem: null, indCPRB: null,
        exigeAcao: true,
        motivo: `A retenção é ${pct}% do bruto, e nem 11% (art. 31) nem 3,5% (CPRB) explicam esse número.`,
        acao: 'Confira o documento: pode ser retenção de outra natureza lançada no campo de INSS, '
            + 'ou valor digitado errado. Não é R-2010 enquanto não bater.',
    };
}

/**
 * Uma NFS-e tomada com INSS retido → uma linha do R-2010.
 *
 * Lê as DUAS formas do documento (achatada do portal de SP e objeto do XML) —
 * é exatamente o que o outro app não teria como saber, e é a armadilha que já
 * mordeu oito vezes neste repo.
 */
export function normalizarServicoTomado(d) {
    const v = d?.valores || {};
    const bruto = primeiro(d?.valorServicos, v.valorServicos, d?.valorTotal);
    const retido = primeiro(d?.valorInss, v.inss);
    const conferencia = conferirBaseRetencaoInss({ bruto, retido });

    return {
        // ── Identificação da nota (o grupo `nfs` do evento aceito) ──────────
        numero: texto(d?.numero) || null,
        serie: texto(d?.serie) || null,
        dtEmissao: texto(d?.dataFatoGerador || d?.dhEmi) || null,
        chave: texto(d?.chave) || null,
        competencia: texto(d?.competencia) || null,

        prestadorCnpj: soDigitos(d?.prestadorCnpj || d?.cnpjEmit || d?.emitente?.cnpjCpf),
        prestadorNome: texto(d?.prestadorNome || d?.xNomeEmit || d?.emitente?.nome) || null,
        // O TOMADOR é o cliente do escritório — é ele quem declara o R-2010,
        // e é o CNPJ dele que vai em `nrInscEstab`.
        tomadorCnpj: soDigitos(d?.tomadorCnpj || d?.cnpjDest || d?.destinatario?.cnpjCpf || d?.empresaCnpj),

        vlrBruto: bruto === undefined ? null : r2(bruto),
        // O que a NOTA diz que foi retido. Nome honesto: é retenção previdenciária
        // informada no documento, não "vlrRetencao do leiaute já conferido".
        inssRetido: retido === undefined ? null : r2(retido),

        // ── O que a assinatura de alíquota PROVA (ou recusa a afirmar) ──────
        baseRetencao: conferencia.base,
        baseOrigem: conferencia.baseOrigem,
        indCPRB: conferencia.indCPRB,
        conferencia,

        // ── O que NÃO está no documento ─────────────────────────────────────
        // Tabela 06 do Reinf (9 dígitos: 100000001 é limpeza/conservação no
        // evento aceito). Não existe no XML nem no export do portal.
        tpServico: null,
        // 0 = não é obra · 1 = obra com CNO próprio · 2 = empreitada total.
        // "Quase sempre 0" não é resposta: é o default proibido em campo fiscal.
        indObra: null,

        // FONTE de apoio: o prestador costuma descrever o serviço aqui, e é
        // disso que sai o tpServico do outro lado.
        discriminacao: texto(d?.discriminacaoServicos) || null,
        codigoServicoMunicipal: texto(d?.codigoServico) || null,
    };
}

/**
 * Payload do R-2010 para UMA empresa (o TOMADOR) numa competência.
 *
 * O eixo é PRESTADOR × ESTABELECIMENTO, que é como o evento aceito se organiza
 * (`ideEstabObra > idePrestServ > nfs*`), com os totais do prestador somados
 * das notas — exatamente como `vlrTotalBruto`/`vlrTotalRetPrinc` aparecem lá.
 *
 * @param {object} p
 * @param {string} p.cnpjTomador  o cliente que declara
 * @param {string} p.competencia  'AAAA-MM'
 * @param {Array}  p.documentos   documentos da competência
 */
export function montarPayloadR2010({ cnpjTomador, competencia, documentos } = {}) {
    const alvo = soDigitos(cnpjTomador);
    const porPrestador = new Map();
    let semRetencaoPrevidenciaria = 0;
    let dePessoaFisica = 0;

    for (const d of documentos || []) {
        if (!/NFSe/i.test(texto(d?.tipoDoc || d?.tipo))) continue;
        if (CANCELADOS.has(texto(d?.status).toLowerCase())) continue;
        // TOMADAS: o cliente é o tomador, não o prestador.
        if (d?.direcao !== 'entrada') continue;

        const n = normalizarServicoTomado(d);
        if (alvo && n.tomadorCnpj && n.tomadorCnpj !== alvo) continue;
        // Sem INSS retido não é R-2010. Isso NÃO é ausência de obrigação — a
        // maioria das notas tomadas não tem retenção previdenciária —, então
        // vira contagem e não pendência.
        if (!n.inssRetido) { semRetencaoPrevidenciaria += 1; continue; }
        // Prestador PESSOA FÍSICA não é R-2010: contribuinte individual entra
        // pelo eSocial. Some da lista é o que faz alguém achar que declarou
        // tudo, então vira contagem.
        if (n.prestadorCnpj.length !== 14) { dePessoaFisica += 1; continue; }

        const acc = porPrestador.get(n.prestadorCnpj) || {
            cnpjPrestador: n.prestadorCnpj,
            nome: n.prestadorNome,
            // O estabelecimento do TOMADOR: `nrInscEstab` do evento aceito.
            nrInscEstab: n.tomadorCnpj || alvo || null,
            indObra: null,
            notas: [],
            vlrTotalBruto: 0,
            // Só soma base o que TEM base provada — somar estimativa com valor
            // real produziria um total que ninguém consegue conferir.
            vlrTotalBaseRet: 0,
            baseCompleta: true,
            vlrTotalRetPrinc: 0,
            comPendencia: 0,
        };
        acc.notas.push(n);
        acc.vlrTotalBruto = r2(acc.vlrTotalBruto + (n.vlrBruto || 0));
        acc.vlrTotalRetPrinc = r2(acc.vlrTotalRetPrinc + n.inssRetido);
        if (n.baseOrigem === 'bruto-sem-deducao') {
            acc.vlrTotalBaseRet = r2(acc.vlrTotalBaseRet + n.baseRetencao);
        } else {
            acc.baseCompleta = false;
        }
        if (n.conferencia.exigeAcao) acc.comPendencia += 1;
        if (!acc.nome && n.prestadorNome) acc.nome = n.prestadorNome;
        porPrestador.set(n.prestadorCnpj, acc);
    }

    const prestadores = [...porPrestador.values()].map((p) => ({
        ...p,
        // Base incompleta NÃO sai como número: um total parcial num campo
        // chamado "vlrTotalBaseRet" seria lido como a base do prestador.
        vlrTotalBaseRet: p.baseCompleta ? p.vlrTotalBaseRet : null,
    })).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    const comPendencia = prestadores.filter((p) => p.comPendencia > 0).length;
    return {
        cnpjTomador: alvo || null,
        competencia: competencia || null,
        prestadores,
        resumo: {
            prestadores: prestadores.length,
            notas: prestadores.reduce((t, p) => t + p.notas.length, 0),
            semRetencaoPrevidenciaria,
            dePessoaFisica,
            comPendencia,
            semBaseProvada: prestadores.filter((p) => !p.baseCompleta).length,
            vlrTotalBruto: r2(prestadores.reduce((t, p) => t + p.vlrTotalBruto, 0)),
            vlrTotalRetPrinc: r2(prestadores.reduce((t, p) => t + p.vlrTotalRetPrinc, 0)),
        },
        ressalvas: ressalvasDoPayload({ prestadores, dePessoaFisica }),
    };
}

function ressalvasDoPayload({ prestadores, dePessoaFisica }) {
    const out = [
        'O `tpServico` (tabela 06 da EFD-Reinf, 9 dígitos) e o `indObra` vão NULOS: nenhum dos dois está '
        + 'na NFS-e — nem no XML, nem no export do portal. São informados UMA VEZ por prestador do lado '
        + 'do EFD-Reinf. Chutar 0 em `indObra` porque "quase sempre é 0" é o default que campo de '
        + 'declaração não aceita.',
        'A BASE de retenção NÃO é o valor bruto quando houve dedução de material/insumo (IN RFB 971, '
        + 'arts. 121-124): no evento aceito de referência o bruto é 5.755,54 e a base é 4.604,43. Por isso '
        + 'a base só viaja quando a alíquota PROVA que não houve dedução (retido = 11% do bruto); nos '
        + 'demais casos ela vem marcada como derivada, e derivada não vai para declaração.',
    ];
    const semBase = prestadores.filter((p) => !p.baseCompleta);
    if (semBase.length) {
        out.push(`${semBase.length} prestador(es) com nota cuja BASE não está provada `
            + `(${semBase.map((p) => p.nome || p.cnpjPrestador).join(', ')}) — o total da base vem NULO `
            + 'para eles. Total parcial num campo de base seria lido como a base inteira.');
    }
    const ambiguos = prestadores.filter((p) => p.notas.some((n) => n.conferencia.situacao === 'aliquota-ambigua-cprb-ou-deducao'));
    if (ambiguos.length) {
        out.push(`🚨 ${ambiguos.length} prestador(es) com retenção de ~3,5% do bruto — número com DUAS `
            + 'leituras: desoneração da folha (CPRB) ou 11% sobre base muito deduzida. O app não escolhe: '
            + 'são `indCPRB` diferentes, e errar esse campo declara outra coisa.');
    }
    if (dePessoaFisica) {
        out.push(`${dePessoaFisica} nota(s) com prestador PESSOA FÍSICA ficaram de fora — contribuinte `
            + 'individual entra pelo eSocial, não pelo R-2010.');
    }
    if (!prestadores.length) {
        // Zero nunca é sucesso: pode ser mês sem retenção OU captura faltando.
        out.push('NENHUMA nota tomada com retenção previdenciária nesta competência. Se o cliente contrata '
            + 'cessão de mão de obra ou empreitada (limpeza, vigilância, conservação), o problema é de '
            + 'CAPTURA — não é ausência de obrigação.');
    }
    return out;
}
