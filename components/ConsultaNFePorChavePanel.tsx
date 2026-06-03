/**
 * ConsultaNFePorChavePanel.tsx
 *
 * Cole uma chave de 44 dígitos e descubra:
 *   - Emitente (CNPJ, nome, UF)
 *   - Destinatário (CNPJ, nome, UF) — confirma se é o escritório ou não
 *   - Valor, número, data de emissão, natureza da operação
 *
 * Bate direto na SEFAZ via DistDFe `consChNFe` usando o cert do escritório.
 */

import React, { useEffect, useState } from 'react';
import { consultarNFePorChave, getCertEscritorioInfo, type NFeChaveResposta, type CertEscritorioInfo } from '../services/consultaNFeChaveService';

const formatCnpj = (s: string | null | undefined) => {
    if (!s) return '—';
    const n = s.replace(/\D/g, '');
    if (n.length === 14) return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (n.length === 11) return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return s;
};

const formatBRL = (v: string | null | undefined) => {
    if (!v) return '—';
    const n = parseFloat(v);
    return isNaN(n) ? v : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatData = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso; }
};

const ConsultaNFePorChavePanel: React.FC = () => {
    const [chave, setChave] = useState('');
    const [carregando, setCarregando] = useState(false);
    const [resultado, setResultado] = useState<NFeChaveResposta | null>(null);
    const [certInfo, setCertInfo] = useState<CertEscritorioInfo | null>(null);

    useEffect(() => {
        getCertEscritorioInfo()
            .then(setCertInfo)
            .catch((e) => setCertInfo({
                ok: false, cnpjEsperado: '', cnpjNoCert: null, cnpjBaseDoCert: null,
                cnpjBaseEsperado: '', mismatch: null, mismatchBase: null,
                subject: '', cn: '', notBefore: null, notAfter: null, valido: false,
                pfxVersion: null, error: e.message,
            }));
    }, []);

    const chaveLimpa = chave.replace(/\D/g, '');
    const valido = chaveLimpa.length === 44;

    const consultar = async () => {
        if (!valido) return;
        setCarregando(true);
        setResultado(null);
        try {
            const r = await consultarNFePorChave(chaveLimpa);
            setResultado(r);
        } catch (e: any) {
            setResultado({
                ok: false, cStat: null, xMotivo: e.message || 'erro',
                chave: chaveLimpa, cnpjConsultadoComo: '', ufEmitente: '',
                cnpjEmitenteChave: '', cnpjEscritorio: '',
                escritorioEhDestinatario: null, detalhes: null,
            });
        } finally {
            setCarregando(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">
                🔎 Consultar NFe por chave (44 dígitos)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Descubra emitente, destinatário, valor e status de qualquer NFe direto na SEFAZ.
                Útil pra diagnosticar quando uma NFe não chegou pelo cron — confirma se ela está mesmo
                destinada ao escritório.
            </p>

            {/* Card de saúde do cert do escritório — diagnóstico de cStat=593 */}
            {certInfo && (
                <div className={`p-3 rounded border mb-3 text-xs ${
                    certInfo.error ? 'bg-red-50 border-red-300 dark:bg-red-900/20 dark:border-red-700' :
                    certInfo.mismatchBase ? 'bg-red-50 border-red-400 dark:bg-red-900/20 dark:border-red-700' :
                    certInfo.mismatch ? 'bg-amber-50 border-amber-300 dark:bg-amber-900/20 dark:border-amber-700' :
                    !certInfo.valido ? 'bg-amber-50 border-amber-300 dark:bg-amber-900/20 dark:border-amber-700' :
                    'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700'
                }`}>
                    {certInfo.error ? (
                        <span className="text-red-700 dark:text-red-300"><strong>Falha lendo cert do escritório:</strong> {certInfo.error}</span>
                    ) : certInfo.mismatchBase ? (
                        <div>
                            <div className="font-bold text-red-700 dark:text-red-300 mb-1">
                                ⚠ Certificado do Secret Manager NÃO é da S&P — cStat=593 garantido
                            </div>
                            <div className="text-slate-700 dark:text-slate-300 grid grid-cols-1 md:grid-cols-2 gap-1">
                                <span><strong>Esperado:</strong> <code>{certInfo.cnpjEsperado}</code> (S&P)</span>
                                <span><strong>No cert atual:</strong> <code>{certInfo.cnpjNoCert || '—'}</code> ({certInfo.cn})</span>
                            </div>
                            <div className="text-slate-700 dark:text-slate-300 mt-1">
                                Pra resolver, suba o .pfx correto da S&P no Secret Manager (secret <code>sefaz-cert-pfx</code>) e
                                a senha (<code>sefaz-cert-pass</code>). Depois reinicia o Cloud Run.
                            </div>
                        </div>
                    ) : certInfo.mismatch ? (
                        <div className="text-amber-800 dark:text-amber-300">
                            <strong>Atenção:</strong> CNPJ-Base bate ({certInfo.cnpjBaseEsperado}) mas filial diferente.
                            Cert: <code>{certInfo.cnpjNoCert}</code> · esperado: <code>{certInfo.cnpjEsperado}</code>.
                            Provavelmente vai funcionar (DistDFe é por CNPJ-Base), mas confirme.
                        </div>
                    ) : !certInfo.valido ? (
                        <div className="text-amber-800 dark:text-amber-300">
                            <strong>Cert válido como CNPJ {certInfo.cnpjNoCert}</strong>, mas <strong>fora da validade</strong>
                            (de {certInfo.notBefore?.slice(0, 10)} a {certInfo.notAfter?.slice(0, 10)}).
                        </div>
                    ) : (
                        <div className="text-emerald-700 dark:text-emerald-300">
                            ✓ Cert do escritório OK · CNPJ <code>{certInfo.cnpjNoCert}</code> ({certInfo.cn}) ·
                            válido até {certInfo.notAfter?.slice(0, 10)}
                        </div>
                    )}
                </div>
            )}

            <div className="flex flex-wrap gap-2 items-stretch">
                <input
                    type="text"
                    inputMode="numeric"
                    placeholder="35260865833410000169550000016159491663624193"
                    value={chave}
                    onChange={(e) => setChave(e.target.value.replace(/\s/g, ''))}
                    className="flex-1 min-w-[280px] px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <div className="text-[10px] text-slate-400 self-center font-mono whitespace-nowrap">
                    {chaveLimpa.length}/44
                </div>
                <button
                    type="button"
                    onClick={consultar}
                    disabled={!valido || carregando}
                    className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white rounded-md transition"
                >
                    {carregando ? '⏳ Consultando…' : '🔎 Consultar SEFAZ'}
                </button>
            </div>

            {resultado && (
                <div className="mt-4">
                    {resultado.error ? (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
                            <strong>Erro:</strong> {resultado.error}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {/* Veredito principal */}
                            <div className={`p-3 rounded border ${
                                resultado.escritorioEhDestinatario === true ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' :
                                resultado.escritorioEhDestinatario === false ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' :
                                'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700'
                            }`}>
                                <div className="text-xs font-mono mb-1 text-slate-600 dark:text-slate-400">
                                    cStat={resultado.cStat || '—'} · {resultado.xMotivo || '—'}
                                </div>
                                {resultado.escritorioEhDestinatario === true && (
                                    <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                                        ✓ Sim — o escritório É destinatário desta NFe.
                                        <div className="text-xs font-normal mt-1">
                                            Se ela não chegou pelo cron, é problema de NSU/captura. Pode reimportar manualmente ou disparar Capturar.
                                        </div>
                                    </div>
                                )}
                                {resultado.escritorioEhDestinatario === false && (
                                    <div className="text-sm font-bold text-amber-700 dark:text-amber-300">
                                        ⚠ Destinatário diferente do escritório.
                                        <div className="text-xs font-normal mt-1">
                                            Esta NFe foi emitida para <strong>{formatCnpj(resultado.detalhes?.destinatario.cnpj)}</strong> — não pra <strong>{formatCnpj(resultado.cnpjEscritorio)}</strong>.
                                            Por isso a DistDFe do escritório não a entregou. Peça pro fornecedor reemitir corrigindo, ou faça importação manual do XML.
                                        </div>
                                    </div>
                                )}
                                {resultado.escritorioEhDestinatario === null && !resultado.detalhes && (
                                    <div className="text-sm text-slate-700 dark:text-slate-300">
                                        SEFAZ não devolveu o XML da NFe. cStat=137 normalmente significa
                                        "Nenhum documento localizado para o interessado" — o CNPJ do escritório
                                        não consta como emitente nem destinatário.
                                    </div>
                                )}
                            </div>

                            {/* Detalhes parseados */}
                            {resultado.detalhes && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 p-3 rounded">
                                        <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Emitente</div>
                                        <div className="font-semibold text-slate-800 dark:text-slate-100">{resultado.detalhes.emitente.nome || '—'}</div>
                                        <div className="font-mono text-slate-600 dark:text-slate-300">{formatCnpj(resultado.detalhes.emitente.cnpj)} · {resultado.detalhes.emitente.uf || '—'}</div>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 p-3 rounded">
                                        <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Destinatário</div>
                                        <div className="font-semibold text-slate-800 dark:text-slate-100">{resultado.detalhes.destinatario.nome || '—'}</div>
                                        <div className="font-mono text-slate-600 dark:text-slate-300">{formatCnpj(resultado.detalhes.destinatario.cnpj)} · {resultado.detalhes.destinatario.uf || '—'}</div>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 p-3 rounded">
                                        <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Documento</div>
                                        <div className="text-slate-700 dark:text-slate-200">
                                            Nº <strong>{resultado.detalhes.numero || '—'}</strong> · mod {resultado.detalhes.modelo || '—'}
                                        </div>
                                        <div className="text-slate-700 dark:text-slate-200">{formatData(resultado.detalhes.dataEmissao)}</div>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 p-3 rounded">
                                        <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Valor / Natureza</div>
                                        <div className="text-lg font-bold text-slate-900 dark:text-white">{formatBRL(resultado.detalhes.valorTotal)}</div>
                                        <div className="text-slate-600 dark:text-slate-300 text-[11px]">{resultado.detalhes.natureza || '—'}</div>
                                    </div>
                                </div>
                            )}

                            <div className="text-[10px] text-slate-400 font-mono">
                                Chave: {resultado.chave} · Consultado como: {resultado.cnpjConsultadoComo} · UF emit (chave): {resultado.ufEmitente}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ConsultaNFePorChavePanel;
