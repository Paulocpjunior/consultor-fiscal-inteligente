/**
 * 🏢 FILIAIS NA ESCRITURAÇÃO DA MATRIZ — EFD-Contribuições centralizada (15/10).
 *
 * Paulo, 0181 · SBE EDIÇÕES: a EFD-Contribuições é entregue pela MATRIZ, com
 * um 0140 e um C010 para cada filial. Aqui a pessoa marca QUAIS filiais entram;
 * a tela só sugere as cadastradas da mesma raiz (nada é vinculado sozinho) e o
 * servidor confere de novo antes de gravar. Filial sem UF/município no
 * cadastro aparece, mas não se marca: o 0140 dela sai do cadastro dela.
 */
import React, { useEffect, useState } from 'react';
import { auth } from '../../services/firebaseConfig';
import { formatCnpjCpf } from '../../services/xmlParserService';

interface Candidata { cnpj: string; nome: string; uf: string; temMunicipio: boolean }

const FiliaisContrib: React.FC<{ empresaId: string }> = ({ empresaId }) => {
    const [candidatas, setCandidatas] = useState<Candidata[]>([]);
    const [marcadas, setMarcadas] = useState<string[]>([]);
    const [carimbo, setCarimbo] = useState('');
    const [msg, setMsg] = useState<string | null>(null);
    const [gravando, setGravando] = useState(false);

    useEffect(() => {
        let vivo = true;
        setMsg(null);
        (async () => {
            try {
                const token = await auth?.currentUser?.getIdToken();
                if (!token) return;
                const r = await fetch(`/api/admin/sped-contrib/filiais?empresaId=${encodeURIComponent(empresaId)}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const j = await r.json().catch(() => ({}));
                if (!vivo) return;
                if (!r.ok) { setMsg(`Não consegui ler as filiais (${j.error || `HTTP ${r.status}`}).`); return; }
                setCandidatas(j.candidatas || []);
                setMarcadas(j.filiais || []);
                setCarimbo(j.atualizadoEm ? `gravado por ${j.atualizadoPor || '—'} em ${new Date(j.atualizadoEm).toLocaleString('pt-BR')}` : '');
            } catch (e) {
                if (vivo) setMsg(`Não consegui ler as filiais: ${e instanceof Error ? e.message : String(e)}`);
            }
        })();
        return () => { vivo = false; };
    }, [empresaId]);

    // Vinculada que não aparece mais entre as cadastradas: mostrada, para poder desmarcar.
    const orfas = marcadas.filter((c) => !candidatas.some((x) => x.cnpj === c));
    if (!candidatas.length && !orfas.length && !msg) return null;

    const alternar = (cnpj: string) => setMarcadas((m) => (m.includes(cnpj) ? m.filter((x) => x !== cnpj) : [...m, cnpj]));

    const gravar = async () => {
        setGravando(true); setMsg(null);
        try {
            const token = await auth?.currentUser?.getIdToken();
            if (!token) throw new Error('Sessão expirada. Faça login novamente.');
            const r = await fetch('/api/admin/sped-contrib/filiais', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ empresaId, filiais: marcadas }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(Array.isArray(j.erros) ? j.erros.join(' ') : (j.error || `HTTP ${r.status}`));
            setMarcadas(j.filiais || []);
            setCarimbo(`gravado por ${j.atualizadoPor || '—'} em ${new Date(j.atualizadoEm).toLocaleString('pt-BR')}`);
            setMsg(`✅ ${(j.filiais || []).length} filial(is) na escrituração da matriz.`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
        } finally {
            setGravando(false);
        }
    };

    return (
        <div className="mt-3 p-3 rounded-lg space-y-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>🏢 Filiais na escrituração da matriz</p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Marque as filiais que entram NESTE arquivo. Cada uma sai com o próprio 0140 (e os 0150/0190/0200 dela) e o
                próprio C010/A010/D010 com as notas do CNPJ dela; o bloco M sai um só, consolidado na matriz.
            </p>
            {[...candidatas, ...orfas.map((cnpj) => ({ cnpj, nome: '(não está mais cadastrada)', uf: '', temMunicipio: false }))].map((c) => {
                const pronta = !!c.uf && c.temMunicipio;
                const marcada = marcadas.includes(c.cnpj);
                return (
                    <label key={c.cnpj} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                        <input type="checkbox" checked={marcada} disabled={!pronta && !marcada} onChange={() => alternar(c.cnpj)} />
                        <span className="font-mono">{formatCnpjCpf(c.cnpj)}</span>
                        <span>{c.nome}{c.uf ? ` · ${c.uf}` : ''}</span>
                        {!pronta && <span style={{ color: 'var(--warning)' }}>— sem UF/município no cadastro da filial</span>}
                    </label>
                );
            })}
            <div className="flex items-center gap-3">
                <button onClick={gravar} disabled={gravando}
                    className="px-4 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}
                >{gravando ? 'gravando…' : '💾 Gravar filiais'}</button>
                {carimbo && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{carimbo}</span>}
            </div>
            {msg && <p className="text-[11px] font-semibold" style={{ color: msg.startsWith('✅') ? 'var(--success)' : 'var(--accent)' }}>{msg}</p>}
        </div>
    );
};

export default FiliaisContrib;
