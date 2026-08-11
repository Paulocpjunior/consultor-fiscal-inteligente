/**
 * DIPAM 1.1 + FUNRURAL por sub-rogação — compra de produtor rural.
 *
 * Os dois casos-âncora são as notas REAIS que o Paulo mandou (31/07/2026),
 * hoje digitadas na mão no SAGE:
 *
 *   A) NF 415.151 — MARCOS M PONTES, CNPJ, SP, CFOP 1.102, R$ 51.520,00.
 *      No SAGE: aba Eventos → DIPAM "REGISTRO", código 1.1, valor 51.520,00.
 *      O CNPJ NÃO prova que é produtor PF (Comunicado CAT 45/2008) — sem
 *      confirmação no cadastro a nota fica FORA do total, com a ação.
 *
 *   B) NF 425.231 — JOSE SOARES FILHO E OUTROS, CPF, MG, CFOP 2.102,
 *      R$ 55.796,00. No SAGE: Impostos Retidos → Seguro Social s/ Produção
 *      Rural Sub-rogação = 736,50 (1,32%) + 61,37 (0,11% GILRAT) + 111,59
 *      (0,20% SENAR). A própria nota declara "FUNRURAL 1.63% ... R$ 909.47".
 *      Produtor de MG: gera FUNRURAL, NÃO gera DIPAM.
 */
import {
    classificarNota,
    montarDipamCompetencia,
    montarRegistro1400,
    calcularFunrural,
    extrairFunruralDeclarado,
    identificarNaturezaFornecedor,
    aliquotasFunruralVigentes,
    ehIeProdutorRuralSP,
    ehNcmAgropecuario,
    ehMunicipioPaulista,
    parseValorLivre,
} from '../sefaz-backend/dipam-produtor-rural.js';
// @ts-expect-error — módulo .js puro
import { buildBloco1 } from '../sefaz-backend/sped-fiscal-blocos-vazios.js';

const notaEntrada = (over: any = {}) => ({
    chave: '35260600005430000104550010004252311178456640',
    numero: '425231',
    serie: '1',
    dhEmi: '2026-06-03T08:14:14-03:00',
    competencia: '2026-06',
    direcao: 'entrada',
    status: 'autorizado',
    valorTotal: 55796,
    emitente: {
        cnpjCpf: '28585062649',
        nome: 'JOSE SOARES FILHO E OUTROS',
        ie: '0011410720080',
        uf: 'MG',
        codMunIBGE: '3121001',
        municipio: 'DELFINOPOLIS',
    },
    itens: [
        { cfop: '2102', ncm: '08039000', xProd: 'BANANA PRATA CX 11KG', vProd: 11396 },
        { cfop: '2102', ncm: '08039000', xProd: 'BANANA PRATA 15KG', vProd: 44400 },
    ],
    infAdic: 'Cod.Fornecedor: JOSESOARES - Emitida nos termos do art.136,I,a, do RICMS/SP. FUNRURAL '
        + '1.63% do total Nota Valor.: R$ 909.47 - NF Produtor: Modelo: Serie: Data de emissao:03/06/2026',
    ...over,
});

/** Caso A: produtor PAULISTA (o da aba DIPAM do SAGE). */
const notaPaulista = (over: any = {}) => notaEntrada({
    chave: '35260213294968000624550010004151511178456640',
    numero: '415151',
    competencia: '2026-02',
    valorTotal: 51520,
    emitente: {
        cnpjCpf: '13294968000624',
        nome: 'MARCOS M PONTES',
        ie: 'P011004243002',
        uf: 'SP',
        codMunIBGE: '3548906',
        municipio: 'SAO JOSE DO RIO PRETO',
    },
    itens: [{ cfop: '1102', ncm: '08039000', xProd: 'BANANA', vProd: 51520 }],
    infAdic: '',
    ...over,
});

