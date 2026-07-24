/**
 * DARE-SP (ICMS) — testes contra os TRÊS DAREs REAIS emitidos pelo escritório
 * (prints do Paulo, 24/07/2026). "Não pode haver erros": cada código/descrição
 * aqui foi conferido no documento oficial, não chutado.
 */
// @ts-expect-error — módulo .js puro
import { CODIGOS_DARE_ICMS, montarDare, normalizarReferencia, derivacoesDisponiveis, PORTAL_DARE_URL } from '../sefaz-backend/dare-sp.js';

describe('CODIGOS_DARE_ICMS — conferidos nos DAREs reais', () => {
    it('WALDESA: ICMS próprio RPA = serviço 04601, receita 046-2, SEFAZ-404601', () => {
        const c = CODIGOS_DARE_ICMS['04601'];
        expect(c.codigoReceita).toBe('046-2');
        expect(c.sefaz).toBe('SEFAZ-404601');
        expect(c.derivacao).toBe('proprio');
        expect(c.descricao).toMatch(/Operações Próprias/);
    });

    it('FLANACAR: ICMS-ST RPA = serviço 14601, receita 146-6, SEFAZ-414601', () => {
        const c = CODIGOS_DARE_ICMS['14601'];
        expect(c.codigoReceita).toBe('146-6');
        expect(c.sefaz).toBe('SEFAZ-414601');
        expect(c.derivacao).toBe('st');
        expect(c.descricao).toMatch(/Substituição Tributária/);
    });

    it('GS ODONTO: DIFAL Simples = serviço 04602, receita 046-2, SEFAZ-404602', () => {
        const c = CODIGOS_DARE_ICMS['04602'];
        expect(c.codigoReceita).toBe('046-2');
        expect(c.sefaz).toBe('SEFAZ-404602');
        expect(c.derivacao).toBe('difal');
        expect(c.descricao).toMatch(/Diferencial de alíquota/);
    });
});

describe('normalizarReferencia', () => {
    it('aceita MM/AAAA e AAAA-MM; rejeita mês inválido e lixo', () => {
        expect(normalizarReferencia('06/2026')).toBe('06/2026');
        expect(normalizarReferencia('2026-06')).toBe('06/2026');
        expect(normalizarReferencia('13/2026')).toBeNull();
        expect(normalizarReferencia('junho')).toBeNull();
        expect(normalizarReferencia('')).toBeNull();
    });
});

describe('montarDare — caso real FLANACAR (ICMS-ST 06/2026, R$ 146.661,37)', () => {
    const base = {
        cnpj: '96.312.889/0001-11',
        razaoSocial: 'Flanacar Comercio de Auto-pecas Ltda',
        codigoServico: '14601',
        referencia: '2026-06',
        valor: 146661.37,
        vencimento: '2026-07-20',
    };

    it('monta o payload EXATO do documento real', () => {
        const p = montarDare(base);
        expect(p.contribuinte.cnpj).toBe('96312889000111');
        expect(p.codigoReceita).toBe('146-6');
        expect(p.sefaz).toBe('SEFAZ-414601');
        expect(p.referencia).toBe('06/2026');
        expect(p.valor).toBe(146661.37);
        expect(p.vencimento).toBe('2026-07-20');
        expect(p.portalUrl).toBe(PORTAL_DARE_URL);
    });

    it('centavos exatos — sem drift de float', () => {
        expect(montarDare({ ...base, valor: 80.46 }).valor).toBe(80.46);   // GS Odonto
        expect(montarDare({ ...base, valor: 88.64 }).valor).toBe(88.64);   // WALDESA
        expect(montarDare({ ...base, valor: 0.1 + 0.2 }).valor).toBe(0.3);
    });

    it('recusa CNPJ/valor/referência/vencimento/código inválidos com mensagem acionável', () => {
        expect(() => montarDare({ ...base, cnpj: '123' })).toThrow(/CNPJ inválido/);
        expect(() => montarDare({ ...base, valor: 0 })).toThrow(/Valor inválido/);
        expect(() => montarDare({ ...base, valor: -5 })).toThrow(/Valor inválido/);
        expect(() => montarDare({ ...base, referencia: '2026/06' })).toThrow(/Referência inválida/);
        expect(() => montarDare({ ...base, vencimento: '20/07/2026' })).toThrow(/Vencimento inválido/);
        expect(() => montarDare({ ...base, codigoServico: '99999' })).toThrow(/desconhecido.*04601/);
        expect(() => montarDare({ ...base, razaoSocial: ' ' })).toThrow(/Razão social/);
    });
});

