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
import {
    previewDare, registrarDare, receitasApiDare, emitirDarePelaApi, listarCodigosDare,
    type DarePayload, type AmbienteDare, type CodigoDareIcms,
} from '../../services/dareSpService';
import { enviarPorEmailDoColaborador, GESTOR_EMAIL } from '../../services/envioImpostoService';

interface Props {
    cnpj: string;
    razaoSocial: string;
    empresaId?: string;
    competencia: string;             // 'AAAA-MM' (fichaMes)
    valorInicial: number;
    derivacaoInicial: 'proprio' | 'st' | 'difal';
    onClose: () => void;
}

/**
 * Fallback usado só enquanto a lista do backend não chegou. A FONTE é
 * `CODIGOS_DARE_ICMS` (sefaz-backend/dare-sp.js) — lista fixa aqui foi o que
 * escondeu o 04602 (DIFAL do Simples) da equipe: o backend já validava o
 * código e a tela não o oferecia, então a apuração mostrava o valor e não
 * havia como gerar a guia.
 */
const OPCOES_FALLBACK: Array<{ codigoServico: string; label: string }> = [
    { codigoServico: '04601', label: 'ICMS Próprio (RPA) — 046-2 / 04601' },
    { codigoServico: '14601', label: 'ICMS-ST (RPA) — 146-6 / 14601' },
    { codigoServico: '04602', label: 'ICMS DIFAL — Simples Nacional — 046-2 / 04602' },
];

