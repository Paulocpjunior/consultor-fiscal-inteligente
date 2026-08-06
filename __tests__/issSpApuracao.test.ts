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
