// Acesso à carteira permite leitura; operação fiscal é uma autorização distinta.
export function podeOperarFiscal(user) {
    if (!user || user.acessoCfi === 'relatorios') return false;
    if (user.acessoCfi === 'operacional') return true;
    // Vínculos de outros departamentos, inclusive mistos, não concedem operação.
    const deps = Array.isArray(user.departamentos) ? user.departamentos : [];
    return (user.role === 'admin' && deps.length === 0) || (deps.length === 1 && deps[0] === 'fiscal');
}
export const MENSAGEM_SOMENTE_RELATORIOS = 'Seu acesso ao CFI é somente para consulta de relatórios. Cálculos, alterações e emissões exigem liberação operacional do administrador.';

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
