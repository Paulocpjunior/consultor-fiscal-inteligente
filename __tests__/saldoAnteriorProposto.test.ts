/**
 * O saldo credor que a ficha NOVA traz do mês anterior.
 *
 * Caso real: Paulo, 15/09, PWR INDÚSTRIA METALÚRGICA · 07 → 08/2026 — *"teve
 * saldo credor anterior de IPI do mês 07 para o 08; na ficha do 07 ele está
 * informando certinho, mas quando eu crio a ficha do 08 ele não vem com o
 * valor"*. A ficha de 07 traz `IPI a transportar p/ 08/2026: R$ 4.747,84`.
 *
 * O que estes testes protegem, além do número: a proposta NUNCA vira zero por
 * ausência, o que a pessoa digitou VENCE a proposta, e o aviso nasce MUDO na
 * ficha em dia.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
    competenciaAnteriorDe,
    proporSaldoAnterior,
    valorPropostoDe,
    aplicarPropostaAoCampo,
    avisosDeSaldoAnteriorNaFicha,
} from '../services/saldoAnteriorProposto';

/** A ficha de 07/2026 da PWR, com os números do print do Paulo. */
const FICHA_07 = {
    mesReferencia: '2026-07',
    saldoCredorIpi: 2547.39,
    saldoCredorIpiTransportar: 4747.84,
    saldoCredorIcmsTransportar: 1131.57,
};

describe('competenciaAnteriorDe', () => {
    it('anda um mês para trás', () => {
        expect(competenciaAnteriorDe('2026-08')).toBe('2026-07');
    });

    it('vira o ano em janeiro — o erro que faria a proposta procurar ficha que não existe', () => {
        expect(competenciaAnteriorDe('2026-01')).toBe('2025-12');
    });

    it('aceita as formas em que mesReferencia é GRAVADO, porque quem normaliza é o dono', () => {
        expect(competenciaAnteriorDe('2026-08-31')).toBe('2026-07');
        expect(competenciaAnteriorDe('08/2026')).toBe('2026-07');
        expect(competenciaAnteriorDe('202608')).toBe('2026-07');
    });

    it('competência ilegível devolve null — nunca chuta um mês', () => {
        expect(competenciaAnteriorDe('banana')).toBeNull();
        expect(competenciaAnteriorDe('')).toBeNull();
        expect(competenciaAnteriorDe(null)).toBeNull();
        expect(competenciaAnteriorDe(undefined)).toBeNull();
    });
});

describe('proporSaldoAnterior — o caso PWR', () => {
    it('traz o IPI a TRANSPORTAR de 07/2026 para a ficha de 08/2026', () => {
        const p = proporSaldoAnterior([FICHA_07], '2026-08');
        expect(p.competenciaAnterior).toBe('2026-07');
        expect(valorPropostoDe(p, 'IPI')).toBe(4747.84);
        expect(p.temProposta).toBe(true);
    });

    it('o ICMS segue a MESMA régua — o print mostra os dois zerados', () => {
        const p = proporSaldoAnterior([FICHA_07], '2026-08');
        expect(valorPropostoDe(p, 'ICMS')).toBe(1131.57);
    });

    it('NÃO propõe o "mês anterior" da ficha anterior, e sim o "a TRANSPORTAR"', () => {
        // Na ficha de 07 o "mês anterior" é 2.547,39 (o que ENTROU em julho) e o
        // "a transportar" é 4.747,84 (o que SOBRA para agosto). Trocar os dois
        // transportaria o saldo defasado — a doença que o SPED já denunciou
        // em 11/09.
        const p = proporSaldoAnterior([FICHA_07], '2026-08');
        expect(valorPropostoDe(p, 'IPI')).not.toBe(2547.39);
    });

    it('carimba a ORIGEM na frase: veio de outra ficha, digitado, não calculado', () => {
        const p = proporSaldoAnterior([FICHA_07], '2026-08');
        const ipi = p.itens.find(i => i.tributo === 'IPI')!;
        expect(ipi.origem).toBe('ficha-anterior');
        expect(ipi.texto).toMatch(/07\/2026/);
        expect(ipi.texto).toMatch(/digitado lá, não calculado/);
    });

    it('lê a ficha anterior pelo DONO — mesReferencia tem TRÊS formas', () => {
        for (const forma of ['2026-07', '2026-07-31', '07/2026']) {
            const p = proporSaldoAnterior([{ ...FICHA_07, mesReferencia: forma }], '2026-08');
            expect(valorPropostoDe(p, 'IPI')).toBe(4747.84);
        }
    });
});

