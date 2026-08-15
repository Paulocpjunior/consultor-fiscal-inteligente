/**
 * EmpresaAtivaFixa — o que fica NO LUGAR do seletor interno.
 *
 * Paulo, 15/08: *"faz a segunda metade, tira os seletores internos"*.
 *
 * O painel não pergunta mais "qual empresa?" — ele DIZ em qual está, e oferece
 * um caminho só para trocar: o trocador global. Antes dava para ativar a
 * empresa A no cabeçalho e escolher a B dentro do módulo, e a tela não
 * denunciava nada; era o mesmo defeito de sempre, dois lugares decidindo o
 * mesmo fato, só que sobre em qual CLIENTE o trabalho estava caindo.
 *
 * Isto NÃO substitui filtro de carteira. Tela que responde sobre o CONJUNTO
 * (Tarefas, DAS, Vencimentos, Rotina) continua com o seletor e o "Todas as
 * empresas" — lá escolher é recortar, não trocar de cliente.
 */
import React from 'react';
import { useEmpresaAtiva } from '../services/empresaAtivaContext';
import { fmtCnpjAtiva } from '../services/empresaAtiva';

interface Props {
    /** Texto acima do nome. Padrão: "Empresa". */
    rotulo?: string;
    /** Some com o botão de trocar (dentro de modal, onde trocar confundiria). */
    semTrocar?: boolean;
    className?: string;
}

const EmpresaAtivaFixa: React.FC<Props> = ({ rotulo = 'Empresa', semTrocar, className }) => {
    const { empresa, trocar } = useEmpresaAtiva();

    // Fora do Provider (ou antes da ativação) a tela DIZ, em vez de mostrar um
    // campo vazio que faz procurar o seletor que não existe mais.
    if (!empresa) {
        return (
            <div className={`text-xs px-3 py-2 rounded-lg ${className || ''}`}
                 style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                Nenhuma empresa ativa — ative uma para usar este módulo.
            </div>
        );
    }

    return (
        <div className={`flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg ${className || ''}`}
             style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-muted)' }}>
                {rotulo}
            </span>
            <span className="text-sm font-bold min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>
                {empresa.codCliente ? `${empresa.codCliente} · ` : ''}{empresa.nome}
            </span>
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                {fmtCnpjAtiva(empresa.cnpj)}
            </span>
            {!semTrocar && (
                <button
                    onClick={trocar}
                    title="Troca a empresa ativa da sessão inteira — não só desta tela."
                    className="btn-press ml-auto text-[11px] px-2 py-0.5 rounded-lg whitespace-nowrap"
                    style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                >
                    ⇄ Trocar
                </button>
            )}
        </div>
    );
};

export default EmpresaAtivaFixa;
