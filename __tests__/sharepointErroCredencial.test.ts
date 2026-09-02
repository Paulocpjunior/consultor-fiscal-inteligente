// ============================================================================
// 🚨 "REENVIE O ARQUIVO DEPOIS DE CONFERIR O ACESSO À PASTA" — sobre um erro
// que não é da pasta, não é do cliente, e cuja "ação" DUPLICA a cobrança.
//
// 31/08, CLINICA MANTOAN 08/2026. A etapa 5 da Rotina travava com:
//
//   Azure AD token error (401): {"error":"invalid_client",
//   "error_description":"AADSTS7000215: Invalid client secret provided…"}
//
// 📌 É a meia correção de 28/08: naquele dia o CARD "Conexão SharePoint"
// aprendeu a separar CREDENCIAL de PASTA, e o painel de ENVIOS — que é onde o
// colaborador está quando o mês trava — ficou com a frase antiga.
// ============================================================================
import {
    ehFalhaDeCredencial, pendenciaDeGravacaoSharePoint, ACAO_CREDENCIAL_ENVIO,
    causaDaFalhaDeCredencial, instrucaoDaCredencial, appDaCredencial, mensagemDeCredencialRecusada,
    recortarPreservandoApp,
} from '../sefaz-backend/sharepoint-erro-credencial.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pendenciaSharePoint } from '../sefaz-backend/envio-imposto-painel.js';

// 📌 A MENSAGEM REAL, do print de 01/09 — ela NOMEIA o app, e a fixture antiga
// estava truncada antes disso ("..."). Fixture que não é o que a produção
// produz é teste verde sobre defeito vivo (a lição do art. 136, 22/08).
const ERRO_REAL = 'Azure AD token error (401): {"error":"invalid_client","error_description":'
    + '"AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the '
    + "client secret value, not the client secret ID, for a secret added to app "
    + "'a876887f-a126-424f-8d8a-fc011519855e'. Trace ID: 967e9ff3-abb6-47b5-bd0f-1bfe07911300\"}";

describe('🚨 credencial e pasta pedem ações OPOSTAS', () => {
    it('o erro REAL do print é de credencial', () => {
        expect(ehFalhaDeCredencial(ERRO_REAL)).toBe(true);
    });

    // ⚠️ O card já conhecia o AADSTS90002 (tenant) e o painel não conhecia
    // NENHUM — a segunda cópia divergiu no primeiro código de erro novo.
    it('as assinaturas de credencial conhecidas', () => {
        for (const m of [
            'AADSTS90002: Tenant not found', 'AADSTS7000215: Invalid client secret',
            'invalid_client', 'HTTP 401', 'HTTP 403', 'Azure AD token error',
        ]) expect(ehFalhaDeCredencial(m)).toBe(true);
    });

    it('erro de PASTA não é confundido com credencial', () => {
        for (const m of ['itemNotFound: pasta não existe', 'O caminho IMPOSTOS não foi encontrado', '']) {
            expect(ehFalhaDeCredencial(m)).toBe(false);
        }
    });
});

describe('🚨 a ação da credencial diz as três coisas que ninguém deduziria', () => {
    const p = pendenciaDeGravacaoSharePoint(ERRO_REAL);

    it('que NÃO é desta empresa', () => {
        expect(p.deQuem).toBe('casa');
        expect(p.acao).toMatch(/NÃO é desta empresa/);
        expect(p.acao).toMatch(/NENHUM cliente arquiva/);
    });

    // 🚨 A MAIS CARA: a ação natural de quem lê "reenvie" é reenviar a guia —
    // e o cliente recebe a cobrança DUAS vezes, sem resolver nada.
    it('que reenviar a guia DUPLICA a cobrança e não resolve', () => {
        expect(p.acao).toMatch(/NÃO reenvie a guia/);
        expect(p.acao).toMatch(/DUPLICA a cobrança/);
    });

    // 🐛 ESTA ASSERÇÃO EXIGIA A FRASE ERRADA — ela pedia `/EXPIRA/`, e a frase
    // do app AFIRMAVA expiração enquanto a Microsoft respondia outra coisa e a
    // validade, na tela do Azure, era 2028. Ela DESCREVIA o defeito em vez de
    // pegá-lo; trocada pelo que a resposta de fato diz.
    it('e onde a credencial vive, sem afirmar a causa errada', () => {
        expect(ACAO_CREDENCIAL_ENVIO).not.toMatch(/EXPIRA/);
        expect(p.acao).toMatch(/graph-client-secret/);
    });

    // 🐛 O CORTE DE 220 CARACTERES DECAPITAVA O NOME DO APP: ele vem depois
    // disso na resposta, então a instrução dizia "não nomeou o aplicativo"
    // sobre uma mensagem que nomeava — e mandava a pessoa ao Azure sem saber
    // qual das duas credenciais procurar.
    it('o app é lido da mensagem INTEIRA, não do trecho cortado', () => {
        expect(p.acao).toMatch(/proxy do SharePoint/);
        expect(p.acao).not.toMatch(/não nomeou o aplicativo/);
    });

    // ⚠️ Erro de PASTA mantém a ação DELE — mandar mexer no proxy por causa
    // dele seria o alarme com a primeira parada errada, na direção contrária.
    it('erro de pasta continua mandando conferir o caminho', () => {
        const q = pendenciaDeGravacaoSharePoint('itemNotFound');
        expect(q.deQuem).toBe('empresa');
        expect(q.acao).toMatch(/conferir o acesso à pasta/);
        expect(q.acao).not.toMatch(/DUPLICA/);
    });
});

