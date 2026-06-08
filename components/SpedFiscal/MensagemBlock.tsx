/**
 * components/SpedFiscal/MensagemBlock.tsx
 *
 * Bloco visual de mensagem (info/warning/error/success) com layout em
 * card colorido conforme tipo. Reutilizado pelas varias abas do SPED
 * (Gerar, Contribuicoes, Editar) pra mostrar feedback do backend.
 *
 * Extraido de index.tsx pra desinchar o componente principal.
 */
import React from 'react';

export interface MensagemRetorno {
    tipo: 'info' | 'warning' | 'error' | 'success';
    titulo: string;
    detalhes?: string;
    extras?: { label: string; value: string }[];
}

interface Props {
    mensagem: MensagemRetorno;
}

const MensagemBlock: React.FC<Props> = ({ mensagem }) => {
    const cor = mensagem.tipo === 'success' ? 'var(--success)' :
                mensagem.tipo === 'error' ? 'var(--danger)' :
                mensagem.tipo === 'warning' ? 'var(--warning)' : 'var(--accent)';
    const corSoft = mensagem.tipo === 'success' ? 'rgba(34,197,94,0.1)' :
                    mensagem.tipo === 'error' ? 'rgba(239,68,68,0.1)' :
                    mensagem.tipo === 'warning' ? 'var(--warning-soft)' : 'rgba(91,127,255,0.1)';
    const corSoftBorder = mensagem.tipo === 'success' ? 'rgba(34,197,94,0.3)' :
                          mensagem.tipo === 'error' ? 'rgba(239,68,68,0.3)' :
                          mensagem.tipo === 'warning' ? 'var(--warning-soft-border)' : 'rgba(91,127,255,0.3)';

    return (
        <div
            className="p-4 rounded-xl flex items-start gap-3 animate-fade-in"
            style={{ background: corSoft, border: `1px solid ${corSoftBorder}`, borderLeft: `4px solid ${cor}` }}
        >
            <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: cor }}>
                    {mensagem.titulo}
                </p>
                {mensagem.detalhes && (
                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                        {mensagem.detalhes}
                    </p>
                )}
                {mensagem.extras && (
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                        {mensagem.extras.map(e => (
                            <div key={e.label} className="p-2 rounded" style={{ background: 'var(--bg-card)' }}>
                                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                    {e.label}
                                </p>
                                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                                    {e.value}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MensagemBlock;
