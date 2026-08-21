// ============================================================================
// 🚨 O ARQUIVO DECLARAVA CONTRIBUIÇÃO ZERO NUMA EMPRESA QUE FATURA TODO MÊS.
//
// Paulo, 20/08 (AFFITTARE 1139, CNPJ 17213641000127): *"o faturamento dela é
// aluguel, então não tem captura de notas, apenas a informação do valor em
// Locação de Bens na ficha financeira; para efeito de EFD CONTRIBUIÇÕES a
// informação vai no bloco F550"*.
//
// O CFI monta o EFD-Contribuições a partir dos DOCUMENTOS, e numa
// administradora de imóveis não existe documento de receita. O arquivo de
// 07/2026 saiu com **M200 e M600 ZERADOS** — mesma classe do M200 zerado da
// MANTOAN e do Bloco H inteiro zerado: campo de valor recebendo o default de
// quem não achou o dado.
//
// O GABARITO é o EFD-Contribuições ACEITO da própria empresa (05/2026):
//   |F001|0|
//   |F010|17213641000127|
//   |F550|21811,34|01|0|21811,34|0,65|141,76|01|0|21811,34|3|654,33|||||
//   |F990|4|
//   |0110|2||1|2|      ← escrituração CONSOLIDADA, não a detalhada (9)
// ============================================================================
// @ts-expect-error módulo JS puro sem tipos
import { receitaDeLocacao, montarF550, indRegCumDoArquivo, receitaDeDocumentosNoPeriodo, CST_F550_TRIBUTADA } from '../sefaz-backend/receita-sem-documento-f550.js';
import { buildBlocoF, buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error módulo JS puro sem tipos
import { buildBloco0Contrib } from '../sefaz-backend/sped-contrib-bloco0.js';

/** Os números reais do arquivo aceito de 05/2026. */
const RECEITA = 21811.34;
const CNPJ = '17213641000127';

const dados = (over: any = {}) => ({
    empresa: { cnpj: CNPJ, nome: 'AFFITTARE IMOVEIS ADMINISTRACAO LTDA', dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' } },
    competencia: '2026-07', competenciaInicio: '2026-07', competenciaFim: '2026-07',
    regimeApuracao: '2', notas: [], itens: [], participantes: [], unidades: [],
    warnings: [] as string[], receitaSemDocumento: RECEITA,
    ...over,
});
const linhaDe = (linhas: string[], reg: string) => linhas.find((l) => l.startsWith(`|${reg}|`))?.trim();

describe('a receita de LOCAÇÃO sai da ficha', () => {
    it('soma matriz e filiais — é o campo "Locação de Bens" da tela', () => {
        expect(receitaDeLocacao({ faturamentoLocacao: 21811.34 })).toBeCloseTo(21811.34, 2);
        expect(receitaDeLocacao({ faturamentoLocacao: 1000, faturamentoFiliais: { locacao: 500 } })).toBe(1500);
    });

    // 🚨 21/08, AFFITTARE de novo — o arquivo saiu F001|1 DEPOIS de a régua
    // existir: a ficha GRAVADA (fichaFinanceira[]) usa os nomes ACHATADOS
    // (`faturamentoMesLocacao`, `faturamentoFiliaisLocacao` — o que a tela e o
    // ReportView leem); a forma `faturamentoLocacao` é a do INPUT do cálculo,
    // que a ficha nunca tem. A 1ª versão lia só o input → 0 em silêncio.
    it('🚨 lê a FICHA GRAVADA (faturamentoMesLocacao) — é ela que o orquestrador entrega', () => {
        expect(receitaDeLocacao({ faturamentoMesLocacao: 21811.34 })).toBeCloseTo(21811.34, 2);
        expect(receitaDeLocacao({ faturamentoMesLocacao: 1000, faturamentoFiliaisLocacao: 500 })).toBe(1500);
    });

    it('ficha ausente ou sem locação devolve 0 — nunca NaN', () => {
        expect(receitaDeLocacao(null)).toBe(0);
        expect(receitaDeLocacao({ faturamentoServico: 5000 })).toBe(0);
    });

    it('⚠️ as OUTRAS receitas da ficha ficam de fora — elas têm documento', () => {
        // Trazê-las para o F550 "por garantia" seria a dupla contagem que a
        // trava existe para evitar.
        expect(receitaDeLocacao({ faturamentoComercio: 9000, faturamentoIndustria: 8000, faturamentoServico: 7000 }))
            .toBe(0);
    });
});

describe('🚨 F550 — campo a campo contra o arquivo ACEITO de 05/2026', () => {
    const linhas = buildBlocoF(dados());
    const f550 = linhaDe(linhas, 'F550')!;
    const campos = f550.split('|');

    it('a linha reproduz o aceito campo a campo (menos o centavo, abaixo)', () => {
        expect(f550).toBe('|F550|21811,34|01|0,00|21811,34|0,65|141,77|01|0,00|21811,34|3,00|654,34|||||');
    });

    it('🚨 UM CENTAVO de diferença contra o aceito — e a escolha é a COERÊNCIA', () => {
        // O arquivo do e-Fiscal se desmente dentro de si mesmo: F550 traz
        // 141,76/654,33 e o M200 dele traz 141,77/654,34. O 1900 daquele
        // arquivo declara QUANT_DOC 3 — ele calculou documento a documento e
        // somou arredondamentos. Nós não temos os 3 documentos (é por isso que
        // a receita vem da ficha), então reproduzir o 141,76 exigiria inventar
        // o rateio. F550 e M200 nossos saem do MESMO número.
        //
        // Régua de 11/08: o e-Fiscal é REFERÊNCIA, nunca gabarito — e VALOR de
        // lá não é verdade.
        const m = montarF550({ receita: RECEITA, aliqPis: 0.0065, aliqCofins: 0.03 });
        expect(m.pis).toBeCloseTo(141.77, 2);
        expect(m.cofins).toBeCloseTo(654.34, 2);
        const doBlocoM = linhaDe(buildBlocoM(dados()), 'M200')!;
        expect(doBlocoM).toContain('141,77');   // o MESMO número do F550
    });

    it('CST 01 nos dois tributos — receita tributada à alíquota básica', () => {
        expect(campos[3]).toBe(CST_F550_TRIBUTADA);
        expect(campos[8]).toBe(CST_F550_TRIBUTADA);
    });

    it('os quatro últimos campos saem VAZIOS, como no aceito', () => {
        expect(campos.slice(13, 17)).toEqual(['', '', '', '']);
    });

    it('F001 diz que o bloco TEM dados, e o F010 abre o estabelecimento', () => {
        expect(linhaDe(linhas, 'F001')).toBe('|F001|0|');
        expect(linhaDe(linhas, 'F010')).toBe(`|F010|${CNPJ}|`);
    });

    it('⚠️ o F010 sai UMA vez só quando há F550 e F600 juntos', () => {
        const comRetencao = buildBlocoF(dados({
            retencoesF600: { eventos: [{ data: '2026-07-02', base: 5200, pis: 33.8, cofins: 156, cnpjFonte: '47252373000113' }] },
        }));
        expect(comRetencao.filter((l: string) => l.startsWith('|F010|'))).toHaveLength(1);
    });

    it('sem receita e sem retenção, o bloco continua SEM DADOS', () => {
        const vazio = buildBlocoF(dados({ receitaSemDocumento: 0 }));
        expect(linhaDe(vazio, 'F001')).toBe('|F001|1|');
        expect(linhaDe(vazio, 'F550')).toBeUndefined();
    });
});

describe('🚨 o bloco M para de sair ZERADO', () => {
    it('M200/M600 declaram a contribuição da receita da ficha', () => {
        const linhas = buildBlocoM(dados());
        // 21.811,34 × 0,65% = 141,77 · × 3% = 654,34 (os números do aceito)
        expect(linhaDe(linhas, 'M200')).toMatch(/141,77/);
        expect(linhaDe(linhas, 'M600')).toMatch(/654,34/);
    });

    it('e o M210 mostra receita = base (aluguel não tem ICMS a excluir)', () => {
        const campos = linhaDe(buildBlocoM(dados()), 'M210')!.split('|');
        expect(campos[3]).toBe('21811,34');   // VL_REC_BRT
        expect(campos[4]).toBe('21811,34');   // VL_BC_CONT
    });

    it('sem receita da ficha, nada muda — o caminho antigo continua igual', () => {
        const linhas = buildBlocoM(dados({ receitaSemDocumento: 0 }));
        expect(linhaDe(linhas, 'M200')).toMatch(/\|0,00\|0,00\|/);
    });
});

describe('🚨 o 0110 DERIVA do que o arquivo produziu', () => {
    it('com F550, a escrituração é CONSOLIDADA (2) — como no aceito', () => {
        expect(indRegCumDoArquivo({ regimeApuracao: '2', receitaConsolidada: RECEITA })).toBe('2');
        const l = linhaDe(buildBloco0Contrib(dados()), '0110');
        expect(l).toBe('|0110|2||1|2|');
    });

    it('sem F550, continua DETALHADA (9) — o caminho de todo mundo', () => {
        expect(indRegCumDoArquivo({ regimeApuracao: '2', receitaConsolidada: 0 })).toBe('9');
        expect(linhaDe(buildBloco0Contrib(dados({ receitaSemDocumento: 0 })), '0110')).toBe('|0110|2||1|9|');
    });

    it('fora do cumulativo o campo não é informado, como já era', () => {
        expect(indRegCumDoArquivo({ regimeApuracao: '1', receitaConsolidada: RECEITA })).toBe('');
    });
});

describe('🚨 DUPLA CONTAGEM é o risco, e o app DIZ em vez de escolher', () => {
    it('conta os documentos de saída do período', () => {
        const notas = [{ direcao: 'saida' }, { direcao: 'entrada' }, { direcao: 'saida' }];
        expect(receitaDeDocumentosNoPeriodo(notas, (d: any) => d.direcao).quantidade).toBe(2);
    });

    it('o orquestrador avisa quando há saída junto da locação', () => {
        const fonte = require('fs').readFileSync(
            require('path').resolve(__dirname, '../sefaz-backend/sped-contrib-orchestrator.js'), 'utf8',
        );
        expect(fonte).toMatch(/receitaDeLocacao\(fichaDaComp\)/);
        expect(fonte).toMatch(/a contribuição vai DUPLICADA/);
        // A ficha é EMBUTIDA — não existe coleção `lucro_fichas` (lição de 19/08).
        expect(fonte).toMatch(/empresa\.fichaFinanceira/);
        expect(fonte).not.toMatch(/collection\('lucro_fichas'\)/);
    });
});

// ─── A trava do ORQUESTRADOR: quem entrega a ficha entrega a ficha CERTA ─────
//
// O defeito de 21/08 não estava só no nome do campo: a competência da ficha
// (`mesReferencia`) aparece em três formatos conforme a época do lançamento, e
// igualdade estrita perderia a ficha em silêncio — o mesmo zero indistinguível.
describe('🚨 orquestrador — ficha casada por competência NORMALIZADA', () => {
    const fs = require('fs');
    const path = require('path');
    const fonte = fs.readFileSync(
        path.resolve(__dirname, '../sefaz-backend/sped-contrib-orchestrator.js'), 'utf8',
    );

    // ⚠️ TESTE TROCADO na mesma noite: a 1ª versão exigia a normalização
    // INLINE (`normalizarCompetencia(f?.mesReferencia)`) — que era a SEGUNDA
    // CÓPIA da régua, criada por mim no PR do F550. A leitura da ficha por
    // competência tem dono (`acharFichaCompetencia`), e é ele que o teste
    // exige agora; travar a cópia impediria a própria correção.
    it('usa o DONO da leitura por competência, não igualdade estrita nem cópia da normalização', () => {
        expect(fonte).toMatch(/acharFichaCompetencia\(empresa\.fichaFinanceira, competencia\)/);
        expect(fonte).toMatch(/from '\.\/ipi-varredura\.js'/);
        expect(fonte).not.toMatch(/f\?\.mesReferencia\s*===/);
    });

    it('período sem receita NENHUMA sai DITO — zero no M200/M600 é afirmação', () => {
        expect(fonte).toMatch(/M200\/M600 vão declarar ZERO/);
    });

    // 🚨 PVA da AFFITTARE 21/08 (2ª rodada): com o arquivo CONSOLIDADO (F550 +
    // IND_REG_CUM 2), o A010/A100 do serviço TOMADO volta com "O registro não
    // deve ser informado para esse perfil e/ou tipo de operação". No cumulativo
    // o tomado não gera crédito — sai da escrituração, NOMEADO no aviso.
    it('🚨 consolidada exclui documento de ENTRADA — antes da coleta de 0150/0200', () => {
        expect(fonte).toMatch(/receitaSemDocumento > 0 && regimeApuracao === '2'/);
        expect(fonte).toMatch(/direcaoEfetivaDoc\(n\) === 'saida'/);
        expect(fonte).toMatch(/não deve ser informado para esse perfil/);
        // A exclusão tem que vir ANTES da coleta de participantes/itens —
        // coletar quem vai sair deixaria o 0150/0200 órfãos (recusa do PVA).
        expect(fonte.indexOf('entradasForaDaConsolidada'))
            .toBeLessThan(fonte.indexOf('Extrai participantes unicos'));
    });

    it('⚠️ o detalhado NÃO exclui — o PVA aceitou as entradas da MANTOAN (IND_REG_CUM 9)', () => {
        // A exclusão é condicionada à receita consolidada; sem F550 nada muda.
        expect(fonte).toMatch(/Só o caminho CONSOLIDADO exclui/);
    });
});
