/**
 * DareSpModal — preview conferível + registro de DARE-SP (ICMS) a partir da
 * apuração. "Não pode haver erros": o modal NÃO emite guia — ele valida os
 * dados no backend (mesma regra dos DAREs reais), mostra o preview campo a
 * campo, registra a solicitação (auditoria) e leva a equipe ao portal DARE
 * com os dados prontos pra colar. Número/código de barras são SEMPRE do
 * sistema da SEFAZ-SP (emissão no portal hoje; API oficial quando o
 * credenciamento sair).
 */
import React, { useState } from 'react';
import { previewDare, registrarDare, type DarePayload } from '../../services/dareSpService';

interface Props {
    cnpj: string;
    razaoSocial: string;
    empresaId?: string;
    competencia: string;             // 'AAAA-MM' (fichaMes)
    valorInicial: number;
    derivacaoInicial: 'proprio' | 'st';
    onClose: () => void;
}

const OPCOES = [
    { codigoServico: '04601', label: 'ICMS Próprio (RPA) — 046-2 / 04601' },
    { codigoServico: '14601', label: 'ICMS-ST (RPA) — 146-6 / 14601' },
];

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DareSpModal: React.FC<Props> = ({ cnpj, razaoSocial, empresaId, competencia, valorInicial, derivacaoInicial, onClose }) => {
    const [codigoServico, setCodigoServico] = useState(derivacaoInicial === 'st' ? '14601' : '04601');
    const [valor, setValor] = useState(String(valorInicial.toFixed(2)));
    // Vencimento NUNCA é chutado: depende do CPR/calendário da empresa —
    // o colaborador informa a data oficial do vencimento do imposto.
    const [vencimento, setVencimento] = useState('');
    const [preview, setPreview] = useState<DarePayload | null>(null);
    const [linhaTxt, setLinhaTxt] = useState<string | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [copiado, setCopiado] = useState(false);
    const [ocupado, setOcupado] = useState(false);

    const inputAtual = () => ({
        cnpj, razaoSocial, empresaId, codigoServico,
        referencia: competencia,
        valor: Number(String(valor).replace(',', '.')),
        vencimento,
    });

    const conferir = async () => {
        setOcupado(true); setErro(null); setPreview(null); setLinhaTxt(null);
        try {
            const r = await previewDare(inputAtual());
            if (r.ok && r.payload) {
                setPreview(r.payload);
                setLinhaTxt(r.linhaTxt || null);
            } else setErro(r.error || 'Falha ao validar.');
        } catch (e: any) {
            setErro(e?.message || 'Falha ao validar.');
        } finally {
            setOcupado(false);
        }
    };

    const textoConferencia = (p: DarePayload) => [
        `DARE-SP — ${p.descricao}`,
        `Contribuinte: ${p.contribuinte.razaoSocial} — CNPJ ${p.contribuinte.cnpj}`,
        `Código de receita: ${p.codigoReceita} · Serviço: ${p.sefaz} (${p.codigoServico})`,
        `Referência: ${p.referencia}`,
        `Vencimento: ${p.vencimento.split('-').reverse().join('/')}`,
        `Valor: ${fmtBRL(p.valor)}`,
    ].join('\n');

    // Caminho RÁPIDO da emissão individual (24/07, "inúmeras empresas com
    // diversos colaboradores"): a página de colar TXT do portal aceita 1 linha
    // só — o colaborador cola UMA linha em vez de digitar 6 campos no
    // formulário unitário. Copiar registra a auditoria.
    const copiarERegistrar = async (conteudo: string) => {
        if (!preview) return;
        setOcupado(true);
        try {
            navigator.clipboard.writeText(conteudo);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2500);
            // Auditoria: registra quem gerou o quê ANTES da emissão no portal.
            await registrarDare(inputAtual());
        } catch (e: any) {
            setErro(e?.message || 'Falha ao registrar.');
        } finally {
            setOcupado(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[80]" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">🧾 DARE-SP (ICMS) — preview e emissão</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {razaoSocial} · CNPJ {cnpj} · referência {competencia.split('-').reverse().join('/')}
                </p>

                <div className="grid grid-cols-1 gap-3">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Derivação do ICMS
                        <select value={codigoServico} onChange={e => { setCodigoServico(e.target.value); setPreview(null); }}
                            className="mt-1 w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm">
                            {OPCOES.map(o => <option key={o.codigoServico} value={o.codigoServico}>{o.label}</option>)}
                        </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Valor (R$)
                            <input value={valor} onChange={e => { setValor(e.target.value); setPreview(null); }}
                                className="mt-1 w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm font-mono" />
                        </label>
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Vencimento do imposto
                            <input type="date" value={vencimento} onChange={e => { setVencimento(e.target.value); setPreview(null); }}
                                className="mt-1 w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm" />
                        </label>
                    </div>
                </div>

                {erro && <div className="text-xs text-red-700 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2">{erro}</div>}

                {!preview && (
                    <button onClick={conferir} disabled={ocupado}
                        className="w-full px-4 py-2 text-sm font-bold rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white">
                        {ocupado ? '⏳ Validando…' : '🔎 Conferir (preview obrigatório)'}
                    </button>
                )}

                {preview && (
                    <div className="space-y-3">
                        {/* Preview campo a campo — mesmos campos do DARE real. */}
                        <div className="border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 text-xs space-y-1">
                            <div className="font-bold text-emerald-800 dark:text-emerald-300">{preview.descricao}</div>
                            <div className="flex justify-between"><span>Código de receita:</span><span className="font-mono font-bold">{preview.codigoReceita} · {preview.sefaz}</span></div>
                            <div className="flex justify-between"><span>Referência:</span><span className="font-mono">{preview.referencia}</span></div>
                            <div className="flex justify-between"><span>Vencimento:</span><span className="font-mono">{preview.vencimento.split('-').reverse().join('/')}</span></div>
                            <div className="flex justify-between text-sm"><span className="font-bold">Valor:</span><span className="font-mono font-bold">{fmtBRL(preview.valor)}</span></div>
                        </div>
                        {linhaTxt && (
                            <pre className="bg-slate-900 text-emerald-300 text-[11px] p-2 rounded-lg overflow-x-auto">{linhaTxt}</pre>
                        )}
                        <div className="flex gap-2 flex-wrap">
                            {linhaTxt ? (
                                <button onClick={() => copiarERegistrar(linhaTxt)} disabled={ocupado}
                                    className="flex-1 px-3 py-2 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white"
                                    title="Cola essa linha no portal (Dare em Lote → 'CLIQUE AQUI' de colar .txt) e o DARE sai pronto — 1 colada em vez de 6 campos">
                                    {copiado ? '✓ Copiado + registrado!' : '📋 Copiar linha p/ portal (1 colada)'}
                                </button>
                            ) : (
                                <button onClick={() => copiarERegistrar(textoConferencia(preview))} disabled={ocupado}
                                    className="flex-1 px-3 py-2 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white">
                                    {copiado ? '✓ Copiado + registrado!' : '📋 Copiar dados (registra auditoria)'}
                                </button>
                            )}
                            <a href={linhaTxt ? 'https://www4.fazenda.sp.gov.br/DareICMS/DareLote' : preview.portalUrl} target="_blank" rel="noreferrer"
                                className="px-3 py-2 text-sm font-bold rounded-lg border border-sky-400 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/30">
                                🌐 Portal DARE
                            </a>
                        </div>
                        <p className="text-[10px] text-slate-400">
                            {linhaTxt
                                ? <>No portal: <strong>"Você já tem todos os dados… CLIQUE AQUI"</strong> → cola a linha → Gerar Dare → baixa o DARE. O número e o código de barras são emitidos pelo sistema da SEFAZ-SP.</>
                                : <>O número do DARE e o código de barras são emitidos pelo sistema da SEFAZ-SP — cole os dados no portal e confira antes de gerar.</>}
                            {' '}(Emissão direta via API oficial entra quando o credenciamento da SEFAZ for aprovado.)
                        </p>
                    </div>
                )}

                {/* Reconhecimento do portal (admin): baixa a estrutura real das
                    páginas DareAvulso/Lote/GnreLote — ground-truth pra automação
                    do lote XML-GNRE. Backend exige admin (403 pra demais). */}
                <button
                    onClick={async () => {
                        setOcupado(true); setErro(null);
                        try {
                            const { getAuth } = await import('firebase/auth');
                            const u = getAuth().currentUser;
                            if (!u) throw new Error('Sessão expirada');
                            const token = await u.getIdToken();
                            const res = await fetch('/api/admin/dare/recon', { headers: { Authorization: `Bearer ${token}` } });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `dare-portal-recon-${new Date().toISOString().slice(0, 10)}.json`;
                            a.click();
                            URL.revokeObjectURL(url);
                        } catch (e: any) {
                            setErro(`Reconhecimento: ${e?.message || 'falha'}`);
                        } finally {
                            setOcupado(false);
                        }
                    }}
                    disabled={ocupado}
                    className="w-full px-2 py-1 text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline disabled:opacity-50"
                    title="Admin: baixa a estrutura real do portal DARE (campos, códigos, layout do lote XML-GNRE) — base da automação total"
                >
                    🔬 Mapear portal DARE (admin — gera JSON do reconhecimento)
                </button>
            </div>
        </div>
    );
};

export default DareSpModal;
