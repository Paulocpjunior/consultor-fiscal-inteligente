// ============================================================================
// 🏦 D-1011 (PGCC) e D-1101 (Balancete) — da planilha ao XML, conferido contra
// o XSD OFICIAL (lido do arquivo). Contas FICTÍCIAS (dado de cliente não entra
// no repo). O que se trava: o XML passa no XSD; o que a planilha não traz vira
// pendência/aviso NOMEADO com contagem; {cCtaRef} por hipótese só entra OPT-IN
// e carimbado; CONFERIR_SALDO_INICIAL recusa frequência incompatível com o
// balancete; sintéticas e contas fora do PGCC saem do balancete DITAS; {vApur}
// só com codTrib; e o conferidor PEGA XML torto.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { lerPlanoDeContas, lerBalancete } from '../sefaz-backend/dere-insumo-contabil';
import { montarEventoD1011, sugerirPlanoCtaRef, eventosCondicionaisPorCodTrib, FREQUENCIAS_ENCERRAMENTO, PLANOS_REFERENCIAIS } from '../sefaz-backend/dere-evento-d1011';
import { montarEventoD1101, formatarValorDere } from '../sefaz-backend/dere-evento-d1101';
import { conferirXmlContraXsd } from '../sefaz-backend/dere-xsd-bolso';
import { PLANO_FICTICIO, BALANCETE_FICTICIO } from './dereInsumoContabil.test';

const RAIZ = join(__dirname, '..');
const XSD_PGCC = readFileSync(join(RAIZ, 'docs/dere/xsd/evtPGCC-v1_0_3.xsd'), 'utf8');
const XSD_BAL = readFileSync(join(RAIZ, 'docs/dere/xsd/evtBalancete-v1_0_1.xsd'), 'utf8');
const CNPJ = '11.222.333/0001-81';
const DATA = new Date('2026-10-05T15:00:00Z');
const HOJE = new Date('2026-10-05T12:00:00Z');

const planoComColunas = (codTribNoCaixa = true) => PLANO_FICTICIO.map((r, i) => (i === 1
    ? [...r, 'Conta Referencial', 'Código de Tributação']
    : [...r, i > 1 ? String(r[1]).split('.')[0] : null, codTribNoCaixa && i === 7 ? '120110001' : null]));

