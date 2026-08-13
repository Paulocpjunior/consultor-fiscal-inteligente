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
    const CLIENTES = [
        'sefaz-backend/envio-imposto-routes.js',        // anexo do e-mail + documento do WhatsApp
        'components/Das/CobrancaModal.tsx',             // DAS
        'components/DCTFWeb/DetalheDeclaracao.tsx',     // DARF
        'components/LucroPresumidoReal/DareSpModal.tsx', // DARE
    ];

    it('quem manda ao cliente importa o núcleo', () => {
        for (const arquivo of CLIENTES) {
            expect(ler(arquivo)).toMatch(/nomeArquivoGuia/);
        }
    });

    /**
     * A VARREDURA, e por que ela existe.
     *
     * A primeira volta desta trava listava dois arquivos e dava a coisa por
     * feita — e o DARF e o DARE continuaram saindo com `darf_<CNPJ>_202607.pdf`
     * para o cliente. Lista escrita à mão cobre o que a pessoa lembrou.
     *
     * Agora quem manda a chamada é o VERBO: toda chamada de envio ao cliente
     * (`enviarGuiaPeloServidor`, `enviarGuiaPorWhatsapp`, `enviarPorEmailDoColaborador`,
     * `pdfFileName:`) tem que carregar um nome que veio do núcleo — nunca um
     * template com CNPJ.
     */
    it('nenhum caminho de ENVIO remonta o nome com o CNPJ', () => {
        // Nome de arquivo montado com CNPJ, em qualquer forma.
        const NOME_COM_CNPJ = /`[a-z]+_[^`]*\$\{[^`]*[Cc]npj[^`]*\.pdf`|pdfFileName: `[^`]*[Cc]npj/;
        // …que é LEGÍTIMO só quando o destino é o disco do colaborador.
        const EH_DOWNLOAD = /download/i;

        const infratores: string[] = [];
        for (const arquivo of CLIENTES) {
            ler(arquivo).split('\n').forEach((linha, i) => {
                if (NOME_COM_CNPJ.test(linha) && !EH_DOWNLOAD.test(linha)) {
                    infratores.push(`${arquivo}:${i + 1} → ${linha.trim().slice(0, 80)}`);
                }
            });
        }
        expect(infratores).toEqual([]);
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
