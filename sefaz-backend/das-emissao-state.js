import { createHash } from 'node:crypto';

const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
    return value;
};

export function assinaturaEmissaoDas(input) {
    return createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}

export function erroEmissaoPendente(message) {
    const error = new Error(message);
    error.httpStatus = 409;
    error.code = 'DAS_RECONCILIACAO_NECESSARIA';
    return error;
}

export async function reservarEmissaoDas(db, ref, assinatura, identidade) {
    return db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const atual = snap.exists ? snap.data() : {};
        if (['transmitindo', 'gerando', 'incerta'].includes(atual.emissaoEtapa)) {
            throw erroEmissaoPendente('Esta emissão está em processamento ou aguarda conferência do resultado no PGDAS-D. Nenhuma nova transmissão foi iniciada.');
        }
        if (atual.emissaoAssinatura && atual.emissaoAssinatura !== assinatura) {
            throw erroEmissaoPendente('Já existe uma emissão desta competência com outros dados. Confira a declaração e a necessidade de retificação antes de transmitir novamente.');
        }
        if (atual.emissaoEtapa === 'concluida' && atual.emissaoAssinatura === assinatura) {
            return { concluida: true, atual };
        }
        if (!atual.emissaoAssinatura && (atual.pgdasRecibo || atual.numeroDocumento)) {
            throw erroEmissaoPendente('Já existe uma declaração ou guia registrada nesta competência. Consulte a guia existente antes de realizar uma nova transmissão.');
        }
        const recuperar = atual.emissaoEtapa === 'guia_pendente' && Boolean(atual.pgdasRecibo);
        tx.set(ref, {
            ...identidade,
            emissaoAssinatura: assinatura,
            emissaoEtapa: recuperar ? 'gerando' : 'transmitindo',
            emissaoAtualizadaEm: new Date().toISOString(),
            ...(atual.statusPagamento ? {} : { statusPagamento: 'pendente', dataPagamento: null }),
        }, { merge: true });
        return { concluida: false, recuperar, atual };
    });
}
