/**
 * Validação do lote de XMLs contra a empresa selecionada (27/07).
 * Caso real: o combo vinha com a PRIMEIRA empresa da lista pré-selecionada e o
 * ZIP era lançado no cliente errado sem ninguém perceber.
 */
import { extrairDadosXml, resumirLoteXmls, validarLoteParaEmpresa, raizCnpj } from '../services/xmlLoteValidacao';

const CNPJ_GUARANI = '58692419000131';
const CNPJ_OUTRO = '12345678000199';

const chaveCom = (cnpj: string) => `3526${'0'.repeat(2)}${cnpj}55001${'9'.repeat(44 - 6 - 14 - 5)}`.slice(0, 44);

const nfe = (emit: string, dest: string) => `<?xml version="1.0"?>
<nfeProc><NFe><infNFe Id="NFe${chaveCom(emit)}">
  <emit><CNPJ>${emit}</CNPJ><xNome>Emitente</xNome></emit>
  <dest><CNPJ>${dest}</CNPJ><xNome>Destinatario</xNome></dest>
</infNFe></NFe></nfeProc>`;

const empresas = [
    { id: 'g', nome: 'GUARANI COMERCIO DE DOCES', cnpj: CNPJ_GUARANI },
    { id: 'o', nome: 'OUTRA EMPRESA LTDA', cnpj: CNPJ_OUTRO },
];

describe('extrairDadosXml', () => {
    it('pega emitente, destinatário e chave', () => {
        const d = extrairDadosXml(nfe(CNPJ_GUARANI, CNPJ_OUTRO));
        expect(d.emit).toBe(CNPJ_GUARANI);
        expect(d.dest).toBe(CNPJ_OUTRO);
        expect(d.chave).toHaveLength(44);
    });

    it('sem bloco emit, tira o emitente da chave (resumo/evento)', () => {
        const d = extrairDadosXml(`<resNFe><chNFe>${chaveCom(CNPJ_GUARANI)}</chNFe></resNFe>`);
        expect(d.emit).toBe(CNPJ_GUARANI);
        expect(d.dest).toBeNull();
    });

    it('destinatário pessoa física (CPF) não quebra', () => {
        const xml = `<NFe><emit><CNPJ>${CNPJ_GUARANI}</CNPJ></emit><dest><CPF>12345678901</CPF></dest></NFe>`;
        expect(extrairDadosXml(xml).dest).toBe('12345678901');
    });

    it('lixo não vira identificação falsa', () => {
        expect(extrairDadosXml('não é xml')).toEqual({ emit: null, dest: null, chave: null });
    });
});

// ---------------------------------------------------------------------------
// 🚨 CASO A CASTELLANO (19/08) — o modal bloqueava um CT-e que o backend já
// aceitava. O backend (parseCTeXml) usa o REMETENTE como contraparte
// principal do CT-e (é ele quem manda a carga e, com toma=0, quem paga o
// frete) — mas esta validação (usada só na TELA de confirmação, antes de
// importar) lia o `<dest>` cru, que no CT-e é o destinatário FINAL da
// mercadoria, sem nada a ver com o cliente. Resultado: "0 de 6 XMLs desta
// empresa" numa tela cujo botão Importar só existe quando NÃO bloqueia — a
// pessoa nem chegava a testar se o backend aceitaria.
// ---------------------------------------------------------------------------
const CNPJ_CASTELLANO = '51227692000146';
const CNPJ_TRANSPORTADORA = '35523401000291';
const CNPJ_ORDALHA = '37668204000105';
const CHAVE_CTE = '35260735523401000291570000000956861100095683';

const cte = (remCnpj: string, destCnpj: string) => `<?xml version="1.0"?>
<cteProc><CTe><infCte Id="CTe${CHAVE_CTE}" versao="4.00">
  <emit><CNPJ>${CNPJ_TRANSPORTADORA}</CNPJ><xNome>Transportadora</xNome></emit>
  <rem><CNPJ>${remCnpj}</CNPJ><xNome>Remetente</xNome></rem>
  <dest><CNPJ>${destCnpj}</CNPJ><xNome>Destinatario final da carga</xNome></dest>
</infCte></CTe><protCTe><infProt><chCTe>${CHAVE_CTE}</chCTe><cStat>100</cStat></infProt></protCTe></cteProc>`;

