/**
 * Testes do parser de PDF NFSe.
 *
 * O parser tinha labels hardcoded ("PRESTADOR DE SERVIÇOS"/"TOMADOR DE
 * SERVIÇOS") que so funcionavam pro padrao ABRASF/Publica. PDFs reais da
 * S&P (SERASA DANFSe nacional + CONCEITO Ginfes Guarulhos) usavam labels
 * diferentes — parser nao achava blocos, CNPJ ficava em branco, importacao
 * manual rejeitava com "CNPJ (vazio) nao corresponde a empresa selecionada".
 *
 * Cada fixture aqui eh o texto bruto que pdfjs extrai de um PDF real
 * reportado pelo usuario (FASTWELD/02942184000134). Garante que prestador
 * e tomador.cnpj saem preenchidos pros 3 padroes (ABRASF/DANFSe/Ginfes).
 */
// Mock pdfjs-dist — ele tenta resolver Worker no top-level e quebra jsdom.
// So precisamos da funcao pura `parseNfseFromText` que nao usa pdfjs.
jest.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    version: '0.0.0',
    getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
}));

import { parseNfseFromText, matchNfseEmpresa } from '../services/nfsePdfParserService';

const SP_FASTWELD = '02942184000134';

// ─── Fixture 1: DANFSe v1.0 (gov.br/nfse nacional) ─────────────────────────
// NFSe da SERASA tomada pela FASTWELD. Padrao nacional emitido pela
// prefeitura de Sao Carlos via portal nacional NFS-e (CGSN 169).
const TXT_DANFSE_SERASA = `
DANFSe v1.0
Documento Auxiliar da NFS-e
PREFEITURA MUNICIPAL DE SÃO CARLOS
Chave de Acesso da NFS-e
35489062262173620009306000000069959826059725169509
Número da NFS-e
699598
Competência da NFS-e
10/05/2026
Data e Hora da emissão da NFS-e
11/05/2026 14:31:31
EMITENTE DA NFS-e
Prestador do Serviço
CNPJ / CPF / NIF
62.173.620/0093-06
Inscrição Municipal
-
Telefone
(11) 3003-7372
Nome / Nome Empresarial
SERASA S.A.
E-mail
-
Endereço
AVENIDA DOUTOR HEITOR JOSE REALI, 360, DISTRITO INDUSTRIAL
Município
São Carlos - SP
TOMADOR DO SERVIÇO CNPJ / CPF / NIF
02.942.184/0001-34
Inscrição Municipal
-
Telefone
-
Nome / Nome Empresarial
FASTWELD INDUSTRIA E COMERCIO LTDA
E-mail
vendas@fastweld.com.br
Endereço
R SLD ANTONIO MARTINS OLIVEIRA, 344, VL VENDITTI
Município
Guarulhos - SP
CEP
07031-010
SERVIÇO PRESTADO
Código de Tributação Nacional
17.01.01 - Assessoria ou consultoria
Descrição do Serviço
Servicos prest. de fornecimento de dados e informacoes.
TRIBUTAÇÃO MUNICIPAL
Tributação do ISSQN
Operação Tributável
Valor do Serviço
R$ 1.956,03
Desconto Incondicionado
-
BC ISSQN
R$ 1.956,03
Alíquota Aplicada
2,00%
Retenção do ISSQN
Não Retido
ISSQN Apurado
R$ 39,12
TRIBUTAÇÃO FEDERAL
IRRF
R$ 29,34
Contribuição Previdenciária - Retida
-
Contribuições Sociais - Retidas
R$ 90,95
PIS - Débito Apuração Própria
R$ 32,27
COFINS - Débito Apuração Própria
R$ 148,66
VALOR TOTAL DA NFS-E
Valor do Serviço
R$ 1.956,03
Total das Retenções Federais
R$ 120,29
Valor Líquido da NFS-e
R$ 1.835,74
`.trim();