describe('sinais de produtor rural', () => {
    it('IE paulista de produtor começa com P (com ou sem máscara)', () => {
        expect(ehIeProdutorRuralSP('P011004243002')).toBe(true);
        expect(ehIeProdutorRuralSP('P-01100424.3/002')).toBe(true);
        expect(ehIeProdutorRuralSP('114084197111')).toBe(false);
        expect(ehIeProdutorRuralSP('')).toBe(false);
    });

    it('IE de produtor vence: CNPJ não descaracteriza PF (CAT 45/2008)', () => {
        const r = identificarNaturezaFornecedor({ cnpjCpf: '13294968000624', ie: 'P011004243002', uf: 'SP' });
        expect(r.ehProdutorRuralPF).toBe(true);
        expect(r.confianca).toBe('alta');
    });

    it('CNPJ sem IE de produtor fica INDEFINIDO — nunca entra na conta calado', () => {
        const r = identificarNaturezaFornecedor({ cnpjCpf: '13294968000624', ie: '114084197111', uf: 'SP' });
        expect(r.ehProdutorRuralPF).toBe(false);
        expect(r.confianca).toBe('indefinida');
        expect(r.motivo).toMatch(/CADESP/);
    });

    it('cadastro confirmado vence os dois sentidos', () => {
        const sim = identificarNaturezaFornecedor({ cnpjCpf: '13294968000624' }, { natureza: 'produtor_rural_pf' });
        expect(sim.ehProdutorRuralPF).toBe(true);
        expect(sim.confianca).toBe('confirmada');
        const nao = identificarNaturezaFornecedor({ cnpjCpf: '28585062649' }, { natureza: 'pessoa_juridica' });
        expect(nao.ehProdutorRuralPF).toBe(false);
        expect(nao.confianca).toBe('confirmada');
    });

    it('NCM agropecuário: capítulos 01-14 e os crus de fora da faixa', () => {
        expect(ehNcmAgropecuario('08039000')).toBe(true);   // banana
        expect(ehNcmAgropecuario('10059010')).toBe(true);   // milho
        expect(ehNcmAgropecuario('2401')).toBe(true);       // fumo em folha
        expect(ehNcmAgropecuario('44011000')).toBe(true);   // lenha
        expect(ehNcmAgropecuario('87089990')).toBe(false);  // autopeça — erro II do Manual
        expect(ehNcmAgropecuario('27101259')).toBe(false);  // combustível
    });

    it('município paulista é IBGE de 7 dígitos começando em 35', () => {
        expect(ehMunicipioPaulista('3550308')).toBe(true);
        expect(ehMunicipioPaulista('3121001')).toBe(false); // Delfinópolis/MG
        expect(ehMunicipioPaulista('35503')).toBe(false);
    });
});

