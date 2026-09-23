// ============================================================================
// 🚨 A NFS-e DO PADRÃO NACIONAL NÃO IMPORTAVA — e a TELA dizia que ia.
//
// 01/09, Paulo (4BZ CONSULTORIA, `27_LIFECHEMM_16.xml`): *"o mesmo reconhece o
// arquivo como da empresa, mas não tá importando. Essa particularidade
// acontece principalmente nas empresas que são do município de fora de SP."*
//
// Dois leiautes com o mesmo nome: o ABRASF usa `<InfNfse>` e o NACIONAL usa
// `<infNFSe>` — e `getElementsByTagName` é CASE-SENSITIVE. O arquivo era
// recusado como "não é nota fiscal" DEPOIS de a tela ter dito "1 desta
// empresa · 1 de saída" (ela lê o `<emit>`, que o leiaute nacional tem).
//
// ⚠️ A FIXTURE NÃO É INVENTADA: ela sai do `nfse-nacional-dps-builder.js`
// deste repo — o módulo que EMITE DPS do padrão nacional. Fixture que não é a
// forma real é teste verde sobre defeito vivo (a lição do art. 136, 22/08).
// ============================================================================
import { ehNfseNacional, lerNfseNacional } from '../sefaz-backend/nfse-nacional-leitura.js';
import { parseNFeXml, XmlParseError } from '../services/xmlParserService';

/** NFS-e nacional autorizada: `<infNFSe>` com `<emit>` + o `<DPS>` embutido. */
const NFSE_NACIONAL = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infNFSe Id="NFS35250107901372000138000000000000000000000000000016">
    <nNFSe>16</nNFSe>
    <cLocIncid>3550308</cLocIncid>
    <dhProc>2026-08-14T10:32:00-03:00</dhProc>
    <emit>
      <CNPJ>32169188000192</CNPJ>
      <IM>123456</IM>
      <xNome>4BZ CONSULTORIA DE NEGOCIOS LTDA</xNome>
      <enderNac><xLgr>RUA TESTE</xLgr><nro>100</nro><xBairro>CENTRO</xBairro><cMun>3550308</cMun><UF>SP</UF><CEP>01000000</CEP></enderNac>
    </emit>
    <valores><vLiq>4500.00</vLiq></valores>
    <DPS>
      <infDPS Id="DPS3550308232169188000192000000000016">
        <dhEmi>2026-08-14T10:00:00-03:00</dhEmi>
        <serie>1</serie>
        <nDPS>16</nDPS>
        <dCompet>2026-08-01</dCompet>
        <emit><CNPJ>32169188000192</CNPJ><IM>123456</IM><xNome>4BZ CONSULTORIA DE NEGOCIOS LTDA</xNome></emit>
        <toma>
          <CNPJ>11222333000181</CNPJ>
          <xNome>LIFECHEMM INDUSTRIA LTDA</xNome>
          <end><xLgr>AV EXEMPLO</xLgr><nro>50</nro><xBairro>JARDIM</xBairro><cMun>3509502</cMun><UF>SP</UF><CEP>13000000</CEP></end>
        </toma>
        <serv>
          <locPrest><cLocPrestacao>3550308</cLocPrestacao></locPrest>
          <cServ><cTribNac>170201</cTribNac><xDescServ>Consultoria empresarial</xDescServ></cServ>
        </serv>
        <valores>
          <vServPrest><vReceb>0.00</vReceb><vServ>5000.00</vServ></vServPrest>
          <trib>
            <tribMun>
              <tribISSQN>1</tribISSQN>
              <cLocIncid>3550308</cLocIncid>
              <pAliq>5.00</pAliq>
              <tpRetISSQN>2</tpRetISSQN>
              <vBC>5000.00</vBC>
              <vISSQN>250.00</vISSQN>
            </tribMun>
          </trib>
        </valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

const EVENTO_NACIONAL = `<?xml version="1.0" encoding="UTF-8"?>
<pedRegEvento versao="1.00"><infPedReg Id="PRE123">
  <chNFSe>35250107901372000138000000000000000000000000000016</chNFSe>
  <tpEvento>101101</tpEvento>
</infPedReg></pedRegEvento>`;

