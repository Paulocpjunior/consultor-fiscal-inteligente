// ============================================================================
// Importação em LOTE do backup da Ultra Fox (Paulo, 18/08: "pode construir").
//
// A forma do export foi CONFERIDA nos prints dele, não deduzida:
//   whatsapp/551133371554/<contato>/_full-chat.txt
//   whatsapp/551133371554/<contato>/<protocolo>/_chat.txt
//   _files/  ← mídia, achatada
//
// O que estes testes trancam:
// 1. o arquivo que se importa é o _full-chat.txt (uma conversa por número, que
//    é como o SP Connect modela) e o de protocolo NÃO entra duas vezes;
// 2. contato que só tem _chat.txt não some — entra, mas MARCADO;
// 3. o número vem da pasta e entra COMO ESTÁ (cliente de fora do Brasil);
// 4. nada é engolido em silêncio: o que fica de fora volta contado.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    mapearArquivosDoBackup, resumoDaVarredura, consolidarPrevia, dividirEmBlocos,
    MENSAGENS_POR_ENVIO, detectarAnexo, avisoDeAnexos,
} from '../sefaz-backend/whatsapp-import-lote.js';

const RAIZ = 'bot-131293-17082026233001/whatsapp/551133371554';

describe('mapa do backup — o que é conversa e o que é atendimento', () => {
    it('_full-chat.txt é a conversa; _chat.txt de protocolo fica FORA (seriam as mesmas mensagens)', () => {
        const m = mapearArquivosDoBackup([
            `${RAIZ}/551120818300/_full-chat.txt`,
            `${RAIZ}/551120818300/552461360/_chat.txt`,
            `${RAIZ}/551120818300/554584868/_chat.txt`,
        ]);
        expect(m.conversas).toEqual([{ numero: '551120818300', caminho: `${RAIZ}/551120818300/_full-chat.txt` }]);
        expect(m.atendimentos).toHaveLength(2);
        expect(m.atendimentos[0]).toMatchObject({ numero: '551120818300', protocolo: '552461360' });
        expect(m.semDono).toEqual([]);
    });

    it('contato SEM _full-chat.txt não some — entra pelo _chat.txt e vai MARCADO', () => {
        // Deixar de fora apagaria o histórico inteiro daquele cliente. Entrar
        // calado seria pior: é suposição, e suposição se declara.
        const m = mapearArquivosDoBackup([`${RAIZ}/551131293632/_chat.txt`]);
        expect(m.conversas).toEqual([]);
        expect(m.semDono).toEqual([{ numero: '551131293632', caminho: `${RAIZ}/551131293632/_chat.txt` }]);
        expect(resumoDaVarredura(m).avisos.join(' ')).toMatch(/sumiria/);
    });

    it('🌍 número de fora do Brasil entra COMO ESTÁ — a pasta é o id da Meta', () => {
        // Foi este backup que revelou os clientes internacionais; completar 55
        // aqui repetiria o defeito que reescrevia o destino do envio.
        const m = mapearArquivosDoBackup([
            `${RAIZ}/244922121422/_full-chat.txt`,   // Angola
            `${RAIZ}/14074950699/_full-chat.txt`,    // EUA
            `${RAIZ}/258849044321/_full-chat.txt`,   // Moçambique
        ]);
        expect(m.conversas.map((c) => c.numero)).toEqual(['244922121422', '14074950699', '258849044321']);
    });

    it('a leitura é a partir do FIM — funciona escolhendo qualquer pasta acima', () => {
        // A pessoa pode clicar na raiz do zip, em "whatsapp" ou na pasta do
        // número do escritório. Amarrar na profundidade faria a varredura
        // devolver ZERO em silêncio dependendo de onde ela clicou.
        const curto = mapearArquivosDoBackup(['551120818300/_full-chat.txt']);
        const longo = mapearArquivosDoBackup([`x/y/z/${RAIZ}/551120818300/_full-chat.txt`]);
        expect(curto.conversas[0].numero).toBe('551120818300');
        expect(longo.conversas[0].numero).toBe('551120818300');
    });

    it('arquivo fora do padrão e pasta que não é número voltam CONTADOS', () => {
        const m = mapearArquivosDoBackup([
            `${RAIZ}/551120818300/_full-chat.txt`,
            'bot-131293/_files/1-Guia_DARF_pro_labore_032026.pdf',
            `${RAIZ}/lixeira/_full-chat.txt`,
        ]);
        expect(m.conversas).toHaveLength(1);
        // A pasta `_files` deixou de contar como "fora do padrão" quando a
        // decisão de 18/08 a nomeou (anexo vai pro SharePoint): ela é MÍDIA,
        // e é a contagem dela que denuncia marcador de anexo desconhecido.
        expect(m.midias).toBe(1);
        expect(m.ignorados).toHaveLength(1);
        expect(m.ignorados[0].motivo).toMatch(/não é um número/);
    });

    it('entrada vazia não explode e diz que não achou nada', () => {
        const r = resumoDaVarredura(mapearArquivosDoBackup([]));
        expect(r.arquivosParaLer).toBe(0);
        // "Zero conversas" não é resultado neutro: ou a pasta está errada, ou o
        // export tem outra forma. Calar faria alguém concluir "backup vazio".
        expect(r.avisos[0]).toMatch(/Nenhum _full-chat\.txt/);
    });

    it('o resumo conta CONTATO, não arquivo (dois arquivos do mesmo número são um contato)', () => {
        const m = mapearArquivosDoBackup([
            `${RAIZ}/551120818300/_full-chat.txt`,
            `${RAIZ}/551124140451/_full-chat.txt`,
            `${RAIZ}/551120818300/552461360/_chat.txt`,
        ]);
        const r = resumoDaVarredura(m);
        expect(r.contatos).toBe(2);
        expect(r.atendimentosIgnorados).toBe(1);
        expect(r.avisos.join(' ')).toMatch(/NÃO serão importados/);
    });
});

