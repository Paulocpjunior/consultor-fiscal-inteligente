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

describe('CCM do prestador sai da própria nota quando o cadastro está vazio', () => {
    // Caso CLINICA MANTOAN (06/08): a apuração funcionou, mas a caixinha do
    // "🔌 Testar WS" veio VAZIA e o botão nasceu desabilitado, mudo. O CCM
    // canônico é o do cadastro; a nota serve de socorro pra destravar o teste,
    // nunca de substituto (a captura do portal lê o cadastro).
    const nota = (over: any = {}): any => ({
        id: over.id || 'c1',
        tipo: 'NFSe', tipoDoc: 'NFSe', direcao: 'saida', status: 'autorizado',
        numero: over.numero || '782', dhEmi: '2026-08-08T10:00:00',
        valorServicos: 2400, valorTotal: 2400, valorIss: 48, issDevido: 48,
        itens: [], ...over,
    });

    it('lê o prestadorCcm gravado pelo importador do CSV do portal', () => {
        const a = apurarIssSp([nota({ prestadorCcm: '1234567' })], '2026-08');
        expect(a.ccmDasNotas).toEqual(['1234567']);
    });

    it('lê a InscricaoPrestador do XML e deduplica entre as notas', () => {
        const a = apurarIssSp([
            nota({ id: 'c1', numero: '1', inscricaoPrestador: '7654321' }),
            nota({ id: 'c2', numero: '2', prestadorCcm: '7.654.321' }),
        ], '2026-08');
        expect(a.ccmDasNotas).toEqual(['7654321']);
    });

    it('CCM só-zeros não é inscrição (#311) — fica de fora', () => {
        const a = apurarIssSp([nota({ prestadorCcm: '0000000' })], '2026-08');
        expect(a.ccmDasNotas).toEqual([]);
    });

    it('sem nota nenhuma não inventa CCM', () => {
        expect(apurarIssSp([], '2026-08').ccmDasNotas).toEqual([]);
    });
});

/**
 * Paulo, 06/08 (PEC PRONTA ENTREGA): *"essa empresa tem ISS de tomador e
 * prestador, aqui só aparece a de prestados"*.
 *
 * São DUAS obrigações com DUAS guias. O ISS retido na fonte é recolhido por
 * quem CONTRATOU o serviço (Lei 13.701/03 art. 9º §1º) — a empresa tomadora
 * paga no lugar do prestador. O painel só olhava saída, então quem é tomadora
 * com retenção não via o que devia recolher.
 */
describe('ISS retido COMO TOMADORA é outra obrigação', () => {
    const tomada = (over: any = {}): any => ({
        id: over.id || 't1', tipo: 'NFSe', tipoDoc: 'NFSe',
        direcao: 'entrada', status: 'autorizado',
        numero: over.numero || '900', dhEmi: '2026-08-12T10:00:00',
        valorServicos: 10000, valorTotal: 10000,
        prestadorNome: 'PRESTADOR LTDA',
        itens: [], ...over,
    });

    it('nota tomada COM retenção entra na apuração do tomado', () => {
        const a = apurarIssSp([tomada({ valorIssRetido: 500 })], '2026-08');
        expect(a.tomado.notas).toHaveLength(1);
        expect(a.tomado.totalRetido).toBe(500);
        expect(a.tomado.notas[0].prestador).toBe('PRESTADOR LTDA');
    });

    it('a flag booleana do portal também conta, usando o ISS da nota', () => {
        const a = apurarIssSp([tomada({ issRetido: true, valorIss: 300 })], '2026-08');
        expect(a.tomado.totalRetido).toBe(300);
    });

    it('nota tomada SEM retenção não gera obrigação — fica de fora', () => {
        const a = apurarIssSp([tomada({ valorIss: 300 })], '2026-08');
        expect(a.tomado.notas).toHaveLength(0);
        expect(a.tomado.totalRetido).toBe(0);
    });

    it('NÃO soma com o ISS próprio — são impostos de operações diferentes', () => {
        const a = apurarIssSp([
            { id: 's1', tipo: 'NFSe', tipoDoc: 'NFSe', direcao: 'saida', status: 'autorizado',
              numero: '1', dhEmi: '2026-08-05T10:00:00', valorServicos: 1000, valorTotal: 1000,
              valorIss: 50, issDevido: 50, itens: [] } as any,
            tomada({ valorIssRetido: 500 }),
        ], '2026-08');
        expect(a.aRecolher).toBe(50);          // guia do ISS próprio
        expect(a.tomado.totalRetido).toBe(500); // guia do ISS retido — separada
    });

    it('a existência do tomado aparece nos avisos do painel', () => {
        const a = apurarIssSp([tomada({ valorIssRetido: 500 })], '2026-08');
        expect(a.avisos.join(' ')).toMatch(/TAMBÉM é tomadora com retenção/);
        expect(a.avisos.join(' ')).toMatch(/é outra guia/);
        expect(a.tomado.avisos.join(' ')).toMatch(/Não some com o ISS próprio/);
    });

    it('nota cancelada não conta como retenção', () => {
        const a = apurarIssSp([tomada({ valorIssRetido: 500, status: 'cancelado' })], '2026-08');
        expect(a.tomado.totalRetido).toBe(0);
    });
});

