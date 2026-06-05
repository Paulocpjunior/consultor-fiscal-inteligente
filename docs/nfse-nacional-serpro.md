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
- `SEFAZ_CERT_NAME=sefaz-cert-a1`: certificado A1 no Secret Manager.
- `SEFAZ_PASS_NAME=sefaz-cert-password`: senha do A1 no Secret Manager.

## Payload aceito

Em SERPRO, o backend aceita:

- `dpsXmlGZipB64`: DPS oficial ja assinada e compactada em GZip/base64.
- `dpsXmlAssinado`: DPS XML assinada; o backend apenas compacta.
- `dpsXml`: DPS XML no layout oficial; o backend assina `infDPS` com o certificado A1 e compacta.

O formulario simples continua servindo para dados de tela e persistencia interna, mas a emissao real depende da DPS no layout oficial 1.01. O backend nao fabrica XML fiscal a partir de campos incompletos.

## Retorno

Em sucesso, a SEFIN retorna `chaveAcesso`, `idDps`, `dataHoraProcessamento` e `nfseXmlGZipB64`. O backend persiste a NFSe em `nfse_nacional_emitidas` com `fonte=serpro`, `modeUsado=serpro` e guarda o XML compactado retornado.

## Cancelamento

A emissao esta liberada. O cancelamento real exige `pedidoRegistroEventoXmlGZipB64` no layout oficial de eventos e ainda nao esta ligado ao botao simples da tela.
