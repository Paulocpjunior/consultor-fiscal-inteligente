// Movimento fiscal normalizado para o Consultor Contabil (CCI).
//
// O CFI e o dono das varias formas em que uma NFS-e e gravada. Esta fronteira
// entrega um contrato estavel; o CCI nao le o Firestore do outro projeto e nao
// precisa reproduzir as regras de portal/XML/ADN.

import { participanteDoDocumento } from './participante-doc-helper.js';
import {
    direcaoEfetivaDoc,
    docCancelado,
    issDoDocumento,
    issRetidoDoDocumento,
    valorDoDocumento,
} from './xml-metadata-helper.js';
import { ehNotaDeServico } from './sped-selecao-documentos.js';
import { lerRetencoesFederaisDoDoc } from './reinf-retencoes-pj.js';

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v) => String(v ?? '').trim();
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function primeiroNumero(...valores) {
    for (const valor of valores) {
        if (valor === undefined || valor === null || valor === '') continue;
        const n = Number(valor);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

function dataIso(valor) {
    if (!valor) return '';
    const data = typeof valor?.toDate === 'function' ? valor.toDate() : valor;
    if (data instanceof Date && !Number.isNaN(data.getTime())) return data.toISOString().slice(0, 10);
    const s = texto(data);
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return br ? `${br[3]}-${br[2]}-${br[1]}` : '';
}

function contraparte(d, empresaCnpj) {
    const p = participanteDoDocumento(d, empresaCnpj) || {};
    const saida = direcaoEfetivaDoc(d) === 'saida';
    const nome = texto(
        p.nome || p.razaoSocial
        || (saida ? (d.tomadorNome || d.xNomeDest || d.nomeDest) : (d.prestadorNome || d.xNomeEmit || d.nomeEmit)),
    );
    const documento = soDigitos(
        p.cnpjCpf || p.cnpj || p.cpf
        || (saida ? (d.tomadorCnpj || d.tomadorCpf || d.cnpjDest) : (d.prestadorCnpj || d.cnpjEmit)),
    );
    return { nome, documento };
}

function normalizarDocumento(d, empresaCnpj, movimento) {
    if (!d || docCancelado(d) || !ehNotaDeServico(d)) return null;
    const direcaoEsperada = movimento === 'servicos_prestados' ? 'saida' : 'entrada';
    if (direcaoEfetivaDoc(d) !== direcaoEsperada) return null;

    const parte = contraparte(d, empresaCnpj);
    const v = d.valores || {};
    // Valor da nota e base de ISS nao sao sinonimos: deducoes podem reduzir a
    // base sem reduzir o bruto. Reutilize primeiro a regua canonica do CFI e
    // deixe baseCalculo apenas no campo proprio abaixo.
    const valor = primeiroNumero(d.valorServicos, v.valorServicos, valorDoDocumento(d));
    if (!(valor > 0)) return null;
    const fed = lerRetencoesFederaisDoDoc(d);
    const iss = issDoDocumento(d);
    const issRetido = issRetidoDoDocumento(d);
    const data = dataIso(d.dataFatoGerador || d.dhEmi || d.dataEmissao || d.emitidaEm || d.createdAt);
    if (!data) return null;

    return {
        idOrigem: texto(d.id),
        numero: texto(d.numero) || null,
        data,
        participanteNome: parte.nome || null,
        participanteDocumento: parte.documento || null,
        valor: r2(valor),
        baseCalculoIss: r2(primeiroNumero(v.baseCalculo, d.baseCalculo, valor)),
        aliquotaIss: r2(primeiroNumero(v.aliquotaIss, d.aliquotaIss, d.aliquota)),
        valorIss: Number.isFinite(iss) ? r2(iss) : 0,
        issRetido: Number.isFinite(issRetido) ? r2(issRetido) : 0,
        pisRetido: r2(fed.pis ?? 0),
        cofinsRetido: r2(fed.cofins ?? 0),
        irRetido: r2(fed.ir ?? 0),
        inssRetido: r2(fed.inss ?? 0),
        csllOuTotalRetido: r2(fed.csllOuTotal ?? 0),
        codigoServico: texto(d.codigoServico || d.codigoServicoMunicipal),
        discriminacao: texto(d.discriminacaoServicos || d.discriminacao || d.descricao),
        origemDocumento: texto(d.origem || d.fonte || d.tipoDoc || d.tipo) || 'CFI',
    };
}

export function montarMovimentoFiscalContabil({ cnpjEmpresa, competencia, movimento, documentos } = {}) {
    const cnpj = soDigitos(cnpjEmpresa);
    const tipo = texto(movimento);
    if (cnpj.length !== 14) throw new Error('CNPJ da empresa invalido.');
    if (!/^\d{4}-\d{2}$/.test(texto(competencia))) throw new Error('Competencia invalida; use AAAA-MM.');
    if (!['servicos_prestados', 'servicos_tomados'].includes(tipo)) {
        throw new Error('Movimento deve ser servicos_prestados ou servicos_tomados.');
    }

    const notas = (documentos || [])
        .map((d) => normalizarDocumento(d, cnpj, tipo))
        .filter(Boolean)
        .sort((a, b) => a.data.localeCompare(b.data) || String(a.numero).localeCompare(String(b.numero), 'pt-BR', { numeric: true }));
    const total = r2(notas.reduce((soma, nota) => soma + nota.valor, 0));
    const semDocumentoContraparte = notas.filter((nota) => !nota.participanteDocumento).length;

    return {
        contrato: 'movimento_fiscal_cfi_v1',
        cnpjEmpresa: cnpj,
        competencia: texto(competencia),
        movimento: tipo,
        notas,
        resumo: {
            notas: notas.length,
            total,
            semDocumentoContraparte,
        },
        ressalvas: semDocumentoContraparte
            ? [`${semDocumentoContraparte} nota(s) nao trazem CPF/CNPJ da contraparte na captura; o nome e o numero da NFS-e foram preservados para conferencia.`]
            : [],
    };
}
