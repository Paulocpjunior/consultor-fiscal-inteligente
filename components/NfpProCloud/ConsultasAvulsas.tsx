/**
 * components/NfpProCloud/ConsultasAvulsas.tsx
 *
 * 🚨 AS TRÊS CONSULTAS QUE EXISTIAM NO BACKEND E QUE A TELA NUNCA CHAMOU.
 *
 * A varredura de rotas (22/08) achou `/situacao-fiscal`, `/divida-ativa` e
 * `/cnds-publicas` sem caminho na interface — a tela do NFP só chamava
 * `/analise-completa`. O buraco tem consequência prática: a completa é um
 * `Promise.allSettled` de CINCO consultas, e quando UMA cai (SERPRO fora,
 * timeout do portal) não havia como repetir só ela — ou se refazia a varredura
 * inteira, queimando quota PAGA nas quatro que já tinham dado certo, ou se
 * ficava sem o pedaço.
 *
 * ⚠️ TRÊS COISAS QUE A TELA DIZ, e cada uma existe por um motivo:
 *
 *  1. **Consulta pura — NÃO grava a análise.** Quem grava é o botão da
 *     varredura. Sem essa frase, alguém consulta, vê o número e conclui que ele
 *     entrou no plano de ação.
 *  2. **Quota**: situação fiscal e dívida ativa são SERPRO (pagas por
 *     consulta); as CNDs vêm dos portais públicos e não consomem quota. Quem
 *     clica precisa saber qual das duas está gastando.
 *  3. **Resultado vazio não é "nada devido"** — é a régua de sempre: ausência
 *     não é prova. A frase aparece junto do resultado, nunca no rodapé.
 */
import React, { useState } from 'react';
import * as nfpService from '../../services/nfpProCloudService';
import { cardStyle, btnStyle } from './_common';

type Consulta = 'situacao' | 'divida' | 'cnds';

interface Estado {
    carregando: Consulta | null;
    qual: Consulta | null;
    resultado: any | null;
    erro: string | null;
}

const ROTULO: Record<Consulta, string> = {
    situacao: 'Situação fiscal',
    divida: 'Dívida ativa da União',
    cnds: 'CNDs (portais públicos)',
};

/** SERPRO é pago por consulta; portal público, não. */
const CONSOME_QUOTA: Record<Consulta, boolean> = {
    situacao: true,
    divida: true,
    cnds: false,
};

interface Props {
    cnpj: string;
}

const ConsultasAvulsas: React.FC<Props> = ({ cnpj }) => {
    const [st, setSt] = useState<Estado>({ carregando: null, qual: null, resultado: null, erro: null });

    const somenteDigitos = (cnpj || '').replace(/\D/g, '');
    const temCnpj = somenteDigitos.length === 14;

    const rodar = async (qual: Consulta) => {
        if (!temCnpj) {
            setSt({ carregando: null, qual, resultado: null, erro: 'Selecione uma empresa (ou informe o CNPJ do prospect) antes de consultar.' });
            return;
        }
        setSt({ carregando: qual, qual, resultado: null, erro: null });
        try {
            const fn = qual === 'situacao'
                ? nfpService.consultarSituacaoFiscal
                : qual === 'divida'
                    ? nfpService.consultarDividaAtiva
                    : nfpService.consultarCndsPublicas;
            const resultado = await fn(somenteDigitos);
            setSt({ carregando: null, qual, resultado, erro: null });
        } catch (e: any) {
            setSt({ carregando: null, qual, resultado: null, erro: e?.message || 'Falha na consulta' });
        }
    };

    return (
        <div style={{ ...cardStyle, marginTop: '1.5rem', borderLeft: '4px solid #0ea5e9' }}>
            <h3 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: '0 0 0.35rem' }}>
                🔎 Consultas avulsas
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                Repete <strong>uma</strong> consulta quando ela falha dentro da varredura — sem refazer as outras
                quatro, que já custaram quota. É <strong>consulta pura</strong>: mostra o que o órgão respondeu
                agora e <strong>não grava</strong> na análise nem no plano de ação.
            </p>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {(['situacao', 'divida', 'cnds'] as Consulta[]).map(q => (
                    <button
                        key={q}
                        onClick={() => rodar(q)}
                        disabled={st.carregando !== null}
                        style={{ ...btnStyle, opacity: st.carregando !== null ? 0.5 : 1 }}
                    >
                        {st.carregando === q ? 'Consultando...' : ROTULO[q]}
                        {CONSOME_QUOTA[q] ? ' · SERPRO' : ' · público'}
                    </button>
                ))}
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                “SERPRO” consome quota paga a cada clique; “público” consulta os portais e não consome.
            </p>

            {st.erro && (
                <div style={{
                    marginTop: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: '8px',
                    background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.8rem',
                }}>
                    ⛔ {st.erro}
                </div>
            )}

            {st.resultado && st.qual && (
                <div style={{ marginTop: '0.75rem' }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                        Resposta de <strong>{ROTULO[st.qual]}</strong> para o CNPJ {somenteDigitos}. Resultado vazio
                        {' '}<strong>não</strong> prova que não há débito ou pendência — prova que o órgão não devolveu
                        nada agora.
                    </p>
                    <pre style={{
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '320px', overflow: 'auto',
                        fontSize: '0.75rem', lineHeight: 1.5, color: 'var(--text-primary)',
                        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                        borderRadius: '8px', padding: '0.75rem', margin: 0,
                    }}>
                        {JSON.stringify(st.resultado, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
};

export default ConsultasAvulsas;
