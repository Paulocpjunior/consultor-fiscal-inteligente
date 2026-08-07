// ============================================================================
// Cadastro central — o túnel que faz o CFI ser dono do cadastro.
//
// O que motivou: a colaboradora tentou apurar o R-4020 e o app respondeu "CNPJ
// não cadastrado" para empresa cadastrada. O mesmo cliente vive em três apps
// com grafias próprias, e cadastro duplicado não fica igual — fica PARECIDO,
// que é pior, porque ninguém desconfia.
// ============================================================================
// @ts-expect-error módulo JS puro sem tipos
import { normalizarEmpresaCadastro, montarCadastroEmpresas } from '../sefaz-backend/cadastro-central.js';

const simples = (over: any = {}) => ({
    id: 's1', cnpj: '51.227.692/0001-46', razaoSocial: 'CLIENTE FORMATADO',
    dadosFiscais: { codCliente: '1234', uf: 'SP', codMunIBGE: '3550308', ccmSp: '5.694.375-0' },
    ...over,
});

describe('o CNPJ sai SEMPRE em dígitos', () => {
    test('cadastro formatado é normalizado na saída', () => {
        const e = normalizarEmpresaCadastro(simples(), 'simples');
        expect(e.cnpj).toBe('51227692000146');
        expect(e.raiz).toBe('51227692');
    });

    test('cadastro já em dígitos passa igual', () => {
        const e = normalizarEmpresaCadastro({ id: 'x', cnpj: '11222333000181' }, 'lucro');
        expect(e.cnpj).toBe('11222333000181');
    });

    test('CNPJ inválido não vira empresa — nem com nome bonito', () => {
        expect(normalizarEmpresaCadastro({ id: 'x', cnpj: '123', nome: 'FULANO' }, 'simples')).toBeNull();
    });
});

describe('cada campo é lido nos DOIS lugares onde pode viver', () => {
    test('o TOPO vence, dadosFiscais é o fallback — mesma ordem do camposConferencia', () => {
        // Não é arbitrário: o topo é o ESPELHO que a apuração e o DAS leem, e o
        // modal Dados Fiscais grava nos dois (regra do #382). Inverter aqui
        // faria o cadastro central discordar da tela de perfil sobre o mesmo
        // cliente — exatamente o tipo de divergência que este túnel existe pra
        // acabar.
        const e = normalizarEmpresaCadastro(
            { id: 'a', cnpj: '11222333000181', cnae: '6911701', dadosFiscais: { cnae: '4711302' } },
            'simples',
        );
        expect(e.cnae).toBe('6911701');
        const soDf = normalizarEmpresaCadastro(
            { id: 'b', cnpj: '11222333000181', dadosFiscais: { cnae: '4711302' } }, 'simples',
        );
        expect(soDf.cnae).toBe('4711302');
    });

    test('o nome tem três origens possíveis', () => {
        expect(normalizarEmpresaCadastro({ id: '1', cnpj: '11222333000181', fantasia: 'FANTASIA' }, 'simples').nome)
            .toBe('FANTASIA');
        expect(normalizarEmpresaCadastro({ id: '1', cnpj: '11222333000181', nome: 'NOME', fantasia: 'F' }, 'simples').nome)
            .toBe('NOME');
    });

    test('CCM sai em dígitos, e vazio continua vazio (é resposta válida)', () => {
        expect(normalizarEmpresaCadastro(simples(), 'simples').ccmSp).toBe('56943750');
        expect(normalizarEmpresaCadastro({ id: 'z', cnpj: '11222333000181' }, 'simples').ccmSp).toBeNull();
    });

    test('as marcações que decidem obrigação viajam', () => {
        const e = normalizarEmpresaCadastro(
            { id: 'r', cnpj: '11222333000181', dadosFiscais: { condicaoRural: { adquireDeProdutor: true } } },
            'simples',
        );
        expect(e.adquireDeProdutor).toBe(true);
        expect(e.ehProdutorRuralPF).toBe(false);
    });
});

describe('o cadastro inteiro', () => {
    const fontes = () => ([
        { regime: 'simples', docs: [simples(), simples({ id: 's2', cnpj: '11222333000181', razaoSocial: 'ALFA' })] },
        { regime: 'lucro', docs: [{ id: 'l1', cnpj: '99888777000155', razaoSocial: 'ZETA' }] },
    ]);

    test('junta as coleções e ordena por nome', () => {
        const r = montarCadastroEmpresas(fontes());
        expect(r.empresas.map((e: any) => e.nome)).toEqual(['ALFA', 'CLIENTE FORMATADO', 'ZETA']);
        expect(r.resumo).toMatchObject({ total: 3, simples: 2, lucro: 1 });
    });

    test('lápide e fusão ficam de fora', () => {
        const r = montarCadastroEmpresas([{ regime: 'simples', docs: [
            simples(),
            { id: 'd', cnpj: '11222333000181', _deleted: true },
            { id: 'm', cnpj: '99888777000155', _merged_into: 'x' },
        ] }]);
        expect(r.resumo.total).toBe(1);
    });

    test('DUPLICATA não some — vem na resposta', () => {
        // Esconder faria o outro app achar que o cadastro está limpo quando não
        // está, e é justamente a duplicata que produz "cadastrado lá, não aqui".
        const r = montarCadastroEmpresas([{ regime: 'simples', docs: [
            simples(), simples({ id: 's9', razaoSocial: 'MESMA EMPRESA OUTRO DOC' }),
        ] }]);
        expect(r.resumo.total).toBe(1);
        expect(r.resumo.duplicadas).toBe(1);
        expect(r.duplicadas[0].cnpj).toBe('51227692000146');
        expect(r.avisos.join(' ')).toMatch(/esconder faria o outro app/i);
    });

    test('cadastro sem CNPJ é CONTADO, não engolido', () => {
        // É exatamente o que faz alguém procurar um cliente que "existe" e não
        // é encontrado.
        const r = montarCadastroEmpresas([{ regime: 'simples', docs: [simples(), { id: 'n', nome: 'SEM CNPJ' }] }]);
        expect(r.resumo.ignoradasSemCnpj).toBe(1);
        expect(r.avisos.join(' ')).toMatch(/sem CNPJ válido/);
    });

    test('cadastro vazio NÃO é "escritório sem clientes"', () => {
        const r = montarCadastroEmpresas([]);
        expect(r.avisos.join(' ')).toMatch(/falha de leitura/);
    });
});

describe('as duas ressalvas fixas do túnel', () => {
    const r = montarCadastroEmpresas([{ regime: 'simples', docs: [simples()] }]);

    test('a normalização do CNPJ é declarada, não implícita', () => {
        expect(r.avisos[0]).toMatch(/SEMPRE em dígitos/);
    });

    test('e o certificado é explicitamente excluído, com o motivo', () => {
        expect(r.avisos[1]).toMatch(/chave privada/);
        expect(r.avisos[1]).toMatch(/assinatura é operação do CFI/);
    });

    test('nenhum campo de certificado vaza na empresa', () => {
        const chaves = Object.keys(r.empresas[0]).join(' ').toLowerCase();
        expect(chaves).not.toMatch(/cert|pfx|senha|password|chave/);
    });
});