// ─── Fixture 2: NFSe Municipal Guarulhos (Ginfes) ──────────────────────────
// NFSe da CONCEITO PRIME tomada pela FASTWELD. Padrao legado Ginfes
// (Prefeitura de Guarulhos). Layout em tabela — pdfjs concatena os campos
// e valores em linhas adjacentes.
const TXT_GINFES_GUARULHOS = `
PREFEITURA MUNICIPAL DE GUARULHOS
SECRETARIA DE FINANÇAS
NOTA FISCAL ELETRÔNICA DE SERVIÇO - NFS-e
Número da NFS-e
10684
Data e Hora da Emissão
22/05/2026 14:15:02
Competência
22/5/2026
Código de Verificação
3G4ZEUARY
Dados do Prestador de Serviços
Razão Social/Nome
CONCEITO PRIME RH LTDA
Nome Fantasia
CONCEITO PRIME
CNPJ/CPF
27.547.648/0001-39
Inscrição Municipal
313783
Município
GUARULHOS - SP
Endereço e Cep
AVENIDA SANTOS DUMONT ,297 - CUMBICA CEP: 07180-270
Dados do Tomador de Serviços
Razão Social/Nome
FASTWELD IND. E COM. LTDA
CNPJ/CPF
02.942.184/0001-34
Inscrição Municipal
8680431
Município
GUARULHOS - SP
Endereço e CEP
RUA SOLD. ANTONIO MARTINS OLIVEIRA, 344
Discriminação dos Serviços
TAXA DE SERVICOS 293,92
VALOR REEMBOLSO 1.336,00
Código do Serviço / Atividade
17.05 / 782050000 - Locação de mão-de-obra temporária
Valor dos Serviços R$
4.278,47
`.trim();

// ─── Fixture 3: ABRASF padrao (Publica/SC) ─────────────────────────────────
// O formato historico que ja funcionava antes do fix. Garante que nao
// quebramos os PDFs que ja eram suportados.
const TXT_ABRASF_PUBLICA = `
PREFEITURA MUNICIPAL DE FLORIANOPOLIS
Nota Fiscal de Servicos Eletronica - NFS-e
Numero da NFS-e: 12345
PRESTADOR DE SERVIÇOS
CNPJ/CPF: 11.111.111/0001-11
Nome empresarial: PRESTADOR LTDA
Endereço: Rua Teste, 100
TOMADOR DE SERVIÇOS
CNPJ/CPF: 02.942.184/0001-34
Nome empresarial: FASTWELD INDUSTRIA E COMERCIO LTDA
Endereço: Rua Tomador, 200
DISCRIMINAÇÃO DOS SERVIÇOS
Servico de teste
VALOR TOTAL DO SERVIÇO: R$ 1.000,00
`.trim();

describe('parseNfseFromText — extrai CNPJ de 3 padroes diferentes', () => {
    it('DANFSe v1.0 (SERASA) extrai CNPJ prestador e tomador', () => {
        const r = parseNfseFromText(TXT_DANFSE_SERASA);
        expect(r.prestador.cnpj).toBe('62.173.620/0093-06');
        expect(r.tomador.cnpj).toBe('02.942.184/0001-34');
    });

    it('DANFSe v1.0 (SERASA) extrai nome do tomador', () => {
        const r = parseNfseFromText(TXT_DANFSE_SERASA);
        expect(r.tomador.nome).toContain('FASTWELD');
    });

    it('Ginfes Guarulhos (CONCEITO) extrai CNPJ prestador e tomador', () => {
        const r = parseNfseFromText(TXT_GINFES_GUARULHOS);
        expect(r.prestador.cnpj).toBe('27.547.648/0001-39');
        expect(r.tomador.cnpj).toBe('02.942.184/0001-34');
    });

    it('Ginfes Guarulhos (CONCEITO) extrai nome do tomador', () => {
        const r = parseNfseFromText(TXT_GINFES_GUARULHOS);
        expect(r.tomador.nome).toContain('FASTWELD');
    });

    it('ABRASF Publica continua funcionando (nao regrediu)', () => {
        const r = parseNfseFromText(TXT_ABRASF_PUBLICA);
        expect(r.prestador.cnpj).toBe('11.111.111/0001-11');
        expect(r.tomador.cnpj).toBe('02.942.184/0001-34');
        expect(r.tomador.nome).toContain('FASTWELD');
    });

    it('rejeita PDF que nao eh NFSe', () => {
        expect(() => parseNfseFromText('isto e qualquer outro documento sem palavras-chave')).toThrow();
    });
});

