/**
 * 🧮 SaldoAbertura — a cronologia do saldo credor começa AQUI.
 *
 * Paulo, 17/08: *"essa empresa possui saldos acumulados de meses anteriores…
 * a apuração não está considerando o saldo que já vinha sendo acumulado"*.
 *
 * O desenho (decidido em 17/08, construído em 21/08): cola-se o .txt do ÚLTIMO
 * SPED ENTREGUE — o backend lê o E110 c.14 (saldo credor de ICMS a transportar)
 * e o E520 c.7 (o de IPI) e carimba a ABERTURA. Daí em diante o transporte é
 * CALCULADO mês a mês pela geração, com a mesma matemática do E110.
 *
 * ⚠️ NÃO há campo de digitar valor, de propósito: saldo digitado é a ficha de
 * novo, com outro nome — e a ficha é exatamente o que transportava defasado.
 * A fonte é o arquivo que a empresa ENTREGOU à SEFAZ.
 */
import React, { useEffect, useState } from 'react';
import type { User } from '../../types';
import type { EmpresaXmlOption } from '../../services/xmlFiscalService';
import { auth } from '../../services/firebaseConfig';
import { useEmpresaAtivaId } from '../../services/empresaAtivaContext';
import EmpresaAtivaFixa from '../../components/EmpresaAtivaFixa';

interface Props {
    currentUser: User | null;
    empresas: EmpresaXmlOption[];
    onShowToast?: (msg: string) => void;
}

interface Abertura {
    competencia: string;
    icms: number;
    ipi: number;
    temE520?: boolean;
    criadoPor?: string | null;
    criadoEm?: string;
}

const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const SaldoAbertura: React.FC<Props> = ({ currentUser, empresas, onShowToast }) => {
    // A empresa é a ATIVA da sessão — painel por cliente não pergunta de novo
    // (regra de 15/08: dois lugares decidindo o cliente é como o trabalho cai
    // na empresa errada).
    const empresaId = useEmpresaAtivaId();
    const empresa = empresas.find(e => e.id === empresaId) || null;

    const [atual, setAtual] = useState<Abertura | null>(null);
    const [texto, setTexto] = useState('');
    const [erro, setErro] = useState<string | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [gravando, setGravando] = useState(false);

    useEffect(() => {
        if (!empresaId) return;
        let alive = true;
        setCarregando(true);
        setAtual(null);
        setErro(null);
        (async () => {
            const token = await auth?.currentUser?.getIdToken();
            const resp = await fetch(`/api/admin/sped-fiscal/saldo-abertura?empresaId=${encodeURIComponent(empresaId)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await resp.json();
            if (!alive) return;
            if (!resp.ok) throw new Error(data.error || 'Falha ao consultar.');
            setAtual(data.existe ? data.abertura : null);
        })().catch((e) => { if (alive) setErro(e.message); })
            .finally(() => { if (alive) setCarregando(false); });
        return () => { alive = false; };
    }, [empresaId]);

    const gravar = async () => {
        setErro(null);
        setGravando(true);
        try {
            const token = await auth?.currentUser?.getIdToken();
            if (!token) throw new Error('Sessão expirada — saia e entre de novo.');
            const resp = await fetch('/api/admin/sped-fiscal/saldo-abertura', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ empresaId, texto }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Falha ao gravar.');
            setAtual({ ...data.abertura, criadoPor: currentUser?.email || null });
            setTexto('');
            onShowToast?.(`Saldo de abertura carimbado: ${data.abertura.competencia} — a partir da competência `
                + 'seguinte o saldo anterior sai da cronologia, não mais da ficha.');
        } catch (e: any) {
            setErro(e?.message || 'Falha ao gravar.');
        } finally {
            setGravando(false);
        }
    };

    if (!empresaId) {
        return (
            <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Ative uma empresa no ⇄ do topo — o saldo de abertura é por cliente.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                    🧮 Saldo credor de abertura
                </h3>
                <EmpresaAtivaFixa />
                <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                    Cole abaixo o <strong>.txt do ÚLTIMO SPED ICMS/IPI ENTREGUE</strong> (o mesmo arquivo que foi
                    transmitido no PVA). O app lê o <strong>E110 campo 14</strong> (saldo credor de ICMS a
                    transportar) e o <strong>E520 campo 7</strong> (o de IPI) e carimba a abertura — a partir da
                    competência seguinte, o saldo anterior das gerações sai <strong>desta cronologia, calculado mês
                    a mês</strong>, e não mais da ficha. Não existe campo para digitar valor: a fonte é o arquivo
                    que a empresa entregou à SEFAZ.
                </p>

                {carregando ? (
                    <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>Consultando…</p>
                ) : atual ? (
                    <div className="mt-3 p-3 rounded-lg text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                        <p style={{ color: 'var(--text-primary)' }}>
                            <strong>Abertura carimbada: {atual.competencia}</strong> — ICMS {fmtBRL(atual.icms)} · IPI{' '}
                            {atual.temE520 ? fmtBRL(atual.ipi) : 'sem E520 no arquivo (0,00)'}
                        </p>
                        <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
                            por {atual.criadoPor || '—'}{atual.criadoEm ? ` em ${new Date(atual.criadoEm).toLocaleString('pt-BR')}` : ''}.
                            Colar um SPED entregue mais novo SUBSTITUI a abertura (o anterior fica no histórico).
                        </p>
                    </div>
                ) : (
                    <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                        Nenhuma abertura cadastrada — o saldo anterior desta empresa continua saindo da ficha
                        (defasado, e o aviso da geração diz isso).
                    </p>
                )}
            </div>

            <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    rows={8}
                    placeholder="Cole aqui o conteúdo do .txt do SPED entregue (|0000|…)"
                    className="w-full p-3 font-mono text-xs rounded-lg"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                />
                {erro && (
                    <p className="mt-2 text-xs font-bold" style={{ color: 'var(--error, #dc2626)' }}>⛔ {erro}</p>
                )}
                <button
                    onClick={gravar}
                    disabled={gravando || !texto.trim()}
                    className="btn-press mt-2 px-4 py-2 text-xs font-bold rounded-lg disabled:opacity-40"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                >
                    {gravando ? 'Lendo e gravando…' : '🧮 Ler o SPED e carimbar a abertura'}
                </button>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    O CNPJ do arquivo é conferido contra a empresa ativa — SPED de outro cliente é recusado com o
                    motivo. EFD-Contribuições não serve aqui (o saldo de ICMS/IPI mora no arquivo do ICMS).
                </p>
            </div>
        </div>
    );
};

export default SaldoAbertura;