describe('ausência NUNCA vira zero proposto', () => {
    const semProposta = (fichas: any[], comp: unknown, origemEsperada: string) => {
        const p = proporSaldoAnterior(fichas, comp);
        for (const item of p.itens) {
            expect(item.valor).toBeNull();
            expect(item.origem).toBe(origemEsperada);
            // A frase tem de dizer que branco ≠ "não há saldo", senão o silêncio
            // é lido como conferência.
            expect(item.texto.length).toBeGreaterThan(20);
        }
        expect(p.temProposta).toBe(false);
    };

    it('sem ficha na competência anterior', () => {
        semProposta([], '2026-08', 'sem-ficha-anterior');
    });

    it('ficha anterior existe e NÃO informou o a transportar', () => {
        semProposta([{ mesReferencia: '2026-07', saldoCredorIpi: 2547.39 }], '2026-08', 'anterior-nao-informou');
    });

    it('competência da ficha nova ilegível', () => {
        semProposta([FICHA_07], 'banana', 'competencia-ilegivel');
    });

    it('as três causas têm frases DIFERENTES — as ações não são a mesma', () => {
        const t = (fichas: any[], comp: unknown) =>
            proporSaldoAnterior(fichas, comp).itens.find(i => i.tributo === 'IPI')!.texto;
        const semFicha = t([], '2026-08');
        const naoInformou = t([{ mesReferencia: '2026-07' }], '2026-08');
        const ilegivel = t([FICHA_07], 'banana');
        expect(new Set([semFicha, naoInformou, ilegivel]).size).toBe(3);
    });

    it('a ficha anterior com transporte ZERO propõe 0 — zero DIGITADO é resposta', () => {
        // Diferente de "não informado": aqui alguém afirmou que o crédito acabou.
        const p = proporSaldoAnterior(
            [{ mesReferencia: '2026-07', saldoCredorIpiTransportar: 0 }],
            '2026-08',
        );
        expect(valorPropostoDe(p, 'IPI')).toBe(0);
        expect(p.itens.find(i => i.tributo === 'IPI')!.origem).toBe('ficha-anterior');
    });
});

describe('aplicarPropostaAoCampo — o que a pessoa digitou VENCE', () => {
    it('campo ainda com a proposta anterior (não tocado) recebe a nova', () => {
        expect(aplicarPropostaAoCampo(1131.57, 1131.57, 4747.84)).toBe(4747.84);
    });

    it('campo zerado sem proposta anterior recebe a proposta', () => {
        expect(aplicarPropostaAoCampo(0, null, 4747.84)).toBe(4747.84);
    });

    it('campo DIGITADO não é reescrito — mudar imposto pelas costas de quem apurou', () => {
        expect(aplicarPropostaAoCampo(9000, 1131.57, 4747.84)).toBe(9000);
    });

    it('proposta nova nula volta o campo a ZERO em vez de deixar o saldo da outra competência grudado', () => {
        expect(aplicarPropostaAoCampo(4747.84, 4747.84, null)).toBe(0);
    });

    it('campo digitado continua digitado mesmo quando a proposta nova é nula', () => {
        expect(aplicarPropostaAoCampo(9000, 4747.84, null)).toBe(9000);
    });

    it('compara em CENTAVOS — float não decide se alguém digitou', () => {
        expect(aplicarPropostaAoCampo(0.1 + 0.2, 0.3, 5)).toBe(5);
    });
});