// ============================================================================
// 🚨 "CREDENCIAL RECUSADA" NÃO É UMA CAUSA SÓ — e o app afirmava a ERRADA
//
// 01/09. O card dizia *"segredo do Azure AD EXPIRA, e a renovação é gerar um
// novo"*; a tela do Azure mostrava validade até **10/05/2028** e a Microsoft
// respondia, com todas as letras, que o que fora enviado era o **ID** do
// segredo e não o **VALOR**. Renovar o segredo não resolveria — e a tela do
// Azure induz exatamente esse erro: o Secret ID fica copiável para sempre, o
// Valor aparece só no instante em que o segredo é criado.
// ============================================================================
describe('🚨 a causa sai da RESPOSTA, e o app não deduz o resto', () => {
    it('o erro REAL do print é segredo recusado — e o app NÃO afirma qual das três causas', () => {
        expect(causaDaFalhaDeCredencial(ERRO_REAL)).toBe('segredo-nao-confere');
        const acao = instrucaoDaCredencial(ERRO_REAL);
        // ⚠️ ASSERÇÃO TROCADA EM 02/09, e ela é o retrato do defeito: a antiga
        // exigia /ID do segredo, não o VALOR/ — ou seja, ela DESCREVIA a
        // afirmação errada em vez de pegá-la. A frase da Microsoft é texto
        // PADRÃO de todo 7000215; afirmar a causa a partir dela é o mesmo
        // vício do "o segredo EXPIROU", que a tela do Azure desmentiu.
        expect(acao).toMatch(/texto PADRÃO/);
        // As TRÊS possibilidades, porque as ações são diferentes.
        expect(acao).toMatch(/Secret ID/);
        expect(acao).toMatch(/OUTRO aplicativo/);
        expect(acao).toMatch(/truncada|espaço/);
        // E quem desempata é a MEDIÇÃO, não a mensagem.
        expect(acao).toMatch(/Diagnóstico/);
        // ⚠️ E ela DESMENTE a leitura de validade, que é a primeira parada errada.
        expect(acao).toMatch(/NÃO é validade/);
        // O :latest é lido quando o contêiner sobe — gravar a versão nova não basta.
        expect(acao).toMatch(/REVISÃO NOVA do proxy/);
    });

    it('a frase pela SENTENÇA, sem depender do código', () => {
        expect(causaDaFalhaDeCredencial(
            'Ensure the secret being sent in the request is the client secret value, not the client secret ID',
        )).toBe('segredo-nao-confere');
    });

    // ⚠️ Segredo VENCIDO é outro fato, com outra ação — e quem decide é a
    // palavra "expired" na resposta, nunca um código de memória.
    it('segredo expirado é OUTRA causa', () => {
        const m = 'AADSTS7000222: The provided client secret keys for app ... are expired.';
        expect(causaDaFalhaDeCredencial(m)).toBe('segredo-expirado');
        expect(instrucaoDaCredencial(m)).toMatch(/venceu/);
    });

    it('tenant inexistente mantém a ação dele (o workflow)', () => {
        expect(causaDaFalhaDeCredencial('AADSTS90002: Tenant not found')).toBe('tenant-inexistente');
        expect(instrucaoDaCredencial('AADSTS90002: Tenant not found')).toMatch(/deploy-proxy\.yml/);
    });

    // 🚨 SEM ASSINATURA CONHECIDA O APP NÃO INVENTA MOTIVO: ele diz que a
    // credencial foi recusada e manda levar a mensagem inteira. Afirmar aqui é
    // mandar procurar no lugar errado, que foi o custo do dia.
    it('causa desconhecida NÃO vira motivo inventado', () => {
        const m = 'AADSTS50011: The redirect URI specified does not match';
        expect(causaDaFalhaDeCredencial(m)).toBe('indeterminada');
        const acao = instrucaoDaCredencial(m);
        expect(acao).toMatch(/não diz qual é a causa/);
        expect(acao).not.toMatch(/venceu|ID do segredo/);
        // continua sendo credencial: o balde não mudou
        expect(ehFalhaDeCredencial(m)).toBe(true);
    });
});

