// ============================================================================
// 🚦 OS REGISTROS QUE NUNCA VIRAM O PVA — inventário, ST e IPI
//
// 29/08, Paulo: *"feche as pendências de PVA que dependem de você"*.
//
// Eu **não rodo o PVA** — o recibo exige o arquivo passar por lá. O que
// depende de mim é tudo que faria essa volta FALHAR. Cruzando os registros que
// os geradores EMITEM com os que a prevalidação COBRE, seis tinham **zero**
// regra: `H005`, `H010`, `E210`, `E220`, `E250` e `E510` — exatamente os
// registros das quatro pendências antigas do de-para (bloco H, ST, IPI).
//
// 📌 A doutrina do "PVA de bolso" era *recusa aprendida entra no MESMO PR*.
// Aqui ela vai um passo antes: o Guia 3.2.3 está no repo desde 20/08, e a
// **validação oficial entra ANTES de a recusa acontecer** — que é a única
// forma de não gastar a volta de PVA para descobrir o que já estava escrito.
//
// 🚨 E a leitura do Guia achou um defeito de VERDADE no caminho: o **E250 saía
// com o `MES_REF` VAZIO**, e ele é campo **obrigatório** desde jan/2011. É a
// classe do M210 da DGB (28/08) — campo obrigatório em branco, recusa
// `Campo de preenchimento obrigatório` garantida.
// ============================================================================
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';
import { montarLinhasStBlocoE, mesRefDoPeriodo } from '../sefaz-backend/sped-bloco-e-st.js';

const L = (...campos: (string | number)[]) => `|${campos.join('|')}|`;

/** O 0000 mínimo — DT_INI no campo 04, que é de onde sai a competência. */
const REG0000 = L('0000', '020', '0', '01072026', '31072026', 'EMPRESA X', '11111111000191',
    '', 'SP', '123456789012', '3550308', '', '', 'A', '1');

describe('🚦 as seis regras NASCEM VERDES sobre arquivo correto', () => {
    it('inventário coerente não acusa nada', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'PARAFUSO', '', '', '', '00', 'UN', ''),
            L('H005', '31072026', '250,00', '01'),
            L('H010', 'IT1', 'UN', '10,00', '25,00', '250,00', '0', '', '', '', ''),
        ]);
        expect(r.erros.filter((e: any) => String(e.regra).startsWith('h0'))).toEqual([]);
    });

    it('ST coerente não acusa nada', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('E200', 'MG', '01072026', '31072026'),
            // 13 = VL_ICMS_RECOL_ST · 15 = DEB_ESP_ST
            L('E210', '1', '0,00', '0,00', '0,00', '0,00', '0,00', '380,79', '0,00', '0,00',
                '380,79', '0,00', '380,79', '0,00', '0,00'),
            L('E250', '000', '380,79', '20082026', '063-2', '', '', '', '', '072026'),
        ]);
        expect(r.erros.filter((e: any) => String(e.regra).startsWith('e2'))).toEqual([]);
    });

    it('IPI coerente não acusa nada', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('E500', '0', '01072026', '31072026'),
            L('E510', '1101', '00', '142785,85', '43891,50', '2200,45'),   // entrada ⇒ crédito
            L('E510', '5101', '50', '90000,00', '30000,00', '2547,39'),    // saída ⇒ débito
            // 02 VL_SD_ANT · 03 VL_DEB · 04 VL_CRED
            L('E520', '0,00', '2547,39', '2200,45', '0,00', '0,00', '0,00', '346,94'),
        ]);
        expect(r.erros.filter((e: any) => String(e.regra).startsWith('e510'))).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 E ELAS ACUSAM O QUE O PVA RECUSARIA. Cada caso abaixo é a validação
// LITERAL do Guia 3.2.3, não uma dedução minha.
// ════════════════════════════════════════════════════════════════════════════
describe('R21 — o total do inventário × a soma dos itens', () => {
    // Guia H005 campo 03: "deve ser igual à soma do campo VL_ITEM do H010".
    // É a classe do VL_DOC × Σ VL_OPR (PWR, 20/08) — que o PVA NÃO recusa: ele
    // só imprime um total menor.
    it('acusa quando o H005 não bate com os H010', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'X', '', '', '', '00', 'UN', ''),
            L('H005', '31072026', '999,00', '01'),
            L('H010', 'IT1', 'UN', '10,00', '25,00', '250,00', '0', '', '', '', ''),
        ]);
        const e = r.erros.find((x: any) => x.regra === 'h005-x-h010')!;
        expect(e).toBeTruthy();
        expect(e.mensagem).toMatch(/999,00|999\.00/);
        expect(e.fonte).toMatch(/H005 campo 03/);
    });
});

