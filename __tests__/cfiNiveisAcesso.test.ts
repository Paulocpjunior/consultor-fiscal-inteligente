import { ACOES_CFI, criarPermissoesCfi, validarPermissoesCfi, podeAcaoFiscal, acaoFiscalDaRota } from '../sefaz-backend/cfi-acesso.js';
const edicao = { role:'colaborador', permissoesCfi:criarPermissoesCfi('edicao') };
test('edição não herda cálculo, importação, emissão, fechamento ou exclusão',()=>{
    expect(podeAcaoFiscal(edicao,'editar')).toBe(true);
    for(const acao of ACOES_CFI.filter(a=>a!=='editar')) expect(podeAcaoFiscal(edicao,acao)).toBe(false);
});
test('nenhuma administração ou carteira concede ações retiradas explicitamente',()=>{
    for(const role of ['admin','colaborador']) for(const departamentos of [[],['fiscal'],['contabil','fiscal']]) {
        const user={role,departamentos,acessoCfi:'operacional',permissoesCfi:criarPermissoesCfi('consulta')};
        for(const a of ACOES_CFI) expect(podeAcaoFiscal(user,a)).toBe(false);
    }
});
test('compatibilidade preserva operadores e Letícia sem escrever nem migrar perfis',()=>{
    for(const a of ACOES_CFI) expect(podeAcaoFiscal({acessoCfi:'operacional'},a)).toBe(true);
    for(const a of ACOES_CFI) expect(podeAcaoFiscal({role:'colaborador',departamentos:['contabil','fiscal'],acessoCfi:'relatorios'},a)).toBe(false);
});
test('ação independente não dá operação irrestrita',()=>{
    const p=criarPermissoesCfi('edicao');p.acoes.importar=true;
    expect(podeAcaoFiscal({permissoesCfi:p},'importar')).toBe(true);
    expect(podeAcaoFiscal({permissoesCfi:p},'calcular')).toBe(false);
    expect(podeAcaoFiscal({permissoesCfi:p},'operar')).toBe(false);
});
test.each([
    ['POST','/api/admin/sae-nfce/importar-xmls','importar'],
    ['POST','/api/admin/das/emitir-regular','emitir'],
    ['POST','/api/admin/das/declarar-sem-movimento','emitir'],
    ['POST','/api/admin/sped-fiscal/gerar','calcular'],
    ['POST','/api/admin/competencia/fechar','fechar'],
    ['DELETE','/api/admin/empresas/a','excluir'],
    ['POST','/api/admin/sped-fiscal/inventario','editar'],
    ['POST','/api/admin/rota-nova','operar'],
    ['GET','/api/admin/relatorios/faturamento',null],
    ['POST','/api/admin/whatsapp/enviar',null],
])('classifica %s %s', (m,p,a)=>expect(acaoFiscalDaRota(m,p)).toBe(a));
test('configurações inválidas e consulta com escrita são rejeitadas',()=>{
    const p=criarPermissoesCfi('consulta');p.acoes.editar=true;
    expect(validarPermissoesCfi(p)).toBe(false);
    expect(validarPermissoesCfi({...p,versao:2})).toBe(false);
    expect(validarPermissoesCfi(null)).toBe(false);
    expect(validarPermissoesCfi({...criarPermissoesCfi('edicao'),role:'admin'})).toBe(false);
});
