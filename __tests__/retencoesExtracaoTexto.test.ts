import {
    analisarRetencoes, validarRetencoesLinha, parseCsvNfseSp, ultimoDiagnosticoCsv,
    type LinhaNfseCsv,
} from '../services/retencoesNfseAnalyzer';

/**
 * Caso FRONTINI (05/08): o Demonstrativo do E-Fiscal listou 4 notas com
 * PIS/COFINS/CSLL retidos e a Análise de Retenções achou UMA. As outras três
 * apareciam com "✓ ok" — errado E com cara de certo.
 *
 * Causa: o extrator exigia "R$" depois do nome do tributo.
 */
const nota = (discriminacao: string, valorServicos = 990): LinhaNfseCsv => ({
    direcao: 'saida',
    numero: '781',
    data: '2026-07-03',
    prestadorCnpj: '09246389000124',
    prestadorNome: 'FRONTINI',
    tomadorCnpj: '59575753000178',
    tomadorNome: 'TOMADOR',
    valorServicos,
    iss: 0,
    codServico: '',
    discriminacao,
} as LinhaNfseCsv);

describe('extração de retenção sem "R$" na discriminação', () => {
    it('lê "PIS 6,44 COFINS 29,70 CSLL 9,90" (formato do caso real)', () => {
        const a = analisarRetencoes(nota('RETENCOES: PIS 6,44 COFINS 29,70 CSLL 9,90'));
        expect(a.pis.valor).toBe(6.44);
        expect(a.cofins.valor).toBe(29.70);
        expect(a.csll.valor).toBe(9.90);
        expect(a.totalRetido).toBeCloseTo(46.04, 2);
    });

    it('continua lendo o formato com R$ (não quebrou o que funcionava)', () => {
        const a = analisarRetencoes(nota('PIS R$ 22,10 COFINS R$ 102,00 CSLL R$ 34,00', 3400));
        expect(a.pis.valor).toBe(22.10);
        expect(a.cofins.valor).toBe(102);
    });

    it('lê com marcador de dedução: "(-) CSLL 27,92"', () => {
        const a = analisarRetencoes(nota('(-) CSLL 27,92', 2791.67));
        expect(a.csll.retido).toBe(true);
        expect(a.csll.valor).toBe(27.92);
    });

    it('NÃO confunde alíquota com valor: "PIS 0,65%" não vira R$ 0,65', () => {
        const a = analisarRetencoes(nota('Aliquotas: PIS 0,65% COFINS 3,00% CSLL 1,00%'));
        expect(a.pis.retido).toBe(false);
        expect(a.pis.mencionadoSemValor).toBe(true);
    });

    it('alíquota escrita SEM o % também é recusada', () => {
        const a = analisarRetencoes(nota('PIS 0,65 COFINS 3,00 CSLL 1,00'));
        expect(a.pis.retido).toBe(false);
        expect(a.cofins.retido).toBe(false);
    });

    it('ignora tributos aproximados do IBPT (Lei 12.741)', () => {
        const a = analisarRetencoes(nota('Trib aprox R$ 120,00 fonte IBPT — PIS 5,00'));
        expect(a.pis.retido).toBe(false);
    });
});

describe('citado sem valor não sai como conforme', () => {
    it('gera inconsistência em vez de "✓ ok"', () => {
        const linha = nota('Retencoes conforme legislacao: PIS, COFINS e CSLL');
        const a = analisarRetencoes(linha);
        const incs = validarRetencoesLinha(linha, a);
        const inc = incs.find(i => i.codigo === 'RETENCAO_CITADA_SEM_VALOR');
        expect(inc).toBeTruthy();
        expect(inc!.mensagem).toMatch(/PIS, COFINS, CSLL/);
        expect(inc!.mensagem).toMatch(/não conseguiu ler/);
    });

    it('nota que nem cita tributo não vira alerta (senão vira ruído)', () => {
        const linha = nota('Servicos de engenharia prestados em julho.');
        const incs = validarRetencoesLinha(linha, analisarRetencoes(linha));
        expect(incs.find(i => i.codigo === 'RETENCAO_CITADA_SEM_VALOR')).toBeFalsy();
    });
});