describe('D-1011 — o PGCC sai da planilha, na ordem do XSD, e passa no schema oficial', () => {
    const base = { cnpj: CNPJ, planoCtaRef: 2, freqEncerr: 'A', iniValid: '2026-10-01' };
    it('sem {cCtaRef} o evento NÃO sai: o código referencial é obrigatório e a planilha não o traz — pendência com a contagem', () => {
        const plano = lerPlanoDeContas(PLANO_FICTICIO);
        const ev = montarEventoD1011({ ...base, contas: plano.contas }, { data: DATA });
        expect(ev.ok).toBe(false);
        expect(ev.pendencias.join(' ')).toMatch(/26 conta\(s\) sem \{cCtaRef\}/);
        expect(ev.pendencias.join(' ')).toMatch(/Tabela 32 — Plano de Contas Padrão da ANS/);
    });
    it('com a HIPÓTESE "1º segmento" (opt-in) o evento sai CARIMBADO, passa no XSD e o aviso diz que é hipótese', () => {
        const plano = lerPlanoDeContas(PLANO_FICTICIO);
        const ev = montarEventoD1011({ ...base, contas: plano.contas, cCtaRefRegra: 'segmento-1' }, { data: DATA, sequencial: 2 });
        expect(ev.ok).toBe(true);
        expect(ev.id).toMatch(/^DeRE1011111222333000181202610051[0-9]{5}00002$/);
        expect(ev.resumo).toMatchObject({ contas: 26, analiticas: 7, ctaRefPorHipotese: 26, semCodTrib: 7, iniVigDoPgcc: 26, planoCtaRefRotulo: 'ANS', freqEncerr: 'A' });
        expect(ev.avisos.join(' ')).toMatch(/26 conta\(s\) com \{cCtaRef\} preenchido pela HIPÓTESE/);
        expect(ev.avisos.join(' ')).toMatch(/7 conta\(s\) analítica\(s\) sem \{codTrib\}/);
        // A conta 1211.901 aponta o pai 12119 e a referencial 1211 (segmento antes do ponto).
        expect(ev.xml).toContain('<infoConta><cCta>1211901</cCta><cCtaInterna>1211901</cCtaInterna><cDbrMista>000</cDbrMista><nomeCta>Caixa geral</nomeCta><indCta>A</indCta><cCtaSup>12119</cCtaSup><cCtaRef>1211</cCtaRef><nivelCta>6</nivelCta><natCta>D</natCta><codNat>1</codNat><iniVig>2026-10-01</iniVig></infoConta>');
        // Nível 1 sem cCtaSup (MS1100); PL com codNat 3; nome cortado em 100.
        expect(ev.xml).toContain('<cCta>1</cCta><cCtaInterna>1</cCtaInterna><cDbrMista>000</cDbrMista><nomeCta>ATIVO</nomeCta><indCta>S</indCta><cCtaRef>1</cCtaRef><nivelCta>1</nivelCta>');
        expect(ev.xml).toContain('<cCta>251901</cCta>');
        expect(ev.xml).toMatch(/<cCta>251901<\/cCta>[^]*?<codNat>3<\/codNat>/);
        expect(ev.xml).not.toContain('<cCta>191</cCta>');
        expect(ev.xml).not.toContain('<cCta>691901</cCta>');
        const c = conferirXmlContraXsd(ev.xml!, XSD_PGCC);
        expect(c.erros).toEqual([]);
        expect(c.ok).toBe(true);
    });
    it('com a coluna "Conta Referencial" preenchida a hipótese não é usada e o codTrib da coluna aciona o condicional certo', () => {
        const plano = lerPlanoDeContas(planoComColunas());
        const ev = montarEventoD1011({ ...base, contas: plano.contas }, { data: DATA });
        expect(ev.ok).toBe(true);
        expect(ev.resumo).toMatchObject({ ctaRefPorHipotese: 0, semCodTrib: 6, codTribs: ['120110001'] });
        expect(ev.xml).toContain('<codNat>1</codNat><codTrib>120110001</codTrib><iniVig>');
        expect(conferirXmlContraXsd(ev.xml!, XSD_PGCC).ok).toBe(true);
        // 120130001 (aplicações sobre reservas técnicas) aciona o D-1106 — lido do catálogo, não de lista copiada.
        expect(eventosCondicionaisPorCodTrib(['120130001']).map((e) => e.codigo)).toEqual(['D-1106']);
        expect(eventosCondicionaisPorCodTrib(['120110001'])).toEqual([]);
    });
    it('codTrib fora de 9 dígitos (MS1115) e em sintética (MS1109) são recusas nomeadas; planoCtaRef/freqEncerr/iniValid ausentes também', () => {
        const linhas = planoComColunas().map((r, i) => (i === 7 ? [...r.slice(0, 6), '123'] : i === 5 ? [...r.slice(0, 6), '120110001'] : r));
        const plano = lerPlanoDeContas(linhas);
        const ev = montarEventoD1011({ ...base, contas: plano.contas }, { data: DATA });
        expect(ev.ok).toBe(false);
        expect(ev.pendencias.join(' ')).toMatch(/"123" deve ter 9 dígitos/);
        expect(ev.pendencias.join(' ')).toMatch(/sintética com \{codTrib\}/);
        const vazio = montarEventoD1011({ cnpj: CNPJ, contas: plano.contas, planoCtaRef: 9, freqEncerr: 'X', iniValid: '01/10/2026' } as any, { data: DATA });
        expect(vazio.pendencias.join(' ')).toMatch(/\{planoCtaRef\}/);
        expect(vazio.pendencias.join(' ')).toMatch(/\{freqEncerr\}/);
        expect(vazio.pendencias.join(' ')).toMatch(/\{iniValid\}/);
        const antes = montarEventoD1011({ ...base, iniValid: '2026-09-01', contas: plano.contas }, { data: DATA });
        expect(antes.pendencias.join(' ')).toMatch(/INI_VALID/);
    });
    it('o conferidor PEGA o XML torto (elemento fora da sequência, enumeração inválida) — aprovar tudo é pior que não conferir', () => {
        const plano = lerPlanoDeContas(planoComColunas());
        const ev = montarEventoD1011({ ...base, contas: plano.contas }, { data: DATA });
        const torto1 = ev.xml!.replace('<planoCtaRef>2</planoCtaRef><freqEncerr>A</freqEncerr>', '<freqEncerr>A</freqEncerr><planoCtaRef>2</planoCtaRef>');
        expect(conferirXmlContraXsd(torto1, XSD_PGCC).ok).toBe(false);
        const torto2 = ev.xml!.replace('<natCta>D</natCta><codNat>1</codNat><codTrib>', '<natCta>X</natCta><codNat>1</codNat><codTrib>');
        expect(conferirXmlContraXsd(torto2, XSD_PGCC).ok).toBe(false);
    });
    it('a sugestão de plano referencial só existe para planos de saúde (ANS) — nos demais o app não escolhe', () => {
        expect(sugerirPlanoCtaRef(2)).toMatchObject({ codigo: 2 });
        expect(sugerirPlanoCtaRef(1)).toMatchObject({ codigo: null });
        expect(sugerirPlanoCtaRef(null)).toMatchObject({ codigo: null });
        // As enumerações do XSD são a fonte das tabelas do módulo.
        for (const p of PLANOS_REFERENCIAIS) expect(XSD_PGCC).toMatch(new RegExp(`<xs:enumeration value="${p.codigo}">\\s*<xs:annotation>\\s*<xs:documentation>${p.rotulo}<`));
        for (const f of FREQUENCIAS_ENCERRAMENTO) expect(XSD_PGCC).toContain(`<xs:enumeration value="${f.codigo}">`);
    });
});

