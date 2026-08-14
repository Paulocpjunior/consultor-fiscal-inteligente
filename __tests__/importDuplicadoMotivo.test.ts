// ============================================================================
// "JÁ IMPORTADO" ERA UM BECO — e o beco tinha três saídas diferentes.
//
// Paulo, 14/08, com 12 arquivos na tela: *"0 ok, 12 duplicado(s)"*, e linha a
// linha `Já importado (chave 3526…)`. A frase é VERDADE e mesmo assim não
// resolve nada: ela não diz em qual empresa o documento está, quando entrou,
// por qual trilho, nem se está visível. A única saída que sobra para quem lê é
// repetir o clique — que nunca vai mudar de resposta.
//
// ═══ AS TRÊS SITUAÇÕES TÊM AÇÕES OPOSTAS ════════════════════════════════════
//
//  · está aqui mesmo ......... nada a fazer, e reimportar não muda nada
//  · está em OUTRA empresa ... reimportar NÃO move a nota de dona (o caro)
//  · está com lápide ......... invisível no app E bloqueando a reentrada;
//                              aqui reimportar é a ação CERTA
//
// Contar as três como "duplicado" é o que esconde a do meio, que é a única que
// custa dinheiro: a nota existe, mas a apuração da empresa certa fica a menor e
// nada na tela denuncia.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { lerDuplicado, ocultoDoApp } from '../services/importDuplicadoMotivo';

const EMPRESA = { id: 'emp-1', nome: 'NOVA ERA', cnpj: '29.240.822/0001-21' };

const doc = (over: Record<string, unknown> = {}) => ({
    empresaId: 'emp-1',
    empresaNome: 'NOVA ERA',
    empresaCnpj: '29240822000121',
    origem: 'sefaz',
    status: 'autorizado',
    importadoEm: '2026-07-10T13:00:00.000Z',
    ...over,
});

describe('a frase agora responde ONDE, QUANDO e POR QUAL TRILHO', () => {
    it('mesma empresa: diz que está aqui, com a data e o trilho', () => {
        const r = lerDuplicado(doc(), EMPRESA);
        expect(r.situacao).toBe('ja-esta-nesta-empresa');
        expect(r.mensagem).toMatch(/NOVA ERA/);
        expect(r.mensagem).toMatch(/10\/07\/2026/);
        expect(r.mensagem).toMatch(/captura na SEFAZ/);
        expect(r.permiteReincluir).toBe(false);
        expect(r.exigeAcao).toBe(false);
    });

    it('e avisa que sumir da APURAÇÃO é outro problema — reimportar não toca nele', () => {
        // Sem isso a pessoa fica reimportando atrás de um valor que não vai
        // aparecer, porque o motivo é regime, pendência ou dedup do art. 136.
        const r = lerDuplicado(doc(), EMPRESA);
        expect(r.acao).toMatch(/não altera nada disso/);
        expect(r.acao).toMatch(/art\. 136/);
    });

    it('o CNPJ casa mesmo formatado de um lado e cru do outro', () => {
        // O CNPJ vive em duas formas neste banco — comparar cru contra
        // formatado diria "outra empresa" para a própria empresa, e a tela
        // mandaria corrigir um cadastro que está certo.
        expect(lerDuplicado(doc({ empresaId: null }), EMPRESA).situacao).toBe('ja-esta-nesta-empresa');
    });

    it('sem data e sem origem, ele DIZ que não tem — não inventa', () => {
        const r = lerDuplicado(doc({ importadoEm: null, origem: null }), EMPRESA);
        expect(r.mensagem).toMatch(/data não registrada/);
        expect(r.mensagem).toMatch(/trilho não registrado/);
    });
});

describe('OUTRA empresa é o caso caro — e não se resolve reimportando', () => {
    const emOutra = lerDuplicado(
        doc({ empresaId: 'emp-9', empresaNome: 'OUTRA LTDA', empresaCnpj: '11222333000181' }),
        EMPRESA,
    );

    it('a situação é nomeada e pede AÇÃO', () => {
        expect(emOutra.situacao).toBe('em-outra-empresa');
        expect(emOutra.exigeAcao).toBe(true);
        expect(emOutra.mensagem).toMatch(/OUTRA LTDA/);
    });

    it('e a ação diz explicitamente que reimportar NÃO transfere', () => {
        // Era exatamente isso que a mensagem antiga convidava a fazer.
        expect(emOutra.acao).toMatch(/não transfere/i);
    });

    it('nunca regrava por cima — a dona não se corrige por importação', () => {
        expect(emOutra.permiteReincluir).toBe(false);
    });
});

describe('a LÁPIDE é a única que libera a reinclusão', () => {
    it('documento excluído volta — e a mensagem diz que voltou', () => {
        // Este é o estado que fecha o beco de verdade: todo enumerador filtra
        // `_deleted`, então o documento fica invisível no app E bloqueando a
        // reentrada. Chamar isso de "duplicado" deixa a pessoa sem saída.
        const r = lerDuplicado(doc({ _deleted: true }), EMPRESA);
        expect(r.situacao).toBe('excluido-pode-reincluir');
        expect(r.permiteReincluir).toBe(true);
        expect(r.mensagem).toMatch(/EXCLUÍDO/);
        expect(r.mensagem).toMatch(/reincluído/i);
    });

    it('a lápide vence até a checagem de empresa', () => {
        // Documento excluído e com dona registrada diferente ainda assim
        // reentra: quem está importando escolheu a empresa, e o registro velho
        // está morto. Bloquear aqui deixaria a nota inalcançável para sempre.
        const r = lerDuplicado(doc({ _deleted: true, empresaId: 'emp-9' }), EMPRESA);
        expect(r.permiteReincluir).toBe(true);
    });
});

