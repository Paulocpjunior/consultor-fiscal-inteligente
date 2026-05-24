import React from 'react';
import type { User } from '../../types';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const AnaliseConferencia: React.FC<Props> = ({ currentUser, onShowToast }) => {
    return <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Carregando módulo de análise...</p>;
};

export default AnaliseConferencia;
