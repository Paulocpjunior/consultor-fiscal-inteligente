/**
 * 📗 A CST DE PIS/COFINS DA AQUISIÇÃO TEM DONO (28/09, ELS 08/2026).
 *
 * PVA: 30 recusas "CST 50–56 para participante pessoa física" e 80 avisos
 * "CST 50–56 em produto a alíquota zero". O gerador carimbava 50 em toda
 * compra do não-cumulativo.
 *
 * Fatos cobrados: cumulativo → 70; pessoa física → 70 (lei, antes do
 * cadastro); cadastro NCM decide CST e natureza (prefixo, vigência); padrão →
 * 50/01 (mercadoria) e 50/03 (serviço), como antes; o cadastro só aceita
 * códigos das Tabelas 4.3.4 e 4.3.7; o resumo nomeia NCM e valor.
 */
// @ts-expect-error módulo .js puro sem tipos
import { cstDaAquisicao, cstGeraCredito, ehPessoaFisica, criarResumoDaCstDeEntrada, NAT_BC_CRED, CST_ENTRADA_VALIDOS } from '../sefaz-backend/cst-pis-cofins-entrada.js';
import { validarParametroNcm, resolverParametrosNcm } from '../sefaz-backend/ncm-parametros.js';

const PJ = '49167213000100';
const PF = '10985437693';
const catalogo = [
    { ncm: '08039000', cstPisCofinsEntrada: '73' },                       // banana: alíquota zero
    { ncm: '2710', cstPisCofinsEntrada: '70' },                           // combustíveis pelo prefixo
    { ncm: '84212300', cstPisCofinsEntrada: '50', natBcCred: '02' },      // filtro: insumo
    { ncm: '31021010', cstPisCofinsEntrada: '73', vigenciaInicio: '2026-09-01' }, // vige só a partir de setembro
];

describe('cstDaAquisicao — os degraus da régua', () => {
    it('cumulativo → 70, sem crédito, qualquer que seja o resto', () => {
        expect(cstDaAquisicao({ regimeApuracao: '2', codPart: PJ, ncm: '84212300', catalogo })).toMatchObject({ cst: '70', natBcCred: null, fonte: 'cumulativo' });
    });

    it('pessoa física → 70 ANTES do cadastro (a lei vence o cadastro)', () => {
        const d = cstDaAquisicao({ regimeApuracao: '1', codPart: PF, ncm: '84212300', catalogo });
        expect(d).toMatchObject({ cst: '70', natBcCred: null, fonte: 'pessoa-fisica' });
        expect(d.motivo).toMatch(/10\.637/);
        expect(ehPessoaFisica('109.854.376-93')).toBe(true);
        expect(ehPessoaFisica(PJ)).toBe(false);
    });

    it('cadastro NCM decide: 73 tira o crédito; 50 + natureza 02 qualifica; prefixo casa; vigência manda', () => {
        expect(cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ncm: '08039000', catalogo })).toMatchObject({ cst: '73', natBcCred: null, fonte: 'cadastro-ncm', ncmCadastrado: '08039000' });
        expect(cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ncm: '27101921', catalogo })).toMatchObject({ cst: '70', fonte: 'cadastro-ncm', ncmCadastrado: '2710' });
        expect(cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ncm: '84212300', catalogo })).toMatchObject({ cst: '50', natBcCred: '02', fonte: 'cadastro-ncm' });
        // fertilizante: em agosto o parâmetro ainda não vige → padrão; em setembro → 73
        expect(cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ncm: '31021010', catalogo, dataRef: '2026-08-10' })).toMatchObject({ cst: '50', fonte: 'padrao' });
        expect(cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ncm: '31021010', catalogo, dataRef: '2026-09-10' })).toMatchObject({ cst: '73', fonte: 'cadastro-ncm' });
    });

    it('padrão (o de antes): mercadoria 50 com natureza 01; serviço 50 com natureza 03', () => {
        expect(cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ncm: '99999999', catalogo })).toMatchObject({ cst: '50', natBcCred: '01', fonte: 'padrao' });
        expect(cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, catalogo: [] })).toMatchObject({ cst: '50', natBcCred: '01', fonte: 'padrao' });
        expect(cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ehServico: true, catalogo })).toMatchObject({ cst: '50', natBcCred: '03', fonte: 'padrao' });
        // sem ctx nenhum (chamador antigo) responde como sempre
        expect(cstDaAquisicao({ regimeApuracao: '1' })).toMatchObject({ cst: '50', fonte: 'padrao' });
        expect(cstDaAquisicao({ regimeApuracao: '2' })).toMatchObject({ cst: '70', fonte: 'cumulativo' });
    });

    it('cstGeraCredito: 50–66 sim; 70–75, 98, 99 não; as tabelas têm os códigos do Guia', () => {
        for (const c of ['50', '56', '60', '66']) expect(cstGeraCredito(c)).toBe(true);
        for (const c of ['70', '73', '75', '98', '99', '01']) expect(cstGeraCredito(c)).toBe(false);
        expect(CST_ENTRADA_VALIDOS).toContain('73');
        expect(Object.keys(NAT_BC_CRED)).toHaveLength(18);
        expect(NAT_BC_CRED['01']).toMatch(/revenda/i);
        expect(NAT_BC_CRED['03']).toMatch(/serviços/i);
    });
});

