import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchema, compareStates } from './published-backup-restore.mjs';

test('canonicalizes only equivalent constant varchar-array casts',()=>{
  const original="CHECK (tipo = ANY ((ARRAY['producto'::character varying, 'servicio'::character varying])::text[]))";
  const restored="CHECK (tipo = ANY (ARRAY[('producto'::character varying)::text, ('servicio'::character varying)::text]))";
  assert.equal(normalizeSchema(original),normalizeSchema(restored));
  assert.notEqual(normalizeSchema(original),normalizeSchema(restored.replace("'servicio'","'extra'")));
  assert.notEqual(normalizeSchema(original),normalizeSchema(restored.replace("'servicio'::character varying",'NULL::character varying')));
  assert.notEqual(normalizeSchema(original),normalizeSchema(restored.replace('tipo =','otro =')));
  assert.notEqual(normalizeSchema(original),normalizeSchema(original.replace('::text[]','::integer[]')));
});

test('does not treat changed rows or sequence positions as successful restore',()=>{
  const before={relations:[],tables:{'public.example':{count:1,sha256:'original'}},sequenceStates:{seq:{last_value:'2',is_called:true}},
    largeObjects:[],largeObjectData:[],extensions:[],databaseSettings:[],schemaObjects:[],roleDependencies:[],identity:{encoding:'UTF8'}};
  assert.doesNotThrow(()=>compareStates(before,structuredClone(before)));
  const changed=structuredClone(before);changed.tables['public.example'].sha256='different';
  assert.throws(()=>compareStates(before,changed),/ROW_CONTENT_DIFFERS/);
  const sequence=structuredClone(before);sequence.sequenceStates.seq.last_value='1';
  assert.throws(()=>compareStates(before,sequence),/SEQUENCESTATES_DIFFERS/);
});
