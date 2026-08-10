/**
 * Cadastro de templates do WhatsApp por departamento (Paulo, 10/08): a MESMA
 * API da Meta, cada departamento com seu template. O núcleo é o de-para e a
 * trava de variáveis nomeadas → posicionais.
 */
// @ts-nocheck
import {
    validarTemplate, resolverTemplate, montarVariaveisPorSchema, idDoTemplate,
    DEPARTAMENTOS_WHATSAPP,
} from '../sefaz-backend/whatsapp-templates.js';

describe('validarTemplate', () => {
    const bom = {
        departamento: 'fiscal', nome: 'envio_guia_imposto', idioma: 'pt_BR', temDocumento: true,
        variaveis: [{ chave: 'cliente', rotulo: 'Cliente' }, { chave: 'competencia' }],
    };
    test('template válido normaliza e gera id determinístico', () => {
        const v = validarTemplate(bom);
        expect(v.ok).toBe(true);
        expect(v.template.id).toBe(idDoTemplate('fiscal', 'envio_guia_imposto'));
        expect(v.template.variaveis[1].rotulo).toBe('competencia'); // rótulo default = chave
        expect(v.template.ativo).toBe(true);
    });
    test('departamento desconhecido é RECUSADO nomeando as opções', () => {
        const v = validarTemplate({ ...bom, departamento: 'juridico' });
        expect(v.ok).toBe(false);
        expect(v.erros.join(' ')).toMatch(/departamento desconhecido/);
    });
    test('nome fora do padrão da Meta (maiúscula/espaço) é recusado', () => {
        expect(validarTemplate({ ...bom, nome: 'Envio Guia' }).ok).toBe(false);
    });
    test('variável com chave repetida é recusada', () => {
        const v = validarTemplate({ ...bom, variaveis: [{ chave: 'x' }, { chave: 'x' }] });
        expect(v.ok).toBe(false);
        expect(v.erros.join(' ')).toMatch(/repete a chave/);
    });
});

describe('montarVariaveisPorSchema — nomeadas viram posicionais', () => {
    const template = validarTemplate({
        departamento: 'fiscal', nome: 't', variaveis: [{ chave: 'a' }, { chave: 'b' }, { chave: 'c' }],
    }).template;
    test('ordena conforme o schema, ignorando extras', () => {
        const r = montarVariaveisPorSchema(template, { b: '2', a: '1', c: '3', zzz: 'ignorado' });
        expect(r.ok).toBe(true);
        expect(r.variaveis).toEqual(['1', '2', '3']);
    });
    test('variável faltando RECUSA (não manda meio preenchido)', () => {
        const r = montarVariaveisPorSchema(template, { a: '1', c: '3' });
        expect(r.ok).toBe(false);
        expect(r.faltando).toEqual(['b']);
    });
});

describe('resolverTemplate', () => {
    const cad = [
        validarTemplate({ departamento: 'fiscal', nome: 'guia', variaveis: [] }).template,
        validarTemplate({ departamento: 'dp-folha', nome: 'holerite', variaveis: [] }).template,
        validarTemplate({ departamento: 'dp-folha', nome: 'aviso_ferias', variaveis: [] }).template,
    ];
    test('único do departamento resolve sozinho', () => {
        expect(resolverTemplate(cad, { departamento: 'fiscal' }).template.nome).toBe('guia');
    });
    test('vários sem escolha = ambíguo, nomeando as opções', () => {
        const r = resolverTemplate(cad, { departamento: 'dp-folha' });
        expect(r.ok).toBe(false);
        expect(r.opcoes.sort()).toEqual(['aviso_ferias', 'holerite']);
    });
    test('escolha explícita vence', () => {
        expect(resolverTemplate(cad, { departamento: 'dp-folha', templateNome: 'holerite' }).ok).toBe(true);
    });
    test('template inexistente para o departamento recusa', () => {
        expect(resolverTemplate(cad, { departamento: 'fiscal', templateNome: 'holerite' }).ok).toBe(false);
    });
    test('departamento sem nenhum template recusa', () => {
        expect(resolverTemplate(cad, { departamento: 'financeiro' }).ok).toBe(false);
    });
});

test('os 5 departamentos = os 5 apps', () => {
    expect([...DEPARTAMENTOS_WHATSAPP].sort()).toEqual(['contabil', 'dp-folha', 'financeiro', 'fiscal', 'legalizacao']);
});
