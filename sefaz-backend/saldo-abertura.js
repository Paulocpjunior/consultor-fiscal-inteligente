// ============================================================================
// sefaz-backend/saldo-abertura.js  (PURO — testável)
//
// A CRONOLOGIA DO SALDO CREDOR — abertura carimbada + transporte CALCULADO.
//
// ═══ POR QUE EXISTE (Paulo, 17/08; desenho fechado 21/08) ═══════════════════
//
// *"Essa empresa possui saldos acumulados de meses anteriores… a apuração não
// está considerando o saldo que já vinha sendo acumulado."*
//
// Até aqui o saldo anterior vinha da FICHA — e a ficha é digitada: o ICMS
// transportava DEFASADO (o campo dela é o que ENTROU no mês, não o que SOBROU)
// e o ST transportava 0,00. O desenho decidido em 17/08 é este módulo:
//
//   1. O saldo de ABERTURA é carimbado UMA vez, numa competência — e a fonte
//      não é digitação: é o **E110 campo 14 (VL_SLD_CREDOR_TRANSPORTAR)** e o
//      **E520 campo 7 (VL_SC_IPI)** do último SPED ENTREGUE, colado aqui.
//   2. Daí em diante o transporte é CALCULADO mês a mês, com a MESMA
//      matemática do E110/E520 (`aplicarAjustesApuracao` — dono único; uma
//      segunda fórmula divergiria do arquivo). Nunca redigitado.
//
// ═══ POR QUE A FONTE É O ARQUIVO, NUNCA A DIGITAÇÃO ═════════════════════════
//
// Saldo digitado é a ficha de novo, com outro nome. O SPED entregue é o único
// documento em que a EMPRESA afirmou à SEFAZ quanto sobrou — e o app já provou
// (caso KROYA, PWR) que redigitar transporte é o que produz defasagem.
//
// 🚨 E A LEITURA DO E520 QUASE NASCEU ERRADA: o plano era reusar o
// `valorSaldoCredorIpi` do spedFiscalParserService — que mapeava `fields[4]`,
// posição do **VL_OD_IPI** (outros débitos, quase sempre 0,00). O leiaute real
// do E520 é |E520|VL_SD_ANT|VL_DEB|VL_CRED|VL_OD|VL_OC|VL_SC|VL_SD| — o saldo
// credor a transportar é o campo 7 (`fields[6]`), corroborado pelo NOSSO
// gerador, que escreve nessa posição, e pela linha real da PWR
// (|E520|2547,39|0,00|2200,45|0,00|0,00|4747,84|0,00|: 2547,39+2200,45 =
// 4747,84 SÓ fecha com o campo 7 sendo o credor). O parser da tela 🪞 foi
// corrigido no mesmo PR.
//
// ═══ AS TRAVAS ══════════════════════════════════════════════════════════════
//
// · A abertura NÃO se aplica a competência ≤ a dela — o arquivo daquela
//   competência já foi entregue com outro número, e retroagir reescreveria
//   competência transmitida (mesma régua da vigência do IVA-ST).
// · Elo FALTANDO derruba a cadeia NOMEADO — mês sem movimento lido não vira
//   zero em silêncio: zero de movimento é uma afirmação, e quem afirma é o
//   dado carregado, nunca a ausência dele.
// · ICMS e IPI andam JUNTOS na cadeia mas são contas separadas — o IPI não
//   tem E111, então a fórmula dele é a do E520 (deb − cred − saldoAnt).
// ============================================================================

import { aplicarAjustesApuracao } from './sped-ajustes-apuracao.js';

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
/**
 * ⚠️ DUAS COERÇÕES, cada uma com o seu dono — e a confusão entre elas mordeu
 * DENTRO deste módulo no primeiro teste: o formato do ARQUIVO é pt-BR
 * ("2.547,39" — ponto de milhar, vírgula decimal) e o do CÓDIGO é número JS
 * (2547.39). Aplicar a coerção do arquivo a um número JS transforma 2547.39
 * em 254739 — cem vezes o saldo, em silêncio.
 */
const numArquivo = (v) => {
    const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.');
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
};
const numJs = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round(n * 100) / 100;

