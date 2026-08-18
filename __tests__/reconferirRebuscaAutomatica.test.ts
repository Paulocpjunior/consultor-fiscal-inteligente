/**
 * reconferirRebuscaAutomatica — a reconferência tinha efeito na SEFAZ e NENHUM
 * efeito na tela.
 *
 * Paulo, MV LIDER 639 · 07/2026, 18/08, DUAS vezes: *"mesmo erro, continua sem
 * aparecer as canceladas e continua considerando no faturamento"*.
 *
 * A causa: `totalCanceladas`/`linhas` em `AbaCanceladas` vêm de `docs` — o
 * recorte que o "Buscar" carregou ANTES da reconferência. Gravar o
 * cancelamento no Firestore não republica os `props` que o componente já tem
 * na mão. A única frase que avisava disso era um texto pequeno demais para
 * quem está tentando entender por que "0 cancelada(s)" não mudou — é a mesma
 * família do "informar vencimento não atualizava a tarefa" (16/08): ação sem
 * efeito visível é beco, e a única saída que sobra é repetir o clique achando
 * que não funcionou.
 */
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(path.resolve(__dirname, '../components/Relatorios/index.tsx'), 'utf8');

describe('a reconferência real rebusca o recorte sozinha', () => {
    it('AbaCanceladas recebe onRebuscar do pai, ligado ao buscar() da empresa ativa', () => {
        expect(src).toMatch(/<AbaCanceladas docs=\{docsRecorte\}[^/]*onRebuscar=\{\(\) => buscar\(empresa\.id\)\}/s);
    });

    it('a assinatura do componente aceita a prop', () => {
        expect(src).toMatch(/const AbaCanceladas: React\.FC<AbaDocsProps & \{ onRebuscar\?: \(\) => void \}>/);
    });

    it('🚨 reconferir(false) CHAMA onRebuscar após sucesso — nunca no simulado', () => {
        const inicio = src.indexOf('const reconferir = async (simular: boolean) => {');
        const corpo = src.slice(inicio, inicio + 600);
        expect(corpo).toMatch(/if \(r\?\.ok && !simular\) await onRebuscar\?\.\(\);/);
    });

    it('a mensagem deixou de mandar o colaborador recarregar manualmente quando há rebusca automática', () => {
        expect(src).toContain('Recorte recarregado — os totais acima já refletem o que a SEFAZ confirmou.');
    });
});
