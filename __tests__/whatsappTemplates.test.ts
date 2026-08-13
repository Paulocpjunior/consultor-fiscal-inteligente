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
import { readFileSync } from 'fs';
import { join } from 'path';

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

/**
 * MATA-BURRO: TEMPLATE SEM CABEÇALHO DE DOCUMENTO NÃO LEVA A GUIA.
 *
 * O template aprovado pela Meta em 13/08 (`sp_assessoria_contabil_impostos`)
 * diz "Segue em anexo a Referida Guia de Impostos". Se ele não tiver um
 * cabeçalho do tipo DOCUMENTO, o PDF era descartado em silêncio na rota
 * (`pdfBase64: template.temDocumento ? ... : null`): a mensagem saía com a
 * promessa do anexo, a Meta devolvia messageId e o app registrava PROVA DE
 * ENVIO. Farol verde sobre entrega que não aconteceu — e o cliente do outro
 * lado esperando uma guia que nunca chegou.
 */
describe('a rota recusa PDF em template sem documento', () => {
    const rota = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');

    test('as DUAS direções são checadas, não só a que já existia', () => {
        expect(rota).toMatch(/template\.temDocumento && !p\.pdfBase64/);
        expect(rota).toMatch(/!template\.temDocumento && p\.pdfBase64/);
    });

    test('a recusa DIZ como resolver e o que fazer enquanto isso', () => {
        expect(rota).toMatch(/cabeçalho do tipo DOCUMENTO/);
        expect(rota).toMatch(/Config Admin/);
        expect(rota).toMatch(/mande a guia por e-mail/);
    });

    test('a recusa vem ANTES do envio — descartar o PDF depois é o defeito', () => {
        const posGuarda = rota.indexOf('!template.temDocumento && p.pdfBase64');
        const posEnvio = rota.indexOf('await enviarTemplateWhatsapp(');
        expect(posGuarda).toBeGreaterThan(-1);
        expect(posEnvio).toBeGreaterThan(posGuarda);
    });
});

/**
 * MATA-BURRO: O TEMPLATE DA GUIA VEM DO CADASTRO, NÃO DE UMA LISTA NO CÓDIGO.
 *
 * O envio de guia por WhatsApp (DAS/DARF) mandava QUATRO variáveis posicionais
 * fixas no código — `[cliente, tipo, competência, vencimento]` — enquanto o
 * cadastro por departamento, com schema NOMEADO, era usado só pelos apps
 * irmãos. Duas fontes para o mesmo fato.
 *
 * O template aprovado pela Meta em 13/08 tem TRÊS variáveis. Mandar quatro faz
 * a Meta recusar com 132000/132012 ("número de parâmetros não bate") — e o
 * colaborador lê isso como "o WhatsApp não funciona".
 */
describe('o envio de guia usa o cadastro de templates', () => {
    const rota = readFileSync(join(__dirname, '..', 'sefaz-backend/envio-imposto-routes.js'), 'utf8');

    it('resolve pelo cadastro do departamento fiscal, sem lista posicional no código', () => {
        expect(rota).toMatch(/resolverTemplate\(cadastro, \{ departamento: 'fiscal' \}\)/);
        expect(rota).toMatch(/montarVariaveisPorSchema\(template, \{/);
        // A lista fixa de 4 posições morreu.
        expect(rota).not.toMatch(/variaveis: \[empresaNome/);
        expect(rota).not.toMatch(/enviarGuiaWhatsapp\(/);
    });

    it('as chaves conhecidas cobrem o template aprovado (imposto/competencia/vencimento)', () => {
        // O bloco de variáveis nomeadas — `competencia` entra como shorthand.
        const bloco = rota.slice(rota.indexOf('montarVariaveisPorSchema(template, {'));
        for (const chave of ['cliente', 'imposto', 'competencia', 'vencimento']) {
            expect(bloco.slice(0, 500)).toContain(chave);
        }
    });

    it('variável do schema que este envio não tem RECUSA, nomeando qual falta', () => {
        expect(rota).toMatch(/pede variáveis que este envio não tem/);
        expect(rota).toMatch(/faltando: mv\.faltando/);
    });

    it('template sem cabeçalho de documento também é barrado aqui', () => {
        expect(rota).toMatch(/pdfLimpo && !template\.temDocumento/);
        expect(rota).toMatch(/não seria anexada/);
    });

    it('sem template cadastrado, a recusa manda pro Config Admin', () => {
        expect(rota).toMatch(/Config Admin → Templates/);
    });
});

/**
 * MATA-BURRO: A CHAVE DA VARIÁVEL CASA SEM DEPENDER DE CAIXA NEM DE ACENTO.
 *
 * Caso real 13/08: o template foi cadastrado com "Imposto", "Competencia" e
 * "Vencimento" — maiúscula inicial, como quem preenche um formulário escreve —
 * e o envio manda `imposto`/`competencia`/`vencimento`. O casamento era EXATO,
 * então as três "faltavam" e o WhatsApp recusava sobre um cadastro CERTO.
 *
 * Exigir a grafia exata é exigir julgamento de quem preenche a tela, e a
 * qualificação da equipe é restrição de projeto: quem se ajusta é o código.
 */
describe('chave de variável tolerante a grafia', () => {
    const comChaves = (...chaves: string[]) => ({ variaveis: chaves.map(chave => ({ chave })) });

    test('maiúscula inicial no cadastro casa com minúscula no envio', () => {
        const r = montarVariaveisPorSchema(
            comChaves('Imposto', 'Competencia', 'Vencimento'),
            { imposto: 'DAS', competencia: '07/2026', vencimento: '20/08/2026' },
        );
        expect(r.ok).toBe(true);
        expect(r.variaveis).toEqual(['DAS', '07/2026', '20/08/2026']);
    });

    test('acento no cadastro não quebra o casamento', () => {
        const r = montarVariaveisPorSchema(comChaves('Competência'), { competencia: '07/2026' });
        expect(r.ok).toBe(true);
        expect(r.variaveis).toEqual(['07/2026']);
    });

    test('underscore e caixa alta também casam', () => {
        const r = montarVariaveisPorSchema(comChaves('DATA_VENCIMENTO'), { dataVencimento: '20/08/2026' });
        expect(r.ok).toBe(true);
    });

    // O que NÃO se normaliza é o SIGNIFICADO: chave desconhecida continua
    // faltando, e o nome que aparece é o que foi CADASTRADO (é o que a pessoa
    // procura na tela).
    test('chave de outro significado continua faltando, com o nome do cadastro', () => {
        const r = montarVariaveisPorSchema(comChaves('Protocolo'), { imposto: 'DAS' });
        expect(r.ok).toBe(false);
        expect(r.faltando).toEqual(['Protocolo']);
    });

    test('valor em branco continua faltando — meio preenchido é pior', () => {
        const r = montarVariaveisPorSchema(comChaves('Imposto'), { imposto: '   ' });
        expect(r.ok).toBe(false);
        expect(r.faltando).toEqual(['Imposto']);
    });
});
