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

// ============================================================================
// 🚨 "CREDENCIAL RECUSADA" NÃO É UMA CAUSA SÓ — e a frase afirmava a ERRADA
//
// 01/09. A frase acima dizia *"segredo do Azure AD EXPIRA, e a renovação é
// gerar um novo"* — e o segredo do escritório **vence em 10/05/2028**. O que a
// Microsoft respondeu foi outra coisa, e ela DIZ a causa na própria resposta:
//
//   AADSTS7000215: Invalid client secret provided. Ensure the secret being
//   sent in the request is the client secret VALUE, not the client secret ID.
//
// 🔴 **A TELA DO AZURE INDUZ EXATAMENTE ESSE ERRO**: o *Secret ID* (um GUID,
// cheio de hifens) fica visível e copiável para sempre; o **Valor** aparece
// **só no instante em que o segredo é criado** e depois vira `hmB***`. Quem
// volta na tela para "pegar o segredo" copia o único campo que está lá — o ID.
//
// 📌 **E EU AFIRMEI EXPIRAÇÃO SEM MEDIR**: li "invalid client secret" como
// "vencido", e a validade estava na mesma tela dizendo 2028. Dizer a falha
// errada manda procurar no lugar errado (a família do *"arquivo não é desta
// empresa"* de 31/08) — e aqui manda renovar um segredo que não precisava ser
// renovado, deixando a causa real de pé.
//
// ⚠️ QUEM DECIDE É O TEXTO DA RESPOSTA, e o código só CORROBORA — a mesma
// régua do `cStat 653` e do `cStat 640` da SEFAZ. Segredo VENCIDO devolve
// outro código, com a palavra "expired" escrita; carimbar de memória o número
// dele seria inventar código de tabela oficial.
//
// 🚨 **E EU ERREI DE NOVO NA DIREÇÃO CONTRÁRIA — 02/09.** Corrigida a
// afirmação de expiração, a frase passou a AFIRMAR *"o que está gravado é o
// ID"*. Também não se prova pela mensagem: aquela sentença é o texto PADRÃO
// que a Microsoft anexa a **todo** 7000215 — ela aparece igual quando o Valor
// está certo e foi mandado para o **app errado** (o CFI tem dois), e quando a
// colagem veio truncada. Duas vezes no mesmo campo, a mesma classe: **ler a
// mensagem como se fosse diagnóstico**.
//
// ✂️ A causa passou a se chamar `'segredo-nao-confere'` — o nome do que se
// SABE — e a instrução lista as três possibilidades com as ações delas. Quem
// desempata é a MEDIÇÃO (`forma-do-segredo.js`, ligado no Diagnóstico →
// Config), que diz a FORMA do segredo gravado sem nunca mostrar o valor.
// 📌 **Nome de causa que afirma mais do que se mediu é o `csllOuTotal` com
// outra roupa**: quem lê `segredo-id-em-vez-do-valor` no código acredita.
// ============================================================================

// ============================================================================
// 🚨 SÃO DOIS APPS DO AZURE, E A FRASE FALAVA COMO SE FOSSE UM SÓ
//
// 01/09, ainda no mesmo dia: com o card já dizendo ID×Valor, o Paulo foi
// mandar o DAS da ZAMBOLIN e levou **o MESMO `AADSTS7000215`** — só que
// nomeando **outro aplicativo**. A própria resposta da Microsoft carrega o id:
//
//   · card Conexão SharePoint → app 'a876887f-a126-424f-8d8a-fc011519855e'
//   · envio de e-mail (Graph) → app '59fd4ec9-37bd-472c-9fa7-373461dffd50'
//
// 🔴 São credenciais DIFERENTES, guardadas em lugares DIFERENTES — renovar uma
// não conserta a outra. A frase mandava, nos dois casos, gravar em
// `graph-client-secret` e subir revisão do PROXY: para quem estava sem enviar
// e-mail, isso é a primeira parada ERRADA de novo, um dia depois.
//
// 📌 QUEM DECIDE É O TEXTO DA RESPOSTA — o id do app vem escrito nela, como
// vinha a diferença entre ID e Valor. O que o app faz é LER e dizer onde
// aquele segredo mora.
//
// ⚠️ E ONDE CADA UM MORA FOI MEDIDO, não deduzido: `grep GRAPH_` nos workflows
// deste repo acha o segredo do PROXY cravado no `deploy-proxy.yml` e **nenhum**
// escrevendo o `GRAPH_CLIENT_SECRET` do serviço do CFI — ou seja, o do e-mail
// vive na configuração do serviço, e ali a edição no console PERSISTE (o
// deploy passa só a imagem e `--update-*`, que mescla). Foi ler o workflow que
// evitou repetir, ao contrário, o erro de 28/08.
//
// ⚠️ App NÃO MAPEADO devolve o id CRU e nenhum lugar inventado: dizer onde
// gravar um segredo que talvez não seja esse é o que este módulo existe para
// não fazer.
// ============================================================================

