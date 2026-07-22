/**
 * Checklist de migração do cofre de saída: quem já recebe mod 55 via e-mail
 * (cofre CFI) × quem ainda depende da SIEG (falta configurar o e-mail).
 */
import { modeloDaChave, analisarChecklistCofre } from '../sefaz-backend/cofre-checklist';

const AGORA = new Date('2026-07-22T12:00:00Z').getTime();
const DIA = 24 * 3600 * 1000;
const iso = (diasAtras: number) => new Date(AGORA - diasAtras * DIA).toISOString();

// chave com modelo nas posições 20-21
const chave = (modelo: string) => `35260767267435000178${modelo}0010000012341${'0'.repeat(9)}`.slice(0, 44);

describe('modeloDaChave', () => {
    it('extrai modelo das posições 20-21', () => {
        expect(modeloDaChave(chave('55'))).toBe('55');
        expect(modeloDaChave(chave('65'))).toBe('65');
    });
    it('null para chave inválida', () => {
        expect(modeloDaChave('123')).toBeNull();
        expect(modeloDaChave(null)).toBeNull();
    });
});

describe('analisarChecklistCofre', () => {
    const empresas = [
        { empresaId: 'a', cnpj: '11111111000111', nome: 'Apatel', regime: 'lucro' },
        { empresaId: 'b', cnpj: '22222222000122', nome: 'Beta', regime: 'lucro' },
        { empresaId: 'c', cnpj: '33333333000133', nome: 'Gama', regime: 'simples' },
        { empresaId: 'd', cnpj: '44444444000144', nome: 'Delta Serviços', regime: 'simples' },
    ];
    const docsSaida = [
        // Apatel: cofre ativo (saída via email há 2 dias)
        { empresaCnpj: '11111111000111', chave: chave('55'), origem: 'email', dhEmi: iso(2) },
        { empresaCnpj: '11111111000111', chave: chave('55'), origem: 'email', dhEmi: iso(10) },
        // Beta: só saídas históricas SEM origem email (era SIEG) → falta migrar
        { empresaCnpj: '22222222000122', chave: chave('55'), origem: 'importacao-zip', dhEmi: iso(20) },
        // Gama: recebeu via cofre mas parou (45 dias) → cofre-parado
        { empresaCnpj: '33333333000133', chave: chave('55'), origem: 'email', dhEmi: iso(45) },
        // Delta: só NFC-e 65 (não conta) → sem-saida-55
        { empresaCnpj: '44444444000144', chave: chave('65'), origem: 'email', dhEmi: iso(1) },
        // órfão
        { empresaCnpj: '99999999000199', chave: chave('55'), origem: 'email', dhEmi: iso(1) },
    ];

    const r = analisarChecklistCofre({ empresas, docsSaida, agoraMs: AGORA, inatividadeDias: 30 });

    it('classifica: ativo / falta-migrar / parado / sem-saida-55', () => {
        const por = Object.fromEntries(r.linhas.map(l => [l.cnpj, l]));
        expect(por['11111111000111'].status).toBe('cofre-ativo');
        expect(por['22222222000122'].status).toBe('falta-migrar');
        expect(por['33333333000133'].status).toBe('cofre-parado');
        expect(por['44444444000144'].status).toBe('sem-saida-55');
    });

    it('ordena pior primeiro (falta-migrar no topo)', () => {
        expect(r.linhas[0].cnpj).toBe('22222222000122');
    });

    it('mod 65 não conta como saída 55; órfão vai pro contador', () => {
        const delta = r.linhas.find(l => l.cnpj === '44444444000144')!;
        expect(delta.totalSaidas55).toBe(0);
        expect(r.resumo.docsSemEmpresa).toBe(1);
    });

    it('resumo agregado', () => {
        expect(r.resumo).toMatchObject({
            totalEmpresas: 4, comSaida55: 3,
            cofreAtivo: 1, cofreParado: 1, faltaMigrar: 1, semSaida55: 1,
            inatividadeDias: 30,
        });
    });

    it('última saída via cofre registrada', () => {
        const apatel = r.linhas.find(l => l.cnpj === '11111111000111')!;
        expect(apatel.viaCofre).toBe(2);
        expect(apatel.ultimaSaidaCofreMs).toBe(AGORA - 2 * DIA);
    });
});
