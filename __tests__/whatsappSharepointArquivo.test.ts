// ============================================================================
// 🗄 Mídia do SP Connect → SharePoint (regra do manual, Paulo 21/08:
// "tudo que nao for msg de texto deve ser salvo no sharepoint") — com a
// árvore GENÉRICA que ele pediu no mesmo dia ("pasta generica dentro do
// Sharepoint, recebemos muitos curriculos de pessoas que nao sao nossos
// clientes"): o vínculo com empresa melhora o rótulo da pasta, nunca é
// pré-requisito.
// ============================================================================
// @ts-nocheck
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    RAIZ_SP_CONNECT, sanitizarComponenteSp, competenciaDaMensagem,
    pastaArquivoWhatsapp, elegivelParaArquivoWhatsapp, nomeArquivoSp,
} from '../sefaz-backend/whatsapp-sharepoint-arquivo.js';

describe('pasta no SharePoint — genérica, com o número SEMPRE no rótulo', () => {
    const base = { numero: '5511968664010', timestamp: '2026-08-21T18:00:00.000Z' };

    it('sem vínculo nem nome, a pasta é o número (o caso currículo/lead)', () => {
        expect(pastaArquivoWhatsapp(base)).toBe('SP Connect/2026/08-2026/5511968664010');
    });

    it('nome do perfil entra no rótulo — e o número fica junto (nome de WhatsApp repete)', () => {
        expect(pastaArquivoWhatsapp({ ...base, nomePerfil: 'Simone Cadoni' }))
            .toBe('SP Connect/2026/08-2026/Simone Cadoni - 5511968664010');
    });

    it('empresa vinculada VENCE o nome do perfil no rótulo', () => {
        expect(pastaArquivoWhatsapp({ ...base, nomePerfil: 'Mario', empresaNome: 'HYPE CAFE LTDA' }))
            .toBe('SP Connect/2026/08-2026/HYPE CAFE LTDA - 5511968664010');
    });

    it('o mês é o da MENSAGEM no fuso de SP — 21h UTC do dia 31/08 ainda é agosto; 03h UTC de 01/09 é agosto', () => {
        expect(competenciaDaMensagem('2026-08-31T21:00:00.000Z')).toEqual({ ano: '2026', mes: '08' });
        // 01/09 00:30 UTC = 31/08 21:30 em SP
        expect(competenciaDaMensagem('2026-09-01T00:30:00.000Z')).toEqual({ ano: '2026', mes: '08' });
        expect(competenciaDaMensagem('data-torta')).toBeNull();
    });

    it('sem número ou sem timestamp legível não inventa pasta', () => {
        expect(pastaArquivoWhatsapp({ numero: '', timestamp: base.timestamp })).toBeNull();
        expect(pastaArquivoWhatsapp({ numero: base.numero, timestamp: null })).toBeNull();
    });

    it('caracteres que o SharePoint recusa saem do rótulo — a pasta não pode falhar por causa do nome', () => {
        expect(sanitizarComponenteSp('A/B\\C:D*E?"F<G>H|I#J%K')).toBe('A B C D E F G H I J K');
        expect(sanitizarComponenteSp('  .pontas.  ')).toBe('pontas');
        expect(sanitizarComponenteSp('')).toBeNull();
        expect(sanitizarComponenteSp(null)).toBeNull();
    });

    it('a raiz é irmã de "Empresas", nunca dentro dela', () => {
        expect(RAIZ_SP_CONNECT).toBe('SP Connect');
        expect(pastaArquivoWhatsapp(base)!.startsWith('Empresas/')).toBe(false);
    });
});

describe('elegibilidade — quem sobe e quem fica, com o MOTIVO nomeado', () => {
    const doc = {
        conversaId: '5511968664010', direcao: 'entrada', tipo: 'image',
        timestamp: '2026-08-21T18:00:00.000Z',
        midia: { storagePath: 'whatsapp/5511968664010/wamid_X.jpg', mime: 'image/jpeg' },
    };

    it('mídia baixada e sem marca de arquivo = elegível', () => {
        expect(elegivelParaArquivoWhatsapp(doc)).toEqual({ ok: true });
    });

    it('já arquivada não sobe de novo (idempotência — reimportar não duplica)', () => {
        expect(elegivelParaArquivoWhatsapp({ ...doc, spArquivadoEm: new Date() }).motivo).toBe('ja-arquivado');
    });

    it('mensagem de texto e mídia AINDA não baixada ficam de fora — a segunda volta quando o download completar', () => {
        expect(elegivelParaArquivoWhatsapp({ ...doc, midia: null }).motivo).toBe('sem-midia-no-storage');
        expect(elegivelParaArquivoWhatsapp({ ...doc, midia: { metaMediaId: 'm1' } }).motivo).toBe('sem-midia-no-storage');
    });

    it('nota interna NUNCA sai da casa — mesmo com anexo, é conversa da equipe', () => {
        expect(elegivelParaArquivoWhatsapp({ ...doc, direcao: 'interna' }).motivo).toBe('nota-interna');
    });

    it('o nome do arquivo é o basename do Storage (único pelo wamid — dois "comprovante.pdf" não colidem)', () => {
        expect(nomeArquivoSp('whatsapp/5511/wamid_ABC_comprovante.pdf')).toBe('wamid_ABC_comprovante.pdf');
        expect(nomeArquivoSp('')).toBeNull();
    });
});

describe('🚨 fiação — módulo sem cron e sem botão é código morto com cara de entrega', () => {
    const cronRotas = readFileSync(join(__dirname, '..', 'sefaz-backend/xml-email-ingestor-routes.js'), 'utf8');
    const waRotas = readFileSync(join(__dirname, '..', 'sefaz-backend/whatsapp-routes.js'), 'utf8');
    const tela = readFileSync(join(__dirname, '..', 'components/SpConnect/index.tsx'), 'utf8');

    it('o cron do arquivo fiscal também roda o arquivador do WhatsApp (sem scheduler novo)', () => {
        expect(cronRotas).toMatch(/arquivarMidiasWhatsappNoSharePoint/);
        // Uma falha não pode derrubar a outra: cada arquivador com catch próprio.
        expect(cronRotas).toMatch(/arquivarNoSharePoint\(\{\}\)\s*\n?\s*\.catch/);
        expect(cronRotas).toMatch(/arquivarMidiasWhatsappNoSharePoint\(\{\}\)\s*\n?\s*\.catch/);
    });

    it('existe a rota admin manual (o botão precisa de porta)', () => {
        expect(waRotas).toMatch(/router\.post\('\/arquivo-sp', requireAdmin/);
    });

    it('a ⚙️ do Connect tem a aba e o botão que chama a rota (rota sem botão não é funcionalidade)', () => {
        expect(tela).toMatch(/'arquivo', '🗄 SharePoint'/);
        expect(tela).toMatch(/arquivarMidiasNoSharePoint\(\)/);
    });
});
