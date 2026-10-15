/**
 * 🧾 NF-e DE SERVIÇOS DE BARUERI no importador de PDF (15/10).
 *
 * Paulo, CHRISTIAN FAMILY (tomadora): o PDF da prefeitura de Barueri era
 * recusado com "Documento nao parece ser uma NFSe" — o documento se chama
 * "NOTA FISCAL ELETRÔNICA DE SERVIÇOS - NFE" e o tomador é uma tabela
 * (rótulos primeiro, valores depois). Fixture = o texto que o pdfjs extrai do
 * PDF REAL (nota 0001480, 14/09/2026, REGULATORIO MAIS → CHRISTIAN FAMILY
 * BANK, 7.990,00), na mesma forma do `extractText` do serviço.
 *
 * Fatos cobrados: a porta reconhece Barueri; prestador e tomador saem com o
 * CNPJ certo (é ele que decide a direção); valor, data, número, código e
 * alíquota saem do papel; e o que o papel NÃO traz (competência, base e
 * valor do ISS) fica vazio/zero para a pessoa conferir — nada é calculado.
 */
// pdfjs-dist resolve Worker no topo e quebra o jest — só a função pura é usada.
jest.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    version: '0.0.0',
    getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
}));

import { parseNfseFromText, matchNfseEmpresa, ehNfeBarueri } from '../services/nfsePdfParserService';
import { recorteDaNfsePdf } from '../services/nfsePdfRecorte';
import { conferirValoresDaNfsePdf } from '../services/nfsePdfValores';

const TXT_BARUERI = `PREFEITURA MUNICIPAL DE BARUERI

SECRETARIA DE FINANÇAS
NOTA FISCAL ELETRONICA DE SERVICOS - NFE

A autenticidade desta Nota Fiscal Eletrônica de Serviços
poderá ser confirmada na página da Prefeitura de Barueri
na Internet, no Endereço:
<http://www.barueri.sp.gov.br/nfe>

Data Emissão
 
Hora Emissão

14/09/2026
 
14:29

Código Autenticidade

129R.5896.8421.0221299-Y

NOTA FISCAL ELETRÔNICA DE
SERVICOS E FATURA

Número da Nota

0001480

Série da Nota

Número RPS

0000003445

Série RPS

CTBZ

Data RPS
14/09/2026

Prestador de Serviços
 
REGULATORIO MAIS LTDA

ALAMEDA XINGU , 350 - SALA 02 - Sala 1604
ALPHAVILLE CENTRO INDUSTR E EMPR / ALPHAVILLE
CEP 06455-030 - BARUERI - SP
CNPJ/CPF
 
54.402.122/0001-33
 
Inscrição Municipal
 
4.BI685-4

Telefone
 
e-mail

Nome Tomador de Serviços
 
CPF/CNPJ
Endereço
 
Complemento
CEP
 
Bairro
 
Cidade
 
UF
E-mail
Qtde
 
Descrição do Serviço
 
Código Serviço
 
Alíquota
 
Valor Unitário
 
Valor Total

CHRISTIAN FAMILY BANK S/A
 
38.406.148/0001-01

PAULISTA, 2073
 
SALA 1202 COND HOR
01311-940
 
BELA VISTA
 
Sao Paulo
 
SP

emissoes@contabilizei.com.br
1
 
Licenciamento ou cessão de direito de uso de programas de co
 
010501220
 
2,00
 
7.990,00
 
7.990,00

DISCRIMINAÇÃO DOS SERVIÇOS E INFORMAÇÕES RELEVANTES

Licenciamento do software Regulatorio Mais E-Financeira/jul- 2026 - Conforme Lei 12.741/2012, o perc
entual total de impostos incidentes neste servico prestado e de aproximadamente 13.33%
---------------
Conforme Lei 12.741/2012, o percentual total de impostos incidentes neste servico prestado e de apro
ximadamente 13.33%
Valor liquido da Nota Fiscal = R$ 7.990,00

VALORES DE REPASSE A TERCEIROS

R$ 0,00

Observações

ISSQN devido a: BARUERI-SP

IRRF
 
PIS/PASEP
 
COFINS
 
CSLL

0,00
 
0,00
 
0,00
 
0,00

VALOR TOTAL DA NOTA
 
7.990,00

Fatura Nº
 
Valor da Fatura R$
 
Forma Pagamento

000000
 
AVISTA

Valor por Extenso

A autenticidade desta Nota Fiscal Eletrônica de Serviços poderá ser confirmada
na página da Prefeitura de Barueri na Internet, no Endereço:
http://www.barueri.sp.gov.br/nfe

Código Autenticidade

129R.5896.8421.0221299-Y

Número da Nota

0001480

Série da Nota
RECEBEMOS DA EMPRESA REGULATORIO MAIS LTDA OS SERVIÇOS CONSTANTES DESTA
NOTA FISCAL ELETRÔNICA DE SERVIÇOS

Local
 
Data
 
Assinatura
`;

