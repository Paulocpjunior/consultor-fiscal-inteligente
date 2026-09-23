/**
 * Apuração do ICMS-ST no Bloco E (E200/E210/E220/E250).
 *
 * Era o bloqueio que sobrou depois do E111: empresa que retém ST na saída não
 * fechava a EFD pelo CFI. A ST é apurada POR UF de destino — cada estado vira
 * uma guia própria.
 */
import {
    agruparStPorUf, apurarStDaUf, montarLinhasStBlocoE,
} from '../sefaz-backend/sped-bloco-e-st.js';

const saidaComSt = (uf: string, vST: number, extra: Record<string, unknown> = {}) => ({
    direcao: 'saida',
    destinatario: { uf },
    totais: { vST },
    ...extra,
});

describe('agruparStPorUf', () => {
    it('soma o ST retido por UF de destino e conta os documentos', () => {
        const r = agruparStPorUf([
            saidaComSt('MG', 100),
            saidaComSt('MG', 50),
            saidaComSt('RJ', 30),
        ], 'SP');

        expect(r.grupos).toEqual([
            { uf: 'MG', retencao: 150, documentos: 2 },
            { uf: 'RJ', retencao: 30, documentos: 1 },
        ]);
        expect(r.semUf).toEqual([]);
    });

    it('entrada, saída sem ST e nota cancelada ficam fora', () => {
        const r = agruparStPorUf([
            { direcao: 'entrada', destinatario: { uf: 'MG' }, totais: { vST: 900 } },
            saidaComSt('MG', 0),
            saidaComSt('MG', 100, { situacao: 'cancelada' }),
            saidaComSt('MG', 40),
        ], 'SP');
        expect(r.grupos).toEqual([{ uf: 'MG', retencao: 40, documentos: 1 }]);
    });

    it('cancelada por EVENTO (status ainda "autorizado") também fica fora — régua docCancelado', () => {
        const r = agruparStPorUf([
            saidaComSt('MG', 100, {
                status: 'autorizado',
                eventos: [{ tpEvento: '110111', cStat: '135' }],
            }),
            saidaComSt('MG', 40),
        ], 'SP');
        expect(r.grupos).toEqual([{ uf: 'MG', retencao: 40, documentos: 1 }]);
    });

    it('soma pelos itens quando a nota não traz o total de ST', () => {
        const r = agruparStPorUf([
            { direcao: 'saida', destinatario: { uf: 'PR' }, itens: [{ vICMSST: 12.5 }, { vICMSST: 7.5 }] },
        ], 'SP');
        expect(r.grupos[0]).toMatchObject({ uf: 'PR', retencao: 20 });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A UF DE DESTINO SAI DA RÉGUA — e o `ufEmpresa` deixou de ser default
//
// Varredura dos leitores de documento (21/08). Este agrupamento lia
// `destinatario.uf` (forma ANINHADA) e o importer principal grava `ufDest`
// ACHATADO: em toda nota capturada automaticamente a UF vinha vazia e caía no
// `ufEmpresa`. O ST retido para MG/PR/RJ era apurado como se fosse do próprio
// estado — e cada UF aqui é uma GNRE.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 UF de destino — as duas formas do documento', () => {
    it('nota CAPTURADA (ufDest achatado) é agrupada na UF certa, não na da empresa', () => {
        const r = agruparStPorUf([
            { direcao: 'saida', status: 'autorizado', ufDest: 'MG', totais: { vST: 100 } },
        ], 'SP');
        expect(r.grupos).toEqual([{ uf: 'MG', retencao: 100, documentos: 1 }]);
    });

    it('sem UF legível o documento sai NOMEADO — nunca na UF da empresa', () => {
        const r = agruparStPorUf([
            { direcao: 'saida', status: 'autorizado', numero: '4321', totais: { vST: 100 } },
        ], 'SP');
        expect(r.grupos).toEqual([]);
        expect(r.semUf).toEqual(['4321']);
    });

    it('e o aviso diz o número e a ação — some da conta, não da tela', () => {
        const r = montarLinhasStBlocoE({
            notas: [
                { direcao: 'saida', status: 'autorizado', numero: '4321', totais: { vST: 100 } },
                saidaComSt('MG', 40),
            ],
            ufEmpresa: 'SP', dtIni: '01072026', dtFin: '31072026',
        });
        const aviso = r.avisos.find((a: string) => a.includes('4321'));
        expect(aviso).toBeDefined();
        expect(aviso).toContain('GNRE');
    });

    it('nota PRÓPRIA de entrada (tpNF=0 gravada como saída) não vira retenção', () => {
        const r = agruparStPorUf([
            {
                direcao: 'saida', status: 'autorizado', tpNF: '0', ufDest: 'MG',
                totais: { vST: 900 },
            },
        ], 'SP');
        expect(r.grupos).toEqual([]);
    });
});

describe('apurarStDaUf', () => {
    it('retenção pura vira imposto a recolher', () => {
        const r = apurarStDaUf({ uf: 'MG', retencao: 1000 });
        expect(r.icmsRecolher).toBe(1000);
        expect(r.saldoCredorTransportar).toBe(0);
    });

    it('crédito maior que o débito transporta saldo credor (não vira imposto negativo)', () => {
        const r = apurarStDaUf({ uf: 'MG', retencao: 100, saldoCredorAnterior: 400 });
        expect(r.icmsRecolher).toBe(0);
        expect(r.saldoCredorTransportar).toBe(300);
    });

    it('ajustes: débito e estorno de crédito somam; crédito e estorno de débito abatem', () => {
        const r = apurarStDaUf({
            uf: 'SP', retencao: 1000,
            ajustes: { outrosDebitos: 100, estornosCredito: 50, outrosCreditos: 200, estornosDebito: 30 },
        });
        expect(r.ajDebitos).toBe(150);
        expect(r.ajCreditos).toBe(230);
        expect(r.icmsRecolher).toBe(920); // 1000 + 150 − 230
    });

    it('dedução só abate saldo devedor e débito especial fica fora da conta', () => {
        const r = apurarStDaUf({ uf: 'SP', retencao: 500, ajustes: { deducoes: 200, debitosEspeciais: 90 } });
        expect(r.icmsRecolher).toBe(300);
        expect(r.saldoDevedorApurado).toBe(500); // campo 11 do E210: antes das deduções
        expect(r.debitosEspeciais).toBe(90);
    });

    it('dedução que não cabe no devedor NÃO vira crédito — sai nomeada como excedente', () => {
        const r = apurarStDaUf({ uf: 'SP', retencao: 100, saldoCredorAnterior: 400, ajustes: { deducoes: 50 } });
        expect(r.icmsRecolher).toBe(0);
        expect(r.saldoCredorTransportar).toBe(300); // 400 − 100, sem os 50 inflando
        expect(r.deducoes).toBe(0);
        expect(r.deducoesExcedentes).toBe(50);
    });
});

describe('montarLinhasStBlocoE', () => {
    const base = {
        notas: [saidaComSt('SP', 1000), saidaComSt('MG', 500)],
        ufEmpresa: 'SP',
        dtIni: '01072026', dtFin: '31072026',
    };

    // ⚠️ TESTE TROCADO 21/08 (caso REALITY 0899 · 07/2026): a versão anterior
    // travava STRINGS sem o `|` inicial e sem `\r\n` — exatamente o formato
    // quebrado que fez todos os E200/E210 saírem GRUDADOS numa linha só do
    // arquivo real. Agora as linhas são ARRAYS de campos e quem forma a linha
    // é o fmt.buildLine de quem monta o arquivo (padrão do E111).
    it('gera um E200 + E210 por UF, em ordem, como ARRAYS de campos', () => {
        const r = montarLinhasStBlocoE(base);
        const e200 = r.linhas.filter((c: string[]) => c[0] === 'E200');
        expect(e200).toEqual([
            ['E200', 'MG', '01072026', '31072026'],
            ['E200', 'SP', '01072026', '31072026'],
        ]);
        expect(r.linhas.filter((c: string[]) => c[0] === 'E210')).toHaveLength(2);
    });

    it('E210: retenção no campo 8, saldo devedor APURADO no campo 11 (antes das deduções) e recolher no 13', () => {
        const r = montarLinhasStBlocoE(base);
        const e210Sp = r.linhas.find((c: string[]) => c[0] === 'E210' && c.includes('1000,00'));
        // Corroborado pelo E210 aceito do e-Fiscal da REALITY: retenção 380,79 ⇒
        // campo 11 = 380,79 ⇒ recolher 380,79 (a conta 11 − 12 = 13 fecha).
        expect(e210Sp).toEqual([
            'E210', '1', '0,00', '0,00', '0,00', '0,00', '0,00', '1000,00',
            '0,00', '0,00', '1000,00', '0,00', '1000,00', '0,00', '0,00',
        ]);
    });

    it('ajuste com código de ST vira linha E220 na UF da empresa', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            ajustes: [{ codigo: 'SP120799', descricao: 'Crédito ST', valor: 300 }],
        });
        const e220 = r.linhas.filter((c: string[]) => c[0] === 'E220');
        expect(e220).toEqual([['E220', 'SP120799', 'Crédito ST', '300,00']]);
        // e o crédito abateu o imposto da UF da empresa (1000 − 300)
        expect(r.apuracoes.find((a) => a.uf === 'SP')?.icmsRecolher).toBe(700);
    });

    // 🚨 29/08 — OS AJUSTES ESTAVAM NA CASA DO VIZINHO, e é a classe que esta
    // casa mais paga: o SALDO fecha e o campo mente.
    //
    // 📖 O Guia 3.2.3 nomeia os quatro campos sem margem:
    //  · 06 VL_OUT_CRED_ST    — "Ajustes 'Outros créditos ST' e 'Estorno de
    //    débitos ST'", Σ dos E220 com 3º = '1' e 4º = '2' ou '3';
    //  · 07 VL_AJ_CREDITOS_ST — "provenientes de ajustes do DOCUMENTO FISCAL",
    //    ou seja dos C197;
    //  · 09 VL_OUT_DEB_ST     — "Outros débitos ST e Estorno de créditos ST",
    //    Σ dos E220 com 3º = '1' e 4º = '0' ou '1';
    //  · 10 VL_AJ_DEBITOS_ST  — do C197, como o 07.
    //
    // O gerador punha os ajustes do E220 nos campos 07 e 10, deixando 06 e 09
    // zerados com os E220 logo abaixo. É o E110 campo 11 (02/08) e o IPI em
    // E200/E210 (04/08) de novo — e nenhum teste pegava porque nenhum olhava
    // essas quatro casas.
    it('🚨 o ajuste do E220 vai no campo 06/09, NUNCA no 07/10 (que são do C197)', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            ajustes: [
                { codigo: 'SP100001', descricao: 'Outros débitos ST', valor: 100 },
                { codigo: 'SP120002', descricao: 'Outros créditos ST', valor: 30 },
            ],
        });
        // A base tem DUAS UFs (MG e SP) e o ajuste vale só na da EMPRESA — é
        // a linha de SP que carrega a retenção de 1000,00.
        const e210 = r.linhas.find((c: string[]) => c[0] === 'E210' && c.includes('1000,00'))!;
        expect(e210).toBeDefined();
        // ⚠️ DUAS CONVENÇÕES DE ÍNDICE CONVIVEM NESTE REPO, e eu tropecei nas
        // duas hoje: aqui a linha é um ARRAY de campos com o REG na posição 0,
        // então **campo N = índice N−1**; na prevalidação a linha é texto e o
        // `split('|')` põe '' no 0 e o REG no 1, então **campo N = índice N**.
        // Ler a posição pela convenção do vizinho é o erro do DT_FIN (22/08) e
        // o do D100 com as casas do C100 — e foi o gerador REAL que respondeu.
        expect(e210[5]).toBe('30,00');   // 06 VL_OUT_CRED_ST  ← E220 tipo 2
        expect(e210[6]).toBe('0,00');    // 07 VL_AJ_CREDITOS_ST (C197 — não gerado)
        expect(e210[8]).toBe('100,00');  // 09 VL_OUT_DEB_ST   ← E220 tipo 0
        expect(e210[9]).toBe('0,00');    // 10 VL_AJ_DEBITOS_ST  (C197 — não gerado)
    });

    // ⚠️ E o SALDO não muda com a correção — ele já estava certo, e é isso que
    // torna este defeito silencioso: mover o número de casa não mexe na conta.
    it('e o saldo devedor apurado não muda com a correção', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            ajustes: [
                { codigo: 'SP100001', descricao: 'Outros débitos ST', valor: 100 },
                { codigo: 'SP120002', descricao: 'Outros créditos ST', valor: 30 },
            ],
        });
        // retenção 1000 + débito 100 − crédito 30 = 1070
        expect(r.apuracoes.find((a) => a.uf === 'SP')?.saldoDevedorApurado).toBe(1070);
    });

    it('ajuste de ICMS PRÓPRIO não entra no E220 (é do E111) e não vira erro', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            ajustes: [{ codigo: 'SP020799', descricao: 'Crédito outorgado', valor: 300 }],
        });
        expect(r.linhas.filter((c: string[]) => c[0] === 'E220')).toEqual([]);
        expect(r.avisos.filter((a: string) => a.includes('IGNORADO'))).toEqual([]);
    });

    it('sem vencimento/código de receita da GNRE, o E250 NÃO é inventado — vira aviso', () => {
        const r = montarLinhasStBlocoE(base);
        expect(r.linhas.filter((c: string[]) => c[0] === 'E250')).toEqual([]);
        expect(r.avisos.join(' ')).toContain('E250 não foi gerado');
        expect(r.avisos.join(' ')).toContain('código de receita');
    });

    it('com a obrigação cadastrada, gera o E250 da UF', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            obrigacoesPorUf: { SP: { dtVcto: '10082026', codRec: '046-2' } },
        });
        // 🚨 FIXTURE TROCADA (29/08): ela descrevia o E250 com o campo 10
        // (MES_REF) VAZIO — e ele é **OBRIGATÓRIO** desde jan/2011 (Guia 3.2.3,
        // E250 campo 10: *"Informe o mês de referência no formato 'mmaaaa'"*,
        // Obrig. O). O teste documentava o defeito em vez de pegá-lo, como o
        // teste que exigia os ajustes do M210 vazios (28/08, DGB).
        expect(r.linhas).toContainEqual(
            ['E250', '000', '1000,00', '10082026', '046-2', '', '', '', '', '072026'],
        );
    });

    it('empresa sem ST em saída não recebe bloco nenhum', () => {
        const r = montarLinhasStBlocoE({ ...base, notas: [{ direcao: 'saida', totais: { vST: 0 } }] });
        expect(r.linhas).toEqual([]);
        expect(r.apuracoes).toEqual([]);
    });
});