describe('FUNRURAL por sub-rogação — caso real NF 425.231', () => {
    it('reproduz exatamente o lançamento do SAGE (truncando os centavos)', () => {
        const f = calcularFunrural(55796, '2026-06');
        expect(f.aliquotas).toEqual({ inss: 1.32, gilrat: 0.11, senar: 0.20 });
        expect(f.inss).toBe(736.50);    // SAGE: 736,50 (1,32% = 736,5072)
        expect(f.gilrat).toBe(61.37);   // SAGE: 61,37  (0,11% = 61,3756)
        expect(f.senar).toBe(111.59);   // SAGE: 111,59 (0,20% = 111,592)
        expect(f.total).toBe(909.46);
        expect(f.percentualTotal).toBe(1.63);
    });

    it('lê o FUNRURAL que o emitente declarou (valor com PONTO decimal)', () => {
        const d = extrairFunruralDeclarado(notaEntrada().infAdic)!;
        expect(d.percentual).toBe(1.63);
        expect(d.valor).toBe(909.47);
    });

    it('parseValorLivre entende pt-BR e o ponto decimal da nota', () => {
        expect(parseValorLivre('909.47')).toBe(909.47);
        expect(parseValorLivre('R$ 55.796,00')).toBe(55796);
        expect(parseValorLivre('1.234')).toBe(1234);
        expect(parseValorLivre('')).toBeNull();
    });

    it('1 centavo de diferença contra a nota não vira alarme falso', () => {
        const n = classificarNota(notaEntrada());
        expect(n.funrural.aplica).toBe(true);
        expect(n.funrural.total).toBe(909.46);
        expect(n.funrural.declarado.valor).toBe(909.47);
        expect(n.funrural.divergencia).toBeNull();
    });

    it('divergência de verdade vira pendência com a ação', () => {
        const n = classificarNota(notaEntrada({ infAdic: 'FUNRURAL 2.30% do total Nota Valor.: R$ 1283.30' }));
        expect(n.funrural.divergencia.declarado).toBe(1283.30);
        expect(n.pendencias.map((p: any) => p.codigo)).toContain('funrural-divergente');
    });

    it('tabela por vigência: competência antiga usa 1,2 + 0,1 + 0,2', () => {
        const a = aliquotasFunruralVigentes('2024-05');
        expect([a.inss, a.gilrat, a.senar]).toEqual([1.2, 0.1, 0.2]);
        expect(a.revisar).toBe(false);
    });

    it('a virada é 01/04/2026 (LC 224/2025) — março ainda é 1,5%', () => {
        // Errar a vigência cobraria 0,13 ponto a mais em jan-mar/2026, e quem
        // paga é o cliente adquirente (sub-rogação).
        const marco = aliquotasFunruralVigentes('2026-03');
        expect([marco.inss, marco.gilrat, marco.senar]).toEqual([1.2, 0.1, 0.2]);
        const abril = aliquotasFunruralVigentes('2026-04');
        expect([abril.inss, abril.gilrat, abril.senar]).toEqual([1.32, 0.11, 0.20]);
        expect(abril.fonte).toMatch(/LC 224\/2025/);
        expect(abril.revisar).toBe(false);   // base legal confirmada (31/07/2026)
    });

    it('mesma nota em março e em junho de 2026 dá valores diferentes', () => {
        expect(calcularFunrural(55796, '2026-03').total).toBe(836.93);  // 1,50%
        expect(calcularFunrural(55796, '2026-06').total).toBe(909.46);  // 1,63%
    });

    it('SEGURADO ESPECIAL (agricultura familiar) continua em 1,5% depois da LC 224/2025', () => {
        const n = classificarNota(notaEntrada(), {
            cadastro: { natureza: 'produtor_rural_pf', seguradoEspecial: true },
        });
        expect(n.funrural.aplica).toBe(true);
        expect(n.funrural.percentualTotal).toBe(1.5);
        expect(n.funrural.total).toBe(836.93);
        // A nota declara 1,63% (o emitente aplicou a regra geral): divergência
        // real, que tem de aparecer pra alguém decidir.
        expect(n.pendencias.map((p: any) => p.codigo)).toContain('funrural-divergente');
    });

    it('produtor que optou pela FOLHA não sofre sub-rogação (só o cadastro sabe)', () => {
        const n = classificarNota(notaEntrada(), { cadastro: { natureza: 'produtor_rural_pf', funrural: 'folha' } });
        expect(n.funrural.aplica).toBe(false);
        expect(n.funrural.motivo).toMatch(/folha/i);
    });

    it('fornecedor indefinido não calcula sub-rogação', () => {
        const n = classificarNota(notaEntrada({ emitente: { cnpjCpf: '13294968000624', nome: 'ATACADO LTDA', ie: '114084197111', uf: 'SP', codMunIBGE: '3550308' } }));
        expect(n.funrural.aplica).toBe(false);
        expect(n.dipam.aplica).toBe(false);
    });
});