describe('prévia consolidada — os autores são a pergunta central', () => {
    const lidos = [
        {
            numero: '551120818300',
            mensagens: [
                { em: '2026-08-01T12:00:00.000Z', autor: 'Juliana', texto: 'bom dia' },
                { em: '2026-08-01T12:01:00.000Z', autor: 'Cliente ACME', texto: 'oi' },
                { em: '2026-08-01T12:02:00.000Z', autor: 'Juliana', texto: 'segue' },
            ],
            descartadas: [{ trecho: 'x', motivo: 'data ilegível' }],
        },
        {
            numero: '551124140451',
            mensagens: [{ em: '2026-08-02T12:00:00.000Z', autor: 'Juliana', texto: 'ok' }],
            descartadas: [],
        },
    ];

    it('soma conversas, mensagens e descartadas', () => {
        const p = consolidarPrevia(lidos);
        expect(p.conversas).toBe(2);
        expect(p.mensagens).toBe(4);
        expect(p.descartadas).toBe(1);
    });

    it('autores vêm com CONTAGEM e ordenados por volume — sem isso a escolha é impossível', () => {
        // A direção de cada mensagem depende de quem é do escritório, e num
        // lote de centenas de arquivos a lista de nomes é grande: os primeiros
        // por volume respondem por quase tudo.
        const p = consolidarPrevia(lidos);
        expect(p.autores[0]).toEqual({ autor: 'Juliana', total: 3 });
        expect(p.autores[1]).toEqual({ autor: 'Cliente ACME', total: 1 });
    });

    it('arquivo lido SEM nenhuma mensagem reconhecida é contado (sinal de formato diferente)', () => {
        const p = consolidarPrevia([...lidos, { numero: '551131293632', mensagens: [], descartadas: [] }]);
        expect(p.arquivosSemMensagem).toBe(1);
    });

    it('lista vazia devolve zeros em vez de explodir', () => {
        expect(consolidarPrevia([]).mensagens).toBe(0);
        expect(consolidarPrevia(undefined as any).autores).toEqual([]);
    });
});