const CODIGO_POR_DERIVACAO: Record<string, string> = {
    proprio: '04601', st: '14601', difal: '04602',
};

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DareSpModal: React.FC<Props> = ({ cnpj, razaoSocial, empresaId, competencia, valorInicial, derivacaoInicial, onClose }) => {
    const [codigoServico, setCodigoServico] = useState(
        CODIGO_POR_DERIVACAO[derivacaoInicial] || '04601',
    );
    const [opcoes, setOpcoes] = useState(OPCOES_FALLBACK);
    // Lista vem do backend (fonte única). Se a chamada falhar, o fallback
    // acima segue valendo — o modal nunca fica sem opção.
    React.useEffect(() => {
        listarCodigosDare().then((cs: CodigoDareIcms[]) => {
            if (cs.length === 0) return;
            setOpcoes(cs.map((c) => ({
                codigoServico: c.codigoServico,
                label: `${c.descricao} — ${c.codigoReceita} / ${c.codigoServico}`,
            })));
        }).catch(() => { /* fallback */ });
    }, []);
    const [valor, setValor] = useState(String(valorInicial.toFixed(2)));
    // Vencimento NUNCA é chutado: depende do CPR/calendário da empresa —
    // o colaborador informa a data oficial do vencimento do imposto.
    const [vencimento, setVencimento] = useState('');
    const [preview, setPreview] = useState<DarePayload | null>(null);
    const [linhaTxt, setLinhaTxt] = useState<string | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [copiado, setCopiado] = useState(false);
    const [ocupado, setOcupado] = useState(false);
    // ── Web API oficial da SEFAZ (credenciamento 27/07) ────────────────────
    // Homologação é o padrão: lá o DARE sai SEM validade (não pode ser pago),
    // que é o certo pra validar a integração sem gerar cobrança de verdade.
    const [ambiente, setAmbiente] = useState<AmbienteDare>('homologacao');
    const [statusApi, setStatusApi] = useState<string | null>(null);
    const [emitido, setEmitido] = useState<any>(null);
    // PDF que a SEFAZ devolveu na emissão. Guardado aqui pra o envio ao
    // cliente arquivar sozinho na pasta IMPOSTOS do SharePoint (ordem técnica
    // #293) — antes o colaborador tinha de baixar do portal e anexar à mão.
    const [pdfEmitido, setPdfEmitido] = useState<{ base64: string; ambiente: AmbienteDare } | null>(null);

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

    // ORDEM TÉCNICA (24/07): envio pelo e-mail padrão do colaborador — cliente
    // no Para (e-mail do cadastro) e gestor SEMPRE em cópia. O DARE em si é
    // emitido no portal (reCAPTCHA) — o colaborador anexa o PDF baixado do
    // portal; o registro do envio fica na auditoria central.
    const [aviso, setAviso] = useState<string | null>(null);
    const enviarPorEmail = async () => {
        if (!preview) return;
        setOcupado(true); setErro(null); setAviso(null);
        try {
            const { getAuth } = await import('firebase/auth');
            const u = getAuth().currentUser;
            if (!u) throw new Error('Sessão expirada');
            const token = await u.getIdToken();
            const resp = await fetch(`/api/admin/empresa-contato/${encodeURIComponent(cnpj)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const contato = resp.ok ? await resp.json() : { email: '' };
            if (!contato.email) {
                setErro('E-mail do cliente não cadastrado — preencha em "Dados Fiscais" da empresa.');
                return;
            }
            // Só o PDF de PRODUÇÃO vai pro cliente/SharePoint: o de
            // homologação é documento de teste, sem validade e não pagável.
            const pdfValido = pdfEmitido && pdfEmitido.ambiente === 'producao' ? pdfEmitido.base64 : undefined;
            const r = await enviarPorEmailDoColaborador({
                empresaId,
                empresaCnpj: cnpj,
                empresaNome: razaoSocial,
                tipo: 'DARE',
                competencia,
                pdfBase64: pdfValido,
                pdfFileName: pdfValido
                    ? `dare_${cnpj.replace(/\D/g, '')}_${competencia}.pdf`
                    : undefined,
                para: contato.email,
                assunto: `DARE-SP ICMS ${competencia.split('-').reverse().join('/')} - ${razaoSocial}`,
                corpo: `${textoConferencia(preview)}\n\nO DARE segue anexo. Por gentileza, confirme o pagamento após a regularização.\n\nAtenciosamente,\nSP Assessoria Contábil`,
                valor: preview.valor,
            });
            if (r.ok) {
                setAviso(pdfValido
                    ? `E-mail aberto com ${GESTOR_EMAIL} em cópia. O PDF do DARE já foi arquivado na pasta IMPOSTOS do SharePoint`
                      + `${r.sharePoint?.status === 'arquivado' ? '' : ` (${r.sharePoint?.motivo || r.sharePoint?.status || 'confira a configuração'})`}`
                      + ' — anexe o mesmo arquivo no e-mail antes de enviar. Envio registrado na auditoria.'
                    : `E-mail aberto com ${GESTOR_EMAIL} em cópia — anexe o PDF do DARE antes de enviar. Envio registrado na auditoria.`);
            }
            else setErro(r.error || 'Falha ao registrar o envio.');
        } catch (e: any) {
            setErro(e?.message || 'Falha ao abrir o e-mail.');
        } finally {
            setOcupado(false);
        }
    };

    // Teste de fumaça da credencial: GET /receitas. NÃO emite guia — só prova
    // que a chave do Secret Manager chega à SEFAZ.
    const testarCredencial = async () => {
        setOcupado(true); setErro(null); setStatusApi(null);
        try {
            const r = await receitasApiDare(ambiente);
            if (r.ok) {
                const qtd = Array.isArray(r.receitas) ? r.receitas.length : null;
                setStatusApi(`✓ Credencial OK em ${r.rotulo || ambiente}${qtd != null ? ` — ${qtd} receita(s) na tabela oficial` : ''}.`);
            } else setErro(r.error || 'Falha ao consultar as receitas.');
        } catch (e: any) {
            setErro(e?.message || 'Falha ao consultar as receitas.');
        } finally { setOcupado(false); }
    };

    // Emissão pela API. Em produção o backend exige confirmação explícita
    // (o DARE sai válido e pagável) — perguntamos aqui antes de mandar.
    const emitirPelaApi = async () => {
        if (!preview) return;
        if (ambiente === 'producao') {
            const ok = window.confirm(
                `EMISSÃO EM PRODUÇÃO\n\n${razaoSocial}\nReferência ${preview.referencia} · ${fmtBRL(preview.valor)}\n\n`
                + 'O DARE gerado é VÁLIDO e pagável na rede bancária. Confirma?',
            );
            if (!ok) return;
        }
        setOcupado(true); setErro(null); setStatusApi(null); setEmitido(null);
        try {
            const r = await emitirDarePelaApi({ ...inputAtual(), ambiente, confirmoProducao: ambiente === 'producao' });
            if (r.ok) {
                // Comprovante = o que a SEFAZ devolveu (número, barras, Pix).
                // Nada aqui é gerado localmente.
                setEmitido(r.comprovante ?? r.retorno ?? {});
                if (r.pdfBase64) setPdfEmitido({ base64: r.pdfBase64, ambiente });
                setStatusApi(ambiente === 'homologacao'
                    ? '✓ DARE emitido em HOMOLOGAÇÃO — documento de teste, sem validade e não pagável.'
                    : '✓ DARE emitido em PRODUÇÃO — documento válido. Registrado na auditoria.');
            } else if (r.indeterminado) {
                // Rede caiu no meio: a guia PODE existir. Não repetir às cegas.
                setAviso(`⚠ ${r.error} Antes de emitir de novo, confira no portal DARE se a guia já saiu.`);
            } else {
                setErro((r.camposInvalidos?.join(' ') || r.error) ?? 'Falha ao emitir.');
            }
        } catch (e: any) {
            setErro(e?.message || 'Falha ao emitir.');
        } finally { setOcupado(false); }
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
                            {opcoes.map(o => <option key={o.codigoServico} value={o.codigoServico}>{o.label}</option>)}
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
                            <button onClick={enviarPorEmail} disabled={ocupado}
                                title={`Abre o e-mail padrão do seu computador com o cliente no Para e ${GESTOR_EMAIL} em cópia — anexe o PDF do DARE emitido no portal. O envio fica registrado na auditoria.`}
                                className="px-3 py-2 text-sm font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white">
                                ✉ E-mail
                            </button>
                        </div>
                        {aviso && (
                            <div className="text-xs text-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded p-2">{aviso}</div>
                        )}
                        <p className="text-[10px] text-slate-400">
                            {linhaTxt
                                ? <>No portal: <strong>"Você já tem todos os dados… CLIQUE AQUI"</strong> → cola a linha → Gerar Dare → baixa o DARE. O número e o código de barras são emitidos pelo sistema da SEFAZ-SP.</>
                                : <>O número do DARE e o código de barras são emitidos pelo sistema da SEFAZ-SP — cole os dados no portal e confira antes de gerar.</>}
                            {' '}(Emissão direta via API oficial entra quando o credenciamento da SEFAZ for aprovado.)
                        </p>
                    </div>
                )}

                {/* ── Emissão pela Web API oficial (credenciamento 27/07) ──
                    O portal continua valendo como plano B; aqui o DARE vem
                    pronto, com número e código de barras da própria SEFAZ. */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">⚡ Emissão direta (API oficial SEFAZ-SP)</p>
                        <select value={ambiente} onChange={e => { setAmbiente(e.target.value as AmbienteDare); setStatusApi(null); setEmitido(null); }}
                            className="text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700">
                            <option value="homologacao">Homologação (teste, sem validade)</option>
                            <option value="producao">Produção (DARE válido)</option>
                        </select>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <button onClick={testarCredencial} disabled={ocupado}
                            title="Consulta a tabela de receitas do ambiente escolhido. Não emite guia nenhuma."
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200">
                            {ocupado ? '⏳…' : '🔌 Testar credencial'}
                        </button>
                        <button onClick={emitirPelaApi} disabled={ocupado || !preview}
                            title={preview ? 'Emite o DARE pela API da SEFAZ com os dados do preview' : 'Faça o preview antes de emitir'}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg disabled:opacity-50 text-white ${
                                ambiente === 'producao' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                            {ambiente === 'producao' ? '🧾 Emitir DARE VÁLIDO' : '🧪 Emitir DARE de teste'}
                        </button>
                    </div>
                    {!preview && (
                        <p className="text-[10px] text-slate-400">O preview é obrigatório antes de emitir — é ele que valida serviço, referência e vencimento.</p>
                    )}
                    {statusApi && (
                        <div className="text-xs text-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded p-2">{statusApi}</div>
                    )}
                    {emitido && (
                        <pre className="bg-slate-900 text-emerald-300 text-[10px] p-2 rounded-lg overflow-x-auto max-h-48">{JSON.stringify(emitido, null, 2)}</pre>
                    )}
                    {pdfEmitido && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <button
                                onClick={() => {
                                    // Abre o PDF que a SEFAZ devolveu — é o arquivo que o
                                    // cliente recebe (e o mesmo que o rito arquiva).
                                    const bytes = Uint8Array.from(atob(pdfEmitido.base64), c => c.charCodeAt(0));
                                    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `dare_${cnpj.replace(/\D/g, '')}_${competencia}${pdfEmitido.ambiente === 'homologacao' ? '_TESTE' : ''}.pdf`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }}
                                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200">
                                ⬇ Baixar PDF do DARE
                            </button>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                {pdfEmitido.ambiente === 'producao'
                                    ? 'No “✉ E-mail” este PDF vai automaticamente para a pasta IMPOSTOS do SharePoint.'
                                    : 'Documento de TESTE (homologação) — não vai ao cliente nem ao SharePoint.'}
                            </span>
                        </div>
                    )}
                </div>

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