describe('nota própria de ENTRADA (tpNF=0) — o formato real da compra de produtor', () => {
    // Como a NF 425.231 existe DE VERDADE no banco: o CLIENTE emite a nota
    // (RICMS/SP art. 136 — produtor PF não emite NF-e), o produtor fica no
    // bloco destinatário/remetente e o importer antigo gravava direcao='saida'
    // (só olhava o CNPJ do emitente). Sem tratar isso, o Exportar SAGE recusava
    // o CFOP e a DIPAM não via a compra (31/07, caso EDUARDO GUERRA).
    const empresa = { id: 'eg', nome: 'EDUARDO GUERRA HORTIFRUTI', cnpj: '00005430000104' };
    const notaPropria = (over: any = {}) => ({
        chave: '35260600005430000104550010004252311178456640',
        numero: '425231',
        dhEmi: '2026-06-03T08:14:14-03:00',
        competencia: '2026-06',
        direcao: 'saida',          // como o importer antigo gravou
        tpNF: '0',                 // mas o XML diz: ENTRADA
        status: 'autorizado',
        valorTotal: 55796,
        emitente: { cnpjCpf: '00005430000104', nome: 'EDUARDO GUERRA HORTIFRUTI', uf: 'SP' },
        destinatario: {
            cnpjCpf: '28585062649', nome: 'JOSE SOARES FILHO E OUTROS',
            ie: '0011410720080', uf: 'MG', codMunIBGE: '3121001', municipio: 'DELFINOPOLIS',
        },
        itens: [{ cfop: '2102', ncm: '08039000', xProd: 'BANANA PRATA' }],
        infAdic: 'FUNRURAL 1.63% do total Nota Valor.: R$ 909.47',
        ...over,
    });

    it('gera FUNRURAL com o PRODUTOR (destinatário) como contraparte — não vira "saída"', () => {
        const n = classificarNota(notaPropria(), { empresa });
        expect(n.direcao).toBe('entrada');
        expect(n.fornecedor.nome).toBe('JOSE SOARES FILHO E OUTROS');
        expect(n.funrural.aplica).toBe(true);
        expect(n.funrural.total).toBe(909.46);
        expect(n.dipam.aplica).toBe(false);   // produtor de MG: sem DIPAM
    });

    it('produtor paulista na nota própria entra no DIPAM 1.1 pelo município dele', () => {
        const n = classificarNota(notaPropria({
            itens: [{ cfop: '1102', ncm: '08039000' }],
            destinatario: {
                cnpjCpf: '28585062649', nome: 'SITIO SAO PEDRO',
                ie: 'P011223344', uf: 'SP', codMunIBGE: '3548906', municipio: 'SAO JOSE DO RIO PRETO',
            },
        }), { empresa });
        expect(n.dipam.aplica).toBe(true);
        expect(n.dipam.codMunIBGE).toBe('3548906');
        expect(n.dipam.valor).toBe(55796);
    });

    it('depois do backfill (direcao=entrada, tpNF=0), a contraparte continua sendo o destinatário', () => {
        const n = classificarNota(notaPropria({ direcao: 'entrada' }), { empresa });
        expect(n.fornecedor.nome).toBe('JOSE SOARES FILHO E OUTROS');
        expect(n.funrural.aplica).toBe(true);
    });

    it('saída de verdade (tpNF=1) continua saída — devolução segue a régua própria', () => {
        const n = classificarNota(notaPropria({ tpNF: '1', itens: [{ cfop: '5102', ncm: '08039000' }] }), { empresa });
        expect(n.direcao).toBe('saida');
        expect(n.funrural.aplica).toBe(false);
    });

    // ── DEDUP art. 136 / RC 33068: duas notas da MESMA compra não podem dobrar ──
    describe('dedup NF-e do produtor × nota de entrada (art. 136 / RC 33068)', () => {
        it('produtor + nota de entrada do MESMO produtor → FUNRURAL conta UMA vez', () => {
            const painel = montarDipamCompetencia({
                documentos: [notaEntrada(), notaPropria()], // NOTA 1 (produtor) + NOTA 2 (entrada), mesmo produtor 28585062649
                competencia: '2026-06',
                empresa,
            });
            const comFunrural = painel.notas.filter((n: any) => n.funrural.aplica);
            expect(comFunrural).toHaveLength(1);                 // só a de entrada conta
            expect(comFunrural[0].notaPropria).toBe(true);
            const daProdutor = painel.notas.find((n: any) => n.notaOrigemProdutor);
            expect(daProdutor).toBeTruthy();
            expect(daProdutor.funrural.aplica).toBe(false);      // a do produtor sai da conta
            expect(daProdutor.funrural.motivo).toMatch(/art\. ?136|RC 33068/);
        });

        it('produtor SEM par (só uma nota da operação) fica INTACTO — sem dedup, sem alarme', () => {
            const painel = montarDipamCompetencia({
                documentos: [notaEntrada()], // uma nota só → não dobra → não mexe
                competencia: '2026-06',
                empresa,
            });
            const comFunrural = painel.notas.filter((n: any) => n.funrural.aplica);
            expect(comFunrural).toHaveLength(1);                          // continua contada
            expect(comFunrural[0].notaOrigemProdutor).toBeFalsy();       // NÃO foi excluída
        });
    });
});