describe('blocos que cabem numa requisição', () => {
    const conversa = (numero: string, n: number) => ({
        numero,
        mensagens: Array.from({ length: n }, (_, i) => ({ em: `2026-08-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`, autor: 'A', texto: `m${i}` })),
    });

    it('junta conversas pequenas até o teto', () => {
        const blocos = dividirEmBlocos([conversa('1', 3), conversa('2', 4)], 10);
        expect(blocos).toHaveLength(1);
        expect(blocos[0]).toHaveLength(2);
    });

    it('abre bloco novo quando não cabe', () => {
        const blocos = dividirEmBlocos([conversa('1', 8), conversa('2', 5)], 10);
        expect(blocos).toHaveLength(2);
    });

    it('conversa MAIOR que o teto é fatiada — e isso é seguro porque o id é determinístico', () => {
        const blocos = dividirEmBlocos([conversa('1', 25)], 10);
        expect(blocos).toHaveLength(3);
        expect(blocos.flat().reduce((s, c) => s + c.mensagens.length, 0)).toBe(25);
    });

    it('conversa sem mensagem não vira bloco vazio', () => {
        expect(dividirEmBlocos([{ numero: '1', mensagens: [] }], 10)).toEqual([]);
        expect(dividirEmBlocos([])).toEqual([]);
    });

    it('teto inválido cai no padrão em vez de dividir em blocos de zero (laço infinito)', () => {
        const blocos = dividirEmBlocos([conversa('1', 3)], 0);
        expect(blocos).toHaveLength(1);
        expect(MENSAGENS_POR_ENVIO).toBeGreaterThan(0);
    });
});