describe('avisosDeSaldoAnteriorNaFicha', () => {
    const proposta = () => proporSaldoAnterior([FICHA_07], '2026-08');

    it('NASCE MUDO quando o campo já bate com o que a anterior mandou transportar', () => {
        const avisos = avisosDeSaldoAnteriorNaFicha(proposta(), {
            saldoCredorIcms: 1131.57, saldoCredorIpi: 4747.84,
        });
        expect(avisos).toEqual([]);
    });

    it('MUDO quando não há proposta nenhuma — alarme sem alvo ensina a ignorar alarme', () => {
        const p = proporSaldoAnterior([], '2026-08');
        expect(avisosDeSaldoAnteriorNaFicha(p, { saldoCredorIcms: 0, saldoCredorIpi: 0 })).toEqual([]);
    });

    it('acusa o campo ZERADO com transporte na anterior — o caso caro', () => {
        const avisos = avisosDeSaldoAnteriorNaFicha(proposta(), { saldoCredorIcms: 0, saldoCredorIpi: 0 });
        const ipi = avisos.find(a => a.tributo === 'IPI')!;
        expect(ipi.causa).toBe('zerado-com-transporte');
        expect(ipi.proposto).toBe(4747.84);
        expect(ipi.atual).toBe(0);
    });

    it('a frase do zerado diz as DUAS consequências: guia a maior E o SPED declarando assim mesmo', () => {
        const avisos = avisosDeSaldoAnteriorNaFicha(proposta(), { saldoCredorIcms: 0, saldoCredorIpi: 0 });
        const texto = avisos.map(a => a.texto).join(' ');
        expect(texto).toMatch(/GUIA sai sem o abatimento/);
        expect(texto).toMatch(/SPED/);
        expect(texto).toMatch(/arquivo e guia com números diferentes/);
    });

    it('DIVERGÊNCIA é outra causa — pode ser decisão de quem apura, então não manda aplicar', () => {
        const avisos = avisosDeSaldoAnteriorNaFicha(proposta(), {
            saldoCredorIcms: 1131.57, saldoCredorIpi: 3000,
        });
        expect(avisos).toHaveLength(1);
        expect(avisos[0].causa).toBe('diverge-do-transporte');
        expect(avisos[0].texto).not.toMatch(/GUIA sai sem o abatimento/);
    });

    it('transporte ZERO na anterior não vira aviso — não há crédito a cobrar', () => {
        const p = proporSaldoAnterior([{ mesReferencia: '2026-07', saldoCredorIpiTransportar: 0 }], '2026-08');
        expect(avisosDeSaldoAnteriorNaFicha(p, { saldoCredorIcms: 0, saldoCredorIpi: 0 })).toEqual([]);
    });

    it('campo ausente conta como zerado, nunca como "confere"', () => {
        const avisos = avisosDeSaldoAnteriorNaFicha(proposta(), {});
        expect(avisos.map(a => a.causa)).toEqual(['zerado-com-transporte', 'zerado-com-transporte']);
    });
});

/**
 * A LIGAÇÃO — régua criada e não ligada é a classe que esta casa mais paga
 * (o `saldoCredorIpiAnterior` que nenhum orquestrador passava, o E510 "pronto"
 * que ninguém gerava). Provada revertendo cada uma das três.
 */
describe('a ficha do Lucro usa a régua', () => {
    const dashboard = () => readFileSync(
        join(__dirname, '..', 'components', 'LucroPresumidoRealDashboard.tsx'), 'utf8',
    );
    const tela = () => readFileSync(
        join(__dirname, '..', 'components', 'LucroPresumidoReal', 'NewFichaView.tsx'), 'utf8',
    );

    it('o dashboard importa o DONO em vez de decidir na tela', () => {
        const src = dashboard();
        expect(src).toMatch(/from '\.\.\/services\/saldoAnteriorProposto'/);
        expect(src).toMatch(/proporSaldoAnterior\(/);
        expect(src).toMatch(/aplicarPropostaAoCampo\(/);
        expect(src).toMatch(/avisosDeSaldoAnteriorNaFicha\(/);
    });

    it('a proposta acompanha a COMPETÊNCIA escolhida, não a de abertura da tela', () => {
        // `fichaMes` na dependência é o que faz trocar de 09 para 08 mudar a
        // proposta; sem ele a ficha nasceria com o saldo do mês errado.
        const src = dashboard();
        const trecho = src.slice(src.indexOf('propostaSaldoAnterior = useMemo'));
        expect(trecho.slice(0, 400)).toMatch(/\[selectedEmpresa, fichaMes\]/);
    });

    it('a proposta SÓ entra em ficha nova — reabrir gravada não reescreve o que foi digitado', () => {
        const src = dashboard();
        expect(src).toMatch(/selectedFichaId !== null\) return;/);
    });

    it('🚨 o reset zera os campos "a TRANSPORTAR" — senão o saldo de julho gruda na ficha de agosto', () => {
        const src = dashboard();
        const reset = src.slice(src.indexOf('const resetForm'), src.indexOf('const handleAddDespesa'));
        expect(reset).toMatch(/setSaldoCredorIcmsTransportar\(null\)/);
        expect(reset).toMatch(/setSaldoCredorIpiTransportar\(null\)/);
    });

    it('a TELA não refaz a régua: ela só imprime o que o dono decidiu', () => {
        const src = tela();
        // Nada de calcular a proposta aqui — nem ler a ficha anterior.
        expect(src).not.toMatch(/acharFichaCompetencia/);
        expect(src).not.toMatch(/saldoCredorIpiTransportar\s*\|\|/);
        expect(src).toMatch(/p\.avisosSaldoAnterior/);
        expect(src).toMatch(/p\.onAplicarSaldoAnterior\(/);
    });

    it('a tela DIZ que PIS e COFINS ficam de fora — ausência de proposta explicada', () => {
        expect(tela()).toMatch(/PIS e COFINS não são propostos/);
    });
});
