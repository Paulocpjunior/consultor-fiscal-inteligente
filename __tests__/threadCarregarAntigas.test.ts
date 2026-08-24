// ============================================================================
// ⬆️ O TETO DE 500 CORTAVA A CONVERSA CALADO
// ----------------------------------------------------------------------------
// Em 24/08 a thread passou a vir ORDENADA (antes o Firestore devolvia na ordem
// do ID do documento — o wamid, que não é cronológico — e a mensagem nova
// podia cair fora da fatia). Isso resolveu QUAIS 500 vêm; não resolveu que a
// conversa antiga TERMINA numa parede sem aviso: a pessoa rola até o topo e
// conclui que o histórico não existe.
//
// DECISÕES QUE MANDAM AQUI:
//  · o cursor é por VALOR (`antesDe` = timestamp), nunca por número de página
//    — mensagem que chega no meio do caminho não desloca a janela nem repete
//    linha, que é o defeito clássico de paginar por offset;
//  · `temMais` sai de a PÁGINA ter vindo CHEIA, e a resposta NÃO afirma
//    quantas faltam: contar exigiria varrer a conversa inteira a cada
//    abertura, e número que o app não mediu é o que faz alguém confiar no que
//    ninguém conferiu;
//  · SEM ÍNDICE não há paginação possível (a fatia volta sem ordem, e pedir
//    "mais" devolveria as mesmas linhas) — então `temMais` é FALSO e a tela
//    DIZ o porquê. Botão que não anda é pior que botão nenhum;
//  · o histórico puxado à mão vive em estado PRÓPRIO: se entrasse na mesma
//    lista da fatia recente, a renovação de 30s o apagaria — e a pessoa
//    clicaria de novo, e de novo (a família do "Já importado" sem estado).
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('a rota pagina por VALOR e diz se há mais', () => {
    const rotas = ler('sefaz-backend/whatsapp-routes.js');
    const trecho = rotas.slice(
        rotas.indexOf("router.get('/conversas/:numero/mensagens'"),
        rotas.indexOf("// ─── INICIAR CONVERSA"),
    );

    it('o cursor é o timestamp, não um offset/página', () => {
        expect(trecho).toMatch(/req\.query\.antesDe/);
        expect(trecho).toMatch(/colecao\.where\('timestamp', '<', antesDe\)/);
        expect(trecho).not.toMatch(/\.offset\(/);
    });

    it('`temMais` vem da página CHEIA — e não promete uma contagem', () => {
        expect(trecho).toMatch(/temMais: ordenou && snap\.size >= PAGINA/);
        // Afirmar "faltam N" exigiria contar a conversa toda a cada abertura.
        expect(trecho).not.toMatch(/faltam|totalMensagens|quantasFaltam/);
    });

    it('sem índice NÃO pagina, e isso vai dito na resposta (semOrdem)', () => {
        expect(trecho).toMatch(/ordenou = false/);
        expect(trecho).toMatch(/semOrdem: !ordenou/);
    });

    it('a fatia continua saindo em ordem cronológica para a tela', () => {
        expect(trecho).toMatch(/localeCompare\(String\(b\.timestamp \|\| ''\)\)/);
    });
});

describe('a tela oferece o histórico sem perder o que já carregou', () => {
    const tela = ler('components/SpConnect/index.tsx');

    it('o histórico puxado à mão fica em estado PRÓPRIO (a renovação não o apaga)', () => {
        expect(tela).toMatch(/const \[antigas, setAntigas\] = useState<MensagemInbox\[\]>\(\[\]\)/);
        // A renovação de 30s recarrega só a fatia recente — o `temMais` dela
        // não pode desligar o botão de quem já puxou histórico.
        expect(tela).toMatch(/if \(!antigasRef\.current\.length\) setTemMaisAntigas/);
    });

    it('o cursor sai da mensagem mais antiga que JÁ está na tela', () => {
        expect(tela).toMatch(/antigasRef\.current\[0\] \|\| mensagensRef\.current\[0\]/);
        expect(tela).toMatch(/listarMensagens\(numero, primeira\.timestamp\)/);
    });

    it('as duas fatias viram UMA thread, sem repetir id', () => {
        expect(tela).toMatch(/const thread = useMemo/);
        expect(tela).toMatch(/\[\.\.\.antigas, \.\.\.mensagens\]/);
    });

    it('carregar histórico NÃO joga a pessoa de volta pro rodapé', () => {
        // A rolagem para o fim segue presa à fatia RECENTE — se ela ouvisse a
        // thread inteira, clicar em "mais antigas" devolveria a pessoa ao
        // rodapé, que é o oposto do que ela pediu.
        expect(tela).toMatch(/scrollIntoView\(\{ block: 'end' \}\);\s*\n\s*\}, \[mensagens\.length\]\);/);
    });

    it('trocar de conversa limpa o histórico carregado (nunca vaza pra outra)', () => {
        const abrir = tela.slice(tela.indexOf('const abrir = async (c: ConversaResumo)'));
        expect(abrir.slice(0, 500)).toMatch(/setAntigas\(\[\]\)/);
        expect(abrir.slice(0, 500)).toMatch(/setTemMaisAntigas\(false\)/);
    });

    it('a foto do histórico aparece igual à da fatia recente', () => {
        // Se o auto-carregamento de imagem lesse só `mensagens`, "carregar
        // mais antigas" devolveria uma conversa de balões vazios.
        expect(tela).toMatch(/thread\s*\n\s*\.filter\(\(m\) => \(m\.tipo === 'image'/);
    });

    it('a busca da thread procura na thread INTEIRA, não só na fatia recente', () => {
        expect(tela).toMatch(/filtrarMensagensDaThread\(thread, buscaThread\)/);
        expect(tela).not.toMatch(/filtrarMensagensDaThread\(mensagens, buscaThread\)/);
    });

    it('e a busca avisa quando ainda há histórico fora da tela', () => {
        expect(tela).toMatch(/Há histórico mais antigo ainda não carregado/);
    });
});
