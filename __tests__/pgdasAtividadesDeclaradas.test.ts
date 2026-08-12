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
    podarBrutoDeclaracao,
    interpretarConsultaAtividades,
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

    it('traz as qualificacoes tributarias sem repetir, com o BRUTO da declaração aceita', () => {
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
        // `bruto` carrega a qualificação como veio — é a DESCOBERTA que carimba
        // os nomes de campo (parcela de isenção etc.) antes de o app declarar.
        expect(extrairAtividadesDeclaradas(resposta)[0].qualificacoes)
            .toEqual([{ codigoTributo: 1007, id: 8, bruto: { codigoTributo: 1007, id: 8 } }]);
    });

    it('parcelas DIFERENTES do mesmo tributo são achados diferentes (não dedupe pelo par tributo+id)', () => {
        const resposta = {
            atividades: [{
                idAtividade: 1,
                valorAtividade: 10,
                receitasAtividade: [
                    // Isenção de ICMS com parcelas distintas (caso Jaguarexport):
                    // o VALOR da parcela é parte do achado.
                    { valor: 5, qualificacoesTributarias: [{ codigoTributo: 1007, id: 8, parcelaIsencao: 5 }] },
                    { valor: 5, qualificacoesTributarias: [{ codigoTributo: 1007, id: 8, parcelaIsencao: 3 }] },
                ],
            }],
        };
        expect(extrairAtividadesDeclaradas(resposta)[0].qualificacoes).toHaveLength(2);
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

/**
 * SEM MOVIMENTO — a declaração aceita realmente NÃO tem atividade.
 *
 * GS ODONTOLOGIA 07/2026, transmitida e aceita em 11/08/2026: o relatório da
 * Receita imprime "Nenhuma atividade selecionada". Ou seja, "zero atividade"
 * não é só "consulta sem detalhamento" — pode ser a resposta certa, e é
 * justamente a forma que o app precisa aprender (o SERPRO recusou a
 * transmissão do app com MSG_ISN_023). Por isso o bruto tem que sobreviver à
 * consulta, podado o suficiente pra caber na tela.
 */
describe('bruto podado (descoberta do sem movimento)', () => {
    it('poda texto gigante mas mantém o CAMPO — some o volume, fica a estrutura', () => {
        const pdf = 'A'.repeat(50000);
        const podado: any = podarBrutoDeclaracao({ dados: { pdfDeclaracao: pdf, numeroDeclaracao: '65739771202607001' } });
        expect(podado.dados.numeroDeclaracao).toBe('65739771202607001');
        expect(podado.dados.pdfDeclaracao).toBe('[omitido: 50000 caracteres]');
    });

    it('atravessa JSON em string (o SERPRO ora manda objeto, ora string)', () => {
        const podado: any = podarBrutoDeclaracao({ dados: JSON.stringify({ estabelecimentos: [{ cnpj: '65739771000140', atividades: [] }] }) });
        expect(podado.dados.estabelecimentos[0].cnpj).toBe('65739771000140');
        expect(podado.dados.estabelecimentos[0].atividades).toEqual([]);
    });

    it('preserva números e zeros — valor zerado é a resposta aqui, não ausência', () => {
        const podado: any = podarBrutoDeclaracao({ receitaPaCompetencia: 0, folhas: null });
        expect(podado.receitaPaCompetencia).toBe(0);
        expect(podado.folhas).toBeNull();
    });
});

/**
 * A RECEITA COSTUMA DIZER O MOTIVO — e o app estava deixando a pessoa ler JSON.
 *
 * ELS COMERCIO DE BANANAS 07/2026 (12/08/2026): o bloco cru trouxe uma TERCEIRA
 * causa que a tela não previa — não existe declaração naquela competência. Ler
 * a mensagem separa "procure outra competência" de "confira o detalhamento",
 * que mandam a pessoa para lados opostos.
 */
describe('leitura da resposta quando não veio atividade', () => {
    // Resposta REAL, copiada do print.
    const semDeclaracao = {
        status: 200, dados: '',
        mensagens: [{
            codigo: '[Aviso-PGDASD-MSG_ISN_005]',
            texto: 'Não há declaração transmitida para o período informado: 202607.',
        }],
    };

    it('reconhece a MSG_ISN_005 e manda escolher outra competência', () => {
        const l: any = interpretarConsultaAtividades(semDeclaracao);
        expect(l.situacao).toBe('sem-declaracao');
        expect(l.titulo).toMatch(/não existe declaração transmitida/i);
        expect(l.acao).toMatch(/competência que já foi declarada/i);
    });

    it('e lembra que competência não entregue está VENCENDO', () => {
        const l: any = interpretarConsultaAtividades(semDeclaracao);
        expect(l.acao).toMatch(/MAED/);
    });

    it('reconhece pelo TEXTO mesmo sem o código (o app não depende do formato)', () => {
        const l: any = interpretarConsultaAtividades({
            mensagens: [{ texto: 'Não há declaração transmitida para o período informado: 202512.' }],
        });
        expect(l.situacao).toBe('sem-declaracao');
    });

    it('sem mensagem nenhuma, mantém as duas causas opostas — não inventa a terceira', () => {
        const l: any = interpretarConsultaAtividades({ status: 200, dados: {} });
        expect(l.situacao).toBe('sem-atividade');
        expect(l.explicacao).toMatch(/SEM MOVIMENTO/);
        expect(l.mensagemDaReceita).toEqual([]);
    });

    // Mensagem desconhecida não vira palpite: sobe como veio.
    it('mensagem que o app não conhece sobe literal', () => {
        const l: any = interpretarConsultaAtividades({
            mensagens: [{ codigo: '[Aviso-PGDASD-MSG_XXX]', texto: 'Alguma coisa nova' }],
        });
        expect(l.situacao).toBe('sem-atividade-com-mensagem');
        expect(l.mensagemDaReceita[0]).toMatchObject({ texto: 'Alguma coisa nova' });
    });
});
