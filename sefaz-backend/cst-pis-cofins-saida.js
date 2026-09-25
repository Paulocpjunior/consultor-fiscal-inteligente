// ============================================================================
// sefaz-backend/cst-pis-cofins-saida.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🧾 CST PADRÃO DE PIS/COFINS NA SAÍDA — o cadastro "como o SAGE".
//
// Paulo, 25/09 (tela "Situação Tributária do PIS" do SAGE): *"devemos fazer
// este cadastro como a SAGE, CST 49 para as demais receitas, pode cadastrar"*.
//
// No SAGE o CST do PIS/COFINS é CADASTRO: a escrituração sai do que o
// escritório cadastrou, e "outras operações de saída" (remessa, devolução,
// bonificação, transferência) vão com 49. No CFI o CST vinha só do XML e,
// quando o XML não trazia, caía em 01 (tributada) — inclusive numa remessa.
//
// A régua daqui:
//   · o CFOP diz o TIPO da saída pela DESCRIÇÃO OFICIAL (cfop-catalogo.js,
//     Ajuste SINIEF 03/24): "Venda…", "Prestação de serviço…" e
//     "Industrialização efetuada para outra empresa" = VENDA; 7xxx de venda e
//     5501/5502/6501/6502 (remessa com fim específico de exportação) =
//     EXPORTAÇÃO; o resto (remessa, devolução, bonificação, transferência,
//     ativo, outras) = OUTRAS;
//   · cada tipo tem UM CST cadastrado por empresa (venda: 01/06…;
//     exportação: 08, sugestão; outras: 49, sugestão);
//   · o cadastro entra onde o XML NÃO trouxe CST; sobrepor o CST do XML é
//     opção explícita da empresa (`sobreporXml`), e o arquivo DIZ quantos
//     itens foram sobrepostos e de quais CFOPs;
//   · sem cadastro, nada muda (01 continua o padrão) — e o aviso conta os
//     itens que caíram nele, por tipo e CFOP, para a empresa cadastrar.
// ============================================================================

import { descricaoCfop } from './cfop-catalogo.js';

/** Tabela 4.3.3/4.3.4 — só os CST de SAÍDA, com a descrição da tela do SAGE. */
export const CST_SAIDA = Object.freeze({
    '01': 'Operação tributável com alíquota básica',
    '02': 'Operação tributável com alíquota diferenciada',
    '03': 'Operação tributável com alíquota por unidade de medida de produto',
    '04': 'Operação tributável monofásica — revenda a alíquota zero',
    '05': 'Operação tributável por substituição tributária',
    '06': 'Operação tributável a alíquota zero',
    '07': 'Operação isenta da contribuição',
    '08': 'Operação sem incidência da contribuição',
    '09': 'Operação com suspensão da contribuição',
    '49': 'Outras operações de saída',
});

export const TIPOS_DE_SAIDA = Object.freeze({
    venda: { rotulo: 'Venda / prestação de serviço', sugestao: null, exemplo: '5102, 5101, 5405, 5933' },
    exportacao: { rotulo: 'Exportação', sugestao: '08', exemplo: '7101, 7102, 5501, 5502' },
    outras: { rotulo: 'Demais saídas (remessa, devolução, bonificação, transferência, ativo)', sugestao: '49', exemplo: '5949, 5910, 5201, 5152, 5551' },
});

const so = (v) => String(v || '').replace(/\D/g, '');
const cst2 = (v) => (v == null || v === '' ? '' : String(v).padStart(2, '0'));

const REMESSA_EXPORTACAO = new Set(['5501', '5502', '6501', '6502']);
const ATIVO = /^[567]55[1-9]$/;

/**
 * O tipo da saída pelo CFOP — pela descrição OFICIAL, não por lista digitada.
 * @returns {'venda'|'exportacao'|'outras'|'desconhecido'}
 */
export function tipoDaSaidaPeloCfop(cfop) {
    const c = so(cfop).slice(0, 4);
    if (c.length !== 4 || !/^[567]/.test(c)) return 'desconhecido';
    if (REMESSA_EXPORTACAO.has(c)) return 'exportacao';
    if (ATIVO.test(c)) return 'outras';
    const d = descricaoCfop(c);
    if (!d) return 'desconhecido';
    const venda = /^(Venda|Prestação de serviço|Industrialização efetuada para outra empresa)/i.test(d);
    if (!venda) return 'outras';
    return c.startsWith('7') ? 'exportacao' : 'venda';
}

/** Confere o cadastro {venda, exportacao, outras, sobreporXml} antes de gravar. */
export function conferirCadastroCst(cadastro) {
    const erros = [];
    const limpo = { sobreporXml: cadastro?.sobreporXml === true };
    for (const tipo of Object.keys(TIPOS_DE_SAIDA)) {
        const v = cst2(cadastro?.[tipo]);
        if (!v) continue;
        if (!CST_SAIDA[v]) { erros.push(`${TIPOS_DE_SAIDA[tipo].rotulo}: CST ${v} não é de saída (tabela 4.3.3: 01–09 e 49).`); continue; }
        limpo[tipo] = v;
    }
    if (limpo.sobreporXml && !Object.keys(TIPOS_DE_SAIDA).some((t) => limpo[t])) {
        erros.push('"Sobrepor o CST do XML" só faz sentido com pelo menos um CST cadastrado.');
    }
    return { ok: erros.length === 0, erros, cadastro: limpo };
}

