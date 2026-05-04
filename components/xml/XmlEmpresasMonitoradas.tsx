import React, { useEffect, useState } from 'react';
import type { User } from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { isSefazCaptureAvailable, pingBackend } from '../../services/dfeCaptureService';
import { formatCnpjCpf } from '../../services/xmlParserService';
import XmlCertificadoModal from './XmlCertificadoModal';

interface Props {
    currentUser: User;
}

const XmlEmpresasMonitoradas: React.FC<Props> = ({ currentUser }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [backendStatus, setBackendStatus] = useState<{ ok: boolean; mode?: string; motivo?: string } | null>(null);
    const [empresaCert, setEmpresaCert] = useState<EmpresaXmlOption | null>(null);

    useEffect(() => {
        let alive = true;
        getEmpresasDisponiveis(currentUser).then(list => {
            if (alive) { setEmpresas(list); setLoading(false); }
        });
        if (isSefazCaptureAvailable()) {
            pingBackend().then(s => { if (alive) setBackendStatus(s); });
        }
        return () => { alive = false; };
    }, [currentUser]);

    const sefazAvailable = isSefazCaptureAvailable();

    return (
        <div className="space-y-3">
            <div className={`rounded-lg p-3 border ${sefazAvailable
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'}`}>
                <p className={`text-xs ${sefazAvailable ? 'text-emerald-800 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}`}>
                    {sefazAvailable
                        ? <>Backend SEFAZ disponível ({backendStatus?.mode || '...'}). Cadastre certificados A1 abaixo para habilitar a consulta automática.</>
                        : <>Captura automática SEFAZ ainda não habilitada (VITE_SEFAZ_BACKEND_URL ausente). Configure o secret no GitHub e re-deploy o front-end.</>
                    }
                </p>
                <p className={`text-[11px] mt-1 ${sefazAvailable ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                    O certificado digital nunca trafega pelo navegador como texto — vai direto ao backend e é armazenado em Google Secret Manager.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Empresas elegíveis ({empresas.length})</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Lista oriunda dos cadastros de Simples Nacional e Lucro Presumido/Real.</p>
                </div>
                {loading ? <p className="text-center text-xs text-slate-400 py-6">Carregando...</p>
                : empresas.length === 0 ? <p className="text-center text-xs text-slate-400 py-6">Nenhuma empresa disponível para o seu perfil.</p>
                : (
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-700">
                            <tr>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">Empresa</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">CNPJ</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">Origem</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">Certificado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {empresas.map(e => (
                                <tr key={e.id}>
                                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{e.nome}</td>
                                    <td className="px-3 py-2 text-slate-500 font-mono">{formatCnpjCpf(e.cnpj)}</td>
                                    <td className="px-3 py-2 text-slate-500 capitalize">{e.fonte}</td>
                                    <td className="px-3 py-2">
                                        <button
                                            onClick={() => setEmpresaCert(e)}
                                            disabled={!sefazAvailable}
                                            title={sefazAvailable ? 'Cadastrar/atualizar certificado A1' : 'Backend SEFAZ não configurado'}
                                            className="px-2 py-1 text-[11px] bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Cadastrar Cert
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {empresaCert && (
                <XmlCertificadoModal
                    empresaCnpj={empresaCert.cnpj}
                    empresaNome={empresaCert.nome}
                    onClose={() => setEmpresaCert(null)}
                />
            )}
        </div>
    );
};

export default XmlEmpresasMonitoradas;
