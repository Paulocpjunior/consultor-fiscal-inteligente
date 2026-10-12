/**
 * POST /api/dp-integration/pagamentos/consultar — DARF pago para a baixa do
 * "Pagamento de guias" do Consultor DP (PAGTOWEB/PAGAMENTOS71).
 *
 * O retorno usado aqui é o exemplo oficial da documentação do Integra Contador
 * (cenário "arrecadação via DARF"), já desserializado como o
 * invokeIntegraContador entrega.
 */
// @ts-nocheck — módulo .js do backend
import {
    SERVICO_PAGAMENTOS, SERVICO_COMPROVANTE, montarFiltroPagamentos, lerRetornoPagamentos, lerComprovante, normalizarNumeroDocumento,
} from '../sefaz-backend/dp-pagamentos.js';

const docOficial = {
    numeroDocumento: '9999999999',
    tipo: { codigo: '4', descricao: 'DOCUMENTO DE ARRECADAÇÃO DE RECEITAS FEDERAIS', descricaoAbreviada: 'DARF' },
    periodoApuracao: '2019-09-30T00:00:00-03:00',
    dataArrecadacao: '2019-09-30T00:00:00-03:00',
    dataVencimento: '2019-09-30T00:00:00-03:00',
    receitaPrincipal: { codigo: '481', descricao: 'IRRF - Juros e Comissões em Geral - Residentes no Exterior', extensaoReceita: null },
    referencia: null,
    valorTotal: 369176.53, valorPrincipal: 369176.53, valorMulta: null, valorJuros: null,
    valorSaldoTotal: null, valorSaldoPrincipal: null, valorSaldoMulta: null, valorSaldoJuros: null,
    desmembramentos: [{
        sequencial: '1',
        receitaPrincipal: { codigo: '481', descricao: 'IRRF - Juros e Comissões em Geral - Residentes no Exterior', extensaoReceita: null },
        periodoApuracao: '2019-09-30T00:00:00-03:00', dataVencimento: '2019-09-30T00:00:00-03:00',
        valorTotal: null, valorPrincipal: null, valorMulta: null, valorJuros: null,
        valorSaldoTotal: null, valorSaldoPrincipal: null, valorSaldoMulta: null, valorSaldoJuros: null,
    }],
};
const sucesso = (dados) => ({ status: 200, dados, mensagens: [{ codigo: 'Sucesso-PAGTOWEB-00000', texto: 'Requisição efetuada com sucesso.' }] });

describe('DARF pago pelo túnel do DP › pedido', () => {
    it('serviço e versão do leiaute oficial', () => {
        expect(SERVICO_PAGAMENTOS).toEqual({ idSistema: 'PAGTOWEB', idServico: 'PAGAMENTOS71', versaoSistema: '1.0' });
    });

    it('por número do documento: sem pontuação, sem repetir, página de 100 começando em 0', () => {
        const f = montarFiltroPagamentos({ numerosDocumento: ['07.20.26252.7312345-6', '07202625273123456'] });
        expect(f.dados).toEqual({ numeroDocumentoLista: ['07202625273123456'], primeiroDaPagina: 0, tamanhoDaPagina: 100 });
        expect(f.numerosDocumento).toEqual(['07202625273123456']);
    });

    it('por intervalo de arrecadação, com códigos de receita', () => {
        const f = montarFiltroPagamentos({ dataInicial: '2026-10-01', dataFinal: '2026-10-31', codigosReceita: ['1082', '1082', '0561'] });
        expect(f.dados).toEqual({
            intervaloDataArrecadacao: { dataInicial: '2026-10-01', dataFinal: '2026-10-31' },
            codigoReceitaLista: ['1082', '0561'], primeiroDaPagina: 0, tamanhoDaPagina: 100,
        });
    });

    it('sem número nem datas não consulta (não puxa o histórico inteiro)', () => {
        expect(montarFiltroPagamentos({}).erro).toMatch(/números dos documentos ou o intervalo/);
        expect(montarFiltroPagamentos({ codigosReceita: ['1082'] }).erro).toMatch(/números dos documentos ou o intervalo/);
    });

    it('recusa número com mais de 17 posições, data inválida, intervalo pela metade ou invertido, página fora do leiaute', () => {
        expect(montarFiltroPagamentos({ numerosDocumento: ['123456789012345678'] }).erro).toMatch(/17 posições/);
        expect(montarFiltroPagamentos({ dataInicial: '2026-02-30', dataFinal: '2026-03-01' }).erro).toMatch(/AAAA-MM-DD/);
        expect(montarFiltroPagamentos({ dataInicial: '2026-10-01' }).erro).toMatch(/juntas/);
        expect(montarFiltroPagamentos({ dataInicial: '2026-10-31', dataFinal: '2026-10-01' }).erro).toMatch(/depois/);
        expect(montarFiltroPagamentos({ numerosDocumento: ['1'], tamanhoDaPagina: 101 }).erro).toMatch(/entre 1 e 100/);
        expect(montarFiltroPagamentos({ numerosDocumento: ['1'], primeiroDaPagina: -1 }).erro).toMatch(/a partir de 0/);
        expect(montarFiltroPagamentos({ numerosDocumento: ['1'], codigosReceita: ['10820'] }).erro).toMatch(/até 4 dígitos/);
    });

    it('normaliza o número do documento', () => {
        expect(normalizarNumeroDocumento(' 07.20.26252.7312345-6 ')).toBe('07202625273123456');
        expect(normalizarNumeroDocumento('')).toBeNull();
    });
});