const cstDoItem = (item, campos) => {
    for (const k of campos) if (item?.[k] != null && String(item[k]).trim() !== '') return cst2(item[k]);
    return '';
};

/**
 * Aplica o cadastro aos itens de SAÍDA. Muta os itens (é o passo antes dos
 * blocos C/M) e devolve a contagem do que fez — para o aviso.
 *
 * @param {Array} notas
 * @param {object} cadastro  {venda?, exportacao?, outras?, sobreporXml?}
 * @param {{direcaoDoDoc: (nota) => string, docFora?: (nota) => boolean}} p
 */
export function aplicarCstPadraoNasSaidas(notas, cadastro, { direcaoDoDoc, docFora } = {}) {
    const cad = conferirCadastroCst(cadastro || {}).cadastro;
    const novo = () => ({ itens: 0, cfops: new Set() });
    const r = {
        aplicados: { venda: novo(), exportacao: novo(), outras: novo() },
        sobrepostos: { venda: novo(), exportacao: novo(), outras: novo() },
        semCadastro: { venda: novo(), exportacao: novo(), outras: novo(), desconhecido: novo() },
        mantidosDoXml: 0,
        temCadastro: Object.keys(TIPOS_DE_SAIDA).some((t) => cad[t]),
    };
    for (const nota of (notas || [])) {
        if (!nota || (docFora && docFora(nota))) continue;
        if (direcaoDoDoc(nota) !== 'saida') continue;
        for (const item of (nota.itens || [])) {
            const cfop = so(item?.cfop || item?.CFOP).slice(0, 4);
            const tipo = tipoDaSaidaPeloCfop(cfop);
            const doXml = cstDoItem(item, ['cstPis', 'CSTPis', 'CSTPIS']) || cstDoItem(item, ['cstCofins', 'CSTCofins', 'CSTCOFINS']);
            const padrao = tipo === 'desconhecido' ? '' : (cad[tipo] || '');
            if (doXml && !cad.sobreporXml) { r.mantidosDoXml += 1; continue; }
            if (!padrao) {
                if (!doXml) { r.semCadastro[tipo].itens += 1; if (cfop) r.semCadastro[tipo].cfops.add(cfop); }
                else r.mantidosDoXml += 1;
                continue;
            }
            const balde = doXml && doXml !== padrao ? r.sobrepostos[tipo] : r.aplicados[tipo];
            if (doXml && doXml === padrao) { r.mantidosDoXml += 1; continue; }
            item.cstPis = padrao;
            item.cstCofins = padrao;
            item._cstOrigem = doXml ? `cadastro-${tipo}-sobrepos-${doXml}` : `cadastro-${tipo}`;
            balde.itens += 1;
            if (cfop) balde.cfops.add(cfop);
        }
    }
    return r;
}

const lista = (set) => [...set].sort().slice(0, 8).join(', ') + (set.size > 8 ? ` e mais ${set.size - 8}` : '');

/** Os avisos que vão no arquivo — só o que aconteceu, com CFOP e contagem. */
export function avisosDoCstPadrao(r) {
    const out = [];
    if (!r) return out;
    for (const tipo of Object.keys(TIPOS_DE_SAIDA)) {
        const a = r.aplicados[tipo];
        if (a.itens) out.push(`CST PIS/COFINS do cadastro (${TIPOS_DE_SAIDA[tipo].rotulo}): ${a.itens} item(ns) sem CST no XML saíram com o CST cadastrado — CFOP ${lista(a.cfops)}.`);
        const s = r.sobrepostos[tipo];
        if (s.itens) out.push(`⚠️ CST do XML SOBREPOSTO pelo cadastro (${TIPOS_DE_SAIDA[tipo].rotulo}): ${s.itens} item(ns) — CFOP ${lista(s.cfops)}. A opção "sobrepor" está ligada nesta empresa; o C170 sai diferente do que o emissor declarou.`);
    }
    for (const tipo of ['outras', 'exportacao', 'venda']) {
        const f = r.semCadastro[tipo];
        if (f.itens) {
            out.push(`${f.itens} item(ns) de saída sem CST no XML (${TIPOS_DE_SAIDA[tipo].rotulo}, CFOP ${lista(f.cfops)}) caíram no padrão 01 (tributada). `
                + `Cadastre o CST desse tipo em SPED Fiscal → SPED Contribuições → "CST padrão de PIS/COFINS na saída"${TIPOS_DE_SAIDA[tipo].sugestao ? ` (sugestão: ${TIPOS_DE_SAIDA[tipo].sugestao})` : ''}.`);
        }
    }
    if (r.semCadastro.desconhecido.itens) {
        out.push(`${r.semCadastro.desconhecido.itens} item(ns) de saída sem CST no XML e com CFOP que a tabela não reconhece (${lista(r.semCadastro.desconhecido.cfops) || 'vazio'}) caíram no padrão 01 — confira o CFOP do item.`);
    }
    return out;
}
