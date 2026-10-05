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
