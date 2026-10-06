import React, { useState } from 'react';
import { User } from '../types';
import { ACOES_CFI, criarPermissoesCfi, permissoesEfetivasCfi, type PermissoesCfi, type NivelCfi } from '../sefaz-backend/cfi-acesso.js';
import { salvarPermissoesCfi, historicoPermissoesCfi } from '../services/authService';
const labels = { editar: 'Editar cadastros e dados', importar: 'Importar documentos', calcular: 'Calcular e salvar apurações', emitir: 'Emitir / transmitir', fechar: 'Aprovar / fechar / reabrir', excluir: 'Excluir dados' };
export default function AcessoCfiEditor({ user, disabled, onSaved }: { user: User; disabled: boolean; onSaved: (p: PermissoesCfi, revisao: number) => void }) {
    const [draft, setDraft] = useState(() => permissoesEfetivasCfi(user));
    const [historico, setHistorico] = useState<Awaited<ReturnType<typeof historicoPermissoesCfi>> | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    return <fieldset disabled={disabled || busy} className="border rounded p-3 space-y-2">
        <legend className="text-sm font-bold">Nível e ações — somente CFI</legend>
        <p className="text-xs">{user.role === 'admin' ? 'Administrador do CFI. Administração é uma permissão separada das ações abaixo.' : 'Colaborador. Este nível não concede administração.'}</p>
        <select aria-label={'Nível CFI de ' + user.name} value={draft.nivel} onChange={e => { setDraft(criarPermissoesCfi(e.target.value as NivelCfi)); setMessage('Alteração pendente de salvar.'); }} className="rounded border p-2 text-sm">
            <option value="consulta">Somente consulta e relatórios</option>
            <option value="edicao">Consulta e edição</option>
            <option value="operacao">Operação fiscal</option>
        </select>
        <div className="flex flex-wrap gap-3">{ACOES_CFI.map(acao => <label key={acao} className="text-xs flex gap-1 items-center">
            <input type="checkbox" disabled={draft.nivel === 'consulta'} checked={draft.acoes[acao]} onChange={e => { setDraft({ ...draft, acoes: { ...draft.acoes, [acao]: e.target.checked } }); setMessage('Alteração pendente de salvar.'); }} />{labels[acao]}
        </label>)}</div>
        <p className="text-xs text-slate-500">Valem apenas nas empresas autorizadas. Restrições específicas de emissão e administração continuam valendo. CCI e outros aplicativos mantêm suas próprias permissões. Sem configuração nova, o acesso atual é preservado.</p>
        <button type="button" className="rounded bg-blue-600 text-white px-3 py-1 text-sm" onClick={async () => {
            setBusy(true); setMessage('');
            try { const rev = await salvarPermissoesCfi(user, draft); onSaved(draft, rev); setMessage('Permissões salvas e registradas no histórico.'); }
            catch (e) { setMessage(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
            finally { setBusy(false); }
        }}>{busy ? 'Salvando…' : 'Salvar permissões do CFI'}</button>
        <button type="button" className="text-sm underline ml-3" onClick={async () => { try { setHistorico(await historicoPermissoesCfi(user.id)); } catch (e) { setMessage(e instanceof Error ? e.message : 'Histórico indisponível.'); } }}>Ver histórico</button>
        {historico && <ul className="text-xs space-y-1">{historico.length ? historico.map(h => <li key={h.id}>{new Date(h.em).toLocaleString('pt-BR')} · {h.autor} · {h.antes?.nivel || 'anterior'} → {h.depois.nivel}</li>) : <li>Nenhuma alteração de nível registrada.</li>}</ul>}
        <p role="status" className="text-xs">{message}</p>
    </fieldset>;
}