describe('mapa de colunas do CSV — coluna não reconhecida não some em silêncio', () => {
    it('cabeçalho do portal (Razão Social / Data de Emissão) passa a casar', () => {
        const csv = [
            'Tipo de NFS-e;Numero da NFS-e;Data de Emissao;CPF/CNPJ do Prestador;Razao Social do Prestador;'
            + 'CPF/CNPJ do Tomador;Razao Social do Tomador;Valor dos Servicos;ISS;Codigo do Servico;Discriminacao',
            'Emitida;781;03/07/2026;09246389000124;FRONTINI;59575753000178;TOMADOR LTDA;990,00;0,00;7.02;'
            + 'RETENCOES: PIS 6,44 COFINS 29,70 CSLL 9,90',
        ].join('\n');
        const linhas = parseCsvNfseSp(csv);
        expect(ultimoDiagnosticoCsv.colunasNaoReconhecidas).toEqual([]);
        expect(linhas[0].numero).toBe('781');
        expect(linhas[0].data).toBe('03/07/2026');
        expect(linhas[0].tomadorNome).toBe('TOMADOR LTDA');
        expect(linhas[0].valorServicos).toBe(990);
        const a = analisarRetencoes(linhas[0]);
        expect(a.totalRetido).toBeCloseTo(46.04, 2);
    });

    it('coluna fora do previsto é DENUNCIADA, com o cabeçalho lido', () => {
        const csv = ['Coluna A;Coluna B', 'x;y'].join('\n');
        parseCsvNfseSp(csv);
        expect(ultimoDiagnosticoCsv.colunasNaoReconhecidas).toContain('Discriminação');
        expect(ultimoDiagnosticoCsv.colunasNaoReconhecidas).toContain('Número');
        expect(ultimoDiagnosticoCsv.cabecalho).toEqual(['coluna a', 'coluna b']);
    });
});

describe('cabeçalho REAL do portal (05/08) — colunas dedicadas de retenção', () => {
    // Cabeçalho colado do painel de diagnóstico, com os nomes que o portal usa.
    const HEADER = [
        'tipo de registro', 'nº nfs-e', 'data hora nfe', 'código de verificação da nfs-e',
        'cpf/cnpj do prestador', 'razão social do prestador',
        'valor dos serviços', 'valor das deduções', 'código do serviço prestado na nota fiscal',
        'alíquota', 'iss devido', 'valor do crédito', 'iss retido',
        'cpf/cnpj do tomador', 'razão social do tomador',
        'pis/pasep', 'cofins', 'inss', 'ir', 'csll',
        'discriminação dos serviços',
    ].join(';');

    const linhaCsv = (over: Partial<Record<string, string>> = {}) => [
        'NFS-e', '781', '03/07/2026 17:21:22', 'ABC123',
        '09246389000124', 'FRONTINI ENGENHEIROS',
        '990,00', '0,00', '07498',
        '5,00', over.issDevido ?? '49,50', '0,00', over.issRetido ?? '0,00',
        '59575753000178', 'TOMADOR LTDA',
        over.pis ?? '6,44', over.cofins ?? '29,70', '0,00', '0,00', over.csll ?? '9,90',
        'Servicos de engenharia',
    ].join(';');

    it('lê PIS/COFINS/CSLL das COLUNAS — sem depender do texto', () => {
        const linhas = parseCsvNfseSp(`${HEADER}\n${linhaCsv()}`);
        const a = analisarRetencoes(linhas[0]);
        expect(a.pis.valor).toBe(6.44);
        expect(a.cofins.valor).toBe(29.70);
        expect(a.csll.valor).toBe(9.90);
        expect(a.pis.trechoEvidencia).toMatch(/coluna "pis\/pasep"/);
        expect(a.totalRetido).toBeCloseTo(46.04, 2);
    });

    it('ISS vem de "ISS retido", NÃO de "ISS devido"', () => {
        // "ISS devido" é o imposto da nota, recolhido pelo PRESTADOR — contar
        // isso como retenção infla o total com dinheiro que ninguém reteve.
        const a = analisarRetencoes(parseCsvNfseSp(`${HEADER}\n${linhaCsv()}`)[0]);
        expect(a.iss.retido).toBe(false);
        expect(a.iss.valor).toBe(0);
    });

    it('quando o tomador RETÉM o ISS, aí sim entra', () => {
        const a = analisarRetencoes(parseCsvNfseSp(`${HEADER}\n${linhaCsv({ issRetido: '49,50' })}`)[0]);
        expect(a.iss.retido).toBe(true);
        expect(a.iss.valor).toBe(49.50);
    });

    it('coluna zerada é "não retido" com evidência — não é "não lido"', () => {
        const a = analisarRetencoes(parseCsvNfseSp(
            `${HEADER}\n${linhaCsv({ pis: '0,00', cofins: '0,00', csll: '0,00' })}`,
        )[0]);
        expect(a.pis.retido).toBe(false);
        expect(a.pis.mencionadoSemValor).toBeFalsy();
        expect(a.pis.motivo).toMatch(/coluna "pis\/pasep" = 0,00/);
    });

    it('esse cabeçalho não gera aviso de coluna não reconhecida', () => {
        parseCsvNfseSp(`${HEADER}\n${linhaCsv()}`);
        expect(ultimoDiagnosticoCsv.colunasNaoReconhecidas).toEqual([]);
    });
});
