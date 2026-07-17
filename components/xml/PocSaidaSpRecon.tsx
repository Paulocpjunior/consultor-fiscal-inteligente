import React, { useState } from 'react';
import {
    rodarReconhecimentoSaidaSp,
    testarDownloadSaida,
    autoTestarDownloadSaida,
    type PocSaidaSpResposta,
    type PocSaidaCompletaResposta,
} from '../../services/pocSaidaSpService';

/**
 * PocSaidaSpRecon — painel admin da Fase F0.
 *
 * Dispara o reconhecimento mTLS do portal SEFAZ-SP (rota somente-leitura
 * /api/admin/sefaz/poc-saida-sp) e mostra o resultado na tela, pra o teste
 * virar um clique em vez de curl com token. Nao grava nada.
 */
const CNPJ_PILOTO = '32602701';

const MOTIVO_LABEL: Record<string, string> = {
    nenhum_cert_para_esta_base: 'Nenhum certificado com essa raiz de CNPJ existe no cofre.',
    cert_nao_e_A1: 'Existe um certificado para essa raiz, mas não é do tipo A1.',
    cert_incompleto_no_cofre: 'Existe um registro para essa raiz, mas sem o .pfx/senha no cofre.',
    cert_expirado_ou_invalido: 'Existe um A1 para essa raiz, mas está expirado (ou inválido).',
    falha_ao_carregar_pfx: 'O A1 foi localizado, mas falhou ao carregar do cofre.',
    cnpj_invalido: 'CNPJ informado é inválido.',
};

const renderDiag = (d: import('../../services/pocSaidaSpService').PocCertDiagnostico | null | undefined) => {
    if (!d) return null;
    return (
        <div className="mt-2 text-xs text-red-600 dark:text-red-300 space-y-0.5">
            <p><strong>Diagnóstico:</strong> {MOTIVO_LABEL[d.motivo] || d.motivo}</p>
            {d.cert?.cnpj && <p>Cert achado: {d.cert.cnpj} (tipo {d.cert.tipoCert || '?'}, vence {d.cert.notAfter || '?'})</p>}
            {d.basesNoCofre && d.basesNoCofre.length > 0 && (
                <p>Raízes de CNPJ no cofre: {d.basesNoCofre.join(', ')}</p>
            )}
            {d.basesNoCofre && d.basesNoCofre.length === 0 && <p>O cofre de certificados por empresa está vazio.</p>}
        </div>
    );
};

const badge = (ok: boolean, okTxt: string, noTxt: string) => (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ok
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
        {ok ? okTxt : noTxt}
    </span>
);

