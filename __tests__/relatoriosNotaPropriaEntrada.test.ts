// ============================================================================
// 🚨 OS RELATÓRIOS LIAM A DIREÇÃO CRUA — e são eles que o colaborador compara
// com o SPED e com o arquivo do SAGE
//
// A nota PRÓPRIA DE ENTRADA (art. 136 — a compra de produtor rural PF, que o
// adquirente é quem emite) fica gravada como `direcao: 'saida'` até o backfill
// do sync-cron passar. Lida crua, ela:
//
//   · aparecia como SAÍDA no Resumo por CFOP — com um CFOP **1xxx** ao lado;
//   · somava ICMS/IPI no **DÉBITO** em vez do crédito (é o achado 16, que já
//     tinha mordido o E110), errando para os DOIS lados;
//   · sumia da lista de FORNECEDORES e do Por produto de entrada.
//
// Depois de 22/08 o SPED e o `.FML` lêem pela régua. O relatório tinha de ler
// igual — senão a tela discorda do arquivo, que é a família do "conferência
// que promete número diferente do arquivo" (12/08).
// ============================================================================
import {
    resumoPorCfop, resumoImpostos, resumoPorParticipante, contraparteDoc,
} from '../services/relatoriosAgregacoes';
import type { DocumentoFiscal } from '../types';

const CNPJ_EMPRESA = '31947349000169';

/** A compra de produtor: tpNF=0, o cliente no emitente, o produtor no dest. */
const compraDeProdutor = (): DocumentoFiscal => ({
    id: 'np1',
    chave: '35260731947349000169550010000034853106861510',
    numero: '3485',
    tipo: 'NFe',
    tipoDoc: 'NFe',
    dhEmi: '2026-07-10T10:00:00-03:00',
    // 🔴 O CAMPO MENTE — é assim que ela fica gravada.
    direcao: 'saida',
    tpNF: '0',
    status: 'autorizado',
    empresaCnpj: CNPJ_EMPRESA,
    cnpjEmit: CNPJ_EMPRESA,
    emitente: { cnpjCpf: CNPJ_EMPRESA, nome: 'CLIENTE LTDA' },
    destinatario: { cnpjCpf: '12345678901', nome: 'JOSE PRODUTOR', uf: 'SP' },
    cnpjDest: '12345678901',
    xNomeDest: 'JOSE PRODUTOR',
    ufDest: 'SP',
    totais: { vNF: 1000, vICMS: 120 },
    itens: [{ cfop: '1101', vProd: 1000, vDesc: 0, vICMS: 120, vIPI: 0, cst: '000', xProd: 'BANANA' }],
} as unknown as DocumentoFiscal);

const ctx = { naturezaAtividade: null, cfopOverrides: null } as any;

describe('🚨 compra de produtor rural nos relatórios', () => {
    it('o ICMS entra como CRÉDITO de entrada, não como débito de saída', () => {
        const r = resumoImpostos([compraDeProdutor()]);
        expect(r.icms.creditoEntradas).toBe(120);
        expect(r.icms.debitoSaidas).toBe(0);
    });

    it('no Resumo por CFOP a linha é de ENTRADA — não "saída com CFOP 1101"', () => {
        const linhas = resumoPorCfop([compraDeProdutor()], ctx);
        expect(linhas.length).toBe(1);
        expect(linhas[0].direcao).toBe('entrada');
        expect(String(linhas[0].cfop).charAt(0)).toBe('1');
    });

    it('o produtor aparece como FORNECEDOR, e não como cliente', () => {
        const fornecedores = resumoPorParticipante([compraDeProdutor()], 'entrada');
        expect(fornecedores.map((l) => l.nome)).toContain('JOSE PRODUTOR');
        expect(resumoPorParticipante([compraDeProdutor()], 'saida')).toHaveLength(0);
    });

    // A contraparte já era lida certo — a régua estava ali, só não valia para
    // o resto do arquivo.
    it('e a contraparte continua sendo o produtor', () => {
        expect(contraparteDoc(compraDeProdutor())?.nome).toBe('JOSE PRODUTOR');
    });
});

describe('🚨 a venda normal não muda', () => {
    const venda = (): DocumentoFiscal => ({
        ...compraDeProdutor(),
        tpNF: '1',
        itens: [{ cfop: '5102', vProd: 1000, vDesc: 0, vICMS: 120, vIPI: 0, cst: '000', xProd: 'BANANA' }],
    } as unknown as DocumentoFiscal);

    it('segue como débito de saída', () => {
        const r = resumoImpostos([venda()]);
        expect(r.icms.debitoSaidas).toBe(120);
        expect(r.icms.creditoEntradas).toBe(0);
    });

    it('e a linha do CFOP é de saída', () => {
        expect(resumoPorCfop([venda()], ctx)[0].direcao).toBe('saida');
    });
});
