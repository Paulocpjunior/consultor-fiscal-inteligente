/**
 * NFTS SP — Gerador de Lotes de NFTS (Prefeitura de Sao Paulo).
 *
 * Fluxo: seleciona empresa tomadora (CCM) -> upload de PDFs de notas de
 * servico tomado -> extracao (pdfjs; fallback Gemini para escaneados) ->
 * grid de conferencia editavel (aprovadas x pendencias) -> download do
 * TXT V.001 + CSVs de conferencia.
 *
 * Politicas de seguranca:
 *  - Notas com ISS retido pelo tomador saem do lote automaticamente.
 *  - Nada e transmitido a Prefeitura: o TXT e importado manualmente pelo
 *    usuario, que permanece responsavel pela conferencia final.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import { getEmpresasParaPerfilCliente, type EmpresaPerfilOption } from '../../services/xmlFiscalService';
import { listarEmpresasPerfilBackend } from '../../services/empresasPerfilService';
import { extrairTextoPdf, parseNftsFromText, montarNotaDeGemini } from '../../services/nftsPdfParserService';
import { extractNftsDataFromPdf } from '../../services/geminiService';
import {
    gerarLoteNfts, gerarCsvResumo, gerarCsvPendencias, separarNotasIssRetido,
    validarNotaNfts, parseValorCentavos, parseDataAAAAMMDD, soDigitos,
    type NftsNota, type NftsPendencia,
} from '../../services/nftsSpService';
import { CATALOGO_POR_CODIGO } from '../../services/nftsCatalogoSp';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

interface ProcessStatus {
    total: number;
    atual: number;
    arquivoAtual: string;
    fase: 'idle' | 'processando' | 'concluido';
}

function downloadBytes(bytes: Uint8Array | string, filename: string, mime: string) {
    const blob = typeof bytes === 'string'
        ? new Blob([bytes], { type: mime })
        : new Blob([bytes.buffer as ArrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function fileToBase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const arr = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < arr.length; i += chunk) {
        bin += String.fromCharCode(...arr.subarray(i, i + chunk));
    }
    return btoa(bin);
}

const inputStyle: React.CSSProperties = {
    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
    border: '1px solid var(--border-default)', borderRadius: 8, padding: '8px 10px',
};

const NftsSp: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [empresas, setEmpresas] = useState<EmpresaPerfilOption[]>([]);
    const [empresasLoading, setEmpresasLoading] = useState(true);
    const [empresaId, setEmpresaId] = useState('');
    const [ccm, setCcm] = useState('');
    const [cnpjTomador, setCnpjTomador] = useState('');
    const [usarGemini, setUsarGemini] = useState(true);
    const [notas, setNotas] = useState<NftsNota[]>([]);
    const [pendencias, setPendencias] = useState<NftsPendencia[]>([]);
    const [status, setStatus] = useState<ProcessStatus>({ total: 0, atual: 0, arquivoAtual: '', fase: 'idle' });
    const [erro, setErro] = useState<string | null>(null);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const list = await listarEmpresasPerfilBackend(currentUser);
                if (vivo) setEmpresas(list || []);
            } catch {
                try {
                    const fallback = await getEmpresasParaPerfilCliente(currentUser);
                    if (vivo) setEmpresas(fallback || []);
                } catch {
                    if (vivo) setEmpresas([]);
                }
            } finally {
                if (vivo) setEmpresasLoading(false);
            }
        })();
        return () => { vivo = false; };
    }, [currentUser]);

    const empresaSel = useMemo(() => empresas.find(e => e.id === empresaId) || null, [empresas, empresaId]);

    useEffect(() => {
        if (!empresaSel) return;
        setCnpjTomador(soDigitos(empresaSel.cnpj));
        if (empresaSel.ccmSp) setCcm(soDigitos(empresaSel.ccmSp));
    }, [empresaSel]);

    const processarArquivos = async (files: FileList | null) => {
        if (!files || !files.length) return;
        setErro(null);
        setStatus({ total: files.length, atual: 0, arquivoAtual: '', fase: 'processando' });
        const novasNotas: NftsNota[] = [];
        const novasPend: NftsPendencia[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setStatus({ total: files.length, atual: i + 1, arquivoAtual: file.name, fase: 'processando' });
            try {
                const { paginas, textoInsuficiente } = await extrairTextoPdf(file);
                if (textoInsuficiente) {
                    if (!usarGemini) {
                        novasPend.push({ arquivo: file.name, pagina: 1, motivo: 'PDF escaneado (sem texto) e extracao por IA desativada' });
                        continue;
                    }
                    try {
                        const base64 = await fileToBase64(file);
                        const dados = await extractNftsDataFromPdf(base64);
                        const r = montarNotaDeGemini(file.name, dados, cnpjTomador);
                        if (r.nota) novasNotas.push(r.nota);
                        if (r.pendencia) novasPend.push(r.pendencia);
                    } catch (e: any) {
                        novasPend.push({ arquivo: file.name, pagina: 1, motivo: 'Falha na extracao por IA: ' + (e?.message || 'erro desconhecido') });
                    }
                    continue;
                }
                for (let pg = 0; pg < paginas.length; pg++) {
                    if (paginas[pg].trim().length < 40) continue;
                    const r = parseNftsFromText(file.name, pg + 1, paginas[pg], cnpjTomador);
                    if (r.nota) novasNotas.push(r.nota);
                    if (r.pendencia) novasPend.push(r.pendencia);
                }
            } catch (e: any) {
                novasPend.push({ arquivo: file.name, pagina: 0, motivo: 'Erro ao abrir PDF: ' + (e?.message || 'erro desconhecido') });
            }
        }
        setNotas(prev => [...prev, ...novasNotas]);
        setPendencias(prev => [...prev, ...novasPend]);
        setStatus(s => ({ ...s, fase: 'concluido', arquivoAtual: '' }));
        onShowToast?.(`${novasNotas.length} nota(s) extraida(s), ${novasPend.length} pendencia(s).`);
    };

    const atualizarNota = (idx: number, campo: keyof NftsNota, valor: string) => {
        setNotas(prev => prev.map((n, i) => {
            if (i !== idx) return n;
            const nova = { ...n };
            if (campo === 'valorCentavos') {
                const v = parseValorCentavos(valor);
                if (v != null) nova.valorCentavos = v;
            } else if (campo === 'data') {
                const d = parseDataAAAAMMDD(valor);
                if (d) nova.data = d;
            } else if (campo === 'codigo') {
                const cod = soDigitos(valor).padStart(5, '0').slice(-5);
                const rows = CATALOGO_POR_CODIGO.get(cod);
                if (rows?.length) {
                    nova.codigo = cod;
                    nova.subitem = rows[0].subitem;
                    nova.aliquota = rows[0].aliquota;
                }
            } else if (campo === 'retido') {
                nova.retido = valor === '1' ? '1' : '2';
            } else {
                (nova as any)[campo] = valor;
            }
            return nova;
        }));
    };

    const removerNota = (idx: number) => setNotas(prev => prev.filter((_, i) => i !== idx));

    const { mantidas, retidas } = useMemo(() => separarNotasIssRetido(notas), [notas]);
    const notasComErro = useMemo(
        () => mantidas.filter(n => validarNotaNfts(n).erros.length > 0),
        [mantidas],
    );
    const totalLote = useMemo(() => mantidas.reduce((acc, n) => acc + n.valorCentavos, 0), [mantidas]);

    const gerarTxt = () => {
        setErro(null);
        try {
            if (soDigitos(ccm).length !== 8) throw new Error('Informe o CCM do tomador com exatamente 8 digitos.');
            if (notasComErro.length) throw new Error(`${notasComErro.length} nota(s) com erro de validacao. Corrija ou remova antes de gerar.`);
            const lote = gerarLoteNfts(mantidas, ccm);
            const nomeBase = `NFTS_${soDigitos(ccm)}_${new Date().toISOString().slice(0, 10)}`;
            downloadBytes(lote.bytes, `${nomeBase}.txt`, 'text/plain;charset=iso-8859-1');
            onShowToast?.(`Lote gerado: ${lote.quantidade} nota(s), total R$ ${(lote.valorTotalCentavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);
        } catch (e: any) {
            setErro(e?.message || 'Falha ao gerar o lote.');
        }
    };

    const baixarCsvs = () => {
        const nomeBase = `NFTS_conferencia_${new Date().toISOString().slice(0, 10)}`;
        downloadBytes(gerarCsvResumo(notas), `${nomeBase}_resumo.csv`, 'text/csv;charset=utf-8');
        const pendTotal: NftsPendencia[] = [
            ...pendencias,
            ...retidas.map(n => ({ arquivo: n.arquivo, pagina: n.pagina, motivo: `NF ${n.numero} excluida do lote: ISS retido pelo tomador`, trecho: n.aviso })),
        ];
        if (pendTotal.length) downloadBytes(gerarCsvPendencias(pendTotal), `${nomeBase}_pendencias.csv`, 'text/csv;charset=utf-8');
    };

    const limpar = () => { setNotas([]); setPendencias([]); setStatus({ total: 0, atual: 0, arquivoAtual: '', fase: 'idle' }); setErro(null); };

    const fmtData = (d: string) => (d && d.length === 8 ? `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : d);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>NFTS São Paulo — Gerador de Lotes</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Lê notas de serviço tomado em PDF (nativo ou escaneado), valida os dados e gera o arquivo TXT (layout V.001)
                    para importação em lote no sistema NFTS da Prefeitura de SP. Notas com ISS retido são excluídas automaticamente.
                    A conferência e a importação final permanecem sob responsabilidade do usuário.
                </p>

                <div className="flex flex-wrap gap-4 mt-4 items-end">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Empresa tomadora</label>
                        <select value={empresaId} onChange={e => setEmpresaId(e.target.value)} style={{ ...inputStyle, minWidth: 280 }} disabled={empresasLoading}>
                            <option value="">{empresasLoading ? 'Carregando…' : 'Selecione (opcional)'}</option>
                            {empresas.map(e => <option key={e.id} value={e.id}>{e.nome} — {e.cnpj}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>CCM do tomador (8 dígitos)</label>
                        <input value={ccm} onChange={e => setCcm(soDigitos(e.target.value).slice(0, 8))} placeholder="00000000" style={{ ...inputStyle, width: 140 }} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>CNPJ do tomador (filtro)</label>
                        <input value={cnpjTomador} onChange={e => setCnpjTomador(soDigitos(e.target.value).slice(0, 14))} placeholder="Somente dígitos" style={{ ...inputStyle, width: 180 }} />
                    </div>
                    <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        <input type="checkbox" checked={usarGemini} onChange={e => setUsarGemini(e.target.checked)} />
                        IA para PDFs escaneados
                    </label>
                </div>

                <div className="flex flex-wrap gap-3 mt-4 items-center">
                    <label className="px-4 py-2 text-xs font-bold rounded-lg cursor-pointer" style={{ background: 'var(--accent)', color: '#fff' }}>
                        Selecionar PDFs
                        <input type="file" accept=".pdf,application/pdf" multiple className="hidden" style={{ display: 'none' }}
                            onChange={e => { void processarArquivos(e.target.files); e.target.value = ''; }} />
                    </label>
                    {notas.length > 0 || pendencias.length > 0 ? (
                        <>
                            <button onClick={gerarTxt} className="px-4 py-2 text-xs font-bold rounded-lg" style={{ background: 'var(--accent)', color: '#fff' }}
                                disabled={!mantidas.length}>
                                Gerar TXT ({mantidas.length} nota{mantidas.length === 1 ? '' : 's'} — R$ {(totalLote / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
                            </button>
                            <button onClick={baixarCsvs} className="px-4 py-2 text-xs font-bold rounded-lg" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}>
                                Baixar CSVs de conferência
                            </button>
                            <button onClick={limpar} className="px-4 py-2 text-xs font-bold rounded-lg" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
                                Limpar
                            </button>
                        </>
                    ) : null}
                </div>

                {status.fase === 'processando' && (
                    <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>
                        Processando {status.atual}/{status.total}: {status.arquivoAtual}…
                    </p>
                )}
                {erro && <p className="text-sm mt-3 font-bold" style={{ color: '#dc2626' }}>{erro}</p>}
            </div>

            {retidas.length > 0 && (
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid #d97706' }}>
                    <h3 className="text-sm font-bold" style={{ color: '#d97706' }}>
                        {retidas.length} nota(s) com ISS retido — excluídas do lote automaticamente
                    </h3>
                    <ul className="text-xs mt-2 space-y-1" style={{ color: 'var(--text-secondary)' }}>
                        {retidas.map((n, i) => (
                            <li key={i}>NF {n.numero} — {n.nome.slice(0, 50)} — R$ {(n.valorCentavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ({n.arquivo})</li>
                        ))}
                    </ul>
                    <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                        Somente ISS/ISSQN foi considerado; retenções federais (IR, INSS, PIS, COFINS, CSLL) são ignoradas. Trate essas notas manualmente.
                    </p>
                </div>
            )}

            {mantidas.length > 0 && (
                <div className="p-4 rounded-xl overflow-x-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                    <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
                        Notas aprovadas para o lote ({mantidas.length}) — campos editáveis
                    </h3>
                    <table className="w-full text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <thead>
                            <tr style={{ color: 'var(--text-muted)' }}>
                                <th className="text-left p-1">Arquivo</th>
                                <th className="text-left p-1">Número</th>
                                <th className="text-left p-1">Data</th>
                                <th className="text-left p-1">CNPJ prestador</th>
                                <th className="text-left p-1">Razão social</th>
                                <th className="text-right p-1">Valor (R$)</th>
                                <th className="text-left p-1">Cód. serviço</th>
                                <th className="text-left p-1">Cidade/UF</th>
                                <th className="text-left p-1">Origem</th>
                                <th className="p-1"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {notas.map((n, idx) => {
                                if (n.retido === '1') return null;
                                const val = validarNotaNfts(n);
                                const comErro = val.erros.length > 0;
                                return (
                                    <React.Fragment key={`${n.arquivo}-${n.pagina}-${idx}`}>
                                        <tr style={{ borderTop: '1px solid var(--border-default)', background: comErro ? 'rgba(220,38,38,0.08)' : undefined }}>
                                            <td className="p-1 max-w-[160px] truncate" title={n.arquivo}>{n.arquivo}</td>
                                            <td className="p-1"><input value={n.numero} onChange={e => atualizarNota(idx, 'numero', e.target.value)} style={{ ...inputStyle, width: 90, padding: '2px 6px' }} /></td>
                                            <td className="p-1"><input defaultValue={fmtData(n.data)} onBlur={e => atualizarNota(idx, 'data', e.target.value)} placeholder="DD/MM/AAAA" style={{ ...inputStyle, width: 100, padding: '2px 6px' }} /></td>
                                            <td className="p-1">{n.cnpj}</td>
                                            <td className="p-1"><input value={n.nome} onChange={e => atualizarNota(idx, 'nome', e.target.value)} style={{ ...inputStyle, width: 200, padding: '2px 6px' }} /></td>
                                            <td className="p-1 text-right"><input defaultValue={(n.valorCentavos / 100).toFixed(2).replace('.', ',')} onBlur={e => atualizarNota(idx, 'valorCentavos', e.target.value)} style={{ ...inputStyle, width: 100, padding: '2px 6px', textAlign: 'right' }} /></td>
                                            <td className="p-1">
                                                <input value={n.codigo} onChange={e => atualizarNota(idx, 'codigo', e.target.value)} title={`Subitem ${n.subitem} — alíquota ${(Number(n.aliquota) / 100).toFixed(2)}%`} style={{ ...inputStyle, width: 70, padding: '2px 6px' }} />
                                            </td>
                                            <td className="p-1">{n.cidade ? `${n.cidade}/${n.uf}` : <span style={{ color: '#d97706' }}>revisar</span>}</td>
                                            <td className="p-1">{n.origemExtracao === 'gemini' ? <span title="Extraído por IA — conferir" style={{ color: '#d97706', fontWeight: 700 }}>IA</span> : 'PDF'}</td>
                                            <td className="p-1"><button onClick={() => removerNota(idx)} title="Remover do lote" style={{ color: '#dc2626', fontWeight: 700 }}>×</button></td>
                                        </tr>
                                        {(comErro || n.aviso) && (
                                            <tr>
                                                <td colSpan={10} className="px-1 pb-2 text-[11px]" style={{ color: comErro ? '#dc2626' : 'var(--text-muted)' }}>
                                                    {comErro ? 'ERROS: ' + val.erros.join('; ') + '. ' : ''}{n.aviso}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {pendencias.length > 0 && (
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                    <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Pendências ({pendencias.length}) — tratar manualmente</h3>
                    <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                        {pendencias.map((p, i) => (
                            <li key={i}><strong>{p.arquivo}</strong>{p.pagina ? ` (pág. ${p.pagina})` : ''}: {p.motivo}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default NftsSp;
