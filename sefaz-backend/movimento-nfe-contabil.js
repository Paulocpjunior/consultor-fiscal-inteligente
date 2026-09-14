// NF-e para conferência contábil: valores por CFOP reconciliados com o total da nota.
import { dataDeclaradaDoDocumento, direcaoEfetivaDoc, docCancelado, ehEntradaDoEmitente, valorDoDocumento } from './xml-metadata-helper.js';
import { ehNotaDeMercadoria } from './sped-selecao-documentos.js';
import { participanteDoDocumento, cfopNaOticaDeEntrada } from './participante-doc-helper.js';
import { valorOperacaoDosItens } from './valor-operacao-c190.js';
const digits = v => String(v ?? '').replace(/\D/g, '');
const cents = v => Math.round(Number(v) * 100);
function chaveValida(chave) {
    if (!/^\d{44}$/.test(chave)) return false;
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) { soma += Number(chave[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const dv = 11 - soma % 11;
    return Number(chave[43]) === (dv >= 10 ? 0 : dv);
}
export function montarMovimentoNfeContabil({ cnpjEmpresa, competencia, movimento, documentos = [] }) {
    const cnpj = digits(cnpjEmpresa);
    if (cnpj.length !== 14 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia) || !['entrada', 'saida'].includes(movimento)) throw new Error('Escopo NF-e inválido.');
    const notas = [], pendencias = [], ressalvas = [], chaves = new Set();
    let canceladas = 0;
    for (const d of documentos) {
        if (!d || d._deleted || d._merged_into || !ehNotaDeMercadoria(d) || ehEntradaDoEmitente(d, cnpj).sim || direcaoEfetivaDoc(d) !== movimento) continue;
        if (docCancelado(d)) { canceladas++; continue; }
        const chave = digits(d.chave), numero = String(d.numero || '').trim();
        const fail = motivo => pendencias.push({ id: d.id || null, numero: numero || null, chave: chave || null, motivo });
        if (!chaveValida(chave) || !(movimento === 'saida' ? ['55', '65'] : ['55']).includes(chave.slice(20,22)) || !numero) { fail('Chave NF-e ou número ausente; confira o XML completo no CFI'); continue; }
        if (chaves.has(chave)) { fail('Chave NF-e repetida no CFI'); continue; }
        chaves.add(chave);
        if (!Array.isArray(d.itens) || !d.itens.length) { fail('Sem itens/CFOP: captura contém apenas resumo ou XML incompleto'); continue; }
        if (digits(d.empresaCnpj) !== cnpj || ![digits(d.cnpjEmit), digits(d.cnpjDest)].includes(cnpj)) { fail('CNPJ da nota não corresponde à empresa consultada'); continue; }
        const data = dataDeclaradaDoDocumento(d.dhEmi || d.dataEmissao);
        if (!data || data.slice(0,7) !== competencia) { fail('Data de emissão ausente ou fora da competência'); continue; }
        const total = cents(valorDoDocumento(d));
        if (!Number.isFinite(total) || total <= 0) { fail('Total da nota ausente ou inválido'); continue; }
        const operacao = valorOperacaoDosItens(d);
        const grupos = new Map();
        let invalido = false;
        d.itens.forEach((item, index) => {
            const original = digits(item.cfop || item.CFOP);
            const cfop = movimento === 'entrada' ? cfopNaOticaDeEntrada(original) : original;
            const valor = cents(operacao.porItem[index]);
            if (!(movimento === 'entrada' ? /^[123]\d{3}$/ : /^[567]\d{3}$/).test(cfop) || !Number.isFinite(valor) || valor < 0) { invalido = true; return; }
            grupos.set(cfop, (grupos.get(cfop) || 0) + valor);
        });
        if (invalido) { fail('Item sem CFOP válido ou valor conferível'); continue; }
        if ([...grupos.values()].reduce((a,b) => a+b,0) !== total) { fail('Soma das operações por CFOP diverge do total da NF-e; confira itens e totais no CFI'); continue; }
        const parte = participanteDoDocumento(d, cnpj) || {};
        if (operacao.rateado) ressalvas.push('NF ' + numero + ': despesas/descontos presentes apenas nos totais foram rateados pela regra do CFI; confira os CFOPs.');
        notas.push({ idOrigem: String(d.id || chave), numero, chave, modelo: chave.slice(20,22), data, valor: total / 100, participanteNome: parte.nome || parte.razaoSocial || null, participanteDocumento: digits(parte.cnpjCpf || parte.cnpj || parte.cpf), origemDocumento: d.origem || 'CFI', gruposCfop: [...grupos].filter(([,v]) => v > 0).map(([cfop,v]) => ({ cfop, valor: v / 100 })) });
    }
    return { contrato: 'movimento_fiscal_cfi_v1', cnpjEmpresa: cnpj, competencia, movimento, notas,
        resumo: { notas: notas.length, nfe: notas.filter(n => n.modelo === '55').length, nfce: notas.filter(n => n.modelo === '65').length, total: notas.reduce((s,n) => s + cents(n.valor),0)/100, canceladas, foraPorLacuna: pendencias.length },
        pendencias, bloqueado: pendencias.length > 0, ressalvas };
}
