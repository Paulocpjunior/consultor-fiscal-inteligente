# Firebase Security Rules — Consultor Fiscal Inteligente

Sugestão de regras para o Firestore e o Cloud Storage cobrindo a Central
de Documentos Fiscais (XML) e mantendo compatibilidade com os módulos
existentes (Simples Nacional, Lucro Presumido/Real, autenticação).

## Arquivos

- `firestore.rules` — coleções `users`, `access_logs`, `simples_empresas`,
  `simples_notas`, `empresas_lucro`, `obrigacoes`, **`documentos_fiscais`**,
  **`xml_capturas`**, **`xml_erros`** e **`empresas_xml_config`**.
- `storage.rules` — caminho `xmls/{empresaId}/{file}` com limite de 10 MB
  e validação de content-type.

## Modelo de permissão

- Master admin: `junior@spassessoriacontabil.com.br`.
- Outros admins: documento em `users/{uid}` com `role == 'admin'`.
- Colaboradores: enxergam apenas o que criaram (`createdBy == uid` para
  documentos fiscais e empresas; `usuarioId == uid` para logs/erros).
- Default deny em qualquer coleção/caminho não listado.

## Como publicar

> ⚠️ Antes de publicar, **revise as regras das coleções existentes** que
> já estão no Console — esses arquivos são uma proposta consolidada,
> não necessariamente o estado atual da sua produção. Consolide com o
> que estiver lá hoje.

### Firestore

1. Firebase Console → Firestore Database → aba **Rules**.
2. Copie o conteúdo de `firestore.rules` e cole no editor.
3. Use **Rules Playground** para validar:
   - usuário autenticado lendo `documentos_fiscais` em que é `createdBy`;
   - usuário autenticado tentando ler `documentos_fiscais` de outro uid (deve falhar);
   - master admin lendo qualquer documento (deve passar).
4. **Publish**.

### Cloud Storage

1. Firebase Console → Storage → aba **Rules**.
2. Copie o conteúdo de `storage.rules` e cole.
3. **Publish**.

## Deploy via CLI (alternativo)

Se preferir versionar via Firebase CLI no futuro, adicione um
`firebase.json` na raiz com:

```json
{
  "firestore": { "rules": "firebase/firestore.rules" },
  "storage":   { "rules": "firebase/storage.rules" }
}
```

E publique com:

```bash
firebase deploy --only firestore:rules,storage:rules
```

## Verificação rápida pós-deploy

1. Login como colaborador comum.
2. Importe um XML válido em **Importa XML → Importação Manual**.
3. Confira no Console:
   - **Firestore**: documento criado em `documentos_fiscais` com
     `createdBy == seu_uid`; log em `xml_capturas`; nenhum erro em
     `xml_erros`.
   - **Storage**: arquivo em `xmls/{empresaId}/{chave}.xml`.
4. Tente importar o mesmo XML de novo — deve aparecer "duplicado".
5. Login como admin (master) e confirme que enxerga documentos importados
   por outros usuários.
