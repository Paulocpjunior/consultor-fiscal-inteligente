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