/** Os apps que a Microsoft já nomeou numa recusa real, com onde o segredo mora. */
export const APPS_AZURE = {
    'a876887f-a126-424f-8d8a-fc011519855e': {
        nome: 'proxy do SharePoint (arquivamento de XML e da guia)',
        onde: 'Secret Manager → graph-client-secret (projeto consultorfiscalapp), e depois uma REVISÃO NOVA '
            + 'do proxy (Actions → Deploy SharePoint Proxy → Run workflow): o :latest só é lido quando o '
            + 'contêiner sobe.',
    },
    '59fd4ec9-37bd-472c-9fa7-373461dffd50': {
        nome: 'envio de e-mail pelo Microsoft Graph (guia ao cliente)',
        onde: 'na variável GRAPH_CLIENT_SECRET do serviço consultor-fiscal-inteligente (Cloud Run). '
            + '⚠️ O tráfego deste serviço fica PINADO numa revisão: editar a variável cria uma revisão NOVA '
            + 'a 0% de tráfego, então é preciso rotear o tráfego para ela (ou esperar o próximo deploy, que '
            + 'carrega a variável junto).',
    },
};

/**
 * Qual app do Azure a Microsoft nomeou na recusa.
 *
 * Devolve o id CRU mesmo quando ele não está mapeado — é ele que a pessoa
 * procura no portal do Azure.
 */
export function appDaCredencial(motivo) {
    const m = /app\s+'([0-9a-f-]{36})'/i.exec(String(motivo || ''));
    const id = m ? m[1].toLowerCase() : null;
    const conhecido = id ? APPS_AZURE[id] : null;
    return { id, nome: conhecido ? conhecido.nome : null, onde: conhecido ? conhecido.onde : null };
}

/**
 * Qual é a causa da recusa, quando a resposta da Microsoft permite dizer.
 *
 * ⚠️ `'indeterminada'` é resposta legítima: sem assinatura conhecida o app
 * DIZ que a credencial foi recusada e **não afirma o motivo** — afirmar manda
 * a pessoa a uma primeira parada que pode não ser a certa.
 */
export function causaDaFalhaDeCredencial(motivo) {
    const m = String(motivo || '');
    // A mais específica primeiro: a própria resposta nomeia ID × Valor.
    if (/AADSTS7000215/i.test(m) || /secret\s+value.*not.*secret\s+id/i.test(m)) return 'segredo-nao-confere';
    if (/expir/i.test(m) && /(secret|key|certificate)/i.test(m)) return 'segredo-expirado';
    if (/AADSTS90002/i.test(m) || /tenant[^.]*not\s+found/i.test(m)) return 'tenant-inexistente';
    return 'indeterminada';
}

/**
 * ONDE aquele segredo mora — a metade que faltava.
 *
 * 🚨 São DOIS apps do Azure com credenciais próprias, e a resposta da Microsoft
 * nomeia qual deles recusou. Mandar gravar no lugar do outro é a primeira
 * parada errada com cara de instrução precisa.
 */
