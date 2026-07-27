// ============================================================================
// empresa-status-helper.js
// ----------------------------------------------------------------------------
// Regras puras para o painel "Status de Captura por Empresa".
// Mantém separado o que é elegível no Cloud Run e o que está coberto por
// operação local A3, para não marcar empresa A3 como "faltando cadastro".
// ============================================================================

export function classificarCapturaNfseNacionalAdn({
    nfseNacionalDfeAtivo,
    temA1ProprioValido,
    // Filial SEM cert próprio que usa o A1 da MATRIZ (mesma raiz de CNPJ).
    // Paulo, 27/07 (caso J.N. VINATEX 0002-78/0003-59): o ADN rejeita raiz
    // DIVERGENTE (E2243) — mesma raiz é aceita, igual ao NFe DistDFe, que já
    // mostra "A1 raiz". Sem isto a filial ficava ✗ vermelha sem necessidade.
    temA1MesmaRaizValido,
    ehEscritorio,
    tipoCert,
    usaCertEscritorio,
    procuracaoEcacAtiva,
    certUploaded,
    certValido,
}) {
    if (!nfseNacionalDfeAtivo) {
        return {
            ok: false,
            via: 'inativa',
            motivo: 'NFS-e Nacional ADN desativada no cadastro. Ative NFS-e Nacional para incluir esta empresa na captura ADN.',
        };
    }

    if (temA1ProprioValido || ehEscritorio) {
        return { ok: true, via: 'cloud-a1', motivo: null };
    }

    if (temA1MesmaRaizValido) {
        return { ok: true, via: 'cloud-a1-raiz', motivo: null };
    }

    if (tipoCert === 'A3' && certUploaded) {
        return { ok: true, via: 'a3-local', motivo: null };
    }

    if (usaCertEscritorio || procuracaoEcacAtiva) {
        return {
            ok: false,
            via: 'bloqueada',
            motivo: 'NFS-e Nacional ADN: procuração/certificado do escritório não basta para consultar DFe; cadastre A1 próprio da empresa (ou da matriz, mesma raiz de CNPJ) ou use agente A3 local.',
        };
    }

    if (certUploaded && !certValido) {
        return {
            ok: false,
            via: 'bloqueada',
            motivo: 'NFS-e Nacional ADN: certificado A1 próprio vencido ou sem validade; renove ou reenvie o .pfx.',
        };
    }

    return {
        ok: false,
        via: 'bloqueada',
        motivo: 'NFS-e Nacional ADN: falta certificado A1 próprio da empresa (ou da matriz, mesma raiz de CNPJ) ou marcação A3 para agente local.',
    };
}
