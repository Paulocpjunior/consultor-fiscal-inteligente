'use strict';
const assert = require('node:assert/strict');
const { criarServico, validarCadastro, registrar } = require('../gestao-acessos.cjs');
function ambiente(aplicativo) {
  const docs = new Map(), identities = new Map(); let serial=0, failProfile=false;
  const campo=aplicativo==='cci'?'permissoesCci':'permissoesCfi';
  const admin=aplicativo==='cci'?{is_admin:true}:{role:'admin'};
  const clone=x=>x===undefined?undefined:structuredClone(x);
  const ref=(c,id)=>({path:c+'/'+id,id,async update(p){docs.set(this.path,{...docs.get(this.path),...clone(p)});}});
  const db={collection:c=>({doc:id=>ref(c,id||'log'+(++serial))}),async runTransaction(fn){const writes=[];const out=await fn({get:async r=>({exists:docs.has(r.path),data:()=>clone(docs.get(r.path))}),set:(r,d)=>writes.push([r,d,false]),update:(r,d)=>writes.push([r,d,true])});if(failProfile&&writes.some(([r])=>r.path.startsWith('users/')))throw Error('indisponivel');for(const [r,d,merge]of writes)docs.set(r.path,merge?{...docs.get(r.path),...clone(d)}:clone(d));return out;}};
  const notFound=()=>{throw Object.assign(Error('missing'),{code:'auth/user-not-found'})};
  const auth={async getUser(uid){return clone(identities.get(uid)||notFound());},async getUserByEmail(email){return clone([...identities.values()].find(u=>u.email===email)||notFound());},async createUser(u){identities.set(u.uid,clone(u));return clone(u);},async updateUser(uid,p){identities.set(uid,{...identities.get(uid),...clone(p)});},async generatePasswordResetLink(){return 'https://example.test/reset?token=redacted';}};
  const efetivas=u=>u?.[campo]||{nivel:'consulta',acoes:{}};
  docs.set('users/admin',admin);docs.set('users/target',{email:'pessoa@spassessoriacontabil.com.br',... (aplicativo==='cci'?{is_admin:false}:{role:'colaborador'})});identities.set('target',{uid:'target',email:'pessoa@spassessoriacontabil.com.br',disabled:false});
  return {db,auth,docs,identities,campo,service:criarServico({db,auth,aplicativo,efetivas}),failProfile:v=>{failProfile=v;}};
}
(async()=>{
  for(const bad of [{nome:'Ana',email:'ana@outro.com'},{nome:'A',email:'a@spassessoriacontabil.com.br'},{nome:'Ana',email:'ana@spassessoriacontabil.com.br',role:'admin'}])assert.throws(()=>validarCadastro(bad));
  for(const aplicativo of ['cci','cfi']){
    const e=ambiente(aplicativo),autor={uid:'admin',email:'admin@spassessoriacontabil.com.br'};
    await assert.rejects(e.service.alterar({uid:'intruso'},'target',{ativo:true,revisao:0}),x=>x.status===403);
    await assert.rejects(e.service.alterar(autor,'admin',{ativo:true,revisao:0}),x=>x.status===400);
    await e.service.alterar(autor,'target',{ativo:true,revisao:0});
    let d=e.docs.get('users/target');assert.equal(d.gestorAcessos,true);assert.equal(aplicativo==='cci'?d.is_admin:d.role,true=== (aplicativo==='cci')?true:'admin');assert(Object.values(d[e.campo].acoes).every(Boolean));assert.equal(d[aplicativo==='cci'?'role':'is_admin'],undefined,'não escreve papel do outro app');
    assert.equal([...e.docs.keys()].filter(k=>k.startsWith('permissoes_auditoria/')).length,1);
    await assert.rejects(e.service.alterar(autor,'target',{ativo:false,revisao:0}),x=>x.status===409);
    await e.service.alterar(autor,'target',{ativo:false,revisao:1});d=e.docs.get('users/target');assert.equal(d.gestorAcessos,false);assert.equal(aplicativo==='cci'?d.is_admin:d.role,aplicativo==='cci'?true:'admin','retirar gestão mantém admin explicitamente');
    await e.service.alterar(autor,'target',{ativo:false,revisao:2},'admin');d=e.docs.get('users/target');assert.equal(d.gestorAcessos,false);assert.equal(aplicativo==='cci'?d.is_admin:d.role,aplicativo==='cci'?false:'colaborador');
    await assert.rejects(e.service.alterar(autor,'inexistente',{ativo:true,revisao:0}),x=>x.status===409);
    e.identities.get('target').disabled=true;await assert.rejects(e.service.alterar(autor,'target',{ativo:true,revisao:3}),x=>x.status===409);
    const payload={nome:'Nova Pessoa',email:'nova@spassessoriacontabil.com.br'};
    await assert.rejects(e.service.cadastrar({uid:'intruso'},payload),x=>x.status===403);assert.equal(e.identities.size,1);
    e.failProfile(true);await assert.rejects(e.service.cadastrar(autor,payload));const pendente=[...e.identities.values()].find(u=>u.email===payload.email);assert.equal(pendente.disabled,true,'falha no banco não deixa login habilitado');assert(!e.docs.has('users/'+pendente.uid));
    e.failProfile(false);const novo=await e.service.cadastrar(autor,payload);assert.equal(novo.uid,pendente.uid,'retomada não duplica conta');assert(novo.linkSenha);d=e.docs.get('users/'+novo.uid);assert.equal(d.gestorAcessos,false);assert.equal(d[e.campo].nivel,'consulta');assert(Object.values(d[e.campo].acoes).every(v=>v===false));assert.equal(e.identities.get(novo.uid).disabled,false);assert.equal(e.identities.get(novo.uid).password,undefined,'admin não escolhe senha');
    const antes=structuredClone(d);await assert.rejects(e.service.cadastrar(autor,payload),x=>x.status===409);assert.deepEqual(e.docs.get('users/'+novo.uid),antes);
    await assert.rejects(e.service.cadastrar(autor,{nome:'Pessoa',email:'pessoa@spassessoriacontabil.com.br'}),x=>x.status===409);
    const routes=[];const gate=()=>{};registrar({post:(p,g)=>routes.push([p,g]),put:(p,g)=>routes.push([p,g])},{db:e.db,auth:e.auth,aplicativo,efetivas:x=>x,adminRequired:gate});assert.equal(routes.length,3);assert(routes.every(([,g])=>g===gate),'todas as rotas exigem admin');
  }
  console.log('Gestão de acessos: nomeação, isolamento, auditoria, concorrência, revogação, cadastro seguro e retomada aprovados nos dois aplicativos.');
})().catch(e=>{console.error(e);process.exitCode=1;});