function ondeGravar(motivo) {
    const app = appDaCredencial(motivo);
    if (app.onde) return ` Este é o app do ${app.nome} (${app.id}) — grave a versão nova ${app.onde}`;
    if (app.id) {
        return ` A Microsoft nomeou o app ${app.id}, que este app não conhece: procure esse id no portal do `
            + 'Azure para saber de qual credencial se trata. O CFI tem DUAS — a do proxy do SharePoint e a do '
            + 'envio de e-mail —, e gravar na errada não resolve.';
    }
    return ' ⚠️ A resposta não nomeou o aplicativo: leve a mensagem INTEIRA ao portal do Azure. O CFI tem '
        + 'DUAS credenciais (proxy do SharePoint e envio de e-mail) e elas se gravam em lugares diferentes.';
}

/**
 * A instrução da causa — a parte que MUDA conforme o que a Microsoft
 * respondeu. Ela é de DONO ÚNICO porque os dois leitores (o card "Conexão
 * SharePoint" e o painel de envios) precisam dizer a mesma coisa: em 31/08 as
 * duas frases já divergiram uma vez, e o painel ficou meses com a antiga.
 */
export function instrucaoDaCredencial(motivo) {
    switch (causaDaFalhaDeCredencial(motivo)) {
        case 'segredo-nao-confere':
            return 'O segredo gravado não confere com o que o Azure espera para este aplicativo. '
                + '⚠️ A frase que vem junto ("informe o VALOR do segredo, não o ID") é o texto PADRÃO que a '
                + 'Microsoft anexa a TODO AADSTS7000215 — ela é a causa mais comum, não um diagnóstico. '
                + 'São TRÊS possibilidades, com ações diferentes: (1) foi copiado o Secret ID (um GUID de 36 '
                + 'caracteres, o único campo que a tela do Azure deixa copiável depois — o Valor aparece SÓ '
                + 'no instante da criação e depois vira hmB***); (2) o segredo é de OUTRO aplicativo (o CFI '
                + 'tem dois, e o Valor certo do app errado recusa exatamente assim); (3) a colagem veio '
                + 'truncada ou com espaço/quebra de linha no fim. '
                + 'Quem desempata é a MEDIÇÃO, não a mensagem: o painel Diagnóstico → Config diz a FORMA do '
                + 'que está gravado (ele acusa "é o ID" e "tem espaço" sem nunca mostrar o valor). '
                + '⚠️ E isto NÃO é validade: segredo dentro do prazo recusa igual.'
                + ondeGravar(motivo);
        case 'segredo-expirado':
            return 'O segredo venceu. Crie um novo no Azure (App registrations → Certificates & secrets → '
                + 'New client secret) e copie a coluna Valor NA HORA — depois ela some.'
                + ondeGravar(motivo);
        case 'tenant-inexistente':
            return 'O tenant enviado não existe. Ele vive CRAVADO em .github/workflows/deploy-proxy.yml '
                + '(SHAREPOINT_TENANT_ID) — confira contra o issuer que o endpoint público de descoberta da '
                + 'Microsoft devolve para o domínio do escritório.';
        default:
            return 'A Microsoft recusou a credencial e a resposta não diz qual é a causa — leve a mensagem '
                + 'INTEIRA (código AADSTS, Trace ID e Timestamp) para o portal do Azure. O app não deduz o '
                + 'motivo: dizer a falha errada manda procurar no lugar errado.';
    }
}

/**
 * 🚨 A MESMA RECUSA CHEGA NO ENVIO DA GUIA — e lá ela chegava CRUA.
 *
 * 01/09: mandando o DAS da ZAMBOLIN, o toast trouxe `Falha ao obter token
 * Graph (401): {"error":"invalid_client","error_description":"AADSTS7000215…`.
 * Mensagem de órgão despejada na tela não é informação: ela não diz o que
 * fazer, e o e-mail do cliente simplesmente não sai.
 *
 * ⚠️ Devolve **null** quando a falha NÃO é de credencial — o erro original
 * segue inteiro, porque traduzir o que não se reconhece é dizer a falha errada.
 *
 * @returns {string|null}
 */
export function mensagemDeCredencialRecusada(erro) {
    const m = String(erro || '');
    if (!m || !ehFalhaDeCredencial(m)) return null;
    return 'A Microsoft recusou a credencial — o e-mail NÃO foi enviado ao cliente, e nenhum outro sai '
        + 'enquanto isto durar. '
        + `${instrucaoDaCredencial(m)} `
        + 'Enquanto não for resolvido, use "Abrir no Outlook Web": ele manda pela SUA caixa, sem passar por '
        + 'esta credencial — mas ali o PDF da guia vai ANEXADO POR VOCÊ e o gestor entra em cópia visível. '
        + `Resposta da Microsoft: ${m.slice(0, 300)}`;
}

