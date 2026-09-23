// ============================================================================
// 🔒 O CAMINHO VELHO NÃO PODE VOLTAR POR NENHUMA PORTA
//
// 02/09. `Empresas/{grupo}/DEPARTAMENTO FISCAL/{ano}/{mês}-{ano}/{empresa}/…`
// não existe no SharePoint — foi medido clique a clique. Ele estava escrito em
// TRÊS lugares (auto-sync, envio da guia e a tela), e corrigir dois deixaria o
// terceiro produzindo 404 em silêncio.
//
// ⚠️ Por VARREDURA e não por lista: caminho novo escrito à mão em outro módulo
// entra aqui sozinho. Lista envelhece no primeiro arquivo novo — e envelhece
// em SILÊNCIO, que é exatamente como esta divergência viveu.
// ============================================================================
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
// 🐛 O STRIPPER DE COMENTÁRIO DE BLOCO ENGOLE O ARQUIVO — é o defeito de
// 26/08 (o `/*` dentro de string comeu 105 KB do server.js), e ele mordeu de
// novo aqui: `/^(\d{4})-(\d{2})$/` num regex do código faz o casamento
// atravessar o arquivo e a varredura lê meia fonte, acusando código certo.
// ⚠️ Saem só comentário de LINHA e linhas de bloco que começam com `*`.
const semComentario = (s: string) => s
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

function arquivosDe(dir: string, exts: string[], achados: string[] = []): string[] {
    for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) arquivosDe(rel, exts, achados);
        else if (exts.some(x => e.name.endsWith(x))) achados.push(rel);
    }
    return achados;
}

