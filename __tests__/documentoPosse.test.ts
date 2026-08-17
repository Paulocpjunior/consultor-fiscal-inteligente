// ============================================================================
// 🚨 A MESMA NF-e É SAÍDA DE UMA EMPRESA E ENTRADA DA OUTRA — e a captura
// estava TROCANDO A NOTA DE DONA a cada rodada.
//
// Paulo, 17/08: *"importei as notas de saída da KROYA e algumas delas foram
// emitidas para a GOLDLOG. Para a KROYA, a NF-e é uma saída, enquanto para a
// GOLDLOG é uma entrada. Nesse caso, preciso importar/escriturar a mesma NF-e
// nas duas empresas?"*
//
// Sim, precisa — são dois contribuintes e dois livros. E o CFI não fazia: o id
// do documento é a CHAVE, então uma chave só comporta UM dono.
//
// O DANO QUE ESTE MÓDULO PARA: o importer, achando a chave com `empresaId`
// diferente, REATRIBUÍA o documento. Aquilo nasceu para o caso GUARANI (27/07 —
// notas SEM DONO, invisíveis em qualquer filtro por cliente) e nunca previu duas
// empresas da mesma carteira negociando entre si. Com as duas capturando, a nota
// muda de lado toda rodada e o livro de quem perdeu fica a menor EM SILÊNCIO.
//
// A régua: dono errado é dono que NÃO É PARTE do documento.
// ============================================================================
import {
    decidirPosseDocumento, ehParteDoDocumento, partesDoDocumento,
} from '../sefaz-backend/documento-posse.js';
import { lerDuplicado } from '../services/importDuplicadoMotivo';

const KROYA = '17390490000182';
const GOLDLOG = '09010732000137';
const TERCEIRO = '13344638000191';

/** A NF-e do caso: emitida pela KROYA para a GOLDLOG. */
const nfe = (over: any = {}) => ({
    chave: '3'.repeat(44),
    cnpjEmit: KROYA,
    cnpjDest: GOLDLOG,
    ...over,
});

describe('as partes do documento saem das DUAS formas', () => {
    it('forma CHATA (importer principal)', () => {
        expect(partesDoDocumento(nfe())).toEqual([KROYA, GOLDLOG]);
    });

    it('forma ANINHADA (sync-routes / abrasf)', () => {
        const doc = { emitente: { cnpjCpf: KROYA }, destinatario: { cnpjCpf: GOLDLOG } };
        expect(ehParteDoDocumento(doc, KROYA)).toBe(true);
        expect(ehParteDoDocumento(doc, GOLDLOG)).toBe(true);
    });

    it('CPF de produtor também é parte — a nota própria de entrada depende disso', () => {
        expect(ehParteDoDocumento({ cnpjEmit: KROYA, cpfDest: '12345678901' }, '123.456.789-01')).toBe(true);
    });

    it('quem não está no documento não é parte', () => {
        expect(ehParteDoDocumento(nfe(), TERCEIRO)).toBe(false);
    });

    it('documento sem participante nenhum não torna ninguém parte', () => {
        // Se isto devolvesse true, o módulo autorizaria justamente a troca que
        // ele existe para impedir.
        expect(partesDoDocumento({})).toEqual([]);
        expect(ehParteDoDocumento({}, KROYA)).toBe(false);
    });
});

