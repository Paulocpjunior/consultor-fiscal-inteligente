/**
 * I/O dos parâmetros de retenção — a régua mora em `retencao-parametros.js`.
 *
 * Este arquivo só fala com o Firestore. Toda decisão (vigência, alíquota,
 * fundamento obrigatório, o que sugerir) é do núcleo PURO, que o backend também
 * pode ler: duas leituras da mesma pergunta divergiriam no primeiro ajuste.
 */
import {
    collection, query, where, getDocs, addDoc, updateDoc, doc,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import {
    validarParametroRetencao,
    type ParametroRetencao,
} from '../sefaz-backend/retencao-parametros.js';

const COLECAO = 'retencao_parametros';

/**
 * Os parâmetros da empresa. Falha de leitura devolve `[]` — o parâmetro é um
 * palpite melhor, não uma trava: sem ele a digitação segue funcionando, só sem
 * a sugestão. Derrubar a tela por causa dele seria pior que não tê-lo.
 */
export async function lerParametrosRetencao(empresaId: string): Promise<ParametroRetencao[]> {
    if (!empresaId) return [];
    try {
        const snap = await getDocs(query(
            collection(db, COLECAO),
            where('empresaId', '==', empresaId),
        ));
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ParametroRetencao[];
    } catch {
        return [];
    }
}

export async function gravarParametroRetencao(p: Omit<ParametroRetencao, 'ativo'>): Promise<void> {
    const erros = validarParametroRetencao(p);
    if (erros.length) throw new Error(erros.join(' '));
    await addDoc(collection(db, COLECAO), {
        empresaId: p.empresaId,
        cnpjPrestador: String(p.cnpjPrestador).replace(/\D/g, ''),
        nomePrestador: p.nomePrestador || null,
        tributo: p.tributo,
        aliquota: Number(p.aliquota),
        fundamento: String(p.fundamento).trim(),
        vigenciaInicio: p.vigenciaInicio,
        ativo: true,
        criadoPor: p.criadoPor,
        criadoEm: new Date().toISOString(),
    });
}

/**
 * Desligar NÃO apaga: o parâmetro continua explicando as competências que ele
 * já datou. É a mesma decisão do cérebro do CFOP — e as rules só permitem o
 * update destas três chaves.
 */
export async function desligarParametroRetencao(id: string, porEmail: string): Promise<void> {
    if (!id) throw new Error('Parâmetro sem id.');
    await updateDoc(doc(db, COLECAO, id), {
        ativo: false,
        desligadoPor: porEmail || null,
        desligadoEm: new Date().toISOString(),
    });
}