describe('D-1101 — o balancete sai só com as analíticas do PGCC, sinal pela raiz, e passa no schema oficial', () => {
    const plano = lerPlanoDeContas(planoComColunas());
    const bal = lerBalancete(BALANCETE_FICTICIO);
    const base = { cnpj: CNPJ, perApur: '2026-07', balancete: bal, contasPgcc: plano.contas, foraDoPgcc: plano.foraDoPgcc, hoje: HOJE };
    it('com encerramento ANUAL o evento sai: 7 analíticas, sintética e compensação/apuração FORA e ditas, XSD ok', () => {
        const ev = montarEventoD1101({ ...base, freqEncerr: 'A' }, { data: DATA });
        expect(ev.pendencias).toEqual([]);
        expect(ev.ok).toBe(true);
        expect(ev.id).toMatch(/^DeRE1101111222333000181/);
        expect(ev.resumo).toMatchObject({ contas: 7, sinteticasFora: 1, foraDoPgcc: 2, comCodTrib: 1, semCodTrib: 6, perApur: '2026-07', competenciaDoTitulo: '2026-07' });
        // Retificadora: NEGATIVA no balancete → natureza CREDORA, valor absoluto.
        expect(ev.xml).toContain('<cCta>131901</cCta><natSaldoInic>C</natSaldoInic><vSaldoInic>300.00</vSaldoInic><vMovDebt>0.00</vMovDebt><vMovCred>50.00</vMovCred><natSaldoFinal>C</natSaldoFinal><vSaldoFinal>350.00</vSaldoFinal><vApur>0.00</vApur>');
        // Conta COM codTrib: vApur = movimento na natureza da conta (devedora → débitos), natVApur D.
        expect(ev.xml).toContain('<cCta>1211901</cCta><natSaldoInic>D</natSaldoInic><vSaldoInic>1000.00</vSaldoInic><vMovDebt>500.00</vMovDebt><vMovCred>200.00</vMovCred><natSaldoFinal>D</natSaldoFinal><vSaldoFinal>1300.00</vSaldoFinal><natVApur>D</natVApur><vApur>500.00</vApur>');
        expect(ev.xml).not.toContain('<cCta>1</cCta>');
        expect(ev.xml).not.toContain('<cCta>191</cCta>');
        expect(ev.xml).not.toContain('<cCta>691901</cCta>');
        expect(ev.avisos.join(' ')).toMatch(/1 linha\(s\) SINTÉTICA\(S\)/);
        expect(ev.avisos.join(' ')).toMatch(/2 linha\(s\) de conta que ficou FORA do PGCC/);
        expect(ev.avisos.join(' ')).toMatch(/ANTERIOR à 1ª competência da DeRE \(2026-10\) — serve como TESTE/);
        const c = conferirXmlContraXsd(ev.xml!, XSD_BAL);
        expect(c.erros).toEqual([]);
        expect(c.ok).toBe(true);
    });
    it('CONFERIR_SALDO_INICIAL: receita com saldo inicial ≠ 0 em julho RECUSA mensal, trimestral, semestral e bimestral — e diz as compatíveis', () => {
        for (const f of ['M', 'T', 'S', 'B']) {
            const ev = montarEventoD1101({ ...base, freqEncerr: f }, { data: DATA });
            expect(ev.ok).toBe(false);
            // 311.901 (receita), 411.901 e 411.902 (despesas) chegam a julho com saldo inicial ≠ 0.
            expect(ev.pendencias.join(' ')).toMatch(/3 conta\(s\) de RESULTADO com saldo inicial ≠ 0,00 em 2026-07/);
            expect(ev.pendencias.join(' ')).toMatch(/Frequências compatíveis com este balancete: A Anual, Q Quadrimestral\./);
        }
        expect(montarEventoD1101({ ...base, freqEncerr: 'Q' }, { data: DATA }).ok).toBe(true);
    });
    it('conta do balancete que NÃO está no plano é recusa (MS1118); balancete de outro mês também; competência futura também', () => {
        const outro = lerBalancete([...BALANCETE_FICTICIO, ['999.901', 'Conta que não existe', 1, 0, 0, 1]]);
        const ev = montarEventoD1101({ ...base, balancete: outro, freqEncerr: 'A' }, { data: DATA });
        expect(ev.ok).toBe(false);
        expect(ev.pendencias.join(' ')).toMatch(/1 conta\(s\) do balancete NÃO estão no plano de contas \(CCTA_NO_PGCC, MS1118\): 999.901/);
        const mesErrado = montarEventoD1101({ ...base, perApur: '2026-08', freqEncerr: 'A' }, { data: DATA });
        expect(mesErrado.pendencias.join(' ')).toMatch(/título do balancete diz 2026-07 e a competência pedida é 2026-08/);
        const futuro = montarEventoD1101({ ...base, balancete: { ...bal, competencia: null }, perApur: '2027-01', freqEncerr: 'A' }, { data: DATA });
        expect(futuro.pendencias.join(' ')).toMatch(/FUTURA — REJEITAR_PERAPUR_FUTURO/);
    });
    it('aritmética torta (saldo final ≠ inicial ± movimento pela raiz) é recusa — a planilha está errada ou o sinal segue outra convenção', () => {
        const torto = lerBalancete(BALANCETE_FICTICIO.map((r) => (r[0] === '211.901' ? ['211.901', r[1], 800, 100, 300, 900] : r)));
        const ev = montarEventoD1101({ ...base, balancete: torto, freqEncerr: 'A' }, { data: DATA });
        expect(ev.ok).toBe(false);
        expect(ev.pendencias.join(' ')).toMatch(/1 conta\(s\) em que saldo final ≠ saldo inicial ± movimento/);
    });
    it('o conferidor pega o XML torto do balancete (natVApur sem vApur > 0 fora de ordem; valor sem decimais)', () => {
        const ev = montarEventoD1101({ ...base, freqEncerr: 'A' }, { data: DATA });
        expect(conferirXmlContraXsd(ev.xml!.replace('<vSaldoInic>300.00</vSaldoInic>', '<vSaldoInic>300</vSaldoInic>'), XSD_BAL).ok).toBe(false);
        expect(conferirXmlContraXsd(ev.xml!.replace('<natVApur>D</natVApur><vApur>500.00</vApur>', '<vApur>500.00</vApur><natVApur>D</natVApur>'), XSD_BAL).ok).toBe(false);
    });
    it('formatarValorDere: absoluto, 2 casas pela NBR 5891 (empate para o PAR), no padrão do XSD', () => {
        expect(formatarValorDere(-350)).toBe('350.00');
        expect(formatarValorDere(0)).toBe('0.00');
        expect(formatarValorDere(18.245)).toBe('18.24');
        expect(formatarValorDere(18.235)).toBe('18.24');
        expect(formatarValorDere(1234567890123456)).toBeNull();
    });
});
