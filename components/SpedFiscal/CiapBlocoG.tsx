/**
 * CiapBlocoG — cadastro do CIAP e prévia do Bloco G da EFD ICMS/IPI.
 *
 * O ICMS do ativo imobilizado é creditado em 48 parcelas, e cada parcela entra
 * na PROPORÇÃO das saídas tributadas do mês. Aqui a equipe mantém os bens (com
 * a parcela em que cada um está) e vê o crédito do período antes de gerar o
 * arquivo — a conta é a MESMA do gerador (sped-bloco-g.js), sem régua paralela.
 *
 * Régua conferida contra o CIAP real da EXPERTE (06/2026): Σ parcelas 527,53 ×
 * índice 0,86032111 = 453,85.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import type { EmpresaXmlOption } from '../../services/xmlFiscalService';
import {
    carregarCiap, salvarCiap, avancarParcelas, type BemCiap, type CiapDoc,
} from '../../services/spedCiapService';
import { apurarCiap, TIPOS_MOVIMENTACAO } from '../../sefaz-backend/sped-bloco-g.js';
import { useEmpresaAtivaId } from '../../services/empresaAtivaContext';
import EmpresaAtivaFixa from '../../components/EmpresaAtivaFixa';

interface Props {
    currentUser: User | null;
    empresas: EmpresaXmlOption[];
    onShowToast?: (msg: string) => void;
}

const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const BEM_VAZIO: BemCiap = {
    codigo: '', descricao: '', tipo: 'bem', codigoBemPrincipal: '',
    dataMovimentacao: new Date().toISOString().slice(0, 10), tipoMovimentacao: 'SI',
    creditoIcmsProprio: 0, creditoIcmsSt: 0, creditoIcmsFrete: 0, creditoIcmsDifal: 0,
    numeroParcela: 1, funcao: '', contaContabil: '',
};

const CiapBlocoG: React.FC<Props> = ({ empresas, onShowToast }) => {
    // A EMPRESA É A ATIVA DA SESSÃO — este painel não pergunta de novo.
    //
    // Paulo, 15/08: *"tira os seletores internos"*. Dava para ativar a empresa
    // A no cabeçalho e escolher a B aqui dentro, sem a tela denunciar nada:
    // dois lugares decidindo em qual CLIENTE o trabalho ia cair.
    const empresaId = useEmpresaAtivaId();
    const [dados, setDados] = useState<CiapDoc | null>(null);
    const [loading, setLoading] = useState(false);
    const [salvando, setSalvando] = useState(false);

    useEffect(() => {
        if (!empresaId) { setDados(null); return; }
        let alive = true;
        setLoading(true);
        carregarCiap(empresaId)
            .then(d => { if (alive) setDados(d); })
            .catch(e => onShowToast?.(e?.message || 'Falha ao ler o CIAP.'))
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [empresaId, onShowToast]);

    // Prévia com as saídas informadas à mão (as derivadas das notas só existem
    // na hora de gerar o arquivo — aqui a tela é honesta sobre isso).
    const previa = useMemo(() => {
        if (!dados) return null;
        return apurarCiap({
            bens: dados.bens,
            saldoInicial: dados.saldoInicial,
            saidasTributadas: dados.saidasTributadasManual ?? 0,
            saidasTotais: dados.saidasTotaisManual ?? 0,
            outrosCreditos: dados.outrosCreditos,
        });
    }, [dados]);

    const usaSaidasManuais = dados?.saidasTotaisManual != null && Number(dados.saidasTotaisManual) > 0;

    const mudarBem = (i: number, campo: keyof BemCiap, valor: any) => {
        setDados(d => d && ({ ...d, bens: d.bens.map((b, idx) => idx === i ? { ...b, [campo]: valor } : b) }));
    };

    const salvar = async () => {
        if (!dados) return;
        setSalvando(true);
        try {
            const empresa = empresas.find(e => e.id === empresaId);
            await salvarCiap({ ...dados, empresaCnpj: empresa?.cnpj || dados.empresaCnpj });
            onShowToast?.('CIAP salvo. O Bloco G sai com esses bens no próximo arquivo.');
        } catch (e: any) {
            onShowToast?.(e?.message || 'Falha ao salvar.');
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 10, padding: 16 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>🏭 CIAP — Bloco G (crédito do ativo imobilizado)</h3>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                    O ICMS da compra do bem entra em <b>48 parcelas</b>, e cada parcela é creditada
                    na proporção das <b>saídas tributadas + exportação</b> sobre o total das saídas do mês.
                    Cadastre os bens com a parcela em que cada um está — o arquivo já sai com o Bloco G preenchido.
                </p>
                <EmpresaAtivaFixa />
            </div>

            {loading && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Lendo o CIAP…</p>}

            {dados && !loading && (
                <>
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 10, padding: 16 }}>
                        <h4 style={{ margin: '0 0 10px', fontSize: 13 }}>Período</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                            <label style={{ fontSize: 11 }}>
                                Saldo inicial de ICMS do CIAP
                                <input type="number" step="0.01" value={dados.saldoInicial}
                                    onChange={e => setDados({ ...dados, saldoInicial: Number(e.target.value) })}
                                    style={inputStyle} />
                            </label>
                            <label style={{ fontSize: 11 }}>
                                Outros créditos de ICMS
                                <input type="number" step="0.01" value={dados.outrosCreditos}
                                    onChange={e => setDados({ ...dados, outrosCreditos: Number(e.target.value) })}
                                    style={inputStyle} />
                            </label>
                            <label style={{ fontSize: 11 }}>
                                Saídas tributadas + exportação <span style={{ color: 'var(--text-muted)' }}>(opcional)</span>
                                <input type="number" step="0.01" value={dados.saidasTributadasManual ?? ''}
                                    placeholder="deriva das notas"
                                    onChange={e => setDados({ ...dados, saidasTributadasManual: e.target.value === '' ? null : Number(e.target.value) })}
                                    style={inputStyle} />
                            </label>
                            <label style={{ fontSize: 11 }}>
                                Valor total das saídas <span style={{ color: 'var(--text-muted)' }}>(opcional)</span>
                                <input type="number" step="0.01" value={dados.saidasTotaisManual ?? ''}
                                    placeholder="deriva das notas"
                                    onChange={e => setDados({ ...dados, saidasTotaisManual: e.target.value === '' ? null : Number(e.target.value) })}
                                    style={inputStyle} />
                            </label>
                        </div>
                        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                            Deixando as saídas em branco, o gerador calcula a partir das <b>notas do período</b>
                            (tributada = com ICMS destacado; exportação = CFOP 7xxx). Preencha só quando quiser
                            fechar com o controle próprio do cliente.
                        </p>
                    </div>

                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 10, padding: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <h4 style={{ margin: 0, fontSize: 13 }}>Bens e componentes ({dados.bens.length})</h4>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    onClick={() => setDados({ ...dados, bens: avancarParcelas(dados.bens) })}
                                    title="Fim de mês: soma 1 na parcela de todos os bens ativos (48ª vira baixa)"
                                    style={btnSec}
                                >
                                    ⏭ Avançar parcelas
                                </button>
                                <button onClick={() => setDados({ ...dados, bens: [...dados.bens, { ...BEM_VAZIO }] })} style={btnSec}>
                                    ＋ Adicionar bem
                                </button>
                            </div>
                        </div>

                        {dados.bens.length === 0 && (
                            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                Nenhum bem cadastrado — o arquivo sai com o Bloco G <b>vazio</b> (é o caso da maioria das empresas).
                            </p>
                        )}

                        {dados.bens.map((bem, i) => (
                            <div key={i} style={{ border: '1px solid var(--border-default)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                                    <label style={lbl}>Código do bem
                                        <input value={bem.codigo} onChange={e => mudarBem(i, 'codigo', e.target.value)} style={inputStyle} />
                                    </label>
                                    <label style={lbl}>Descrição
                                        <input value={bem.descricao} onChange={e => mudarBem(i, 'descricao', e.target.value)} style={inputStyle} />
                                    </label>
                                    <label style={lbl}>Tipo
                                        <select value={bem.tipo} onChange={e => mudarBem(i, 'tipo', e.target.value)} style={inputStyle}>
                                            <option value="bem">1 - bem</option>
                                            <option value="componente">2 - componente</option>
                                        </select>
                                    </label>
                                    {bem.tipo === 'componente' && (
                                        <label style={lbl}>Bem principal
                                            <input value={bem.codigoBemPrincipal || ''} onChange={e => mudarBem(i, 'codigoBemPrincipal', e.target.value)} style={inputStyle} />
                                        </label>
                                    )}
                                    {/*
                                      🚨 COD_CTA do registro 0300 — o cadastro que o G125
                                      referencia. O app NÃO deduz a conta: ela é do plano de
                                      contas da empresa. Sem ela o campo sai VAZIO e a geração
                                      DIZ que o PVA vai cobrar — em vez de inventar uma conta,
                                      que é a família do 'PARTSEM'.
                                    */}
                                    <label style={lbl} title="Conta analítica de contabilização do bem (0500). Vai no COD_CTA do registro 0300, que o G125 referencia. Sem ela o campo sai vazio e o PVA cobra.">
                                        Conta contábil <span style={{ color: 'var(--text-muted)' }}>(0300)</span>
                                        <input
                                            value={bem.contaContabil || ''}
                                            placeholder="—"
                                            onChange={e => mudarBem(i, 'contaContabil', e.target.value)}
                                            style={inputStyle}
                                        />
                                    </label>
                                    <label style={lbl}>Movimentação
                                        <select value={bem.tipoMovimentacao} onChange={e => mudarBem(i, 'tipoMovimentacao', e.target.value)} style={inputStyle}>
                                            {Object.entries(TIPOS_MOVIMENTACAO as Record<string, string>).map(([k, v]) => (
                                                <option key={k} value={k}>{k} — {v}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label style={lbl}>Data
                                        <input type="date" value={bem.dataMovimentacao} onChange={e => mudarBem(i, 'dataMovimentacao', e.target.value)} style={inputStyle} />
                                    </label>
                                    <label style={lbl}>ICMS próprio
                                        <input type="number" step="0.01" value={bem.creditoIcmsProprio} onChange={e => mudarBem(i, 'creditoIcmsProprio', Number(e.target.value))} style={inputStyle} />
                                    </label>
                                    <label style={lbl}>ICMS ST
                                        <input type="number" step="0.01" value={bem.creditoIcmsSt} onChange={e => mudarBem(i, 'creditoIcmsSt', Number(e.target.value))} style={inputStyle} />
                                    </label>
                                    <label style={lbl}>ICMS frete
                                        <input type="number" step="0.01" value={bem.creditoIcmsFrete} onChange={e => mudarBem(i, 'creditoIcmsFrete', Number(e.target.value))} style={inputStyle} />
                                    </label>
                                    <label style={lbl}>ICMS DIFAL
                                        <input type="number" step="0.01" value={bem.creditoIcmsDifal} onChange={e => mudarBem(i, 'creditoIcmsDifal', Number(e.target.value))} style={inputStyle} />
                                    </label>
                                    <label style={lbl}>Parcela (1..48)
                                        <input type="number" min={1} max={48} value={bem.numeroParcela} onChange={e => mudarBem(i, 'numeroParcela', Number(e.target.value))} style={inputStyle} />
                                    </label>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                        Parcela do mês: <b>{fmtBRL((previa?.bens?.[i] as any)?.valorParcela || 0)}</b>
                                        {' · '}crédito total {fmtBRL((previa?.bens?.[i] as any)?.creditoTotal || 0)}
                                    </span>
                                    <button
                                        onClick={() => setDados({ ...dados, bens: dados.bens.filter((_, idx) => idx !== i) })}
                                        style={{ ...btnSec, color: '#b91c1c' }}
                                    >
                                        ✕ Remover
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {previa && dados.bens.length > 0 && (
                        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 10, padding: 16 }}>
                            <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Prévia do período (G110)</h4>
                            <table style={{ width: '100%', fontSize: 12 }}>
                                <tbody>
                                    <tr><td>Saldo inicial de ICMS do CIAP</td><td style={tdNum}>{fmtBRL(previa.saldoInicial)}</td></tr>
                                    <tr><td>Somatório das parcelas do período</td><td style={tdNum}><b>{fmtBRL(previa.somaParcelas)}</b></td></tr>
                                    <tr><td>Índice de participação das saídas tributadas</td><td style={tdNum}>{previa.indice.toFixed(8).replace('.', ',')}</td></tr>
                                    <tr><td>Crédito de ICMS a apropriar</td><td style={tdNum}><b>{fmtBRL(previa.creditoApropriado)}</b></td></tr>
                                </tbody>
                            </table>
                            {!usaSaidasManuais && (
                                <p style={{ margin: '8px 0 0', padding: 8, borderRadius: 6, background: '#FEF3C7', color: '#92400E', fontSize: 11 }}>
                                    ⚠ Esta prévia está com índice <b>0</b> porque as saídas não foram informadas aqui.
                                    Não é erro: na geração do arquivo o índice vem das notas do período. Para conferir
                                    o número exato antes de gerar, preencha as saídas acima.
                                </p>
                            )}
                            {previa.avisos.length > 0 && (
                                <ul style={{ margin: '8px 0 0 16px', fontSize: 11, color: '#92400E' }}>
                                    {previa.avisos.map((a: string, i: number) => <li key={i}>{a}</li>)}
                                </ul>
                            )}
                        </div>
                    )}

                    <div>
                        <button onClick={salvar} disabled={salvando} style={btnPri}>
                            {salvando ? 'Salvando…' : '💾 Salvar CIAP'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', marginTop: 2, borderRadius: 6,
    border: '1px solid var(--border-default)', background: 'var(--bg-input, #fff)',
    color: 'var(--text-default)', fontSize: 12,
};
const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)' };
const tdNum: React.CSSProperties = { textAlign: 'right', fontFamily: 'monospace' };
const btnSec: React.CSSProperties = {
    padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
    border: '1px solid var(--border-default)', background: 'var(--bg-card)',
};
const btnPri: React.CSSProperties = {
    padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
    border: 'none', background: 'var(--accent)', color: '#fff',
};

export default CiapBlocoG;