/** 'AAAA-MM' da competência anterior. */
export function competenciaAnterior(comp) {
    const [a, m] = String(comp).split('-').map(Number);
    const d = new Date(a, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Competências estritamente DEPOIS de `a` e estritamente ANTES de `b`. */
export function competenciasEntre(a, b) {
    const out = [];
    let atual = String(a);
    for (let guarda = 0; guarda < 240; guarda += 1) {
        const [ano, mes] = atual.split('-').map(Number);
        const prox = new Date(ano, mes, 1);
        atual = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}`;
        if (atual >= String(b)) break;
        out.push(atual);
    }
    return out;
}

/**
 * Lê o saldo de abertura de um SPED ICMS/IPI ENTREGUE (o texto colado).
 *
 * A leitura é das LINHAS, como a pré-validação: o mesmo texto que o PVA leu.
 * O 0000 é reconhecido por PADRÃO (duas datas ddmmaaaa adjacentes + CNPJ de 14
 * dígitos) em vez de índice fixo — o 0000 do EFD-Contribuições tem outro
 * leiaute, e ler por posição num arquivo colado errado produziria uma abertura
 * com competência de lixo.
 *
 * @param {string} texto o .txt inteiro
 * @returns {{ok: boolean, motivo?: string, cnpj?: string, competencia?: string,
 *   icms?: number, ipi?: number, temE110?: boolean, temE520?: boolean}}
 */
export function extrairAberturaDoSped(texto) {
    const linhas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!linhas.length) return { ok: false, motivo: 'Nada colado — cole o conteúdo do .txt do SPED entregue.' };

    const campos = (l) => {
        let s = l;
        if (s.startsWith('|')) s = s.slice(1);
        if (s.endsWith('|')) s = s.slice(0, -1);
        return s.split('|');
    };

    const l0000 = linhas.find((l) => l.startsWith('|0000|'));
    if (!l0000) return { ok: false, motivo: 'O texto colado não tem o registro 0000 — não parece um arquivo SPED.' };

    const e110s = linhas.filter((l) => l.startsWith('|E110|'));
    if (!e110s.length) {
        return {
            ok: false,
            motivo: 'O arquivo não tem o registro E110 — ou não é um EFD ICMS/IPI (o EFD-Contribuições não '
                + 'serve aqui: o saldo de ICMS/IPI mora no arquivo do ICMS), ou está incompleto.',
        };
    }
    if (e110s.length > 1) {
        // Um arquivo = um período = um E110. Dois é colagem de arquivos
        // emendados, e escolher um seria escolher a competência errada calado.
        return { ok: false, motivo: `O texto tem ${e110s.length} registros E110 — cole UM arquivo por vez.` };
    }

    const f0 = campos(l0000);
    // DT_INI/DT_FIM: as duas primeiras datas ddmmaaaa ADJACENTES do 0000.
    let dtFim = null;
    for (let i = 1; i < f0.length - 1; i += 1) {
        if (/^\d{8}$/.test(f0[i]) && /^\d{8}$/.test(f0[i + 1])) { dtFim = f0[i + 1]; break; }
    }
    // Primeiro campo de 14 dígitos = CNPJ (nos dois leiautes de 0000 ele vem
    // antes da IE, que é quem poderia confundir).
    const cnpj = f0.map((c) => (/^\d{14}$/.test(c) ? c : null)).find(Boolean);
    if (!dtFim || !cnpj) {
        return { ok: false, motivo: 'Não achei período/CNPJ no registro 0000 — o arquivo está truncado?' };
    }
    const competencia = `${dtFim.slice(4, 8)}-${dtFim.slice(2, 4)}`;

    // E110 campo 14 (VL_SLD_CREDOR_TRANSPORTAR) → índice 13 com o REG em [0].
    const fe110 = campos(e110s[0]);
    const icms = r2(numArquivo(fe110[13]));

    // E520 campo 7 (VL_SC_IPI) → índice 6. Ver o cabeçalho: fields[4] seria o
    // VL_OD_IPI — foi o quase-erro que este módulo corrigiu no parser da 🪞.
    const e520s = linhas.filter((l) => l.startsWith('|E520|'));
    const temE520 = e520s.length > 0;
    const ipi = temE520 ? r2(numArquivo(campos(e520s[0])[6])) : 0;

    return { ok: true, cnpj: soDigitos(cnpj), competencia, icms, ipi, temE110: true, temE520 };
}

/** A fórmula de transporte do IPI — a MESMA do E520 do gerador. */
export function transportarIpi({ saldoAnterior = 0, debitos = 0, creditos = 0 } = {}) {
    const saldo = r2(numJs(debitos) - numJs(creditos) - numJs(saldoAnterior));
    return saldo < 0 ? -saldo : 0;
}

/**
 * Resolve o saldo anterior de uma competência a partir da ABERTURA, andando a
 * cadeia mês a mês com a matemática do próprio arquivo.
 *
 * @param {object} p
 * @param {{competencia: string, icms: number, ipi: number}} p.abertura
 * @param {string} p.competencia  a competência que vai ser GERADA
 * @param {Object<string, {icms: {debitos: number, creditos: number, cls: object},
 *   ipi: {debitos: number, creditos: number}}>} [p.movimentos]
 *   movimento lido de cada mês entre a abertura e a competência-alvo
 * @returns {{aplicavel: boolean, motivo?: string, faltam?: string[],
 *   icms?: number, ipi?: number, cadeia?: Array, origem?: string}}
 */
export function resolverSaldoAnterior({ abertura, competencia, movimentos = {} } = {}) {
    if (!abertura || !abertura.competencia) {
        return { aplicavel: false, motivo: 'Sem saldo de abertura cadastrado.' };
    }
    const a = String(abertura.competencia);
    const M = String(competencia);
    if (a >= M) {
        // O arquivo da competência da abertura (e das anteriores) JÁ FOI
        // entregue com outro número — a abertura vale DALI EM DIANTE.
        return {
            aplicavel: false,
            motivo: `A abertura é de ${a} e vale para as competências SEGUINTES — ${M} não é depois dela. `
                + 'A competência do SPED colado já foi entregue com o saldo dela dentro.',
        };
    }
    if (a === competenciaAnterior(M)) {
        // Caso comum: a abertura é o mês imediatamente anterior — o valor do
        // arquivo entregue É o saldo anterior desta geração, sem cadeia.
        return {
            aplicavel: true,
            icms: r2(numJs(abertura.icms)),
            ipi: r2(numJs(abertura.ipi)),
            cadeia: [],
            origem: `E110 c.14 / E520 c.7 do SPED ENTREGUE de ${a} (saldo de abertura carimbado)`,
        };
    }

    const meses = competenciasEntre(a, M);
    const faltam = meses.filter((m) => !movimentos[m]);
    if (faltam.length) {
        // Elo sem movimento LIDO não vira zero calado — zero de movimento é uma
        // afirmação, e quem a faz é o dado carregado.
        return {
            aplicavel: false,
            faltam,
            motivo: `A abertura é de ${a} e faltou ler o movimento de: ${faltam.join(', ')}. Sem a cadeia `
                + 'inteira o transporte não se calcula — gere as competências intermediárias ou cole um SPED '
                + 'entregue mais recente.',
        };
    }

    let icms = r2(numJs(abertura.icms));
    let ipi = r2(numJs(abertura.ipi));
    const cadeia = [];
    for (const m of meses) {
        const mov = movimentos[m];
        // A MESMA matemática do E110 (dono: sped-ajustes-apuracao.js) — uma
        // segunda fórmula aqui divergiria do arquivo que o gerador escreve.
        const ap = aplicarAjustesApuracao({
            vlTotDebitos: numJs(mov.icms?.debitos),
            vlTotCreditos: numJs(mov.icms?.creditos),
            vlSldCredorAnt: icms,
        }, mov.icms?.cls);
        icms = ap.vlSldCredorTransportar;
        ipi = transportarIpi({ saldoAnterior: ipi, debitos: mov.ipi?.debitos, creditos: mov.ipi?.creditos });
        cadeia.push({ competencia: m, icms, ipi });
    }
    return {
        aplicavel: true,
        icms,
        ipi,
        cadeia,
        origem: `abertura carimbada em ${a} (SPED entregue) + transporte CALCULADO por ${meses.length} `
            + `mês(es): ${meses.join(', ')}`,
    };
}
