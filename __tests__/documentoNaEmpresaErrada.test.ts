// ============================================================================
// 🚨 "LANCEI UMA NOTA DA J.P. PISSATO NA EMPRESA SILVIO FREIRE"
//
// 03/09, Paulo: *"o consultor não deu nenhum erro avisando de que eu estava
// importando na empresa errada, e eu não me atentei tbm. **Como resolver?**"*
//
// Duas metades, e as duas foram MEDIDAS:
//
//  1. **A SAÍDA NÃO EXISTIA.** `deleteDocumento` está em `xmlFiscalService`
//     desde sempre e NENHUMA tela o chamava — a "rota sem botão" (13/08). A
//     nota entrou no livro da empresa errada e não havia caminho para tirá-la.
//     E ela nem servia: apaga de VERDADE, levando junto quem pôs e quando.
//  2. **O PDF SÓ CONFERIA NO DROP.** `matchNfseEmpresa` roda ao soltar o
//     arquivo — e os campos de prestador/tomador da tela são EDITÁVEIS depois
//     dele. Conferência que roda antes da edição não protege o que foi editado.
//
// 🚨 O CUSTO É DOS DOIS LADOS, e nenhum validador acusa: a nota INFLA o serviço
// tomado de quem não a tomou (Livro, competência, bloco A) e SOME do livro de
// quem tomou — o documento é legítimo e os dois cadastros estão certos.
// ============================================================================
import {
    conferirPosseDaNfsePdf, raizCnpj,
} from '../services/nfsePdfPosse';
import {
    retirarDocumentoDaEmpresa, explicarRetirada, MIN_MOTIVO_RETIRADA,
} from '../services/documentoRetirada';

const SILVIO = '17660729000197';
const PISSATO = '11222333000181';
const PRESTADOR = '47866934000174';
const EMPRESAS = [
    { id: 's', nome: 'SILVIO FREIRE LANCHONETE LTDA', cnpj: SILVIO },
    { id: 'p', nome: 'J.P. PISSATO LTDA', cnpj: PISSATO },
];

describe('conferirPosseDaNfsePdf — o PDF é MESMO desta empresa?', () => {
    it('a nota da J.P. PISSATO importada na SILVIO FREIRE é BLOQUEADA, nomeando a dona', () => {
        const r = conferirPosseDaNfsePdf({
            prestadorCnpj: PRESTADOR, prestadorNome: 'TICKET SERVICOS SA',
            tomadorCnpj: PISSATO, tomadorNome: 'J.P. PISSATO LTDA',
            empresaCnpj: SILVIO, empresaNome: 'SILVIO FREIRE LANCHONETE LTDA',
            empresas: EMPRESAS,
        });
        expect(r.bloquear).toBe(true);
        expect(r.situacao).toBe('de-outra-empresa');
        expect(r.donoProvavel?.empresa?.nome).toBe('J.P. PISSATO LTDA');
        expect(r.mensagem).toMatch(/Troque a empresa/);
        // 🚨 E a frase diz o CUSTO — sem isso "não é desta empresa" se lê como
        // capricho, e a pessoa força a importação.
        expect(r.mensagem).toMatch(/livro da empresa errada/);
    });

    it('a mesma nota na empresa CERTA passa, e diz de que lado ela está', () => {
        const r = conferirPosseDaNfsePdf({
            prestadorCnpj: PRESTADOR, tomadorCnpj: PISSATO,
            empresaCnpj: PISSATO, empresas: EMPRESAS,
        });
        expect(r.bloquear).toBe(false);
        expect(r.lado).toBe('tomador');
        expect(r.mensagem).toMatch(/TOMADORA/);
    });

    it('serviço PRESTADO reconhece a empresa do lado do prestador', () => {
        const r = conferirPosseDaNfsePdf({
            prestadorCnpj: SILVIO, tomadorCnpj: PISSATO,
            empresaCnpj: SILVIO, empresas: EMPRESAS,
        });
        expect(r.lado).toBe('prestador');
        expect(r.bloquear).toBe(false);
    });

    // ⚠️ MATRIZ E FILIAL SÃO A MESMA EMPRESA — é a régua da RAIZ que o
    // certificado e o lote de XML já usam. Bloquear a nota da filial com a
    // matriz ativa seria recusar documento legítimo.
    it('filial da mesma raiz não é "outra empresa"', () => {
        const filial = `${SILVIO.slice(0, 8)}000278`;
        const r = conferirPosseDaNfsePdf({
            prestadorCnpj: PRESTADOR, tomadorCnpj: filial,
            empresaCnpj: SILVIO, empresas: EMPRESAS,
        });
        expect(r.bloquear).toBe(false);
        expect(raizCnpj(filial)).toBe(raizCnpj(SILVIO));
    });

    // 🚨 A TRAVA QUE IMPEDE O ALARME AO CONTRÁRIO: a DANFSe v2.0 de Brasília
    // chega com prestador e tomador VAZIOS (02/09, RADIO E TV SUL AMERICANA).
    // Bloquear ali seria acusar de "empresa errada" um PDF que o app não
    // conseguiu LER — e fecharia a única porta que essa nota tem.
    it('lado ilegível NÃO bloqueia — e a frase não afirma que é de outra empresa', () => {
        const r = conferirPosseDaNfsePdf({
            prestadorCnpj: '', tomadorCnpj: '',
            empresaCnpj: SILVIO, empresas: EMPRESAS,
        });
        expect(r.bloquear).toBe(false);
        expect(r.situacao).toBe('nao-conferido');
        expect(r.mensagem).toMatch(/NÃO quer dizer que ele seja de outra/);
        // ⚠️ E manda preencher o CNPJ, com a consequência: COD_PART vazio barra
        // o EFD-Contribuições INTEIRO (a recusa do INSTITUTO HAYAY, 03/09).
        expect(r.mensagem).toMatch(/COD_PART/);
    });

    it('um lado só legível também é "não conferido", nomeando qual falta', () => {
        const r = conferirPosseDaNfsePdf({
            prestadorCnpj: PRESTADOR, tomadorCnpj: '',
            empresaCnpj: SILVIO, empresas: EMPRESAS,
        });
        expect(r.bloquear).toBe(false);
        expect(r.mensagem).toMatch(/o TOMADOR/);
    });

    it('empresa sem CNPJ no cadastro não vira acusação contra o arquivo', () => {
        const r = conferirPosseDaNfsePdf({
            prestadorCnpj: PRESTADOR, tomadorCnpj: PISSATO, empresaCnpj: '',
        });
        expect(r.bloquear).toBe(false);
        expect(r.mensagem).toMatch(/sem CNPJ no cadastro/);
    });

    it('dono NÃO cadastrado é dito como tal, sem inventar nome', () => {
        const r = conferirPosseDaNfsePdf({
            prestadorCnpj: PRESTADOR, prestadorNome: 'TICKET SERVICOS SA',
            tomadorCnpj: '99999999000199', tomadorNome: 'OUTRA LTDA',
            empresaCnpj: SILVIO, empresas: EMPRESAS,
        });
        expect(r.bloquear).toBe(true);
        expect(r.donoProvavel?.empresa).toBeNull();
        expect(r.mensagem).toMatch(/Confira o arquivo e o cadastro/);
    });
});

