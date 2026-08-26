// ============================================================================
// 🟢 PRESENÇA — "quem da fila está no ar AGORA?"
//
// A última linha 🟡 de uso diário do de-para. E o valor dela não é a bolinha na
// lista de gente: é **a hora de transferir**. Sem isso, mandar a conversa para
// o Fiscal quando não há ninguém do Fiscal no ar é indistinguível de mandar
// para uma fila cheia — ela some da mesa de quem mandou e ninguém vê.
//
// 🚨 O QUE ESTE MÓDULO SE RECUSA A DIZER É "OFFLINE". O app mede UMA coisa: se
// o inbox mandou sinal e quando. Ele não sabe se a pessoa fechou a aba, se o
// computador dormiu, se a rede caiu ou se ela está no telefone com o cliente.
// Chamar tudo isso de "offline" é afirmar o que não foi medido — e aqui teria
// consequência: alguém deixaria de transferir para quem está lá.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import {
    JANELA_NO_AR_MS, INTERVALO_SINAL_MS,
    situacaoDaPresenca, quemDaFilaEstaNoAr,
} from '../sefaz-backend/whatsapp-presenca';

const raiz = (...p: string[]) => path.join(process.cwd(), ...p);
const AGORA = Date.parse('2026-08-25T14:00:00-03:00');
const atras = (min: number) => new Date(AGORA - min * 60_000).toISOString();

describe('🟢 o que o sinal significa', () => {
    it('sinal recente = no ar', () => {
        expect(situacaoDaPresenca(atras(1), AGORA).situacao).toBe('no-ar');
        expect(situacaoDaPresenca(atras(2), AGORA).texto).toBe('no ar agora');
    });

    it('🚨 sinal velho é "SEM SINAL", nunca "offline" nem "ausente"', () => {
        const r = situacaoDaPresenca(atras(20), AGORA);
        expect(r.situacao).toBe('sem-sinal');
        expect(r.texto).toMatch(/sem sinal há 20 min/);
        expect(r.texto).not.toMatch(/offline|ausente|indispon/i);
    });

    it('e o TEMPO vai junto — 4 min e 4 horas pedem reações diferentes', () => {
        expect(situacaoDaPresenca(atras(4), AGORA).texto).toMatch(/4 min/);
        expect(situacaoDaPresenca(atras(240), AGORA).texto).toMatch(/4h/);
    });

    it('quem nunca bateu é "sem registro" — outra coisa que "sem sinal"', () => {
        // Nunca ter aberto o inbox e ter fechado há uma hora são fatos
        // diferentes; um balde só faria os dois parecerem a mesma coisa.
        const r = situacaoDaPresenca(null, AGORA);
        expect(r.situacao).toBe('sem-registro');
        expect(r.minutos).toBeNull();
    });

    it('🚨 o batimento é bem menor que a janela — senão o selo PISCA', () => {
        // Indicador que pisca entre "no ar" e "sem sinal" a cada batida é
        // indicador que ninguém acredita.
        expect(INTERVALO_SINAL_MS * 2).toBeLessThanOrEqual(JANELA_NO_AR_MS);
    });
});

describe('🟢 quem da fila está no ar', () => {
    const atendentes = [
        { email: 'ana@sp.com.br', nome: 'Ana', filas: ['fiscal'] },
        { email: 'bia@sp.com.br', nome: 'Bia', filas: ['contabil'] },
        { email: 'chefe@sp.com.br', nome: 'Chefe', filas: null },   // vê tudo
    ];

    it('quem VÊ TUDO conta como cobertura da fila', () => {
        // Gestor/Recepção/dono podem pegar a conversa — ignorá-los diria
        // "ninguém no ar" com alguém pronto para atender.
        const r = quemDaFilaEstaNoAr({
            fila: 'fiscal', atendentes,
            presencas: { 'chefe@sp.com.br': atras(1) }, agora: AGORA,
        });
        expect(r.total).toBe(2);          // Ana + Chefe
        expect(r.noAr).toBe(1);
        expect(r.pessoas[0].nome).toBe('Chefe');   // no ar primeiro
    });

    it('fila com gente no ar NÃO ganha aviso — alarme em estado normal cansa', () => {
        const r = quemDaFilaEstaNoAr({
            fila: 'fiscal', atendentes,
            presencas: { 'ana@sp.com.br': atras(1) }, agora: AGORA,
        });
        expect(r.noAr).toBe(1);
        expect(r.aviso).toBeNull();
    });

    it('🚨 ninguém no ar avisa — e diz que a transferência FUNCIONA mesmo assim', () => {
        // O app mediu o sinal, não a pessoa: quem está com a aba fechada abre
        // daqui a dez minutos e pega a conversa. Impedir seria barrar
        // transferência legítima por uma certeza que não temos.
        const r = quemDaFilaEstaNoAr({
            fila: 'fiscal', atendentes, presencas: {}, agora: AGORA,
        });
        expect(r.noAr).toBe(0);
        expect(r.aviso).toMatch(/A transferência funciona/);
    });

    it('fila SEM NINGUÉM vinculado é aviso PRÓPRIO — a ação é outra', () => {
        // "ninguém no ar" se resolve esperando; "ninguém vinculado" se resolve
        // na ⚙️. Fundir os dois mandaria a pessoa esperar por quem não existe.
        const r = quemDaFilaEstaNoAr({
            fila: 'juridico', atendentes: [{ email: 'ana@sp.com.br', nome: 'Ana', filas: ['fiscal'] }],
            presencas: {}, agora: AGORA,
        });
        expect(r.total).toBe(0);
        expect(r.aviso).toMatch(/Ninguém está vinculado/);
    });
});

describe('🚨 a fiação: sinal próprio, aba visível, e um lugar que usa', () => {
    const rota = fs.readFileSync(raiz('sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = fs.readFileSync(raiz('components/SpConnect/index.tsx'), 'utf8');

    it('🚨 cada um marca a PRÓPRIA presença — a rota não aceita destinatário', () => {
        // Aceitar e-mail no corpo só serviria para mentir sobre quem está no ar.
        const corpo = rota.slice(rota.indexOf("router.post('/presenca'"));
        const bloco = corpo.slice(0, corpo.indexOf('});'));
        expect(bloco).toMatch(/req\.user\?\.email/);
        expect(bloco).not.toMatch(/req\.body/);
    });

    it('🚨 o batimento só sai com a ABA VISÍVEL', () => {
        // Aba esquecida atrás de outra por três horas diria "no ar" — e quem
        // transfere confiaria num sinal que não é presença de ninguém.
        expect(tela).toMatch(/document\.visibilityState !== 'visible'/);
        expect(tela).toMatch(/visibilitychange/);
    });

    it('🚨 a presença TEM leitor — a da fila destino, na transferência', () => {
        // Régua sem tela é código morto com cara de entrega (13/08).
        expect(tela).toMatch(/presencaDaFila\(transFila\)/);
        expect(tela).toMatch(/no ar em \{rotuloCurtoFila\(transFila\)\}/);
    });

    it('a leitura da fila é para ATENDENTE, não só admin — quem transfere é ele', () => {
        expect(rota).toMatch(/router\.get\('\/presenca\/fila\/:fila', requireAuth/);
    });

    it('a coleção nova está no catálogo do banco (trava de 21/08)', () => {
        const catalogo = fs.readFileSync(raiz('sefaz-backend/catalogo-banco.js'), 'utf8');
        expect(catalogo).toMatch(/whatsapp_presenca/);
    });
});
