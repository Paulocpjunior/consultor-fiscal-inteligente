# NFSe Nacional via SEFIN/SERPRO

## Status

A emissao em modo `NFSE_NAC_MODE=serpro` chama a API oficial da SEFIN Nacional:

- producao: `https://sefin.nfse.gov.br/SefinNacional`
- producao restrita: `https://sefin.producaorestrita.nfse.gov.br/SefinNacional`

Use `NFSE_NAC_BASE_URL` para sobrescrever a URL caso a infraestrutura oficial altere o roteamento.

## Variaveis

- `NFSE_NAC_MODE=serpro`: ativa emissao real. Use `mock` apenas em dev.
- `NFSE_NAC_ENV=producao`: ambiente padrao.
- `NFSE_NAC_ENV=restrita`: homologacao/producao restrita.
- `NFSE_NAC_BASE_URL`: override da base da SEFIN Nacional.
- `NFSE_NAC_TIMEOUT_MS=60000`: timeout da chamada.
- `NFSE_NAC_SERIE_DPS=1`: serie padrao usada se o payload nao informar serie.
- `NFSE_NAC_VER_APLIC=CFI-1.2.1`: identificacao do aplicativo no XML da DPS.
- `NFSE_NAC_DEFAULT_CTRIBNAC`: opcional; use apenas se o escritorio quiser um codigo nacional padrao explicito.
- `SEFAZ_CERT_NAME=sefaz-cert-a1`: certificado A1 no Secret Manager.
- `SEFAZ_PASS_NAME=sefaz-cert-password`: senha do A1 no Secret Manager.

## Payload aceito

Em SERPRO, o backend aceita:

- formulario: o backend monta a DPS 1.01, assina `infDPS` com o A1 do escritorio e compacta em GZip/base64.
- `dpsXmlGZipB64`: DPS oficial ja assinada e compactada em GZip/base64.
- `dpsXmlAssinado`: DPS XML assinada; o backend apenas compacta.
- `dpsXml`: DPS XML no layout oficial; o backend assina `infDPS` com o certificado A1 e compacta.

Para montar a DPS pelo formulario, informe no minimo:

- `prestador.cnpj`, `prestador.nome`, `prestador.municipioIbge` e, quando houver, `prestador.im`.
- `tomador.cnpj` ou `tomador.cpf`, mais `tomador.nome`.
- `servico.descricao`, `servico.valor`, `servico.aliquotaIss`, `servico.municipioPrestacao` e `servico.cTribNac`.
- `serieDps` e `numeroDps`.

O certificado usado e o A1 configurado para o escritorio no Secret Manager. O CNPJ do certificado precisa estar autorizado como prestador ou procurador no ecossistema NFS-e Nacional/SERPRO para a emissao real ser aceita.

O gerador automatico cobre a emissao comum: prestador CNPJ/CPF, tomador CPF/CNPJ nacional, Simples Nacional ME/EPP, servico tributavel, com ou sem ISS retido pelo tomador. Operacoes com obra, exportacao/importacao de servico, imunidade/isencao, beneficio municipal, intermediario, tomador exterior ou regras municipais especiais devem usar `dpsXml`/`dpsXmlAssinado` ate haver builders especificos.

## Retorno

Em sucesso, a SEFIN retorna `chaveAcesso`, `idDps`, `dataHoraProcessamento` e `nfseXmlGZipB64`. O backend persiste a NFSe em `nfse_nacional_emitidas` com `fonte=serpro`, `modeUsado=serpro` e guarda o XML compactado retornado.

## Cancelamento

A emissao esta liberada. O cancelamento real exige `pedidoRegistroEventoXmlGZipB64` no layout oficial de eventos e ainda nao esta ligado ao botao simples da tela.
