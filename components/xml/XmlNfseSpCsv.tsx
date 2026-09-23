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
 *
 * 🏛️ E O CSV DO PORTAL DE **BARUERI** ENTRA PELA MESMA PORTA (10/09). O Paulo
 * subiu o arquivo de lá nesta tela e ela recusou — *"o modelo de importação
 * CSV que tem no consultor são para as NFS SP"*. Aba nova seria a tela que só
 * eu sei onde fica (a lição do card CFOP, 18/08): **quem identifica o leiaute
 * é o ARQUIVO**, e o backend responde qual município reconheceu.
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
    ccmExportado?: string;
    /** Só no CSV de Barueri — a tela DIZ qual leiaute o backend reconheceu. */
    municipio?: string;
    canceladas?: number;
    /** As que estavam ATIVAS no banco e o município diz que foram canceladas. */
    viraramCanceladas?: Array<{ numero: string; valor: number | null }>;
    semValor?: number;
    colunasLidas?: number;
    totalNotas: number;
    criadas: number;
    atualizadas: number;
    erros: number;
    valorTotal: number;
    periodo: { inicio: string | null; fim: string | null };
    duracaoMs: number;
    contagemBate?: boolean;
    somaBate?: boolean;
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
    const [avisos, setAvisos] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleUpload = async () => {
        if (!file) {
            setErro('Selecione um arquivo CSV primeiro');
            return;
        }
        setLoading(true);
        setErro(null);
        setResultado(null);
        setAvisos([]);
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
            setAvisos([...(data.avisos || []), ...(data.avisosRetencao || [])]
                .filter((a: string) => a && !/Nenhuma incoer/i.test(a)));
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
                <h3 className="text-base font-bold">📥 Importar NFS-e por CSV do portal (São Paulo e Barueri)</h3>
                <p className="text-xs text-blue-100 mt-1">
                    Sobe o arquivo que você já baixa do portal do município — o CFI reconhece o leiaute sozinho
                    e diz qual município leu.
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
                <p className="font-semibold text-amber-900 mt-3 mb-1">🏛️ Barueri:</p>
                <ol className="list-decimal list-inside text-xs text-amber-800 space-y-1">
                    <li>No portal da Prefeitura de Barueri, exporte a consulta de NFS-e em <strong>CSV</strong></li>
                    <li>Sobe aqui — o CFI reconhece o arquivo pelo cabeçalho, não pelo nome</li>
                    <li>
                        A coluna <strong>Nf Ativa</strong> do arquivo diz o que foi cancelado: a nota entra já
                        cancelada, sem ninguém marcar à mão
                    </li>
                    <li>
                        O <strong>TXT</strong> de lote daquele portal ainda não é lido — use o CSV, que traz as
                        mesmas notas
                    </li>
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
                        <label className="text-sm font-semibold">
                            Direção (opcional — em Barueri sai da própria nota e este campo é ignorado):
                        </label>
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
                        <label className="text-sm font-semibold">
                            CNPJ da empresa (opcional — SP acha pelo CCM, Barueri acha pela chave de acesso):
                        </label>
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
                                {resultado.municipio ? `🏛️ ${resultado.municipio}` : 'São Paulo'} · Layout {resultado.layout}
                                {resultado.ccmExportado && ` · CCM ${resultado.ccmExportado}`}
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
                        {typeof resultado.contagemBate === 'boolean' && (
                            <div className="flex justify-between text-xs pt-1 border-t">
                                <span>Contagem CSV bate:</span>
                                <span>{resultado.contagemBate ? '✅' : '⚠️ divergência'}</span>
                            </div>
                        )}
                        {typeof resultado.somaBate === 'boolean' && (
                            <div className="flex justify-between text-xs">
                                <span>Soma de valores bate:</span>
                                <span>{resultado.somaBate ? '✅' : '⚠️ divergência'}</span>
                            </div>
                        )}
                        {typeof resultado.canceladas === 'number' && (
                            <div className="flex justify-between text-xs pt-1 border-t">
                                <span className="text-gray-600">🚫 Canceladas no arquivo:</span>
                                <span className="font-semibold">{resultado.canceladas}</span>
                            </div>
                        )}
                        {typeof resultado.semValor === 'number' && resultado.semValor > 0 && (
                            <div className="flex justify-between text-xs">
                                <span className="text-gray-600">Sem valor legível (fora da soma):</span>
                                <span className="font-semibold text-amber-700">{resultado.semValor}</span>
                            </div>
                        )}
                    </div>

                    {/* 🚨 O QUE ESTA IMPORTAÇÃO MUDOU NO QUE JÁ ESTAVA NO BANCO.
                        É a resposta ao caso de 10/09: a nota subiu ATIVA pelo
                        Portal Nacional e o município diz que ela foi cancelada.
                        Sem esta linha, o faturamento muda e ninguém sabe. */}
                    {!!resultado.viraramCanceladas?.length && (
                        <div className="p-3 bg-red-50 border border-red-300 rounded text-sm">
                            <p className="font-semibold text-red-800">
                                🚫 {resultado.viraramCanceladas.length} nota(s) estavam ATIVAS no CFI e o portal do
                                município diz que foram CANCELADAS
                            </p>
                            <ul className="mt-1 text-xs text-red-700 list-disc list-inside">
                                {resultado.viraramCanceladas.slice(0, 20).map((n) => (
                                    <li key={n.numero}>
                                        NFS-e {n.numero} — {formatBRL(n.valor)}
                                    </li>
                                ))}
                            </ul>
                            <p className="text-xs text-red-700 mt-2">
                                Elas saíram do faturamento e do Livro de Serviços desta competência. Se o mês já foi
                                fechado ou entregue, confira os números antes de seguir.
                            </p>
                        </div>
                    )}

                    {!!avisos.length && (
                        <div className="p-3 bg-amber-50 border border-amber-300 rounded text-xs text-amber-900 space-y-2">
                            {avisos.map((a, i) => (
                                <p key={i}>⚠️ {a}</p>
                            ))}
                        </div>
                    )}

                    <p className="text-xs text-gray-600 text-center">
                        As NFs já estão no Firestore. Veja na aba <strong>XMLs Capturados</strong>.
                    </p>
                </div>
            )}
        </div>
    );
};

export default XmlNfseSpCsv;
