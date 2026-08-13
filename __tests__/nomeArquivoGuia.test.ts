// ============================================================================
// O NOME DO ARQUIVO DA GUIA — a única marca nossa que o cliente vê no anexo.
//
// 13/08, Paulo, depois do primeiro envio pelo template aprovado: *"de alguma
// forma conseguimos alterar o papel de parede para o nosso?"*. O papel de parede
// é ajuste do aparelho de QUEM RECEBE — nenhuma API muda isso. Mas acima do
// ícone do PDF o WhatsApp mostra o NOME DO ARQUIVO, e ali saía
// `das_63787066000193_2026-07.pdf`: nome de máquina, com o CNPJ cru na tela do
// cliente, num arquivo feito para ser reencaminhado.
//
// A trava aqui tem duas metades: o formato (abaixo) e a CÓPIA ÚNICA — o nome
// estava escrito três vezes, e três cópias do mesmo formato mandam a mesma guia
// com dois nomes diferentes por dois canais no mesmo dia.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { nomeArquivoGuia, competenciaNoNome } from '../sefaz-backend/nome-arquivo-guia.js';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

describe('nomeArquivoGuia', () => {
    it('sai no formato que o cliente lê', () => {
        expect(nomeArquivoGuia({ tipo: 'DAS', competencia: '2026-07' }))
            .toBe('DAS 07-2026 - SP Assessoria Contabil.pdf');
        expect(nomeArquivoGuia({ tipo: 'darf', competencia: '2026-12' }))
            .toBe('DARF 12-2026 - SP Assessoria Contabil.pdf');
    });

    it('mês na frente do ano — é como a competência se lê em português', () => {
        expect(competenciaNoNome('2026-07')).toBe('07-2026');
    });

    it('NÃO leva o CNPJ: o cliente sabe de quem é a guia, e o arquivo é reencaminhado', () => {
        const nome = nomeArquivoGuia({ tipo: 'DAS', competencia: '2026-07' });
        expect(nome).not.toMatch(/\d{11,}/);
    });

    it('acento e caractere proibido não chegam ao anexo (mojibake e Windows)', () => {
        const nome = nomeArquivoGuia({ tipo: 'DAS', competencia: '2026-07', assinatura: 'SP Assessoria Contábil' });
        expect(nome).toBe('DAS 07-2026 - SP Assessoria Contabil.pdf');
        expect(nomeArquivoGuia({ tipo: 'D/A:S', competencia: '2026-07' })).not.toMatch(/[\\/:*?"<>|]/);
    });

    it('sem dado não inventa nem quebra — o anexo precisa de UM nome', () => {
        expect(nomeArquivoGuia({})).toBe('GUIA - SP Assessoria Contabil.pdf');
        expect(nomeArquivoGuia({ tipo: 'DAS', competencia: 'lixo' })).toMatch(/^DAS lixo - /);
    });
});

describe('MATA-BURRO: o nome do anexo mora num lugar só', () => {
    const CLIENTES = ['sefaz-backend/envio-imposto-routes.js', 'components/Das/CobrancaModal.tsx'];

    it('quem manda ao cliente importa o núcleo', () => {
        for (const arquivo of CLIENTES) {
            expect(ler(arquivo)).toMatch(/nomeArquivoGuia/);
        }
    });

    it('nenhum caminho de ENVIO remonta o nome com o CNPJ', () => {
        // A assinatura literal do formato antigo: tipo + CNPJ + competência.
        const ANTIGO = /\$\{String\(tipo\)\.toLowerCase\(\)\}_\$\{String\(empresaCnpj\)/;
        const ANTIGO_TSX = /`das_\$\{String\(dasInfo\.empresaCnpj/;
        expect(ler('sefaz-backend/envio-imposto-routes.js')).not.toMatch(ANTIGO);
        expect(ler('components/Das/CobrancaModal.tsx')).not.toMatch(ANTIGO_TSX);
    });

    // O DOWNLOAD do colaborador é OUTRA coisa, e continua com o CNPJ de
    // propósito: ali os arquivos caem todos na mesma pasta de Downloads, de
    // dezenas de empresas, e "DAS 07-2026" repetido oito vezes é o que faz
    // perder o arquivo. Nome bonito é para quem recebe; nome que distingue é
    // para quem arquiva.
    it('o download interno NÃO é alvo desta régua (nomes servem a leitores diferentes)', () => {
        expect(ler('components/Das/index.tsx')).toMatch(/const nomeArquivoDas/);
    });
});