describe('🚨 leitura da NFS-e do padrão NACIONAL', () => {
    it('reconhece o leiaute nacional pelo <infNFSe>', () => {
        expect(ehNfseNacional(NFSE_NACIONAL)).toBe(true);
    });

    it('EVENTO não é nota — importá-lo criaria documento fantasma', () => {
        expect(ehNfseNacional(EVENTO_NACIONAL)).toBe(false);
    });

    it('não confunde com o ABRASF (que tem <InfNfse>, não <infNFSe>)', () => {
        expect(ehNfseNacional('<CompNfse><Nfse><InfNfse><Numero>1</Numero></InfNfse></Nfse></CompNfse>')).toBe(false);
    });

    it('lê prestador, tomador e valores do leiaute que o repo EMITE', () => {
        const r = lerNfseNacional(NFSE_NACIONAL);
        expect(r.numero).toBe('16');
        expect(r.prestador?.cnpjCpf).toBe('32169188000192');
        expect(r.prestador?.nome).toBe('4BZ CONSULTORIA DE NEGOCIOS LTDA');
        expect(r.valores.servico).toBe(5000);
        expect(r.valores.iss).toBe(250);
        expect(r.valores.aliquotaIss).toBe(5);
        expect(r.valores.baseCalculo).toBe(5000);
        expect(r.competencia).toBe('2026-08-01');
    });

    // 🚨 O DEFEITO QUE ESTAVA VIVO NA CAPTURA DO ADN: o regex do importer
    // pedia `<tomad...`, e a tag é `<toma>` — o tomador saía VAZIO em toda
    // NFS-e nacional. Só não doeu porque o trilho nunca trouxe documento.
    it('lê o TOMADOR em <toma> — "tomad" nunca casou com "toma"', () => {
        const r = lerNfseNacional(NFSE_NACIONAL);
        expect(r.tomador?.cnpjCpf).toBe('11222333000181');
        expect(r.tomador?.nome).toBe('LIFECHEMM INDUSTRIA LTDA');
    });

    it('a chave sai do Id do infNFSe, sem o prefixo NFS', () => {
        expect(lerNfseNacional(NFSE_NACIONAL).chave)
            .toBe('35250107901372000138000000000000000000000000000016');
    });

    // ⚠️ Valor ausente é NULL, nunca zero: zero num campo de valor é a
    // afirmação de que a nota não vale nada (regra de 06/08).
    it('valor ausente vira null e sai NOMEADO, nunca zero', () => {
        const semValor = NFSE_NACIONAL.replace(/<vServ>[\d.]+<\/vServ>/, '');
        const r = lerNfseNacional(semValor);
        expect(r.valores.servico).toBeNull();
        expect(r.lacunas.join(' ')).toMatch(/vServ/);
    });

    // 🚩 As retenções federais NÃO são lidas — e isso é DECISÃO declarada, não
    // esquecimento: o <tribFed> não está provado neste repo, e chutar as tags
    // produziria zero com cara de "não houve retenção".
    it('declara que não leu as retenções federais', () => {
        const r = lerNfseNacional(NFSE_NACIONAL);
        expect(r.valores.retencoesFederaisGravadas).toBe(false);
        expect(r.lacunas.join(' ')).toMatch(/retenções federais/i);
    });

    it('ISS retido ausente vira null, nunca "a nota disse que não"', () => {
        const semRet = NFSE_NACIONAL.replace(/<tpRetISSQN>\d<\/tpRetISSQN>/, '');
        expect(lerNfseNacional(semRet).valores.issRetido).toBeNull();
        expect(lerNfseNacional(NFSE_NACIONAL).valores.issRetido).toBe(false);
        expect(lerNfseNacional(
            NFSE_NACIONAL.replace('<tpRetISSQN>2<', '<tpRetISSQN>1<'),
        ).valores.issRetido).toBe(true);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// A LIGAÇÃO — sem ela a régua existe e o arquivo continua recusado.
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 a importação manual aceita a NFS-e nacional', () => {
    it('parseNFeXml importa em vez de recusar', () => {
        const p = parseNFeXml(NFSE_NACIONAL);
        expect(p.tipo).toBe('NFSe');
        expect(p.numero).toBe('16');
        expect(p.emitente.cnpjCpf).toBe('32169188000192');
        expect(p.destinatario.cnpjCpf).toBe('11222333000181');
        expect(p.totais.vNF).toBe(5000);
    });

    // 🚨 Provado pela POSITIVA: teste que só afirma "não lançou" passa igual
    // com a ligação desplugada (a lição do conferirBloco9, 29/08).
    it('a mensagem antiga de recusa não aparece mais', () => {
        let erro = '';
        try { parseNFeXml(NFSE_NACIONAL); } catch (e) { erro = String(e); }
        expect(erro).not.toMatch(/não é uma NFe\/NFCe\/CTe\/NFSe válida/);
    });

    // ⚠️ Nota sem valor NÃO entra valendo zero — ela é RECUSADA com a tag
    // nomeada, porque valor errado no livro nenhum validador denuncia.
    it('recusa (com a tag na mensagem) em vez de importar R$ 0,00', () => {
        const semValor = NFSE_NACIONAL.replace(/<vServ>[\d.]+<\/vServ>/, '');
        expect(() => parseNFeXml(semValor)).toThrow(XmlParseError);
        try { parseNFeXml(semValor); } catch (e) {
            expect(String(e)).toMatch(/vServ/);
            expect(String(e)).toMatch(/0,00/);
        }
    });

    it('o ABRASF continua importando — nada regrediu', () => {
        const abrasf = `<CompNfse><Nfse><InfNfse><Numero>7</Numero>
            <Servico><Valores><ValorServicos>1000.00</ValorServicos></Valores></Servico>
            <PrestadorServico><IdentificacaoPrestador><Cnpj>07901372000138</Cnpj></IdentificacaoPrestador>
              <RazaoSocial>PRESTADOR X</RazaoSocial></PrestadorServico>
            <TomadorServico><IdentificacaoTomador><CpfCnpj><Cnpj>11222333000181</Cnpj></CpfCnpj></IdentificacaoTomador>
              <RazaoSocial>TOMADOR Y</RazaoSocial></TomadorServico>
        </InfNfse></Nfse></CompNfse>`;
        const p = parseNFeXml(abrasf);
        expect(p.tipo).toBe('NFSe');
        expect(p.emitente.cnpjCpf).toBe('07901372000138');
        expect(p.totais.vNF).toBe(1000);
    });
});
