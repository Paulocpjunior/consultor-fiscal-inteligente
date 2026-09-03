// ============================================================================
// nfse-nacional-dps-builder.js
//
// Gera o XML DPS (Declaracao de Prestacao de Servico) — documento que vai
// assinado pro Emissor Nacional NFS-e (https://sefin.nfse.gov.br/SefinNacional).
//
// Modulo PURO (sem cert, sem io, sem firebase) — testavel em jest.
//
// Base regulatoria: Resolucao CGSN 189/2026 — vigencia 1° set 2026.
// Manual referencia: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica
//                    manual-contribuintes-emissor-publico-api-v1.2 (out/2025)
//
// IMPORTANTE — limites do que da pra fazer SEM o XSD na mao:
//   O PDF oficial bloqueia download sem cert. A estrutura aqui foi montada
//   conforme convencoes do padrao SPED Fiscal (NFe/CTe usam mesma familia)
//   + os campos que o MockProvider ja valida + o que o frontend coleta.
//   PRIMEIRA validacao real contra producao restrita PODE retornar erro de
//   schema — quando isso acontecer, o XML rejeitado + msg do SEFIN permite
//   ajustar 1-2 campos. Isso e normal em integracao nova; nao tem como
//   adivinhar 100% sem o XSD.
//
// Estrutura ID DPS (Manual Anexo I):
//   IBGE municipio emit (7) + tipoInscricao (1) + CNPJ/CPF zero-pad (14) +
//   serie (5) + numero (15) = 42 chars
//
// ═══ O QUE A AUDITORIA DE 03/09 TIROU DAQUI, e por quê ═══════════════════════
//   · `dhEmi = new Date().toISOString()` → UTC com `Z` e milissegundos: o XSD
//     do ADN quer `AAAA-MM-DDThh:mm:ss-03:00`, e uma nota emitida em 31/08 às
//     22h em Brasília nascia com `dCompet` 01/09 — o mês ERRADO, no XML que a
//     Receita processa. A hora é de BRASÍLIA, pelo dono (`dataHoraBrasilia`).
//   · `nDPS = Date.now()/1000 % 1e9` → número que NÃO é sequencial e se
//     REPETE em duas emissões no mesmo segundo. O nDPS é chave da DPS
//     (compõe o Id): sem `sequencial` a emissão é RECUSADA nomeada — quem sabe
//     o último número é quem guarda as emitidas (o orquestrador), nunca o
//     relógio.
//   · `aliquotaIss ?? 5` → alíquota é DECLARAÇÃO do prestador; 5% "de
//     conveniência" é o app afirmando o ISS de um serviço que pode ser de 2%.
//     Ausente é recusa.
//   · `parseFloat(String(n))` → "1.234,56" virava 1 e ilegível virava "NaN"
//     dentro do XML. Valor passa por `dinheiroDeEntrada` (o dono).
//   · `<cTribMun></cTribMun>`, `<xLgr></xLgr>`, `<xBairro></xBairro>`,
//     `<CEP></CEP>` VAZIOS quando o dado não veio → o XSD recusa elemento
//     vazio; opcional ausente NÃO se emite (como o `<IM>` já fazia).
// ============================================================================

import { dinheiroDeEntrada } from './das-valor-utils.js';
import { dataHoraBrasilia } from './competencia.js';

/**
 * Gera o ID DPS de 42 caracteres exigido pelo Emissor Nacional.
 *
 * @param {object} args
 * @param {string} args.ibgeMunicipio - codigo IBGE do municipio do emitente (7 digitos)
 * @param {'CNPJ'|'CPF'} args.tipoInscricao - tipo da inscricao do emitente
 * @param {string} args.inscricao - CNPJ (14) ou CPF (11) — sera zero-padded a 14
 * @param {number|string} args.serie - serie DPS (1-99999)
 * @param {number|string} args.numero - numero sequencial (1-999999999999999)
 * @returns {string} ID de 42 chars, ex: "DPS3550308212345678000199000010000000000001"
 *                   (na verdade so digitos — sem prefixo "DPS"; mas usamos prefixo
 *                   "DPS" no Id do XML pra ser referenciado pela assinatura)
 */
