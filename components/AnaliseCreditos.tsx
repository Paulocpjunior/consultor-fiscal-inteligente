// components/AnaliseCreditos.tsx
//
// Ponto de entrada da feature "Analise de Creditos" no App.tsx.
//
// Historicamente este componente tinha 3 abas:
//   - Digitacao Manual (form de 1 nota por vez)
//   - Upload Excel/XML (planilha/XML unicos)
//   - Extrato de Conciliacao (CSV Itau + PDF eFiscal + Retencoes NFSe SP)
//
// As 2 primeiras viraram vitrines de POC: o fluxo de producao migrou todo
// pro Extrato de Conciliacao, que ja contempla os casos de uso reais via
// 3 sub-modos. Mantemos o componente como wrapper pra preservar o ponto de
// entrada do App.tsx; as rotas /api/analise-creditos/manual e /upload do
// backend continuam vivas pra reuso futuro.
import React, { useEffect, useState } from 'react';
import AnaliseCreditoExtrato from './AnaliseCreditoExtrato';
import { getEmpresasParaPerfilCliente, type EmpresaPerfilOption } from '../services/xmlFiscalService';
import { listarEmpresasPerfilBackend } from '../services/empresasPerfilService';
import type { User } from '../types';

interface AnaliseCreditosProps {
    currentUser: User | null;
}

const AnaliseCreditos: React.FC<AnaliseCreditosProps> = ({ currentUser }) => {
    const [empresas, setEmpresas] = useState<EmpresaPerfilOption[]>([]);
    const [empresasLoading, setEmpresasLoading] = useState(false);
    const [empresasErro, setEmpresasErro] = useState<string | null>(null);

    useEffect(() => {
        let vivo = true;
        async function carregarEmpresas() {
            if (!currentUser) {
                setEmpresas([]);
                setEmpresasErro(null);
                setEmpresasLoading(false);
                return;
            }
            setEmpresasLoading(true);
            setEmpresasErro(null);
            try {
                const list = await listarEmpresasPerfilBackend(currentUser);
                if (vivo) setEmpresas(list || []);
            } catch (err: any) {
                console.warn('listarEmpresasPerfilBackend:', err?.message);
                try {
                    const fallback = await getEmpresasParaPerfilCliente(currentUser);
                    if (vivo) {
                        setEmpresas(fallback || []);
                        setEmpresasErro(err?.message || 'Falha ao carregar empresas pelo servidor.');
                    }
                } catch (fallbackErr: any) {
                    if (vivo) {
                        setEmpresas([]);
                        setEmpresasErro(fallbackErr?.message || err?.message || 'Falha ao carregar empresas.');
                    }
                }
            } finally {
                if (vivo) setEmpresasLoading(false);
            }
        }
        carregarEmpresas();
        return () => { vivo = false; };
    }, [currentUser]);

    return (
        <AnaliseCreditoExtrato
            currentUser={currentUser}
            empresas={empresas}
            empresasLoading={empresasLoading}
            empresasErro={empresasErro}
        />
    );
};

export default AnaliseCreditos;
