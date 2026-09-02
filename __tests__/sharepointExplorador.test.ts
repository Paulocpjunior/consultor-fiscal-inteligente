// ============================================================================
// 🔎 "A ÁRVORE ESTÁ EM QUAL SITE?" — quem responde é o app, não uma pessoa
//
// 02/09. Corrigido o corte da mensagem e tirado o site cravado, o erro passou
// a dizer ONDE procurou:
//
//   Failed to list folder (404) em …/sites/ClientesSP2 →
//   "Empresas//DEPARTAMENTO FISCAL/2026/09-2026//XML SAÍDA" — itemNotFound
//
// …e sobrou uma pergunta FACTUAL: a pasta existe nesse site, ou no
// /sites/GRUPOFISCAL, que é o do link que a equipe usa?
//
// 📌 Devolver essa pergunta para o dono navegar no SharePoint é exatamente o
// que o dia inteiro ensinou a não fazer. O token já funciona — então o app
// LISTA. É a mesma virada do `forma-do-segredo.js`: parar de perguntar e medir.
//
// ⚠️ A trava é sobre a LIGAÇÃO: rota no proxy, porta no serviço e botão na
// tela. Rota sem botão é código morto com cara de entrega (13/08).
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const semComentario = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PROXY = semComentario(raiz('proxy-backend', 'sharepoint-sync.js'));
const ROTAS = semComentario(raiz('proxy-backend', 'server.js'));
const SERVICO = semComentario(raiz('services', 'sharePointXmlService.ts'));
const TELA = semComentario(raiz('components', 'xml', 'XmlSharePoint.tsx'));

describe('🔎 a medição existe ponta a ponta', () => {
    it('o proxy lista pastas e sites', () => {
        expect(PROXY).toMatch(/export async function listarPastas/);
        expect(PROXY).toMatch(/export async function listarSites/);
    });

    it('as rotas existem e chamam o dono', () => {
        expect(ROTAS).toMatch(/\/api\/sharepoint\/explorar/);
        expect(ROTAS).toMatch(/\/api\/sharepoint\/sites/);
        expect(ROTAS).toMatch(/listarPastas\(token/);
        expect(ROTAS).toMatch(/listarSites\(token/);
    });

    it('o serviço tem a porta', () => {
        expect(SERVICO).toMatch(/export async function explorarPasta/);
        expect(SERVICO).toMatch(/export async function listarSitesSharePoint/);
    });

    // 🚨 Rota sem botão não é funcionalidade — é código morto com cara de
    // entrega. Foi assim que o rito do fechamento do Reinf subiu invisível.
    it('e a TELA chama as duas — senão é rota sem botão', () => {
        expect(TELA).toMatch(/explorarPasta/);
        expect(TELA).toMatch(/listarSitesSharePoint/);
        expect(TELA).toMatch(/O que existe nesta biblioteca/);
        expect(TELA).toMatch(/Quais sites o app enxerga/);
    });
});

describe('🚦 o que a medição diz — e o que ela se recusa a esconder', () => {
    // ⚠️ Pasta com 0 subpastas e 300 arquivos é o FIM da árvore. Sem a
    // contagem de arquivos ela se lê como pasta vazia, e a pessoa conclui que
    // está no lugar errado quando chegou no certo.
    it('a contagem de ARQUIVOS vai junto das pastas', () => {
        expect(PROXY).toMatch(/arquivos: itens\.filter\(i => i\.file\)\.length/);
        expect(TELA).toMatch(/nivel\.arquivos/);
    });

    // ⚠️ O erro do Graph diz "não existe" sem dizer onde — e é o SITE que
    // decide isso. Causa junto do número.
    it('o erro de listagem nomeia o site consultado', () => {
        expect(PROXY).toMatch(/Failed to list folder \(\$\{resp\.status\}\) em \$\{SHAREPOINT_HOST\}\$\{alvo\}/);
        expect(PROXY).toMatch(/Failed to resolve site \(\$\{siteResp\.status\}\) em/);
    });

    // ⚠️ Sem `Sites.Read.All` o Graph responde 403. Isso vai DITO — tratar
    // como "não há sites" faria concluir que o SharePoint está vazio.
    it('lista de sites vazia não é dita como "não existe site"', () => {
        expect(TELA).toMatch(/Sites\.Read\.All/);
    });

    // 🔒 É diagnóstico: lê nome de pasta e nada mais.
    it('a tela promete o limite do que ele faz', () => {
        expect(TELA).toMatch(/não baixa, não grava/);
    });
});

// ============================================================================
// 🚨 A LISTA CRUA ERA INÚTIL — eu despejei tudo o que o Graph devolve
//
// 02/09, no primeiro uso real: centenas de linhas, com `/contentstorage/…`
// (armazenamento PESSOAL, OneDrive) e as entradas "Designer", "Pages" e
// "My workspace" que a Microsoft cria sozinha. Achar o site do escritório a
// olho nessa lista é impossível — e ferramenta que não se consegue usar é
// ferramenta que não existe.
//
// ⚠️ Mas FILTRAR é RECORTE, e recorte se DIZ (a régua do farol honesto,
// 30/07): esconder calado faria a pessoa concluir que o site dela não existe.
// ============================================================================
describe('🚦 a lista de sites é utilizável — e o recorte vai dito', () => {
    it('só sites de EQUIPE, com o pessoal contado à parte', () => {
        expect(TELA).toMatch(/caminho\.startsWith\('\/sites\/'\)/);
        expect(TELA).toMatch(/Mostrando \{sitesVisiveis\.length\} de \{sitesDeEquipe\.length\}/);
        expect(TELA).toMatch(/ficaram de fora/);
    });

    it('tem busca — em centenas de sites, achar a olho não é opção', () => {
        expect(TELA).toMatch(/setBuscaSite/);
        expect(TELA).toMatch(/Filtrar por nome ou caminho/);
    });

    // 🚨 O ganho de verdade: clicar no site ABRE a árvore DELE, sem mexer na
    // configuração do proxy. É assim que a pergunta "a árvore está em qual
    // site?" se responde sem trocar env e esperar deploy.
    it('cada site é clicável e explora o site DELE', () => {
        expect(TELA).toMatch(/explorar\('', s\.caminho\)/);
        expect(TELA).toMatch(/explorarPasta\(caminho, alvo\)/);
    });

    // ⚠️ E o site que o proxy usa HOJE fica marcado — sem isso a pessoa não
    // sabe qual dos 500 é o que está valendo.
    it('marca o site que o proxy usa hoje', () => {
        expect(TELA).toMatch(/é o que o proxy usa hoje/);
        expect(TELA).toMatch(/health\?\.sitePath/);
    });
});

// ============================================================================
// 🐛 O EXPLORADOR FICAVA PRESO NO ÚLTIMO SITE ABERTO
//
// 02/09. Depois de clicar num site da lista, o botão "🔎 O que existe nesta
// biblioteca?" continuava mostrando AQUELE site — e não havia caminho de
// volta para o do proxy. Quem clicasse via o mesmo conteúdo achando que
// estava olhando outra biblioteca, e concluiria o contrário do que é.
// ============================================================================
describe('🐛 "esta biblioteca" é a do PROXY, não a última aberta', () => {
    it('o botão volta ao site padrão explicitamente', () => {
        expect(TELA).toMatch(/explorar\('', ''\)/);
    });

    // ⚠️ E o cabeçalho do resultado nomeia o site — sem isso não dá para saber
    // qual dos dois está na tela.
    it('o resultado diz qual site está sendo mostrado', () => {
        expect(TELA).toMatch(/\{nivel\.site\}/);
    });
});
