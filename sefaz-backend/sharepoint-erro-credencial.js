// ============================================================================
// sefaz-backend/sharepoint-erro-credencial.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 "FALHA AO SUBIR NO SHAREPOINT. REENVIE O ARQUIVO DEPOIS DE CONFERIR O
// ACESSO À PASTA" — sobre um erro que NÃO é da pasta e NÃO é do cliente.
//
// 31/08, CLINICA MANTOAN 08/2026. A etapa 5 da Rotina travava com:
//
//   Azure AD token error (401): {"error":"invalid_client",
//   "error_description":"AADSTS7000215: Invalid client secret provided…"}
//
// e mandava **conferir o acesso à pasta**. A pasta está certa: o que expirou é
// o **client secret** do app no Azure AD, que é credencial da CASA — e
// enquanto ele não for renovado **nenhum cliente** arquiva nada.
//
// 🔴 Mandar a pessoa conferir a pasta é a primeira parada ERRADA (a família do
// achado 18 de 21/08). E a ação que ela tomaria em seguida é pior: **reenviar
// a guia DUPLICA a cobrança no cliente**, e não resolve nada.
//
// 📌 É a lição de 28/08 aplicada onde ela ainda não estava: naquele dia o CARD
// "Conexão SharePoint" aprendeu a separar erro de CREDENCIAL de erro de PASTA
// (*"erro de pasta continua sendo âmbar, de propósito: a ação dele é outra"*),
// e o painel de ENVIOS — que é onde o colaborador está quando o mês trava —
// ficou com a frase antiga. **Meia correção.**
//
// ⚠️ A régua mora AQUI, e o `services/sharepointConexaoVeredito.ts` IMPORTA:
// quem lê esta assinatura é o BACKEND (o painel de envios e a Rotina), e uma
// segunda cópia divergiria no primeiro código de erro novo — que é exatamente
// o que acabou de acontecer (o card conhecia o AADSTS90002 e o painel não
// conhecia nenhum).
// ============================================================================

/**
 * A assinatura de uma falha de CREDENCIAL — ela pede ação DIFERENTE de um erro
 * de pasta: aqui não adianta conferir o caminho nem preencher grupo/pasta,
 * porque nenhuma gravação passa enquanto o token não sair.
 *
 * `AADSTS90002` é "tenant não encontrado" e `AADSTS7000215` é "client secret
 * inválido"; os outros cobrem app revogado e permissão retirada — todos do
 * mesmo balde "o proxy não consegue falar com a Microsoft".
 */
export const ASSINATURA_CREDENCIAL = /AADSTS|token error|invalid_client|invalid_request|unauthorized|401|403/i;

/** O erro é de credencial (da casa) e não de pasta (do cliente)? */
export function ehFalhaDeCredencial(motivo) {
    return ASSINATURA_CREDENCIAL.test(String(motivo || ''));
}

/**
 * A ação de uma falha de credencial, dita para quem está no fim de mês.
 *
 * 🚨 Ela diz TRÊS coisas que ninguém deduziria olhando a linha de um cliente:
 * que o problema não é daquela empresa, que **reenviar a guia duplica a
 * cobrança** e não resolve, e onde a credencial vive.
 */
export const ACAO_CREDENCIAL_ENVIO =
    'NÃO é desta empresa e NÃO é a pasta dela: é a credencial do proxy do SharePoint, e enquanto ela '
    + 'não for renovada NENHUM cliente arquiva — a etapa 5 fica travada na carteira inteira. '
    + '⚠️ NÃO reenvie a guia: o cliente já recebeu, e reenviar DUPLICA a cobrança sem resolver isto. '
    + 'O client id e o tenant vivem em .github/workflows/deploy-proxy.yml e o segredo no Secret Manager '
    + '(graph-client-secret) — segredo do Azure AD EXPIRA, e a renovação é gerar um novo no portal do '
    + 'Azure e gravar a versão nova. Confira o card "Conexão SharePoint" em Central de XMLs → Integrações.';

/**
 * Motivo + ação de uma falha de gravação no SharePoint.
 *
 * ⚠️ Erro de PASTA continua com a ação dele (conferir o caminho) — mandar mexer
 * no proxy por causa dele seria o alarme com a primeira parada errada, na
 * direção contrária.
 */
export function pendenciaDeGravacaoSharePoint(motivo) {
    const m = String(motivo || '').slice(0, 220);
    if (ehFalhaDeCredencial(m)) {
        return {
            causa: 'Credencial do SharePoint recusada pela Microsoft (não é o cadastro desta empresa)',
            acao: `${ACAO_CREDENCIAL_ENVIO} Motivo: ${m || 'não informado'}`,
            deQuem: 'casa',
        };
    }
    return {
        causa: 'Falha ao gravar no SharePoint',
        acao: `Reenvie o arquivo depois de conferir o acesso à pasta. Motivo: ${m || 'não informado'}`,
        deQuem: 'empresa',
    };
}