describe('extrairDadosXml — CT-e usa o REMETENTE como contraparte, não o <dest>', () => {
    it('dest vira o remetente (mesma regra do backend, parseCTeXml)', () => {
        const d = extrairDadosXml(cte(CNPJ_CASTELLANO, CNPJ_ORDALHA));
        expect(d.emit).toBe(CNPJ_TRANSPORTADORA);
        expect(d.dest).toBe(CNPJ_CASTELLANO);   // nunca CNPJ_ORDALHA
    });

    it('chave sai do Id="CTe..." e do <chCTe>, não só do padrão NFe', () => {
        const d = extrairDadosXml(cte(CNPJ_CASTELLANO, CNPJ_ORDALHA));
        expect(d.chave).toBe(CHAVE_CTE);
    });

    it('NF-e sem <rem> continua lendo o <dest> normalmente', () => {
        const d = extrairDadosXml(nfe(CNPJ_GUARANI, CNPJ_OUTRO));
        expect(d.dest).toBe(CNPJ_OUTRO);
    });
});

describe('validarLoteParaEmpresa — A CASTELLANO como remetente do CT-e', () => {
    it('libera a importação (era bloqueada antes da correção)', () => {
        const resumo = resumirLoteXmls([cte(CNPJ_CASTELLANO, CNPJ_ORDALHA)]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_CASTELLANO, [
            { id: 'c', nome: 'A CASTELLANO INDUSTRIA METALURGICA LTDA', cnpj: CNPJ_CASTELLANO },
        ]);
        expect(v.bloquear).toBe(false);
        expect(v.compativeis).toBe(1);
    });
});

describe('validarLoteParaEmpresa', () => {
    it('lote todo da empresa escolhida → libera sem alarme', () => {
        const resumo = resumirLoteXmls([nfe(CNPJ_GUARANI, CNPJ_OUTRO), nfe(CNPJ_GUARANI, CNPJ_OUTRO)]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);
        expect(v.compativeis).toBe(2);
        expect(v.incompativeis).toBe(0);
        expect(v.bloquear).toBe(false);
        expect(v.mensagem).toMatch(/Todos os 2/);
    });

    it('empresa ERRADA selecionada: bloqueia e diz de quem é o arquivo', () => {
        const resumo = resumirLoteXmls([nfe(CNPJ_GUARANI, '99999999000191')]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_OUTRO, empresas);
        expect(v.bloquear).toBe(true);
        expect(v.donosProvaveis[0].empresa?.nome).toMatch(/GUARANI/);
        expect(v.mensagem).toMatch(/Troque a empresa selecionada/);
    });

    it('dono não cadastrado: avisa que o CNPJ não está na base', () => {
        const resumo = resumirLoteXmls([nfe('77777777000191', '88888888000191')]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);
        expect(v.bloquear).toBe(true);
        expect(v.mensagem).toMatch(/NÃO está cadastrado/);
    });

    it('lote misturado: conta os que serão recusados', () => {
        const resumo = resumirLoteXmls([
            nfe(CNPJ_GUARANI, CNPJ_OUTRO),
            nfe('77777777000191', '88888888000191'),
        ]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);
        expect(v.compativeis).toBe(1);
        expect(v.incompativeis).toBe(1);
        expect(v.bloquear).toBe(false);
        expect(v.mensagem).toMatch(/RECUSADOS/);
    });

    it('nota de ENTRADA (empresa é destinatária) conta como compatível', () => {
        const resumo = resumirLoteXmls([nfe('77777777000191', CNPJ_GUARANI)]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);
        expect(v.compativeis).toBe(1);
        expect(v.bloquear).toBe(false);
    });

    it('filial: raiz igual basta (matriz x filial da mesma empresa)', () => {
        expect(raizCnpj('58692419000131')).toBe('58692419');
        const resumo = resumirLoteXmls([nfe('58692419000212', CNPJ_OUTRO)]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);
        expect(v.compativeis).toBe(1);
    });

    it('lote vazio não bloqueia nem inventa dono', () => {
        const v = validarLoteParaEmpresa(resumirLoteXmls([]), CNPJ_GUARANI, empresas);
        expect(v.total).toBe(0);
        expect(v.bloquear).toBe(false);
        expect(v.mensagem).toMatch(/Nenhum XML/);
    });
});

