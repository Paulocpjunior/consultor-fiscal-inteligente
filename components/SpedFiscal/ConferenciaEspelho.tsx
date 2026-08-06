import React, { useCallback, useState } from 'react';
import type { User, SpedFiscalParseResult } from '../../types';
import { parseSpedFiscalFile } from '../../services/spedFiscalParserService';
import { compararEspelho, type ResultadoEspelho } from '../../services/spedEspelho';
import { formatCurrency } from '../../services/xmlParserService';

/**
 * Conferência-espelho: o SPED gerado pelo CFI contra o gerado pelo E-Fiscal
 * (ou pelo PVA) da MESMA empresa e competência.
 *
 * É a prova que a onda de migração exige. O E-Fiscal segue vivo e virou sistema
 * de consulta (Paulo, 05/08), então o gabarito está do lado — migrar é
 * conferência, não fé. Sem ferramenta, comparar dois arquivos de milhares de
 * linhas na mão não acontece: a "conferência" vira olhar o total e confiar.
 */
interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const CORES: Record<ResultadoEspelho['veredicto'], { bg: string; border: string; text: string; rotulo: string }> = {
    'espelho-bate':  { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.45)', text: '#10b981', rotulo: '✅ Espelho bate' },
    'divergente':    { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.45)',  text: '#ef4444', rotulo: '🚨 Divergente' },
    'nao-conferivel':{ bg: 'rgba(234,179,8,0.12)',  border: 'rgba(234,179,8,0.45)',  text: '#eab308', rotulo: '⚠ Não conferível' },
};

const LIMITE_LISTA = 50;

