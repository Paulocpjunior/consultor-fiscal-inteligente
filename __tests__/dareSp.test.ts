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