// ═══ A REGRESSÃO DO CASO REAL: o bloco E inteiro sai com TODA linha formada ═══
//
// O arquivo da REALITY 0899 · 07/2026 saiu com 9 registros (E200/E210 de 4 UFs
// + E500) grudados numa ÚNICA linha — sem `|` inicial e sem `\r\n`, invisíveis
// para o PVA, para o 9900 e para a própria prevalidação. Este teste monta o
// bloco E de verdade (buildBlocoE) e exige que cada linha seja BEM FORMADA.
describe('buildBlocoE — formato das linhas com ST no arquivo', () => {
    it('toda linha do bloco começa com | e termina com |\\r\\n — nenhuma grudada', async () => {
        // @ts-expect-error — módulo .js do backend (sem tipos)
        const { buildBlocoE } = await import('../sefaz-backend/sped-fiscal-blocoE.js');
        const nota = (uf: string, vST: number) => ({
            direcao: 'saida', modelo: '55', status: 'autorizado',
            destinatario: { uf }, totais: { vST, vICMS: 10 },
            itens: [{ vICMS: 10, vICMSST: vST }],
        });
        const dados: Record<string, unknown> = {
            empresa: { _regime: 'lucro', dadosFiscais: { uf: 'SP', contribuinteIpi: 'nao' } },
            competenciaInicio: '2026-07', competenciaFim: '2026-07',
            ajustesApuracao: [], notas: [nota('MG', 2.03), nota('PR', 308.14), nota('SP', 380.79)],
            warnings: [],
        };
        const linhas = buildBlocoE(dados);
        for (const l of linhas) {
            expect(l).toMatch(/^\|[A-Z0-9]+\|.*\|\r\n$/s);
        }
        const regs = linhas.map((l: string) => l.split('|')[1]);
        expect(regs.filter((r: string) => r === 'E200')).toHaveLength(3);
        expect(regs.filter((r: string) => r === 'E210')).toHaveLength(3);
    });
});
