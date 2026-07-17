import React, { useState, useRef } from 'react';
import { getAuth } from 'firebase/auth';
import { capturarNFCeSaida, type SaeNfceResultado } from '../../services/saeNfceService';

/**
 * SaeNfceCaptura — painel admin da captura de SAÍDA de NFC-e (modelo 65) via
 * SAE-NFC-e da SEFAZ-SP, com o A1 do próprio contribuinte (do cofre).
 *
 * Só NFC-e (mod 65). Janela máxima de 100 dias por consulta.
 *
 * Auto-drenagem: cada chamada ao backend respeita um orçamento de ~2 min
 * (retorno parcial) para não estourar o timeout do Cloud Run. A UI encadeia as
 * rodadas automaticamente — retomando do cursor (retomarDataInicial) — até não
 * haver mais parcial, acumulando os totais. Um clique drena o período inteiro.
 */
const MAX_RODADAS = 80; // teto defensivo (cada rodada ~2 min)

const SaeNfceCaptura: React.FC = () => {
    const [cnpj, setCnpj] = useState('32602701000197'); // Vinatex (piloto — emite mod 65)
    const [dataInicial, setDataInicial] = useState('');
    const [dataFinal, setDataFinal] = useState('');
    const [loading, setLoading] = useState(false);
    const [resp, setResp] = useState<SaeNfceResultado | null>(null);
    const [rodada, setRodada] = useState(0);
    const pararRef = useRef(false);

    const rodar = async () => {
        setLoading(true);
        setResp(null);
        setRodada(0);
        pararRef.current = false;
        const acc = { chavesEncontradas: 0, baixadas: 0, importadas: 0, duplicadas: 0, jaCompletas: 0, erros: 0 };
        const errosDetalhe: string[] = [];
        let inicial = dataInicial;
        let cursorAnterior = '';
        try {
            for (let i = 1; i <= MAX_RODADAS; i++) {
                setRodada(i);
                const r = await capturarNFCeSaida({ cnpj, dataInicial: inicial, dataFinal });
                if (!r.ok) { setResp(r); return; }
                acc.chavesEncontradas += r.chavesEncontradas || 0;
                acc.baixadas += r.baixadas || 0;
                acc.importadas += r.importadas || 0;
                acc.duplicadas += r.duplicadas || 0;
                acc.jaCompletas += r.jaCompletas || 0;
                acc.erros += r.erros || 0;
                if (r.errosDetalhe) for (const e of r.errosDetalhe) if (errosDetalhe.length < 20) errosDetalhe.push(e);
                // Mostra o acumulado a cada rodada (progresso ao vivo).
                setResp({
                    ok: true,
                    periodo: { de: dataInicial || '(auto)', ate: dataFinal || '(agora)' },
                    ...acc,
                    errosDetalhe: errosDetalhe.length ? errosDetalhe : undefined,
                    parcial: !!r.parcial,
                    veredito: `${acc.importadas} importadas, ${acc.jaCompletas} já completas, ${acc.duplicadas} duplicadas, ${acc.erros} erros`,
                });
                if (!r.parcial) return;                 // drenou tudo
                if (pararRef.current) return;           // usuário pediu parar
                const prox = r.retomarDataInicial;
                if (!prox || prox === cursorAnterior) return; // sem avanço → evita loop
                cursorAnterior = prox;
                inicial = prox;
            }
        } catch (e) {
            setResp({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setLoading(false);
            pararRef.current = false;
        }
    };

    // Agente A3: baixa o script PowerShell já configurado com a URL do app e a
    // API key pública do Firebase (mesma que vai no bundle do frontend).
    const [baixandoAgente, setBaixandoAgente] = useState(false);
    const baixarAgenteA3 = async () => {
        setBaixandoAgente(true);
        try {
            const raw = await (await fetch('/agente-a3-sae-nfce.ps1')).text();
            const apiKey = (getAuth().app.options as { apiKey?: string }).apiKey || '';
            const script = raw
                .replace('__APP_URL__', window.location.origin)
                .replace('__API_KEY__', apiKey);
            const blob = new Blob([script], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'agente-a3-sae-nfce.ps1';
            a.click();
            URL.revokeObjectURL(a.href);
        } finally {
            setBaixandoAgente(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    🧾 Captura de NFC-e de Saída (SAE-NFC-e · SEFAZ-SP)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Baixa as <strong>NFC-e (modelo 65) emitidas</strong> pelo contribuinte via webservice
                    SAE-NFC-e, usando o A1 dele (do cofre). Grava como <code>direção=saída</code>.
                    Só NFC-e; NF-e (mod 55) é pelo trilho do portal. Janela máx. 100 dias — vazio = últimos 100 dias.
                </p>
                <div className="flex flex-wrap items-end gap-2 mt-3">
                    <label className="text-xs text-slate-600 dark:text-slate-300">
                        CNPJ do contribuinte
                        <input value={cnpj} onChange={e => setCnpj(e.target.value)}
                            className="block mt-1 w-44 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-mono" />
                    </label>
                    <label className="text-xs text-slate-600 dark:text-slate-300">
                        Data inicial
                        <input type="date" value={dataInicial} onChange={e => setDataInicial(e.target.value)}
                            className="block mt-1 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
                    </label>
                    <label className="text-xs text-slate-600 dark:text-slate-300">
                        Data final
                        <input type="date" value={dataFinal} onChange={e => setDataFinal(e.target.value)}
                            className="block mt-1 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
                    </label>
                    <button onClick={rodar} disabled={loading || cnpj.replace(/\D/g, '').length < 8}
                        className="px-4 py-1.5 text-xs font-bold rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white">
                        {loading ? `Capturando… (rodada ${rodada})` : 'Capturar NFC-e de saída'}
                    </button>
                    {loading && (
                        <button onClick={() => { pararRef.current = true; }}
                            className="px-3 py-1.5 text-xs font-bold rounded-md bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200">
                            Parar após esta rodada
                        </button>
                    )}
                </div>
                {loading && <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Consultando a SEFAZ-SP e baixando XMLs — a captura continua sozinha até drenar o período (cada rodada ~2 min)…</p>}
            </div>

            {resp && !resp.ok && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-sm font-bold text-red-700 dark:text-red-300">Falha na captura</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">{resp.error || 'Erro desconhecido.'}</p>
                </div>
            )}

            {resp && resp.ok && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 space-y-2">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-100">✓ {resp.veredito}</p>
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                        <dt className="text-slate-500">Período</dt><dd className="text-slate-700 dark:text-slate-200">{resp.periodo?.de} → {resp.periodo?.ate}</dd>
                        <dt className="text-slate-500">Chaves encontradas</dt><dd className="text-slate-700 dark:text-slate-200">{resp.chavesEncontradas ?? 0}</dd>
                        <dt className="text-slate-500">Importadas</dt><dd className="text-slate-700 dark:text-slate-200">{resp.importadas ?? 0}</dd>
                        <dt className="text-slate-500">Já completas</dt><dd className="text-slate-700 dark:text-slate-200">{resp.jaCompletas ?? 0}</dd>
                        <dt className="text-slate-500">Duplicadas</dt><dd className="text-slate-700 dark:text-slate-200">{resp.duplicadas ?? 0}</dd>
                        <dt className="text-slate-500">Erros</dt><dd className="text-slate-700 dark:text-slate-200">{resp.erros ?? 0}</dd>
                    </dl>
                    {resp.parcial && loading && <p className="text-xs text-amber-600 dark:text-amber-400">⏳ Drenando o período… a captura continua automaticamente (rodada {rodada}). Os totais acima sobem a cada rodada.</p>}
                    {resp.parcial && !loading && <p className="text-xs text-amber-600 dark:text-amber-400">⏸ Interrompido antes de drenar tudo. Clique em <strong>“Capturar NFC-e de saída”</strong> para retomar — as já baixadas são puladas automaticamente.</p>}
                    {!resp.parcial && !loading && <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ Período drenado por completo.</p>}
                    {resp.limiteAtingido && <p className="text-xs text-amber-600 dark:text-amber-400">⚠ Limite de segurança atingido — rode períodos menores para pegar o restante.</p>}
                    {resp.errosDetalhe && resp.errosDetalhe.length > 0 && (
                        <details className="text-xs">
                            <summary className="cursor-pointer text-slate-500">Ver erros ({resp.errosDetalhe.length})</summary>
                            <ul className="mt-1 list-disc list-inside text-red-600 dark:text-red-400">
                                {resp.errosDetalhe.map((e, i) => <li key={i} className="break-all">{e}</li>)}
                            </ul>
                        </details>
                    )}
                </div>
            )}

            {/* ─── Certificado A3 (cartão/token) ─────────────────────────── */}
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    💳 Cliente com certificado A3 (cartão/token)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    O A3 não pode ser copiado para o cofre (a chave vive dentro do cartão) — então a captura
                    roda <strong>na máquina onde o cartão está inserido</strong>, com o <strong>Agente A3</strong>:
                    um script que percorre <em>exatamente o mesmo trajeto</em> da captura A1 (listagem + download
                    na SEFAZ-SP) e envia os XMLs para cá, passando pelo mesmo importador (dedup, direção=saída).
                </p>
                <ol className="text-xs text-slate-600 dark:text-slate-300 mt-2 list-decimal list-inside space-y-1">
                    <li>Insira o cartão A3 na leitora (middleware do fornecedor instalado).</li>
                    <li>Baixe o agente abaixo e execute: botão direito → <em>“Executar com o PowerShell”</em>.</li>
                    <li>Escolha o certificado do cliente, informe o período e faça login com seu usuário CFI.</li>
                    <li>O PIN é pedido pelo próprio cartão; o script não vê nem guarda o PIN.</li>
                    <li>Ao final, confira em <em>XMLs NFe (Entrada/Saída)</em> — mesmas regras da captura A1.</li>
                </ol>
                <button onClick={baixarAgenteA3} disabled={baixandoAgente}
                    className="mt-3 px-4 py-1.5 text-xs font-bold rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white">
                    {baixandoAgente ? 'Preparando…' : '⬇ Baixar Agente A3 (Windows)'}
                </button>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
                    Se o envio automático falhar (sem internet no momento, sessão expirada), os XMLs ficam salvos
                    numa pasta local <code>NFCe-Saida-&lt;CNPJ&gt;</code> — importe depois pela aba <em>Importação Manual</em>.
                </p>
            </div>
        </div>
    );
};

export default SaeNfceCaptura;