describe('derivacoesDisponiveis por regime', () => {
    it('RPA: próprio + ST; Simples: DIFAL', () => {
        expect(derivacoesDisponiveis('rpa').map((c: any) => c.codigoServico).sort()).toEqual(['04601', '14601']);
        expect(derivacoesDisponiveis('simples').map((c: any) => c.codigoServico)).toEqual(['04602']);
        expect(derivacoesDisponiveis('outro')).toEqual([]);
    });
});

// @ts-expect-error — módulo .js puro
import { extrairEstrutura, PAGINAS_DARE } from '../sefaz-backend/dare-recon.js';

describe('dare-recon: extrairEstrutura (parser puro do reconhecimento)', () => {
    const HTML = `
      <form action="/DareICMS/DareAvulso" method="post" id="frmDare">
        <input name="__RequestVerificationToken" type="hidden" value="tok" />
        <input name="Cnpj" type="text" />
        <input name="RazaoSocial" type="text" />
        <input name="btnConsultar" type="submit" value="Consultar" />
        <select name="TipoDebito">
          <option value="">Selecione</option>
          <option value="04601">ICMS- Operações Próprias- RPA (04601)</option>
          <option value="14601">ICMS- Substituição Tributária- RPA (14601)</option>
        </select>
        <a href="/DareICMS/docs/leiaute-gnre.pdf">Leiaute</a>
      </form>`;

    it('extrai form, inputs (sem submit), select com options, token e link de layout', () => {
        const e = extrairEstrutura(HTML);
        expect(e.forms).toEqual([{ action: '/DareICMS/DareAvulso', method: 'POST', id: 'frmDare' }]);
        expect(e.inputs).toEqual([{ name: 'Cnpj', type: 'text' }, { name: 'RazaoSocial', type: 'text' }]);
        expect(e.tokens).toEqual(['__RequestVerificationToken']);
        expect(e.selects[0].name).toBe('TipoDebito');
        expect(e.selects[0].options).toContainEqual({ value: '04601', label: 'ICMS- Operações Próprias- RPA (04601)' });
        expect(e.linksLayout).toEqual(['/DareICMS/docs/leiaute-gnre.pdf']);
        expect(e.captcha).toBe(false);
    });

    it('detecta captcha e não quebra com HTML vazio', () => {
        expect(extrairEstrutura('<div class="g-recaptcha"></div>').captcha).toBe(true);
        expect(extrairEstrutura('').forms).toEqual([]);
    });

    it('páginas-alvo: avulso, lote e gnre-lote (as 3 do menu do portal)', () => {
        expect(PAGINAS_DARE.map((p: any) => p.id).sort()).toEqual(['avulso', 'gnre-lote', 'lote']);
    });
});

// @ts-expect-error — módulo .js puro
import { CONVERSAO_GNRE_DARE_SP, codigoGnreParaDareSp } from '../sefaz-backend/dare-sp.js';

describe('Conversão GNRE→DARE-SP (tabela oficial do portal GnreLote, 24/07/2026)', () => {
    it('as 8 receitas da tabela oficial, verbatim', () => {
        expect(CONVERSAO_GNRE_DARE_SP['10001-3'].dareSp).toBe('113-2');
        expect(CONVERSAO_GNRE_DARE_SP['10002-1'].dareSp).toBe('116-8');
        expect(CONVERSAO_GNRE_DARE_SP['10003-0'].dareSp).toBe('111-9');
        expect(CONVERSAO_GNRE_DARE_SP['10004-8'].dareSp).toBe('246-0');
        expect(CONVERSAO_GNRE_DARE_SP['10008-0'].dareSp).toBe('119-3');
        expect(CONVERSAO_GNRE_DARE_SP['10009-9'].dareSp).toBe('247-1');
        expect(CONVERSAO_GNRE_DARE_SP['10010-2'].dareSp).toBe('101-6');
        expect(CONVERSAO_GNRE_DARE_SP['10011-0'].dareSp).toBe('102-8');
        expect(Object.keys(CONVERSAO_GNRE_DARE_SP)).toHaveLength(8);
    });

    it('DESCOBERTA que evitou guia errada: RPA 046-2 e 146-6 NÃO são emissíveis pelo lote GNRE', () => {
        expect(codigoGnreParaDareSp('046-2')).toBeNull();
        expect(codigoGnreParaDareSp('146-6')).toBeNull();
    });

    it('lookup reverso funciona pras receitas cobertas', () => {
        expect(codigoGnreParaDareSp('247-1')).toBe('10009-9');
        expect(codigoGnreParaDareSp('102-8')).toBe('10011-0');
    });
});