// ---------------------------------------------------------------------------
// Print do Paulo (27/07): modal dizia "Todos os 36 XMLs são desta empresa" e,
// logo abaixo, listava 5 fornecedores "não cadastrada". Eram notas de ENTRADA
// (GUARANI destinatária) — o emitente é fornecedor, não dono alheio.
// ---------------------------------------------------------------------------
describe('lote de ENTRADAS não trata fornecedor como dono alheio', () => {
    const fornecedores = ['01157555001186', '05953156000100', '42115174000140'];
    const resumo = resumirLoteXmls(fornecedores.map(f => nfe(f, CNPJ_GUARANI)));
    const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);

    it('conta tudo como compatível, como entradas', () => {
        expect(v.compativeis).toBe(3);
        expect(v.comoDestinatario).toBe(3);
        expect(v.comoEmitente).toBe(0);
        expect(v.incompativeis).toBe(0);
    });

    it('não aponta nenhum dono alheio (a lista de fornecedores some)', () => {
        expect(v.donosProvaveis).toHaveLength(0);
    });

    it('mensagem diz que são entradas', () => {
        expect(v.mensagem).toMatch(/Todos os 3/);
        expect(v.mensagem).toMatch(/entrada/);
    });

    it('lote de saída informa o outro lado da conta', () => {
        const saida = validarLoteParaEmpresa(resumirLoteXmls([nfe(CNPJ_GUARANI, '01157555001186')]), CNPJ_GUARANI, empresas);
        expect(saida.comoEmitente).toBe(1);
        expect(saida.mensagem).toMatch(/saída/);
    });
});

// ============================================================================
// 🚨 NFS-e NÃO TEM <emit>/<dest> — e a tela GRITAVA "não é desta empresa"
//
// 31/08, Paulo, importando uma NFS-e da Prefeitura de Santo André para MARCOS
// ANTONIO ZAMBOLIN INFORMATICA (07.901.372/0001-38):
//
//   ⛔ Arquivo não é desta empresa
//   1 XML(s) · 0 desta empresa · 1 sem CNPJ legível
//
// O "1 sem CNPJ legível" era a resposta: o leitor da TELA conhecia só
// <emit>/<dest> (NF-e) e <rem> (CT-e). O arquivo era dela.
//
// 📌 Duas correções, e a segunda vale mais: (1) a leitura aprende o padrão
// ABRASF; (2) "não consegui LER" deixa de ser dito como "não é desta empresa"
// — dizer a falha errada manda procurar no lugar errado, e ele ia conferir o
// cadastro do cliente, que está certo.
// ============================================================================
const CNPJ_ZAMBOLIN = '07901372000138';
const CNPJ_TOMADOR_NFSE = '11222333000181';

/** ABRASF v2 — o documento vem embrulhado em <CpfCnpj>. */
const nfseAbrasfV2 = (prestador: string, tomador: string) => `<?xml version="1.0"?>
<CompNfse><Nfse><InfNfse><Numero>206</Numero>
  <PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>${prestador}</Cnpj></CpfCnpj>
    <InscricaoMunicipal>12345</InscricaoMunicipal></IdentificacaoPrestador>
    <RazaoSocial>MARCOS ANTONIO ZAMBOLIN INFORMATICA</RazaoSocial></PrestadorServico>
  <TomadorServico><IdentificacaoTomador><CpfCnpj><Cnpj>${tomador}</Cnpj></CpfCnpj>
    </IdentificacaoTomador></TomadorServico>
</InfNfse></Nfse></CompNfse>`;

/** ABRASF v1 — o documento fica direto no <IdentificacaoX>. */
const nfseAbrasfV1 = (prestador: string, tomador: string) => `<?xml version="1.0"?>
<Nfse><InfNfse>
  <Prestador><Cnpj>${prestador}</Cnpj><InscricaoMunicipal>9</InscricaoMunicipal></Prestador>
  <Tomador><IdentificacaoTomador><Cnpj>${tomador}</Cnpj></IdentificacaoTomador></Tomador>
</InfNfse></Nfse>`;

