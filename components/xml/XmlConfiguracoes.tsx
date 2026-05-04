import React from 'react';
import type { User } from '../../types';
import { isFirebaseConfigured, isFirebaseStorageConfigured } from '../../services/firebaseConfig';
import { isSefazCaptureAvailable } from '../../services/dfeCaptureService';
import { isSharePointAvailable } from '../../services/sharePointXmlService';

interface Props {
    currentUser: User;
}

const Row: React.FC<{ label: string; value: string; ok: boolean }> = ({ label, value, ok }) => (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
        <span className="text-xs text-slate-600 dark:text-slate-300">{label}</span>
        <span className={`text-xs font-bold ${ok ? 'text-emerald-600' : 'text-amber-600'}`}>{value}</span>
    </div>
);

const XmlConfiguracoes: React.FC<Props> = ({ currentUser }) => {
    return (
        <div className="space-y-3">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Status do módulo</h3>
                <Row label="Firebase Auth & Firestore" value={isFirebaseConfigured ? 'Configurado' : 'Não configurado'} ok={isFirebaseConfigured} />
                <Row label="Firebase Storage" value={isFirebaseStorageConfigured ? 'Configurado' : 'Pendente — configure VITE_FIREBASE_STORAGE_BUCKET'} ok={isFirebaseStorageConfigured} />
                <Row label="Captura SEFAZ" value={isSefazCaptureAvailable() ? 'Disponível' : 'Aguardando backend seguro'} ok={isSefazCaptureAvailable()} />
                <Row label="Captura SharePoint" value={isSharePointAvailable() ? 'Disponível' : 'Aguardando integração'} ok={isSharePointAvailable()} />
                <Row label="Perfil atual" value={currentUser.role === 'admin' ? 'Administrador (vê tudo)' : 'Colaborador (vê suas empresas)'} ok={true} />
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Regras de segurança</h3>
                <ul className="text-xs text-slate-500 list-disc pl-5 space-y-1">
                    <li>O XML original sempre é enviado ao Firebase Storage. O Firestore guarda apenas metadados.</li>
                    <li>Base64 é aceito apenas para exportação/API — nunca como armazenamento principal.</li>
                    <li>Certificado digital nunca trafega pelo navegador. A captura SEFAZ depende de backend seguro.</li>
                    <li>Toda importação registra usuário, data/hora e origem em <code>xml_capturas</code>; falhas em <code>xml_erros</code>.</li>
                    <li>Colaboradores só veem documentos que importaram. Administradores veem tudo.</li>
                </ul>
            </div>
        </div>
    );
};

export default XmlConfiguracoes;
