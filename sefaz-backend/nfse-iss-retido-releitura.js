// ============================================================================
// sefaz-backend/nfse-iss-retido-releitura.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🔁 A RETENÇÃO DO ISS RELIDA DO XML GUARDADO (05/10).
//
// Até 05/10 o leitor do padrão nacional dizia "tpRetISSQN 1 = retido" — é o
// contrário (1 = NÃO retido, 2 = retido pelo tomador). Toda NFS-e nacional
// importada pela tela foi gravada com a retenção INVERTIDA. Paulo, REALITY
// (0899) 09/2026: nove tomadas sem retenção listadas como "ISS retido como
// TOMADORA — R$ 1.290,33", e a única retida, fora.
//
// O documento gravado não guarda o código — mas o XML está no Storage, e é
// ele que responde (o mesmo caminho da competência de 03/10). Quem lê o
// leiaute é o DONO (`nfse-nacional-leitura.js`); aqui só se decide o patch.
// ============================================================================
import { ehNfseNacional, lerNfseNacional } from './nfse-nacional-leitura.js';

/** Nota de serviço que ainda não teve a retenção conferida no XML. */
export function precisaReleituraIssRetido(doc) {
    const d = doc || {};
    const tipo = String(d.tipoDoc || d.tipo || '');
    if (!/nfse/i.test(tipo)) return false;
    if (!d.storagePath) return false;
    const v = d.valores || {};
    return v.tpRetISSQN === undefined && v.issRetidoRelidoEm === undefined;
}

/**
 * O patch (caminhos com ponto, para `update`) que a leitura do XML manda.
 * XML que não é do padrão nacional (ABRASF, portal SP) só ganha o carimbo
 * de conferido — o leitor dele não tinha o defeito, e nada é reescrito.
 *
 * @param {string} xml
 * @param {string} agoraIso
 */
export function patchDaReleituraIssRetido(xml, agoraIso) {
    const txt = String(xml || '');
    if (!ehNfseNacional(txt)) {
        return { nacional: false, patch: { 'valores.issRetidoRelidoEm': agoraIso } };
    }
    const lida = lerNfseNacional(txt);
    const codigo = lida.valores.tpRetISSQN;
    return {
        nacional: true,
        issRetido: lida.valores.issRetido,
        patch: {
            // Só `true` afirma retenção. Ausente ou intermediário (null) não
            // vira retenção da empresa — e o código cru fica guardado.
            'valores.issRetido': lida.valores.issRetido === true,
            'valores.tpRetISSQN': codigo,
            'valores.issRetidoRelidoEm': agoraIso,
        },
    };
}

// ── VARREDURA DA CARTEIRA (05/10, Paulo: "faz a varredura da carteira inteira") ──

/**
 * O que a correção de UMA nota muda no imposto — dito em português, porque
 * é isso que a pessoa precisa para decidir se reconfere uma guia já enviada.
 *
 * @param {{direcao: string, antes: boolean, depois: boolean}} c
 */
export function impactoDaCorrecao({ direcao, antes, depois } = {}) {
    if (antes === depois) return null;
    if (direcao === 'saida') {
        return antes
            ? 'ISS próprio: a nota era abatida como "retido pelo tomador" sem ter sido — o A RECOLHER saiu MENOR.'
            : 'ISS próprio: a nota retida não era abatida — o A RECOLHER saiu MAIOR.';
    }
    return antes
        ? 'ISS retido como tomadora: a nota entrava na guia sem ter retenção — a guia do retido saiu MAIOR.'
        : 'ISS retido como tomadora: a nota com retenção ficava FORA da guia — a guia do retido saiu MENOR (ou não saiu).';
}

/**
 * Junta as notas corrigidas por empresa × competência — a unidade em que a
 * guia sai e em que a pessoa reconfere.
 *
 * @param {Array<{empresaId, empresaNome, empresaCnpj, competencia, numero, direcao, antes, depois}>} corrigidas
 */
export function agruparCorrecoes(corrigidas) {
    const grupos = new Map();
    for (const c of corrigidas || []) {
        const chave = `${c.empresaId || c.empresaCnpj || '?'}|${c.competencia || '?'}`;
        if (!grupos.has(chave)) {
            grupos.set(chave, {
                empresaId: c.empresaId || null,
                empresaNome: c.empresaNome || null,
                empresaCnpj: c.empresaCnpj || null,
                competencia: c.competencia || null,
                saidas: 0,
                entradas: 0,
                impactos: [],
                notas: [],
            });
        }
        const g = grupos.get(chave);
        if (c.direcao === 'saida') g.saidas += 1; else g.entradas += 1;
        const imp = impactoDaCorrecao(c);
        if (imp && !g.impactos.includes(imp)) g.impactos.push(imp);
        g.notas.push({ numero: c.numero || null, direcao: c.direcao || null, antes: c.antes, depois: c.depois });
    }
    return [...grupos.values()].sort((a, b) =>
        String(b.competencia).localeCompare(String(a.competencia))
        || String(a.empresaNome || '').localeCompare(String(b.empresaNome || '')));
}

/** Envio de guia que é de ISS (próprio ou retido) — os que a correção pode ter deixado errados. */
export function ehEnvioDeIss(envio) {
    return /\bISS\b/i.test(String(envio?.tipo || ''));
}