const ConferenciaEspelho: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [cfi, setCfi] = useState<SpedFiscalParseResult | null>(null);
    const [efiscal, setEfiscal] = useState<SpedFiscalParseResult | null>(null);
    const [nomeCfi, setNomeCfi] = useState('');
    const [nomeEfiscal, setNomeEfiscal] = useState('');
    const [lendo, setLendo] = useState<'cfi' | 'efiscal' | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [resultado, setResultado] = useState<ResultadoEspelho | null>(null);

    const ler = useCallback(async (e: React.ChangeEvent<HTMLInputElement>, lado: 'cfi' | 'efiscal') => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.txt')) {
            setErro('Arquivo inválido. O SPED Fiscal é um .txt (EFD ICMS/IPI).');
            return;
        }
        setLendo(lado);
        setErro(null);
        setResultado(null);
        try {
            const r = await parseSpedFiscalFile(file, currentUser);
            if (lado === 'cfi') { setCfi(r); setNomeCfi(file.name); }
            else { setEfiscal(r); setNomeEfiscal(file.name); }
        } catch (err: any) {
            setErro(`Falha ao ler ${file.name}: ${err?.message || err}`);
        } finally {
            setLendo(null);
        }
    }, [currentUser]);

    const conferir = () => {
        if (!cfi || !efiscal) { onShowToast?.('Suba os dois arquivos antes de conferir.'); return; }
        const r = compararEspelho(cfi, efiscal);
        setResultado(r);
        onShowToast?.(r.motivo);
    };

    const cor = resultado ? CORES[resultado.veredicto] : null;
    const divergentes = (resultado?.documentos || []).filter(d => d.classe !== 'igual');

    return (
        <div className="space-y-4">
            <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Conferência-espelho · CFI × E-Fiscal
                </h3>
                <p className="text-[11px] mb-4" style={{ color: 'var(--text-muted)' }}>
                    Compara <strong>arquivo com arquivo</strong> — é a única conferência que faz isso (as outras
                    cruzam o SPED com capturadas, declarado ou faturamento). No 1º mês da onda o cliente roda nos
                    DOIS sistemas: o E-Fiscal continua vivo como consulta, então o gabarito está do lado.
                    Documento casa pela <strong>chave da NF-e</strong>; o código do participante NÃO entra (ele é
                    interno de cada sistema e daria 100% de divergência num arquivo idêntico).
                </p>

                <div className="grid gap-3 md:grid-cols-2">
                    {([
                        ['cfi', 'Arquivo gerado pelo CFI', nomeCfi, cfi] as const,
                        ['efiscal', 'Arquivo do E-Fiscal (ou do PVA)', nomeEfiscal, efiscal] as const,
                    ]).map(([lado, rotulo, nome, parse]) => (
                        <label key={lado} className="block rounded-lg p-3 cursor-pointer"
                            style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-default)' }}>
                            <span className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
                            <input type="file" accept=".txt" className="hidden"
                                onChange={e => void ler(e, lado as 'cfi' | 'efiscal')} />
                            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                                {lendo === lado ? 'Lendo…' : (nome || 'Escolher .txt')}
                            </span>
                            {parse && (
                                <span className="block text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                                    {parse.documentosC100.length} doc(s) C100 · {parse.registro0000?.dtIni || '—'} a {parse.registro0000?.dtFin || '—'}
                                </span>
                            )}
                        </label>
                    ))}
                </div>

                {erro && <p className="text-xs mt-3" style={{ color: '#ef4444' }}>{erro}</p>}

                <button onClick={conferir} disabled={!cfi || !efiscal}
                    className="mt-4 px-4 py-2 text-sm font-bold rounded-lg disabled:opacity-40"
                    style={{ background: 'var(--accent)', color: '#fff' }}>
                    🪞 Conferir espelho
                </button>
            </div>

            {resultado && cor && (
                <>
                    <div className="p-4 rounded-xl" style={{ background: cor.bg, border: `1px solid ${cor.border}` }}>
                        <p className="text-sm font-bold" style={{ color: cor.text }}>{cor.rotulo}</p>
                        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{resultado.motivo}</p>
                        {!resultado.identificacao.confere && (
                            <p className="text-[11px] mt-2 font-mono" style={{ color: 'var(--text-muted)' }}>
                                CFI: {resultado.identificacao.cnpjCfi || '—'} · {resultado.identificacao.periodoCfi || '—'}
                                {' | '}E-Fiscal: {resultado.identificacao.cnpjEfiscal || '—'} · {resultado.identificacao.periodoEfiscal || '—'}
                            </p>
                        )}
                        {resultado.avisos.map((a, i) => (
                            <p key={i} className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>• {a}</p>
                        ))}
                    </div>

                    {resultado.documentos.length > 0 && (
                        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                            <div className="flex flex-wrap gap-3 text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                                <span>✅ iguais: <strong>{resultado.resumoDocumentos.iguais}</strong></span>
                                <span>🚨 divergentes: <strong>{resultado.resumoDocumentos.divergentes}</strong></span>
                                <span>◀ só no CFI: <strong>{resultado.resumoDocumentos.soCfi}</strong></span>
                                <span>▶ só no E-Fiscal: <strong>{resultado.resumoDocumentos.soEfiscal}</strong></span>
                                <span style={{ color: 'var(--text-muted)' }}>
                                    esperados fora da ponte: <strong>{resultado.resumoDocumentos.soCfiEsperado}</strong>
                                </span>
                            </div>

                            {divergentes.length === 0 ? (
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                    Nenhum documento com diferença — a lista abaixo só mostra o que precisa de olho.
                                </p>
                            ) : (
                                <>
                                    <table className="w-full text-[11px]">
                                        <thead>
                                            <tr style={{ color: 'var(--text-muted)' }}>
                                                <th className="text-left py-1">Documento</th>
                                                <th className="text-left py-1">Situação</th>
                                                <th className="text-right py-1">CFI</th>
                                                <th className="text-right py-1">E-Fiscal</th>
                                                <th className="text-right py-1">Diferença</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {divergentes.slice(0, LIMITE_LISTA).map((d, i) => (
                                                <tr key={`${d.chave}-${i}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                                    <td className="py-1 font-mono" style={{ color: 'var(--text-secondary)' }}>{d.rotulo}</td>
                                                    <td className="py-1" style={{ color: 'var(--text-muted)' }}>
                                                        {d.classe === 'divergente' ? d.valores.map(v => v.campo).join(', ')
                                                            : d.classe === 'so-cfi' ? 'só no CFI'
                                                            : d.classe === 'so-efiscal' ? 'só no E-Fiscal'
                                                            : 'só no CFI (esperado)'}
                                                        {d.motivo && <span className="block text-[10px]">{d.motivo}</span>}
                                                    </td>
                                                    <td className="py-1 text-right font-mono">{d.valores[0] ? formatCurrency(d.valores[0].cfi) : '—'}</td>
                                                    <td className="py-1 text-right font-mono">{d.valores[0] ? formatCurrency(d.valores[0].efiscal) : '—'}</td>
                                                    <td className="py-1 text-right font-mono" style={{ color: d.valores[0] ? '#ef4444' : 'var(--text-muted)' }}>
                                                        {d.valores[0] ? formatCurrency(d.valores[0].diferenca) : '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {divergentes.length > LIMITE_LISTA && (
                                        <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                                            Mostrando {LIMITE_LISTA} de {divergentes.length} — resolva estes e confira de novo.
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {resultado.apuracao.length > 0 && (
                        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                            <h4 className="text-xs font-bold uppercase mb-2" style={{ color: 'var(--text-secondary)' }}>
                                Apuração do ICMS (E110) — o número que fecha o mês
                            </h4>
                            <table className="w-full text-[11px]">
                                <tbody>
                                    {resultado.apuracao.map(l => (
                                        <tr key={l.campo} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                            <td className="py-1" style={{ color: 'var(--text-secondary)' }}>{l.rotulo}</td>
                                            <td className="py-1 text-right font-mono">{l.cfi === null ? '—' : formatCurrency(l.cfi)}</td>
                                            <td className="py-1 text-right font-mono">{l.efiscal === null ? '—' : formatCurrency(l.efiscal)}</td>
                                            <td className="py-1 text-right font-mono"
                                                style={{ color: l.naoApurado ? '#eab308' : (Math.abs(l.diferenca || 0) > 0.005 ? '#ef4444' : 'var(--text-muted)') }}>
                                                {l.naoApurado ? 'não apurado' : formatCurrency(l.diferenca || 0)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                                "não apurado" ≠ zero: um dos arquivos não trouxe o E110.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default ConferenciaEspelho;
