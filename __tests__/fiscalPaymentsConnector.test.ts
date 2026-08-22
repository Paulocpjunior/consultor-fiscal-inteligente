// @ts-nocheck
import { consultarPagamentosTributarios, _test } from '../sefaz-backend/fiscal-payments-connector.js';

const CNPJ = '12345678000190';

function snapDoc(id: string, data: any) {
    return { id, data: () => data };
}

function fakeDb(colecoes: Record<string, any[]>) {
    return {
        collection(nome: string) {
            const base = colecoes[nome] || [];
            const filtros: Array<[string, any]> = [];
            const query: any = {
                where(campo: string, _op: string, valor: any) { filtros.push([campo, valor]); return query; },
                limit() { return query; },
                startAfter() { return query; },
                async get() {
                    const docs = base.filter(x => filtros.every(([c, v]) => x.data[c] === v)).map(x => snapDoc(x.id, x.data));
                    return { empty: docs.length === 0, size: docs.length, docs };
                },
                doc(id: string) {
                    return {
                        async get() {
                            const x = base.find(v => v.id === id);
                            return x ? { exists: true, data: () => x.data } : { exists: false, data: () => ({}) };
                        },
                    };
                },
            };
            return query;
        },
    };
}

describe('conector de pagamentos fiscais', () => {
    it('nao contabiliza marcacao local de pago sem comprovante oficial', () => {
        const item = _test.normalizarEmissao('DARF', snapDoc('d1', {
            empresaCnpj: CNPJ, tributo: 'IRPJ', valor: 100000,
            statusPagamento: 'pago', numeroDocumento: 'DARF-1', competencia: '2026-07',
        }), new Map());
        expect(item.status).toBe('EM_ANALISE');
        expect(item.valor_pago).toBe(0);
        expect(item.valor_informado_pago).toBe(100000);
        expect(item.contabilizavel).toBe(false);
    });

    it('aceita comprovante oficial somente com fonte, CNPJ, valor e identificador', () => {
        const ok = _test.normalizarComprovante(snapDoc('p1', {
            empresaCnpj: CNPJ, fonte: 'ECAC', confirmacaoOficial: true,
            valorPago: 98765.43, identificador: 'REC-123', tributo: 'IRPJ',
        }), CNPJ);
        expect(ok.contabilizavel).toBe(true);
        expect(ok.valor_pago).toBe(98765.43);

        const semProva = _test.normalizarComprovante(snapDoc('p2', {
            empresaCnpj: CNPJ, fonte: 'manual', confirmacaoOficial: true,
            valorPago: 98765.43, identificador: 'REC-124',
        }), CNPJ);
        expect(semProva).toBeNull();
    });

    it('agrega DAS e todos os DARFs sem truncar e separa confirmado de informado', async () => {
        const db = fakeDb({
            das_emitidos: [{ id: 'das1', data: { empresaCnpj: CNPJ, competencia: '2026-07', valor: 100, statusPagamento: 'pago', numeroDocumento: 'DAS-1' } }],
            darfs_emitidos: [
                { id: 'irpj', data: { empresaCnpj: CNPJ, competencia: '2026-07', tributo: 'IRPJ', valor: 200, statusPagamento: 'pago', numeroDocumento: 'DARF-IRPJ' } },
                { id: 'pis', data: { empresaCnpj: CNPJ, competencia: '2026-07', tributo: 'PIS', valor: 300, statusPagamento: 'pendente', numeroDocumento: 'DARF-PIS' } },
            ],
            dctfweb_declaracoes: [{ id: 'dc1', data: { empresaCnpj: CNPJ, anoPA: 2026, mesPA: 7, situacao: 'ATIVA' } }],
            fiscal_pagamentos_oficiais: [{ id: 'pg1', data: { empresaCnpj: CNPJ, fonte: 'RECEITA_ECAC', confirmacaoOficial: true, valorPago: 200, identificador: 'REC-IRPJ', numeroDocumento: 'DARF-IRPJ', tributo: 'IRPJ', competencia: '2026-07', dataPagamento: '2026-08-20' } }],
            simples_empresas: [{ id: 'emp1', data: { cnpj: CNPJ, procuracaoEcacAtiva: true } }],
            sefaz_certificados: [{ id: 'atual', data: { validade: { fim: '2099-01-01T00:00:00.000Z' } } }],
        });
        const r = await consultarPagamentosTributarios(CNPJ, {
            db,
            competencia: '2026-07',
            deps: {
                acharEmpresa: async () => ({ empresaId: 'emp1', colecao: 'simples_empresas', cnpj: CNPJ }),
                getCertInfo: async () => null,
            },
        });
        expect(r.contrato).toBe('fiscal_pagamentos_v1');
        expect(r.itens.map((x: any) => x.tributo).sort()).toEqual(['DAS', 'IRPJ', 'PIS']);
        expect(r.resumo.confirmados).toBe(1);
        expect(r.resumo.valor_pago_confirmado).toBe(200);
        expect(r.resumo.aguardando_comprovante).toBe(1);
        expect(r.resumo.valor_informado_nao_confirmado).toBe(100);
        expect(r.cobertura.dctfweb.declaracoes).toBe(1);
        expect(r.credencial.tipo).toBe('certificado_escritorio_procuracao');
    });
});
