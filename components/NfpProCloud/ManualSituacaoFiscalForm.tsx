import React, { useState } from 'react';
import type {
    NfpEsfera,
    NfpStatusCertidao,
    NfpStatusDebito,
    NfpStatusObrigacao,
    NfpTipoAcao,
} from '../../types';
import type {
    NfpManualAcaoInput,
    NfpManualCertidaoInput,
    NfpManualDebitoInput,
    NfpManualObrigacaoInput,
    NfpManualParcelamentoInput,
} from '../../services/nfpManualAnalysis';
import { btnStyle, btnStyleSave, cardStyle, inputStyle, labelSmall, uid } from './_common';

export interface NfpManualSituacaoFiscalPayload {
    debitos: NfpManualDebitoInput[];
    certidoes: NfpManualCertidaoInput[];
    obrigacoes: NfpManualObrigacaoInput[];
    parcelamentos: NfpManualParcelamentoInput[];
    acoes: NfpManualAcaoInput[];
}

interface Props {
    disabled?: boolean;
    onGerarAnaliseManual: (payload: NfpManualSituacaoFiscalPayload) => void | Promise<void>;
}

type Periodicidade = NfpManualObrigacaoInput['periodicidade'];
type ParcelamentoStatus = NfpManualParcelamentoInput['status'];
type AcaoStatus = NfpManualAcaoInput['status'];

interface DebitoRow {
    id: string;
    esfera: NfpEsfera;
    orgao: string;
    descricao: string;
    valorOriginal: string;
    dataVencimento: string;
    status: NfpStatusDebito;
    observacao: string;
}

interface CertidaoRow {
    id: string;
    esfera: NfpEsfera;
    orgao: string;
    tipo: string;
    status: NfpStatusCertidao;
    dataValidade: string;
    motivoImpedimento: string;
}

interface ObrigacaoRow {
    id: string;
    esfera: NfpEsfera;
    nome: string;
    sigla: string;
    periodicidade: Periodicidade;
    competencia: string;
    status: NfpStatusObrigacao;
    prazoLegal: string;
    observacao: string;
}

interface ParcelamentoRow {
    id: string;
    esfera: NfpEsfera;
    programa: string;
    valorTotal: string;
    parcelas: string;
    parcelasPagas: string;
    valorParcela: string;
    status: ParcelamentoStatus;
    dataInicio: string;
}

interface AcaoRow {
    id: string;
    tipo: NfpTipoAcao;
    descricao: string;
    status: AcaoStatus;
    numero: string;
    vara: string;
    valorCausa: string;
}