/**
 * O bloco de ISS tomado SUMIA quando não achava retenção — e sumir fez o
 * colaborador concluir que o app ignora o ISS de tomador (Paulo, 06/08:
 * "colaborador alerta sobre ISS Tomador, não apareceu o ISS TOMADOR").
 *
 * Ausência tem que FALAR: "não achei" e "não tem" são coisas diferentes.
 */
describe('ausência de ISS tomado precisa dizer POR QUÊ', () => {
    const emitida = (over: any = {}): any => ({
        id: 's1', tipo: 'NFSe', tipoDoc: 'NFSe', direcao: 'saida', status: 'autorizado',
        numero: '1', dhEmi: '2026-07-21T10:00:00', valorServicos: 1000, valorTotal: 1000,
        valorIss: 50, issDevido: 50, itens: [], ...over,
    });
    const tomadaSemRetencao = (over: any = {}): any => ({
        id: over.id || 't1', tipo: 'NFSe', tipoDoc: 'NFSe', direcao: 'entrada', status: 'autorizado',
        numero: '900', dhEmi: '2026-07-15T10:00:00', valorServicos: 5000, valorTotal: 5000,
        valorIss: 250, issDevido: 250, issRetido: false, itens: [], ...over,
    });

    it('NENHUMA nota tomada capturada aponta CAPTURA, não ausência de obrigação', () => {
        const a = apurarIssSp([emitida()], '2026-07');
        expect(a.tomado.notasNoMes).toBe(0);
        expect(a.tomado.avisos.join(' ')).toMatch(/NENHUMA NFS-e TOMADA foi capturada/);
        expect(a.tomado.avisos.join(' ')).toMatch(/problema é de CAPTURA/);
    });

    it('tomadas capturadas SEM retenção dizem isso, com a contagem', () => {
        const a = apurarIssSp([emitida(), tomadaSemRetencao(), tomadaSemRetencao({ id: 't2' })], '2026-07');
        expect(a.tomado.notasNoMes).toBe(2);
        expect(a.tomado.semRetencao).toBe(2);
        expect(a.tomado.avisos.join(' ')).toMatch(/2 nota\(s\) tomada\(s\) capturada\(s\), NENHUMA com retenção/);
        // A pista que evita conclusão errada: pode ser retenção de OUTRO imposto.
        expect(a.tomado.avisos.join(' ')).toMatch(/IR\/INSS\/PIS-COFINS-CSLL/);
    });

    it('com retenção, o aviso de ausência NÃO aparece', () => {
        const a = apurarIssSp([tomadaSemRetencao({ valorIssRetido: 250 })], '2026-07');
        expect(a.tomado.totalRetido).toBe(250);
        expect(a.tomado.avisos.join(' ')).not.toMatch(/NENHUMA/);
    });
});
