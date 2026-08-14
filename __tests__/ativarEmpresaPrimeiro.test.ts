// ============================================================================
// ATIVAR EMPRESA É O PRIMEIRO PASSO — e antes dele o banco fica quieto.
//
// Paulo, 14/08: *"Ativar Empresa é o primeiro passo do colaborador, é isso que
// define o que ele pode ou não fazer e em qual empresa; além disso não
// carregamos nenhuma informação do banco de dados até que o colaborador ative a
// empresa, ganhamos tempo e agilidade"*.
//
// ═══ O QUE O APP FAZIA ══════════════════════════════════════════════════════
//
// Toda entrada no Painel Simples chamava `getAllNotas`, que é
// `fetchAllDocs('simples_notas')` — **todas as notas de TODAS as empresas da
// casa**, antes de alguém escolher qualquer coisa. Quem ia mexer em UMA empresa
// pagava a espera de ~400.
//
// ═══ A ARMADILHA QUE A CORREÇÃO CRIA, e que estas travas vigiam ═════════════
//
// Sem as notas, o resumo de cada empresa sairia RBT12 0,00 · alíquota 0,00% ·
// DAS 0,00. E **zero é uma resposta, não um "ainda não li"**: faturamento
// zerado numa empresa que fatura é a mentira mais cara que essa tela poderia
// contar, porque ninguém desconfia de um número — desconfia de um traço.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const app = ler('App.tsx');
const painel = ler('components/SimplesNacionalDashboard.tsx');
const secao = ler('components/sections/SimplesNacionalSection.tsx');
const servico = ler('services/simplesNacionalService.ts');

describe('o banco fica quieto até a ativação', () => {
    it('entrar no painel NÃO lê mais as notas de todas as empresas', () => {
        // `getAllNotas` continua existindo (há caminhos que precisam do
        // conjunto), mas o carregamento de ENTRADA não pode chamá-lo.
        const trecho = app.slice(app.indexOf('const loadSimplesData'), app.indexOf('const carregarNotasDaEmpresa'));
        expect(trecho).toMatch(/getEmpresas/);
        expect(trecho).not.toMatch(/getAllNotas/);
    });

    it('existe o carregamento POR EMPRESA, e ele consulta o servidor filtrado', () => {
        // Trazer tudo e filtrar no cliente seria pagar o mesmo preço com outro
        // nome — a consulta tem de ir com o empresaId.
        expect(servico).toMatch(/export const getNotasDaEmpresa/);
        expect(servico).toMatch(/fetchAllDocs\('simples_notas', \[where\('empresaId', '==', id\)\]\)/);
    });

    it('a ativação é o que dispara a leitura', () => {
        expect(app).toMatch(/onAtivarEmpresa=\{carregarNotasDaEmpresa\}/);
        expect(secao).toMatch(/onAtivarEmpresa\(id\)/);
    });

    it('reativar a mesma empresa não relê — e o force existe para o dado velho', () => {
        expect(app).toMatch(/if \(!force && simplesNotas\[id\]\) return;/);
        expect(app).toMatch(/carregarNotasDaEmpresa\(empresaId, true\)/);
    });

    it('importar numa empresa não relê o banco inteiro', () => {
        const trecho = app.slice(app.indexOf('const handleImportNotas'), app.indexOf('const handleImportNotas') + 1200);
        expect(trecho).not.toMatch(/getAllNotas/);
    });
});

describe('sem as notas, o número NÃO pode sair zero', () => {
    it('a linha sabe se a empresa foi ativada', () => {
        expect(painel).toMatch(/ativada: Object\.prototype\.hasOwnProperty\.call\(notas, empresa\.id\)/);
    });

    it.each([
        ['RBT12', /!e\.ativada \? AGUARDA : e\.resumo\.rbt12/],
        ['alíquota efetiva', /e\.ativada \? `\$\{e\.resumo\.aliq_eff\.toFixed\(2\)\}%` : AGUARDA/],
        ['DAS do mês', /e\.ativada \? e\.resumo\.das_mensal/],
        ['DAS estimado 12m', /e\.ativada \? e\.resumo\.das\./],
    ])('%s aparece como traço enquanto não foi lida', (_campo, padrao) => {
        expect(painel).toMatch(padrao);
    });

    it('e o traço DIZ por que está ali — traço mudo faz procurar defeito', () => {
        expect(painel).toMatch(/Ative a empresa para o app ler as notas dela/);
        expect(painel).toMatch(/Zero aqui seria mentira/);
    });
});

describe('o ⚡ Ativar é o mesmo da casa, e vem antes da lista', () => {
    it('usa o seletor único, não um <select> novo', () => {
        // Régua de 07/08: o seletor de empresa é UM só (busca por Cod.Cliente,
        // nome ou CNPJ). Escrever outro aqui criaria a segunda cópia.
        expect(painel).toMatch(/import EmpresaSearchSelect/);
        expect(painel).toMatch(/onAtivar=\{\(id: string\)/);
    });

    it('escolher não carrega — o clique é que commita', () => {
        // A régua de 05/08 vale onde escolher DISPARA carga, que é o caso aqui.
        expect(painel).toMatch(/const \[escolhida, setEscolhida\] = useState\(''\)/);
        expect(painel).toMatch(/⚡ Ative a empresa para começar/);
    });

    it('e a tela diz o que a ativação faz — senão o passo parece burocracia', () => {
        expect(painel).toMatch(/o app carrega só o cadastro/i);
    });

    it('o campo de baixo virou FILTRO da lista, não a busca principal', () => {
        // Dois campos de busca lado a lado, um que ativa e outro que filtra,
        // confundem — o de baixo passou a dizer o que faz.
        expect(painel).toMatch(/Filtrar a lista abaixo/);
    });
});