describe('DIPAM 1.1 — quem entra e quem fica de fora', () => {
    it('produtor de MG gera FUNRURAL mas NÃO gera DIPAM (a declaração é paulista)', () => {
        const n = classificarNota(notaEntrada());
        expect(n.funrural.aplica).toBe(true);
        expect(n.dipam.aplica).toBe(false);
        expect(n.dipam.motivo).toMatch(/MG/);
    });

    it('caso A: produtor paulista com IE "P" entra no 1.1 pelo município de origem', () => {
        const n = classificarNota(notaPaulista());
        expect(n.dipam.aplica).toBe(true);
        expect(n.dipam.codigo).toBe('1.1');
        expect(n.dipam.registro1400).toBe('SPDIPAM11');
        expect(n.dipam.codMunIBGE).toBe('3548906');
        expect(n.dipam.valor).toBe(51520);
    });

    it('caso A sem IE de produtor: fica FORA do total, com a ação do CADESP', () => {
        const n = classificarNota(notaPaulista({
            emitente: { ...notaPaulista().emitente, ie: '114084197111' },
        }));
        expect(n.dipam.aplica).toBe(false);
        const p = n.pendencias.find((x: any) => x.codigo === 'fornecedor-indefinido');
        expect(p.acao).toMatch(/CADESP/);
    });

    it('confirmando no cadastro, a mesma nota entra', () => {
        const n = classificarNota(
            notaPaulista({ emitente: { ...notaPaulista().emitente, ie: '114084197111' } }),
            { cadastro: { natureza: 'produtor_rural_pf' } },
        );
        expect(n.dipam.aplica).toBe(true);
        expect(n.dipam.valor).toBe(51520);
    });

    it('cooperativa lança 1.3 (SPDIPAM13), não 1.1', () => {
        const n = classificarNota(notaPaulista(), { empresa: { ehCooperativa: true } });
        expect(n.dipam.codigo).toBe('1.3');
        expect(n.dipam.registro1400).toBe('SPDIPAM13');
    });

    it('cliente que É produtor rural PF entrega DIPAM-A, não lança 1.1', () => {
        const n = classificarNota(notaPaulista(), { empresa: { ehProdutorRuralPF: true } });
        expect(n.dipam.aplica).toBe(false);
        expect(n.dipam.motivo).toMatch(/DIPAM-A/);
    });

    it('depósito, retorno simbólico e fixação de preço NÃO entram — com o motivo', () => {
        for (const cfop of ['1905', '1907', '1131', '1917']) {
            const n = classificarNota(notaPaulista({ itens: [{ cfop, ncm: '08039000' }] }));
            expect(n.dipam.aplica).toBe(false);
            expect(n.dipam.motivo.length).toBeGreaterThan(10);
        }
    });

    it('CFOP fora da régua vira pendência de classificação, não silêncio', () => {
        const n = classificarNota(notaPaulista({ itens: [{ cfop: '1949', ncm: '08039000' }] }));
        expect(n.dipam.aplica).toBe(false);
        expect(n.pendencias.map((p: any) => p.codigo)).toContain('cfop-fora-da-regua');
    });

    it('compra sem NCM agropecuário entra mas AVISA (erro II do Manual)', () => {
        const n = classificarNota(notaPaulista({ itens: [{ cfop: '1102', ncm: '87089990' }] }));
        expect(n.dipam.aplica).toBe(true);
        expect(n.pendencias.map((p: any) => p.codigo)).toContain('ncm-nao-agro');
    });

    it('nota sem município de origem vira pendência (a DIPAM é por município)', () => {
        const n = classificarNota(notaPaulista({
            emitente: { ...notaPaulista().emitente, codMunIBGE: '', municipio: '' },
        }));
        expect(n.dipam.aplica).toBe(false);
        expect(n.pendencias.map((p: any) => p.codigo)).toContain('municipio-ausente');
    });

    it('fornecedor PJ comum (não agro) NÃO vira pendência — senão a tela é só ruído', () => {
        const n = classificarNota(notaPaulista({
            emitente: { cnpjCpf: '11222333000144', nome: 'AUTOPECAS LTDA', ie: '114084197111', uf: 'SP', codMunIBGE: '3550308' },
            itens: [{ cfop: '1102', ncm: '87089990' }],
        }));
        expect(n.dipam.aplica).toBe(false);
        expect(n.pendencias).toHaveLength(0);
    });

    it('PJ vendendo gênero agropecuário É a dúvida real (CAT 45/2008) e vira pendência', () => {
        const n = classificarNota(notaPaulista({
            emitente: { cnpjCpf: '11222333000144', nome: 'HORTIFRUTI ATACADO', ie: '114084197111', uf: 'SP', codMunIBGE: '3550308' },
            itens: [{ cfop: '1102', ncm: '08039000' }],
        }));
        expect(n.pendencias.map((p: any) => p.codigo)).toContain('fornecedor-indefinido');
    });

    it('nota cancelada sai da conta sem virar pendência', () => {
        const n = classificarNota(notaPaulista({ status: 'cancelado' }));
        expect(n.dipam.aplica).toBe(false);
        expect(n.funrural.aplica).toBe(false);
        expect(n.pendencias).toHaveLength(0);
    });
});

