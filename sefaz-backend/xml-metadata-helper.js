export function competenciaFromDhEmi(value) {
    const raw = String(value || '').trim();
    const iso = raw.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}`;

    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}`;

    return null;
}

function pickFirstBlock(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1] : '';
}

function pickTag(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].trim() : null;
}

export function extrairParticipantesNfe(xml) {
    const emit = pickFirstBlock(xml, 'emit');
    const dest = pickFirstBlock(xml, 'dest');

    return {
        emitente: {
            cnpj: pickTag(emit, 'CNPJ') || pickTag(emit, 'CPF') || null,
            nome: pickTag(emit, 'xNome') || null,
        },
        destinatario: {
            cnpj: pickTag(dest, 'CNPJ') || pickTag(dest, 'CPF') || null,
            nome: pickTag(dest, 'xNome') || null,
        },
    };
}
