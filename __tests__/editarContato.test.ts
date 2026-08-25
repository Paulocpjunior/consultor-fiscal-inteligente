// ============================================================================
// ✏️ EDITAR CONTATO — o campo que o servidor grava e ninguém podia preencher
// ----------------------------------------------------------------------------
// Paulo, 25/08: "não possuímos a opção de EDITAR contato, para que assim
// possamos usar os flags, se cliente, ou não salvar e completar o necessário".
//
// 🚨 O PATCH `/contatos/:numero` aceita `nome` e `observacao` desde que os
// contatos nasceram — e NENHUM botão os mandava. Só as etiquetas e o
// consentimento tinham caminho. É a "rota sem botão" (13/08) na versão CAMPO:
// parece entrega, o servidor grava, e quem precisa do campo conclui que o app
// não faz — que foi exatamente o que aconteceu.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const tela = ler('components/SpConnect/index.tsx');
const rotas = ler('sefaz-backend/whatsapp-routes.js');
const servico = ler('services/spConnectService.ts');

describe('o cadastro do contato tem caminho na tela', () => {
    it('existe ✏️ Editar no contato escolhido', () => {
        expect(tela).toMatch(/✏️ Editar/);
        expect(tela).toMatch(/const salvarCadastroDoContato = async/);
    });

    it('e ele manda os DOIS campos que o backend aceita', () => {
        expect(tela).toMatch(/atualizarContato\(c\.numero, \{ nome: nome\.trim\(\), observacao: observacao\.trim\(\) \}\)/);
        expect(rotas).toMatch(/req\.body\?\.nome !== undefined/);
        expect(rotas).toMatch(/req\.body\?\.observacao !== undefined/);
        expect(servico).toMatch(/etiquetas\?: string\[\]; nome\?: string; observacao\?: string;/);
    });

    it('a observação VOLTA na listagem — senão salvaria e sumiria', () => {
        // A armadilha da whitelist (#382): campo gravado que não volta na
        // leitura faz a tela mostrar vazio e a pessoa digitar de novo.
        expect(rotas).toMatch(/observacao: c\.observacao \|\| null/);
    });
});

describe('a edição não mente sobre o que foi gravado', () => {
    it('o rascunho é TEXTO no estado e só vira dado no Salvar', () => {
        // Editar direto no objeto faria a lista mudar antes de o servidor
        // aceitar — e um erro deixaria a tela mostrando o que não foi gravado.
        expect(tela).toMatch(/const \[ctEdit, setCtEdit\] = useState<\{ nome: string; observacao: string \} \| null>\(null\)/);
    });

    it('a lista concorda com o salvo na hora (senão a pessoa salva duas vezes)', () => {
        expect(tela).toMatch(/setContatos\(\(l\) => l\.map\(\(x\) => \(x\.numero === c\.numero \? atualizado : x\)\)\)/);
    });

    it('trocar de contato FECHA o rascunho — ele não vaza de uma pessoa para outra', () => {
        expect(tela).toMatch(/setCtSel\(ctSel\?\.numero === c\.numero \? null : c\); setCtEdit\(null\);/);
    });

    it('e a tela diz ONDE se troca a categoria (não há campo dela neste bloco)', () => {
        // Aviso que aponta um lugar tem de apontar um lugar que a pessoa ACHA:
        // sem esta frase, ela procuraria um campo "categoria" que não existe
        // aqui — ela vive nas etiquetas logo abaixo.
        expect(tela).toMatch(/se troca nas 🏷 etiquetas logo abaixo|nas 🏷 etiquetas logo abaixo/);
    });
});