// @ts-expect-error — módulo .js puro
import { montarLinhaLoteTxt, montarLoteTxt, SERVICOS_BLOQUEADOS_LOTE, MAX_DOCS_LOTE_DARE } from '../sefaz-backend/dare-sp.js';

describe('Dare em Lote (TXT) — formato oficial da página DareLote (24/07/2026)', () => {
    it('replica o formato do exemplo oficial: CNPJ;servico;MM/AAAA;DD/MM/AAAA;valor;1', () => {
        // Exemplo oficial: 18857209000131;06301;03/2022;30/04/2022;1000.99;1
        // (usamos serviço da nossa tabela — 04601 — com os mesmos demais campos)
        const linha = montarLinhaLoteTxt({
            cnpj: '18.857.209/0001-31', razaoSocial: 'Teste', codigoServico: '04601',
            referencia: '2022-03', valor: 1000.99, vencimento: '2022-04-30',
        });
        expect(linha).toBe('18857209000131;04601;03/2022;30/04/2022;1000.99;1');
    });

    it('caso real WALDESA 06/2026: linha pronta pro portal', () => {
        const linha = montarLinhaLoteTxt({
            cnpj: '05.049.535/0006-85', razaoSocial: 'Waldesa', codigoServico: '04601',
            referencia: '2026-06', valor: 88.64, vencimento: '2026-07-20',
        });
        expect(linha).toBe('05049535000685;04601;06/2026;20/07/2026;88.64;1');
    });

    it('valor inteiro sai com 2 casas e PONTO (regra da página)', () => {
        const linha = montarLinhaLoteTxt({
            cnpj: '18857209000131', razaoSocial: 'T', codigoServico: '04601',
            referencia: '03/2022', valor: 1000, vencimento: '2022-04-30',
        });
        expect(linha).toContain(';1000.00;1');
        expect(linha).not.toContain(',');
        expect(linha).not.toContain(' ');
    });

    it('serviços proibidos em lote (06305/08101/1044/89202) são recusados', () => {
        for (const svc of SERVICOS_BLOQUEADOS_LOTE) {
            expect(() => montarLinhaLoteTxt({
                cnpj: '18857209000131', razaoSocial: 'T', codigoServico: svc,
                referencia: '03/2022', valor: 10, vencimento: '2022-04-30',
            })).toThrow(/não pode ser emitido em lote/);
        }
    });

    it('lote: junta linhas, soma total em centavos exatos, aborta inteiro se 1 item inválido', () => {
        const base = { razaoSocial: 'T', codigoServico: '04601', referencia: '06/2026', vencimento: '2026-07-20' };
        const r = montarLoteTxt([
            { ...base, cnpj: '05049535000685', valor: 88.64 },
            { ...base, cnpj: '96312889000111', codigoServico: '14601', valor: 146661.37 },
        ]);
        expect(r.linhas).toHaveLength(2);
        expect(r.texto.split('\n')).toHaveLength(2);
        expect(r.totalValor).toBe(146750.01);
        expect(() => montarLoteTxt([
            { ...base, cnpj: '05049535000685', valor: 88.64 },
            { ...base, cnpj: '123', valor: 10 }, // CNPJ inválido → aborta TUDO
        ])).toThrow(/Item 2.*CNPJ inválido/);
    });

    it('lote vazio e lote >50 são recusados com mensagem acionável', () => {
        expect(() => montarLoteTxt([])).toThrow(/Lote vazio/);
        const muitos = Array.from({ length: MAX_DOCS_LOTE_DARE + 1 }, () => ({
            cnpj: '18857209000131', razaoSocial: 'T', codigoServico: '04601',
            referencia: '06/2026', valor: 10, vencimento: '2026-07-20',
        }));
        expect(() => montarLoteTxt(muitos)).toThrow(/máximo 50/);
    });
});