// ============================================================================
// 🚨 SÃO DOIS APPS DO AZURE, E A FRASE FALAVA COMO SE FOSSE UM SÓ
//
// 01/09, no mesmo dia em que o card aprendeu ID×Valor: mandando o DAS da
// ZAMBOLIN, o mesmo `AADSTS7000215` voltou nomeando OUTRO aplicativo. São
// credenciais diferentes, guardadas em lugares diferentes — e a frase mandava,
// nos dois casos, gravar no `graph-client-secret` e subir revisão do PROXY.
// ============================================================================
const ERRO_EMAIL = 'Falha ao obter token Graph (401): {"error":"invalid_client","error_description":'
    + '"AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the '
    + "client secret value, not the client secret ID, for a secret added to app "
    + "'59fd4ec9-37bd-472c-9fa7-373461dffd50'. Trace ID: 24e2ddef-30b9-464c-b585-45467cae\"}";

const ERRO_SHAREPOINT = 'Azure AD token error (401): {"error":"invalid_client","error_description":'
    + "\"AADSTS7000215: Invalid client secret provided. … for a secret added to app "
    + "'a876887f-a126-424f-8d8a-fc011519855e'. Trace ID: d4aee685\"}";

describe('🚨 a resposta nomeia QUAL app — e cada um se grava num lugar', () => {
    it('o app do e-mail é outro, e a instrução manda no lugar DELE', () => {
        expect(appDaCredencial(ERRO_EMAIL).id).toBe('59fd4ec9-37bd-472c-9fa7-373461dffd50');
        const acao = instrucaoDaCredencial(ERRO_EMAIL);
        expect(acao).toMatch(/envio de e-mail/);
        expect(acao).toMatch(/GRAPH_CLIENT_SECRET do serviço consultor-fiscal-inteligente/);
        // ⚠️ E não manda subir revisão do proxy, que é a credencial do OUTRO app.
        expect(acao).not.toMatch(/Deploy SharePoint Proxy/);
    });

    it('o app do SharePoint continua com a instrução dele', () => {
        expect(appDaCredencial(ERRO_SHAREPOINT).id).toBe('a876887f-a126-424f-8d8a-fc011519855e');
        const acao = instrucaoDaCredencial(ERRO_SHAREPOINT);
        expect(acao).toMatch(/proxy do SharePoint/);
        expect(acao).toMatch(/graph-client-secret/);
        expect(acao).not.toMatch(/GRAPH_CLIENT_SECRET do serviço/);
    });

    // 🚨 App que este app NÃO conhece devolve o id CRU e nenhum lugar
    // inventado — dizer onde gravar um segredo que talvez não seja esse é
    // exatamente o que custou o dia.
    it('app não mapeado não ganha lugar inventado', () => {
        const outro = ERRO_SHAREPOINT.replace('a876887f-a126-424f-8d8a-fc011519855e',
            '11111111-2222-3333-4444-555555555555');
        const app = appDaCredencial(outro);
        expect(app.id).toBe('11111111-2222-3333-4444-555555555555');
        expect(app.onde).toBeNull();
        const acao = instrucaoDaCredencial(outro);
        expect(acao).toMatch(/11111111-2222-3333-4444-555555555555/);
        expect(acao).toMatch(/DUAS/);
        expect(acao).not.toMatch(/graph-client-secret/);
    });

    it('resposta sem app nomeado diz que são duas e não escolhe', () => {
        const acao = instrucaoDaCredencial('AADSTS7000215: Invalid client secret provided.');
        expect(acao).toMatch(/não nomeou o aplicativo/);
        expect(acao).toMatch(/DUAS credenciais/);
    });
});

