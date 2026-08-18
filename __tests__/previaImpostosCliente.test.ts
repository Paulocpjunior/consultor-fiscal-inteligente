/**
 * previaImpostosCliente — a prévia que vai ao CLIENTE.
 *
 * Paulo, 18/08: *"tem como criar um relatório ou algo similar à nossa ficha
 * financeira para que eu possa enviar ao cliente? Essa empresa me pede a prévia
 * dos impostos antes da emissão, até então enviava esse relatório do Excel"*.
 *
 * Os números são os da KROYA 07/2026, os mesmos da planilha dele — se a prévia
 * divergir da planilha, ela não substitui o Excel, só acrescenta uma terceira
 * versão da verdade.
 */
import { montarPreviaImpostos, competenciaEscrita } from '../services/previaImpostosCliente';
import { calcularLucro } from '../services/lucroService';
import type { LucroInput } from '../types';

const input: LucroInput = {
    regimeSelecionado: 'Presumido',
    // 'Mensal' porque JULHO não encerra trimestre — é assim que a ficha real da
    // KROYA está lançada, e é por isso que o PDF dela mostra IRPJ/CSLL 0,00 com
    // "fecha em 09/2026". Marcar 'Trimestral' aqui apuraria IRPJ no mês errado.
    periodoApuracao: 'Mensal',
    mesReferencia: '2026-07',
    faturamentoComercio: 99258.46,
    faturamentoIndustria: 0,
    faturamentoServico: 0,
    faturamentoMonofasico: 0,
    valorIpi: 14198.36,
    valorIcmsSt: 7.83,
    valorDevolucoes: 0,
    icmsVendas: 7768.70,
    receitaFinanceira: 0,
    despesasOperacionais: 0,
    folhaPagamento: 0,
    custoMercadoriaVendida: 0,
    // ICMS ST a recolher — é ele que fecha o "Total Desembolsos R$ 2.828,68" do
    // PDF real (502,34 + 2.318,51 + 7,83).
    icmsStRecolher: 7.83,
    issConfig: { tipo: 'aliquota_municipal', aliquota: 5 },
} as unknown as LucroInput;

const montar = (extra: any = {}) => montarPreviaImpostos({
    empresaNome: 'KROYA IMPORTADORA E DISTRIBUIDORA COMERCIAL LTDA',
    empresaCnpj: '01961491000108',
    competencia: '2026-07',
    resultado: calcularLucro(input),
    emitidoEm: new Date('2026-08-18T12:00:00Z'),
    ficha: {
        mesReferencia: '2026-07',
        saldoCredorIcms: 486477.01,
        saldoCredorIcmsTransportar: 521793.35,
        saldoCredorIpi: 5336.84,
        saldoCredorIpiTransportar: 4091.68,
        ...extra,
    },
});

/**
 * ⚠️ `toLocaleString` de moeda em pt-BR usa espaço NÃO-SEPARÁVEL entre "R$" e o
 * número. Comparar com espaço comum falha em silêncio e faz parecer que o valor
 * não está no papel — normalizar aqui é do TESTE, não do produto.
 */
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const texto = (p: ReturnType<typeof montar>) =>
    norm(p.linhas.map(l => l.join(' ')).join('\n') + '\n' + p.observacoes.join('\n'));

