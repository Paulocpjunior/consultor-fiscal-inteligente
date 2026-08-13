// ============================================================================
// MATA-BURRO: SENTINELA DE BACKFILL NÃO PODE SER UM CAMPO DE DADO.
//
// 13/08, print do Paulo na aba 🌾: o botão "♻️ Reler participante e município
// dos XMLs" examinou 692 documentos e respondeu
//
//     "0 nota(s) recuperadas do XML · 664 já tinham · 28 sem arquivo guardado"
//
// enquanto o MESMO painel, logo abaixo, seguia acusando **427 notas sem o
// fornecedor** e **14 sem código IBGE do município**. Duas leituras do mesmo
// dado discordando — a armadilha que mais mordeu este projeto.
//
// ═══ AS DUAS CAUSAS ═════════════════════════════════════════════════════════
//
// 1. O SENTINELA ERA A UF. O backfill pulava o documento quando `ufEmit` já
//    existia — e a UF é gravada pelo importer em TODA nota. Ou seja: ele pulava
//    justamente as notas que precisavam dele, e ainda chamava isso de "já
//    tinham". Sentinela tem que responder "já passei por aqui?", não "tem algum
//    campo preenchido?" — por isso virou um CARIMBO de versão.
//
// 2. ELE NÃO GRAVAVA O DOCUMENTO DO PARTICIPANTE. O extrator devolve CNPJ/CPF
//    de emitente e destinatário desde sempre, mas o patch só escrevia nome,
//    município e IE. "Nota sem o fornecedor" é nota sem `cnpjEmit` — nenhuma
//    releitura ia resolver, por mais vezes que a pessoa clicasse.
//
// A trava é sobre a FORMA do backfill, que é o que se repete: por isso ela lê
// o código em vez de simular o Firestore.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const importer = ler('sefaz-backend/xml-importer.js');
const rota = ler('sefaz-backend/dipam-routes.js');
const painel = ler('components/xml/DipamProdutorRuralPanel.tsx');

/** O corpo da função de backfill — a régua vale sobre ele, não sobre o arquivo. */
const backfill = importer.slice(importer.indexOf('export async function preencherEnderecoParticipantes'));

describe('MATA-BURRO: o sentinela do backfill é um carimbo, não um campo de dado', () => {
    it('a decisão de pular é "já relido nesta versão"', () => {
        expect(backfill).toMatch(/participantesRelidos \|\| 0\) >= VERSAO_RELEITURA_PARTICIPANTES/);
        expect(importer).toMatch(/export const VERSAO_RELEITURA_PARTICIPANTES = \d+/);
    });

    it('a UF NÃO decide mais quem é relido', () => {
        // `const sentinela = direcao === 'entrada' ? d.ufEmit : d.ufDest` era a
        // linha que produzia "664 já tinham" com 427 pendências na tela.
        expect(backfill).not.toMatch(/const sentinela\s*=/);
    });

    it('o carimbo é gravado — senão o documento volta à fila para sempre', () => {
        expect(backfill).toMatch(/patch\.participantesRelidos = VERSAO_RELEITURA_PARTICIPANTES/);
    });
});

describe('MATA-BURRO: quem promete recuperar o fornecedor grava o fornecedor', () => {
    it('o CNPJ/CPF dos dois lados entra no patch', () => {
        expect(backfill).toMatch(/por\('cnpjEmit', p\.emitente\.cnpj\)/);
        expect(backfill).toMatch(/por\('cnpjDest', p\.destinatario\.cnpj\)/);
    });

    it('e o nome e o município continuam entrando, nos dois lados', () => {
        for (const campo of ['xNomeEmit', 'codMunEmit', 'xNomeDest', 'codMunDest']) {
            expect(backfill).toMatch(new RegExp(`por\\('${campo}'`));
        }
    });

    it('BACKFILL NÃO APAGA: só preenche o que está vazio', () => {
        // Sobrescrever com o XML seria "corrigir" divergência por escrita
        // silenciosa — e divergência entre fonte e cadastro é ALERTA (06/08).
        expect(backfill).toMatch(/atual === undefined \|\| atual === null \|\| atual === ''/);
    });
});

describe('a varredura cobre as DUAS direções', () => {
    it('entrada e saída — a nota própria de entrada pode estar gravada como saída', () => {
        // tpNF=0 (RICMS/SP art. 136): o backfill de direção conserta aos
        // poucos e a aba 🌾 lê pela direção EFETIVA. Varrer só 'entrada'
        // deixaria essas de fora — o mesmo defeito de varrer só 'saida'.
        expect(rota).toMatch(/direcao: 'entrada'/);
        expect(rota).toMatch(/direcao: 'saida'/);
    });
});

describe('farol honesto: o resultado responde POR CAUSA', () => {
    it('"relido e o XML não tem o dado" é resposta DIFERENTE de "já tinha"', () => {
        // A primeira manda para o cadastro do produtor; a segunda diz que o
        // clique não fazia nada. Misturar as duas foi o que escondeu o defeito.
        expect(backfill).toMatch(/semDadoNoXml/);
        expect(rota).toMatch(/o XML REALMENTE não traz o dado/);
        expect(rota).toMatch(/cadastro do produtor/);
    });

    it('a tela conta o que foi recuperado, separado por dado', () => {
        expect(painel).toMatch(/ganharam o fornecedor/);
        expect(painel).toMatch(/ganharam o município/);
        // "já tinham" virou "já relidas antes": o que o número realmente diz.
        // (o comentário do arquivo cita a frase antiga de propósito — a régua é
        // sobre o TEXTO QUE VAI À TELA, então ela olha a interpolação.)
        expect(painel).not.toMatch(/\$\{r\.jaTinham\} já tinham/);
        expect(painel).toMatch(/já relidas antes/);
    });

    it('documento sem XML guardado continua nomeado — ali releitura não resolve', () => {
        expect(rota).toMatch(/não têm o XML guardado/);
    });
});
