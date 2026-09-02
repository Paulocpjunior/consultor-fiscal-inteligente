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

    // ⚠️ ASSERÇÃO TROCADA PELA INTENÇÃO (02/09): ela prendia o TEXTO
    // `if (r?.ok && !simular) await onRebuscar?.()`, e a rodada passou a
    // ENCADEAR (o teto por rodada virava 3 cliques do colaborador — caso MV
    // LIDER). Teste que trava a FORMA impede a correção que a régua manda
    // fazer; o que ele protege é a INTENÇÃO, e ela continua inteira:
    //   · o simulado sai ANTES, por early return — prévia não rebusca nada;
    //   · a rodada real rebusca DEPOIS de a drenagem terminar com sucesso.
    it('🚨 reconferir(false) CHAMA onRebuscar após sucesso — nunca no simulado', () => {
        const inicio = src.indexOf('const reconferir = async (simular: boolean) => {');
        const corpo = src.slice(inicio, inicio + 1600);
        // O caminho da PRÉVIA termina em `return` antes de qualquer rebusca.
        const trechoSimulado = corpo.slice(corpo.indexOf('if (simular)'), corpo.indexOf('const resultados'));
        expect(trechoSimulado).toMatch(/return;/);
        expect(trechoSimulado).not.toMatch(/onRebuscar/);
        // E a rodada real rebusca só com sucesso.
        expect(corpo).toMatch(/if \(ultima\?\.ok\) await onRebuscar\?\.\(\);/);
    });

    it('a mensagem deixou de mandar o colaborador recarregar manualmente quando há rebusca automática', () => {
        expect(src).toContain('Recorte recarregado — os totais acima já refletem o que a SEFAZ confirmou.');
    });
});
