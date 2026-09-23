// ============================================================================
// 🚨 "JÁ TÍNHAMOS MATADO ONTEM A QUESTÃO DO E-MAIL" — e não dava para conferir
//
// 02/09, Paulo. Ontem a credencial do **SharePoint** foi corrigida, e ela
// funciona (hoje o proxy listou sites e pastas). O e-mail é OUTRO aplicativo do
// Azure, e o único jeito de descobrir isso era **mandar uma guia a um cliente e
// ver falhar** — foi como a Sandra descobriu.
//
// 🔴 E O NOME DA VARIÁVEL É O MESMO NOS DOIS LUGARES, que é o que faz "matar
// um" parecer ter matado os dois:
//   · `GRAPH_CLIENT_SECRET` do PROXY  → app a876887f… → SharePoint
//   · `GRAPH_CLIENT_SECRET` do CFI    → app 59fd4ec9… → ENVIO DE E-MAIL
// ============================================================================
// @ts-expect-error — módulo .js puro
import { vereditoDaCredencialDeEmail } from '../sefaz-backend/graph-credencial-sonda.js';

// A resposta REAL da Microsoft, do print de 02/09.
const RECUSA = "Falha ao obter token Graph (401): {\"error\":\"invalid_client\","
    + "\"error_description\":\"AADSTS7000215: Invalid client secret provided. Ensure the secret "
    + "being sent in the request is the client secret value, not the client secret ID, for a "
    + "secret added to app '59fd4ec9-37bd-472c-9fa7-373461dffd50'.\"}";

describe('vereditoDaCredencialDeEmail', () => {
    it('recusa nomeia o aplicativo DO E-MAIL e onde aquele segredo mora', () => {
        const v = vereditoDaCredencialDeEmail({ ok: false, configurado: true, erro: RECUSA });
        expect(v.situacao).toBe('recusada');
        expect(v.app.id).toBe('59fd4ec9-37bd-472c-9fa7-373461dffd50');
        // 🚨 É este id que separa o app do e-mail do app do SharePoint.
        expect(v.app.nome).toMatch(/e-mail/i);
        expect(v.onde).toMatch(/consultor-fiscal-inteligente/);
    });

    // ⚠️ A frase da recusa vem do DONO: uma segunda leitura aqui divergiria da
    // que o card do SharePoint mostra para a MESMA resposta.
    it('a causa não é reescrita aqui — vem do dono', () => {
        const v = vereditoDaCredencialDeEmail({ ok: false, configurado: true, erro: RECUSA });
        expect(v.detalhe).toMatch(/texto PADRÃO|não confere/i);
    });

    // 🚨 "Não configurado" é OUTRO problema com OUTRA ação: falta preencher,
    // não foi recusado. Fundir manda procurar no Azure o que falta no Cloud Run.
    it('não configurado é situação própria, não recusa', () => {
        const v = vereditoDaCredencialDeEmail({ ok: false, configurado: false });
        expect(v.situacao).toBe('nao-configurado');
        expect(v.app).toBeNull();
        expect(v.detalhe).toMatch(/consultor-fiscal-inteligente/);
    });

    // ⚠️ Token OK prova a CREDENCIAL — não prova que a caixa existe nem que a
    // mensagem chegou. Prometer isso seria o farol desonesto de sempre.
    it('sucesso não promete mais do que provou', () => {
        const v = vereditoDaCredencialDeEmail({ ok: true, configurado: true });
        expect(v.situacao).toBe('ok');
        expect(v.detalhe).toMatch(/não prova que a caixa/i);
    });

    // ⚠️ App não mapeado devolve o id CRU e nenhum lugar inventado — mandar
    // gravar num lugar que talvez não seja o certo é o que este módulo existe
    // para não fazer.
    it('app desconhecido não ganha lugar inventado', () => {
        const v = vereditoDaCredencialDeEmail({
            ok: false, configurado: true,
            erro: "AADSTS7000215: ... for a secret added to app '00000000-1111-2222-3333-444444444444'.",
        });
        expect(v.app.id).toBe('00000000-1111-2222-3333-444444444444');
        expect(v.app.nome).toBeNull();
        expect(v.onde).toBeNull();
    });
});

// 🔒 A sonda NÃO envia mensagem a ninguém — é diagnóstico, e a rota tem de
// deixar isso provado no código.
describe('a rota do teste não envia e-mail', () => {
    const rota = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'sefaz-backend/diagnostico-config-routes.js'), 'utf8');

    it('pede o TOKEN e nada mais', () => {
        expect(rota).toMatch(/getGraphToken\(\)/);
        expect(rota).not.toMatch(/enviarEmail\(/);
    });

    // ⚠️ O token fica em cache ~1h: sondar sem invalidar responderia "está
    // tudo bem" sobre a credencial ANTIGA — a pergunta que ninguém quer errar
    // logo depois de trocar o segredo.
    it('invalida o cache antes de perguntar', () => {
        expect(rota).toMatch(/invalidarTokenGraph\(\)/);
    });
});
