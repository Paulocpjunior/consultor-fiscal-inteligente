// ============================================================================
// 🚨 O ENDEREÇO ESTAVA NO XML E O LEITOR DESCARTAVA — 732 recusas do PVA.
//
// 18/09, Paulo — J.N. VINATEX · EFD ICMS/IPI 08/2026: *"deu 732 erros de
// endereço"*. O relatório do validador traz **Total de Erros: 732**, todos
// *"Campo obrigatório"*, no registro **0150**, campo **10 - ENDERECO**, em
// 123 páginas. A tela do PVA mostra o participante com **Bairro preenchido e
// Logradouro VAZIO**.
//
// ═══ A ASSIMETRIA ERA A PISTA, E ELA FOI MEDIDA ═════════════════════════════
//
// `extrairParticipantesNfe` — o dono da leitura do participante na captura —
// lia do `<enderDest>`/`<enderEmit>` **só a UF e o município**, e jogava fora
// `xLgr`, `nro`, `xCpl` e `xBairro`, que vêm no MESMO bloco. O comentário
// dele diz, na linha de cima, *"ENDEREÇO importa"*. É a família do
// `localErroAviso` (12/08): o dado chega e quem lê o descarta.
//
// 🚨 QUEM PREENCHIA O CAMPO ERA A **BrasilAPI** — e ela responde OUTRA
// pergunta: o endereço do CADASTRO da Receita, não o que a nota declara (o
// Guia é literal: o 0150 traz *"os dados atualizados no último evento
// fiscal"*). Além de fonte errada, ela é REDE: rate-limit, 403 ou timeout e o
// campo fica vazio — com o arquivo INTEIRO recusado por um campo obrigatório.
//
// ✅ E o parser do NAVEGADOR (`xmlParserService`) já lia os quatro desde
// sempre: o que faltava era a PARIDADE entre os dois parsers, a mesma lição do
// C190 em 12/09.
//
// ⚠️ CNPJs FICTÍCIOS — dado de cliente não entra no repositório.
// ============================================================================
import { extrairParticipantesNfe } from '../sefaz-backend/xml-metadata-helper.js';
import { normalizarParticipantesDoc } from '../sefaz-backend/dipam-produtor-rural.js';
import { participanteDoDocumento } from '../sefaz-backend/participante-doc-helper.js';
import {
    build0150, avisoParticipantesSemEndereco,
// @ts-expect-error — módulo .js do backend (sem tipos)
} from '../sefaz-backend/sped-bloco0-cadastros.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { conferirEnderecoDo0150 } from '../sefaz-backend/sped-c100-regras-comuns.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { avisosDaPrevalidacaoContrib } from '../sefaz-backend/sped-contrib-campos.js';

const XML_NFE = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe35260811222333000181550100000112340000000011">
  <ide><nNF>11234</nNF></ide>
  <emit><CNPJ>11222333000181</CNPJ><xNome>J N TECIDOS LTDA</xNome><IE>123536343115</IE>
    <enderEmit><xLgr>RUA DO EMITENTE</xLgr><nro>100</nro><xCpl>SALA 2</xCpl>
      <xBairro>CENTRO</xBairro><cMun>3550308</cMun><UF>SP</UF><CEP>01001000</CEP></enderEmit></emit>
  <dest><CNPJ>36801255000109</CNPJ><xNome>36.801.255 CLIENTE TESTE</xNome><IE>128773079116</IE>
    <enderDest><xLgr>AVENIDA CIDADE ANTONIO ESTEVAO DE CARVALHO</xLgr><nro>1580</nro>
      <xBairro>CIDADE ANTONIO ESTEVAO DE CARVALHO</xBairro><cMun>3550308</cMun><UF>SP</UF></enderDest></dest>
