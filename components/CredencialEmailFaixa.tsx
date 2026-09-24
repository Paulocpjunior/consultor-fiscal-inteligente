// ============================================================================
// 🛡️ A faixa do vigia da credencial do e-mail (Paulo, 24/09: "isso não pode
// voltar a acontecer"). Lê o veredito que o cron noturno gravou e acende
// para TODO MUNDO enquanto a Microsoft recusar — quem manda guia precisa
// saber antes de clicar, não depois de falhar na mão do cliente.
// Silêncio também acende (amarelo): vigia que não roda não é saúde.
// ============================================================================
import React, { useEffect, useState } from 'react';
import { lerVigiaCredencialEmail, FaixaVigia } from '../services/credencialEmailService';

const CredencialEmailFaixa: React.FC = () => {
    const [faixa, setFaixa] = useState<FaixaVigia | null | undefined>(undefined);
    useEffect(() => {
        let vivo = true;
        lerVigiaCredencialEmail().then((r) => { if (vivo) setFaixa(r.ok ? (r.faixa ?? null) : null); }).catch(() => { if (vivo) setFaixa(null); });
        return () => { vivo = false; };
    }, []);
    if (!faixa) return null;
    const vermelho = faixa.cor === 'vermelho';
    return (
        <div className={`rounded-xl border p-3 text-[12px] ${vermelho
            ? 'border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
            : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200'}`}>
            <p className="font-bold">{vermelho ? '⛔' : '⚠️'} {faixa.titulo}</p>
            {faixa.detalhe && <p className="mt-1 text-[11px] opacity-90">{faixa.detalhe}</p>}
        </div>
    );
};

export default CredencialEmailFaixa;
