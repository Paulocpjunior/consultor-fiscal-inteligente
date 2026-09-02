import { montarLinkOutlookWeb, montarMailtoEnvio, GESTOR_EMAIL } from '../services/envioImpostoService';
import { canalComprovaEnvio, montarPainelEnvios } from '../sefaz-backend/envio-imposto-painel.js';

describe('montarLinkOutlookWeb — o caminho de quem usa Outlook no navegador', () => {
    it('leva cliente no To e o gestor em cópia', () => {
        const url = new URL(montarLinkOutlookWeb({ para: 'cliente@empresa.com.br', assunto: 'DAS 07/2026' }));
        expect(url.origin + url.pathname).toBe('https://outlook.office.com/mail/deeplink/compose');
        expect(url.searchParams.get('to')).toBe('cliente@empresa.com.br');
        expect(url.searchParams.get('cc')).toBe(GESTOR_EMAIL);
        expect(url.searchParams.get('subject')).toBe('DAS 07/2026');
    });

    it('não põe o gestor em cópia quando ele É o destinatário', () => {
        const url = new URL(montarLinkOutlookWeb({ para: GESTOR_EMAIL }));
        expect(url.searchParams.get('cc')).toBeNull();
    });

    it('separa múltiplas cópias por ";" (formato do Outlook Web)', () => {
        const url = new URL(montarLinkOutlookWeb({ para: 'c@e.com', cc: ['outro@sp.com.br'] }));
        expect(url.searchParams.get('cc')).toBe(`${GESTOR_EMAIL};outro@sp.com.br`);
    });

    it('o mailto continua existindo pra quem tem programa instalado', () => {
        expect(montarMailtoEnvio({ para: 'c@e.com' })).toMatch(/^mailto:/);
    });
});

describe('canalComprovaEnvio — o app só afirma o que viu', () => {
    it('só o envio pelo servidor (Graph) prova que a mensagem saiu', () => {
        expect(canalComprovaEnvio('email-graph')).toBe(true);
    });

    it('abrir a composição no e-mail do colaborador NÃO prova envio', () => {
        // O clique em "Enviar" acontece fora do app — se a pessoa fechar a
        // janela, nada sai. Era a dúvida da equipe: "como ter certeza?".
        expect(canalComprovaEnvio('email-app')).toBe(false);
        expect(canalComprovaEnvio('whatsapp')).toBe(false);
        expect(canalComprovaEnvio(undefined)).toBe(false);
    });
});

describe('painel de envios — prova de saída fica separada do rito', () => {
    const base = {
        competencia: '2026-07',
        sharePoint: { status: 'arquivado' },
        baixa: { status: 'baixada' },
        copiaPara: ['alexandre@spassessoriacontabil.com.br'],
    };

    it('conta quantos saíram pelo servidor e lista os sem prova', () => {
        const p = montarPainelEnvios([
            { ...base, empresaNome: 'A', tipo: 'DAS', canal: 'email-graph' },
            { ...base, empresaNome: 'B', tipo: 'DARE', canal: 'email-app' },
            { ...base, empresaNome: 'C', tipo: 'DARF', canal: 'whatsapp' },
        ], { competencia: '2026-07' });

        expect(p.enviadosPeloServidor).toBe(1);
        expect(p.semProvaDeEnvio).toHaveLength(2);
        expect(p.semProvaDeEnvio[0]).toContain('B');
    });

    it('sem prova de envio NÃO transforma o rito em incompleto', () => {
        // São coisas diferentes: o rito (#293) é arquivo + baixa + gestor em
        // cópia; a prova de saída é sobre o canal. Misturar esconderia as duas.
        const p = montarPainelEnvios([
            { ...base, empresaNome: 'B', tipo: 'DARE', canal: 'email-app' },
        ], { competencia: '2026-07' });
        expect(p.completos).toBe(1);
        expect(p.incompletos).toBe(0);
        expect(p.semProvaDeEnvio).toHaveLength(1);
    });
});

