/**
 * components/TaxEmission/EmissaoGuardBanner.tsx
 *
 * 🚨 O FREIO DE EMISSÃO SÓ SE VIA ABRINDO O CLOUD RUN.
 *
 * O `emissao-guard.js` bloqueia emissão por env var (`EMISSAO_BLOQUEADA`,
 * `EMISSAO_BLOQUEADA_DAS`, …) e a rota `/guard-status` existe justamente para,
 * nas palavras do próprio comentário dela, *"admin ver quais tipos estão
 * bloqueados sem precisar abrir o Cloud Run"* — só que **nenhuma tela a
 * chamava** (varredura de rotas, 22/08).
 *
 * O custo era concreto: com o freio ligado, quem tenta emitir recebe **HTTP
 * 423** com uma frase que parece defeito do app. A pessoa reporta erro,
 * alguém investiga, e a causa é uma configuração que ninguém no escritório
 * consegue consultar.
 *
 * ⚠️ DUAS RÉGUAS DA CASA AQUI:
 *  · **Falha ao consultar não vira "liberado"** — o banner some, e o que fica é
 *    a frase dizendo que o estado não foi conferido. Afirmar liberação por
 *    causa de rede que piscou é o oposto do farol honesto.
 *  · **Liberado sai DISCRETO, bloqueado sai VERMELHO com a env var na frente.**
 *    Alarme permanente em estado normal é o que ensina a equipe a ignorar
 *    alarme; e bloqueio sem dizer QUAL chave destrava é trava sem caminho.
 */
import React, { useEffect, useState } from 'react';
import type { User } from '../../types';
import { getGuardStatus, type EmissaoGuardStatus } from '../../services/taxEmissionService';

interface Props {
    currentUser: User | null;
}

const EmissaoGuardBanner: React.FC<Props> = ({ currentUser }) => {
    const [status, setStatus] = useState<EmissaoGuardStatus | null>(null);
    const [conferido, setConferido] = useState(false);

    useEffect(() => {
        let vivo = true;
        getGuardStatus(currentUser).then(s => {
            if (!vivo) return;
            setStatus(s);
            setConferido(true);
        });
        return () => { vivo = false; };
    }, [currentUser]);

    if (!conferido) return null;

    if (!status) {
        return (
            <p className="text-xs text-slate-500 dark:text-slate-400">
                🔒 Freio de emissão: <strong>não foi possível conferir</strong> agora — isto não quer dizer que
                a emissão está liberada. Se uma emissão falhar com “bloqueada”, é o freio.
            </p>
        );
    }

    const bloqueados = Object.entries(status.porTipo).filter(([, b]) => b).map(([t]) => t);

    if (!bloqueados.length) {
        return (
            <p className="text-xs text-slate-500 dark:text-slate-400">
                🔓 Freio de emissão desligado — DAS, DARF, DCTFWeb e NFS-e Nacional liberados.
            </p>
        );
    }

    const chave = status.tudoBloqueado
        ? 'EMISSAO_BLOQUEADA'
        : bloqueados.map(t => `EMISSAO_BLOQUEADA_${t}`).join(', ');

    return (
        <div className="p-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700">
            <p className="text-sm font-bold text-red-700 dark:text-red-300">
                ⛔ Emissão BLOQUEADA: {bloqueados.join(', ')}
                {status.tudoBloqueado ? ' (freio geral ligado)' : ''}
            </p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                Tentar emitir devolve erro de bloqueio — não é defeito do app. Quem libera é o Paulo, no
                Cloud Run, na variável <strong>{chave}</strong>. Consulta, captura e conferência seguem
                funcionando normalmente.
            </p>
        </div>
    );
};

export default EmissaoGuardBanner;
