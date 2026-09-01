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

    it('e onde a credencial vive — segredo do Azure AD EXPIRA', () => {
        expect(ACAO_CREDENCIAL_ENVIO).toMatch(/graph-client-secret/);
        expect(ACAO_CREDENCIAL_ENVIO).toMatch(/EXPIRA/);
        expect(ACAO_CREDENCIAL_ENVIO).toMatch(/deploy-proxy\.yml/);
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
