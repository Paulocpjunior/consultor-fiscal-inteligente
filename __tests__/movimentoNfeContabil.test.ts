import { montarMovimentoFiscalContabil } from '../sefaz-backend/movimento-fiscal-contabil.js';
const cnpj = '32602701000197';
const chave = '35260832602701000197550100000111941000392711';
const base = { id: chave, chave, empresaCnpj: cnpj, cnpjEmit: cnpj, cnpjDest: '63649281000128', xNomeDest: 'Cliente', tipoDoc: 'NFe', direcao: 'saida', tpNF: '1', status: 'autorizado', numero: '11194', dhEmi: '2026-08-01T23:30:00-03:00', valorTotal: 150, itens: [{cfop:'5102',vProd:100}, {cfop:'6102',vProd:50}] };
const executar = (documentos: any[], movimento: 'entrada' | 'saida' = 'saida') => montarMovimentoFiscalContabil({cnpjEmpresa:cnpj,competencia:'2026-08',movimento,documentos});
describe('NF-e CFI -> CCI', () => {
    it('entrega CFOPs e total da nota, sem confundir fuso, serviços ou canceladas', () => {
        const r = executar([base,{...base,id:'cancelada',status:'cancelado'},{...base,id:'servico',tipoDoc:'NFSe'}]);
        expect(r.bloqueado).toBe(false);
        expect(r.notas[0].gruposCfop).toEqual([{cfop:'5102',valor:100},{cfop:'6102',valor:50}]);
        expect(r.notas[0].data).toBe('2026-08-01');expect(r.resumo.total).toBe(150);expect(r.resumo.canceladas).toBe(1);
    });
    it.each([
        {itens:[]}, {itens:[{cfop:'',vProd:150}]}, {valorTotal:151}, {dhEmi:'2026-07-31'}, {empresaCnpj:'42907639000103'}, {chave:chave.slice(0,43)+'9'}, {numero:null},
    ])('bloqueia captura incompleta/divergente sem completar valores (%j)', patch => {
        const r = executar([{...base,...patch}]);expect(r.bloqueado).toBe(true);expect(r.pendencias).toHaveLength(1);expect(r.notas).toHaveLength(0);
    });
    it('bloqueia chave repetida',()=>expect(executar([base,base]).bloqueado).toBe(true));
    it('preserva natureza de entrada própria e fornecedor',()=>{
        const r=executar([{...base,tpNF:'0',itens:[{cfop:'1202',vProd:150}]}],'entrada');
        expect(r.bloqueado).toBe(false);expect(r.notas[0].gruposCfop[0].cfop).toBe('1202');expect(r.notas[0].participanteDocumento).toBe('63649281000128');
    });
    it('deixa totais rateados explícitos e reconciliados',()=>{
        const r=executar([{...base,valorTotal:165,totais:{vFrete:15}}]);expect(r.resumo.total).toBe(165);expect(r.ressalvas).toHaveLength(1);
    });
    it('ignora excluídos e impede mistura da direção',()=>expect(executar([{...base,_deleted:true},{...base,direcao:'entrada'}]).notas).toHaveLength(0));
});