describe('parseNfseFromText — DANFSe v1.0 SERASA: extrai TODOS os campos', () => {
    // Bug reportado: tela "Validar dados extraidos" mostrava CNPJ correto
    // mas NUMERO/SERIE/DATA/COD_SERVICO/CHAVE/VALORES todos zerados pq
    // labels do DANFSe v1.0 sao distintos dos do ABRASF e do Ginfes.
    let r: ReturnType<typeof parseNfseFromText>;
    beforeAll(() => { r = parseNfseFromText(TXT_DANFSE_SERASA); });

    it('extrai numero (699598)', () => {
        expect(r.numero).toBe('699598');
    });
    it('extrai data emissao (11/05/2026)', () => {
        expect(r.dataEmissao).toContain('11/05/2026');
    });
    it('extrai competencia (10/05/2026)', () => {
        expect(r.competencia).toBe('10/05/2026');
    });
    it('extrai chave de acesso (50 digitos)', () => {
        expect(r.chaveAcesso).toBe('35489062262173620009306000000069959826059725169509');
    });
    it('extrai codigo de servico via "Codigo de Tributacao Nacional" (17.01.01)', () => {
        expect(r.codigoServico).toBe('17.01.01');
    });
    it('extrai valor do servico (1956.03)', () => {
        expect(r.valorServicos).toBe(1956.03);
    });
    it('extrai base de calculo via "BC ISSQN" (1956.03)', () => {
        expect(r.baseCalculo).toBe(1956.03);
    });
    it('extrai aliquota ISS via "Aliquota Aplicada" (2)', () => {
        expect(r.aliquotaIss).toBe(2);
    });
    it('extrai valor ISS via "ISSQN Apurado" (39.12)', () => {
        expect(r.valorIss).toBe(39.12);
    });
    it('extrai valor PIS via "PIS - Debito Apuracao Propria" (32.27)', () => {
        expect(r.valorPis).toBe(32.27);
    });
    it('extrai valor COFINS via "COFINS - Debito Apuracao Propria" (148.66)', () => {
        expect(r.valorCofins).toBe(148.66);
    });
    it('extrai valor IRRF via label sozinho (29.34)', () => {
        expect(r.valorIrrf).toBe(29.34);
    });
    it('extrai valor liquido (1835.74)', () => {
        expect(r.valorLiquido).toBe(1835.74);
    });
});

describe('matchNfseEmpresa — integracao com fixtures reais', () => {
    it('DANFSe SERASA + FASTWELD → entrada', () => {
        const r = parseNfseFromText(TXT_DANFSE_SERASA);
        expect(matchNfseEmpresa(r, SP_FASTWELD)).toEqual({ ok: true, direcao: 'entrada' });
    });

    it('Ginfes CONCEITO + FASTWELD → entrada', () => {
        const r = parseNfseFromText(TXT_GINFES_GUARULHOS);
        expect(matchNfseEmpresa(r, SP_FASTWELD)).toEqual({ ok: true, direcao: 'entrada' });
    });

    it('CNPJ que nao bate retorna motivo informativo', () => {
        const r = parseNfseFromText(TXT_DANFSE_SERASA);
        const m = matchNfseEmpresa(r, '99999999999999');
        expect(m.ok).toBe(false);
        expect(m.motivo).toContain('99999999999999');
    });
});

