/**
 * components/Das/CobrancaModal.tsx
 * Modal de geracao de cobranca DAS via IA (Gemini).
 * Tom: firme/amigavel. Canal: email/whatsapp.
 * Resultado: link mailto: ou wa.me/ pre-preenchido.
 */
import React, { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import type { User } from '../../types';
import { getCobrancaIa, formatBRL, formatBarras } from '../../services/dasService';

interface DasInfo {
    empresaCnpj: string;
    empresaNome: string;
    competencia?: string;
    vencimento?: string;
    valor: number;
    numeroDocumento?: string;
    codigoBarras?: string;
    pdfUrl?: string | null;
    pdfBase64?: string | null;
}

interface Props {
    dasInfo: DasInfo;
    currentUser: User | null;
    onClose: () => void;
    onShowToast: (msg: string) => void;
}

const CobrancaModal: React.FC<Props> = ({ dasInfo, currentUser, onClose, onShowToast }) => {
    const [tom, setTom] = useState<'firme' | 'amigavel'>('amigavel');
    const [canal, setCanal] = useState<'email' | 'whatsapp'>('email');
    const [emailDest, setEmailDest] = useState('');
    const [telefoneDest, setTelefoneDest] = useState('');
    const [assunto, setAssunto] = useState('');
    const [mensagem, setMensagem] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingDados, setLoadingDados] = useState(true);
    const [modelo, setModelo] = useState('');

    const assinante = currentUser?.name || currentUser?.email?.split('@')[0] || 'Equipe SP Contábil';
    const temPdf = !!(dasInfo.pdfBase64 || dasInfo.pdfUrl);

    // Busca contato da empresa (email + telefone) ao abrir
    useEffect(() => {
        (async () => {
            try {
                const token = await getAuth().currentUser?.getIdToken();
                if (!token) throw new Error('Usuario nao autenticado');
                const res = await fetch(`/api/admin/empresa-contato/${encodeURIComponent(dasInfo.empresaCnpj)}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                if (res.ok) {
                    const j = await res.json();
                    setEmailDest(j.email || '');
                    setTelefoneDest(j.telefone || '');
                }
            } catch { /* segue sem contato */ }
            setLoadingDados(false);
        })();
    }, [dasInfo.empresaCnpj, currentUser?.id]);

    const calcularDiasAtraso = (): number => {
        if (!dasInfo.vencimento) return 0;
        const hoje = new Date();
        const venc = new Date(dasInfo.vencimento + 'T00:00:00');
        return Math.floor((hoje.getTime() - venc.getTime()) / 86400000);
    };

    const resumoVencimento = () => {
        if (!dasInfo.vencimento) return '';
        const dias = calcularDiasAtraso();
        if (dias > 0) return ` (venceu em ${dasInfo.vencimento}, ${dias} dias atrás)`;
        if (dias === 0) return ` (vence hoje, ${dasInfo.vencimento})`;
        return ` (vence em ${dasInfo.vencimento})`;
    };

    const montarModeloPadrao = () => {
        const valor = formatBRL(dasInfo.valor);
        const competencia = dasInfo.competencia || 'nao informada';
        const vencimento = dasInfo.vencimento || 'nao informado';
        const barras = dasInfo.codigoBarras ? formatBarras(dasInfo.codigoBarras) : '';
        const numeroDoc = dasInfo.numeroDocumento || '';
        const assuntoPadrao = `DAS Simples Nacional - ${dasInfo.empresaNome} - ${competencia}`;
        const linhasPagamento = [
            `Empresa: ${dasInfo.empresaNome}`,
            `Competencia: ${competencia}`,
            `Valor: ${valor}`,
            `Vencimento: ${vencimento}`,
            numeroDoc ? `Numero do documento: ${numeroDoc}` : '',
            barras ? `Codigo de barras: ${barras}` : '',
        ].filter(Boolean);

        if (canal === 'whatsapp') {
            return {
                assunto: '',
                mensagem: [
                    `Ola, tudo bem?`,
                    `Segue DAS Simples Nacional para regularizacao:`,
                    ...linhasPagamento,
                    `Qualquer duvida, fico a disposicao.`,
                    assinante,
                ].join('\n'),
            };
        }

        return {
            assunto: assuntoPadrao,
            mensagem: [
                `Ola, tudo bem?`,
                ``,
                `Segue orientacao para pagamento do DAS Simples Nacional:`,
                ``,
                ...linhasPagamento,
                ``,
                `Por gentileza, confirme o pagamento apos a regularizacao.`,
                ``,
                `Atenciosamente,`,
                assinante,
            ].join('\n'),
        };
    };

    const gerar = async () => {
        setLoading(true);
        try {
            const r = await getCobrancaIa(currentUser, {
                empresaCnpj: dasInfo.empresaCnpj,
                empresaNome: dasInfo.empresaNome,
                valor: dasInfo.valor,
                competencia: dasInfo.competencia,
                vencimento: dasInfo.vencimento,
                numeroDocumento: dasInfo.numeroDocumento,
                codigoBarras: dasInfo.codigoBarras,
                hasPdf: temPdf,
                diasAtraso: calcularDiasAtraso(),
                tom,
                canal,
                assinante,
            });
            setAssunto(r.assunto);
            setMensagem(r.mensagem);
            setModelo(r.modelo);
        } catch (e: any) {
            const fallback = montarModeloPadrao();
            setAssunto(fallback.assunto);
            setMensagem(fallback.mensagem);
            setModelo('modelo-padrao');
            onShowToast(`IA indisponivel (${e.message}). Usei modelo padrao para envio.`);
        } finally {
            setLoading(false);
        }
    };

    const enviar = () => {
        if (!mensagem) { onShowToast('Gere a mensagem primeiro.'); return; }
        if (canal === 'email') {
            const to = emailDest || '';
            const subj = encodeURIComponent(assunto || `Cobrança DAS - ${dasInfo.empresaNome}`);
            const body = encodeURIComponent(mensagem);
            window.location.href = `mailto:${to}?subject=${subj}&body=${body}`;
        } else {
            // WhatsApp: limpa formatacao do telefone
            const tel = (telefoneDest || '').replace(/\D/g, '');
            const url = tel
                ? `https://wa.me/55${tel}?text=${encodeURIComponent(mensagem)}`
                : `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
            window.open(url, '_blank', 'noopener');
        }
    };

    const copiar = async () => {
        try {
            await navigator.clipboard.writeText(canal === 'email' ? `Assunto: ${assunto}\n\n${mensagem}` : mensagem);
            onShowToast('Copiado!');
        } catch {
            onShowToast('Falha ao copiar — selecione e use Ctrl+C');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[80]" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-bold">Enviar DAS ao cliente — {dasInfo.empresaNome}</h3>
                    <p className="text-xs text-slate-500 mt-1">
                        DAS de {dasInfo.competencia || '?'} no valor de <strong>{formatBRL(dasInfo.valor)}</strong>
                        {resumoVencimento()}
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* Configuracao */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-500 font-bold block mb-1">TOM</label>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setTom('amigavel')}
                                    className={`flex-1 text-sm px-3 py-2 rounded font-bold ${tom === 'amigavel' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-700'}`}
                                >
                                    😊 Amigável
                                </button>
                                <button
                                    onClick={() => setTom('firme')}
                                    className={`flex-1 text-sm px-3 py-2 rounded font-bold ${tom === 'firme' ? 'bg-amber-600 text-white' : 'bg-slate-100 dark:bg-slate-700'}`}
                                >
                                    💼 Firme
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 font-bold block mb-1">CANAL</label>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setCanal('email')}
                                    className={`flex-1 text-sm px-3 py-2 rounded font-bold ${canal === 'email' ? 'bg-sky-600 text-white' : 'bg-slate-100 dark:bg-slate-700'}`}
                                >
                                    ✉️ Email
                                </button>
                                <button
                                    onClick={() => setCanal('whatsapp')}
                                    className={`flex-1 text-sm px-3 py-2 rounded font-bold ${canal === 'whatsapp' ? 'bg-green-600 text-white' : 'bg-slate-100 dark:bg-slate-700'}`}
                                >
                                    💬 WhatsApp
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Destinatario */}
                    <div>
                        <label className="text-xs text-slate-500 font-bold block mb-1">
                            {canal === 'email' ? 'DESTINATÁRIO (EMAIL)' : 'DESTINATÁRIO (TELEFONE)'}
                        </label>
                        {canal === 'email' ? (
                            <input
                                type="email"
                                value={emailDest}
                                onChange={e => setEmailDest(e.target.value)}
                                placeholder={loadingDados ? 'Carregando...' : 'cliente@empresa.com.br'}
                                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                            />
                        ) : (
                            <input
                                type="tel"
                                value={telefoneDest}
                                onChange={e => setTelefoneDest(e.target.value)}
                                placeholder={loadingDados ? 'Carregando...' : '(11) 91234-5678'}
                                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                            />
                        )}
                        {!loadingDados && !emailDest && !telefoneDest && (
                            <p className="text-xs text-amber-600 mt-1">
                                💡 Cadastre email/telefone em "Dados Fiscais" da empresa pra pré-preencher automaticamente.
                            </p>
                        )}
                    </div>

                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                        {temPdf
                            ? 'PDF disponível no detalhe da guia. Baixe e anexe antes de enviar, quando o canal permitir.'
                            : 'PDF nao retornado pelo SERPRO para esta guia. A mensagem usa os dados estruturados disponiveis.'}
                        {dasInfo.codigoBarras && (
                            <span className="block mt-1 font-mono">Codigo de barras incluido na mensagem.</span>
                        )}
                    </div>

                    {/* Botao Gerar */}
                    <button
                        onClick={gerar}
                        disabled={loading}
                        className="btn-press w-full px-4 py-3 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 disabled:opacity-50"
                    >
                        {loading ? '⏳ IA gerando...' : mensagem ? '🔄 Regenerar mensagem' : '✨ Gerar mensagem com IA'}
                    </button>

                    {/* Resultado */}
                    {mensagem && (
                        <div className="space-y-3">
                            {canal === 'email' && (
                                <div>
                                    <label className="text-xs text-slate-500 font-bold block mb-1">ASSUNTO</label>
                                    <input
                                        value={assunto}
                                        onChange={e => setAssunto(e.target.value)}
                                        className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-bold"
                                    />
                                </div>
                            )}
                            <div>
                                <label className="text-xs text-slate-500 font-bold block mb-1">MENSAGEM</label>
                                <textarea
                                    value={mensagem}
                                    onChange={e => setMensagem(e.target.value)}
                                    rows={canal === 'email' ? 12 : 8}
                                    className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-mono"
                                />
                                <div className="text-xs text-slate-400 mt-1 italic flex items-center justify-between">
                                    <span>Gerado por {modelo}. Revise antes de enviar.</span>
                                    <span>{mensagem.length} chars</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2 flex-wrap">
                    <button onClick={onClose} className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100">
                        Fechar
                    </button>
                    {mensagem && (
                        <>
                            <button onClick={copiar} className="btn-press px-4 py-2 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-800">
                                📋 Copiar
                            </button>
                            <button
                                onClick={enviar}
                                className={`btn-press px-4 py-2 font-bold rounded-lg text-white ${canal === 'email' ? 'bg-sky-600 hover:bg-sky-700' : 'bg-green-600 hover:bg-green-700'}`}
                            >
                                {canal === 'email' ? '✉️ Abrir email' : '💬 Abrir WhatsApp'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CobrancaModal;
