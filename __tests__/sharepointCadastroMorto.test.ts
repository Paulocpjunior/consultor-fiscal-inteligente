// ============================================================================
// 🔒 O CADASTRO DO CAMINHO MORTO NÃO PODE VOLTAR — nem como campo, nem como
//    TRAVA que exige o campo.
//
// 02/09. A árvore real foi medida e a pasta da empresa passou a ser ACHADA
// pelo Cod.Cliente. O que sobrou vivo era pior que um campo esquecido:
//
//   · a rota `/config` **RECUSAVA ligar o auto-sync** sem `grupo` +
//     `empresaPasta` — ou seja, era IMPOSSÍVEL ligar a captura sem preencher
//     um campo que não faz mais nada. Não é o aviso que aponta o lugar errado
//     (achado 18, 21/08): é BLOQUEIO no lugar errado;
//   · a lista de empresas pintava a bolinha VERMELHA e afirmava *"nada é
//     sincronizado"* lendo esses dois campos — afirmação FALSA sobre o que o
//     trilho faz hoje;
//   · e a fila de trabalho ("N empresas SEM pasta configurada") mandava
//     preencher o campo morto, empresa por empresa.
//
// ⚠️ A pergunta mudou de STATUS para RESULTADO: não é *"tem os campos
// preenchidos?"*, é *"a pasta desta empresa RESOLVE?"* — respondida pelo MESMO
// dono que o auto-sync usa para gravar. Tela que perguntasse diferente do
// trilho diria "pronta" sobre empresa que o run pula.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');

// 🐛 Lê CÓDIGO, nunca a prosa que o explica: os comentários que documentam
// esta correção CITAM o campo morto, e a asserção sobre o arquivo inteiro
// reprovaria a própria correção (a mordida do ISS, 22/08).
const semComentario = (s: string) => s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
    .join('\n');

const backend = semComentario(readFileSync(join(RAIZ, 'sefaz-backend/sharepoint-auto-sync.js'), 'utf8'));
const tela = semComentario(readFileSync(join(RAIZ, 'components/xml/XmlSharePoint.tsx'), 'utf8'));

describe('🔒 a matrícula do auto-sync não cobra o campo morto', () => {
    it('a trava para ligar é o Cod.Cliente, não grupo/pasta', () => {
        expect(backend).toMatch(/codClienteDoCadastro\(doc\.data\(\)\)/);
        expect(backend).toMatch(/não tem Cod\.Cliente no cadastro/);
    });

    // ⚠️ Campo de caminho que ninguém lê é o convite para alguém preenchê-lo
    // de novo — e a gravação faria a próxima pessoa acreditar que ele serve.
    it('a gravação NÃO guarda grupo/empresaPasta', () => {
        const bloco = backend.slice(backend.indexOf('sharePointConfig: {'), backend.indexOf('sharePointConfig: {') + 400);
        expect(bloco).toMatch(/autoSyncEnabled/);
        expect(bloco).not.toMatch(/grupo/);
        expect(bloco).not.toMatch(/empresaPasta/);
    });

    // 🚨 A resolução da TELA é a MESMA do trilho que grava.
    it('o /status responde pela RESOLUÇÃO, com o mesmo dono do auto-sync', () => {
        expect(backend).toMatch(/pastaResolvida/);
        expect(backend).toMatch(/empresasSemPasta/);
    });

    // ⚠️ UMA listagem por requisição: leitura por empresa seria o HTTP 429 de
    // 27/08 com outra roupa.
    it('as pastas são listadas UMA vez, fora do laço das empresas', () => {
        const laco = backend.slice(backend.indexOf("for (const col of ['simples_empresas', 'lucro_empresas']) {\n            const snap = await db.collection(col).get();\n            for (const d of snap.docs) {"));
        expect(laco).not.toMatch(/await listarPastasDeEmpresas\(\)/);
    });

    // 🚨 Falha ao LISTAR não vira "ninguém resolve": pintaria a carteira
    // inteira de vermelho por causa de uma rede que piscou.
    it('listagem que falha devolve pastasErro, não uma carteira reprovada', () => {
        expect(backend).toMatch(/pastasErro = e\.message/);
        expect(backend).toMatch(/pastaResolvida: pastas \? achado : null/);
    });
});

describe('🖥️ a tela concorda com o trilho', () => {
    it('a bolinha sai do RESULTADO e tem TRÊS estados', () => {
        expect(tela).toMatch(/e\.pastaResolvida/);
        // âmbar = "não deu para conferir"; sem ele, ausência viraria falha.
        expect(tela).toMatch(/res === null \? 'bg-amber-500'/);
    });

    it('a tela não decide nada por grupo/empresaPasta', () => {
        expect(tela).not.toMatch(/e\.grupo|e\.empresaPasta|configGrupo|configPasta/);
    });

    // ⚠️ O motivo vem do BACKEND: uma frase escrita aqui divergiria da que o
    // auto-sync mostra no MESMO caso.
    it('a causa exibida vem do dono, não é reescrita na tela', () => {
        expect(tela).toMatch(/\{res\.motivo\}/);
        expect(tela).not.toMatch(/grupo\/pasta não preenchidos/);
    });

    // 🚨 Recusa engolida faz o clique não fazer nada — a família do "Já
    // importado" sem estado (14/08).
    it('a recusa do salvar é DITA na tela', () => {
        expect(tela).toMatch(/setConfigErro\(d\.error/);
    });
});

// ============================================================================
// 🚨 PLACEHOLDER COM CARA DE VALOR PREENCHIDO
//
// 20/08, campo do cérebro do CFOP: o `1556` cinza foi lido como valor, a
// pessoa clicou e nada aconteceu. Eu repeti o defeito em 02/09 no campo
// "Empresa (pasta)", com `0040_Clinica Mantoan` dentro dele — o campo nasce
// VAZIO, o botão fica apagado dizendo que ele falta, e ali dentro há um nome
// de pasta. **Para quem usa, "parece preenchido" e "está preenchido" são a
// mesma coisa.**
//
// ⚠️ E o placeholder do caminho personalizado ENSINAVA a árvore morta
// ("Empresas/Grupo X/…"): exemplo errado num campo é pior que exemplo nenhum,
// porque a pessoa digita o que está escrito e leva 404.
// ============================================================================
describe('🚨 o campo obrigatório não finge estar preenchido', () => {
    const bruto = readFileSync(join(RAIZ, 'components/xml/XmlSharePoint.tsx'), 'utf8');

    it('o campo da pasta da empresa não tem exemplo com cara de valor', () => {
        const linha = bruto.split('\n').find((l) => l.includes('value={empresaPasta}')) || '';
        expect(linha).toMatch(/placeholder="—"/);
    });

    // ⚠️ Vazio se DESTACA: sem isso ele é indistinguível de célula de leitura,
    // que foi exatamente o que aconteceu na aba do cérebro do CFOP.
    it('vazio fica destacado até ser preenchido', () => {
        expect(tela).toMatch(/empresaPasta\.trim\(\) \? '1px solid var\(--border-default\)' : '1px solid var\(--accent\)'/);
    });

    // 🚨 Nenhum placeholder ensina o nível de GRUPO, que não existe.
    it('nenhum placeholder ensina a árvore morta', () => {
        const placeholders = [...bruto.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]);
        expect(placeholders.filter((p) => /Grupo/i.test(p))).toEqual([]);
    });
});
