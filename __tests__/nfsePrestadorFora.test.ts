// ============================================================================
// 🚨 O PRIMEIRO BLOCO QUE **EXISTE** NÃO É O PRIMEIRO QUE **TEM O DOCUMENTO**
//
// 02/09, Ivan Inacio (0530), notas de serviço PRESTADO recusadas com
// `emit: -`. O XML real (ABRASF v2 com o bloco IBS/CBS da reforma) foi MEDIDO
// e a estrutura dele é esta fixture:
//
//   InfNfse › PrestadorServico            ← EXISTE, e tem só RazaoSocial/Endereco
//   InfNfse › DeclaracaoPrestacaoServico
//             › InfDeclaracaoPrestacaoServico
//               › Prestador › CpfCnpj › Cnpj   ← é AQUI que mora o documento
//
// O leitor achava `PrestadorServico`, parava ali, e o emitente saía VAZIO — a
// recusa dizia "não consta como emitente" sobre a própria prestadora.
//
// ⚠️ O TOMADOR ESCAPOU POR ACIDENTE (o bloco dele tem `IdentificacaoTomador`):
// era a mesma armadilha esperando a próxima prefeitura que aninhasse
// diferente. Por isso os dois passaram pela mesma régua.
//
// 🔒 Nenhum dado do cliente entra no repositório: a fixture reproduz a
// ESTRUTURA medida, com CNPJs de teste.
// ============================================================================
import { parseNFeXml, matchCompanyAndDirection } from '../services/xmlParserService';

const PRESTADOR = '11111111000191';
const TOMADOR = '22222222000172';

const NFSE_ABRASF_V2 = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse><Nfse><InfNfse>
  <Numero>318</Numero>
  <DataEmissao>2026-08-14T10:00:00</DataEmissao>
  <ValoresNfse><BaseCalculo>6400.00</BaseCalculo><ValorIss>0.00</ValorIss>
    <ValorLiquidoNfse>6400.00</ValorLiquidoNfse></ValoresNfse>
  <PrestadorServico>
    <RazaoSocial>PRESTADORA TESTE LTDA</RazaoSocial>
    <Endereco><Endereco>RUA X</Endereco><Uf>SP</Uf><CodigoMunicipio>3550308</CodigoMunicipio></Endereco>
    <Contato><Telefone>1130000000</Telefone></Contato>
  </PrestadorServico>
  <DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico>
    <Competencia>2026-08-14</Competencia>
    <Servico><Valores><ValorServicos>6400.00</ValorServicos></Valores>
      <ItemListaServico>17.02</ItemListaServico>
      <Discriminacao>APOIO ADMINISTRATIVO</Discriminacao></Servico>
    <Prestador><CpfCnpj><Cnpj>${PRESTADOR}</Cnpj></CpfCnpj>
      <InscricaoMunicipal>12345</InscricaoMunicipal></Prestador>
    <TomadorServico><IdentificacaoTomador><CpfCnpj><Cnpj>${TOMADOR}</Cnpj></CpfCnpj></IdentificacaoTomador>
      <RazaoSocial>TOMADORA TESTE LTDA</RazaoSocial></TomadorServico>
  </InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico>
</InfNfse></Nfse></CompNfse>`;

describe('NFS-e ABRASF v2 — o documento fora do bloco que tem o nome', () => {
    const p = parseNFeXml(NFSE_ABRASF_V2);

    it('lê o CNPJ do prestador mesmo ele estando em OUTRO bloco', () => {
        expect(p.emitente.cnpjCpf).toBe(PRESTADOR);
    });

    // ⚠️ O nome continua vindo do bloco que TEM o nome — perder a razão social
    // ao consertar o CNPJ seria trocar um buraco por dois.
    it('o nome e o endereço continuam vindo de PrestadorServico', () => {
        expect(p.emitente.nome).toBe('PRESTADORA TESTE LTDA');
        expect(p.emitente.uf).toBe('SP');
    });

    it('o tomador continua sendo lido', () => {
        expect(p.destinatario.cnpjCpf).toBe(TOMADOR);
    });

    // 🚨 O desfecho que importa: a nota da prestadora entra como SAÍDA.
    it('a nota de serviço PRESTADO é aceita e vira saída', () => {
        expect(matchCompanyAndDirection(p, PRESTADOR)).toEqual({ ok: true, direcao: 'saida' });
    });

    it('e a mesma nota, do lado do tomador, é entrada', () => {
        expect(matchCompanyAndDirection(p, TOMADOR)).toEqual({ ok: true, direcao: 'entrada' });
    });

    // ⚠️ Nota sem cancelamento declarado continua VIGENTE — a régua nova do
    // cancelamento não pode carimbar nota boa (isso apagaria receita).
    it('nota sem cancelamento declarado segue autorizada', () => {
        expect(p.status).toBe('autorizado');
    });
});
