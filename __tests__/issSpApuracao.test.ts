import {
    apurarIssSp, vencimentoIssSp, empresaEhSpCapital, COD_MUN_SP_CAPITAL,
} from '../services/issSpApuracao';
import type { DocumentoFiscal } from '../types';

const nfse = (over: any = {}): DocumentoFiscal => ({
    id: over.id || 'n1',
    tipo: 'NFSe',
    tipoDoc: 'NFSe',
    direcao: 'saida',
    status: 'autorizado',
    numero: over.numero || '782',
    dhEmi: over.dhEmi || '2026-07-08T18:00:44',
    competencia: '2026-07',
    valorTotal: 4800,
    tomador: { nome: 'CONDOMINIO CASUARINA', cnpjCpf: '59575753000178' },
    valores: { baseCalculo: 4800, iss: 240, ...(over.valores || {}) },
    itens: [],
    ...over,
} as any);

describe('vencimento do ISS da NFS-e paulistana', () => {
    it('é o dia 10 do mês seguinte (conferido na NFS-e 782)', () => {
        // Nota emitida 08/07/2026 → "Data de vencimento do ISS: 10/08/2026".
        expect(vencimentoIssSp('2026-07')).toBe('2026-08-10');
    });

    it('vira o ano em dezembro', () => {
        expect(vencimentoIssSp('2026-12')).toBe('2027-01-10');
    });

    it('competência inválida devolve vazio — não inventa data', () => {
        expect(vencimentoIssSp('')).toBe('');
        expect(vencimentoIssSp('2026-13')).toBe('');
    });
});

describe('apuração do ISS próprio', () => {
    it('soma o ISS das notas emitidas e aponta o vencimento', () => {
        const a = apurarIssSp([nfse(), nfse({ id: 'n2', numero: '783', valores: { baseCalculo: 3400, iss: 170 } })], '2026-07');
        expect(a.totalIssDevido).toBe(410);
        expect(a.aRecolher).toBe(410);
        expect(a.vencimento).toBe('2026-08-10');
        expect(a.apta).toBe(true);
    });

    it('ISS RETIDO pelo tomador sai da guia do prestador', () => {
        // Recolher os dois faria o cliente pagar duas vezes o mesmo imposto.
        const a = apurarIssSp([
            nfse(),
            nfse({ id: 'n2', numero: '783', valores: { baseCalculo: 3400, iss: 170, valorIssRetido: 170 } }),
        ], '2026-07');
        expect(a.totalIssDevido).toBe(410);
        expect(a.totalIssRetido).toBe(170);
        expect(a.aRecolher).toBe(240);
        expect(a.avisos.join(' ')).toMatch(/RETIDO pelo tomador/);
    });

    it('nota SEM ISS gravado bloqueia a emissão — ausente não é zero', () => {
        const a = apurarIssSp([nfse({ valores: { baseCalculo: 4800 } })], '2026-07');
        expect(a.notas[0].semValorGravado).toBe(true);
        expect(a.apta).toBe(false);
        expect(a.avisos.join(' ')).toMatch(/ausência NÃO é zero/);
    });

    it('ignora entrada, cancelada e o que não é NFS-e', () => {
        const a = apurarIssSp([
            nfse({ id: 'e', direcao: 'entrada' }),
            nfse({ id: 'c', status: 'cancelado' }),
            nfse({ id: 'x', tipo: 'NFe', tipoDoc: 'NFe' }),
        ], '2026-07');
        expect(a.notas).toHaveLength(0);
        expect(a.apta).toBe(false);
    });

    it('competência sem nota avisa em vez de dizer "nada a pagar"', () => {
        const a = apurarIssSp([], '2026-07');
        expect(a.avisos.join(' ')).toMatch(/confirme se a captura do mês já rodou/);
        expect(a.apta).toBe(false);
    });

    it('nota já vinculada a guia da Prefeitura é sinalizada', () => {
        const a = apurarIssSp([nfse({ guiaIss: '00012345' })], '2026-07');
        expect(a.jaComGuia).toBe(1);
        expect(a.avisos.join(' ')).toMatch(/já vinculada/);
    });

    it('ISS integralmente retido não gera guia', () => {
        const a = apurarIssSp([nfse({ valores: { baseCalculo: 4800, iss: 240, valorIssRetido: 240 } })], '2026-07');
        expect(a.aRecolher).toBe(0);
        expect(a.apta).toBe(false);
    });
});

describe('praça coberta', () => {
    it('só SP capital (Paulo, 05/08)', () => {
        expect(empresaEhSpCapital({ codMunIBGE: COD_MUN_SP_CAPITAL })).toBe(true);
        expect(empresaEhSpCapital({ codMunIBGE: '3509502' })).toBe(false);
        expect(empresaEhSpCapital(null)).toBe(false);
    });
});