// ─── Casos de borda: CNPJ sem pontuacao + labels nao reconhecidos ──────────
describe('parseNfseFromText — formatos variados de CNPJ', () => {
    it('aceita CNPJ pontuado com espacos extras (02. 942. 184 / 0001 - 34)', () => {
        const texto = `
NFS-e Prefeitura Municipal
Numero 1
PRESTADOR DE SERVIÇOS
Razão Social: SERASA S.A.
CNPJ: 62. 173. 620 / 0093 - 06
TOMADOR DE SERVIÇOS
Razão Social: FASTWELD INDUSTRIA E COMERCIO LTDA
CNPJ: 02. 942. 184 / 0001 - 34
DISCRIMINAÇÃO DOS SERVIÇOS
Servico
`.trim();
        const r = parseNfseFromText(texto);
        expect(r.prestador.cnpj).toBe('62.173.620/0093-06');
        expect(r.tomador.cnpj).toBe('02.942.184/0001-34');
    });

    it('aceita CNPJ sem pontuacao (62173620009306)', () => {
        const texto = `
NFS-e Prefeitura Municipal
Numero 1
PRESTADOR DE SERVIÇOS
Razão Social: SERASA S.A.
CNPJ: 62173620009306
TOMADOR DE SERVIÇOS
Razão Social: FASTWELD
CNPJ/CPF: 02942184000134
DISCRIMINAÇÃO DOS SERVIÇOS
Servico
`.trim();
        const r = parseNfseFromText(texto);
        // Parser deve NORMALIZAR para formato pontuado canonico
        expect(r.prestador.cnpj).toBe('62.173.620/0093-06');
        expect(r.tomador.cnpj).toBe('02.942.184/0001-34');
    });
});

describe('matchNfseEmpresa — fallback rawText (PDFs municipais nao reconhecidos)', () => {
    const participanteVazio = () => ({
        cnpj: '', nome: '', inscricaoMunicipal: '', nomeFantasia: '',
        endereco: '', bairro: '', municipio: '', uf: '', cep: '',
        email: '', telefone: '',
    });
    const parsedComRawText = (rawText: string) => ({
        numero: '1', serie: '1', competencia: '', dataEmissao: '', codigoVerificacao: '',
        municipioPrestacao: '', chaveAcesso: '', codigoServico: '', discriminacao: '',
        naturezaOperacao: '',
        prestador: participanteVazio(),
        tomador:   participanteVazio(),
        valorServicos: 0, baseCalculo: 0, aliquotaIss: 0, valorIss: 0, valorIssRetido: 0,
        valorPis: 0, valorCofins: 0, valorInss: 0, valorIrrf: 0, valorCsll: 0,
        valorOutrasRetencoes: 0, valorDeducoes: 0,
        valorDescIncondicional: 0, valorDescCondicional: 0, valorLiquido: 0,
        municipioEmissor: '',
        rawText,
    });

    it('quando blockPrestador/blockTomador vazios mas CNPJ esta no rawText, infere direcao', () => {
        // PDF municipal com layout nao mapeado. findFirstIndex falha, prestador
        // e tomador ficam vazios, mas o CNPJ da empresa aparece no rawText.
        // Fallback permite importacao em vez de rejeitar.
        const parsed = parsedComRawText('NOTA FISCAL\n62173620009306 SERASA\n02942184000134 FASTWELD\n');
        const m = matchNfseEmpresa(parsed, SP_FASTWELD);
        expect(m.ok).toBe(true);
        // FASTWELD aparece DEPOIS do outro CNPJ → tomador → entrada
        expect(m.direcao).toBe('entrada');
    });

    it('quando empresa eh o PRIMEIRO CNPJ no rawText, infere saida', () => {
        const parsed = parsedComRawText('NOTA FISCAL\n02942184000134 FASTWELD\n62173620009306 CLIENTE\n');
        const m = matchNfseEmpresa(parsed, SP_FASTWELD);
        expect(m.ok).toBe(true);
        expect(m.direcao).toBe('saida');
    });

    it('fallback NAO ativa quando CNPJ nao esta no rawText (rejeicao correta)', () => {
        const parsed = parsedComRawText('NOTA FISCAL\n11111111000111 EMPRESA A\n22222222000222 EMPRESA B\n');
        const m = matchNfseEmpresa(parsed, SP_FASTWELD);
        expect(m.ok).toBe(false);
        expect(m.motivo).toContain(SP_FASTWELD);
    });
});