describe('consolidação da competência', () => {
    const semAviso = { competencia: '2026-02', empresa: { id: 'e1', nome: 'HORTIFRUTI X' } };

    it('agrupa por município e monta o Registro 1400', () => {
        const r = montarDipamCompetencia({
            ...semAviso,
            documentos: [
                notaPaulista(),
                notaPaulista({ chave: 'B', numero: '2', valorTotal: 1000 }),
                notaPaulista({
                    chave: 'C', numero: '3', valorTotal: 2000,
                    emitente: { cnpjCpf: '11122233344', nome: 'SITIO BOA VISTA', ie: 'P099', uf: 'SP', codMunIBGE: '3509502', municipio: 'CAMPINAS' },
                }),
            ],
        });
        expect(r.dipam.total).toBe(54520);
        expect(r.dipam.municipios).toHaveLength(2);
        expect(r.dipam.municipios[0]).toMatchObject({ codMunIBGE: '3548906', valor: 52520, compras: 2 });
        expect(r.dipam.registro1400[0].linha).toBe('|1400|SPDIPAM11|3548906|52520,00|');
        expect(r.farol.cor).toBe('ok');
    });

    it('devolução DEDUZ do município em vez de sumir', () => {
        const r = montarDipamCompetencia({
            ...semAviso,
            documentos: [
                notaPaulista(),
                notaPaulista({
                    chave: 'DEV', numero: '9', direcao: 'saida', valorTotal: 1520,
                    emitente: { cnpjCpf: '99999999000199', nome: 'HORTIFRUTI X', uf: 'SP' },
                    destinatario: notaPaulista().emitente,
                    itens: [{ cfop: '5202', ncm: '08039000' }],
                }),
            ],
        });
        expect(r.dipam.municipios[0].valor).toBe(50000);
        expect(r.dipam.municipios[0].devolucoes).toBe(1);
    });

    it('município que fecha negativo não vai ao arquivo e vira pendência de compensação', () => {
        const r = montarDipamCompetencia({
            ...semAviso,
            documentos: [
                notaPaulista({ valorTotal: 1000 }),
                notaPaulista({
                    chave: 'DEV', numero: '9', direcao: 'saida', valorTotal: 4000,
                    emitente: { cnpjCpf: '99999999000199', nome: 'HORTIFRUTI X', uf: 'SP' },
                    destinatario: notaPaulista().emitente,
                    itens: [{ cfop: '5202', ncm: '08039000' }],
                }),
            ],
        });
        expect(r.dipam.total).toBe(0);
        expect(r.dipam.registro1400).toHaveLength(0);
        expect(r.pendencias.map((p: any) => p.codigo)).toContain('municipio-saldo-nao-positivo');
    });

    it('farol honesto: valor apurado com fornecedor indefinido em cima NUNCA é verde', () => {
        const r = montarDipamCompetencia({
            ...semAviso,
            documentos: [
                notaPaulista(),
                notaPaulista({ chave: 'X', numero: '7', emitente: { ...notaPaulista().emitente, ie: '114084197111' } }),
            ],
        });
        expect(r.dipam.total).toBe(51520);
        expect(r.farol.cor).toBe('falha');
        expect(r.farol.resumo).toMatch(/confirmar o fornecedor/);
    });

    it('fornecedor a confirmar aparece UMA vez, não uma por nota', () => {
        const suspeito = { cnpjCpf: '11222333000144', nome: 'HORTIFRUTI ATACADO', ie: '114084197111', uf: 'SP', codMunIBGE: '3550308' };
        const r = montarDipamCompetencia({
            ...semAviso,
            documentos: [1, 2, 3, 4, 5].map((i) => notaPaulista({ chave: `N${i}`, numero: String(i), emitente: suspeito })),
        });
        const indefinidos = r.pendencias.filter((p: any) => p.codigo === 'fornecedor-indefinido');
        expect(indefinidos).toHaveLength(1);
        expect(indefinidos[0].doc).toBe('11222333000144');
    });

    it('competência sem compra de produtor é neutra, não "ok"', () => {
        const r = montarDipamCompetencia({ ...semAviso, documentos: [] });
        expect(r.farol.cor).toBe('neutro');
        expect(r.dipam.registro1400).toHaveLength(0);
    });

    it('soma o FUNRURAL da competência nota a nota', () => {
        const r = montarDipamCompetencia({
            competencia: '2026-06',
            empresa: { id: 'e1', nome: 'HORTIFRUTI X' },
            documentos: [notaEntrada(), notaEntrada({ chave: 'B', numero: '2', valorTotal: 10000, infAdic: '' })],
        });
        expect(r.funrural.base).toBe(65796);
        expect(r.funrural.inss).toBe(868.50);   // 736,50 + 132,00
        expect(r.funrural.total).toBe(1072.46);
        expect(r.funrural.notas).toHaveLength(2);
        // Alíquota a confirmar é aviso ÚNICO da competência, não pendência por
        // nota (senão o farol viveria em âmbar e a equipe pararia de ler).
        // Base legal confirmada (LC 224/2025): nada mais a revisar, e o aviso
        // da competência some.
        expect(r.funrural.revisarAliquotas).toBe(false);
        expect(r.avisos).toHaveLength(0);
    });

    it('cadastro do produtor sobrepõe o município da nota (rateio informado pelo produtor)', () => {
        const r = montarDipamCompetencia({
            ...semAviso,
            documentos: [notaPaulista()],
            fornecedores: { '13294968000624': { natureza: 'produtor_rural_pf', codMunIBGE: '3509502', municipio: 'CAMPINAS' } },
        });
        expect(r.dipam.municipios[0]).toMatchObject({ codMunIBGE: '3509502', municipio: 'CAMPINAS' });
    });
});

