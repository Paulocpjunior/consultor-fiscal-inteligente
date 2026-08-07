// ============================================================================
// Achar a empresa pelo CNPJ — a busca que dizia "não cadastrado" para empresa
// cadastrada.
//
// Caso real 07/08: a rota do R-4020 consultava `where('cnpj','==',<dígitos>)`
// e o cadastro guardava `51.227.692/0001-46`. A empresa existia; a consulta é
// que não a via. E a mensagem culpava o cadastro — mandava a pessoa procurar
// um problema que não existia.
// ============================================================================
// @ts-expect-error módulo JS puro sem tipos
import { acharEmpresaPorCnpj, filiaisDaRaiz, soDigitosCnpj } from '../sefaz-backend/empresa-por-cnpj.js';

const base = [
    { id: 'a', cnpj: '51.227.692/0001-46', nome: 'FORMATADA' },
    { id: 'b', cnpj: '11222333000181', nome: 'SÓ DÍGITOS' },
];

describe('as duas formas do CNPJ acham a mesma empresa', () => {
    test('cadastro FORMATADO é achado por consulta com dígitos', () => {
        // Este é o caso que falhava em produção.
        expect(acharEmpresaPorCnpj(base, '51227692000146')?.id).toBe('a');
    });

    test('cadastro em DÍGITOS é achado por consulta formatada', () => {
        expect(acharEmpresaPorCnpj(base, '11.222.333/0001-81')?.id).toBe('b');
    });

    test('as duas pontas formatadas também batem', () => {
        expect(acharEmpresaPorCnpj(base, '51.227.692/0001-46')?.id).toBe('a');
    });
});

describe('o que NÃO deve ser encontrado', () => {
    test('CNPJ que não existe devolve null, não a primeira da lista', () => {
        expect(acharEmpresaPorCnpj(base, '99999999000199')).toBeNull();
    });

    test('CNPJ incompleto não casa por prefixo', () => {
        // Sem esta trava, uma raiz digitada pela metade traria a empresa errada
        // — e o payload da declaração sairia com o CNPJ de outro cliente.
        expect(acharEmpresaPorCnpj(base, '51227692')).toBeNull();
    });

    test('empresa com lápide não é "encontrada"', () => {
        const comLapide = [{ id: 'x', cnpj: '51227692000146', _deleted: true }];
        expect(acharEmpresaPorCnpj(comLapide, '51227692000146')).toBeNull();
    });

    test('empresa fundida também fica de fora — quem responde é a outra', () => {
        const fundida = [{ id: 'y', cnpj: '51227692000146', _merged_into: 'z' }];
        expect(acharEmpresaPorCnpj(fundida, '51227692000146')).toBeNull();
    });

    test('lista vazia ou entrada suja não estoura', () => {
        expect(acharEmpresaPorCnpj([], '51227692000146')).toBeNull();
        expect(acharEmpresaPorCnpj(null as any, '51227692000146')).toBeNull();
        expect(acharEmpresaPorCnpj([null as any, undefined as any], '51227692000146')).toBeNull();
    });
});

describe('filiais da mesma raiz', () => {
    const carteira = [
        { id: '1', cnpj: '11.222.333/0001-81' },
        { id: '2', cnpj: '11222333000262' },
        { id: '3', cnpj: '11.222.333/0003-43' },
        { id: '4', cnpj: '99888777000155' },
        { id: '5', cnpj: '11222333000900', _deleted: true },
    ];

    test('traz as filiais da raiz, sem a própria matriz', () => {
        expect(filiaisDaRaiz(carteira, '11222333000181'))
            .toEqual(['11222333000262', '11222333000343']);
    });

    test('empresa de outra raiz não entra', () => {
        expect(filiaisDaRaiz(carteira, '11222333000181')).not.toContain('99888777000155');
    });

    test('filial excluída não vai para a declaração', () => {
        expect(filiaisDaRaiz(carteira, '11222333000181')).not.toContain('11222333000900');
    });
});

test('a normalização é a mesma em todo lugar', () => {
    expect(soDigitosCnpj('51.227.692/0001-46')).toBe('51227692000146');
    expect(soDigitosCnpj(null)).toBe('');
});