const PocSaidaSpRecon: React.FC = () => {
    const [cnpj, setCnpj] = useState(CNPJ_PILOTO);
    const [extraUrl, setExtraUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [resp, setResp] = useState<PocSaidaSpResposta | null>(null);

    // Teste F0.5 — baixar 1 saída completa via consChNFe com o A1 da empresa.
    const [chave, setChave] = useState('');
    const [dlLoading, setDlLoading] = useState(false);
    const [dlResp, setDlResp] = useState<PocSaidaCompletaResposta | null>(null);

    const testarChave = async () => {
        setDlLoading(true);
        setDlResp(null);
        try {
            const r = await testarDownloadSaida(chave);
            setDlResp(r);
        } catch (e) {
            setDlResp({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setDlLoading(false);
        }
    };

    const testarAuto = async () => {
        setDlLoading(true);
        setDlResp(null);
        try {
            const r = await autoTestarDownloadSaida(cnpj);
            setDlResp(r);
            if (r.chave) setChave(r.chave);
        } catch (e) {
            setDlResp({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setDlLoading(false);
        }
    };

    const rodar = async () => {
        setLoading(true);
        setResp(null);
        try {
            const r = await rodarReconhecimentoSaidaSp({ cnpj, extraUrl: extraUrl.trim() || undefined });
            setResp(r);
        } catch (e) {
            setResp({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setLoading(false);
        }
    };

    const v = resp?.veredito;

    return (
        <div className="space-y-4">
            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    🔎 Reconhecimento Portal SEFAZ-SP — NF-e de Saída (Fase F0)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Testa se o certificado A1 da empresa (do cofre) autentica via mTLS nos portais
                    da SEFAZ-SP e detecta WAF/captcha. <strong>Somente leitura</strong> — não baixa
                    nem grava nada. Requer o A1 da empresa cadastrado em Certificados.
                </p>

                <div className="flex flex-wrap items-end gap-2 mt-3">
                    <label className="text-xs text-slate-600 dark:text-slate-300">
                        CNPJ (ou raiz)
                        <input
                            value={cnpj}
                            onChange={e => setCnpj(e.target.value)}
                            className="block mt-1 w-40 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                            placeholder="32602701"
                        />
                    </label>
                    <label className="text-xs text-slate-600 dark:text-slate-300 flex-1 min-w-[220px]">
                        URL extra a sondar (opcional)
                        <input
                            value={extraUrl}
                            onChange={e => setExtraUrl(e.target.value)}
                            className="block mt-1 w-full px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                            placeholder="https://…/tela-de-nfe-emitidas"
                        />
                    </label>
                    <button
                        onClick={rodar}
                        disabled={loading || !cnpj.trim()}
                        className="px-4 py-1.5 text-xs font-bold rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white"
                    >
                        {loading ? 'Rodando…' : 'Rodar reconhecimento'}
                    </button>
                </div>
            </div>

            {loading && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sondando os endpoints da SEFAZ-SP em série (pode levar até ~1 min)…
                </p>
            )}

            {resp && !resp.ok && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-sm font-bold text-red-700 dark:text-red-300">
                        {resp.httpStatus === 404 ? 'Certificado da empresa não encontrado no cofre' : 'Falha no reconhecimento'}
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">{resp.error || 'Erro desconhecido.'}</p>
                    {resp.dica && <p className="text-xs text-red-500 mt-1">{resp.dica}</p>}
                    {renderDiag(resp.diagnostico)}
                </div>
            )}

            {resp && resp.ok && (
                <div className="space-y-4">
                    {/* Veredito */}
                    {v && (
                        <div className={`rounded-lg p-4 border ${v.houveWaf
                            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                            : v.algumMtls
                                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'}`}>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-100">
                                Veredito: {v.houveWaf ? '⛔ WAF/captcha detectado — parar e pivotar'
                                    : v.algumMtls ? '✓ mTLS ok em ao menos um endpoint'
                                        : '⚠ nenhum handshake mTLS completou'}
                            </p>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{v.recomendacao}</p>
                        </div>
                    )}

                    {/* Certificado */}
                    {resp.certInfo && (
                        <div className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">Certificado A1</h4>
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <dt className="text-slate-500">Titular</dt><dd className="text-slate-700 dark:text-slate-200">{resp.certInfo.subjectCN || '—'}</dd>
                                <dt className="text-slate-500">CNPJ</dt><dd className="text-slate-700 dark:text-slate-200">{resp.certInfo.cnpj || '—'} {resp.certInfo.raizConfere ? '✓ raiz confere' : '⚠ raiz difere da piloto'}</dd>
                                <dt className="text-slate-500">Emissora (AC)</dt><dd className="text-slate-700 dark:text-slate-200">{resp.certInfo.issuerCN || '—'}</dd>
                                <dt className="text-slate-500">Validade</dt><dd className="text-slate-700 dark:text-slate-200">{resp.certInfo.expirado ? '⚠ EXPIRADO' : `válido (${resp.certInfo.diasParaVencer} dias)`}</dd>
                            </dl>
                        </div>
                    )}

                    {/* Sondagens */}
                    {resp.sondagens?.map(s => (
                        <div key={s.id} className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">{s.label}</h4>
                                <div className="flex gap-1">
                                    {badge(s.handshakeMtlsOk, 'mTLS ✓', 'mTLS ✗')}
                                    {s.handshakeMtlsOk && badge(!s.waf.bloqueado, 'sem WAF', 'WAF')}
                                </div>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5 break-all">{s.urlInicial}</p>
                            {!s.handshakeMtlsOk ? (
                                <p className="text-xs text-red-600 dark:text-red-400 mt-2">{s.erroTls}</p>
                            ) : (
                                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2">
                                    <dt className="text-slate-500">TLS</dt><dd className="text-slate-700 dark:text-slate-200">{s.tls?.protocolo || '?'} / {s.tls?.cifra || '?'}</dd>
                                    <dt className="text-slate-500">HTTP final</dt><dd className="text-slate-700 dark:text-slate-200">{s.statusFinal ?? '—'} — "{s.tituloPagina || 'sem título'}"</dd>
                                    <dt className="text-slate-500">Redirects</dt><dd className="text-slate-700 dark:text-slate-200">{s.redirects.map(r => r.statusCode).join(' → ') || '—'}</dd>
                                    <dt className="text-slate-500">Cookies</dt><dd className="text-slate-700 dark:text-slate-200 break-all">{s.cookiesSessao.join(', ') || '—'}</dd>
                                    {s.waf.bloqueado && (
                                        <>
                                            <dt className="text-red-500">WAF</dt>
                                            <dd className="text-red-600 dark:text-red-400">{s.waf.marcadores.map(m => m.tipo).join(', ')}</dd>
                                        </>
                                    )}
                                </dl>
                            )}
                        </div>
                    ))}

                    {/* JSON cru (pra colar/enviar) */}
                    <details className="text-xs">
                        <summary className="cursor-pointer text-slate-500 dark:text-slate-400">Ver JSON completo (para enviar)</summary>
                        <pre className="mt-2 p-3 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-[10px] leading-relaxed">
                            {JSON.stringify(resp, null, 2)}
                        </pre>
                    </details>
                </div>
            )}

            {/* ── Teste F0.5: baixar 1 saída completa via consChNFe + A1 ── */}
            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg p-4 mt-2">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    ⬇️ Teste: baixar 1 saída completa por chave (consChNFe + A1)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Cole uma chave de <strong>saída pendente</strong> (aba "XMLs NFe", direção saída, status Pendente).
                    O backend baixa a nota via consChNFe usando o A1 da empresa emitente e diz se veio
                    <strong> completa</strong> ou só resumo. <strong>Somente leitura</strong> — não grava nada.
                </p>
                <div className="flex flex-wrap items-end gap-2 mt-3">
                    <label className="text-xs text-slate-600 dark:text-slate-300 flex-1 min-w-[280px]">
                        Chave de acesso (44 dígitos)
                        <input
                            value={chave}
                            onChange={e => setChave(e.target.value)}
                            className="block mt-1 w-full px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-mono"
                            placeholder="3526… (44 dígitos)"
                        />
                    </label>
                    <button
                        onClick={testarChave}
                        disabled={dlLoading || chave.replace(/\D/g, '').length !== 44}
                        className="px-4 py-1.5 text-xs font-bold rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white"
                    >
                        {dlLoading ? 'Baixando…' : 'Testar download desta chave'}
                    </button>
                    <button
                        onClick={testarAuto}
                        disabled={dlLoading || cnpj.replace(/\D/g, '').length < 8}
                        className="px-4 py-1.5 text-xs font-bold rounded-md bg-indigo-100 hover:bg-indigo-200 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200 disabled:opacity-50"
                        title="Pega automaticamente uma saída pendente do CNPJ acima e testa"
                    >
                        {dlLoading ? '…' : '⚡ Pegar saída pendente e testar'}
                    </button>
                </div>

                {dlResp && !dlResp.ok && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mt-3">
                        <p className="text-xs font-bold text-red-700 dark:text-red-300">
                            {dlResp.diagnostico ? 'Certificado da empresa não encontrado no cofre'
                                : dlResp.httpStatus === 404 ? 'Não foi possível auto-selecionar uma saída'
                                    : 'Falha no teste'}
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{dlResp.error || 'Erro desconhecido.'}</p>
                        {dlResp.dica && <p className="text-xs text-red-500 mt-1">{dlResp.dica}</p>}
                        {renderDiag(dlResp.diagnostico)}
                    </div>
                )}

                {dlResp && dlResp.ok && (
                    <div className="mt-3 space-y-2">
                        <div className={`rounded-lg p-3 border ${dlResp.temCompleta
                            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                            : dlResp.veredito === 'nada_encontrado_137'
                                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'}`}>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-100">
                                {dlResp.temCompleta ? '✓ Nota COMPLETA disponível via consChNFe'
                                    : dlResp.veredito === 'nada_encontrado_137' ? '✗ SEFAZ não localizou (cStat 137)'
                                        : dlResp.veredito === 'so_resumo' ? '⚠ Voltou só o resumo'
                                            : dlResp.veredito === 'rate_limited_656' ? '⏳ Rate limit (656) — tentar depois'
                                                : '⚠ Inconclusivo'}
                            </p>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{dlResp.interpretacao}</p>
                        </div>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <dt className="text-slate-500">Chave testada</dt><dd className="text-slate-700 dark:text-slate-200 font-mono break-all">{dlResp.chave || '—'} {dlResp.chaveAutoSelecionada ? '(auto)' : ''}</dd>
                            <dt className="text-slate-500">cStat / motivo</dt><dd className="text-slate-700 dark:text-slate-200">{dlResp.cStat ?? '—'} — {dlResp.xMotivo || ''}</dd>
                            <dt className="text-slate-500">Emitente / UF</dt><dd className="text-slate-700 dark:text-slate-200">{dlResp.cnpjEmitente} / {dlResp.uf}</dd>
                            <dt className="text-slate-500">A1 usado (cofre)</dt><dd className="text-slate-700 dark:text-slate-200">{dlResp.certFonte?.cnpj || '—'}</dd>
                            <dt className="text-slate-500">XMLs retornados</dt><dd className="text-slate-700 dark:text-slate-200">{dlResp.totalXmls ?? 0}</dd>
                        </dl>
                        {dlResp.xmls?.map((x, i) => (
                            <div key={i} className="text-xs border border-slate-200 dark:border-slate-700 rounded p-2">
                                <div className="flex gap-2 flex-wrap">
                                    <span className="font-mono text-slate-500">{x.schema || '?'}</span>
                                    {badge(x.ehCompleta, 'completa', x.ehResumo ? 'resumo' : x.ehEvento ? 'evento' : 'outro')}
                                    <span className="text-slate-400">{x.tamanho} bytes</span>
                                </div>
                                {x.snippet && <p className="mt-1 text-[10px] text-slate-400 break-all font-mono">{x.snippet}</p>}
                            </div>
                        ))}
                        <details className="text-xs">
                            <summary className="cursor-pointer text-slate-500 dark:text-slate-400">Ver JSON completo (para enviar)</summary>
                            <pre className="mt-2 p-3 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-[10px] leading-relaxed">
                                {JSON.stringify(dlResp, null, 2)}
                            </pre>
                        </details>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PocSaidaSpRecon;
