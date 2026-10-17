/**
 * 🧮 Proposta do "ICMS sobre Vendas" e do "ICMS ST (Destacado nas Vendas)" a
 * partir das notas de saída do mês (17/10, KROYA). A régua mora em
 * `services/icmsVendasProposto.ts`; aqui só se lê as notas, mostra por CFOP e
 * APLICA quando a pessoa manda. CFOP que não é venda (remessa, transferência)
 * a pessoa desmarca — o app não decide o que é receita.
 */
import React, { useMemo, useState } from 'react';
import type { DocumentoFiscal, User } from '../../types';
import { listDocumentos } from '../../services/xmlFiscalService';
import { proporIcmsDasVendas } from '../../services/icmsVendasProposto';

interface Props {
    currentUser: User | null | undefined;
    empresaId: string;
    empresaCnpj: string;
    competencia: string;
    onAplicar: (icmsVendas: number, icmsStFcp: number) => void;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const IcmsDasNotasProposto: React.FC<Props> = ({ currentUser, empresaId, empresaCnpj, competencia, onAplicar }) => {
    const [docs, setDocs] = useState<DocumentoFiscal[] | null>(null);
    const [lidoDe, setLidoDe] = useState('');
    const [fora, setFora] = useState<string[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [truncado, setTruncado] = useState(false);

    const proposta = useMemo(() => (docs ? proporIcmsDasVendas(docs, fora) : null), [docs, fora]);
    const desatualizado = !!docs && lidoDe !== `${empresaId}|${competencia}`;

    const ler = async () => {
        setCarregando(true); setErro(null);
        try {
            const meta: { truncado?: boolean; erro?: string } = {};
            const todos = await listDocumentos(currentUser || null, { competencia, empresaId, empresaCnpj }, meta);
            if (meta.erro) throw new Error(meta.erro);
            const cnpj = empresaCnpj.replace(/\D/g, '');
            setDocs(todos.filter(d => d.empresaId === empresaId || String(d.empresaCnpj || '').replace(/\D/g, '') === cnpj));
            setTruncado(!!meta.truncado);
            setLidoDe(`${empresaId}|${competencia}`);
            setFora([]);
        } catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
        } finally {
            setCarregando(false);
        }
    };

    return (
        <div className="col-span-1 md:col-span-2 p-3 rounded-lg border border-orange-200 dark:border-orange-800/40 bg-orange-50/50 dark:bg-orange-900/10 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-orange-700 dark:text-orange-300">🧮 ICMS das notas de saída de {competencia.split('-').reverse().join('/')}</span>
                <button type="button" onClick={ler} disabled={carregando || !empresaId || !competencia}
                    className="px-3 py-1 text-xs font-bold rounded bg-orange-600 text-white disabled:opacity-50">
                    {carregando ? 'lendo…' : docs ? '↻ Ler de novo' : '📥 Ler das notas'}
                </button>
                {proposta && !desatualizado && (
                    <button type="button" onClick={() => onAplicar(proposta.icmsVendas, proposta.icmsStFcp)}
                        className="px-3 py-1 text-xs font-bold rounded bg-emerald-700 text-white">
                        Aplicar: ICMS sobre vendas {brl(proposta.icmsVendas)} · ICMS-ST + FCP-ST {brl(proposta.icmsStFcp)}
                    </button>
                )}
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                ICMS próprio destacado vai em "ICMS sobre Vendas" (deduz só PIS/COFINS). ICMS-ST + FCP-ST destacados vão em "ICMS ST (Destacado nas
                Vendas)" (deduz a receita bruta de IRPJ/CSLL/PIS/COFINS). Desmarque o CFOP que não é venda. Só vale se o faturamento lançado na ficha
                for o valor total das notas (com o ST); se ele já vem sem o ST, não deduza de novo.
            </p>
            {erro && <p className="text-[11px] font-semibold text-red-700 dark:text-red-300">{erro}</p>}
            {desatualizado && <p className="text-[11px] text-amber-700 dark:text-amber-300">A empresa ou a competência mudou — leia de novo.</p>}
            {truncado && <p className="text-[11px] text-amber-700 dark:text-amber-300">⚠️ A competência tem mais documentos do que a leitura trouxe — a proposta pode estar a menor.</p>}
            {proposta && !desatualizado && (
                proposta.porCfop.length === 0
                    ? <p className="text-[11px] text-slate-500">Nenhuma saída com ICMS destacado nesta competência.</p>
                    : (
                        <table className="w-full text-[11px]">
                            <thead className="text-slate-500"><tr><th className="text-left">Entra</th><th className="text-left">CFOP</th><th className="text-right">Notas</th><th className="text-right">ICMS próprio</th><th className="text-right">ICMS-ST</th><th className="text-right">FCP-ST</th></tr></thead>
                            <tbody>
                                {proposta.porCfop.map(l => (
                                    <tr key={l.cfop} className={fora.includes(l.cfop) ? 'opacity-50' : ''}>
                                        <td><input type="checkbox" checked={!fora.includes(l.cfop)} onChange={() => setFora(f => (f.includes(l.cfop) ? f.filter(x => x !== l.cfop) : [...f, l.cfop]))} /></td>
                                        <td className="font-mono">{l.cfop}</td><td className="text-right">{l.notas}</td>
                                        <td className="text-right font-mono">{brl(l.icms)}</td><td className="text-right font-mono">{brl(l.icmsSt)}</td><td className="text-right font-mono">{brl(l.fcpSt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
            )}
        </div>
    );
};

export default IcmsDasNotasProposto;