describe('a NFS-e do PORTAL SP vem ACHATADA (caso CLINICA MANTOAN, 06/08)', () => {
    // 1º teste do Paulo: 4 notas de 4 com "não gravado" e tomador vazio.
    // O importador do portal grava issDevido/valorIss/tomadorNome no topo do
    // documento; a importação de XML grava valores.iss/tomador.nome. Ler só
    // uma das formas zera metade da base — a MESMA armadilha do DIFAL e da 🚦.
    const doPortal = (over: any = {}): any => ({
        id: over.id || 'p1',
        tipo: 'NFSe',
        tipoDoc: 'NFSe',
        direcao: 'saida',
        status: 'autorizado',
        numero: over.numero || '7886',
        dhEmi: '2026-08-05T10:00:00',
        competencia: '2026-08',
        fonte: 'csv-portal-sp',
        valorServicos: 7200,
        valorTotal: 7200,
        valorIss: 360,
        issDevido: 360,
        issRetido: false,
        tomadorNome: 'CONDOMINIO X',
        xNomeDest: 'CONDOMINIO X',
        totais: { vNF: 7200, vISS: 360 },
        itens: [],
        ...over,
    });

    it('lê ISS e tomador da forma achatada do portal', () => {
        const a = apurarIssSp([doPortal()], '2026-08');
        expect(a.notas[0].semValorGravado).toBe(false);
        expect(a.notas[0].issDevido).toBe(360);
        expect(a.notas[0].tomador).toBe('CONDOMINIO X');
        expect(a.aRecolher).toBe(360);
        expect(a.apta).toBe(true);
    });

    it('ISS retido pelo tomador no formato do portal (flag booleana)', () => {
        const a = apurarIssSp([doPortal({ issRetido: true })], '2026-08');
        expect(a.totalIssRetido).toBe(360);
        expect(a.aRecolher).toBe(0);
    });

    it('a forma OBJETO (importação de XML) continua funcionando', () => {
        const a = apurarIssSp([{
            id: 'x1', tipo: 'NFSe', tipoDoc: 'NFSe', direcao: 'saida', status: 'autorizado',
            numero: '99', dhEmi: '2026-08-05T10:00:00', valorTotal: 1000,
            tomador: { nome: 'TOMADOR OBJ' },
            valores: { baseCalculo: 1000, iss: 50 }, itens: [],
        } as any], '2026-08');
        expect(a.notas[0].issDevido).toBe(50);
        expect(a.notas[0].tomador).toBe('TOMADOR OBJ');
    });

    it('sem ISS em NENHUMA das formas segue bloqueando (ausente ≠ zero)', () => {
        const { valorIss, issDevido, totais, ...semIss } = doPortal();
        const a = apurarIssSp([semIss], '2026-08');
        expect(a.notas[0].semValorGravado).toBe(true);
        expect(a.apta).toBe(false);
    });
});

describe('alíquota vem da NOTA e SUP não apura por faturamento (Paulo, 06/08)', () => {
    // "não são todos os serviços em SP que são 5%, médico por exemplo 2%,
    // aí você tem os clientes que pagam por quantidade de sócios, o SUP".
    const nota = (over: any = {}): any => ({
        id: over.id || 'a1',
        tipo: 'NFSe', tipoDoc: 'NFSe', direcao: 'saida', status: 'autorizado',
        numero: over.numero || '1', dhEmi: '2026-08-05T10:00:00',
        valorServicos: 10000, valorTotal: 10000,
        valorIss: 200, issDevido: 200, aliquotaServicos: 2, codigoServico: '05070',
        tomadorNome: 'PACIENTE PJ', itens: [], ...over,
    });

    it('lê a alíquota e o código de serviço da nota, sem derivar nada', () => {
        const a = apurarIssSp([nota()], '2026-08');
        expect(a.notas[0].aliquota).toBe(2);
        expect(a.notas[0].codigoServico).toBe('05070');
        expect(a.totalIssDevido).toBe(200);   // 2% de 10.000 — NÃO 5%
        expect(a.aliquotas).toEqual([2]);
    });

    it('alíquotas diferentes no mês viram aviso, não erro', () => {
        const a = apurarIssSp([
            nota(),
            nota({ id: 'a2', numero: '2', aliquotaServicos: 5, valorIss: 500, issDevido: 500, codigoServico: '01406' }),
        ], '2026-08');
        expect(a.aliquotas).toEqual([2, 5]);
        expect(a.avisos.join(' ')).toMatch(/Alíquotas diferentes no mês \(2%, 5%\)/);
    });

    it('ISS FIXO (SUP): não libera guia por faturamento e diz o porquê', () => {
        const a = apurarIssSp([nota()], '2026-08', {
            issConfig: { tipo: 'sup_fixo', qtdeSocios: 3, valorPorSocio: 250 },
        });
        expect(a.issFixoSup).toBe(true);
        expect(a.apta).toBe(false);
        expect(a.avisos.join(' ')).toMatch(/ISS FIXO \(sociedade uniprofissional\)/);
        expect(a.avisos.join(' ')).toMatch(/3 profissional\(is\) × R\$ 250,00/);
    });

    it('empresa por alíquota municipal segue apurando normalmente', () => {
        const a = apurarIssSp([nota()], '2026-08', {
            issConfig: { tipo: 'aliquota_municipal', aliquota: 2 },
        });
        expect(a.issFixoSup).toBe(false);
        expect(a.apta).toBe(true);
    });

    it('tudo zerado com alíquota zero pede conferência (SUP, isenção ou imunidade)', () => {
        const a = apurarIssSp([nota({ valorIss: 0, issDevido: 0, aliquotaServicos: 0 })], '2026-08');
        expect(a.avisos.join(' ')).toMatch(/pode ser ISS fixo \(SUP\), isenção, imunidade ou retenção integral/);
        expect(a.apta).toBe(false);
    });
});
