// ============================================================================
// 🔎 TETO MENOR + BUSCA QUE ALCANÇA O BANCO — as duas metades, no mesmo PR
// ----------------------------------------------------------------------------
// Paulo, 25/08: "eu até diminuiria este teto, para ganhar agilidade no
// carregamento da pág, ficando disponível no campo de busca quando o
// colaborador preferir".
//
// 🚨 A METADE QUE NÃO PODE FALTAR: baixar o teto de 2000 para 300 SEM a busca
// alcançar o banco tornaria a conversa antiga MAIS invisível — o teto novo
// esconderia 1.700 conversas em vez de nenhuma, e o campo continuaria achando
// "só o que está na lista". "Não achei" se lê como "não existe". Meia correção
// não deixa o defeito pela metade: troca um por outro.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const rotas = ler('sefaz-backend/whatsapp-routes.js');
const tela = ler('components/SpConnect/index.tsx');

describe('o teto menor vem acompanhado da porta', () => {
    it('o teto da lista caiu para 300', () => {
        expect(rotas).toMatch(/const TETO_LEITURA_CONVERSAS = 300;/);
    });

    it('e a rota que alcança o banco EXISTE (senão o teto só esconde mais)', () => {
        expect(rotas).toMatch(/router\.get\('\/conversas\/procurar', requireAuth/);
    });

    it('a tela chama a rota — rota sem botão é código morto com cara de entrega', () => {
        expect(tela).toMatch(/procurarConversas\(termo\)/);
        expect(tela).toMatch(/Procurar no banco inteiro/);
    });

    it('e o aviso do teto parou de dizer que a busca não alcança (virou mentira)', () => {
        expect(tela).not.toMatch(/A busca acha só o que está na lista/);
    });
});

describe('a busca no banco respeita o MESMO escopo da listagem', () => {
    const trecho = rotas.slice(rotas.indexOf("'/conversas/procurar'"), rotas.indexOf("// Mensagens de UMA conversa."));

    it('filtra por fila + condução + Instagram por usuário, como a lista', () => {
        // Busca que devolvesse conversa de fila alheia seria a porta dos
        // fundos do escopo por departamento.
        expect(trecho).toMatch(/conversaVisivel\(minhasFilas, cv\.fila\)/);
        expect(trecho).toMatch(/cv\.atribuidoA === req\.user\.email/);
        expect(trecho).toMatch(/podeAtenderInstagram\(cfgAtendimento, req\.user\?\.email\)/);
    });

    it('o resumo sai do MESMO dono da listagem (nunca uma segunda forma)', () => {
        expect(trecho).toMatch(/montarResumosDeConversas\(db, docs\)/);
        expect(rotas).toMatch(/async function montarResumosDeConversas\(db, docsConversas\)/);
    });
});

describe('o que a busca acha — e o que ela NÃO acha, dito', () => {
    const trecho = rotas.slice(rotas.indexOf("'/conversas/procurar'"), rotas.indexOf("// Mensagens de UMA conversa."));

    it('número casa por PREFIXO do id (o id da conversa é o número)', () => {
        expect(trecho).toMatch(/orderBy\(admin\.firestore\.FieldPath\.documentId\(\)\)/);
        expect(trecho).toMatch(/startAt\(digitos\)/);
        // Menos de 3 dígitos devolveria meia carteira — não é busca.
        expect(trecho).toMatch(/digitos\.length >= 3/);
    });

    it('nome casa por PEDAÇO, sem acento e sem caixa — prefixo do Firestore falharia', () => {
        // Prefixo é sensível à caixa: "bru" nunca acharia "Brunna". Busca que
        // falha em silêncio é pior que busca que não existe.
        expect(trecho).toMatch(/alvo\.includes\(chave\)/);
        expect(rotas).toMatch(/normalize\('NFD'\)/);
    });

    it('a varredura de contatos é PROJETADA (sem isso viriam os docs inteiros)', () => {
        expect(trecho).toMatch(/\.select\('nomePerfil', 'nomeExibicao'\)/);
    });

    it('o teto do resultado e o da varredura são DITOS, nunca cortados calados', () => {
        expect(trecho).toMatch(/truncado: visiveis\.length > TETO_RESULTADO_BUSCA/);
        expect(trecho).toMatch(/contatosTruncados/);
        expect(tela).toMatch(/mostrando \$\{achados\.conversas\.length\} de \$\{achados\.total\}/);
    });

    it('a tela DIZ que não procura no texto das mensagens', () => {
        // Fingir que procurou faria concluir que a frase não existe na
        // carteira — e ninguém procuraria de novo.
        expect(tela).toMatch(/não procura dentro do\s*\n?\s*texto das mensagens/);
    });
});

describe('o resultado não é engolido pela renovação nem pelo filtro de aba', () => {
    it('vive em estado PRÓPRIO (a lista se renova a cada 30s)', () => {
        expect(tela).toMatch(/const \[achados, setAchados\]/);
    });

    it('e a aba NÃO filtra o achado — buscar e a conversa sumir é o pior desfecho', () => {
        expect(tela).toMatch(/achados \? achados\.conversas : filtrarConversas\(conversas, \{ busca, aba \}\)/);
    });

    it('há caminho de volta para a lista', () => {
        expect(tela).toMatch(/voltar à lista/);
    });
});
