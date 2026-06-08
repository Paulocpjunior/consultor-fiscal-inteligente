/**
 * hooks/useOverridesInvoices.ts
 *
 * Consolida 2 grupos de estado da AnaliseCreditoExtrato:
 *
 * 1. Overrides CNPJ -> categoria (regras manuais persistidas em
 *    `categoria_fornecedor_regra`). Carregadas quando a empresa muda.
 *    Sobrepoem a classificacao automatica do parser.
 *
 * 2. Invoices manuais (Firestore: invoices_manuais) filtradas por
 *    empresa + periodo normalizado (MM/AAAA) do PDF efiscal carregado.
 *
 * O hook recebe empresaId + periodoNormalizado e recarrega cada lista
 * quando esses mudam ou quando o respectivo `*Versao` eh bumpado pra
 * forcar refresh (ex: apos salvar uma nova regra).
 */
import { useEffect, useState } from 'react';
import { carregarRegras } from '../services/categoriaFornecedorService';
import type { TipoDespesaCredito } from '../services/analiseCreditoExtratoService';
import { listarInvoicesManuais, type InvoiceManual } from '../services/invoicesManuaisService';

interface Return {
    overrides: Map<string, TipoDespesaCredito>;
    setOverrides: React.Dispatch<React.SetStateAction<Map<string, TipoDespesaCredito>>>;
    overridesVersao: number;
    setOverridesVersao: React.Dispatch<React.SetStateAction<number>>;

    invoicesManuais: InvoiceManual[];
    setInvoicesManuais: React.Dispatch<React.SetStateAction<InvoiceManual[]>>;
    invoicesVersao: number;
    setInvoicesVersao: React.Dispatch<React.SetStateAction<number>>;
}

export function useOverridesInvoices(
    empresaId: string | undefined,
    periodoNormalizado: string,
): Return {
    const [overrides, setOverrides] = useState<Map<string, TipoDespesaCredito>>(new Map());
    const [overridesVersao, setOverridesVersao] = useState(0);

    useEffect(() => {
        let ativo = true;
        if (!empresaId) { setOverrides(new Map()); return; }
        carregarRegras(empresaId).then(mapa => {
            if (ativo) setOverrides(mapa);
        });
        return () => { ativo = false; };
    }, [empresaId, overridesVersao]);

    const [invoicesManuais, setInvoicesManuais] = useState<InvoiceManual[]>([]);
    const [invoicesVersao, setInvoicesVersao] = useState(0);

    useEffect(() => {
        let ativo = true;
        if (!empresaId || !periodoNormalizado) { setInvoicesManuais([]); return; }
        listarInvoicesManuais(empresaId, periodoNormalizado).then(list => {
            if (ativo) setInvoicesManuais(list);
        });
        return () => { ativo = false; };
    }, [empresaId, periodoNormalizado, invoicesVersao]);

    return {
        overrides, setOverrides,
        overridesVersao, setOverridesVersao,
        invoicesManuais, setInvoicesManuais,
        invoicesVersao, setInvoicesVersao,
    };
}