describe('TODA lápide libera — não só a de exclusão', () => {
    // A primeira versão desta correção olhou SÓ o `_deleted`. Quem tinha
    // excluído pelo outro caminho continuou preso no mesmo lugar, e Paulo teve
    // que apontar o mesmo problema duas vezes (14/08). Conferir lápide por
    // lápide é a trava-escrita-como-LISTA de novo: a pergunta certa é "este
    // documento aparece no app?", com a MESMA régua da listagem.
    it('ocultoDoApp responde por CAUSA, e as causas têm nomes diferentes', () => {
        expect(ocultoDoApp({ _deleted: true })).toBe('excluido');
        expect(ocultoDoApp({ _merged_into: 'outro-id' })).toBe('mesclado');
        expect(ocultoDoApp({})).toBeNull();
        expect(ocultoDoApp(null)).toBeNull();
    });

    it('documento MESCLADO também reentra — ele está tão invisível quanto', () => {
        const r = lerDuplicado(doc({ _merged_into: 'doc-vencedor' }), EMPRESA);
        expect(r.situacao).toBe('excluido-pode-reincluir');
        expect(r.permiteReincluir).toBe(true);
        expect(r.mensagem).toMatch(/MESCLADO no documento doc-vencedor/);
    });

    it('e a frase do mesclado AVISA do risco que a do excluído não tem', () => {
        // Mesclado foi juntado a OUTRO documento: reincluir pode ressuscitar
        // uma duplicata de verdade. Omitir isso seria trocar um problema por
        // outro sem dizer.
        const r = lerDuplicado(doc({ _merged_into: 'doc-vencedor' }), EMPRESA);
        expect(r.mensagem).toMatch(/duplicidade/);
    });

    it('a reinclusão limpa TODAS as lápides, não só a que disparou', () => {
        // Limpar uma e deixar a outra devolve o documento ao mesmo estado:
        // invisível no app e bloqueando a reentrada.
        const servico = readFileSync(join(__dirname, '..', 'services/xmlFiscalService.ts'), 'utf8');
        expect(servico).toMatch(/_deleted = false/);
        expect(servico).toMatch(/_merged_into = null/);
    });
});

describe('cancelada continua fora dos totais — e a tela diz por quê', () => {
    it.each(['cancelado', 'denegado'])('status %s é nomeado', (status) => {
        const r = lerDuplicado(doc({ status }), EMPRESA);
        expect(r.situacao).toBe('ja-esta-cancelado');
        expect(r.mensagem).toMatch(/CANCELADA/);
        // Não pede ação: estar fora do total é o comportamento CERTO. Dizer
        // isso é o que impede alguém de reimportar tentando "fazer o valor
        // aparecer".
        expect(r.exigeAcao).toBe(false);
        expect(r.permiteReincluir).toBe(false);
    });
});

describe('a TELA usa a leitura, e não volta a inventar frase própria', () => {
    const RAIZ = join(__dirname, '..');
    const painel = readFileSync(join(RAIZ, 'components/xml/XmlImportacaoManual.tsx'), 'utf8');
    const servico = readFileSync(join(RAIZ, 'services/xmlFiscalService.ts'), 'utf8');

    it('a mensagem vem do núcleo — a frase antiga não pode voltar', () => {
        expect(painel).toMatch(/res\.leitura\.mensagem/);
        // Mira no CÓDIGO, não na prosa: a primeira versão desta trava batia no
        // comentário que CITA a frase velha para explicar por que ela saiu —
        // e teste que grita sem motivo é teste que alguém desliga.
        expect(painel).not.toMatch(/mensagem:\s*`Já importado/);
    });

    it('a ação aparece na tela — mensagem sem saída é o beco de novo', () => {
        expect(painel).toMatch(/r\.acao/);
    });

    it('"em outra empresa" não se esconde no meio dos âmbares', () => {
        expect(painel).toMatch(/exigeAcao \? 'bg-red-500'/);
        expect(painel).toMatch(/OUTRA empresa/);
    });

    it('o importador só regrava quando a leitura PERMITE', () => {
        expect(servico).toMatch(/!leitura\.permiteReincluir/);
        // E a lápide sai explicitamente: confiar no `setDoc` sem merge para
        // desfazer uma exclusão é confiar num detalhe do SDK — o dia em que
        // alguém puser `{ merge: true }` o documento volta invisível.
        expect(servico).toMatch(/_deleted = false/);
    });

    it('a auditoria guarda a MESMA frase que a pessoa leu', () => {
        // Log que diz menos que a tela não reconstrói o caso depois.
        expect(servico).toMatch(/mensagem: leitura\.mensagem/);
    });
});
