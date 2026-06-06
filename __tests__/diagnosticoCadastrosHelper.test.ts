/**
 * Testes do verificador de cadastros incompletos das empresas.
 * Errar aqui = bloquear geração SPED ou cálculo DAS sem aviso claro.
 */
// @ts-expect-error — módulo .js puro
import { pendenciasCadastro, gravidadeCadastro } from '../sefaz-backend/diagnostico-cadastros-helper.js';

describe('pendenciasCadastro — campos críticos', () => {
    it('empresa SIMPLES completa → zero pendências', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190',
            nome: 'Acme',
            anexo: 'III',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3550308', cnae: '6201500' },
        }, 'simples');
        expect(r).toHaveLength(0);
    });

    it('empresa LUCRO completa → zero pendências', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190',
            nome: 'Acme',
            tipoTributacao: 'presumido',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' },
        }, 'lucro');
        expect(r).toHaveLength(0);
    });

    it('CNPJ inválido → pendência com impacto "TUDO"', () => {
        const r = pendenciasCadastro({ cnpj: '123', nome: 'X', dadosFiscais: { uf: 'SP', codMunIBGE: '1' } }, 'simples');
        const cnpj = r.find((p: any) => p.campo === 'cnpj');
        expect(cnpj).toBeTruthy();
        expect(cnpj.impacto).toMatch(/TUDO/);
    });

    it('CNPJ ausente → pendência', () => {
        const r = pendenciasCadastro({ nome: 'X', dadosFiscais: { uf: 'SP', codMunIBGE: '1' } }, 'simples');
        expect(r.find((p: any) => p.campo === 'cnpj')).toBeTruthy();
    });

    it('sem UF → pendência crítica (SPED não gera)', () => {
        const r = pendenciasCadastro({ cnpj: '12345678000190', dadosFiscais: { codMunIBGE: '1' } }, 'simples');
        const uf = r.find((p: any) => p.campo === 'dadosFiscais.uf');
        expect(uf).toBeTruthy();
        expect(uf.impacto).toMatch(/SPED/);
    });

    it('sem codMunIBGE → pendência crítica', () => {
        const r = pendenciasCadastro({ cnpj: '12345678000190', dadosFiscais: { uf: 'SP' } }, 'simples');
        expect(r.find((p: any) => p.campo === 'dadosFiscais.codMunIBGE')).toBeTruthy();
    });

    it('Simples sem anexo → pendência', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190', nome: 'X',
            dadosFiscais: { uf: 'SP', codMunIBGE: '1' },
        }, 'simples');
        expect(r.find((p: any) => p.campo === 'anexo')).toBeTruthy();
    });

    it('Lucro NÃO exige anexo (mas exige tipoTributacao)', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190', nome: 'X',
            dadosFiscais: { uf: 'SP', codMunIBGE: '1' },
        }, 'lucro');
        expect(r.find((p: any) => p.campo === 'anexo')).toBeFalsy();
        expect(r.find((p: any) => p.campo === 'tipoTributacao')).toBeTruthy();
    });

    it('empresa null/undefined → array vazio (defensivo)', () => {
        expect(pendenciasCadastro(null, 'simples')).toEqual([]);
        expect(pendenciasCadastro(undefined, 'lucro')).toEqual([]);
    });
});

describe('gravidadeCadastro — classificação', () => {
    it('sem pendências → ok', () => {
        expect(gravidadeCadastro([])).toBe('ok');
    });

    it('cnpj inválido → crítico (qualquer outra pendência junto)', () => {
        const g = gravidadeCadastro([{ campo: 'cnpj', descricao: 'x', impacto: 'y' }]);
        expect(g).toBe('critico');
    });

    it('faltando UF → crítico', () => {
        const g = gravidadeCadastro([{ campo: 'dadosFiscais.uf', descricao: 'x', impacto: 'y' }]);
        expect(g).toBe('critico');
    });

    it('faltando codMunIBGE → crítico', () => {
        expect(gravidadeCadastro([{ campo: 'dadosFiscais.codMunIBGE', descricao: 'x', impacto: 'y' }])).toBe('critico');
    });

    it('faltando anexo (Simples) → alto', () => {
        expect(gravidadeCadastro([{ campo: 'anexo', descricao: 'x', impacto: 'y' }])).toBe('alto');
    });

    it('faltando tipoTributacao (Lucro) → alto', () => {
        expect(gravidadeCadastro([{ campo: 'tipoTributacao', descricao: 'x', impacto: 'y' }])).toBe('alto');
    });

    it('só faltando CNAE → médio', () => {
        expect(gravidadeCadastro([{ campo: 'cnae', descricao: 'x', impacto: 'y' }])).toBe('medio');
    });

    it('só faltando nome → médio', () => {
        expect(gravidadeCadastro([{ campo: 'nome', descricao: 'x', impacto: 'y' }])).toBe('medio');
    });

    it('múltiplas pendências — pior dominante', () => {
        const g = gravidadeCadastro([
            { campo: 'nome', descricao: 'x', impacto: 'y' },
            { campo: 'dadosFiscais.uf', descricao: 'x', impacto: 'y' },
            { campo: 'cnae', descricao: 'x', impacto: 'y' },
        ]);
        expect(g).toBe('critico');
    });
});