</infNFe></NFe></nfeProc>`;

describe('🚨 extrairParticipantesNfe — o logradouro vem no MESMO bloco da UF', () => {
    const p = extrairParticipantesNfe(XML_NFE);

    it('lê logradouro, número, complemento e bairro do destinatário', () => {
        expect(p.destinatario.logradouro).toBe('AVENIDA CIDADE ANTONIO ESTEVAO DE CARVALHO');
        expect(p.destinatario.numero).toBe('1580');
        expect(p.destinatario.bairro).toBe('CIDADE ANTONIO ESTEVAO DE CARVALHO');
    });

    it('e do emitente também — a compra de entrada tem o fornecedor lá', () => {
        expect(p.emitente.logradouro).toBe('RUA DO EMITENTE');
        expect(p.emitente.numero).toBe('100');
        expect(p.emitente.complemento).toBe('SALA 2');
        expect(p.emitente.bairro).toBe('CENTRO');
    });

    // ⚠️ AUSENTE ≠ '' : o que o XML não traz devolve null, e quem grava decide.
    it('o que o XML não traz volta null, nunca string vazia inventada', () => {
        const semCpl = extrairParticipantesNfe(XML_NFE);
        expect(semCpl.destinatario.complemento).toBeNull();
    });

    it('UF e município continuam saindo — nada regrediu', () => {
        expect(p.destinatario.uf).toBe('SP');
        expect(p.destinatario.codMunIBGE).toBe('3550308');
    });
});

// ═══ A ARMADILHA DAS DUAS FORMAS, no campo que o 0150 declara ═══════════════
describe('normalizarParticipantesDoc — a forma ACHATADA também tem endereço', () => {
    /** Como o importer PRINCIPAL grava (SEFAZ/cofre): tudo achatado. */
    const achatado = {
        chave: '35260811222333000181550100000112340000000011', direcao: 'saida',
        cnpjDest: '36801255000109', xNomeDest: '36.801.255 CLIENTE TESTE',
        ieDest: '128773079116', ufDest: 'SP', codMunDest: '3550308',
        logradouroDest: 'AVENIDA CIDADE ANTONIO ESTEVAO DE CARVALHO', nroDest: '1580',
        bairroDest: 'CIDADE ANTONIO ESTEVAO DE CARVALHO',
    };

    it('monta o endereço do destinatário a partir dos campos achatados', () => {
        const n = normalizarParticipantesDoc(achatado);
        expect(n.destinatario.logradouro).toBe('AVENIDA CIDADE ANTONIO ESTEVAO DE CARVALHO');
        expect(n.destinatario.numero).toBe('1580');
        expect(n.destinatario.bairro).toBe('CIDADE ANTONIO ESTEVAO DE CARVALHO');
    });

    // 🚨 É ESTE O CAMINHO REAL: o coletor do 0150 lê `participanteRaw.logradouro`
    // do que `participanteDoDocumento` devolve. Sem o endereço na forma
    // achatada, TODA nota capturada automaticamente ia ao arquivo com o campo
    // 10 vazio.
    it('e o DONO da contraparte entrega o endereço a quem monta o 0150', () => {
        const p = participanteDoDocumento(achatado, '11222333000181')!;
        expect(p.logradouro).toBe('AVENIDA CIDADE ANTONIO ESTEVAO DE CARVALHO');
        expect(build0150({
            codPart: p.cnpjCpf, nome: p.nome, cnpj: p.cnpjCpf, ie: p.ie,
            codMunIBGE: p.codMunIBGE, logradouro: p.logradouro,
            numero: p.numero, complemento: p.complemento, bairro: p.bairro,
        })).toContain('|AVENIDA CIDADE ANTONIO ESTEVAO DE CARVALHO|1580||');
    });

    it('doc já ANINHADO passa intacto — a régua é idempotente', () => {
        const aninhado = { destinatario: { cnpjCpf: '36801255000109', nome: 'X', logradouro: 'RUA A' } };
        expect(normalizarParticipantesDoc(aninhado).destinatario.logradouro).toBe('RUA A');
    });
});

// ═══ A RECUSA VIRA REGRA, NAS DUAS FAMÍLIAS ═════════════════════════════════
//
// O 0150 é o MESMO registro no EFD ICMS/IPI e no EFD-Contribuições — deixar a
// regra numa família é a "meia trava" do COD_MUN (22/08), que fez a próxima
// empresa gastar a mesma volta de PVA com outro CNPJ.
describe('🚦 0150 sem ENDERECO — campo 10, obrigatório SEM condição', () => {
    const semEndereco = '|0150|36801255000109|CLIENTE TESTE|1058|36801255000109||128773079116|3550308|||||CIDADE ANTONIO ESTEVAO DE CARVALHO|';
    const comEndereco = '|0150|36801255000109|CLIENTE TESTE|1058|36801255000109||128773079116|3550308||AVENIDA X|1580||CENTRO|';

    it('acusa a linha com bairro preenchido e logradouro vazio (o print do PVA)', () => {
        const [erro] = conferirEnderecoDo0150([semEndereco]);
        expect(erro.registro).toBe('0150');
        expect(erro.campo).toBe('10 - ENDERECO');
        expect(erro.acao).toMatch(/♻️/);
    });

    it('nasce MUDA sobre a linha com endereço', () => {
        expect(conferirEnderecoDo0150([comEndereco])).toEqual([]);
    });

    // ⚠️ UMA entrada, não 732: a ação é a MESMA para todos, e 732 linhas
    // idênticas é o jeito conhecido de ninguém ler as que importam (03/09).
    it('732 participantes viram UMA entrada, com a contagem e os primeiros nomes', () => {
        const muitos = Array.from({ length: 732 }, (_, i) =>
            `|0150|1122233300018${i}|PARTICIPANTE ${i}|1058|1122233300018${i}||1|3550308|||||B|`);
        const erros = conferirEnderecoDo0150(muitos);
        expect(erros).toHaveLength(1);
        expect(erros[0].ocorrencias).toBe(732);
        expect(erros[0].mensagem).toMatch(/732 participante\(s\)/);
        expect(erros[0].mensagem).toMatch(/e mais 727/);
    });

    it('roda no EFD ICMS/IPI', () => {
        const erros = prevalidarSpedFiscal([semEndereco], {}).erros;
        expect(erros.some((e: any) => e.regra === '0150-sem-endereco')).toBe(true);
    });

    // A metade que faltava nas outras vezes: o MESMO registro, na outra família.
    it('e roda no EFD-Contribuições — o 0150 é o mesmo registro', () => {
        expect(avisosDaPrevalidacaoContrib([semEndereco]).join(' ')).toMatch(/ENDERECO/);
    });
});

describe('o aviso da geração diz a ação certa — reler a FONTE, não digitar 732 vezes', () => {
    it('nomeia os participantes e aponta o ♻️', () => {
        const aviso = avisoParticipantesSemEndereco([
            { nome: 'CLIENTE A', codMunIBGE: '3550308' },
            { nome: 'CLIENTE B', logradouro: '' },
        ]);
        expect(aviso).toMatch(/2 participante\(s\) sem ENDERECO/);
        expect(aviso).toMatch(/CLIENTE A/);
        expect(aviso).toMatch(/♻️ Reler participante/);
        expect(aviso).toMatch(/campo 10/);
    });

    it('nasce MUDO quando todos têm logradouro', () => {
        expect(avisoParticipantesSemEndereco([{ nome: 'X', logradouro: 'RUA A' }])).toBeNull();
        expect(avisoParticipantesSemEndereco([])).toBeNull();
    });

    // 🚦 LIGAÇÃO NAS DUAS FAMÍLIAS — aviso escrito e não ligado é a flag que
    // ninguém lê (29/08), e o 0150 sai dos dois arquivos.
    it('os DOIS geradores do bloco 0 chamam o aviso', () => {
        const fs = require('fs');
        const path = require('path');
        for (const rel of ['sefaz-backend/sped-fiscal-bloco0.js', 'sefaz-backend/sped-contrib-bloco0.js']) {
            const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
            expect({ rel, chama: src.includes('avisoParticipantesSemEndereco(dados.participantes)') })
                .toEqual({ rel, chama: true });
        }
    });
});

// ═══ E O ACERVO SE RECUPERA DO XML GUARDADO, não do cadastro ════════════════
describe('♻️ o backfill recoloca a base na fila', () => {
    it('a versão do extrator de participantes subiu — senão nada seria relido', async () => {
        const mod: any = await import('../sefaz-backend/xml-importer.js');
        expect(mod.VERSAO_RELEITURA_PARTICIPANTES).toBeGreaterThanOrEqual(3);
    });

    it('e ele grava os quatro campos novos dos DOIS lados', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.resolve(__dirname, '../sefaz-backend/xml-importer.js'), 'utf8');
        for (const campo of ['logradouroEmit', 'bairroEmit', 'logradouroDest', 'bairroDest']) {
            expect({ campo, grava: src.includes(`por('${campo}'`) }).toEqual({ campo, grava: true });
        }
    });
});

// ═══ O 0150 É DA PESSOA, NÃO DA PRIMEIRA NOTA ═══════════════════════════════
//
// 18/09, à noite (159 recusas depois de reler): o coletor fazia "o primeiro
// vence" — `if (participantesMap.has(docLimpo)) continue;` — então o cliente
// cujo PRIMEIRO documento do mês não trazia endereço saía sem logradouro,
// mesmo com outro documento DELE, mais adiante, já relido e completo.
describe('🚨 mesclarParticipante — ausência num documento não apaga presença no outro', () => {
    // `require` devolve `any` — o `.js` do backend não tem tipos.
    const { mesclarParticipante } = require('../sefaz-backend/sped-bloco0-cadastros.js');
    const semEndereco = { codPart: '11111111000191', nome: 'SEM NOME', cnpj: '11111111000191', cpf: '', ie: '', codMunIBGE: '3550308', logradouro: '', numero: '', complemento: '', bairro: 'PARQUE REGINA' };
    const comEndereco = { codPart: '11111111000191', nome: 'CLIENTE UM', cnpj: '11111111000191', cpf: '', ie: '135000000000', codMunIBGE: '3550308', logradouro: 'RUA DAS FLORES', numero: '10', complemento: 'SALA 2', bairro: 'PARQUE REGINA' };

    it('o segundo documento preenche o que o primeiro não trouxe (o print do PVA: bairro cheio, logradouro vazio)', () => {
        const m = mesclarParticipante(semEndereco, comEndereco);
        expect(m.logradouro).toBe('RUA DAS FLORES');
        expect(m.numero).toBe('10');
        expect(m.ie).toBe('135000000000');
        expect(m.nome).toBe('CLIENTE UM');   // 'SEM NOME' é o nome INVENTADO, conta como vazio
        expect(build0150(m)).toMatch(/\|RUA DAS FLORES\|10\|SALA 2\|PARQUE REGINA\|/);
    });

    it('e NUNCA sobrescreve o que já estava — divergência é alerta, não escrita silenciosa', () => {
        const m = mesclarParticipante(comEndereco, { ...comEndereco, logradouro: 'OUTRA RUA', bairro: 'OUTRO' });
        expect(m.logradouro).toBe('RUA DAS FLORES');
        expect(m.bairro).toBe('PARQUE REGINA');
    });

    it('sem existente, devolve o novo — a primeira vez continua igual', () => {
        expect(mesclarParticipante(undefined, comEndereco)).toEqual(comEndereco);
    });

    it('os DOIS orquestradores fundem em vez de "o primeiro vence"', () => {
        const fs = require('fs');
        const path = require('path');
        for (const arq of ['sped-fiscal-orchestrator.js', 'sped-contrib-orchestrator.js']) {
            const src = fs.readFileSync(path.resolve(__dirname, '../sefaz-backend', arq), 'utf8');
            const codigo = src.split('\n').filter((l: string) => !/^\s*\/\//.test(l)).join('\n');
            expect({ arq, funde: /participantesMap\.set\(docLimpo, mesclarParticipante\(participantesMap\.get\(docLimpo\)/.test(codigo) })
                .toEqual({ arq, funde: true });
            expect({ arq, primeiroVence: /if \(participantesMap\.has\(docLimpo\)\) continue;/.test(codigo) })
                .toEqual({ arq, primeiroVence: false });
        }
    });
});
