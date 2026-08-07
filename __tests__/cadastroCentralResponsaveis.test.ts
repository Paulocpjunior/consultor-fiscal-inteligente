/**
 * FASE 2 DO TÚNEL DO CADASTRO: quem responde por este cliente.
 *
 * A fase 1 respondeu "este CNPJ existe?". Esta responde a seguinte, que é a
 * que trava o trabalho do outro app: "e quem eu procuro quando ele tiver
 * problema?" — hoje a resposta sai por WhatsApp, de memória.
 *
 * O que os testes travam é o COMPORTAMENTO NA AUSÊNCIA e NO CONFLITO, que é
 * onde um cadastro central mente com mais facilidade.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { montarResponsaveis, normalizarResponsavel, responsavelDoCnpj } from '../sefaz-backend/cadastro-central-responsaveis';

const EMPRESA = { id: 'e1', cnpj: '51227692000146', nome: 'CLINIPAR LTDA', regime: 'simples' };
const OUTRA = { id: 'e2', cnpj: '44388152000189', nome: 'SP ASSESSORIA', regime: 'lucro' };

const ana = { uid: 'u1', nome: 'Ana Souza', email: 'ana@spassessoriacontabil.com.br', role: 'colaborador' };
const bruno = { uid: 'u2', nome: 'Bruno Lima', email: 'bruno@spassessoriacontabil.com.br', role: 'colaborador' };

const vinculo = (over: any = {}) => ({
    empresaId: 'e1', empresaCnpj: '51.227.692/0001-46', empresaNome: 'CLINIPAR LTDA',
    colaboradorUid: 'u1', colaboradorNome: 'Ana Souza', papel: 'principal', ...over,
});

const montar = (over: any = {}) => montarResponsaveis({
    empresas: [EMPRESA], vinculos: [vinculo()], usuarios: [ana], ...over,
});

describe('o caso normal: um principal, com e-mail', () => {
    it('responde quem é, e o e-mail vem junto — é dele que o outro app precisa', () => {
        const l = montar().linhas[0];
        expect(l.principal.nome).toBe('Ana Souza');
        expect(l.principal.email).toBe('ana@spassessoriacontabil.com.br');
        expect(l.conflito).toBeNull();
        expect(l.pendenteDeAtribuicao).toBe(false);
    });

    it('o CNPJ sai em dígitos mesmo com o vínculo gravado com máscara', () => {
        // É o contrato do túnel — foi consultar por igualdade de CNPJ que
        // produziu "CNPJ não cadastrado" para empresa cadastrada (07/08).
        expect(montar().linhas[0].cnpj).toBe('51227692000146');
    });

    it('acha pelo CNPJ em qualquer grafia', () => {
        const { linhas } = montar();
        expect(responsavelDoCnpj(linhas, '51.227.692/0001-46').nome).toBe('CLINIPAR LTDA');
        expect(responsavelDoCnpj(linhas, '51227692000146').nome).toBe('CLINIPAR LTDA');
        expect(responsavelDoCnpj(linhas, '123')).toBeNull();
    });

    it('backup vem separado do principal, não misturado', () => {
        const l = montar({
            vinculos: [vinculo(), vinculo({ colaboradorUid: 'u2', colaboradorNome: 'Bruno Lima', papel: 'backup' })],
            usuarios: [ana, bruno],
        }).linhas[0];
        expect(l.principal.uid).toBe('u1');
        expect(l.backups.map((b: any) => b.uid)).toEqual(['u2']);
        expect(l.responsaveis).toHaveLength(2);
    });
});

describe('DOIS principais NÃO viram escolha silenciosa', () => {
    const doisPrincipais = () => montar({
        vinculos: [vinculo(), vinculo({ colaboradorUid: 'u2', colaboradorNome: 'Bruno Lima', papel: 'principal' })],
        usuarios: [ana, bruno],
    });

    it('`principal` sai NULO — escolher um faria o outro app falar com a pessoa errada', () => {
        const l = doisPrincipais().linhas[0];
        expect(l.principal).toBeNull();
        expect(l.principais).toHaveLength(2);
    });

    it('o conflito é NOMEADO e aponta onde arrumar', () => {
        const l = doisPrincipais().linhas[0];
        expect(l.conflito).toMatch(/NÃO escolhe/);
        expect(l.conflito).toMatch(/aba Atribuição/);
        expect(doisPrincipais().resumo.comConflito).toBe(1);
    });

    it('nenhum dos dois some da lista — quem decide é gente', () => {
        expect(doisPrincipais().linhas[0].responsaveis.map((r: any) => r.uid).sort()).toEqual(['u1', 'u2']);
    });
});

describe('empresa SEM responsável não some', () => {
    it('vem na lista, marcada como pendência de atribuição', () => {
        const r = montar({ empresas: [EMPRESA, OUTRA] });
        const semDono = r.linhas.find((l: any) => l.cnpj === OUTRA.cnpj);
        expect(semDono.pendenteDeAtribuicao).toBe(true);
        expect(semDono.principal).toBeNull();
        expect(r.resumo.semResponsavel).toBe(1);
        expect(r.resumo.comResponsavel).toBe(1);
    });

    it('o aviso diz por que ela não foi filtrada', () => {
        const r = montar({ empresas: [EMPRESA, OUTRA] });
        expect(r.avisos.join(' ')).toMatch(/não somem/);
        expect(r.avisos.join(' ')).toMatch(/lista está completa/);
    });
});

describe('o nome VIVO vence a cópia, e a divergência acende', () => {
    it('vale o cadastro do usuário, não a cópia do dia da atribuição', () => {
        const l = montar({ usuarios: [{ ...ana, nome: 'Ana Souza Martins' }] }).linhas[0];
        expect(l.principal.nome).toBe('Ana Souza Martins');
        expect(l.principal.avisos.join(' ')).toMatch(/alguém precisa acertar o vínculo/);
    });

    it('sem divergência, nenhum aviso inventado', () => {
        expect(montar().linhas[0].principal.avisos).toEqual([]);
    });

    it('colaborador sem cadastro em `users`: o nome da cópia serve, o e-mail NÃO se inventa', () => {
        const l = montar({ usuarios: [] }).linhas[0];
        expect(l.principal.nome).toBe('Ana Souza');
        expect(l.principal.email).toBeNull();
        expect(l.principal.avisos.join(' ')).toMatch(/conta removida com vínculo esquecido/);
    });

    it('colaborador sem e-mail acende: sem ele o outro app não fala com ninguém', () => {
        const l = montar({ usuarios: [{ ...ana, email: '' }] }).linhas[0];
        expect(l.principal.email).toBeNull();
        expect(l.principal.avisos.join(' ')).toMatch(/não tem como falar com ele/);
    });
});

describe('vínculo órfão é contado, nunca engolido', () => {
    it('vínculo de empresa que saiu do cadastro vira linha própria com o motivo', () => {
        const r = montar({ vinculos: [vinculo(), vinculo({ empresaId: 'zzz', empresaCnpj: '11111111000191' })] });
        expect(r.resumo.vinculosOrfaos).toBe(1);
        expect(r.vinculosOrfaos[0].motivo).toMatch(/excluída, mesclada ou id trocado/);
        expect(r.avisos.join(' ')).toMatch(/ainda os vê como atribuídos/);
    });

    it('vínculo casa por CNPJ quando o empresaId está em branco', () => {
        // Atribuição antiga gravava só um dos dois.
        const l = montar({ vinculos: [vinculo({ empresaId: '' })] }).linhas[0];
        expect(l.principal.uid).toBe('u1');
    });
});

describe('ruído do cadastro não vira responsável a mais', () => {
    it('mesmo colaborador atribuído duas vezes conta uma', () => {
        const l = montar({ vinculos: [vinculo(), vinculo()] }).linhas[0];
        expect(l.responsaveis).toHaveLength(1);
        expect(l.conflito).toBeNull();
    });

    it('vínculo sem papel é principal — é o default da tela', () => {
        expect(montar({ vinculos: [vinculo({ papel: undefined })] }).linhas[0].principal.papel).toBe('principal');
    });

    it('vínculo sem colaboradorUid não vira responsável fantasma', () => {
        expect(normalizarResponsavel({ colaboradorNome: 'Fulano' }, null)).toBeNull();
        expect(montar({ vinculos: [vinculo({ colaboradorUid: '' })] }).linhas[0].pendenteDeAtribuicao).toBe(true);
    });
});

describe('cadastro vazio não passa por sucesso', () => {
    it('zero empresa é falha de leitura, e o aviso diz isso', () => {
        const r = montarResponsaveis({ empresas: [], vinculos: [], usuarios: [] });
        expect(r.resumo.empresas).toBe(0);
        expect(r.avisos.join(' ')).toMatch(/falha de leitura/);
    });

    it('chamada sem argumento nenhum não estoura', () => {
        expect(montarResponsaveis().linhas).toEqual([]);
    });
});