// ============================================================================
// 🚨 O LOTE SÓ EXISTE SE A TELA O CHAMAR — e há uma armadilha de bundle aqui.
// ============================================================================
describe('a tela do Connect é quem roda o lote', () => {
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');

    it('a tela varre a pasta, consolida a prévia e divide em blocos pelo NÚCLEO', () => {
        expect(tela).toMatch(/mapearArquivosDoBackup\(/);
        expect(tela).toMatch(/resumoDaVarredura\(/);
        expect(tela).toMatch(/consolidarPrevia\(/);
        expect(tela).toMatch(/dividirEmBlocos\(/);
    });

    it('lê a pasta de verdade (webkitdirectory) e usa o CAMINHO, não o nome do arquivo', () => {
        // "_full-chat.txt" é igual em todas as pastas — só o caminho relativo
        // diz de quem é cada arquivo.
        expect(tela).toMatch(/webkitdirectory/);
        expect(tela).toMatch(/webkitRelativePath/);
    });

    it('🚨 a tela NÃO importa o que depende de `crypto` do Node', () => {
        // `idMensagemImportada` usa createHash('crypto'), que não existe no
        // navegador. Hoje o bundle funciona porque o tree-shaking descarta a
        // função — importá-la aqui traria um builtin do Node para dentro do
        // bundle, e o erro apareceria só no ar, ao ABRIR a aba. Além disso, o
        // id é decisão do SERVIDOR de propósito: id vindo do navegador é a
        // porta para gravar a mesma mensagem duas vezes.
        expect(tela).not.toMatch(/idMensagemImportada/);
    });

    it('a gravação PARA no primeiro bloco que falhar e diz onde parou', () => {
        // Seguir em frente deixaria metade gravada sem ninguém saber qual
        // metade — e a pessoa não teria como decidir se recomeça.
        expect(tela).toMatch(/parou no bloco/);
    });
});

// ============================================================================
// 📎 "TEXTO NO WHATSAPP, ANEXO SHAREPOINT" (decisão do Paulo, 18/08)
//
// O arquivo não entra no app — mas a MENSAGEM que o carregava entra. Sem
// tratar isso, a thread mostraria um `<anexado: x.pdf>` enigmático e quem
// lesse procuraria no app um arquivo que ele nunca teve.
// ============================================================================
describe('anexo que fica no backup', () => {
    it('reconhece os marcadores conhecidos e devolve o NOME do arquivo', () => {
        expect(detectarAnexo('<anexado: DOC-20260327-WA0001.pdf>')).toEqual({ temAnexo: true, arquivo: 'DOC-20260327-WA0001.pdf' });
        expect(detectarAnexo('IMG-20260327-WA0001.jpg (arquivo anexado)')).toEqual({ temAnexo: true, arquivo: 'IMG-20260327-WA0001.jpg' });
        expect(detectarAnexo('<attached: 00000042-PHOTO.jpg>')).toMatchObject({ temAnexo: true });
    });

    it('mídia OCULTA é anexo sem nome — e o nome NÃO se inventa', () => {
        // Inventar faria alguém procurar no SharePoint um arquivo que não existe.
        expect(detectarAnexo('‎<Mídia oculta>')).toEqual({ temAnexo: true, arquivo: null });
        expect(detectarAnexo('imagem ocultada')).toEqual({ temAnexo: true, arquivo: null });
    });

    it('texto comum NÃO vira anexo', () => {
        expect(detectarAnexo('bom dia, segue o contrato').temAnexo).toBe(false);
        expect(detectarAnexo('').temAnexo).toBe(false);
        expect(detectarAnexo(null).temAnexo).toBe(false);
    });

    it('a pasta _files é CONTADA, não tratada como arquivo fora do padrão', () => {
        const m = mapearArquivosDoBackup([
            `${RAIZ}/551120818300/_full-chat.txt`,
            'bot-131293/_files/1-Guia_DARF_pro_labore_032026.pdf',
            'bot-131293/_files/18-a5ca0b58.mp3',
        ]);
        expect(m.midias).toBe(2);
        expect(m.ignorados).toHaveLength(0);
    });

    it('🚨 mídia no backup + ZERO anexo reconhecido = o marcador é outro, e isso é GRAVE', () => {
        // Descobrir isso depois de gravar é descobrir tarde: as mensagens
        // teriam entrado sem dizer que havia arquivo.
        const av = avisoDeAnexos({ midias: 2500, comAnexo: 0 })!;
        expect(av.grave).toBe(true);
        expect(av.texto).toMatch(/marcador de anexo deste export é diferente/i);
    });

    it('com anexos reconhecidos, o aviso EXPLICA onde o arquivo ficou (não é alarme)', () => {
        const av = avisoDeAnexos({ midias: 2500, comAnexo: 340 })!;
        expect(av.grave).toBe(false);
        expect(av.texto).toMatch(/SharePoint/);
    });

    it('backup sem mídia nenhuma não gera aviso — farol que grita sempre é farol desligado', () => {
        expect(avisoDeAnexos({ midias: 0, comAnexo: 0 })).toBeNull();
    });

    it('a prévia conta as mensagens com anexo', () => {
        const p = consolidarPrevia([{
            numero: '551120818300',
            mensagens: [
                { em: '2026-08-01T12:00:00.000Z', autor: 'Ju', texto: '<anexado: a.pdf>' },
                { em: '2026-08-01T12:01:00.000Z', autor: 'Ju', texto: 'segue' },
            ],
        }]);
        expect(p.comAnexo).toBe(1);
    });
});

describe('a thread DIZ que o anexo ficou no backup', () => {
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');
    const rotas = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');

    it('a mensagem importada com anexo é MARCADA na gravação', () => {
        expect(rotas).toMatch(/anexoNoBackup/);
        expect(rotas).toMatch(/detectarAnexo\(/);
    });

    it('o campo novo entra na LISTAGEM no mesmo PR — fora dela some em silêncio', () => {
        // A lição da whitelist do #382: campo que o backend não devolve nunca
        // chega na tela, e a thread jamais diria que houve arquivo.
        expect(rotas).toMatch(/anexoNoBackup: x\.anexoNoBackup/);
    });

    it('a tela mostra onde o arquivo está', () => {
        expect(tela).toMatch(/anexoNoBackup/);
        expect(tela).toMatch(/SharePoint/);
    });
});