describe('o cadastro NCM aceita só a Tabela 4.3.4 e a 4.3.7', () => {
    it('valida e devolve os dois campos; natureza sem CST de crédito é recusada', () => {
        expect(validarParametroNcm({ ncm: '08039000', cstPisCofinsEntrada: '73' })).toMatchObject({ ok: true, cstPisCofinsEntrada: '73', natBcCred: null });
        expect(validarParametroNcm({ ncm: '84212300', cstPisCofinsEntrada: '50', natBcCred: '02' })).toMatchObject({ ok: true, cstPisCofinsEntrada: '50', natBcCred: '02' });
        expect(validarParametroNcm({ ncm: '08039000', cstPisCofinsEntrada: '01' }).ok).toBe(false);
        expect(validarParametroNcm({ ncm: '08039000', natBcCred: '19' }).ok).toBe(false);
        expect(validarParametroNcm({ ncm: '08039000', cstPisCofinsEntrada: '73', natBcCred: '01' }).ok).toBe(false);
        expect(validarParametroNcm({ ncm: '08039000' })).toMatchObject({ ok: true, cstPisCofinsEntrada: null, natBcCred: null });
    });

    it('resolverParametrosNcm carrega os dois campos (e null quando não há)', () => {
        expect(resolverParametrosNcm('08039000', catalogo)).toMatchObject({ achou: true, cstPisCofinsEntrada: '73', natBcCred: null });
        expect(resolverParametrosNcm('84212300', catalogo)).toMatchObject({ achou: true, cstPisCofinsEntrada: '50', natBcCred: '02' });
        expect(resolverParametrosNcm('12345678', catalogo)).toMatchObject({ achou: false, cstPisCofinsEntrada: null });
    });
});

describe('o resumo da geração nomeia a origem de cada decisão', () => {
    it('pessoa física, cadastro aplicado e NCM no padrão, com contagem e valor', () => {
        const r = criarResumoDaCstDeEntrada();
        r.registrar({ decisao: cstDaAquisicao({ regimeApuracao: '1', codPart: PF }), valor: 100, ncm: '08039000' });
        r.registrar({ decisao: cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ncm: '08039000', catalogo }), valor: 200, ncm: '08039000' });
        r.registrar({ decisao: cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ncm: '99999999', catalogo }), valor: 300, ncm: '99999999', descricao: 'PARAFUSO' });
        r.registrar({ decisao: cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ncm: '99999999', catalogo }), valor: 50, ncm: '99999999' });
        r.registrar({ decisao: cstDaAquisicao({ regimeApuracao: '1', codPart: PJ, ehServico: true }), valor: 40 });
        const avisos: string[] = r.avisos();
        expect(avisos.find((a) => /PESSOA FÍSICA/.test(a))).toMatch(/1 item\(ns\)[^.]*100\.00/);
        expect(avisos.find((a) => /cadastro NCM aplicado/.test(a))).toMatch(/08039000→73 \(1 item\(ns\), 200\.00\)/);
        const pad = avisos.find((a) => /PADRÃO 50/.test(a))!;
        expect(pad).toMatch(/1 NCM/);
        expect(pad).toMatch(/99999999 PARAFUSO \(2, 350\.00\)/);
        expect(pad).toMatch(/Cadastro NCM/);
        // serviço no padrão não vira "NCM sem cadastro"
        expect(pad).not.toMatch(/sem NCM/);
    });

    it('sem decisão nenhuma, nenhum aviso', () => {
        expect(criarResumoDaCstDeEntrada().avisos()).toEqual([]);
    });
});