// ============================================================================
// 🚨 "ABRIR PELO OUTLOOK WEB DÁ ERRO" — e o Outlook só dizia "Something went
// wrong" (02/09, print da colaboradora no Teams, cliente MARCOS ANTONIO
// ZAMBOLIN).
//
// A URL do print traz `to=marcio07%2FMD%40gmail.com`: uma **BARRA dentro do
// e-mail**, que é o jeito clássico de dois endereços ficarem colados num campo
// só. O app mandava o campo CRU para a URL — `includes('@')` passava — e o
// Outlook devolvia um 500 opaco.
//
// 📌 O custo real não é o erro: é ele mandar procurar defeito no APP quando o
// problema está no CADASTRO. Mensagem que não nomeia a causa gasta o dia de
// quem lê (a régua do "Já importado", 14/08).
// ============================================================================
describe('🚫 endereço torto não vira URL — ele vira RECUSA com o motivo', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { lerDestinatarios, recusaDeDestinatario, parseDestinatarios } = require('../sefaz-backend/email-destinatarios-helper.js');

    it('o caso do print: barra dentro do endereço é recusado NOMEANDO o valor', () => {
        const r = lerDestinatarios('marcio07/MD@gmail.com');
        expect(r.validos).toEqual([]);
        expect(r.invalidos[0].valor).toBe('marcio07/MD@gmail.com');
        const frase = recusaDeDestinatario(r);
        expect(frase).toMatch(/marcio07\/MD@gmail\.com/);
        expect(frase).toMatch(/Dados Fiscais/);
        // 🚨 E a frase DIZ por que o Outlook não ajuda — senão a pessoa volta a
        // procurar no app.
        expect(frase).toMatch(/Something went wrong/);
    });

    it('dois e-mails colados por @ também são recusados, com a saída', () => {
        const frase = recusaDeDestinatario(lerDestinatarios('a@x.com.br@y.com'));
        expect(frase).toMatch(/mais de um @/);
        expect(frase).toMatch(/ponto e vírgula/);
    });

    // ⚠️ ENDEREÇO TORTO NÃO É DESCARTADO EM SILÊNCIO NEM COM UM VÁLIDO DO LADO:
    // se a equipe pôs dois, é porque os dois têm de receber. Mandar só para um
    // seria a guia chegando pela metade sem ninguém saber.
    it('um válido não apaga o torto', () => {
        const r = lerDestinatarios('bom@cliente.com.br; ruim/2@cliente.com.br');
        expect(r.validos).toEqual(['bom@cliente.com.br']);
        expect(recusaDeDestinatario(r)).toMatch(/ruim\/2@cliente\.com\.br/);
    });

    it('lista legítima passa e vai inteira para o To', () => {
        const r = lerDestinatarios('um@x.com.br; dois@y.com.br');
        expect(r.validos).toEqual(['um@x.com.br', 'dois@y.com.br']);
        expect(recusaDeDestinatario(r)).toBeNull();
        const link = montarLinkOutlookWeb({ para: 'um@x.com.br; dois@y.com.br' });
        expect(decodeURIComponent(link)).toContain('to=um@x.com.br;dois@y.com.br');
    });

    // ⚠️ `Nome <a@b>` é forma legítima de colagem — fica o que está entre < >.
    it('aceita a forma Nome <email>', () => {
        expect(lerDestinatarios('<maria@cliente.com.br>').validos).toEqual(['maria@cliente.com.br']);
    });

    it('campo vazio diz onde preencher', () => {
        expect(recusaDeDestinatario(lerDestinatarios(''))).toMatch(/ausente/);
    });

    // ⚠️ A POLÍTICA DE ENV NÃO MUDOU: ali descartar é aceitável (há fallback e
    // o destinatário é da casa). Duas políticas, um parse só.
    it('parseDestinatarios (env) continua descartando e caindo no fallback', () => {
        expect(parseDestinatarios('lixo, bom@x.com.br')).toEqual(['bom@x.com.br']);
        expect(parseDestinatarios('', 'padrao@x.com.br')).toEqual(['padrao@x.com.br']);
    });

    // 🚨 E O MAILTO CODIFICA CADA ENDEREÇO: `encodeURIComponent` na lista
    // inteira viraria a vírgula em %2C e os dois virariam UM endereço inválido.
    it('mailto com dois destinatários mantém a vírgula separando', () => {
        const link = montarMailtoEnvio({ para: 'um@x.com.br; dois@y.com.br' });
        expect(link.startsWith('mailto:um%40x.com.br,dois%40y.com.br')).toBe(true);
    });
});
