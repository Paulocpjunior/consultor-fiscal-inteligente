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
// ============================================================================

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

const num2 = (n) => (typeof n === 'number' ? n : parseFloat(String(n) || '0'))
    .toFixed(2);

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
    if (!(servico?.valor > 0)) throw new Error('servico.valor obrigatorio (>0)');

    const ibgePrestador = String(servico.municipioPrestacao || prestador.municipioIbge || '3550308').replace(/\D/g, '').padStart(7, '0').slice(-7);
    const cnpjEmit = String(prestador.cnpj).replace(/\D/g, '').padStart(14, '0').slice(-14);
    const serie = req.serie || 1;
    const numero = sequencial || Math.floor(Date.now() / 1000) % 1_000_000_000;
    const dhEmi = dataEmissao || new Date().toISOString();
    // tpAmb: 1 = producao, 2 = homologacao (mesma convencao NFe)
    const tpAmb = ambiente === 'producao' ? '1' : '2';

    const idDps = gerarIdDps({
        ibgeMunicipio: ibgePrestador,
        tipoInscricao: 'CNPJ',
        inscricao: cnpjEmit,
        serie,
        numero,
    });

    const aliquotaIss = servico.aliquotaIss ?? 5;
    const valorBruto = +Number(servico.valor).toFixed(2);
    const issValor = +(valorBruto * (aliquotaIss / 100)).toFixed(2);

    // tomador: ou CNPJ ou CPF (exclusivo)
    const tomadorCnpj = tomador.cnpj ? String(tomador.cnpj).replace(/\D/g, '').padStart(14, '0').slice(-14) : null;
    const tomadorCpf = !tomadorCnpj && tomador.cpf ? String(tomador.cpf).replace(/\D/g, '').padStart(11, '0').slice(-11) : null;
    const tomadorBlock = tomadorCnpj
        ? `<CNPJ>${tomadorCnpj}</CNPJ>`
        : tomadorCpf
            ? `<CPF>${tomadorCpf}</CPF>`
            : '<NIFNaoInformado/>'; // fallback — manual permite NIF estrangeiro / nao informado

    // Endereco tomador (opcional)
    const enderecoBlock = tomador.endereco ? `
      <end>
        <xLgr>${esc(tomador.endereco.logradouro || '')}</xLgr>
        <nro>${esc(tomador.endereco.numero || 'S/N')}</nro>
        ${tomador.endereco.complemento ? `<xCpl>${esc(tomador.endereco.complemento)}</xCpl>` : ''}
        <xBairro>${esc(tomador.endereco.bairro || '')}</xBairro>
        <cMun>${esc(String(tomador.endereco.codigoMunicipioIbge || ibgePrestador).padStart(7, '0').slice(-7))}</cMun>
        <UF>${esc(tomador.endereco.uf || 'SP')}</UF>
        <CEP>${esc(String(tomador.endereco.cep || '').replace(/\D/g, ''))}</CEP>
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
        <cTribMun>${esc(servico.cTribMun || '')}</cTribMun>
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
