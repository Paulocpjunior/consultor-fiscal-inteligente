/**
 * A rota /reconferir-cancelamento ganhou um SEGUNDO caminho quando a empresa
 * não tem A1 próprio/da raiz (caso MV LIDER 639, cert A3) — em vez de recusar
 * direto, cai na Consulta Situação com o certificado do ESCRITÓRIO, e só
 * recusa se NENHUM dos dois caminhos existir.
 *
 * O corpo da rota mistura Express + Firestore real (`fa().firestore()`), o
 * que torna mock completo caro pra pouco ganho — a régua da casa aqui é
 * varredura de FONTE, como em `reconferirRebuscaAutomatica.test.ts`.
 */
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(
    path.resolve(__dirname, '../sefaz-backend/conferencia-chaves-routes.js'), 'utf8',
);

describe('reconferir-cancelamento — fallback pra Consulta Situação sem A1 próprio', () => {
    it('importa consultaSituacaoNFe/ufTemConsultaSituacao e lerRespostaConsultaSituacao', () => {
        expect(src).toMatch(/import \{ consultaNFePorChave, consultaSituacaoNFe, ufTemConsultaSituacao \} from '\.\/sefaz-client\.js';/);
        expect(src).toContain('lerRespostaConsultaSituacao');
    });

    it('só recusa de vez quando NÃO tem cert E a UF não tem Consulta Situação', () => {
        const inicio = src.indexOf('const usaConsultaSituacao');
        const trecho = src.slice(inicio, inicio + 400);
        expect(trecho).toMatch(/usaConsultaSituacao = !cert/);
        expect(trecho).toMatch(/!ufTemConsultaSituacao\(uf\)/);
    });

    it('o laço chama consultaSituacaoNFe (não consultaNFePorChave) quando usaConsultaSituacao', () => {
        const inicioLoop = src.indexOf('for (const alvo of selecao.aConsultar)');
        const corpo = src.slice(inicioLoop, inicioLoop + 1200);
        expect(corpo).toMatch(/if \(usaConsultaSituacao\) \{[\s\S]*?consultaSituacaoNFe\(/);
        expect(corpo).toMatch(/lerRespostaConsultaSituacao\(r\)/);
    });

    it('a gravação do cancelamento carimba a ORIGEM diferente quando veio da Consulta Situação', () => {
        expect(src).toContain("usaConsultaSituacao ? 'reconferencia-sefaz-consulta-situacao' : 'reconferencia-sefaz'");
    });

    it('o resumo recebe o modo — pra avisar o colaborador qual caminho foi usado', () => {
        expect(src).toMatch(/modo: usaConsultaSituacao \? 'consulta-situacao' : 'distdfe'/);
    });
});
