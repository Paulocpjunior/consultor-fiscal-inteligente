/**
 * 🚨 A MESMA NOTA DUAS VEZES, E A RESSALVA QUE MANDAVA AO LUGAR ERRADO.
 *
 * Os dois achados vieram do MESMO print (04/09, J.P. PISSATO LOTERIAS ·
 * Retenções — serviços tomados — 08/2026):
 *
 *   31/08/2026 · 114924 · PROTEGE ... · 3.901,37 · IR 39,02
 *   31/08/2026 · 114924 · PROTEGE ... · 3.901,37 · IR ?
 *   TOTAIS (2) ................. 7.802,74
 *
 * (1) O CT-e OS foi lançado à mão com o modelo certo e o documento ANTIGO da
 *     mesma nota continuou na base. O relatório somou 7.802,74 onde o papel diz
 *     3.901,37 — e a duplicata infla o Livro de Serviços tomados, a competência,
 *     o bloco A do EFD-Contribuições e a base do R-4020. **Nenhum validador
 *     acusa**: o único jeito de perceber era reparar que o total estava dobrado.
 *
 * (2) A ressalva dizia *"importadas antes de 01/08/2026 … reimporte o XML para
 *     completar"*. A data nunca foi medida, e **nesta empresa não existe XML**:
 *     o CT-e OS chega só em PDF, com certificado A3 e sem captura automática.
 *     Aviso que aponta um lugar que não resolve é o achado 18 (21/08).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    duplicatasNasLinhas, ressalvaDuplicatas, ressalvaSemRetencaoGravada,
} from '../services/relatoriosAgregacoes';

const linha = (over: any = {}) => ({
    data: '31/08/2026', numero: '114924',
    participante: 'PROTEGE PROTECAO E TRANSPORTE DE VALORES LTDA',
    doc: 'CTe', municipio: '', base: 3901.37,
    iss: 0, issRetido: 0, pis: 0, cofins: 0, ir: 39.02, inss: 0, csll: 0,
    liquido: 3901.37, retencoesFederaisGravadas: true,
    ...over,
}) as any;

describe('🚨 nota repetida na competência', () => {
    it('acusa a duplicata do print — mesmo prestador, número e valor', () => {
        const dups = duplicatasNasLinhas([linha(), linha({ ir: 0, retencoesFederaisGravadas: false })]);
        expect(dups).toHaveLength(1);
        expect(dups[0].numero).toBe('114924');
        expect(dups[0].vezes).toBe(2);
        expect(dups[0].base).toBe(3901.37);
    });

    it('a frase NOMEIA a nota e diz a ação — contador sozinho não é acionável', () => {
        const f = ressalvaDuplicatas(duplicatasNasLinhas([linha(), linha()]))!;
        expect(f).toMatch(/114924/);
        expect(f).toMatch(/PROTEGE/);
        expect(f).toMatch(/Retirar do cliente/i);
    });

    it('diz que o EFD e o Livro também estão dobrados — não é só este relatório', () => {
        // Quem lê "o relatório está dobrado" conserta o relatório. O custo real
        // está no livro e no arquivo.
        const f = ressalvaDuplicatas(duplicatasNasLinhas([linha(), linha()]))!;
        expect(f).toMatch(/Livro de Serviços/i);
        expect(f).toMatch(/bloco A/i);
    });

    it('o app NÃO escolhe qual remover — a frase diz isso', () => {
        const f = ressalvaDuplicatas(duplicatasNasLinhas([linha(), linha()]))!;
        expect(f).toMatch(/não escolhe/i);
    });

    // ⚠️ ALARME SOBRE DOCUMENTO CORRETO É O JEITO DE DESLIGAR A CONFERÊNCIA.
    it('nota única não acusa', () => {
        expect(duplicatasNasLinhas([linha()])).toHaveLength(0);
        expect(ressalvaDuplicatas([])).toBeNull();
    });

    it('mesmo número com VALOR diferente é reemissão, não cópia', () => {
        expect(duplicatasNasLinhas([linha(), linha({ base: 1000 })])).toHaveLength(0);
    });

    it('mesmo número de prestadores DIFERENTES não é duplicata', () => {
        expect(duplicatasNasLinhas([linha(), linha({ participante: 'OUTRA TRANSPORTADORA LTDA' })]))
            .toHaveLength(0);
    });

    it('nota SEM número fica de fora — várias legítimas chegam assim', () => {
        expect(duplicatasNasLinhas([linha({ numero: '' }), linha({ numero: '' })])).toHaveLength(0);
    });
});

describe('🚨 a ressalva do "?" não afirma data nem manda ao XML que não existe', () => {
    const f = ressalvaSemRetencaoGravada(1);

    it('NÃO afirma quando a nota foi importada — isso nunca foi medido', () => {
        expect(f).not.toMatch(/antes de 01\/08/i);
        expect(f).not.toMatch(/importada/i);
    });

    it('a 1ª ação é informar na nota — a única que funciona sem XML', () => {
        expect(f).toMatch(/Informar retenção/i);
        const iInformar = f.search(/Informar retenção/i);
        const iXml = f.search(/XML/);
        expect(iInformar).toBeGreaterThan(-1);
        expect(iXml).toBeGreaterThan(iInformar);
    });

    it('o XML vira ALTERNATIVA condicional, não ordem', () => {
        // "reimporte o XML" cru é impossível onde o cliente só manda PDF.
        expect(f).toMatch(/havendo XML/i);
    });

    it('mantém o que ela sempre acertou: ausente ≠ zero retido', () => {
        expect(f).toMatch(/ausência NÃO significa zero retido/i);
    });
});

/**
 * 🔌 A LIGAÇÃO. Régua que a tela não lê é a "flag que ninguém lê" — o defeito
 * que este projeto já pagou no `coberturaIncompleta`, no E510 "pronto" e no
 * `naoConferidos` que eu mesmo pus num header que a tela não consome.
 */
describe('🔌 a tela usa as duas', () => {
    const tela = readFileSync(join(__dirname, '..', 'components/Relatorios/index.tsx'), 'utf8')
        .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    it('a ressalva do "?" sai do núcleo, não escrita na tela', () => {
        expect(tela).toMatch(/ressalvaSemRetencaoGravada\(/);
        // A frase antiga estava escrita DUAS vezes aqui dentro.
        expect(tela).not.toMatch(/importadas antes de 01\/08/);
    });

    it('a denúncia da duplicata aparece nas observações', () => {
        expect(tela).toMatch(/ressalvaDuplicatas\(duplicatasNasLinhas\(/);
    });
});
