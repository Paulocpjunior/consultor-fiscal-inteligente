import React, { useEffect, useState } from 'react';
import type { User } from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { isSefazCaptureAvailable } from '../../services/dfeCaptureService';
import { formatCnpjCpf } from '../../services/xmlParserService';

import SefazSyncButton from '../SefazSyncButton';
interface Props {
    currentUser: User;
}

const XmlEmpresasMonitoradas: React.FC<Props> = ({ currentUser }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        getEmpresasDisponiveis(currentUser).then(list => {
            if (alive) { setEmpresas(list); setLoading(false); }
        });
        return () => { alive = false; };
    }, [currentUser]);

    return (
        <div className="space-y-3">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                    <strong>Captura SEFAZ ativa.</strong> Cron noturno automático às 02:00 BRT seg-sex.
                    Captura manual disponível das 07:00 às 20:00 BRT (botão verde abaixo).
                    O certificado digital fica protegido no servidor — nunca trafega pelo navegador.
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
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">Captura SEFAZ</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">SharePoint</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {empresas.map(e => (
                                <tr key={e.id}>
                                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{e.nome}</td>
                                    <td className="px-3 py-2 text-slate-500 font-mono">{formatCnpjCpf(e.cnpj)}</td>
                                    <td className="px-3 py-2 text-slate-500 capitalize">{e.fonte}</td>
                                    <td className="px-3 py-2"><SefazSyncButton empresa={e} currentUser={currentUser} /></td>
                                    <td className="px-3 py-2 text-slate-400">Pendente backend</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default XmlEmpresasMonitoradas;
