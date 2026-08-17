// ============================================================================
// Anexo no atendimento — as duas lacunas 🔴 BLOQUEANTES do de-para com a
// Ultra Fox (receber e abrir · enviar). A régua do TIPO sai do MIME, e o
// LIMITE é o menor entre a Meta e o corpo da requisição.
// ============================================================================
import {
    LIMITES_META, LIMITE_CORPO_BYTES, tipoDaMidia, nomeSeguroDeArquivo,
    validarAnexo, montarMensagemMidia, legendaSeraIgnorada, resumoDoAnexo,
} from '../sefaz-backend/whatsapp-midia.js';

describe('tipo da mídia — sai do MIME, não da extensão', () => {
    it('imagem, áudio e vídeo pelos mimes que a Meta aceita', () => {
        expect(tipoDaMidia('image/jpeg')).toBe('image');
        expect(tipoDaMidia('image/png')).toBe('image');
        expect(tipoDaMidia('audio/ogg; codecs=opus')).toBe('audio');
        expect(tipoDaMidia('video/mp4')).toBe('video');
    });
    it('o resto vira document — o balde genérico LEGÍTIMO da Meta, não chute', () => {
        expect(tipoDaMidia('application/pdf')).toBe('document');
        expect(tipoDaMidia('application/vnd.ms-excel')).toBe('document');
        expect(tipoDaMidia('')).toBe('document');
        expect(tipoDaMidia(null)).toBe('document');
    });
    it('nome de arquivo é texto livre do usuário — some caminho e caractere de controle', () => {
        expect(nomeSeguroDeArquivo('../../etc/passwd')).toBe('....etcpasswd');
        expect(nomeSeguroDeArquivo('   ', 'image')).toBe('imagem.jpg');
        expect(nomeSeguroDeArquivo('', 'audio')).toBe('audio.ogg');
        expect(nomeSeguroDeArquivo('comprovante.pdf')).toBe('comprovante.pdf');
    });
});

/** Estreita a união pro lado da RECUSA (e falha o teste se tiver passado). */
function recusa(r: ReturnType<typeof validarAnexo>): { ok: false; erro: string; acao: string } {
    if (r.ok) throw new Error('esperava recusa, o anexo foi aceito');
    return r;
}

describe('validação do anexo', () => {
    it('arquivo VAZIO é recusa própria (tamanho 0 costuma ser leitura que falhou)', () => {
        const r = recusa(validarAnexo({ mime: 'image/jpeg', tamanhoBytes: 0, nomeArquivo: 'x.jpg' }));
        expect(r.erro).toContain('vazio');
        expect(validarAnexo({ mime: 'image/jpeg', tamanhoBytes: NaN }).ok).toBe(false);
    });

    it('imagem acima de 5 MB é recusada DIZENDO o limite da Meta e a saída', () => {
        const r = recusa(validarAnexo({ mime: 'image/jpeg', tamanhoBytes: LIMITES_META.image + 1, nomeArquivo: 'foto.jpg' }));
        expect(r.erro).toContain('5,0 MB');
        expect(r.erro).toContain('limite da Meta');
        expect(r.acao).toContain('Reduza');
    });

    it('o limite do DOCUMENTO é o do CORPO, não os 100 MB da Meta — recusar com o número errado seria a recusa mentindo', () => {
        // Documento de 30 MB: a Meta aceitaria, o express.json({limit:'20mb'}) não.
        const r = recusa(validarAnexo({ mime: 'application/pdf', tamanhoBytes: 30 * 1024 * 1024, nomeArquivo: 'balanco.pdf' }));
        expect(r.erro).toContain('limite de envio do app');
        expect(LIMITE_CORPO_BYTES).toBeLessThan(LIMITES_META.document);
    });

    it('o caso comum passa e já devolve tipo e nome tratados', () => {
        const r = validarAnexo({ mime: 'application/pdf', tamanhoBytes: 250 * 1024, nomeArquivo: 'guia DAS.pdf' });
        expect(r).toEqual({ ok: true, tipo: 'document', nome: 'guia DAS.pdf' });
    });
});

describe('corpo da mensagem de mídia', () => {
    it('document leva filename; image leva caption', () => {
        const doc = montarMensagemMidia({ para: '5511964440000', tipo: 'document', mediaId: 'M1', nomeArquivo: 'guia.pdf', legenda: 'segue a guia' });
        expect(doc).toEqual({
            messaging_product: 'whatsapp', to: '5511964440000', type: 'document',
            document: { id: 'M1', filename: 'guia.pdf', caption: 'segue a guia' },
        });
        const img = montarMensagemMidia({ para: '5511964440000', tipo: 'image', mediaId: 'M2', legenda: 'olha' });
        expect(img.image).toEqual({ id: 'M2', caption: 'olha' });
        expect(img.image.filename).toBeUndefined();
    });

    it('ÁUDIO não tem legenda na Cloud API — o app não manda texto que sumiria, e AVISA', () => {
        const audio = montarMensagemMidia({ para: '5511964440000', tipo: 'audio', mediaId: 'M3', legenda: 'ouve isso' });
        expect(audio.audio).toEqual({ id: 'M3' });
        expect(legendaSeraIgnorada('audio', 'ouve isso')).toBe(true);
        expect(legendaSeraIgnorada('document', 'ouve isso')).toBe(false);
        expect(legendaSeraIgnorada('audio', '')).toBe(false);
    });

    it('resumo do anexo entra na lista de conversas com ícone por tipo', () => {
        expect(resumoDoAnexo('image', 'foto.jpg', null)).toBe('🖼️ foto.jpg');
        expect(resumoDoAnexo('document', 'guia.pdf', 'segue')).toBe('📎 guia.pdf — segue');
    });
});
