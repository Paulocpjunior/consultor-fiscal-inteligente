import { montarMovimentoFiscalContabil } from '../sefaz-backend/movimento-fiscal-contabil.js';

describe('movimento_fiscal_cfi_v1', () => {
    const cnpj = '42907639000103';
    const base = {
        id: 'nfse-300', tipoDoc: 'NFSe', direcao: 'saida', competencia: '2026-06',
        numero: '300', dhEmi: '2026-06-26T12:00:00-03:00', valorTotal: 1889.07,
        tomadorNome: 'AVACY DISTRIBUIDORA E COMERCIO LTDA', tomadorCnpj: '12345678000190',
        empresaCnpj: cnpj, valorIss: 0, valores: { baseCalculo: 1889.07, liquido: 1889.07 },
    };

    it('entrega servicos prestados normalizados e totalizados sem PDF intermediario', () => {
        const r = montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-06', movimento: 'servicos_prestados',
            documentos: [base, { ...base, id: 'cancelada', numero: '301', status: 'cancelado' }],
        });
        expect(r.contrato).toBe('movimento_fiscal_cfi_v1');
        // ⚠️ FIXTURE TROCADA (02/09): ela travava o resumo SEM `foraPorLacuna`,
        // ou seja descrevia o mundo em que nota derrubada por captura incompleta
        // sumia calada. Zero aqui é a RESPOSTA ("nada ficou de fora"), e é por
        // isso que o campo sai sempre.
        // ⚠️ E `issRetidoTotal`/`issRetidoPeloIssDaNota` (08/09) saem SEMPRE pelo
        // mesmo motivo: zero é "nenhuma retenção", não o default de quem não olhou.
        expect(r.resumo).toEqual({
            notas: 1, total: 1889.07, semDocumentoContraparte: 0, foraPorLacuna: 0,
            issRetidoTotal: 0, issRetidoPeloIssDaNota: 0,
        });
        expect(r.notas[0]).toMatchObject({
            idOrigem: 'nfse-300', numero: '300', data: '2026-06-26', valor: 1889.07,
            participanteNome: 'AVACY DISTRIBUIDORA E COMERCIO LTDA', participanteDocumento: '12345678000190',
        });
    });

    it('nao mistura servicos tomados com prestados', () => {
        const r = montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-06', movimento: 'servicos_tomados', documentos: [base],
        });
        expect(r.resumo.notas).toBe(0);
        expect(r.resumo.total).toBe(0);
    });

    it('nao troca o valor bruto da nota pela base reduzida de ISS', () => {
        const r = montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-06', movimento: 'servicos_prestados',
            documentos: [{ ...base, valorServicos: undefined, valorTotal: 5755.54, valores: { baseCalculo: 4604.43 } }],
        });
        expect(r.notas[0].valor).toBe(5755.54);
        expect(r.notas[0].baseCalculoIss).toBe(4604.43);
        expect(r.resumo.total).toBe(5755.54);
    });

    // ========================================================================
    // 🚨 A DATA ERA LIDA POR UMA SEGUNDA CÓPIA DA RÉGUA (02/09)
    //
    // Este arquivo já importa CINCO donos do `xml-metadata-helper` e rolava o
    // próprio parser de data ao lado. Ele acertava hoje; divergiria no primeiro
    // ajuste, e a divergência apareceria como *"o Contábil e o Fiscal declaram
    // meses diferentes sobre a MESMA nota"*.
    // ========================================================================
    it('a data sai do DONO — as três formas em que o `dhEmi` chega', () => {
        const comData = (dhEmi: unknown) => montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-06', movimento: 'servicos_prestados',
            documentos: [{ ...base, dhEmi }],
        }).notas[0]?.data;

        expect(comData('2026-06-26T22:30:00-03:00')).toBe('2026-06-26');
        // 🚨 O `new Date` do JS lê a forma brasileira como MÊS/DIA: `11/05/2026`
        // viraria 5 de NOVEMBRO, e o Contábil lançaria em outra competência.
        expect(comData('11/05/2026 14:31:31')).toBe('2026-05-11');
        expect(comData({ toDate: () => new Date(Date.UTC(2026, 5, 26)) })).toBe('2026-06-26');
    });

    // ========================================================================
    // 🚨 QUEDA POR FILTRO × QUEDA POR LACUNA — e só a segunda precisa ser DITA
    //
    // Nota sem valor e sem data legível PERTENCEM a este movimento e sumiam
    // caladas: o Contábil recebia um mês menor do que houve, sem nada acusar.
    // ========================================================================
    it('nota sem data legivel fica FORA, mas sai NOMEADA', () => {
        const r = montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-06', movimento: 'servicos_prestados',
            documentos: [base, { ...base, id: 'x', numero: '302', dhEmi: 'nao e data' }],
        });
        expect(r.resumo.notas).toBe(1);
        expect(r.resumo.foraPorLacuna).toBe(1);
        expect(r.lacunas.semData).toEqual(['302']);
        // ⚠️ O número da nota vai na frase: "1 nota ficou de fora" manda varrer
        // o mês inteiro atrás dela.
        expect(r.ressalvas.join(' ')).toMatch(/302/);
        expect(r.ressalvas.join(' ')).toMatch(/data/i);
    });

    it('nota sem valor legivel tem ressalva PROPRIA — a acao e outra', () => {
        const r = montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-06', movimento: 'servicos_prestados',
            documentos: [{
                ...base, id: 'y', numero: '303',
                valorServicos: undefined, valorTotal: undefined, valores: {},
            }],
        });
        expect(r.lacunas.semValor).toEqual(['303']);
        expect(r.lacunas.semData).toEqual([]);
        expect(r.ressalvas.join(' ')).toMatch(/valor/i);
    });

    // ⚠️ Cancelada e nota do outro lado NÃO são lacuna: elas não pertencem a
    // este movimento. Contá-las faria o alarme nascer em todo mês normal.
    it('cancelada e nota do outro lado nao viram lacuna', () => {
        const r = montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-06', movimento: 'servicos_prestados',
            documentos: [
                base,
                { ...base, id: 'c', numero: '304', status: 'cancelado' },
                { ...base, id: 'e', numero: '305', direcao: 'entrada' },
            ],
        });
        expect(r.resumo.notas).toBe(1);
        expect(r.resumo.foraPorLacuna).toBe(0);
        expect(r.ressalvas).toEqual([]);
    });

    // ========================================================================
    // 🚨 O ISS RETIDO ATRAVESSAVA O TÚNEL COMO ZERO — em nota que o portal
    // declara RETIDA (08/09, CLUDE · serviços TOMADOS 08/2026)
    //
    // O portal de SP grava `issRetido: true` (booleano) e o ISS da nota em
    // `valorIss`; nunca um "valor retido" separado. A leitura antiga só
    // respondia com valor separado, então o CCI recebia `issRetido: 0` sobre
    // duas notas com "ISS Retido: Sim" (5,56 e 7,00) e mostrava "ISS retido:
    // R$ 0,00". Na NFS-e paulistana a retenção é INTEGRAL: o retido é o ISS
    // da nota — e sai CARIMBADO, porque é derivado.
    // ========================================================================
    describe('ISS retido em servicos TOMADOS — a forma do portal de SP', () => {
        const tomada = {
            id: 'nfse-10353', tipoDoc: 'NFSe', direcao: 'entrada', competencia: '2026-08',
            numero: '10353', dhEmi: '01/08/2026 09:00:00', valorTotal: 278.03, valorServicos: 278.03,
            prestadorNome: 'PRESENCA TECNOLOGIA & SEGURANCA LTDA', prestadorCnpj: '11222333000181',
            cnpjEmit: '11222333000181', xNomeEmit: 'PRESENCA TECNOLOGIA & SEGURANCA LTDA',
            tomadorCnpj: cnpj, cnpjDest: cnpj, empresaCnpj: cnpj,
            valorIss: 5.56, issDevido: 5.56, issRetido: true,
        };
        const montar = (docs: unknown[]) => montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-08', movimento: 'servicos_tomados', documentos: docs,
        });

        it('booleano do portal + ISS da nota ⇒ retido = ISS da nota, CARIMBADO', () => {
            const r = montar([tomada]);
            expect(r.notas).toHaveLength(1);
            expect(r.notas[0].valorIss).toBe(5.56);
            expect(r.notas[0].issRetido).toBe(5.56);
            expect(r.notas[0].issRetidoOrigem).toBe('declarado-iss-integral');
            expect(r.resumo.issRetidoTotal).toBe(5.56);
            expect(r.resumo.issRetidoPeloIssDaNota).toBe(1);
            // O número derivado vai DITO, com a nota nomeada.
            expect(r.ressalvas.join(' ')).toMatch(/10353/);
            expect(r.ressalvas.join(' ')).toMatch(/ISS RETIDO declarado/);
        });

        it('valor retido SEPARADO vence o derivado', () => {
            const r = montar([{ ...tomada, valorIssRetido: 5.5 }]);
            expect(r.notas[0].issRetido).toBe(5.5);
            expect(r.notas[0].issRetidoOrigem).toBe('documento');
            expect(r.resumo.issRetidoPeloIssDaNota).toBe(0);
            expect(r.ressalvas).toEqual([]);
        });

        it('sem declaracao o retido e 0 com origem NULA — "nao houve", nao "nao achei"', () => {
            const r = montar([{ ...tomada, id: 'n8370', numero: '8370', valorIss: 0, issDevido: 0, issRetido: false }]);
            expect(r.notas[0].issRetido).toBe(0);
            expect(r.notas[0].issRetidoOrigem).toBeNull();
            expect(r.resumo.issRetidoTotal).toBe(0);
        });

        it('duas retidas e sete sem retencao somam 12,56 — o caso do print', () => {
            const semRet = Array.from({ length: 7 }, (_, i) => ({
                ...tomada, id: `mx-${i}`, numero: String(8370 + i), valorIss: 0, issDevido: 0, issRetido: false,
                valorTotal: 44, valorServicos: 44,
            }));
            const embratop = { ...tomada, id: 'nfse-22243', numero: '22243', valorTotal: 140, valorServicos: 140, valorIss: 7, issDevido: 7 };
            const r = montar([tomada, embratop, ...semRet]);
            expect(r.resumo.notas).toBe(9);
            expect(r.resumo.issRetidoTotal).toBe(12.56);
            expect(r.resumo.issRetidoPeloIssDaNota).toBe(2);
        });
    });
});
