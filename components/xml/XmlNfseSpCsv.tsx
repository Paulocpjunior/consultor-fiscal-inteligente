/**
 * XmlNfseSpCsv.tsx
 *
 * Importa CSV de NFS-e exportado MANUALMENTE pelo portal SP.
 *
 * Fluxo:
 *   1. User acessa nfe.prefeitura.sp.gov.br > Exportação de NFS-e
 *   2. Escolhe Emitidas/Recebidas + período + Layout V.006 (CSV)
 *   3. Baixa o CSV
 *   4. Sobe aqui — sistema parseia e importa pro Firestore
 *
 * Funciona pra qualquer empresa cliente do escritório que tenha CCM SP.
 * Não depende do WS (que está dando 1102 desde Reforma Tributária 2026).
 */

import React, { useState, useRef } from 'react';
import { getAuth } from 'firebase/auth';
import type { User } from '../../types';

interface Props {
    currentUser: User;
    onImported?: () => void;
    onShowToast?: (msg: string) => void;
}

interface ResultadoImport {
    layout: string;
    ccmExportado: string;
    totalNotas: number;
    criadas: number;
    atualizadas: number;
    erros: number;
    valorTotal: number;
    periodo: { inicio: string | null; fim: string | null };
    duracaoMs: number;
    contagemBate: boolean;
    somaBate: boolean;
}

const formatBRL = (n: number | undefined | null) =>
    typeof n === 'number'
        ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : '—';

const formatDateBR = (iso: string | null) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short' });
    } catch {
        return iso;
    }
};