export function gerarIdDps({ ibgeMunicipio, tipoInscricao, inscricao, serie, numero }) {
    const ibgeRaw = String(ibgeMunicipio || '').replace(/\D/g, '');
    if (!ibgeRaw) throw new Error(`ibgeMunicipio inválido: ${ibgeMunicipio}`);
    const ibge = ibgeRaw.padStart(7, '0').slice(0, 7);

    const tpInsc = tipoInscricao === 'CPF' ? '1' : '2'; // 1=CPF, 2=CNPJ (convencao SPED)
    const inscRaw = String(inscricao || '').replace(/\D/g, '');
    if (!inscRaw) throw new Error(`Inscricao inválida: ${inscricao}`);
    const insc = inscRaw.padStart(14, '0').slice(-14);

    const ser = String(serie || '1').replace(/\D/g, '').padStart(5, '0').slice(-5);
    const num = String(numero || '1').replace(/\D/g, '').padStart(15, '0').slice(-15);

    return `${ibge}${tpInsc}${insc}${ser}${num}`;
}

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// Formata um número JÁ VALIDADO (2 casas, ponto decimal — a forma do XSD).
// Quem lê texto de dinheiro é `dinheiroDeEntrada`; aqui nunca chega NaN.
const num2 = (n) => n.toFixed(2);

// `AAAA-MM-DDThh:mm:ss±hh:mm` — a forma que o XSD do ADN aceita (sem `Z`,
// sem milissegundos).
const RE_DHEMI_ADN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

/**
 * O `dhEmi` que vai no XML. Ausente ⇒ AGORA em Brasília. Já na forma do ADN
 * ⇒ como veio (o instante declarado é o do texto — converter reescreveria a
 * data que o emitente afirmou). Outro instante legível (ISO com `Z`, Date)
 * ⇒ o MESMO instante escrito em Brasília. Ilegível ⇒ recusa nomeada.
 */
export function dhEmiParaDps(dataEmissao) {
    if (dataEmissao === undefined || dataEmissao === null || dataEmissao === '') {
        return dataHoraBrasilia(new Date());
    }
    if (typeof dataEmissao === 'string' && RE_DHEMI_ADN.test(dataEmissao)) return dataEmissao;
    const convertido = dataHoraBrasilia(dataEmissao);
    if (!convertido) {
        throw new Error(`dataEmissao ilegível (${JSON.stringify(dataEmissao)}) — use AAAA-MM-DDThh:mm:ss-03:00. `
            + 'Data chutada é NFS-e na competência errada.');
    }
    return convertido;
}

/**
 * O PRÓXIMO nDPS da série, a partir das DPS já emitidas (o orquestrador lê a
 * coleção e passa os documentos; este módulo só decide o número). Lê o
 * `nDps` gravado e, nos documentos antigos que não o têm, o número que está
 * DENTRO do `idDps` (posições 27-42, com a série nas 22-27). Sem nenhuma
 * emitida na série ⇒ 1.
 *
 * ⚠️ É um máximo+1 sobre o que já foi GRAVADO — duas emissões simultâneas da
 * mesma empresa podem pedir o mesmo número; a segunda o ADN recusa por
 * duplicidade (o que é recusa, não nota errada). Numeração atômica é
 * decisão de desenho do dono.
 */
export function proximoSequencialDps(emitidas, serie = 1) {
    const serieAlvo = String(serie || 1).replace(/\D/g, '').padStart(5, '0').slice(-5);
    let maior = 0;
    for (const d of Array.isArray(emitidas) ? emitidas : []) {
        let n = null;
        if (d && d.nDps !== undefined && d.nDps !== null && d.nDps !== '') {
            const serieDoc = String(d.serieDps ?? d.serie ?? 1).replace(/\D/g, '').padStart(5, '0').slice(-5);
            if (serieDoc !== serieAlvo) continue;
            n = Number(String(d.nDps).replace(/\D/g, ''));
        } else if (d && typeof d.idDps === 'string' && /^\d{42}$/.test(d.idDps)) {
            if (d.idDps.slice(22, 27) !== serieAlvo) continue;
            n = Number(d.idDps.slice(27, 42));
        }
        if (Number.isFinite(n) && n > maior) maior = n;
    }
    return maior + 1;
}

