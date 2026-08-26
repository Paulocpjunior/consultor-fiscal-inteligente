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

    // 🚨 A FIXTURE MUDOU EM 26/08 e a TROCA É O CERTO: ela usava
    // `tipoTributacao`, um campo que **não existe em lugar nenhum do app** —
    // nenhuma tela grava, nenhum gerador lê, nenhum importador preenche. Ele
    // aparecia em DOIS lugares no repo inteiro: no helper, que o exigia, e
    // aqui, descrevendo a exigência. O teste descrevia um mundo que a produção
    // não vive, e como ninguém o preenche a pendência nascia em 100% das
    // empresas do Lucro (236 em ALTO no painel do Paulo).
    // O que a tela DE FATO grava é `dadosFiscais.regimeTributario` (18/08).
    it('empresa LUCRO completa → zero pendências', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190',
            nome: 'Acme',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3550308', regimeTributario: 'LUCRO_PRESUMIDO' },
        }, 'lucro');
        expect(r).toHaveLength(0);
    });

    // 🚨 O CASO DO PRINT: A CASTELLANO, com "Lucro Presumido" escolhido no
    // modal, aparecia em ALTO dizendo "Tipo (Presumido/Real) não definido".
    it('regime escolhido no modal APAGA a pendência — o caso A CASTELLANO', () => {
        const r = pendenciasCadastro({
            cnpj: '51227692000146', nome: 'A CASTELLANO INDUSTRIA METALURGICA LTDA',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3509502', regimeTributario: 'LUCRO_PRESUMIDO' },
        }, 'lucro');
        expect(r).toHaveLength(0);
        expect(gravidadeCadastro(r)).toBe('ok');
    });

    // ⚠️ A precedência é a do DONO: `regimePadrao` também define a apuração, e
    // exigir o campo novo de quem já tem o antigo seria pedir trabalho por um
    // dado que o app já tem.
    it('`regimePadrao` na ficha também resolve', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190', nome: 'X', regimePadrao: 'lucro_real',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' },
        }, 'lucro');
        expect(r).toHaveLength(0);
    });

    // ⚠️ E IMUNE/ISENTA não são "regime indefinido": são regimes próprios
    // (18/08, o caso da igreja que aparecia como Lucro Presumido).
    it('entidade IMUNE não vira pendência de regime', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190', nome: 'IGREJA',
            dadosFiscais: { uf: 'SP', codMunIBGE: '3550308', regimeTributario: 'IMUNE' },
        }, 'lucro');
        expect(r.find((p: any) => p.campo.endsWith('regimeTributario'))).toBeFalsy();
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

    it('Lucro NÃO exige anexo (mas exige o regime, quando ele falta de verdade)', () => {
        const r = pendenciasCadastro({
            cnpj: '12345678000190', nome: 'X',
            dadosFiscais: { uf: 'SP', codMunIBGE: '1' },
        }, 'lucro');
        expect(r.find((p: any) => p.campo === 'anexo')).toBeFalsy();
        const reg = r.find((p: any) => p.campo === 'dadosFiscais.regimeTributario');
        expect(reg).toBeTruthy();
        // 📌 E ela APONTA O LUGAR — pendência sem caminho de resolução foi
        // exatamente o defeito que este PR fecha.
        expect(reg.descricao).toMatch(/Dados Fiscais/);
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

    it('faltando o regime (Lucro) → alto', () => {
        expect(gravidadeCadastro([{ campo: 'dadosFiscais.regimeTributario', descricao: 'x', impacto: 'y' }]))
            .toBe('alto');
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