describe('R22 — item de inventário que o 0200 não cadastra', () => {
    it('acusa o item órfão, nomeando o código', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'X', '', '', '', '00', 'UN', ''),
            L('H005', '31072026', '250,00', '01'),
            L('H010', 'IT-FANTASMA', 'UN', '10,00', '25,00', '250,00', '0', '', '', '', ''),
        ]);
        const e = r.erros.find((x: any) => x.regra === 'h010-item-orfao')!;
        expect(e).toBeTruthy();
        expect(e.valor).toMatch(/IT-FANTASMA/);
    });
});

describe('R23 — bem de terceiro sem participante', () => {
    // Guia H010 campo 07: IND_PROP 1 ou 2 ⇒ COD_PART obrigatório, e campo 08:
    // "o valor fornecido deve constar no campo COD_PART do registro 0150".
    it('acusa posse de terceiro sem COD_PART', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'X', '', '', '', '00', 'UN', ''),
            L('0150', 'P1', 'FORNECEDOR', '1058', '', '', '11222333000181', '', '3550308', '', '', ''),
            L('H005', '31072026', '250,00', '01'),
            L('H010', 'IT1', 'UN', '10,00', '25,00', '250,00', '2', '', '', '', ''),
        ]);
        expect(r.erros.find((x: any) => x.regra === 'h010-terceiro-sem-part')).toBeTruthy();
    });

    it('com o participante cadastrado, fica MUDA', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'X', '', '', '', '00', 'UN', ''),
            L('0150', 'P1', 'FORNECEDOR', '1058', '', '', '11222333000181', '', '3550308', '', '', ''),
            L('H005', '31072026', '250,00', '01'),
            L('H010', 'IT1', 'UN', '10,00', '25,00', '250,00', '2', 'P1', '', '', ''),
        ]);
        expect(r.erros.find((x: any) => x.regra === 'h010-terceiro-sem-part')).toBeFalsy();
    });

    // ⚠️ Bem PRÓPRIO (IND_PROP 0) não pede participante — acusar seria alarme
    // sobre o caso comum.
    it('bem próprio não é acusado', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'X', '', '', '', '00', 'UN', ''),
            L('H005', '31072026', '250,00', '01'),
            L('H010', 'IT1', 'UN', '10,00', '25,00', '250,00', '0', '', '', '', ''),
        ]);
        expect(r.erros.find((x: any) => x.regra === 'h010-terceiro-sem-part')).toBeFalsy();
    });
});

describe('R24 — a GNRE tem de cobrar o que o E210 apurou', () => {
    // Gêmea da R18 (E110 × E116), do lado do ST — e cada UF aqui é uma GNRE.
    it('acusa a divergência com os dois números', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('E200', 'MG', '01072026', '31072026'),
            L('E210', '1', '0,00', '0,00', '0,00', '0,00', '0,00', '380,79', '0,00', '0,00',
                '380,79', '0,00', '380,79', '0,00', '0,00'),
            L('E250', '000', '100,00', '20082026', '063-2', '', '', '', '', '072026'),
        ]);
        const e = r.erros.find((x: any) => x.regra === 'e210-x-e250')!;
        expect(e).toBeTruthy();
        expect(e.mensagem).toMatch(/380[.,]79/);
        expect(e.acao).toMatch(/GNRE/);
    });
});