// ============================================================================
// A SAÍDA — e ela é LÁPIDE, nunca `deleteDoc`.
// ============================================================================
describe('retirarDocumentoDaEmpresa', () => {
    const DOC = {
        id: 'nfse-1', numero: '6967', competencia: '2026-08',
        empresaNome: 'SILVIO FREIRE LANCHONETE LTDA', empresaCnpj: SILVIO,
    };
    const AUTOR = { uid: 'u1', email: 'sandra@spassessoriacontabil.com.br' };
    const AGORA = new Date('2026-09-03T18:00:00Z');

    it('grava a lápide com quem tirou, quando e por quê', () => {
        const r = retirarDocumentoDaEmpresa(DOC, 'nota é da J.P. PISSATO, importada aqui por engano', AUTOR, AGORA);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.patch._deleted).toBe(true);
        expect(r.patch._deletedPor).toBe('u1');
        expect(r.patch._deletedPorEmail).toBe(AUTOR.email);
        expect(r.patch._deletedMotivo).toMatch(/PISSATO/);
        expect(r.patch._deletedEm).toBe(AGORA.toISOString());
    });

    // 🚨 A LINHA QUE IMPEDE O LIVRO A MENOS: tirar de uma NÃO põe na outra.
    // Sem ela, quem tira acha que resolveu e a nota fica faltando nas DUAS —
    // que é o erro caro.
    it('o aviso DIZ que a nota não foi movida para a empresa certa', () => {
        const r = retirarDocumentoDaEmpresa(DOC, 'nota é da J.P. PISSATO, entrou aqui por engano', AUTOR, AGORA);
        if (!r.ok) throw new Error('deveria aceitar');
        expect(r.avisoDepois).toMatch(/NÃO a moveu/);
        expect(r.avisoDepois).toMatch(/importe-a lá/);
        expect(r.avisoDepois).toMatch(/não foi apagado/);
        expect(r.avisoDepois).toMatch(/6967/);
    });

    // ⚠️ MOTIVO E AUTOR SÃO OBRIGATÓRIOS — é a régua da T3 da DCTFWeb e da
    // reabertura do fim de mês: decisão sem dono não se confere depois.
    it('motivo curto é recusado, com o piso e um exemplo', () => {
        const r = retirarDocumentoDaEmpresa(DOC, 'errada', AUTOR, AGORA);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.motivo).toMatch(new RegExp(String(MIN_MOTIVO_RETIRADA)));
        expect(r.motivo).toMatch(/Ex\.:/);
    });

    it('sem autor não grava — e a frase manda entrar de novo, não "tente outra vez"', () => {
        const r = retirarDocumentoDaEmpresa(DOC, 'nota é da J.P. PISSATO, engano na importação', null, AGORA);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.motivo).toMatch(/saia e entre de novo/);
    });

    // ⚠️ RETIRAR DUAS VEZES NÃO É OPERAÇÃO: repetir sobrescreveria o autor e o
    // motivo originais com os de agora.
    it('nota já retirada não é retirada de novo', () => {
        const r = retirarDocumentoDaEmpresa({ ...DOC, _deleted: true }, 'motivo suficientemente longo', AUTOR, AGORA);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.motivo).toMatch(/JÁ foi tirada/);
        // E ela diz o que ainda pode faltar — a nota na empresa certa.
        expect(r.motivo).toMatch(/importe-a lá/);
    });

    it('documento sem id não é retirado', () => {
        expect(retirarDocumentoDaEmpresa(null, 'motivo suficientemente longo', AUTOR).ok).toBe(false);
    });

    it('explicarRetirada devolve null para nota normal e a frase para a retirada', () => {
        expect(explicarRetirada(DOC as any)).toBeNull();
        const frase = explicarRetirada({
            _deleted: true, _deletedEm: AGORA.toISOString(),
            _deletedPorEmail: AUTOR.email, _deletedMotivo: 'engano',
        });
        expect(frase).toMatch(/Tirada desta empresa/);
        expect(frase).toMatch(/sandra@/);
        expect(frase).toMatch(/continua guardado/);
    });
});