// A assinatura do caminho MORTO — literal, e ESTREITA.
//
// 🐛 A primeira versão também casava `${mes}-${ano}` solto, e acusou o
// `rotina-fiscal.js`, onde isso é a CHAVE do faturamento do Simples
// ('MM-AAAA'), não um caminho. Alarme sobre código certo é o jeito conhecido
// de a equipe desligar a trava — a assinatura exige o contexto do SharePoint.
const CAMINHO_MORTO = /DEPARTAMENTO FISCAL\/\$\{|\/DEPARTAMENTO FISCAL\/'/;

describe('🔒 o caminho velho não é montado em lugar nenhum', () => {
    const fontes = [
        ...arquivosDe('sefaz-backend', ['.js']),
        ...arquivosDe('services', ['.ts']),
        ...arquivosDe('components', ['.tsx', '.ts']),
        ...arquivosDe('proxy-backend', ['.js']),
    ];

    // 🚨 Guarda contra o SILÊNCIO FALSO: se o glob quebrar, a varredura
    // passaria verde sem ler nada.
    it('a varredura tem o que ler', () => {
        expect(fontes.length).toBeGreaterThan(50);
    });

    it('ninguém monta `DEPARTAMENTO FISCAL/{ano}/{mês}-{ano}`', () => {
        const culpados = fontes.filter(f => CAMINHO_MORTO.test(semComentario(readFileSync(join(RAIZ, f), 'utf8'))));
        expect(culpados).toEqual([]);
    });
});

describe('🧭 os dois trilhos que gravam usam o DONO', () => {
    const autoSync = semComentario(readFileSync(join(RAIZ, 'sefaz-backend/sharepoint-auto-sync.js'), 'utf8'));
    const envio = semComentario(readFileSync(join(RAIZ, 'sefaz-backend/envio-imposto.js'), 'utf8'));
    const serviceTela = semComentario(readFileSync(join(RAIZ, 'services/sharePointXmlService.ts'), 'utf8'));

    it('o auto-sync acha a pasta pelo código e monta pelo dono', () => {
        expect(autoSync).toMatch(/from '\.\/caminho-sharepoint\.js'/);
        expect(autoSync).toMatch(/resolverPastaDaEmpresa\(empresa, pastasDeEmpresas\)/);
        expect(autoSync).toMatch(/caminhoFiscal\(\{ pastaEmpresa: achado\.pasta/);
    });

    // ⚠️ UMA leitura por RODADA, não por empresa: ~400 idas ao Graph seriam o
    // HTTP 429 de 27/08 com outra roupa.
    // 🐛 A JANELA NASCEU LARGA e acusou código CERTO (a sétima vez do vício):
    // ela ia do laço até o FIM DO ARQUIVO e engolia a rota `/status`, que lista
    // as pastas UMA vez por requisição — exatamente o que esta trava exige.
    // A janela fecha onde o laço fecha.
    it('as pastas são lidas uma vez por rodada, fora do laço', () => {
        const ini = autoSync.indexOf('for (const empresa of empresas)');
        const fim = autoSync.indexOf('const totalNovos', ini);
        const laco = autoSync.slice(ini, fim > ini ? fim : undefined);
        expect(laco).not.toMatch(/listarPastasDeEmpresas\(\)/);
        expect(autoSync).toMatch(/pastasDeEmpresas = await listarPastasDeEmpresas\(\)/);
    });

    // ⚠️ Falhar a listagem é FATAL e vai DITO: sem ela nenhuma empresa resolve,
    // e 416 linhas de "pasta não encontrada" mandariam criar 416 pastas.
    it('listagem que falha vira erroFatal, não 416 falsos negativos', () => {
        expect(autoSync).toMatch(/Não foi possível listar as pastas de \$\{PASTA_RAIZ\}/);
    });

    it('o envio da guia acha a pasta pelo dono', () => {
        expect(envio).toMatch(/from '\.\/sharepoint-pastas\.js'/);
        expect(envio).toMatch(/resolverPastaDaEmpresa\(empresa\?\.data\)/);
    });

    it('a tela usa o mesmo dono — senão promete um caminho que o backend não usa', () => {
        expect(serviceTela).toMatch(/caminhoFiscal\(\{ pastaEmpresa, ano, mes, direcao \}\)/);
    });
});

// ============================================================================
// 🚦 AS TRÊS CAUSAS TÊM AÇÃO PRÓPRIA — e a frase de cada uma é RÉGUA
//
// "não achei", "achei duas" e "o cadastro não tem código" pedem coisas
// OPOSTAS. Eu já tinha escrito essas três frases DUAS vezes quando percebi que
// a segunda cópia estava nascendo: quatro trilhos precisam delas, e quatro
// cópias divergiriam no primeiro ajuste — o colaborador leria instruções
// diferentes para o mesmo problema.
// ============================================================================
describe('🚦 cada situação da resolução tem AÇÃO própria — num dono só', () => {
    const dono = readFileSync(join(RAIZ, 'sefaz-backend/sharepoint-pastas.js'), 'utf8');

    it('as três causas são ditas separadas', () => {
        expect(dono).toMatch(/sem Cod\.Cliente no cadastro/);
        expect(dono).toMatch(/MAIS DE UMA pasta com o código/);
        expect(dono).toMatch(/Nenhuma pasta com o código/);
        // ⚠️ E o app NÃO cria a pasta da empresa: criaria uma duplicada.
        expect(dono).toMatch(/NÃO cria a pasta/);
    });

    // ⚠️ Falha de LEITURA não é "pasta não existe": dizer isso mandaria criar
    // uma pasta que provavelmente já está lá.
    it('falha ao listar não vira "pasta não existe"', () => {
        expect(dono).toMatch(/Não foi possível listar/);
    });

    // 🚨 Os QUATRO trilhos que gravam usam o dono — nenhum escreve a frase.
    const trilhos = [
        'sefaz-backend/sharepoint-auto-sync.js',
        'sefaz-backend/envio-imposto.js',
        'sefaz-backend/cofre-sharepoint-arquivo.js',
        'sefaz-backend/reinf-retencoes-pj-routes.js',
    ];
    for (const t of trilhos) {
        it(`${t} usa o dono, não uma cópia da frase`, () => {
            const fonte = semComentario(readFileSync(join(RAIZ, t), 'utf8'));
            expect(fonte).toMatch(/from '\.\/sharepoint-pastas\.js'/);
            expect(fonte).not.toMatch(/MAIS DE UMA pasta com o código/);
        });
    }
});
