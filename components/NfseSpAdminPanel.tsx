import React, { useState } from 'react';
import * as nfseSpService from '../services/nfseSpService';
import LoadingSpinner from './LoadingSpinner';

interface Props {
    empresaId: string;
    colecao: 'simples_empresas' | 'lucro_empresas';
    ccmSpAtual: string | undefined;
    nfseSpAutorizadoEmAtual: string | undefined;
    onSalvarConfig: (campos: { ccmSp: string; nfseSpAutorizadoEm: string }) => Promise<void>;
    onShowToast: (msg: string) => void;
}

const NfseSpAdminPanel: React.FC<Props> = ({
    empresaId,
    colecao,
    ccmSpAtual,
    nfseSpAutorizadoEmAtual,
    onSalvarConfig,
    onShowToast,
}) => {
    const [ccmSp, setCcmSp] = useState(ccmSpAtual || '');
    const [autorizado, setAutorizado] = useState(
        nfseSpAutorizadoEmAtual ? nfseSpAutorizadoEmAtual.substring(0, 10) : ''
    );
    const [salvando, setSalvando] = useState(false);
    const [consultando, setConsultando] = useState(false);
    const [ultimoResultado, setUltimoResultado] = useState<nfseSpService.NfseSpResultadoEmpresa | null>(null);

    const elegivel = !!(ccmSpAtual && nfseSpAutorizadoEmAtual);
    const camposPreenchidos = !!(ccmSp.trim() && autorizado);

    const handleSalvar = async () => {
        if (!camposPreenchidos) {
            onShowToast('Preencha CCM SP e a data de autorização.');
            return;
        }
        setSalvando(true);
        try {
            const dataIso = new Date(autorizado + 'T00:00:00').toISOString();
            await onSalvarConfig({ ccmSp: ccmSp.trim(), nfseSpAutorizadoEm: dataIso });
            onShowToast('Configuração NFS-e SP salva. Empresa agora é elegível pra captura.');
        } catch (e: any) {
            onShowToast(`Erro ao salvar: ${e.message}`);
        } finally {
            setSalvando(false);
        }
    };

    const handleConsultar = async () => {
        if (!elegivel) {
            onShowToast('Salve a configuração antes de consultar.');
            return;
        }
        setConsultando(true);
        setUltimoResultado(null);
        try {
            const r = await nfseSpService.consultarUma(empresaId, colecao);
            setUltimoResultado(r);
            if (r.sucesso) {
                onShowToast(
                    `NFS-e SP consultada: ${r.totalNFes} NFs (${r.criadas} novas, ${r.atualizadas} atualizadas) em ${r.durationMs}ms`
                );
            } else {
                const msg = r.erros[0]?.descricao || r.erros[0]?.erro || 'Falha desconhecida';
                onShowToast(`NFS-e SP falhou: ${msg.substring(0, 80)}`);
            }
        } catch (e: any) {
            onShowToast(`Erro: ${e.message}`);
        } finally {
            setConsultando(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-start justify-between mb-3">
                <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        🏛️ NFS-e SP capital
                        {elegivel ? (
                            <span className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-semibold">
                                ELEGÍVEL
                            </span>
                        ) : (
                            <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-semibold">
                                PENDENTE CONFIG
                            </span>
                        )}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Captura automática de notas recebidas via portal Nota do Milhão.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        CCM SP (Inscrição Municipal)
                    </label>
                    <input
                        type="text"
                        value={ccmSp}
                        onChange={(e) => setCcmSp(e.target.value.replace(/\D/g, ''))}
                        placeholder="Ex: 12345678 ou 123456789012"
                        className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md focus:ring-2 focus:ring-sky-500 outline-none"
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Data autorização contador
                    </label>
                    <input
                        type="date"
                        value={autorizado}
                        onChange={(e) => setAutorizado(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md focus:ring-2 focus:ring-sky-500 outline-none"
                    />
                </div>
            </div>

            <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 bg-slate-50 dark:bg-slate-900/40 p-2 rounded border border-slate-200 dark:border-slate-700">
                <strong>Antes de salvar:</strong> o cliente precisa entrar em
                <span className="font-mono"> nfe.prefeitura.sp.gov.br </span>
                → Configurações do Perfil do Contribuinte → autorizar o CNPJ
                <span className="font-mono"> 44.388.152/0001-89 </span>
                (SP Contábil) como contador.
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={handleSalvar}
                    disabled={salvando || !camposPreenchidos}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-700 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition"
                >
                    {salvando ? <LoadingSpinner /> : '💾 Salvar configuração'}
                </button>
                <button
                    type="button"
                    onClick={handleConsultar}
                    disabled={consultando || !elegivel}
                    className="px-3 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition"
                    title={elegivel ? 'Consulta últimos 2 meses (corrente + anterior)' : 'Preencha CCM e data antes'}
                >
                    {consultando ? <LoadingSpinner /> : '🔄 Consultar NFS-e SP recebidas'}
                </button>
            </div>

            {ultimoResultado && (
                <div
                    className={`mt-3 p-2 text-xs rounded border ${
                        ultimoResultado.sucesso
                            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
                            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                    }`}
                >
                    <div className="font-semibold mb-1">
                        {ultimoResultado.sucesso
                            ? `✓ ${ultimoResultado.totalNFes} NFS-e capturadas`
                            : '✗ Falha na consulta'}
                        <span className="font-normal text-[10px] ml-2">({ultimoResultado.durationMs}ms)</span>
                    </div>
                    {ultimoResultado.sucesso ? (
                        <div className="font-mono text-[10px]">
                            {ultimoResultado.criadas} novas · {ultimoResultado.atualizadas} atualizadas
                        </div>
                    ) : (
                        <div className="font-mono text-[10px]">
                            {ultimoResultado.erros
                                .map((e) => e.descricao || e.erro || e.codigo || '')
                                .filter(Boolean)
                                .join(' / ')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default NfseSpAdminPanel;
