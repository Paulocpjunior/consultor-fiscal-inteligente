/**
 * Checklist de migração da saída mod 55 — v2 reconhece os DOIS trilhos
 * automáticos (cofre de e-mail E autXML). A v1 só olhava o cofre: empresa com
 * saídas chegando NO DIA via autXML aparecia "Falta migrar" (caso Eduardo
 * Guerra, print do Paulo 30/07).
 */
import { modeloDaChave, trilhoAutomatico, analisarChecklistCofre } from '../sefaz-backend/cofre-checklist';

const AGORA = new Date('2026-07-22T12:00:00Z').getTime();
const DIA = 24 * 3600 * 1000;
const iso = (diasAtras: number) => new Date(AGORA - diasAtras * DIA).toISOString();

// chave real: cUF(2) AAMM(4) CNPJ-emitente(6-20) modelo(20-22) série nNF...
// O CNPJ do emitente ENTRA na chave — o guard de dono-errado compara a raiz
// da chave com a raiz do dono do doc.
const chave = (modelo: string, cnpjEmit = '67267435000178') =>
    `352607${cnpjEmit}${modelo}0010000012341${'0'.repeat(9)}`.slice(0, 44);

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

describe('trilhoAutomatico', () => {
    it('email → cofre; sefaz/autxml → autxml', () => {
        expect(trilhoAutomatico('email')).toBe('cofre');
        expect(trilhoAutomatico('sefaz')).toBe('autxml');
        expect(trilhoAutomatico('autxml')).toBe('autxml');
    });
    it('importação manual/conferência/consulta-chave NÃO confirma trilho', () => {
        expect(trilhoAutomatico('manual')).toBeNull();
        expect(trilhoAutomatico('sharepoint_auto')).toBeNull();
        expect(trilhoAutomatico('sefaz', 'consulta-chave-importar')).toBeNull();
        expect(trilhoAutomatico('sefaz', 'conferencia-sieg')).toBeNull();
        expect(trilhoAutomatico('importacao-zip')).toBeNull();
    });
});

describe('analisarChecklistCofre (v2 — cofre + autXML)', () => {
    const empresas = [
        { empresaId: 'a', cnpj: '11111111000111', nome: 'Apatel', regime: 'lucro' },
        { empresaId: 'b', cnpj: '22222222000122', nome: 'Beta', regime: 'lucro' },
        { empresaId: 'c', cnpj: '33333333000133', nome: 'Gama', regime: 'simples' },
        { empresaId: 'd', cnpj: '44444444000144', nome: 'Delta Serviços', regime: 'simples' },
        { empresaId: 'e', cnpj: '55555555000155', nome: 'Eduardo Guerra', regime: 'lucro' },
    ];
    const docsSaida = [
        // Apatel: cofre ativo (saída via email há 2 dias)
        { empresaCnpj: '11111111000111', chave: chave('55', '11111111000111'), origem: 'email', dhEmi: iso(2) },
        { empresaCnpj: '11111111000111', chave: chave('55', '11111111000111'), origem: 'email', dhEmi: iso(10) },
        // Beta: só saídas históricas SEM trilho automático (era SIEG) → falta migrar
        { empresaCnpj: '22222222000122', chave: chave('55', '22222222000122'), origem: 'importacao-zip', dhEmi: iso(20) },
        // Gama: recebeu via cofre mas parou (45 dias) → parado
        { empresaCnpj: '33333333000133', chave: chave('55', '33333333000133'), origem: 'email', dhEmi: iso(45) },
        // Delta: só NFC-e 65 (não conta) → sem-saida-55
        { empresaCnpj: '44444444000144', chave: chave('65', '44444444000144'), origem: 'email', dhEmi: iso(1) },
        // Eduardo Guerra (o caso do print): saídas chegando HOJE via autXML,
        // zero via cofre — na v1 era "falta migrar"; agora é ATIVO · autXML.
        { empresaCnpj: '55555555000155', chave: chave('55', '55555555000155'), origem: 'sefaz', dhEmi: iso(0) },
        { empresaCnpj: '55555555000155', chave: chave('55', '55555555000155'), origem: 'sefaz', dhEmi: iso(1) },
        // importação por consulta-chave não muda o status (não confirma trilho)
        { empresaCnpj: '22222222000122', chave: chave('55', '22222222000122'), origem: 'sefaz', dhEmi: iso(3), capturadoPor: { fonte: 'consulta-chave-importar' } },
        // órfão
        { empresaCnpj: '99999999000199', chave: chave('55', '99999999000199'), origem: 'email', dhEmi: iso(1) },
        // DONO ERRADO (caso S&P 31/07): saída atribuída à Apatel mas a CHAVE tem
        // emitente de OUTRA raiz — não pode contar pra Apatel (nem pra ninguém).
        { empresaCnpj: '11111111000111', chave: chave('55', '67267435000178'), origem: 'autxml', dhEmi: iso(1) },
    ];

    const r = analisarChecklistCofre({ empresas, docsSaida, agoraMs: AGORA, inatividadeDias: 30 });
    const por = Object.fromEntries(r.linhas.map(l => [l.cnpj, l]));

    it('classifica: ativo (cofre) / falta-migrar / parado / sem-saida-55', () => {
        expect(por['11111111000111'].status).toBe('ativo');
        expect(por['11111111000111'].trilho).toBe('cofre');
        expect(por['22222222000122'].status).toBe('falta-migrar');
        expect(por['33333333000133'].status).toBe('parado');
        expect(por['44444444000144'].status).toBe('sem-saida-55');
    });

    it('CASO DO PRINT: saída chegando via autXML = ATIVO · autXML (não "falta migrar")', () => {
        expect(por['55555555000155'].status).toBe('ativo');
        expect(por['55555555000155'].trilho).toBe('autxml');
        expect(por['55555555000155'].viaAutXml).toBe(2);
        expect(por['55555555000155'].viaCofre).toBe(0);
    });

    it('importação via consulta-chave não vira trilho automático', () => {
        expect(por['22222222000122'].viaAutXml).toBe(0);
        expect(por['22222222000122'].totalSaidas55).toBe(2);
    });

    it('ordena pior primeiro (falta-migrar no topo)', () => {
        expect(r.linhas[0].cnpj).toBe('22222222000122');
    });

    it('mod 65 não conta como saída 55; órfão vai pro contador', () => {
        expect(por['44444444000144'].totalSaidas55).toBe(0);
        expect(r.resumo.docsSemEmpresa).toBe(1);
    });

    it('DONO ERRADO (caso S&P): saída com chave de outra raiz NÃO conta pra empresa atribuída', () => {
        // Apatel segue com 2 saídas (as legítimas) — o doc de terceiro é descartado
        expect(por['11111111000111'].totalSaidas55).toBe(2);
        expect(por['11111111000111'].viaAutXml).toBe(0);
        expect(r.resumo.docsDonoErrado).toBe(1);
    });

    it('resumo agregado com quebra por trilho', () => {
        expect(r.resumo).toMatchObject({
            totalEmpresas: 5, comSaida55: 4,
            ativos: 2, ativosCofre: 1, ativosAutXml: 1,
            parados: 1, faltaMigrar: 1, semSaida55: 1,
            inatividadeDias: 30,
        });
    });

    it('última saída por trilho registrada', () => {
        expect(por['11111111000111'].viaCofre).toBe(2);
        expect(por['11111111000111'].ultimaSaidaCofreMs).toBe(AGORA - 2 * DIA);
        expect(por['55555555000155'].ultimaAutoMs).toBe(AGORA);
    });
});
