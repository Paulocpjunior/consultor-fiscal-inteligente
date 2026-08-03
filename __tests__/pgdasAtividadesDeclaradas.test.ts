/**
 * Extração das atividades de uma declaração PGDAS-D já transmitida.
 *
 * Motivo (caso S&P, 03/08/2026): faltava o CÓDIGO da atividade "Escritórios de
 * serviços contábeis... ISS em valor fixo em guia do Município" e a tabela do
 * SERPRO não abre de dentro do app. A fonte confiável que sobra é a própria
 * empresa — o que a Receita já aceitou dela. Como o shape da resposta do SERPRO
 * varia (objeto, string JSON, aninhamentos diferentes), a extração é varredura
 * profunda e os testes cobrem os formatos plausíveis.
 */
import {
    extrairAtividadesDeclaradas,
    resumirAtividadesDeclaradas,
} from '../sefaz-backend/pgdas-atividades-declaradas.js';

describe('extrairAtividadesDeclaradas', () => {
    it('acha as atividades no shape padrao (dados > declaracao > estabelecimentos)', () => {
        const resposta = {
            dados: {
                declaracao: {
                    estabelecimentos: [{
                        cnpjCompleto: '11222333000181',
                        atividades: [
                            { idAtividade: 22, valorAtividade: 50000, receitasAtividade: [{ valor: 50000 }] },
                            { idAtividade: 1, valorAtividade: 1000, receitasAtividade: [{ valor: 1000 }] },
                        ],
                    }],
                },
            },
        };

        expect(extrairAtividadesDeclaradas(resposta)).toEqual([
            { idAtividade: 1, valorAtividade: 1000, ocorrencias: 1, qualificacoes: [] },
            { idAtividade: 22, valorAtividade: 50000, ocorrencias: 1, qualificacoes: [] },
        ]);
    });

    it('atravessa string JSON (o SERPRO devolve dados como texto em varios servicos)', () => {
        const resposta = {
            dados: JSON.stringify({
                declaracaoTransmitida: {
                    estabelecimentos: [{ atividades: [{ idAtividade: 15, valorAtividade: 200 }] }],
                },
            }),
        };
        expect(extrairAtividadesDeclaradas(resposta).map((a: any) => a.idAtividade)).toEqual([15]);
    });

    it('soma o mesmo id que aparece em varios estabelecimentos (matriz + filial)', () => {
        const resposta = {
            estabelecimentos: [
                { atividades: [{ idAtividade: 14, valorAtividade: 100.5 }] },
                { atividades: [{ idAtividade: 14, valorAtividade: 99.5 }] },
            ],
        };
        const [atividade] = extrairAtividadesDeclaradas(resposta);
        expect(atividade).toMatchObject({ idAtividade: 14, valorAtividade: 200, ocorrencias: 2 });
    });

    it('traz as qualificacoes tributarias sem repetir', () => {
        const resposta = {
            atividades: [{
                idAtividade: 1,
                valorAtividade: 10,
                receitasAtividade: [
                    { valor: 5, qualificacoesTributarias: [{ codigoTributo: 1007, id: 8 }] },
                    { valor: 5, qualificacoesTributarias: [{ codigoTributo: 1007, id: 8 }] },
                ],
            }],
        };
        expect(extrairAtividadesDeclaradas(resposta)[0].qualificacoes)
            .toEqual([{ codigoTributo: 1007, id: 8 }]);
    });

    it('resposta sem atividade nenhuma devolve lista vazia (nao inventa)', () => {
        expect(extrairAtividadesDeclaradas({ dados: { recibo: 'x', valoresDevidos: [] } })).toEqual([]);
        expect(extrairAtividadesDeclaradas(null)).toEqual([]);
        expect(extrairAtividadesDeclaradas('texto solto')).toEqual([]);
    });

    it('ignora idAtividade invalido (zero, nulo, texto)', () => {
        const resposta = {
            atividades: [
                { idAtividade: 0, valorAtividade: 1 },
                { idAtividade: null, valorAtividade: 2 },
                { idAtividade: 'abc', valorAtividade: 3 },
                { idAtividade: 30, valorAtividade: 4 },
            ],
        };
        expect(extrairAtividadesDeclaradas(resposta).map((a: any) => a.idAtividade)).toEqual([30]);
    });
});

describe('resumirAtividadesDeclaradas', () => {
    it('separa o que o app ja monta do CODIGO NOVO — que e o achado procurado', () => {
        const resumo = resumirAtividadesDeclaradas([
            { idAtividade: 15, valorAtividade: 100, ocorrencias: 1, qualificacoes: [] },
            { idAtividade: 22, valorAtividade: 900, ocorrencias: 1, qualificacoes: [] },
        ]);

        expect(resumo.total).toBe(2);
        expect(resumo.conhecidas.map((a: any) => a.idAtividade)).toEqual([15]);
        expect(resumo.conhecidas[0].rotulo).toContain('ISS retido');
        expect(resumo.novas.map((a: any) => a.idAtividade)).toEqual([22]);
        expect(resumo.temNova).toBe(true);
    });

    it('so codigos conhecidos: nada de novo a cadastrar', () => {
        const resumo = resumirAtividadesDeclaradas([
            { idAtividade: 1, valorAtividade: 10, ocorrencias: 1, qualificacoes: [] },
        ]);
        expect(resumo.temNova).toBe(false);
        expect(resumo.novas).toEqual([]);
    });

    it('lista vazia nao quebra', () => {
        expect(resumirAtividadesDeclaradas(null)).toMatchObject({ total: 0, temNova: false });
    });
});