// ============================================================================
// 🔗 A LIGAÇÃO — régua certa sem botão é a "rota sem botão" de novo, que é
// exatamente o estado de ontem: `deleteDocumento` existia e ninguém chamava.
// ============================================================================
describe('as duas metades estão LIGADAS', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const semComentario = (s: string) => s.split('\n')
        .filter((l: string) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    it('a tela do detalhe oferece a saída e chama o dono', () => {
        const tela = semComentario(readFileSync(join(__dirname, '../components/xml/XmlDocumentoDetalhe.tsx'), 'utf8'));
        expect(tela).toMatch(/tirarDocumentoDaEmpresa\(/);
        expect(tela).toMatch(/Esta nota não é desta empresa/);
        // E a lista recarrega: nota que sai e continua na tela faz clicar de novo.
        expect(tela).toMatch(/onRetirado\?\.\(\)/);
    });

    it('a Central passa o usuário e recarrega — sem os dois a retirada não grava nem some', () => {
        const central = semComentario(readFileSync(join(__dirname, '../components/xml/CentralDocumentosFiscais.tsx'), 'utf8'));
        expect(central).toMatch(/currentUser=\{currentUser\}/);
        expect(central).toMatch(/onRetirado=\{\(\) => setRefreshKey/);
    });

    // 🚨 LÁPIDE, NUNCA `deleteDoc` — a régua do WALDESA (24/07). Apagar de
    // verdade leva junto a prova de que a nota esteve ali e de quem a pôs.
    it('a gravação é MERGE de lápide, não exclusão física', () => {
        const svc = semComentario(readFileSync(join(__dirname, '../services/xmlFiscalService.ts'), 'utf8'));
        const bloco = svc.slice(svc.indexOf('export async function tirarDocumentoDaEmpresa'));
        const corpo = bloco.slice(0, bloco.indexOf('\n}'));
        expect(corpo).toMatch(/\{ merge: true \}/);
        expect(corpo).not.toMatch(/deleteDoc\(/);
        expect(corpo).toMatch(/retirarDocumentoDaEmpresa\(/);
    });

    // 🚨 E O PDF RECONFERE NO SALVAR: o `matchNfseEmpresa` roda no DROP, e os
    // campos são editáveis depois dele.
    it('o importador de PDF confere a posse antes de gravar', () => {
        const tela = semComentario(readFileSync(join(__dirname, '../components/xml/NfsePdfImportacao.tsx'), 'utf8'));
        expect(tela).toMatch(/conferirPosseDaNfsePdf\(/);
        expect(tela).toMatch(/if \(posse\.bloquear\)/);
        // A conferência vem ANTES do upload — bloquear depois de subir o PDF
        // deixaria arquivo órfão no Storage.
        // ⚠️ A âncora é a CHAMADA (`await uploadBytes(`), não o nome solto: a
        // primeira ocorrência de `uploadBytes` no arquivo é a linha de IMPORT,
        // lá no topo, e ancorar nela reprovava a ordem CERTA.
        expect(tela.indexOf('posse.bloquear')).toBeLessThan(tela.indexOf('await uploadBytes('));
    });
});