describe('🚨 a NFS-e é lida — prestador e tomador', () => {
    it('ABRASF v2 (<CpfCnpj>) devolve as duas pontas', () => {
        const d = extrairDadosXml(nfseAbrasfV2(CNPJ_ZAMBOLIN, CNPJ_TOMADOR_NFSE));
        expect(d.emit).toBe(CNPJ_ZAMBOLIN);
        expect(d.dest).toBe(CNPJ_TOMADOR_NFSE);
    });

    it('ABRASF v1 (documento direto) também', () => {
        const d = extrairDadosXml(nfseAbrasfV1(CNPJ_ZAMBOLIN, CNPJ_TOMADOR_NFSE));
        expect(d.emit).toBe(CNPJ_ZAMBOLIN);
        expect(d.dest).toBe(CNPJ_TOMADOR_NFSE);
    });

    // ⚠️ A NF-e não pode regredir: ela não tem <PrestadorServico>, então nada
    // muda nela — é a mesma garantia que o <rem> do CT-e recebeu em 19/08.
    it('a NF-e continua lida pelo <emit>/<dest>', () => {
        const d = extrairDadosXml(nfe(CNPJ_GUARANI, CNPJ_OUTRO));
        expect(d.emit).toBe(CNPJ_GUARANI);
        expect(d.dest).toBe(CNPJ_OUTRO);
    });

    it('e o lote da NFS-e passa a reconhecer a empresa', () => {
        const empresasNfse = [{ id: 'z', nome: 'MARCOS ANTONIO ZAMBOLIN INFORMATICA', cnpj: CNPJ_ZAMBOLIN }];
        const v = validarLoteParaEmpresa(
            resumirLoteXmls([nfseAbrasfV2(CNPJ_ZAMBOLIN, CNPJ_TOMADOR_NFSE)]), CNPJ_ZAMBOLIN, empresasNfse,
        );
        expect(v.compativeis).toBe(1);
        expect(v.bloquear).toBe(false);
        expect(v.naoConferido).toBe(false);
        expect(v.mensagem).toMatch(/saída/);
    });
});

// ============================================================================
// 🚨 "NÃO É DESTA EMPRESA" ≠ "NÃO CONSEGUI LER" — a segunda metade.
//
// A leitura acima cobre o ABRASF; a próxima prefeitura com leiaute próprio cai
// de novo no ilegível. O que NÃO pode voltar é o app AFIRMAR de quem é.
// ============================================================================
describe('🚨 arquivo ilegível não vira acusação', () => {
    const ilegivel = '<?xml version="1.0"?><NotaFiscal><Numero>206</Numero></NotaFiscal>';
    const v = validarLoteParaEmpresa(resumirLoteXmls([ilegivel]), CNPJ_GUARANI, empresas);

    it('NÃO bloqueia — quem decide a posse é o servidor', () => {
        expect(v.bloquear).toBe(false);
        expect(v.naoConferido).toBe(true);
    });

    it('e a frase diz o que aconteceu de verdade, com a ação', () => {
        expect(v.mensagem).toMatch(/Não consegui LER/);
        expect(v.mensagem).toMatch(/NÃO quer dizer que o arquivo seja de outra empresa/);
        expect(v.mensagem).toMatch(/pode importar/);
        // 🔴 A afirmação que ele leu no print, e que era FALSA.
        expect(v.mensagem).not.toMatch(/não é desta empresa/i);
    });

    // ⚠️ E o bloqueio de VERDADE continua: XML de OUTRO CNPJ legível bloqueia,
    // que é o caso que esta tela existe para pegar.
    it('XML de outra empresa continua bloqueado, nomeando o dono', () => {
        const outro = validarLoteParaEmpresa(
            resumirLoteXmls([nfe(CNPJ_OUTRO, '99999999000199')]), CNPJ_GUARANI, empresas,
        );
        expect(outro.bloquear).toBe(true);
        expect(outro.naoConferido).toBe(false);
    });

    // ⚠️ Um legível + um ilegível NÃO é "não conferido": houve conferência.
    it('lote misto conta o ilegível à parte, sem apagar a conferência', () => {
        const misto = validarLoteParaEmpresa(
            resumirLoteXmls([nfe(CNPJ_GUARANI, CNPJ_OUTRO), ilegivel]), CNPJ_GUARANI, empresas,
        );
        expect(misto.naoConferido).toBe(false);
        expect(misto.compativeis).toBe(1);
        expect(misto.semIdentificacao).toBe(1);
    });
});

