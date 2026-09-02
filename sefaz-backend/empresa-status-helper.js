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
    // 🚨 O trilho do portal de SP CAPITAL não usa certificado (é CCM +
    // autorização), então para essa empresa o A3 não impede a NFS-e TOMADA de
    // ser capturada. Sem este fato a frase deste módulo AFIRMA DEMAIS e manda
    // importar à mão por cima de uma captura que já roda.
    // ⚠️ Ausente = false: assumir "é da capital" no escuro mandaria conferir um
    // portal que não se aplica (o caso 4BZ/Jundiaí de 24/07, ao contrário).
    nfseSpAplicavel = false,
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
    //
    // 🚨 E A PRIMEIRA VERSÃO DESTA FRASE AFIRMAVA DEMAIS — corrigida no mesmo
    // dia, quando o dono disse *"empresa não tem A1, somente A3"*.
    //
    // Ela dizia *"não existe trilho automático de NFS-e para esta empresa"*, e
    // isso é **FALSO em SP capital**: lá a NFS-e TOMADA vem pelo **portal da
    // Prefeitura**, que usa **CCM + autorização** e **não usa certificado
    // NENHUM** — o A3 é irrelevante para aquele trilho. Mandar essa empresa
    // importar à mão seria trabalho manual por cima de uma captura que já roda.
    //
    // 📌 **Nome/frase que afirma demais é o `csllOuTotal` com outra roupa**: quem
    // lê acredita. Este ramo fala do **ADN**, e a frase passou a dizer só isso —
    // e a apontar o portal quando ele é o trilho da empresa.
    if (tipoCert === 'A3' && certUploaded) {
        const semA3ADN = 'NFS-e Nacional ADN: o certificado A3 não roda no Cloud Run e o agente local '
            + 'A3 captura NF-e e NFC-e, NUNCA NFS-e — rodar a captura do ADN não resolve.';
        return {
            ok: false,
            via: 'a3-sem-trilho-nfse',
            motivo: nfseSpAplicavel
                // ⚠️ Aqui existe trilho, e ele não depende de certificado: a
                // ação é conferir o portal, NÃO importar à mão.
                ? `${semA3ADN} Esta empresa é de SP capital, e a NFS-e TOMADA dela vem pelo portal da `
                  + 'Prefeitura (CCM + autorização), que não usa certificado — confira a coluna NFS-e SP. '
                  + 'O ADN só passaria a valer com um A1 próprio (ou o da matriz, mesma raiz de CNPJ).'
                : `${semA3ADN} E não há outro trilho automático de NFS-e para esta empresa: fora de SP `
                  + 'capital quem traz a NFS-e é o ADN. Saídas: cadastre um A1 próprio (ou o da matriz, '
                  + 'mesma raiz de CNPJ — o ADN aceita), ou traga a NFS-e por outro caminho (portal do '
                  + 'município, cofre de e-mail, ou Importar em Central de XMLs).',
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
