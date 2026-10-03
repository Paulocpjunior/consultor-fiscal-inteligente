// ============================================================================
// sefaz-backend/competencia-do-xml.js  (PURO — testável)
// ----------------------------------------------------------------------------
// A competência que o XML de uma NFS-e DECLARA, lida do arquivo guardado.
//
// 03/10 (Santana de Parnaíba, CLINICA VETERINARIA ALPHAVILLE): 34 NFS-e do
// padrão nacional importadas pela tela foram gravadas pela EMISSÃO, porque o
// encaixe do leitor descartava o `dCompet`. O documento gravado não tem o
// campo — mas o XML está no Storage, e é ele que responde. Quem lê o leiaute
// é o DONO de cada um (`nfse-nacional-leitura.js` para o nacional); aqui só
// se escolhe qual.
// ============================================================================
import { ehNfseNacional, lerNfseNacional } from './nfse-nacional-leitura.js';

/**
 * @param {string} xml
 * @returns {string} o valor declarado ('AAAA-MM-DD' / 'AAAA-MM'…) ou ''
 */
export function competenciaDeclaradaDoXml(xml) {
    const txt = String(xml || '');
    if (!txt) return '';
    if (ehNfseNacional(txt)) {
        try { return String(lerNfseNacional(txt)?.competencia || ''); } catch { return ''; }
    }
    // ABRASF: <Competencia> (com ou sem prefixo de namespace).
    const m = /<(?:\w+:)?Competencia>\s*([^<]+?)\s*<\/(?:\w+:)?Competencia>/.exec(txt);
    return m ? m[1] : '';
}

/** A nota de serviço precisa da leitura do XML? (sem competência declarada gravada, com XML guardado) */
export function precisaLerCompetenciaDoXml(d) {
    return !!d && String(d.tipo || '').toUpperCase() === 'NFSE'
        && !d.competenciaDeclarada && !d?.competenciaCorrigida?.em
        && typeof d.storagePath === 'string' && d.storagePath.length > 0;
}
