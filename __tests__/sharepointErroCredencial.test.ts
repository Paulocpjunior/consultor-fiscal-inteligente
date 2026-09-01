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
    causaDaFalhaDeCredencial, instrucaoDaCredencial,
} from '../sefaz-backend/sharepoint-erro-credencial.js';
import { pendenciaSharePoint } from '../sefaz-backend/envio-imposto-painel.js';

const ERRO_REAL = 'Azure AD token error (401): {"error":"invalid_client","error_description":'
    + '"AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request..."}';

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
    it('o erro REAL do print é ID em vez de VALOR — a própria resposta diz', () => {
        expect(causaDaFalhaDeCredencial(ERRO_REAL)).toBe('segredo-id-em-vez-do-valor');
        const acao = instrucaoDaCredencial(ERRO_REAL);
        expect(acao).toMatch(/ID do segredo, não o VALOR/);
        // ⚠️ E ela DESMENTE a leitura de validade, que é a primeira parada errada.
        expect(acao).toMatch(/NÃO é validade/);
        // O :latest é lido quando o contêiner sobe — gravar a versão nova não basta.
        expect(acao).toMatch(/REVISÃO NOVA do proxy/);
    });

    it('a frase pela SENTENÇA, sem depender do código', () => {
        expect(causaDaFalhaDeCredencial(
            'Ensure the secret being sent in the request is the client secret value, not the client secret ID',
        )).toBe('segredo-id-em-vez-do-valor');
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
