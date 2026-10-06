// Acesso à carteira permite leitura; operação fiscal é uma autorização distinta.
function operacaoLegada(user) {
    if (!user || user.acessoCfi === 'relatorios') return false;
    if (user.acessoCfi === 'operacional') return true;
    // Vínculos de outros departamentos, inclusive mistos, não concedem operação.
    const deps = Array.isArray(user.departamentos) ? user.departamentos : [];
    return (user.role === 'admin' && deps.length === 0) || (deps.length === 1 && deps[0] === 'fiscal');
}
export const MENSAGEM_SOMENTE_RELATORIOS = 'Seu perfil no CFI não permite esta ação. Peça ao administrador a liberação específica; o acesso aos relatórios da sua carteira permanece.';

// Portas compartilhadas têm autorização própria do aplicativo de origem.
const COMPARTILHADAS = ['/api/admin/whatsapp', '/api/admin/comunicacao', '/api/admin/cadastro', '/api/admin/cadastro-contabil', '/api/admin/reinf', '/api/admin/ebef', '/api/admin/minha-agenda'];
export function exigeOperacaoFiscal(method, url) {
    const path = String(url || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
    method = String(method).toUpperCase();
    if (!path.startsWith('/api/admin/') && !path.startsWith('/api/fiscal/') && !path.startsWith('/api/analise-creditos/')) return false;
    // Ajuste de retenções é escrita fiscal, mesmo no router compartilhado Reinf.
    if (path === '/api/admin/reinf/retencoes-pj/ajuste') return method !== 'GET';
    if (COMPARTILHADAS.some(p => path === p || path.startsWith(p + '/'))) return false;
    if (method === 'GET' && (
        ['/api/admin/relatorios/faturamento', '/api/admin/relatorios/faturamento-mensal'].includes(path)
        || ['/api/admin/empresas-perfil', '/api/admin/lucro/empresas-resumo',
            '/api/admin/rotina-fiscal/painel', '/api/admin/rotina-fiscal/parametros',
            '/api/admin/sefaz/ipi-varredura', '/api/admin/dipam/varredura',
            '/api/admin/sped-fiscal/apuracao-icms', '/api/admin/sped-contrib/relatorio-monofasico'].includes(path)
    )) return false;
    return true;
}

export const ACOES_CFI = ['editar', 'importar', 'calcular', 'emitir', 'fechar', 'excluir'];
export const NIVEIS_CFI = ['consulta', 'edicao', 'operacao'];
export function criarPermissoesCfi(nivel) {
    return { versao: 1, nivel, acoes: Object.fromEntries(ACOES_CFI.map(acao => [acao,
        nivel === 'operacao' || (nivel === 'edicao' && acao === 'editar')])) };
}
export function validarPermissoesCfi(p) {
    if (!p || p.versao !== 1 || !NIVEIS_CFI.includes(p.nivel) || !p.acoes
        || Object.keys(p).some(k => !['versao', 'nivel', 'acoes'].includes(k))
        || Object.keys(p.acoes).length !== ACOES_CFI.length
        || !ACOES_CFI.every(a => typeof p.acoes[a] === 'boolean')) return false;
    return p.nivel !== 'consulta' || ACOES_CFI.every(a => !p.acoes[a]);
}
export function permissoesEfetivasCfi(user) {
    if (user && Object.hasOwn(user, 'permissoesCfi')) {
        return validarPermissoesCfi(user.permissoesCfi) ? user.permissoesCfi : criarPermissoesCfi('consulta');
    }
    return criarPermissoesCfi(operacaoLegada(user) ? 'operacao' : 'consulta');
}
export function podeAcaoFiscal(user, acao) {
    const p = permissoesEfetivasCfi(user);
    return acao === 'operar' ? ACOES_CFI.every(a => p.acoes[a]) : p.acoes[acao] === true;
}
// Navegação operacional não significa autorização para todas as ações.
export function podeOperarFiscal(user) {
    return ACOES_CFI.some(a => podeAcaoFiscal(user, a));
}
// Rotas novas/desconhecidas exigem todas as ações até receber classificação explícita.
// Isso evita que um nome de rota novo contorne uma ação retirada do perfil.
export function acaoFiscalDaRota(method, url) {
    if (!exigeOperacaoFiscal(method, url)) return null;
    const path = String(url || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
    const partes = path.split('/');
    if (method.toUpperCase() === 'DELETE' || partes.some(p => /^(excluir|remover|limpar|apagar|resetar)(-|$)/.test(p))) return 'excluir';
    if (partes.some(p => /^(fechar|fechamento|fechamentos|reabrir|reabertura|aprovar)(-|$)/.test(p))) return 'fechar';
    if (partes.some(p => /^(emitir|transmitir|declarar|emissao|manifestar)(-|$)/.test(p))) return 'emitir';
    if (partes.some(p => /^(importar|importacao|capturar|captura|sync|sincronizar|upload)(-|$)/.test(p))) return 'importar';
    if (partes.some(p => /^(calcular|calculo|apuracao|apurar|gerar)(-|$)/.test(p))) return 'calcular';
    if (['/api/admin/das/atividade-iss-fixo', '/api/admin/sped-fiscal/inventario',
        '/api/admin/sped-fiscal/bloco-k', '/api/admin/reinf/retencoes-pj/ajuste'].includes(path)) return 'editar';
    return 'operar';
}
