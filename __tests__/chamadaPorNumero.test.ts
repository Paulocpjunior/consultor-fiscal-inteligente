// ============================================================================
// ☎️ A CHAMADA É POR NÚMERO — e a aba configurava sempre o principal
//
// 26/08 (Paulo): *"vamos unificar então. Já que nosso tronco chave na URA é o
// 11 3155-1554, as ligações por WhatsApp saem por ele; o 11 3337-1554 continua
// sendo o WhatsApp principal."*
//
// 🚨 O DEFEITO ERA DE CONSTRUÇÃO, não de uso: as rotas de chamada nasceram
// presas ao `configWhatsapp()` — o número do ENV — de quando só existia um.
// Com dois números cadastrados, a aba ☎️ lia e **ESCREVIA** sempre no
// principal. E configurar chamada é o pior lugar para isso: não devolve
// resposta errada, **grava destino SIP no número errado** — e destino SIP
// errado derruba a chamada de quem hoje funciona.
//
// 🚨 CANAL DESCONHECIDO É RECUSA, NUNCA "cai no padrão". Cair no padrão seria
// exatamente o defeito de novo, agora com cara de conveniência.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = process.cwd();
const rotas = readFileSync(join(raiz, 'sefaz-backend/whatsapp-routes.js'), 'utf8');
const tela = readFileSync(join(raiz, 'components/SpConnect/index.tsx'), 'utf8');
const porta = readFileSync(join(raiz, 'services/spConnectService.ts'), 'utf8');

/** O corpo de uma rota, do `router.<verbo>('<caminho>'` até a próxima rota. */
const corpoDaRota = (caminho: string) => {
    const ini = rotas.indexOf(`'${caminho}'`);
    expect(ini).toBeGreaterThan(-1);
    const prox = rotas.indexOf('\nrouter.', ini + 10);
    return rotas.slice(ini, prox === -1 ? undefined : prox);
};

const ROTAS_DE_CHAMADA = [
    '/chamadas/sondar',
    '/chamadas/sondar-sbc',
    '/chamadas/configurar',
];

describe('🚨 as rotas de chamada perguntam DE QUAL NÚMERO', () => {
    it.each(ROTAS_DE_CHAMADA)('%s resolve o canal pedido', (caminho) => {
        expect(corpoDaRota(caminho)).toMatch(/cfgDaChamada\(req\)/);
    });

    it.each(ROTAS_DE_CHAMADA)('%s NÃO usa mais o número do ENV direto', (caminho) => {
        // É esta linha que fazia a aba escrever no número errado.
        expect(corpoDaRota(caminho)).not.toMatch(/const cfg = configWhatsapp\(\);/);
    });

    it('🚨 canal desconhecido é RECUSADO, nunca cai no padrão', () => {
        const helper = rotas.slice(rotas.indexOf('async function cfgDaChamada'), rotas.indexOf("router.get('/canais'"));
        expect(helper).toMatch(/não está cadastrado/);
        // O padrão só vale quando ele foi PEDIDO (ou nada foi pedido).
        expect(helper).toMatch(/!pedido \|\| pedido === CANAL_PADRAO_ID/);
    });

    it('⚠️ e a SONDA continua devolvendo `indeterminado` com o motivo', () => {
        // Sonda que vira erro seco perde a distinção que ela existe para dar:
        // "não consegui perguntar" ≠ "a Meta disse que não".
        const sondar = corpoDaRota('/chamadas/sondar');
        expect(sondar).toMatch(/veredito: 'indeterminado'/);
        expect(sondar).toMatch(/motivo: alvo\.erro/);
    });
});

describe('☎️ e a tela deixa escolher — e diz a consequência', () => {
    it('tem seletor de número na aba de chamadas', () => {
        expect(tela).toMatch(/Número desta configuração/);
        expect(tela).toMatch(/trocarCanalChamada/);
    });

    it('🚨 trocar de número LIMPA o resultado do anterior', () => {
        // Resultado de um número ao lado do seletor já trocado é a leitura
        // dupla de sempre: a pessoa lê o estado de um como se fosse do outro.
        const fn = tela.slice(tela.indexOf('const trocarCanalChamada'), tela.indexOf('const trocarCanalChamada') + 400);
        expect(fn).toMatch(/setSonda\(null\)/);
        expect(fn).toMatch(/setSbc\(null\)/);
    });

    it('🚨 a tela DIZ que a ligação segue o número da conversa', () => {
        // É a consequência que decide o desenho: configurar aqui não move a
        // ligação de quem conversa no outro número.
        expect(tela).toMatch(/segue o número da CONVERSA/);
    });

    // ── 26/08, segunda rodada: "não vejo botão" ────────────────────────────
    // O seletor existia, no TOPO da aba. O Paulo rolou até os botões de
    // gravação e o alvo tinha saído da tela — de onde ele estava, dava para
    // clicar em "Cadastrar tronco SIP" sem enxergar em qual número aquilo ia
    // ser escrito. Recorte que só se declara no alto é recorte que some na
    // rolagem, e aqui o alvo errado grava destino SIP no número que funciona.
    it('🚨 o alvo aparece TAMBÉM junto dos botões que gravam', () => {
        const bloco = tela.slice(tela.indexOf('🛠 Gravar na Meta'), tela.indexOf('Aplicar os horários'));
        expect(bloco).toMatch(/no número/);
        expect(bloco).toMatch(/trocarCanalChamada/);
    });

    it('e o seletor de cima continua lá — os dois mexem no MESMO estado', () => {
        // Dois seletores com estados diferentes seriam a leitura dupla que
        // este PR existe para matar.
        const ocorrencias = (tela.match(/onChange=\{\(e\) => trocarCanalChamada\(e\.target\.value\)\}/g) || []);
        expect(ocorrencias.length).toBe(2);
    });

    it('as três chamadas do front levam o canal', () => {
        expect(tela).toMatch(/sondarChamadas\(canal \?\? canalChamada\)/);
        expect(tela).toMatch(/configurarChamadas\(\{ \.\.\.p, canal: canalChamada \}\)/);
        // ⚠️ Sem regex aqui: a chamada tem `Number(sipPorta)` no meio, e um
        // `[^)]*` para no parêntese DELE — a 1ª versão deste teste reprovou
        // código certo por isso. Lendo a linha, a intenção fica clara.
        const linha = tela.split('\n').find((l) => l.includes('await sondarSbc('));
        expect(linha).toBeDefined();
        expect(linha).toContain('canal: canalChamada');
    });

    it('e as portas aceitam o canal', () => {
        expect(porta).toMatch(/sondarChamadas = \(canal\?: string\)/);
        expect(porta).toMatch(/canal\?: string/);
    });
});