const XmlNfseSpCsv: React.FC<Props> = ({ currentUser, onImported, onShowToast }) => {
    const [file, setFile] = useState<File | null>(null);
    const [direcao, setDirecao] = useState<'auto' | 'saida' | 'entrada'>('auto');
    const [empresaCnpj, setEmpresaCnpj] = useState('');
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [resultado, setResultado] = useState<ResultadoImport | null>(null);
    const [ctxRetornado, setCtxRetornado] = useState<any>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleUpload = async () => {
        if (!file) {
            setErro('Selecione um arquivo CSV primeiro');
            return;
        }
        setLoading(true);
        setErro(null);
        setResultado(null);
        try {
            const token = await getAuth().currentUser?.getIdToken();
            if (!token) throw new Error('Sessão expirada');
            const fd = new FormData();
            fd.append('csv', file);
            if (direcao !== 'auto') fd.append('direcao', direcao);
            if (empresaCnpj.replace(/\D/g, '').length === 14) {
                fd.append('empresaCnpj', empresaCnpj.replace(/\D/g, ''));
            }

            const res = await fetch('/api/admin/sefaz/nfsesp-importar-csv', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: fd,
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.erro || `HTTP ${res.status}`);
            }
            setResultado(data.resumo);
            setCtxRetornado(data.ctx);
            if (onShowToast) onShowToast(`${data.resumo.totalNotas} NFs importadas (${data.resumo.criadas} novas, ${data.resumo.atualizadas} atualizadas)`);
            if (onImported) onImported();
        } catch (e: any) {
            setErro(e.message || 'Falha ao importar CSV');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4 rounded-lg text-white">
                <h3 className="text-base font-bold">📥 Importar NFS-e SP via CSV (portal oficial)</h3>
                <p className="text-xs text-blue-100 mt-1">
                    Solução para 254 empresas — não depende do WS. Importa em segundos.
                </p>
            </div>

            <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm">
                <p className="font-semibold text-amber-900 mb-2">📋 Como obter o CSV:</p>
                <ol className="list-decimal list-inside text-xs text-amber-800 space-y-1">
                    <li>Acesse <a href="https://nfe.prefeitura.sp.gov.br" target="_blank" rel="noreferrer" className="text-blue-700 underline">nfe.prefeitura.sp.gov.br</a> com cert digital da empresa</li>
                    <li>Menu lateral → <strong>Exportação de NFS-e</strong></li>
                    <li>Escolha <strong>NFS-e Emitidas</strong> ou <strong>NFS-e Recebidas</strong></li>
                    <li>Defina período (ex: 01/04/2026 a 30/04/2026)</li>
                    <li>TIPO: <strong>Planilha (CSV)</strong> + LAYOUT: <strong>V.006</strong></li>
                    <li>Clique <strong>EXPORTAR ARQUIVO</strong> e baixe o CSV</li>
                    <li>Sobe aqui ⬇</li>
                </ol>
            </div>

            <div className="space-y-3 p-4 border rounded">
                <div>
                    <label className="text-sm font-semibold">Arquivo CSV do portal SP:</label>
                    <input
                        ref={inputRef}
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => {
                            setFile(e.target.files?.[0] || null);
                            setResultado(null);
                            setErro(null);
                        }}
                        className="block w-full mt-1 text-sm border rounded p-2 bg-white"
                    />
                    {file && (
                        <p className="text-xs text-gray-600 mt-1">
                            📄 {file.name} ({(file.size / 1024).toFixed(1)} KB)
                        </p>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="text-sm font-semibold">Direção (opcional — auto detecta pelo nome do arquivo):</label>
                        <select
                            value={direcao}
                            onChange={(e) => setDirecao(e.target.value as any)}
                            className="block w-full mt-1 text-sm border rounded p-2 bg-white"
                        >
                            <option value="auto">🔍 Auto-detectar pelo nome do arquivo (E=emitidas, R=recebidas)</option>
                            <option value="saida">📤 Emitidas (serviços prestados pela empresa)</option>
                            <option value="entrada">📥 Recebidas (serviços tomados pela empresa)</option>
                        </select>
                    </div>

                    <div>
                        <label className="text-sm font-semibold">CNPJ da empresa (opcional — auto detecta por CCM):</label>
                        <input
                            type="text"
                            value={empresaCnpj}
                            onChange={(e) => setEmpresaCnpj(e.target.value)}
                            placeholder="44.388.152/0001-89"
                            className="block w-full mt-1 text-sm border rounded p-2 bg-white"
                        />
                    </div>
                </div>

                <button
                    onClick={handleUpload}
                    disabled={!file || loading}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? '⏳ Importando…' : '🚀 Importar CSV'}
                </button>
            </div>

            {erro && (
                <div className="p-4 bg-red-50 border border-red-300 rounded">
                    <p className="text-red-700 text-sm font-semibold">❌ Erro na importação</p>
                    <p className="text-red-600 text-xs mt-1 whitespace-pre-wrap">{erro}</p>
                </div>
            )}

            {resultado && (
                <div className="p-4 bg-green-50 border border-green-300 rounded space-y-3">
                    <div className="flex items-start justify-between">
                        <div>
                            <h4 className="font-bold text-green-900">✅ Importação concluída em {resultado.duracaoMs}ms</h4>
                            <p className="text-xs text-green-700">
                                Layout {resultado.layout} · CCM {resultado.ccmExportado}
                                {ctxRetornado?.empresaNome && ` · Empresa: ${ctxRetornado.empresaNome}`}
                                {ctxRetornado?.direcao && ` · ${ctxRetornado.direcao === 'saida' ? '📤 Emitidas' : '📥 Recebidas'}`}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                        <div className="bg-white p-2 rounded border">
                            <div className="text-2xl font-bold text-blue-700">{resultado.totalNotas}</div>
                            <div className="text-[10px] text-gray-600">Total NFs</div>
                        </div>
                        <div className="bg-white p-2 rounded border">
                            <div className="text-2xl font-bold text-green-700">{resultado.criadas}</div>
                            <div className="text-[10px] text-gray-600">Novas</div>
                        </div>
                        <div className="bg-white p-2 rounded border">
                            <div className="text-2xl font-bold text-amber-700">{resultado.atualizadas}</div>
                            <div className="text-[10px] text-gray-600">Atualizadas</div>
                        </div>
                        <div className={`bg-white p-2 rounded border ${resultado.erros > 0 ? 'border-red-400' : ''}`}>
                            <div className={`text-2xl font-bold ${resultado.erros > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                                {resultado.erros}
                            </div>
                            <div className="text-[10px] text-gray-600">Erros</div>
                        </div>
                    </div>

                    <div className="bg-white p-3 rounded border space-y-1 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-600">💰 Valor total:</span>
                            <span className="font-bold text-green-700">{formatBRL(resultado.valorTotal)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-600">📅 Período:</span>
                            <span className="font-mono">
                                {formatDateBR(resultado.periodo.inicio)} → {formatDateBR(resultado.periodo.fim)}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs pt-1 border-t">
                            <span>Contagem CSV bate:</span>
                            <span>{resultado.contagemBate ? '✅' : '⚠️ divergência'}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span>Soma de valores bate:</span>
                            <span>{resultado.somaBate ? '✅' : '⚠️ divergência'}</span>
                        </div>
                    </div>

                    <p className="text-xs text-gray-600 text-center">
                        As NFs já estão no Firestore. Veja na aba <strong>XMLs Capturados</strong>.
                    </p>
                </div>
            )}
        </div>
    );
};

export default XmlNfseSpCsv;
