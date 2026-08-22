// ============================================================================
// 🚨 A CENTRAL DE DOCUMENTOS DIZIA "SAÍDA" NA NOTA QUE O SPED ESCRITURA COMO
// ENTRADA
//
// A nota PRÓPRIA DE ENTRADA (art. 136 do RICMS/SP — a compra de produtor rural
// PF, que o ADQUIRENTE é quem emite) fica gravada como `direcao: 'saida'` até
// o backfill do sync-cron passar. Quem decide na LEITURA é `direcaoEfetivaDoc`,
// pelo `tpNF`.
//
// Em 22/08 o SPED, o `.FML`, o preflight e os relatórios passaram a ler pela
// régua. Sobrou a tela onde o colaborador PROCURA o documento:
//
//   · o **filtro** — pedindo ENTRADAS, a nota sumia; pedindo SAÍDAS, ela
//     aparecia. Ou seja: a compra de produtor rural era invisível na lista de
//     entradas de todo cliente que compra de produtor;
//   · a **lista**, o **CSV** e o **PDF** — todos leem `getView(d).direcao`,
//     que preferia o campo cru;
//   · e a **contraparte** do CSV, que sai de `direcao === 'entrada'`: com a
//     direção errada, a coluna trazia o lado errado do documento.
//
// É a régua de 22/08, literal: **corrigir o gerador sem corrigir quem procura
// o documento cria a divergência que a casa mais paga.**
// ============================================================================
import { getView } from '../services/xmlDocumentoView';
import { applyDocumentosFilters } from '../services/xmlDocumentosFilter';
import type { DocumentoFiscal } from '../types';

const CNPJ_EMPRESA = '31947349000169';

/** A nota que o CLIENTE emite da própria compra: tpNF=0, ele no emitente. */
const compraDeProdutor = (over: any = {}): DocumentoFiscal => ({
    id: 'np1',
    chave: '35260731947349000169550010000034853106861510',
    numero: '3485',
    serie: '1',
    tipo: 'NFe',
    dhEmi: '2026-07-10T10:00:00-03:00',
    competencia: '2026-07',
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
    totais: { vNF: 1000 },
    ...over,
} as unknown as DocumentoFiscal);

/** Venda normal — o caso comum, que a correção não pode inverter. */
const venda = () => compraDeProdutor({ id: 'v1', tpNF: '1' });

describe('🚨 a lista lê a direção pelo DONO', () => {
    it('a compra de produtor aparece como ENTRADA', () => {
        expect(getView(compraDeProdutor()).direcao).toBe('entrada');
    });

    it('e a venda continua SAÍDA — a régua não inverte o caso comum', () => {
        expect(getView(venda()).direcao).toBe('saida');
    });

    // O fallback pelo CNPJ existe para o resumo (resNFe), que chega sem
    // direção legível. Ele não pode ser atropelado.
    it('sem direção legível, o fallback pelo CNPJ continua valendo', () => {
        const resumo = compraDeProdutor({ direcao: 'desconhecida', tpNF: null, cnpjEmit: '99999999000199', emitente: { cnpjCpf: '99999999000199' } });
        expect(getView(resumo).direcao).toBe('entrada');
    });
});

describe('🚨 o FILTRO — era aqui que a nota sumia', () => {
    const filtrar = (docs: DocumentoFiscal[], direcao: 'entrada' | 'saida') =>
        applyDocumentosFilters(docs, { direcao }).map((d) => d.id);

    it('filtrando por ENTRADAS a compra de produtor aparece', () => {
        expect(filtrar([compraDeProdutor()], 'entrada')).toEqual(['np1']);
    });

    it('e filtrando por SAÍDAS ela NÃO aparece', () => {
        expect(filtrar([compraDeProdutor()], 'saida')).toEqual([]);
    });

    it('a venda normal segue do lado dela nos dois filtros', () => {
        expect(filtrar([venda()], 'saida')).toEqual(['v1']);
        expect(filtrar([venda()], 'entrada')).toEqual([]);
    });

    it('e a lista sem filtro de direção continua trazendo as duas', () => {
        expect(applyDocumentosFilters([compraDeProdutor(), venda()], {})).toHaveLength(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 E O ARQUIVO DO FISCO SE CONTRADIZIA: o SPED Fiscal declarava a MESMA nota
// como SAÍDA
//
// Três leituras cruas no C100/C170/C190 do EFD ICMS/IPI:
//
//   · **IND_OPER** (C100 campo 2) saía **1 (saída)** — no MESMO registro cujo
//     IND_EMIT logo abaixo já reconhecia a emissão própria de entrada;
//   · a **correlação de CFOP** do C170 e do C190 recebia a direção crua, então
//     o CFOP saía **5102** — enquanto o `.FML` do SAGE grava 1102 (corrigido
//     hoje de manhã) e o E110 já soma como CRÉDITO. Dois arquivos do mesmo mês
//     declarando CFOPs diferentes para a mesma nota, e o C190 é o que a
//     apuração soma.
// ═══════════════════════════════════════════════════════════════════════════
// @ts-expect-error — módulo backend .js sem .d.ts
import { convertCfopParaEntrada } from '../sefaz-backend/sped-fiscal-blocoC.js';

describe('🚨 o SPED Fiscal e o .FML declaram o MESMO lado', () => {
    const dados = { empresa: { cnpj: CNPJ_EMPRESA, dadosFiscais: {} } };

    it('a compra de produtor sai com CFOP de ENTRADA no C170/C190', () => {
        const doc = compraDeProdutor();
        expect(convertCfopParaEntrada('5102', getView(doc).direcao, dados, doc)).toBe('1102');
    });

    it('e a venda normal continua 5102 — a régua não inverte o caso comum', () => {
        const doc = venda();
        expect(convertCfopParaEntrada('5102', getView(doc).direcao, dados, doc)).toBe('5102');
    });

    // A leitura da tela e a do arquivo têm de dar o MESMO lado: é isso que
    // impede o colaborador de conferir um número que o arquivo não tem.
    it('a tela e o arquivo concordam sobre o lado da nota', () => {
        for (const doc of [compraDeProdutor(), venda()]) {
            const daTela = getView(doc).direcao;
            const doArquivo = convertCfopParaEntrada('5102', daTela, dados, doc);
            expect({ daTela, primeiro: String(doArquivo)[0] })
                .toEqual({ daTela, primeiro: daTela === 'entrada' ? '1' : '5' });
        }
    });
});
