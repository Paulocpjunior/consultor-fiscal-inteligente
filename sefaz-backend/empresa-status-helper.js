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

    // 🚨 A3 NÃO TEM AGENTE DE NFS-e — e o painel dizia que tinha (02/09, caso
    // SILVIO FREIRE, empresa 93, ao perguntar pela NFS-e de ENTRADA dela).
    //
    // Isto respondia `ok: true · via: 'a3-local' · motivo: null` — ou seja,
    // **✓ NFSe Nac** na linha, sem bloqueio nenhum —, apoiado no comentário de
    // que "depende do agente local A3".
    //
    // ✅ **QUEM FECHOU A MEDIÇÃO FOI O DONO** (Paulo, 02/09): *"o agente só
    // puxa NF-e da SEFAZ, não puxa NFS-e"*. E o código concorda: o
    // `GET /state/:cnpj` do agente devolve `sefaz_state` — o cursor do
    // **DistDFe** —, e não existe rota que ofereça o cursor do **ADN**.
    //
    // ⚠️ **ROTA QUE ACEITA ≠ TRILHO QUE TRAZ, e isso quase me enganou**: o
    // `POST /upload-batch` DETECTA NFS-e Nacional e importa. Mas isso é REDE
    // (para o dia em que chegar) — o agente não tem de onde buscar.
    //
    // 🔴 E O PRÓPRIO TRILHO JÁ RECUSAVA: `nfse-nacional-dfe-eligibility.js`
    // devolve INELEGÍVEL para A3 (*"ADN no Cloud Run exige A1 proprio;
    // certificado A3 precisa fluxo/agente local especifico"*) — fluxo que não
    // existe. Duas leituras do mesmo fato discordando: a elegibilidade diz
    // "não roda", o painel dizia "✓ ok".
    //
    // 📌 É o `temA3Proprio` de 23/08 repetido no trilho da NFS-e: validação por
    // STATUS (tem cartão A3 cadastrado) lida como RESULTADO (está capturando).
    //
    // ⚠️ E A AÇÃO ANTIGA MANDAVA AO LUGAR QUE NÃO RESOLVE: como o ADN nunca
    // roda, a cobertura caía em `adn-sem-visita` e dizia *"Rode a captura da
    // NFS-e Nacional para este CNPJ"* — clique que o próprio trilho recusa.
    // É o achado 18 (21/08) na forma mais cara. O número de alarmes NÃO muda
    // (a empresa já acendia); o que muda é a CAUSA e a AÇÃO.
    //
    // ⚠️ A saída do A1 DA MATRIZ já foi testada acima (`temA1MesmaRaizValido`):
    // chegar aqui significa que ela não existe. Por isso ela vai na frase.
    if (tipoCert === 'A3' && certUploaded) {
        return {
            ok: false,
            via: 'a3-sem-trilho-nfse',
            motivo: 'NFS-e Nacional ADN: o certificado A3 não roda no Cloud Run e o agente local A3 '
                + 'captura NF-e e NFC-e, NUNCA NFS-e — não existe trilho automático de NFS-e para esta '
                + 'empresa, e rodar a captura do ADN não resolve. Saídas: cadastre um A1 próprio (ou o '
                + 'da matriz, mesma raiz de CNPJ — o ADN aceita), ou traga a NFS-e por outro caminho '
                + '(portal do município, cofre de e-mail, ou Importar em Central de XMLs).',
        };
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