interface ManualFormState {
    debitos: DebitoRow[];
    certidoes: CertidaoRow[];
    obrigacoes: ObrigacaoRow[];
    parcelamentos: ParcelamentoRow[];
    acoes: AcaoRow[];
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const newDebito = (): DebitoRow => ({
    id: uid(),
    esfera: 'federal',
    orgao: 'Receita Federal',
    descricao: '',
    valorOriginal: '',
    dataVencimento: todayISO(),
    status: 'aberto',
    observacao: '',
});

const newCertidao = (): CertidaoRow => ({
    id: uid(),
    esfera: 'federal',
    orgao: 'Receita Federal / PGFN',
    tipo: 'CND Federal',
    status: 'nao_consultada',
    dataValidade: '',
    motivoImpedimento: '',
});

const newObrigacao = (): ObrigacaoRow => ({
    id: uid(),
    esfera: 'federal',
    nome: '',
    sigla: '',
    periodicidade: 'mensal',
    competencia: '',
    status: 'pendente',
    prazoLegal: '',
    observacao: '',
});

const newParcelamento = (): ParcelamentoRow => ({
    id: uid(),
    esfera: 'federal',
    programa: '',
    valorTotal: '',
    parcelas: '',
    parcelasPagas: '',
    valorParcela: '',
    status: 'ativo',
    dataInicio: todayISO(),
});

const newAcao = (): AcaoRow => ({
    id: uid(),
    tipo: 'tributaria',
    descricao: '',
    status: 'em_andamento',
    numero: '',
    vara: '',
    valorCausa: '',
});

const initialForm = (): ManualFormState => ({
    debitos: [newDebito()],
    certidoes: [newCertidao()],
    obrigacoes: [newObrigacao()],
    parcelamentos: [],
    acoes: [],
});

function parseNumber(value: string): number {
    if (!value) return 0;
    const normalized = value.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function hasText(...values: string[]): boolean {
    return values.some(v => v.trim().length > 0);
}

const rowGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '0.5rem',
    alignItems: 'end',
};

const ManualSituacaoFiscalForm: React.FC<Props> = ({ disabled, onGerarAnaliseManual }) => {
    const [form, setForm] = useState<ManualFormState>(initialForm);
    const [error, setError] = useState('');

    const updateCollection = <K extends keyof ManualFormState>(
        key: K,
        id: string,
        patch: Partial<ManualFormState[K][number]>,
    ) => {
        setForm(prev => ({
            ...prev,
            [key]: prev[key].map(row => row.id === id ? { ...row, ...patch } : row),
        }));
    };

    const removeFromCollection = <K extends keyof ManualFormState>(key: K, id: string) => {
        setForm(prev => ({ ...prev, [key]: prev[key].filter(row => row.id !== id) }));
    };

    const handleSubmit = () => {
        const debitos = form.debitos
            .filter(d => hasText(d.orgao, d.descricao, d.observacao) || parseNumber(d.valorOriginal) > 0)
            .map<NfpManualDebitoInput>(d => ({
                esfera: d.esfera,
                orgao: d.orgao,
                descricao: d.descricao,
                valorOriginal: parseNumber(d.valorOriginal),
                dataVencimento: d.dataVencimento,
                status: d.status,
                observacao: d.observacao || undefined,
            }));

        const certidoes = form.certidoes
            .filter(c => hasText(c.orgao, c.tipo, c.motivoImpedimento) || c.status !== 'nao_consultada')
            .map<NfpManualCertidaoInput>(c => ({
                esfera: c.esfera,
                orgao: c.orgao,
                tipo: c.tipo,
                status: c.status,
                dataValidade: c.dataValidade || undefined,
                motivoImpedimento: c.motivoImpedimento || undefined,
            }));

        const obrigacoes = form.obrigacoes
            .filter(o => hasText(o.nome, o.sigla, o.competencia, o.observacao) || o.status !== 'nao_verificada')
            .map<NfpManualObrigacaoInput>(o => ({
                esfera: o.esfera,
                nome: o.nome,
                sigla: o.sigla,
                periodicidade: o.periodicidade,
                competencia: o.competencia || undefined,
                status: o.status,
                prazoLegal: o.prazoLegal || undefined,
                observacao: o.observacao || undefined,
            }));

        const parcelamentos = form.parcelamentos
            .filter(p => hasText(p.programa) || parseNumber(p.valorTotal) > 0 || parseNumber(p.valorParcela) > 0)
            .map<NfpManualParcelamentoInput>(p => ({
                esfera: p.esfera,
                programa: p.programa,
                valorTotal: parseNumber(p.valorTotal),
                parcelas: parseNumber(p.parcelas),
                parcelasPagas: parseNumber(p.parcelasPagas),
                valorParcela: parseNumber(p.valorParcela),
                status: p.status,
                dataInicio: p.dataInicio,
            }));

        const acoes = form.acoes
            .filter(a => hasText(a.descricao, a.numero, a.vara) || parseNumber(a.valorCausa) > 0)
            .map<NfpManualAcaoInput>(a => ({
                tipo: a.tipo,
                descricao: a.descricao,
                status: a.status,
                numero: a.numero || undefined,
                vara: a.vara || undefined,
                valorCausa: parseNumber(a.valorCausa) || undefined,
            }));

        const total = debitos.length + certidoes.length + obrigacoes.length + parcelamentos.length + acoes.length;
        if (total === 0) {
            setError('Inclua ao menos um débito, obrigação, certidão, parcelamento ou ação judicial.');
            return;
        }

        setError('');
        onGerarAnaliseManual({ debitos, certidoes, obrigacoes, parcelamentos, acoes });
    };

    return (
        <div style={{ ...cardStyle, borderLeft: '4px solid var(--accent)', maxWidth: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <div>
                    <h3 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '1rem' }}>Inclusão manual para análise</h3>
                    <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0', fontSize: '0.82rem' }}>
                        Os itens informados alimentam o dashboard e geram o plano de ação automaticamente.
                    </p>
                </div>
                <button disabled={disabled} onClick={handleSubmit} style={{ ...btnStyleSave, opacity: disabled ? 0.5 : 1 }}>
                    Gerar análise e plano
                </button>
            </div>

            {error && (
                <div style={{ padding: '8px 12px', marginBottom: '1rem', borderRadius: '8px', background: 'var(--danger)14', color: 'var(--danger)', border: '1px solid var(--danger)33', fontSize: '0.82rem' }}>
                    {error}
                </div>
            )}

            <ManualSection title="Débitos" onAdd={() => setForm(prev => ({ ...prev, debitos: [...prev.debitos, newDebito()] }))}>
                {form.debitos.map(d => (
                    <div key={d.id} style={cardStyle}>
                        <div style={rowGrid}>
                            <label style={labelSmall}>Esfera<select value={d.esfera} onChange={e => updateCollection('debitos', d.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}><option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option></select></label>
                            <label style={labelSmall}>Órgão<input value={d.orgao} onChange={e => updateCollection('debitos', d.id, { orgao: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Descrição<input value={d.descricao} onChange={e => updateCollection('debitos', d.id, { descricao: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Valor<input inputMode="decimal" value={d.valorOriginal} onChange={e => updateCollection('debitos', d.id, { valorOriginal: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Vencimento<input type="date" value={d.dataVencimento} onChange={e => updateCollection('debitos', d.id, { dataVencimento: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Status<select value={d.status} onChange={e => updateCollection('debitos', d.id, { status: e.target.value as NfpStatusDebito })} style={inputStyle}><option value="aberto">Aberto</option><option value="parcelado">Parcelado</option><option value="em_analise">Em análise</option><option value="quitado">Quitado</option><option value="prescrito">Prescrito</option></select></label>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                            <input placeholder="Observação" value={d.observacao} onChange={e => updateCollection('debitos', d.id, { observacao: e.target.value })} style={inputStyle} />
                            <RemoveButton onClick={() => removeFromCollection('debitos', d.id)} />
                        </div>
                    </div>
                ))}
            </ManualSection>

            <ManualSection title="Obrigações" onAdd={() => setForm(prev => ({ ...prev, obrigacoes: [...prev.obrigacoes, newObrigacao()] }))}>
                {form.obrigacoes.map(o => (
                    <div key={o.id} style={cardStyle}>
                        <div style={rowGrid}>
                            <label style={labelSmall}>Esfera<select value={o.esfera} onChange={e => updateCollection('obrigacoes', o.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}><option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option></select></label>
                            <label style={labelSmall}>Sigla<input value={o.sigla} onChange={e => updateCollection('obrigacoes', o.id, { sigla: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Obrigação<input value={o.nome} onChange={e => updateCollection('obrigacoes', o.id, { nome: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Competência<input placeholder="MM/AAAA" value={o.competencia} onChange={e => updateCollection('obrigacoes', o.id, { competencia: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Prazo legal<input type="date" value={o.prazoLegal} onChange={e => updateCollection('obrigacoes', o.id, { prazoLegal: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Periodicidade<select value={o.periodicidade} onChange={e => updateCollection('obrigacoes', o.id, { periodicidade: e.target.value as Periodicidade })} style={inputStyle}><option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="anual">Anual</option><option value="eventual">Eventual</option></select></label>
                            <label style={labelSmall}>Status<select value={o.status} onChange={e => updateCollection('obrigacoes', o.id, { status: e.target.value as NfpStatusObrigacao })} style={inputStyle}><option value="pendente">Pendente</option><option value="atrasada">Atrasada</option><option value="entregue">Entregue</option><option value="dispensada">Dispensada</option><option value="nao_verificada">Não verificada</option></select></label>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                            <input placeholder="Observação" value={o.observacao} onChange={e => updateCollection('obrigacoes', o.id, { observacao: e.target.value })} style={inputStyle} />
                            <RemoveButton onClick={() => removeFromCollection('obrigacoes', o.id)} />
                        </div>
                    </div>
                ))}
            </ManualSection>

            <ManualSection title="Certidões" onAdd={() => setForm(prev => ({ ...prev, certidoes: [...prev.certidoes, newCertidao()] }))}>
                {form.certidoes.map(c => (
                    <div key={c.id} style={cardStyle}>
                        <div style={rowGrid}>
                            <label style={labelSmall}>Esfera<select value={c.esfera} onChange={e => updateCollection('certidoes', c.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}><option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option></select></label>
                            <label style={labelSmall}>Órgão<input value={c.orgao} onChange={e => updateCollection('certidoes', c.id, { orgao: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Tipo<input value={c.tipo} onChange={e => updateCollection('certidoes', c.id, { tipo: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Validade<input type="date" value={c.dataValidade} onChange={e => updateCollection('certidoes', c.id, { dataValidade: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Status<select value={c.status} onChange={e => updateCollection('certidoes', c.id, { status: e.target.value as NfpStatusCertidao })} style={inputStyle}><option value="negativa">Negativa</option><option value="positiva_efeitos_negativa">Positiva c/ efeitos</option><option value="positiva">Positiva</option><option value="indisponivel">Indisponível</option><option value="nao_consultada">Não consultada</option></select></label>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                            <input placeholder="Motivo/observação" value={c.motivoImpedimento} onChange={e => updateCollection('certidoes', c.id, { motivoImpedimento: e.target.value })} style={inputStyle} />
                            <RemoveButton onClick={() => removeFromCollection('certidoes', c.id)} />
                        </div>
                    </div>
                ))}
            </ManualSection>

            <ManualSection title="Parcelamentos" onAdd={() => setForm(prev => ({ ...prev, parcelamentos: [...prev.parcelamentos, newParcelamento()] }))}>
                {form.parcelamentos.length === 0 && <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.82rem' }}>Nenhum parcelamento informado.</p>}
                {form.parcelamentos.map(p => (
                    <div key={p.id} style={cardStyle}>
                        <div style={rowGrid}>
                            <label style={labelSmall}>Esfera<select value={p.esfera} onChange={e => updateCollection('parcelamentos', p.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}><option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option></select></label>
                            <label style={labelSmall}>Programa<input value={p.programa} onChange={e => updateCollection('parcelamentos', p.id, { programa: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Valor total<input inputMode="decimal" value={p.valorTotal} onChange={e => updateCollection('parcelamentos', p.id, { valorTotal: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Parcelas<input inputMode="numeric" value={p.parcelas} onChange={e => updateCollection('parcelamentos', p.id, { parcelas: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Pagas<input inputMode="numeric" value={p.parcelasPagas} onChange={e => updateCollection('parcelamentos', p.id, { parcelasPagas: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Valor parcela<input inputMode="decimal" value={p.valorParcela} onChange={e => updateCollection('parcelamentos', p.id, { valorParcela: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Início<input type="date" value={p.dataInicio} onChange={e => updateCollection('parcelamentos', p.id, { dataInicio: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Status<select value={p.status} onChange={e => updateCollection('parcelamentos', p.id, { status: e.target.value as ParcelamentoStatus })} style={inputStyle}><option value="ativo">Ativo</option><option value="inadimplente">Inadimplente</option><option value="quitado">Quitado</option><option value="cancelado">Cancelado</option></select></label>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                            <RemoveButton onClick={() => removeFromCollection('parcelamentos', p.id)} />
                        </div>
                    </div>
                ))}
            </ManualSection>

            <ManualSection title="Ações judiciais" onAdd={() => setForm(prev => ({ ...prev, acoes: [...prev.acoes, newAcao()] }))}>
                {form.acoes.length === 0 && <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.82rem' }}>Nenhuma ação judicial informada.</p>}
                {form.acoes.map(a => (
                    <div key={a.id} style={cardStyle}>
                        <div style={rowGrid}>
                            <label style={labelSmall}>Tipo<select value={a.tipo} onChange={e => updateCollection('acoes', a.id, { tipo: e.target.value as NfpTipoAcao })} style={inputStyle}><option value="tributaria">Tributária</option><option value="trabalhista">Trabalhista</option><option value="civil">Civil</option><option value="criminal">Criminal</option></select></label>
                            <label style={labelSmall}>Número<input value={a.numero} onChange={e => updateCollection('acoes', a.id, { numero: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Descrição<input value={a.descricao} onChange={e => updateCollection('acoes', a.id, { descricao: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Valor causa<input inputMode="decimal" value={a.valorCausa} onChange={e => updateCollection('acoes', a.id, { valorCausa: e.target.value })} style={inputStyle} /></label>
                            <label style={labelSmall}>Status<select value={a.status} onChange={e => updateCollection('acoes', a.id, { status: e.target.value as AcaoStatus })} style={inputStyle}><option value="em_andamento">Em andamento</option><option value="encerrada">Encerrada</option><option value="arquivada">Arquivada</option></select></label>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                            <RemoveButton onClick={() => removeFromCollection('acoes', a.id)} />
                        </div>
                    </div>
                ))}
            </ManualSection>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button disabled={disabled} onClick={handleSubmit} style={{ ...btnStyleSave, opacity: disabled ? 0.5 : 1 }}>
                    Gerar análise e plano
                </button>
            </div>
        </div>
    );
};

const ManualSection: React.FC<{ title: string; onAdd: () => void; children: React.ReactNode }> = ({ title, onAdd, children }) => (
    <section style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h4 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '0.9rem' }}>{title}</h4>
            <button onClick={onAdd} style={{ ...btnStyle, padding: '5px 10px', fontSize: '0.78rem' }}>+ Adicionar</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>{children}</div>
    </section>
);

const RemoveButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        onClick={onClick}
        title="Remover"
        style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: '1px solid var(--danger)33',
            background: 'var(--danger)12',
            color: 'var(--danger)',
            cursor: 'pointer',
            fontWeight: 700,
            flex: '0 0 auto',
        }}
    >
        x
    </button>
);

export default ManualSituacaoFiscalForm;