describe('Bloco 1 do SPED Fiscal', () => {
    it('sem DIPAM: IND_VA = N e nenhum 1400 (como era antes)', () => {
        const linhas = buildBloco1();
        expect(linhas).toHaveLength(3);
        expect(linhas[1]).toBe('|1010|N|N|N|N|N|N|N|N|N|N|N|N|N|\r\n');
        expect(linhas[2]).toBe('|1990|3|\r\n');
    });

    it('com DIPAM: liga o IND_VA, emite um 1400 por município e recontagem do 1990', () => {
        const linhas = buildBloco1([
            { codItemIpm: 'SPDIPAM11', mun: '3548906', valor: 52520 },
            { codItemIpm: 'SPDIPAM11', mun: '3509502', valor: 2000 },
        ]);
        // IND_VA é o 5º indicador do 1010 — 'S' só pode existir COM 1400.
        expect(linhas[1]).toBe('|1010|N|N|N|N|S|N|N|N|N|N|N|N|N|\r\n');
        expect(linhas[2]).toBe('|1400|SPDIPAM11|3548906|52520,00|\r\n');
        expect(linhas[3]).toBe('|1400|SPDIPAM11|3509502|2000,00|\r\n');
        expect(linhas[4]).toBe('|1990|5|\r\n');
    });

    it('município com valor zero/negativo não entra e não liga o IND_VA', () => {
        const linhas = buildBloco1([{ codItemIpm: 'SPDIPAM11', mun: '3548906', valor: 0 }]);
        expect(linhas).toHaveLength(3);
        expect(linhas[1]).toContain('|N|N|N|N|N|');
    });
});

describe('Registro 1400', () => {
    it('só município paulista com valor positivo (Guia Prático, campo 04)', () => {
        const linhas = montarRegistro1400([
            { codMunIBGE: '3548906', valor: 100, registro1400: 'SPDIPAM11' },
            { codMunIBGE: '3548906', valor: 0, registro1400: 'SPDIPAM11' },
            { codMunIBGE: '3121001', valor: 500, registro1400: 'SPDIPAM11' },
        ]);
        expect(linhas).toHaveLength(1);
        expect(linhas[0].linha).toBe('|1400|SPDIPAM11|3548906|100,00|');
    });
});