// ============================================================================
// 🚨 QUARTA VEZ DA MESMA CLASSE — e desta vez a empresa era a TOMADORA.
//
// 03/09, Paulo (GOLDLOG ARMAZENS GERAIS, 17.390.490/0001-82): *"o CFI voltou a
// não reconhecer as notas de serviços tomados, pois está considerando o CNPJ do
// prestador em vez do CNPJ da empresa como tomadora"*. O modal dizia **"Nenhum
// dos 4 XMLs é desta empresa — são do CNPJ 33.105.122/0001-00, que NÃO está
// cadastrado"**, e o botão Importar nem existia.
//
// 🔴 No leiaute NACIONAL o tomador é `<toma>`, e esta leitura conhecia `<dest>`,
// `<rem>` e os blocos do ABRASF — nenhum deles. Como o nacional TAMBÉM traz
// `<emit>`, o `emit` saía preenchido (o PRESTADOR) e o `dest` VAZIO: a tela via
// só o prestador e acusava o arquivo. É o CT-e (19/08) e o ABRASF (31/08) no
// leiaute que entrou em 01/09 — três correções pontuais, e a quarta forma ficou
// de fora.
//
// ✂️ Por isso ela DELEGA ao dono (`nfse-nacional-leitura.js`), o mesmo que o
// `xmlParserService` usa: corrigir a tag fecharia a INSTÂNCIA e deixaria a
// classe aberta pela quinta vez.
// ============================================================================
describe('🚨 NFS-e NACIONAL — a empresa como TOMADORA', () => {
    const CNPJ_GOLDLOG = '17390490000182';
    const CNPJ_PRESTADOR = '33105122000100';

    /**
     * A chave do padrão nacional tem **50** caracteres, e a repartição é a do
     * arquivo REAL do caso (o nome dos XMLs no print):
     * `3550308` município · `1` ambiente · `2` tipo de inscrição · 14 do CNPJ
     * do PRESTADOR · 27 do resto. É por isso que o CNPJ da chave nunca
     * responderia "de quem é a nota" num serviço TOMADO — ele é do emitente.
     */
    const chaveNac = (prest: string) => `3550308${'1'}${'2'}${prest}000000001897826086334682523`;

    /** Forma REAL do leiaute (a mesma fixture do `nfseNacionalLeitura.test.ts`,
     *  que sai do `nfse-nacional-dps-builder.js` deste repo). */
    const nfseNacional = (prest: string, toma: string) => `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infNFSe Id="NFS${chaveNac(prest)}">
    <nNFSe>18978</nNFSe>
    <cLocIncid>3550308</cLocIncid>
    <dhProc>2026-08-28T10:32:00-03:00</dhProc>
    <emit><CNPJ>${prest}</CNPJ><xNome>PRESTADOR DE SERVICO LTDA</xNome></emit>
    <DPS><infDPS Id="DPS3550308"><nDPS>18978</nDPS>
      <emit><CNPJ>${prest}</CNPJ><xNome>PRESTADOR DE SERVICO LTDA</xNome></emit>
      <toma><CNPJ>${toma}</CNPJ><xNome>GOLDLOG ARMAZENS GERAIS E LOGISTICA LTDA</xNome></toma>
      <valores><vServPrest><vServ>1000.00</vServ></vServPrest></valores>
    </infDPS></DPS>
  </infNFSe>
</NFSe>`;

    it('lê o TOMADOR — antes o `dest` saía vazio e o prestador virava o dono', () => {
        const d = extrairDadosXml(nfseNacional(CNPJ_PRESTADOR, CNPJ_GOLDLOG));
        expect(d.emit).toBe(CNPJ_PRESTADOR);
        expect(d.dest).toBe(CNPJ_GOLDLOG);
    });

    // 🚨 O CASO DO PRINT: 4 XMLs de serviços TOMADOS, três prestadores
    // diferentes. Antes: "0 desta empresa · 4 de outro CNPJ", bloqueado.
    it('o lote de serviços TOMADOS deixa de ser acusado', () => {
        const lote = [
            nfseNacional(CNPJ_PRESTADOR, CNPJ_GOLDLOG),
            nfseNacional(CNPJ_PRESTADOR, CNPJ_GOLDLOG),
            nfseNacional('63023253000109', CNPJ_GOLDLOG),
            nfseNacional('32076813000151', CNPJ_GOLDLOG),
        ];
        const v = validarLoteParaEmpresa(
            resumirLoteXmls(lote), CNPJ_GOLDLOG,
            [{ id: 'g', nome: 'GOLDLOG ARMAZENS GERAIS E LOGISTICA LTDA', cnpj: CNPJ_GOLDLOG }],
        );
        expect(v.compativeis).toBe(4);
        expect(v.comoDestinatario).toBe(4);
        expect(v.bloquear).toBe(false);
        expect(v.mensagem).toMatch(/entrada \(ela recebeu\)/);
        // 🔴 A frase do print, que era FALSA sobre um arquivo que é dela.
        expect(v.mensagem).not.toMatch(/Nenhum dos/);
        // ⚠️ E o prestador NÃO vira "dono provável": ele é a contraparte.
        expect(v.donosProvaveis).toHaveLength(0);
    });

    // ⚠️ O bloqueio de VERDADE continua: NFS-e nacional de outro tomador, com o
    // dono NOMEADO — é para isto que esta tela existe.
    it('NFS-e nacional de OUTRO tomador continua bloqueada', () => {
        const v = validarLoteParaEmpresa(
            resumirLoteXmls([nfseNacional(CNPJ_PRESTADOR, '99999999000199')]), CNPJ_GOLDLOG, empresas,
        );
        expect(v.bloquear).toBe(true);
        expect(v.naoConferido).toBe(false);
    });

    // ⚠️ A chave do nacional tem 50 caracteres — recortá-la em 44 daria uma
    // chave que não existe.
    it('a chave sai como o dono a lê, com 50 caracteres', () => {
        const d = extrairDadosXml(nfseNacional(CNPJ_PRESTADOR, CNPJ_GOLDLOG));
        expect(d.chave).toHaveLength(50);
        expect(d.chave?.slice(0, 7)).toBe('3550308');
    });

    // ⚠️ NADA REGRIDE: o nacional é detectado por `<infNFSe>`/`<infDPS>`, e o
    // ABRASF escreve `<InfNfse>` — a diferença é a CAIXA das letras.
    it('o ABRASF e a NF-e continuam pelo caminho antigo', () => {
        expect(extrairDadosXml(nfseAbrasfV2(CNPJ_ZAMBOLIN, CNPJ_TOMADOR_NFSE)).emit).toBe(CNPJ_ZAMBOLIN);
        expect(extrairDadosXml(nfe(CNPJ_GUARANI, CNPJ_OUTRO)).dest).toBe(CNPJ_OUTRO);
    });
});

// ============================================================================
// 🔗 A CLASSE, não a instância: a tela DELEGA ao dono do leiaute nacional.
//
// Se ela voltar a ler `<toma>` por conta própria, a próxima tag que o dono
// aprender fica de fora — e o defeito volta calado, como voltou três vezes.
// ============================================================================
describe('a tela não tem leitura própria do leiaute nacional', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const fonte = readFileSync(join(__dirname, '../services/xmlLoteValidacao.ts'), 'utf8');
    // ⚠️ Varredura lê CÓDIGO, nunca a prosa que o explica (a mordida do ISS,
    // 22/08) — os comentários citam `<toma>` justamente para explicar a causa.
    const codigo = fonte.split('\n').filter((l: string) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    it('importa e chama o dono', () => {
        expect(codigo).toMatch(/from '\.\.\/sefaz-backend\/nfse-nacional-leitura\.js'/);
        expect(codigo).toMatch(/if \(ehNfseNacional\(txt\)\)/);
        expect(codigo).toMatch(/lerNfseNacional\(txt\)/);
    });

    it('e não rola uma leitura própria de `toma`', () => {
        expect(codigo).not.toMatch(/'toma'/);
        expect(codigo).not.toMatch(/<toma/);
    });
});