/**
 * Constroi o XML DPS completo (sem assinatura — assinatura e feita por
 * nfse-nacional-dps-signer.js apos esta etapa).
 *
 * @param {object} req payload do EmitirNfseRequest (mesmo shape do MockProvider)
 * @returns {{ xml: string, idDps: string }}
 */
export function buildDpsXml(req) {
    const { prestador, tomador, servico, dataEmissao, sequencial, ambiente } = req;
    if (!prestador?.cnpj) throw new Error('prestador.cnpj obrigatorio');
    if (!tomador?.nome) throw new Error('tomador.nome obrigatorio');
    if (!servico?.descricao) throw new Error('servico.descricao obrigatorio');
    const valorBruto = dinheiroDeEntrada(servico?.valor);
    if (valorBruto === null || valorBruto <= 0) {
        throw new Error(`servico.valor obrigatorio (>0) — recebido ${JSON.stringify(servico?.valor)}; use 1234,56 ou 1234.56`);
    }
    if (servico?.aliquotaIss === undefined || servico?.aliquotaIss === null || servico?.aliquotaIss === '') {
        throw new Error('servico.aliquotaIss obrigatorio — a alíquota do ISS é declaração do prestador, o app não a chuta (5% "de conveniência" é ISS afirmado errado)');
    }
    const aliquotaIss = dinheiroDeEntrada(servico.aliquotaIss);
    if (aliquotaIss === null) {
        throw new Error(`servico.aliquotaIss ilegível (${JSON.stringify(servico.aliquotaIss)}) — use 5 ou 2,5`);
    }
    // 🚨 O nDPS é CHAVE da DPS (compõe o Id de 42 posições). Derivá-lo do
    // relógio produzia número não sequencial e REPETIDO no mesmo segundo.
    const numeroSeq = Number(sequencial);
    if (!Number.isInteger(numeroSeq) || numeroSeq < 1 || numeroSeq > 999_999_999_999_999) {
        throw new Error(`sequencial (nDPS) obrigatorio — inteiro de 1 a 999999999999999, recebido ${JSON.stringify(sequencial)}. `
            + 'Quem sabe o próximo número é quem guarda as DPS emitidas (proximoSequencialDps), nunca o relógio.');
    }

    const ibgePrestador = String(servico.municipioPrestacao || prestador.municipioIbge || '3550308').replace(/\D/g, '').padStart(7, '0').slice(-7);
    const cnpjEmit = String(prestador.cnpj).replace(/\D/g, '').padStart(14, '0').slice(-14);
    const serie = req.serie || 1;
    const numero = numeroSeq;
    const dhEmi = dhEmiParaDps(dataEmissao);
    // tpAmb: 1 = producao, 2 = homologacao (mesma convencao NFe)
    const tpAmb = ambiente === 'producao' ? '1' : '2';

    const idDps = gerarIdDps({
        ibgeMunicipio: ibgePrestador,
        tipoInscricao: 'CNPJ',
        inscricao: cnpjEmit,
        serie,
        numero,
    });

    const issValor = +(valorBruto * (aliquotaIss / 100)).toFixed(2);

    // tomador: ou CNPJ ou CPF (exclusivo)
    const tomadorCnpj = tomador.cnpj ? String(tomador.cnpj).replace(/\D/g, '').padStart(14, '0').slice(-14) : null;
    const tomadorCpf = !tomadorCnpj && tomador.cpf ? String(tomador.cpf).replace(/\D/g, '').padStart(11, '0').slice(-11) : null;
    const tomadorBlock = tomadorCnpj
        ? `<CNPJ>${tomadorCnpj}</CNPJ>`
        : tomadorCpf
            ? `<CPF>${tomadorCpf}</CPF>`
            : '<NIFNaoInformado/>'; // fallback — manual permite NIF estrangeiro / nao informado

    // Elemento OPCIONAL: ausente não se emite — `<x></x>` vazio é o que o XSD
    // recusa (e o que fazia o `<IM>` já ser condicional).
    const opcional = (tag, valor) => {
        const v = String(valor ?? '').trim();
        return v ? `<${tag}>${esc(v)}</${tag}>` : '';
    };

    // Endereco tomador (opcional)
    const cepLimpo = tomador.endereco ? String(tomador.endereco.cep || '').replace(/\D/g, '') : '';
    const enderecoBlock = tomador.endereco ? `
      <end>
        ${opcional('xLgr', tomador.endereco.logradouro)}
        <nro>${esc(tomador.endereco.numero || 'S/N')}</nro>
        ${opcional('xCpl', tomador.endereco.complemento)}
        ${opcional('xBairro', tomador.endereco.bairro)}
        <cMun>${esc(String(tomador.endereco.codigoMunicipioIbge || ibgePrestador).padStart(7, '0').slice(-7))}</cMun>
        <UF>${esc(tomador.endereco.uf || 'SP')}</UF>
        ${opcional('CEP', cepLimpo)}
        <cPais>1058</cPais><xPais>BRASIL</xPais>
      </end>` : '';

    // Servico — cTribNac eh codigo da lista de servicos LC 116, cClassTrib eh
    // a classificacao da NFS-e Nacional (Anexo VIII RFB). Defaults conservadores
    // que o frontend ja avisa pro usuario revisar (vide EmitirModal.tsx).
    const cTribNac = esc(servico.codigoNbs || '101010100');
    const cIndOp = esc(servico.cIndOp || '050201');
    const cClassTrib = esc(servico.cClassTrib || '00000000');

    // Namespace do schema NFS-e Nacional v1.00
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infDPS Id="DPS${idDps}">
    <tpAmb>${tpAmb}</tpAmb>
    <dhEmi>${esc(dhEmi)}</dhEmi>
    <verAplic>cfi-1.0</verAplic>
    <serie>${esc(String(serie))}</serie>
    <nDPS>${esc(String(numero))}</nDPS>
    <dCompet>${esc((dhEmi || '').slice(0, 10))}</dCompet>
    <tpEmit>1</tpEmit>
    <cLocEmi>${ibgePrestador}</cLocEmi>
    <emit>
      <CNPJ>${cnpjEmit}</CNPJ>
      ${prestador.im ? `<IM>${esc(prestador.im)}</IM>` : ''}
      <xNome>${esc(prestador.nome || '')}</xNome>
      <regTrib>
        <opSimpNac>1</opSimpNac>
        <regApTribSN>${esc(String(prestador.regApTribSN ?? '1'))}</regApTribSN>
        <regEspTrib>0</regEspTrib>
      </regTrib>
    </emit>
    <toma>
      ${tomadorBlock}
      <xNome>${esc(tomador.nome)}</xNome>
      ${enderecoBlock}
    </toma>
    <serv>
      <locPrest><cLocPrestacao>${ibgePrestador}</cLocPrestacao></locPrest>
      <cServ>
        <cTribNac>${cTribNac}</cTribNac>
        ${opcional('cTribMun', servico.cTribMun)}
        <xDescServ>${esc(servico.descricao)}</xDescServ>
        <cNBS>${cTribNac}</cNBS>
        <cIntContrib>${esc(servico.cIntContrib || numero)}</cIntContrib>
      </cServ>
      <comExt>0</comExt>
    </serv>
    <valores>
      <vServPrest>
        <vReceb>0.00</vReceb>
        <vServ>${num2(valorBruto)}</vServ>
      </vServPrest>
      <trib>
        <tribMun>
          <tribISSQN>1</tribISSQN>
          <cLocIncid>${ibgePrestador}</cLocIncid>
          <pAliq>${num2(aliquotaIss)}</pAliq>
          <tpRetISSQN>${servico.issRetido ? '1' : '2'}</tpRetISSQN>
          <vBC>${num2(valorBruto)}</vBC>
          <vISSQN>${num2(issValor)}</vISSQN>
        </tribMun>
        <totTrib>
          <indTotTrib>1</indTotTrib>
          <vTotTrib>${num2(issValor)}</vTotTrib>
        </totTrib>
      </trib>
    </valores>
    <indOp>${cIndOp}</indOp>
    <cClassTrib>${cClassTrib}</cClassTrib>
  </infDPS>
</DPS>`;

    return { xml, idDps };
}
