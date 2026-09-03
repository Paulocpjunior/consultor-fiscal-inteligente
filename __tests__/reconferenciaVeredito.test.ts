// ============================================================================
// 🚨 A TELA SOMAVA AS DUAS PROVAS NUM NÚMERO SÓ
//
// 03/09, Paulo na MV LIDER 0639 · 08/2026: *"ainda sobre NFS canceladas veja o
// erro que não estão sendo relacionadas"*. A linha mais alta da caixa dizia
// **"20 consultada(s) · 0 cancelada(s) · 20 não cancelada(s)"**, e dois
// parágrafos abaixo o aviso do backend dizia **"20 nota(s) a SEFAZ recusou por
// PERMISSÃO (cStat 640)"**. As mesmas 20.
//
// O núcleo separa `nao-cancelada` de `nao-cancelada-por-recusa` desde 20/08 —
// *"lá a prova é POSITIVA, aqui é NEGATIVA, e fundir as duas apagaria a
// diferença justo onde importa"* — e era a TELA que somava. Nesta empresa, que
// não tem A1 próprio, a rodada inteira volta por recusa: o veredito lia
// "conferi 20 e estão boas" sobre 20 notas cujo documento a SEFAZ não entregou.
// ============================================================================
import { fraseDoVeredito, numerosPorRecusa } from '../services/reconferenciaEncadeada';

/** O resumo REAL do print: 20 consultadas, TODAS por recusa. */
const RESUMO_MV_LIDER = {
    consultadas: 20, canceladas: 0, naoCanceladas: 0, naoCanceladasPorRecusa: 20,
    cancelamentoNaoConfirmado: 0, indeterminadas: 0, valorRemovido: 0,
};
const SELECAO_MV_LIDER = { total: 126, cortadas: 106, nuncaConferidas: 66, naoMod55: 1, jaCanceladas: 0 };

describe('fraseDoVeredito — as duas provas não se somam', () => {
    it('separa a prova pelo XML da prova por RECUSA', () => {
        const f = fraseDoVeredito(RESUMO_MV_LIDER, SELECAO_MV_LIDER);
        expect(f).toMatch(/0 não cancelada\(s\) pelo XML/);
        expect(f).toMatch(/20 não cancelada\(s\) por recusa \(640\)/);
        // 🚨 E o número fundido não aparece mais em lugar nenhum da frase.
        expect(f).not.toMatch(/·\s*20 não cancelada\(s\)\s*·/);
    });

    it('mantém o que a linha sempre disse — consultadas, canceladas, indeterminadas e o fora do mod 55', () => {
        const f = fraseDoVeredito(RESUMO_MV_LIDER, SELECAO_MV_LIDER);
        expect(f).toMatch(/20 consultada\(s\)/);
        expect(f).toMatch(/0 cancelada\(s\)/);
        expect(f).toMatch(/0 indeterminada\(s\)/);
        expect(f).toMatch(/1 fora \(não é NF-e mod 55\)/);
    });

    // ⚠️ RECUSA CONTINUA SENDO "NÃO CANCELADA" — a correção NÃO é chamar o 640
    // de "sem resposta". Recusa é RESPOSTA (régua de 20/08, provada na própria
    // MV LIDER: nota cancelada volta 653 mesmo a quem não é parte). O que muda
    // é a tela parar de fundir as duas provas.
    it('não rebaixa o 640 para "sem resposta" — recusa é resposta', () => {
        const f = fraseDoVeredito(RESUMO_MV_LIDER, SELECAO_MV_LIDER);
        expect(f).not.toMatch(/sem resposta/i);
        expect(f).toMatch(/não cancelada\(s\) por recusa/);
    });

    it('o cancelamento NÃO confirmado aparece quando existe, e some quando não', () => {
        expect(fraseDoVeredito({ ...RESUMO_MV_LIDER, cancelamentoNaoConfirmado: 2 }, SELECAO_MV_LIDER))
            .toMatch(/2 com cancelamento NÃO confirmado/);
        expect(fraseDoVeredito(RESUMO_MV_LIDER, SELECAO_MV_LIDER))
            .not.toMatch(/cancelamento NÃO confirmado/);
    });

    it('resumo vazio não explode nem inventa número', () => {
        expect(fraseDoVeredito(undefined, undefined)).toMatch(/0 consultada\(s\)/);
    });
});

describe('numerosPorRecusa — as de prova NEGATIVA saem NOMEADAS', () => {
    const res = (n: number, situacao: string) => ({ id: `d${n}`, numero: String(n), situacao });

    it('nomeia só as recusadas — a que foi conferida pelo XML não entra', () => {
        const r = numerosPorRecusa([
            res(3910, 'nao-cancelada-por-recusa'),
            res(3911, 'nao-cancelada'),
            res(3912, 'nao-cancelada-por-recusa'),
            res(3913, 'cancelada'),
        ]);
        expect(r.numeros).toEqual(['3910', '3912']);
        expect(r.restantes).toBe(0);
    });

    // ⚠️ Lista cortada SEMPRE diz o quanto ficou de fora (a régua de 30/07):
    // sem o "+N" ela se lê como a lista inteira.
    it('corta com o restante à vista', () => {
        const muitas = Array.from({ length: 45 }, (_, i) => res(1000 + i, 'nao-cancelada-por-recusa'));
        const r = numerosPorRecusa(muitas);
        expect(r.numeros).toHaveLength(30);
        expect(r.restantes).toBe(15);
    });

    it('sem recusa nenhuma não há o que nomear', () => {
        expect(numerosPorRecusa([res(1, 'nao-cancelada')]).numeros).toHaveLength(0);
        expect(numerosPorRecusa([]).numeros).toHaveLength(0);
    });
});

// ============================================================================
// 🔗 A LIGAÇÃO — régua certa com a tela não chamando devolve o defeito calado.
// ============================================================================
describe('a tela usa o dono, e não soma os dois números à mão', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const tela = readFileSync(join(__dirname, '../components/Relatorios/index.tsx'), 'utf8');

    it('o veredito e a lista das recusadas saem do módulo', () => {
        expect(tela).toMatch(/fraseDoVeredito\(reconf\.resumo, reconf\.selecao\)/);
        expect(tela).toMatch(/numerosPorRecusa\(reconf\.resultados/);
    });

    it('a soma das duas provas não volta', () => {
        expect(tela).not.toMatch(/naoCanceladas \|\| 0\) \+ \(reconf\.resumo\?\.naoCanceladasPorRecusa/);
    });

    // 🚨 E a ressalva do buraco DIZ que a cancelada que nunca chegou cai ali e
    // que o botão não a alcança — sem chave não há o que perguntar, e o `cNF`
    // não se deriva de série+número.
    it('a ressalva da numeração explica a cancelada que virou faltante', () => {
        const bloco = tela.slice(tela.indexOf('const RESSALVAS_NUMERACAO'), tela.indexOf('const AbaCanceladas'));
        expect(bloco).toMatch(/CANCELADA que nunca chegou/);
        expect(bloco).toMatch(/NÃO a alcança/);
        expect(bloco).toMatch(/chave/);
    });
});