/**
 * 🚨 O CORTE DECAPITA O NOME DO APP — e ele é a única coisa que decide ONDE
 * gravar o segredo.
 *
 * 02/09, no print do Auto-Sync: **1.668 erros**, todos terminando em
 * *"...is the client secre"* — cortados no caractere 200, e a Microsoft só
 * nomeia o aplicativo **depois** disso (`for a secret added to app '…'`).
 * Resultado: o card dizia *"a resposta não nomeou o aplicativo"* sobre 416
 * respostas que nomeavam.
 *
 * 📌 É o MESMO defeito que o `pendenciaDeGravacaoSharePoint` tinha um dia
 * antes (corte em 220 antes de ler), agora um nível acima — na GRAVAÇÃO do
 * log. Lá o dado ainda existia; aqui ele **nunca chega**.
 *
 * ⚠️ A saída não é tirar o limite (log de 400 empresas não pode crescer sem
 * teto): é o corte **não poder** engolir o fato decisivo. O app id é extraído
 * da mensagem INTEIRA e reanexado depois do corte.
 */
export function recortarPreservandoApp(mensagem, limite = 200) {
    const inteiro = String(mensagem || '');
    if (inteiro.length <= limite) return inteiro;
    const { id } = appDaCredencial(inteiro);
    if (!id) return inteiro.slice(0, limite);
    // ⚠️ O sufixo reproduz a FORMA que `appDaCredencial` lê (`app '<id>'`) —
    // reanexar o id noutro formato o deixaria invisível para o próprio dono,
    // que é o defeito com outra roupa. Pego pelo teste.
    const sufixo = ` […] [app '${id}']`;
    return inteiro.slice(0, Math.max(0, limite - sufixo.length)) + sufixo;
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
    + 'não for aceita NENHUM cliente arquiva — a etapa 5 fica travada na carteira inteira. '
    + '⚠️ NÃO reenvie a guia: o cliente já recebeu, e reenviar DUPLICA a cobrança sem resolver isto. '
    + 'Confira o card "Conexão SharePoint" em Central de XMLs → Integrações.';

/**
 * A ação COMPLETA para quem está no fim de mês: o que não fazer (reenviar) +
 * a instrução da causa que a Microsoft de fato respondeu.
 */
export function acaoCredencialEnvio(motivo) {
    return `${ACAO_CREDENCIAL_ENVIO} ${instrucaoDaCredencial(motivo)}`;
}

/**
 * Motivo + ação de uma falha de gravação no SharePoint.
 *
 * ⚠️ Erro de PASTA continua com a ação dele (conferir o caminho) — mandar mexer
 * no proxy por causa dele seria o alarme com a primeira parada errada, na
 * direção contrária.
 */
export function pendenciaDeGravacaoSharePoint(motivo) {
    // 🐛 O CORTE DECAPITAVA JUSTAMENTE O NOME DO APP. A mensagem inteira era
    // truncada em 220 caracteres ANTES de ser lida, e o `for a secret added to
    // app '…'` vem depois disso — então a instrução dizia "a resposta não
    // nomeou o aplicativo" sobre uma resposta que nomeava. Quem lê é a mensagem
    // INTEIRA; o corte vale só para o eco do "Motivo:" na tela.
    const inteiro = String(motivo || '');
    const m = inteiro.slice(0, 220);
    if (ehFalhaDeCredencial(inteiro)) {
        return {
            causa: 'Credencial do SharePoint recusada pela Microsoft (não é o cadastro desta empresa)',
            acao: `${acaoCredencialEnvio(inteiro)} Motivo: ${m || 'não informado'}`,
            deQuem: 'casa',
        };
    }
    return {
        causa: 'Falha ao gravar no SharePoint',
        acao: `Reenvie o arquivo depois de conferir o acesso à pasta. Motivo: ${m || 'não informado'}`,
        deQuem: 'empresa',
    };
}
