/**
 * sageCodigosService — De→Para de códigos de participante do E-Fiscal, por
 * empresa-cliente.
 *
 * O E-Fiscal do cliente já tem clientes/fornecedores cadastrados com códigos
 * internos próprios (ex.: "6UU0LLF9X"). Quando o .FML manda o participante com
 * nosso código-CNPJ, ele recusa ("CNPJ já cadastrado com outro Código de
 * Faturamento") e TODAS as notas daquele participante caem junto (E200 campo
 * 08). Este mapa guarda o código EXISTENTE lá: participante mapeado não gera
 * E010 e as notas saem referenciando o cadastro que o E-Fiscal já tem.
 *
 * Doc único por empresa em `sage_codigos_participantes` (id = empresaId):
 *   { codigos: { [cnpjSoDigitos]: codigoNoEfiscal }, atualizadoEm, atualizadoPor }
 *
 * Alimentado pelo leitor do log de erros do E-Fiscal (Exportar SAGE).
 * Modelo shared-write (single-tenant): qualquer logado grava — quem opera a
 * exportação é o colaborador, e ele precisa fechar o ciclo sem esperar admin.
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ufValida } from './ufsBrasil';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';

const COLLECTION = 'sage_codigos_participantes';

const soDigitos = (s: string): string => (s || '').replace(/\D+/g, '');

export async function carregarCodigosParticipantes(empresaId: string): Promise<Record<string, string>> {
    if (!isFirebaseConfigured || !db || !empresaId) return {};
    try {
        const snap = await getDoc(doc(db, COLLECTION, empresaId));
        const codigos = (snap.data()?.codigos || {}) as Record<string, string>;
        // Normaliza as chaves (só dígitos) — a exportação busca assim.
        const limpo: Record<string, string> = {};
        for (const [k, v] of Object.entries(codigos)) {
            const cnpj = soDigitos(k);
            if (cnpj && String(v || '').trim()) limpo[cnpj] = String(v).trim();
        }
        return limpo;
    } catch (e) {
        console.warn('[sageCodigos] leitura falhou:', e);
        return {};
    }
}

/** Grava/mescla códigos novos no mapa da empresa (merge — não apaga os demais). */
export async function salvarCodigosParticipantes(
    empresaId: string,
    novos: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured || !db) return { ok: false, error: 'Firebase não configurado.' };
    if (!empresaId) return { ok: false, error: 'Escolha a empresa antes de salvar o De→Para.' };
    const codigos: Record<string, string> = {};
    for (const [k, v] of Object.entries(novos)) {
        const cnpj = soDigitos(k);
        const cod = String(v || '').trim();
        if (cnpj && cod) codigos[cnpj] = cod.slice(0, 20);
    }
    if (Object.keys(codigos).length === 0) return { ok: false, error: 'Nenhum código preenchido.' };
    try {
        // setDoc + merge faz merge PROFUNDO do mapa `codigos`: os CNPJs novos
        // entram sem apagar os já gravados.
        await setDoc(doc(db, COLLECTION, empresaId), {
            codigos,
            atualizadoEm: serverTimestamp(),
            atualizadoPor: auth?.currentUser?.email || null,
        }, { merge: true });
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message || 'Falha ao gravar o De→Para.' };
    }
}

// ─── UF do participante informada à mão ─────────────────────────────────────
//
// POR QUE EXISTE (equipe via Paulo, 05/08 — NOVA ERA travada em 170 notas):
// o E-Fiscal recusa o E010 sem UF (campo 10) e, sem o participante, as notas
// dele caem junto. Havia dois caminhos e nenhum resolvia esse resto: "Corrigir
// endereços" relê o XML (não adianta quando o XML não traz o endereço) e
// "Resolver UF pela base" precisa que o participante tenha emitido alguma nota
// capturada.
//
// E a armadilha que custou o dia da equipe: corrigir o cadastro DENTRO DO
// E-FISCAL não muda nada aqui — o app monta o E010 com o dado do XML
// capturado, não lê o cadastro de lá. Ou o participante entra no De→Para
// (com o código que já existe lá, e aí nem precisa de E010), ou a UF é
// informada aqui.
//
// Guardado no MESMO doc do De→Para (chave `ufs`) porque é a mesma decisão
// sobre o mesmo participante, da mesma empresa.

export { ufValida } from './ufsBrasil';

export async function carregarUfsParticipantes(empresaId: string): Promise<Record<string, string>> {
    if (!isFirebaseConfigured || !db || !empresaId) return {};
    try {
        const snap = await getDoc(doc(db, COLLECTION, empresaId));
        const ufs = (snap.data()?.ufs || {}) as Record<string, string>;
        const limpo: Record<string, string> = {};
        for (const [k, v] of Object.entries(ufs)) {
            const cnpj = soDigitos(k);
            const uf = String(v || '').trim().toUpperCase();
            if (cnpj && ufValida(uf)) limpo[cnpj] = uf;
        }
        return limpo;
    } catch (e) {
        console.warn('[sageCodigos] leitura de UFs falhou:', e);
        return {};
    }
}

/** Grava/mescla UFs informadas à mão. UF inválida é RECUSADA, não corrigida. */
export async function salvarUfsParticipantes(
    empresaId: string,
    novas: Record<string, string>,
): Promise<{ ok: boolean; error?: string; gravadas?: number }> {
    if (!isFirebaseConfigured || !db) return { ok: false, error: 'Firebase não configurado.' };
    if (!empresaId) return { ok: false, error: 'Escolha a empresa antes de salvar as UFs.' };
    const ufs: Record<string, string> = {};
    const invalidas: string[] = [];
    for (const [k, v] of Object.entries(novas)) {
        const cnpj = soDigitos(k);
        const uf = String(v || '').trim().toUpperCase();
        if (!cnpj || !uf) continue;
        // UF errada no E010 vira escrituração errada — melhor recusar aqui do
        // que gerar um arquivo que o E-Fiscal aceita com o estado trocado.
        if (!ufValida(uf)) { invalidas.push(`${cnpj}: "${uf}"`); continue; }
        ufs[cnpj] = uf;
    }
    if (invalidas.length) {
        return { ok: false, error: `UF inválida em ${invalidas.join(', ')}. Use a sigla de 2 letras (ex.: SP, MG, EX para exterior).` };
    }
    if (Object.keys(ufs).length === 0) return { ok: false, error: 'Nenhuma UF preenchida.' };
    try {
        await setDoc(doc(db, COLLECTION, empresaId), {
            ufs,
            atualizadoEm: serverTimestamp(),
            atualizadoPor: auth?.currentUser?.email || null,
        }, { merge: true });
        return { ok: true, gravadas: Object.keys(ufs).length };
    } catch (e: any) {
        return { ok: false, error: e?.message || 'Falha ao gravar as UFs.' };
    }
}
