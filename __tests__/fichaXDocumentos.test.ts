// ============================================================================
// FAROL FICHA × DOCUMENTOS — imposto digitado precisa de documento por trás.
//
// Caso EXPERTE 06/2026 (Paulo, 15/08): IPI de R$ 7.352,90 digitado na ficha,
// imposto e relatório gerados, ZERO documento no banco — e nada acendia,
// porque ficha e escrituração são trilhos independentes. *"a empresa teve IPI,
// geramos o imposto e relatório: como não houve captura de XML?"*
// ============================================================================
import { conferirFichaContraDocumentos } from '../sefaz-backend/ficha-x-documentos.js';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('o caso EXPERTE: IPI digitado, banco vazio', () => {
    it('acende VERMELHO com a ação — as três portas de abastecer', () => {
        const r = conferirFichaContraDocumentos({ ipiFicha: 7352.90, documentos: 0 });
        expect(r.situacao).toBe('sem-documento');
        expect(r.cor).toBe('falha');
        expect(r.mensagem).toMatch(/SEM NENHUM documento/);
        // A ação lista os TRÊS caminhos — captura, importação, nota digitada.
        expect(r.acao).toMatch(/Status por Empresa/);
        expect(r.acao).toMatch(/Lançar nota sem XML/);
    });
});

describe('o que o farol NÃO afirma', () => {
    it('verde é EXISTÊNCIA, e a frase manda o VALOR para o E510', () => {
        // Sem isso, alguém lê o verde como "IPI conferido" — promessa que é
        // da conferência por CFOP+CST, não desta contagem.
        const r = conferirFichaContraDocumentos({ ipiFicha: 1000, documentos: 42 });
        expect(r.situacao).toBe('com-lastro');
        expect(r.mensagem).toMatch(/42 documento/);
        expect(r.mensagem).toMatch(/VALOR se confere no E510/);
    });
});

describe('falha de contagem NÃO é zero', () => {
    it('null apaga o farol em vez de acender "sem lastro"', () => {
        // Zero falso com o banco cheio é o alarme que aparece justamente
        // quando está tudo certo — e ensina a equipe a ignorar o farol.
        const r = conferirFichaContraDocumentos({ ipiFicha: 1000, documentos: null });
        expect(r.situacao).toBe('contagem-indisponivel');
        expect(r.cor).toBe('neutro');
        expect(r.mensagem).toMatch(/apagado, não verde/);
    });
});

describe('sem IPI na ficha, nada a cruzar', () => {
    it('neutro, sem alarme', () => {
        expect(conferirFichaContraDocumentos({ ipiFicha: 0, documentos: 0 }).situacao).toBe('sem-ipi');
        expect(conferirFichaContraDocumentos({ ipiFicha: null as any, documentos: 5 }).situacao).toBe('sem-ipi');
    });
});

describe('a rota e a tela carregam o farol', () => {
    it('a rota conta por agregação e trata falha como null — nunca zero', () => {
        const rota = readFileSync(join(__dirname, '..', 'sefaz-backend/ipi-varredura-routes.js'), 'utf8');
        expect(rota).toMatch(/\.count\(\)\.get\(\)/);
        expect(rota).toMatch(/conferirFichaContraDocumentos/);
        // O catch NÃO zera: docs permanece null e o veredito diz "apagado".
        expect(rota).not.toMatch(/docs = 0;\s*\}\s*catch/);
    });

    it('a linha da varredura MOSTRA o farol junto do número digitado', () => {
        const painel = readFileSync(join(__dirname, '..', 'components/DCTFWeb/IpiVarreduraPanel.tsx'), 'utf8');
        expect(painel).toMatch(/l\.lastro/);
        expect(painel).toMatch(/l\.lastro\.acao/);
    });
});
