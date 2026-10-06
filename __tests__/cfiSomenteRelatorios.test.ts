import { podeOperarFiscal, exigeOperacaoFiscal } from '../sefaz-backend/cfi-acesso.js';
import { podeAcessarCard, MENU_GRUPOS } from '../config/menuConfig';
import { SearchType } from '../types';
const leticia = { role: 'colaborador' as const, departamentos: ['contabil', 'fiscal'], acessoCfi: 'relatorios' as const };
test('relatórios não concedem operação mesmo com carteira e módulo de emissão', () => {
    expect(podeOperarFiscal(leticia)).toBe(false);
    for (const card of MENU_GRUPOS.flatMap(g => g.cards)) expect(podeAcessarCard({...leticia,modulosPermitidos:[SearchType.EMISSAO_TRIBUTOS]},card)).toBe(card.type === SearchType.RELATORIOS);
});
test('departamentos externos e mistos exigem autorização operacional explícita', () => {
    for (const deps of [[],['contabil'],['dp-folha'],['financeiro'],['fiscal','contabil']]) expect(podeOperarFiscal({role:'colaborador',departamentos:deps})).toBe(false);
    expect(podeOperarFiscal({role:'colaborador',departamentos:['fiscal']})).toBe(true);
    expect(podeOperarFiscal({...leticia,acessoCfi:'operacional'})).toBe(true);
    expect(podeOperarFiscal({role:'admin'})).toBe(true);
    expect(podeOperarFiscal({role:'admin',departamentos:['contabil']})).toBe(false);
    expect(podeOperarFiscal({role:'admin',departamentos:['fiscal','contabil']})).toBe(false);
    expect(podeOperarFiscal({role:'admin',acessoCfi:'relatorios'})).toBe(false);
});
test('API nega cálculo, gravação, emissão e GET operacional; leitura do relatório permanece', () => {
    for (const path of ['/api/admin/das/emitir','/api/admin/darf/emitir','/api/admin/lucro/salvar','/api/fiscal/query','/API/ADMIN/DAS/emitir','/api/admin/reinf/retencoes-pj/ajuste']) expect(exigeOperacaoFiscal('POST',path)).toBe(true);
    expect(exigeOperacaoFiscal('GET','/api/admin/das/previsao/id')).toBe(true);
    expect(exigeOperacaoFiscal('GET','/api/admin/relatorios/faturamento?competencia=2026-07')).toBe(false);
    expect(exigeOperacaoFiscal('POST','/api/admin/relatorios/faturamento')).toBe(true);
    expect(exigeOperacaoFiscal('GET','/api/admin/empresas-perfil')).toBe(false);
    expect(exigeOperacaoFiscal('POST','/api/admin/whatsapp/enviar')).toBe(false); // autorização pertence ao SP Connect
});