describe('DARF pago pelo túnel do DP › retorno', () => {
    it('lê o exemplo oficial: data de arrecadação, receita, valores e desmembramentos', () => {
        const r = lerRetornoPagamentos(sucesso([docOficial]), { numerosDocumento: ['9999999999'], tamanhoDaPagina: 100 });
        expect(r.ok).toBe(true);
        expect(r.fonte).toBe('serpro');
        const [d] = r.documentos;
        expect(d).toMatchObject({
            numeroDocumento: '9999999999', tipo: { codigo: '4', sigla: 'DARF' },
            periodoApuracao: '2019-09-30', dataArrecadacao: '2019-09-30', dataVencimento: '2019-09-30',
            receita: { codigo: '481', extensao: null }, valorTotal: 369176.53, valorPrincipal: 369176.53,
        });
        expect(d.desmembramentos[0]).toMatchObject({ sequencial: '1', receita: { codigo: '481' } });
        expect(r.situacoes).toEqual([{ numeroDocumento: '9999999999', localizado: true, pagamento: d }]);
        expect(r.podeHaverMais).toBe(false);
    });

    it('ausente não vira zero: multa e juros null continuam null', () => {
        const [d] = lerRetornoPagamentos(sucesso([docOficial]), { numerosDocumento: ['9999999999'] }).documentos;
        expect(d.valorMulta).toBeNull();
        expect(d.valorJuros).toBeNull();
        expect(d.desmembramentos[0].valorTotal).toBeNull();
    });

    it('documento pedido e não localizado é "não localizado", nunca "não pago"', () => {
        const r = lerRetornoPagamentos(sucesso([]), { numerosDocumento: ['12345678901234567'] });
        expect(r.ok).toBe(true);
        expect(r.situacoes[0]).toMatchObject({ localizado: false, pagamento: null });
        expect(r.situacoes[0].observacao).toMatch(/não quer dizer que não foi pago/);
    });

    it('documento que volta sem ter sido pedido fica de fora, com aviso', () => {
        const r = lerRetornoPagamentos(sucesso([docOficial, { ...docOficial, numeroDocumento: '8888888888' }]), { numerosDocumento: ['9999999999'] });
        expect(r.documentos.map((d) => d.numeroDocumento)).toEqual(['9999999999']);
        expect(r.avisos.join(' ')).toMatch(/sem ter sido pedido/);
    });

    it('sem lista no retorno volta ok=false — nada é dado como pago nem como não pago', () => {
        const r = lerRetornoPagamentos({ status: 200, dados: null, mensagens: [{ codigo: 'Aviso-PAGTOWEB-1', texto: 'Serviço indisponível.' }] }, { numerosDocumento: ['9999999999'] });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/Serviço indisponível/);
        expect(r.situacoes).toBeUndefined();
    });

    it('resposta simulada (SERPRO_DRY_RUN) nunca chega ao DP como pagamento', () => {
        const dry = { status: 200, dados: { _dryRun: true, idSistema: 'PAGTOWEB', idServico: 'PAGAMENTOS71' }, mensagens: [] };
        expect(lerRetornoPagamentos(dry, { numerosDocumento: ['9999999999'] })).toMatchObject({ ok: false, fonte: 'dry_run' });
        expect(lerRetornoPagamentos(sucesso([docOficial]), { numerosDocumento: ['9999999999'], dryRun: true }).ok).toBe(false);
    });

    it('página cheia avisa que pode haver mais', () => {
        const r = lerRetornoPagamentos(sucesso([docOficial]), { tamanhoDaPagina: 1 });
        expect(r.podeHaverMais).toBe(true);
    });

    it('sem data de arrecadação ou valor total, avisa em vez de inventar', () => {
        const r = lerRetornoPagamentos(sucesso([{ ...docOficial, dataArrecadacao: null, valorTotal: null }]), { numerosDocumento: ['9999999999'] });
        expect(r.documentos[0].dataArrecadacao).toBeNull();
        expect(r.avisos.join(' ')).toMatch(/data de arrecadação/);
        expect(r.avisos.join(' ')).toMatch(/valor total/);
    });
});

describe('comprovante de arrecadação (COMPARRECADACAO72)', () => {
    // Início real de um PDF em base64 ("%PDF-1.7"), como no exemplo oficial.
    const pdf = 'JVBERi0xLjcNJeLjz9MNCjEgMCBvYmoNPDwv';

    it('serviço e versão do leiaute oficial', () => {
        expect(SERVICO_COMPROVANTE).toEqual({ idSistema: 'PAGTOWEB', idServico: 'COMPARRECADACAO72', versaoSistema: '1.0' });
    });

    it('aceita as duas formas documentadas: {pdf} (exemplo) e a string base64 (tabela)', () => {
        expect(lerComprovante({ status: 200, dados: { pdf }, mensagens: [] })).toEqual({ ok: true, fonte: 'serpro', pdfBase64: pdf, mensagens: [] });
        expect(lerComprovante({ status: 200, dados: `${pdf.slice(0, 10)}\n${pdf.slice(10)}`, mensagens: [] }).pdfBase64).toBe(pdf);
    });

    it('o que não é PDF não passa, com a mensagem do SERPRO', () => {
        const r = lerComprovante({ status: 200, dados: { pdf: 'PGh0bWw+' }, mensagens: [{ codigo: 'Aviso-PAGTOWEB-1', texto: 'Documento não encontrado.' }] });
        expect(r).toMatchObject({ ok: false, fonte: 'serpro' });
        expect(r.error).toMatch(/Documento não encontrado/);
        expect(lerComprovante({ status: 200, dados: null, mensagens: [] }).ok).toBe(false);
    });

    it('modo simulado nunca devolve comprovante', () => {
        expect(lerComprovante({ status: 200, dados: { _dryRun: true }, mensagens: [] })).toMatchObject({ ok: false, fonte: 'dry_run' });
        expect(lerComprovante({ status: 200, dados: { pdf }, mensagens: [] }, { dryRun: true }).ok).toBe(false);
    });
});