describe('🚨 a recusa no ENVIO da guia parou de chegar crua', () => {
    it('diz que o e-mail NÃO saiu, o que fazer e a saída de hoje', () => {
        const m = mensagemDeCredencialRecusada(ERRO_EMAIL)!;
        expect(m).toMatch(/e-mail NÃO foi enviado/);
        expect(m).toMatch(/GRAPH_CLIENT_SECRET do serviço/);
        expect(m).toMatch(/Outlook Web/);
        // ⚠️ A saída de hoje vai com as DUAS diferenças ditas — descobrir
        // depois que o PDF não foi é pior que anexar à mão.
        expect(m).toMatch(/ANEXADO POR VOCÊ/);
        expect(m).toMatch(/cópia visível/);
        // A resposta do órgão vai junto: é ela que a pessoa leva ao Azure.
        expect(m).toMatch(/AADSTS7000215/);
    });

    // ⚠️ O que NÃO é credencial segue inteiro — traduzir o que não se
    // reconhece é dizer a falha errada.
    it('falha de outra natureza não é traduzida', () => {
        for (const m of ['HTTP 500', 'E-mail do cliente ausente', '']) {
            expect(mensagemDeCredencialRecusada(m)).toBeNull();
        }
    });

    // 🔒 A LIGAÇÃO: as quatro telas de envio (DAS, DARF, DARE, ISS) passam
    // pelos dois serviços abaixo — traduzir num só deixaria metade das telas
    // com a mensagem crua.
    it('os dois caminhos de envio usam o dono', () => {
        for (const arquivo of ['dasService.ts', 'envioImpostoService.ts']) {
            const fonte = readFileSync(join(__dirname, '..', 'services', arquivo), 'utf8');
            expect({ arquivo, usa: /mensagemDeCredencialRecusada\(/.test(fonte) }).toEqual({ arquivo, usa: true });
        }
    });
});

describe('🔒 o painel de envios usa o DONO, não uma cópia', () => {
    it('a falha de credencial chega ao painel com a ação certa', () => {
        const r = pendenciaSharePoint({ sharePoint: { status: 'erro', motivo: ERRO_REAL } })!;
        expect(r.causa).toMatch(/Credencial do SharePoint recusada/);
        expect(r.acao).toMatch(/NÃO reenvie a guia/);
    });

    // ⚠️ Os desfechos que NÃO são pendência continuam não sendo.
    it('arquivado e sem-pdf continuam fora', () => {
        expect(pendenciaSharePoint({ sharePoint: { status: 'arquivado' } })).toBeNull();
        expect(pendenciaSharePoint({ sharePoint: { status: 'sem-pdf' } })).toBeNull();
    });

    it('sem-config mantém a ação dele (cadastrar grupo + pasta)', () => {
        const r = pendenciaSharePoint({ sharePoint: { status: 'sem-config' } })!;
        expect(r.acao).toMatch(/grupo \+ pasta/);
    });
});

// ============================================================================
// 🚨 O CORTE DECAPITAVA O NOME DO APP — 1.668 vezes, no print de 02/09
//
// O Auto-Sync gravava `${...}: ${err.message}`.slice(0, 200), e a Microsoft
// nomeia o aplicativo DEPOIS disso. Todos os 1.668 erros do log terminavam em
// "...is the client secre" e o card acusava, corretamente, que a resposta não
// nomeava o app — sobre 416 respostas que nomeavam.
//
// 📌 É o MESMO defeito do `pendenciaDeGravacaoSharePoint` (01/09), um nível
// acima: lá o dado ainda existia no objeto; aqui ele nunca chega ao banco.
// ============================================================================
describe('🚨 o corte não pode engolir o nome do app', () => {
    it('a linha do log de 200 caracteres PERDE o app — era o defeito', () => {
        const linha = `2026-08 SAÍDA: ${ERRO_REAL}`;
        expect(appDaCredencial(linha.slice(0, 200)).id).toBeNull();
    });

    it('e o recorte novo preserva o id, dentro do MESMO limite', () => {
        const linha = `2026-08 SAÍDA: ${ERRO_REAL}`;
        const cortado = recortarPreservandoApp(linha);
        expect(cortado.length).toBeLessThanOrEqual(200);
        expect(appDaCredencial(cortado).id).toBe('a876887f-a126-424f-8d8a-fc011519855e');
        // E daí o card volta a dizer ONDE gravar, em vez do genérico.
        expect(instrucaoDaCredencial(cortado)).toMatch(/proxy do SharePoint/);
    });

    it('mensagem curta não é tocada, e sem app o corte é o de sempre', () => {
        expect(recortarPreservandoApp('erro curto')).toBe('erro curto');
        const semApp = `x${'y'.repeat(400)}`;
        expect(recortarPreservandoApp(semApp)).toHaveLength(200);
    });
});