describe('a prévia reproduz a planilha da KROYA, linha a linha', () => {
    const p = montar();

    it('cabeçalho identifica empresa, CNPJ formatado e competência', () => {
        expect(p.titulo).toBe('Prévia de impostos');
        expect(p.subtitulo).toContain('Competência 07/2026');
        expect(p.subtitulo).toContain('01.961.491/0001-08');
        expect(p.subtitulo).toContain('KROYA');
        expect(p.fileName).toBe('previa-impostos-01961491000108-202607.pdf');
    });

    it('a memória traz as MESMAS deduções da planilha, incluindo o ICMS ST', () => {
        const t = texto(p);
        expect(t).toContain('R$ 99.258,46');   // faturamento bruto
        expect(t).toContain('R$ 14.198,36');   // IPI
        expect(t).toContain('R$ 7,83');        // ICMS ST — o que faltava na ficha
        expect(t).toContain('R$ 7.768,70');    // ICMS s/ vendas
        expect(t).toContain('R$ 85.052,27');   // base IRPJ/CSLL
        expect(t).toContain('R$ 77.283,57');   // base PIS/COFINS — o número dele
    });

    it('cada dedução carrega a razão — o cliente lê sem telefonar', () => {
        const t = texto(p);
        expect(t).toMatch(/DL 1\.598\/77/);
        expect(t).toMatch(/RE 574\.706/);
    });

    it('os impostos e o total saem do cálculo, sem conta própria', () => {
        const r = calcularLucro(input);
        // O total do PDF real da KROYA: R$ 2.828,68.
        expect(norm(p.totais[1])).toBe('R$ 2.828,68');
        expect(norm(p.totais[1])).toBe(norm(r.totalImpostos.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })));
        const t = texto(p);
        expect(t).toContain('R$ 502,34');    // PIS
        expect(t).toContain('R$ 2.318,51');  // COFINS
    });

    it('dedução inexistente NÃO vira linha de R$ 0,00', () => {
        const semSt = montarPreviaImpostos({
            empresaNome: 'X', competencia: '2026-07',
            resultado: calcularLucro({ ...input, valorIcmsSt: 0, valorDevolucoes: 0 }),
            ficha: { mesReferencia: '2026-07' },
            emitidoEm: new Date('2026-08-18T12:00:00Z'),
        });
        // ⚠️ A asserção é sobre a linha de DEDUÇÃO, não sobre o texto "ICMS ST":
        // o ICMS ST a RECOLHER continua (e deve continuar) na seção de impostos.
        // São dois fatos com o mesmo nome — dedução da receita × imposto a pagar.
        expect(semSt.linhas.some(l => l[0].startsWith('(−) ICMS ST'))).toBe(false);
        expect(semSt.linhas.some(l => l[0].startsWith('(−) Devoluções'))).toBe(false);
        expect(semSt.linhas.some(l => l[0] === 'ICMS ST')).toBe(true);
    });
});

describe('saldos credores na prévia', () => {
    it('mostra o que entrou E o que vai para o mês seguinte, nomeando a competência', () => {
        const t = texto(montar());
        expect(t).toContain('R$ 486.477,01');
        expect(t).toContain('R$ 521.793,35');
        expect(t).toMatch(/a transportar para 08\/2026/);
    });

    it('🚨 saldo não informado sai como "—" e com a ressalva NO CORPO do papel', () => {
        const p = montar({ saldoCredorIcmsTransportar: undefined, saldoCredorIpiTransportar: undefined });
        const t = texto(p);
        // Nunca R$ 0,00: o cliente leria como "não tenho mais crédito".
        expect(t).not.toMatch(/a transportar[^\n]*R\$ 0,00/);
        expect(t).toMatch(/não informado/);
        // E a ressalva também vai nas observações, não só na linha.
        expect(p.observacoes.some(o => /não informado/.test(o))).toBe(true);
    });

    it('empresa sem saldo nenhum não ganha a seção', () => {
        const p = montar({
            saldoCredorIcms: 0, saldoCredorIpi: 0,
            saldoCredorIcmsTransportar: undefined, saldoCredorIpiTransportar: undefined,
        });
        expect(texto(p)).not.toMatch(/SALDOS CREDORES/);
    });
});

describe('o papel diz o que ele é — e o que ele não é', () => {
    const p = montar();

    it('avisa que é PRÉVIA e que NÃO é guia de recolhimento', () => {
        const o = p.observacoes.join(' ');
        expect(o).toMatch(/PRÉVIA/);
        expect(o).toMatch(/NÃO é guia de recolhimento/);
        expect(o).toMatch(/Lucro Presumido/);
    });

    it('🚨 NÃO carrega o rodapé interno do app — nem a frase de IA', () => {
        const t = texto(p) + p.titulo + p.subtitulo;
        // Foi por isso que a ficha impressa não servia para o cliente.
        expect(t).not.toMatch(/gerada?s? por IA/i);
        expect(t).not.toMatch(/build|commit|Release/i);
        expect(t).not.toMatch(/LGPD/i);
    });

    it('a data de emissão é injetada — o módulo continua puro', () => {
        expect(p.observacoes.join(' ')).toContain('18/08/2026');
    });
});

describe('competenciaEscrita', () => {
    it('converte e não inventa quando não dá para ler', () => {
        expect(competenciaEscrita('2026-07')).toBe('07/2026');
        expect(competenciaEscrita('julho')).toBe('julho');
        expect(competenciaEscrita(null)).toBe('');
    });
});