describe('NF-e de Serviços de Barueri — o PDF real da CHRISTIAN FAMILY', () => {
    const r = parseNfseFromText(TXT_BARUERI);

    it('a porta reconhece o leiaute (antes: "nao parece ser uma NFSe")', () => {
        expect(ehNfeBarueri(TXT_BARUERI)).toBe(true);
        expect(() => parseNfseFromText(TXT_BARUERI)).not.toThrow();
    });

    it('cabeçalho: número, data/hora e código de autenticidade', () => {
        expect(r.numero).toBe('0001480');
        expect(r.dataEmissao).toBe('14/09/2026 14:29');
        expect(r.codigoVerificacao).toBe('129R.5896.8421.0221299-Y');
    });

    it('prestador: REGULATORIO MAIS, CNPJ, IM e endereço de Barueri', () => {
        expect(r.prestador.nome).toBe('REGULATORIO MAIS LTDA');
        expect(r.prestador.cnpj).toBe('54.402.122/0001-33');
        expect(r.prestador.inscricaoMunicipal).toBe('4.BI685-4');
        expect(r.prestador.municipio).toBe('BARUERI');
        expect(r.prestador.uf).toBe('SP');
        expect(r.prestador.cep).toBe('06455-030');
    });

    it('tomador: CHRISTIAN FAMILY BANK, CNPJ e endereço de São Paulo', () => {
        expect(r.tomador.nome).toBe('CHRISTIAN FAMILY BANK S/A');
        expect(r.tomador.cnpj).toBe('38.406.148/0001-01');
        expect(r.tomador.cep).toBe('01311-940');
        expect(r.tomador.municipio).toBe('Sao Paulo');
        expect(r.tomador.bairro).toBe('BELA VISTA');
        expect(r.tomador.uf).toBe('SP');
    });

    it('a empresa ativa é a TOMADORA: entra como ENTRADA, e não por palpite', () => {
        expect(matchNfseEmpresa(r, '38.406.148/0001-01')).toEqual({ ok: true, direcao: 'entrada' });
    });

    it('serviço e valores do papel', () => {
        expect(r.codigoServico).toBe('010501220');
        expect(r.aliquotaIss).toBe(2);
        expect(r.valorServicos).toBe(7990);
        expect(r.valorLiquido).toBe(7990);
        expect([r.valorIrrf, r.valorPis, r.valorCofins, r.valorCsll]).toEqual([0, 0, 0, 0]);
        expect(r.discriminacao).toMatch(/Licenciamento do software Regulatorio Mais/);
        expect(conferirValoresDaNfsePdf(r).bloquear).toBe(false);
    });

    it('o que o papel não traz não é inventado: sem competência (o recorte usa a emissão, e diz), ISS sem valor', () => {
        expect(r.competencia).toBe('');
        expect(r.valorIss).toBe(0);
        expect(r.baseCalculo).toBe(0);
        const rec = recorteDaNfsePdf(r);
        expect(rec.competencia).toBe('2026-09');
        expect(rec.competenciaOrigem).toBe('data-de-emissao');
    });

    it('documento que não é NFS-e continua recusado', () => {
        expect(() => parseNfseFromText('PREFEITURA MUNICIPAL DE BARUERI — guia de IPTU, nada de serviço')).toThrow();
    });
});