describe('R25 — o E510 tem de fechar com o E520', () => {
    // Guia E510: "O total de créditos e dos débitos informados neste registro
    // deverá ser igual ao total dos créditos e débitos dos registros C190 e do
    // registro E520". O CFOP separa: 1/2/3 é entrada (crédito), 5/6/7 saída.
    it('acusa o débito que não bate', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('E500', '0', '01072026', '31072026'),
            L('E510', '5101', '50', '90000,00', '30000,00', '999,00'),
            L('E520', '0,00', '2547,39', '0,00', '0,00', '0,00', '0,00', '0,00'),
        ]);
        const e = r.erros.find((x: any) => x.regra === 'e510-x-e520')!;
        expect(e).toBeTruthy();
        expect(e.mensagem).toMatch(/débito/);
    });

    it('acusa o crédito que não bate', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('E500', '0', '01072026', '31072026'),
            L('E510', '1101', '00', '142785,85', '43891,50', '10,00'),
            L('E520', '0,00', '0,00', '2200,45', '0,00', '0,00', '0,00', '0,00'),
        ]);
        expect(r.erros.find((x: any) => x.regra === 'e510-x-e520')?.mensagem).toMatch(/crédito/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 O DEFEITO ACHADO NA LEITURA DO GUIA: MES_REF vazio no E250.
//
// Campo **obrigatório** desde jan/2011, e o gerador o emitia em branco. Prova
// pelo GERADOR REAL, não por linha escrita à mão.
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 R26 — o MES_REF do E250 saía VAZIO', () => {
    it('mesRefDoPeriodo deriva mmaaaa do DT_INI (DDMMAAAA)', () => {
        expect(mesRefDoPeriodo('01072026')).toBe('072026');
        expect(mesRefDoPeriodo('31122026')).toBe('122026');
    });

    // ⚠️ Data ilegível devolve '' — competência não recebe palpite; quem acusa
    // é a prevalidação.
    it('data ilegível não vira palpite', () => {
        expect(mesRefDoPeriodo('')).toBe('');
        expect(mesRefDoPeriodo('ontem')).toBe('');
    });

    it('o GERADOR REAL passa a emitir o campo preenchido', () => {
        const nota = {
            direcao: 'saida', status: 'autorizado', modelo: '55', tpNF: '1',
            ufDest: 'MG', empresaCnpj: '11111111000191',
            totais: { vST: 380.79 },
            itens: [{ cfop: '6403', vST: 380.79 }],
        };
        const r = montarLinhasStBlocoE({
            notas: [nota], ufEmpresa: 'SP', ajustes: [],
            dtIni: '01072026', dtFin: '31072026',
            obrigacoesPorUf: { MG: { dtVcto: '20082026', codRec: '063-2' } },
        });
        const e250 = (r.linhas || []).find((l: any) => (Array.isArray(l) ? l[0] : '') === 'E250')!;
        expect(e250).toBeTruthy();
        expect(e250[9]).toBe('072026');   // índice 9 = campo 10
    });

    it('a prevalidação acusa o campo vazio, com a recusa como fonte', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('E200', 'MG', '01072026', '31072026'),
            L('E210', '1', '0,00', '0,00', '0,00', '0,00', '0,00', '380,79', '0,00', '0,00',
                '380,79', '0,00', '380,79', '0,00', '0,00'),
            L('E250', '000', '380,79', '20082026', '063-2', '', '', '', '', ''),
        ]);
        const e = r.erros.find((x: any) => x.regra === 'e250-mes-ref')!;
        expect(e).toBeTruthy();
        expect(e.mensagem).toMatch(/OBRIGATÓRIO/);
        expect(e.esperado).toBe('072026');
    });

    // Validação do Guia: "não pode ser superior à competência do DT_INI".
    it('acusa competência POSTERIOR à do arquivo', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('E200', 'MG', '01072026', '31072026'),
            L('E210', '1', '0,00', '0,00', '0,00', '0,00', '0,00', '380,79', '0,00', '0,00',
                '380,79', '0,00', '380,79', '0,00', '0,00'),
            L('E250', '000', '380,79', '20082026', '063-2', '', '', '', '', '082026'),
        ]);
        expect(r.erros.find((x: any) => x.regra === 'e250-mes-ref')?.valor).toBe('082026');
    });

    // ⚠️ Competência ANTERIOR é legítima (obrigação de período anterior) — o
    // Guia só proíbe a posterior. Acusá-la seria alarme sobre arquivo correto.
    it('competência anterior NÃO é acusada', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('E200', 'MG', '01072026', '31072026'),
            L('E210', '1', '0,00', '0,00', '0,00', '0,00', '0,00', '380,79', '0,00', '0,00',
                '380,79', '0,00', '380,79', '0,00', '0,00'),
            L('E250', '000', '380,79', '20082026', '063-2', '', '', '', '', '062026'),
        ]);
        expect(r.erros.find((x: any) => x.regra === 'e250-mes-ref')).toBeFalsy();
    });
});
