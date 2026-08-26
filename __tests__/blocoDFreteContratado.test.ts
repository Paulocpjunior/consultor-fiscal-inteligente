// ============================================================================
// 🚨 O BLOCO D NÃO É "O CT-e DO MÊS" — é a aquisição de frete COM DIREITO A
//    CRÉDITO, e o gerador tratava como se fosse o primeiro.
//
// As duas fontes, literais:
//
//   📖 Guia Prático 1.35, D100, Observações: *"Só devem ser relacionados neste
//      registro as aquisições de serviços de transportes que … confiram direito
//      ao crédito do PIS/Pasep e da Cofins."* E o campo 02 (IND_OPER) tem um
//      ÚNICO valor válido: [0].
//   📖 Manual do Lucro Presumido (PVA 2.04): ao listar os registros do regime
//      CUMULATIVO — Blocos 0, F, M e P, mais 0200, 0500, F525, F600, 1010/1020,
//      1800 e 1900 —, **o bloco D não está lá**.
//
// O que o gerador fazia, e nenhum teste pegava (o bloco D era o único do
// EFD-Contribuições sem prova de leiaute):
//   · emitia D100 em qualquer regime e em qualquer direção, com IND_OPER 1 na
//     prestação — valor que não existe no campo;
//   · montava **20** campos onde o leiaute lista **23**, deslocado a partir do
//     13: o VL_DOC caía na casa do TP_CT-e (um dígito) e PIS/COFINS iam para
//     IND_FRT, VL_SERV, VL_BC_ICMS e VL_ICMS;
//   · nunca emitia D101 nem D105, que o Guia diz serem obrigatórios para cada
//     D100 — sem eles a base do crédito não é recuperada no M105/M505.
// ============================================================================
import {
    INDICADORES_NATUREZA_FRETE, INDICADORES_TIPO_FRETE, regimeAdmiteBlocoD,
    cadastroDoFreteContratado, decidirFreteNoBlocoD, avisosDoBlocoD,
    CST_FRETE_COM_CREDITO, CST_FRETE_SEM_CREDITO,
// ⚠️ Sem silenciador de tipo: os dois módulos têm `.d.ts`, então o tsc CONFERE
// os tipos aqui. Calar o aviso faria o módulo voltar a ser `any` e o `.d.ts` do
// lado parar de valer para quem importa.
} from '../sefaz-backend/frete-contratado-bloco-d.js';
import { buildBlocoD_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';
import {
    conferirBlocoDContrib, conferirContagemDeCampos, CAMPOS_POR_REGISTRO,
// @ts-ignore
} from '../sefaz-backend/sped-contrib-campos.js';

const CADASTRO_COM_CREDITO = {
    contribIndNatFrete: '2',            // compras geradoras de crédito
    contribIndFrtCte: '0',              // por conta do emitente
    contribNatBcCredFrete: '09',
};

const cte = (extra: Record<string, unknown> = {}) => ({
    tipo: 'cte',
    modelo: '57',
    chaveAcesso: '35260712345678000199570010000001231000000015',
    numero: '123',
    direcao: 'entrada',
    dataEmissao: '2026-07-15',
    valorTotal: 1000,
    emitente: { cnpjCpf: '12345678000199' },
    status: 'autorizado',
    ...extra,
});

const gerar = (dadosFiscais: Record<string, unknown>, regimeApuracao: string, notas = [cte()]) => {
    const dados: any = {
        empresa: { cnpj: '31947349000169', dadosFiscais },
        notas, regimeApuracao, warnings: [],
    };
    return { linhas: buildBlocoD_Contrib(dados) as string[], warnings: dados.warnings as string[] };
};

const campos = (linha: string) => linha.trim().split('|').slice(1, -1);
const doReg = (linhas: string[], reg: string) => linhas.filter(l => campos(l)[0] === reg);

describe('🚨 quem entra no bloco D', () => {
    it('regime CUMULATIVO não tem bloco D — crédito só existe no não-cumulativo', () => {
        expect(regimeAdmiteBlocoD('2')).toBe(false);
        expect(regimeAdmiteBlocoD('1')).toBe(true);
        expect(regimeAdmiteBlocoD('3')).toBe(true);
        // Ausência cai no cumulativo, que é o padrão do app.
        expect(regimeAdmiteBlocoD(undefined)).toBe(false);
    });

    // 🚨 É A MESMA RECUSA DA PEC/AFFITTARE, esperando o primeiro CT-e: "O
    // registro não deve ser informado para esse perfil e/ou tipo de operação".
    // As CINCO empresas com EFD-Contribuições fechado por recibo são todas
    // cumulativas — nenhuma tinha CT-e no período.
    it('CT-e em empresa do Lucro Presumido NÃO gera D100, e a causa é dita', () => {
        const { linhas, warnings } = gerar(CADASTRO_COM_CREDITO, '2');
        expect(doReg(linhas, 'D100')).toHaveLength(0);
        expect(linhas[0]).toContain('|D001|1|');
        expect(warnings.join(' ')).toMatch(/regime CUMULATIVO/);
        expect(warnings.join(' ')).toMatch(/O frete aqui é CUSTO/);
    });

    // 📖 D100 campo 02 — valor válido: [0]. Quem PRESTA o serviço escritura a
    // receita no D200, que este app não gera; a ausência sai nomeada.
    it('CT-e de PRESTAÇÃO não vira D100 — e o aviso aponta o D200', () => {
        const { linhas, warnings } = gerar(CADASTRO_COM_CREDITO, '1', [cte({ direcao: 'saida' })]);
        expect(doReg(linhas, 'D100')).toHaveLength(0);
        expect(warnings.join(' ')).toMatch(/D200/);
    });

    it('sem cadastro dos códigos de tabela, o CT-e não entra — e cada falta tem AÇÃO própria', () => {
        const semNada = gerar({}, '1');
        expect(doReg(semNada.linhas, 'D100')).toHaveLength(0);
        expect(semNada.warnings.join(' ')).toMatch(/IND_NAT_FRT/);
        expect(semNada.warnings.join(' ')).toMatch(/Dados Fiscais/);

        const semTipo = gerar({ contribIndNatFrete: '2' }, '1');
        expect(semTipo.warnings.join(' ')).toMatch(/IND_FRT/);

        // Natureza que gera crédito exige a Tabela 4.3.7, que não está no repo.
        const semBase = gerar({ contribIndNatFrete: '2', contribIndFrtCte: '0' }, '1');
        expect(doReg(semBase.linhas, 'D100')).toHaveLength(0);
        expect(semBase.warnings.join(' ')).toMatch(/4\.3\.7/);
    });

    // ⚠️ O Guia amarra o indicador 9 à SUBCONTRATAÇÃO, que tem crédito
    // PRESUMIDO, CST 60-66 e alíquotas próprias (1,2375% / 5,7%, Tabela
    // 4.3.17). Tratá-lo como os outros declararia crédito na alíquota errada.
    it('natureza "9 — Outras" é RECUSADA: o app não escolhe alíquota de crédito no escuro', () => {
        const { linhas, warnings } = gerar(
            { contribIndNatFrete: '9', contribIndFrtCte: '0', contribNatBcCredFrete: '14' }, '1',
        );
        expect(doReg(linhas, 'D100')).toHaveLength(0);
        expect(warnings.join(' ')).toMatch(/SUBCONTRATAÇÃO/);
        expect(warnings.join(' ')).toMatch(/1,2375/);
    });

    it('código fora da tabela não vira valor — cadastro torto é ausência, não default', () => {
        const cad = cadastroDoFreteContratado({ contribIndNatFrete: '7', contribIndFrtCte: '3' });
        expect(cad.indNatFrete).toBe('');
        expect(cad.indFrt).toBe('');
    });

    it('as duas tabelas têm os valores do Guia, e só eles', () => {
        expect(Object.keys(INDICADORES_NATUREZA_FRETE)).toEqual(['0', '1', '2', '3', '4', '5', '9']);
        expect(Object.keys(INDICADORES_TIPO_FRETE)).toEqual(['0', '1', '2', '9']);
    });
});

describe('🚨 o leiaute do D100 — 23 campos, não 20', () => {
    it('o D100 sai com os 23 campos e a contagem oficial confere', () => {
        const { linhas } = gerar(CADASTRO_COM_CREDITO, '1');
        const d100 = doReg(linhas, 'D100');
        expect(d100).toHaveLength(1);
        expect(campos(d100[0])).toHaveLength(23);
        expect(CAMPOS_POR_REGISTRO.D100.campos).toBe(23);
        // A trava de contagem roda sobre o arquivo INTEIRO e passa limpa.
        expect(conferirContagemDeCampos(linhas).erros).toEqual([]);
    });

    // 🚨 O DEFEITO QUE ISTO FECHA: o valor do frete caía na casa do TP_CT-e,
    // que é um campo de UM dígito, e o VL_DOC saía vazio.
    it('o VL_DOC está no campo 15 e o TP_CT-e (13) sai VAZIO', () => {
        const { linhas } = gerar(CADASTRO_COM_CREDITO, '1');
        const c = campos(doReg(linhas, 'D100')[0]);
        expect(c[12]).toBe('');          // 13 TP_CT-e
        // 📖 Campo 14 — "Não preencher, informar campo vazio".
        expect(c[13]).toBe('');          // 14 CHV_CTE_REF
        expect(c[14]).toBe('1000,00');   // 15 VL_DOC
        expect(c[16]).toBe('0');         // 17 IND_FRT (do cadastro)
        expect(c[17]).toBe('1000,00');   // 18 VL_SERV
    });

    it('IND_OPER é sempre 0 e IND_EMIT é de terceiros', () => {
        const c = campos(doReg(gerar(CADASTRO_COM_CREDITO, '1').linhas, 'D100')[0]);
        expect(c[1]).toBe('0');
        expect(c[2]).toBe('1');
    });

    // ⚠️ Campo de valor OPCIONAL não recebe 0,00 afirmado quando o documento
    // não traz o dado — é a régua de 06/08.
    it('ICMS ausente sai VAZIO, e presente sai preenchido', () => {
        const semIcms = campos(doReg(gerar(CADASTRO_COM_CREDITO, '1').linhas, 'D100')[0]);
        expect(semIcms[18]).toBe('');
        expect(semIcms[19]).toBe('');

        const comIcms = campos(doReg(
            gerar(CADASTRO_COM_CREDITO, '1', [cte({ vBC: 1000, vICMS: 120 })]).linhas, 'D100',
        )[0]);
        expect(comIcms[18]).toBe('1000,00');
        expect(comIcms[19]).toBe('120,00');
    });
});

describe('🚨 D101 e D105 — o detalhamento que nunca era emitido', () => {
    it('cada D100 leva um D101 e um D105, com 9 campos cada', () => {
        const { linhas } = gerar(CADASTRO_COM_CREDITO, '1');
        expect(doReg(linhas, 'D101')).toHaveLength(1);
        expect(doReg(linhas, 'D105')).toHaveLength(1);
        expect(campos(doReg(linhas, 'D101')[0])).toHaveLength(9);
        expect(campos(doReg(linhas, 'D105')[0])).toHaveLength(9);
    });

    it('com crédito: CST 50, base = valor do frete, alíquota do regime', () => {
        const { linhas } = gerar(CADASTRO_COM_CREDITO, '1');
        const pis = campos(doReg(linhas, 'D101')[0]);
        expect(pis[1]).toBe('2');                       // IND_NAT_FRT
        expect(pis[2]).toBe('1000,00');                 // VL_ITEM
        expect(pis[3]).toBe(CST_FRETE_COM_CREDITO);     // CST_PIS
        expect(pis[4]).toBe('09');                      // NAT_BC_CRED
        expect(pis[5]).toBe('1000,00');                 // VL_BC_PIS
        expect(pis[6]).toBe('1,6500');
        expect(pis[7]).toBe('16,50');
        const cofins = campos(doReg(linhas, 'D105')[0]);
        expect(cofins[6]).toBe('7,6000');
        expect(cofins[7]).toBe('76,00');
    });

    // 📖 D101 campo 02: "As operações que não tem previsão de apuração de
    // crédito devem ser informadas com o CST 70". Aqui o zero É a resposta
    // ("não há crédito"), não o default de quem não achou o dado.
    it('sem crédito: CST 70, NAT_BC_CRED vazio e valores zerados', () => {
        const { linhas } = gerar({ contribIndNatFrete: '3', contribIndFrtCte: '1' }, '1');
        const pis = campos(doReg(linhas, 'D101')[0]);
        expect(pis[3]).toBe(CST_FRETE_SEM_CREDITO);
        expect(pis[4]).toBe('');
        expect(pis[5]).toBe('0,00');
        expect(pis[7]).toBe('0,00');
    });

    it('natureza 1 (ônus do adquirente) e as transferências não geram crédito', () => {
        for (const nat of ['1', '3', '4', '5']) {
            const d = decidirFreteNoBlocoD({
                direcao: 'entrada', regimeApuracao: '1',
                cadastro: cadastroDoFreteContratado({ contribIndNatFrete: nat, contribIndFrtCte: '0' }),
            });
            expect([nat, d.entra, d.cst]).toEqual([nat, true, CST_FRETE_SEM_CREDITO]);
        }
        for (const nat of ['0', '2']) {
            const d = decidirFreteNoBlocoD({
                direcao: 'entrada', regimeApuracao: '1',
                cadastro: cadastroDoFreteContratado({
                    contribIndNatFrete: nat, contribIndFrtCte: '0', contribNatBcCredFrete: '09',
                }),
            });
            expect([nat, d.cst]).toEqual([nat, CST_FRETE_COM_CREDITO]);
        }
    });
});

describe('🚨 a recusa virou regra da prevalidação no MESMO PR', () => {
    it('nasce VERDE sobre o bloco que o gerador produz', () => {
        const { linhas } = gerar(CADASTRO_COM_CREDITO, '1');
        expect(conferirBlocoDContrib(linhas).erros).toEqual([]);
    });

    it('acusa o D100 sem D101/D105 — o arquivo de antes desta correção', () => {
        const r = conferirBlocoDContrib([
            '|D001|0|',
            '|D010|31947349000169|',
            '|D100|0|1|12345678000199|57|00|000||123|352607|15072026|15072026|1000,00||||1000,00|16,50|1000,00|76,00|',
            '|D990|4|',
        ]);
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0].mensagem).toMatch(/sem D101 e D105/);
        expect(r.erros[0].mensagem).toMatch(/M105\/M505/);
    });

    it('acusa IND_OPER diferente de 0 — o CT-e de prestação escriturado como aquisição', () => {
        const r = conferirBlocoDContrib([
            '|D100|1|0|12345678000199|57|00|000||123|352607|15072026|15072026|||1000,00||0|1000,00||||||',
            '|D101|2|1000,00|50|09|1000,00|1,6500|16,50||',
            '|D105|2|1000,00|50|09|1000,00|7,6000|76,00||',
        ]);
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0].mensagem).toMatch(/só aceita "0 — Aquisição"/);
        expect(r.erros[0].mensagem).toMatch(/D200/);
    });

    // ⚠️ D101/D105 só existem SOB um D100: registro de outro bloco fecha o pai,
    // senão um D101 solto lá adiante "salvaria" um D100 que ficou sem filho.
    it('registro de outro bloco fecha o pai', () => {
        const r = conferirBlocoDContrib([
            '|D100|0|1|12345678000199|57|00|000||123|352607|15072026|15072026|||1000,00||0|1000,00||||||',
            '|F001|0|',
            '|D101|2|1000,00|50|09|1000,00|1,6500|16,50||',
        ]);
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0].mensagem).toMatch(/D101 e D105/);
    });
});

describe('🚨 os avisos separam as CAUSAS — cada uma pede outra ação', () => {
    it('um aviso por motivo, com os documentos nomeados', () => {
        const avisos = avisosDoBlocoD({
            'regime-cumulativo': ['1', '2'],
            prestacao: ['3'],
        });
        expect(avisos).toHaveLength(2);
        expect(avisos.join(' ')).toMatch(/2 conhecimento\(s\)/);
        expect(avisos.join(' ')).toMatch(/1 conhecimento\(s\)/);
    });

    it('motivo sem frase não vira aviso mudo', () => {
        expect(avisosDoBlocoD({ 'motivo-inventado': ['1'] })).toEqual([]);
        expect(avisosDoBlocoD({})).toEqual([]);
        expect(avisosDoBlocoD(null)).toEqual([]);
    });
});
