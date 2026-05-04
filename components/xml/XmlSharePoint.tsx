import React, { useState } from 'react';
import { isSharePointAvailable, testSharePointConnection } from '../../services/sharePointXmlService';

const XmlSharePoint: React.FC = () => {
    const [folderUrl, setFolderUrl] = useState('');
    const [result, setResult] = useState<string | null>(null);
    const [testing, setTesting] = useState(false);

    const handleTest = async () => {
        setTesting(true);
        const r = await testSharePointConnection(folderUrl);
        setResult(r.mensagem);
        setTesting(false);
    };

    return (
        <div className="space-y-3">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <p className="text-xs text-amber-800 dark:text-amber-300">
                    Integração SharePoint {isSharePointAvailable() ? 'disponível' : 'não habilitada nesta fase'}.
                    Quando ativa, XMLs serão lidos automaticamente de pastas do SharePoint via Microsoft Graph + backend seguro.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    URL da pasta no SharePoint
                </label>
                <input
                    value={folderUrl}
                    onChange={e => setFolderUrl(e.target.value)}
                    placeholder="https://contoso.sharepoint.com/sites/Fiscal/Documentos/XMLs"
                    className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-xs"
                />
                <button
                    onClick={handleTest}
                    disabled={!folderUrl || testing}
                    className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                >
                    {testing ? 'Testando...' : 'Testar conexão'}
                </button>
                {result && <p className="text-xs text-slate-500">{result}</p>}
            </div>
        </div>
    );
};

export default XmlSharePoint;