describe('🚨 quando reatribuir é conserto e quando é roubo', () => {
    it('CONTRAPARTE LEGÍTIMA: as duas são partes — a nota NÃO muda de dona', () => {
        const r = decidirPosseDocumento({
            existente: { empresaId: 'kroya', empresaCnpj: KROYA, ...nfe() },
            pretendente: { empresaId: 'goldlog', empresaCnpj: GOLDLOG },
        });
        expect(r.situacao).toBe('contraparte-legitima');
        expect(r.reatribuir).toBe(false);
        expect(r.motivo).toMatch(/saída de uma e entrada da outra/);
    });

    it('e vale nos DOIS sentidos — quem captura por último não ganha a nota', () => {
        const r = decidirPosseDocumento({
            existente: { empresaId: 'goldlog', empresaCnpj: GOLDLOG, ...nfe() },
            pretendente: { empresaId: 'kroya', empresaCnpj: KROYA },
        });
        expect(r.reatribuir).toBe(false);
    });

    it('SEM DONO ainda é reatribuído — é o caso GUARANI, e ali reatribuir É o conserto', () => {
        const r = decidirPosseDocumento({
            existente: { empresaId: null, ...nfe() },
            pretendente: { empresaId: 'kroya', empresaCnpj: KROYA },
        });
        expect(r.situacao).toBe('sem-dono');
        expect(r.reatribuir).toBe(true);
    });

    it('DONO QUE NÃO É PARTE continua sendo corrigido', () => {
        const r = decidirPosseDocumento({
            existente: { empresaId: 'outra', empresaCnpj: TERCEIRO, ...nfe() },
            pretendente: { empresaId: 'kroya', empresaCnpj: KROYA },
        });
        expect(r.situacao).toBe('dono-nao-e-parte');
        expect(r.reatribuir).toBe(true);
    });

    it('🚨 dono com CNPJ NÃO GRAVADO não é declarado errado — ausência não é prova', () => {
        // Reatribuir aqui é decidir no escuro, que é exatamente o que estava
        // corrompendo dado. A nota fica onde está e o caso sai NOMEADO.
        const r = decidirPosseDocumento({
            existente: { empresaId: 'alguma', empresaCnpj: '', ...nfe() },
            pretendente: { empresaId: 'kroya', empresaCnpj: KROYA },
        });
        expect(r.situacao).toBe('posse-indeterminada');
        expect(r.reatribuir).toBe(false);
        expect(r.motivo).toMatch(/CNPJ dele não está gravado/);
    });

    it('mesma empresa não é reatribuição', () => {
        const r = decidirPosseDocumento({
            existente: { empresaId: 'kroya', empresaCnpj: KROYA, ...nfe() },
            pretendente: { empresaId: 'kroya', empresaCnpj: KROYA },
        });
        expect(r.situacao).toBe('mesmo-dono');
        expect(r.reatribuir).toBe(false);
    });

    it('captura sem empresa não atribui a ninguém', () => {
        const r = decidirPosseDocumento({
            existente: { empresaId: 'kroya', empresaCnpj: KROYA, ...nfe() },
            pretendente: { empresaId: '' },
        });
        expect(r.situacao).toBe('sem-pretendente');
        expect(r.reatribuir).toBe(false);
    });
});

describe('🚨 o importer usa a régua — núcleo sem leitor não protege ninguém', () => {
    const fonte = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'sefaz-backend/xml-importer.js'), 'utf8');

    it('importa e chama decidirPosseDocumento antes de trocar a dona', () => {
        expect(fonte).toMatch(/import \{ decidirPosseDocumento \} from '\.\/documento-posse\.js'/);
        // A guarda tem que vir ANTES do update que reatribui.
        const iGuarda = fonte.indexOf('decidirPosseDocumento({');
        const iUpdate = fonte.indexOf('reatribuidoEm:');
        expect(iGuarda).toBeGreaterThan(0);
        expect(iGuarda).toBeLessThan(iUpdate);
    });

    it('e a recusa sai NOMEADA — nota que não entrou e ninguém soube é buraco escondido', () => {
        expect(fonte).toMatch(/posse: posse\.situacao/);
        expect(fonte).toMatch(/motivoPosse: posse\.motivo/);
    });
});

describe('🚨 a mensagem da importação manual dava o conselho ERRADO', () => {
    const empresaKroya = { id: 'kroya', nome: 'KROYA IMPORTADORA', cnpj: KROYA };

    it('contraparte na carteira: DIZ que ninguém errou e aponta a saída', () => {
        // A frase antiga mandava "corrigir na origem" — ou seja, cobrar do
        // cliente uma nota que está perfeita.
        const r = lerDuplicado(
            { empresaId: 'goldlog', empresaNome: 'GOLDLOG', empresaCnpj: GOLDLOG, origem: 'sefaz', ...nfe() } as any,
            empresaKroya,
        );
        expect(r.situacao).toBe('contraparte-na-carteira');
        expect(r.acao).toMatch(/Ninguém errou/);
        expect(r.acao).toMatch(/CHAVE EM BRANCO/);
        expect(r.acao).not.toMatch(/corrigida na origem/);
    });

    it('dono que NÃO é parte continua com a mensagem antiga', () => {
        const r = lerDuplicado(
            { empresaId: 'outra', empresaNome: 'OUTRA LTDA', empresaCnpj: TERCEIRO, origem: 'manual', ...nfe() } as any,
            empresaKroya,
        );
        expect(r.situacao).toBe('em-outra-empresa');
        expect(r.acao).toMatch(/corrigida na origem/);
    });

    it('a lápide continua vencendo as duas — reincluir é a ação certa lá', () => {
        const r = lerDuplicado(
            { empresaId: 'goldlog', empresaCnpj: GOLDLOG, _deleted: true, ...nfe() } as any,
            empresaKroya,
        );
        expect(r.situacao).toBe('excluido-pode-reincluir');
        expect(r.permiteReincluir).toBe(true);
    });
});
