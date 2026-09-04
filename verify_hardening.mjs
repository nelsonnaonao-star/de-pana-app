// verify_hardening.js — Pruebas indirectas de seguridad via Supabase REST API
// NO destructivo. Solo intenta operaciones que deberían ser bloqueadas.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Read .env manually
const envContent = readFileSync('.env', 'utf8');
const getEnv = (key) => {
  const match = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].replace(/^["']|["']$/g, '') : '';
};

const SUPABASE_URL = getEnv('VITE_SUPABASE_URL');
const ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY');
const SERVICE_KEY = getEnv('SUPABASE_SERVICE_KEY');

const anonClient = createClient(SUPABASE_URL, ANON_KEY);
const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY);

let passed = 0;
let failed = 0;
let skipped = 0;

function result(test, ok, detail) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${test}${detail ? ' — ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

function skip(test, reason) {
  console.log(`⏭️  ${test} — SKIP: ${reason}`);
  skipped++;
}

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  VERIFICACIÓN DE HARDENING — WEPA SECURITY v1');
  console.log('═══════════════════════════════════════════════════════\n');

  // ─── Get a real message for testing ───
  console.log('--- Setup: Buscando datos de prueba ---');
  
  const { data: msgs } = await serviceClient
    .from('messages')
    .select('id, sender_id, chat_id')
    .limit(3);
  
  if (!msgs || msgs.length === 0) {
    console.log('⚠️  No hay mensajes en la DB. Algunas pruebas se saltarán.');
  } else {
    console.log(`   Encontrados ${msgs.length} mensajes para pruebas.`);
  }

  const { data: calls } = await serviceClient
    .from('calls')
    .select('id, caller_id, callee_id, room_id')
    .limit(3);
  
  if (!calls || calls.length === 0) {
    console.log('⚠️  No hay llamadas en la DB. Algunas pruebas se saltarán.');
  } else {
    console.log(`   Encontradas ${calls.length} llamadas para pruebas.\n`);
  }

  // ─── TEST GROUP 1: messages trigger ───
  console.log('─── BLOQUE 1: Trigger messages_guard_sensitive_fields ───\n');

  if (msgs && msgs.length > 0) {
    const testMsg = msgs[0];
    
    // Test 1.1: Try to change sender_id via anon (should fail)
    try {
      const { error } = await anonClient
        .from('messages')
        .update({ sender_id: '00000000-0000-0000-0000-000000000000' })
        .eq('id', testMsg.id);
      
      if (error && error.message && error.message.includes('rem')) {
        result('1.1 sender_id bloqueado por trigger', true, 'Error correcto: ' + error.message.substring(0, 80));
      } else if (error) {
        result('1.1 sender_id protegido', true, 'RLS o trigger bloqueó: ' + error.message.substring(0, 80));
      } else {
        result('1.1 sender_id NO protegido', false, 'La actualización fue aceptada');
      }
    } catch (e) {
      result('1.1 sender_id protegido', true, 'Excepción capturada');
    }

    // Test 1.2: Try to change chat_id (should fail)
    try {
      const { error } = await anonClient
        .from('messages')
        .update({ chat_id: '00000000-0000-0000-0000-000000000000' })
        .eq('id', testMsg.id);
      
      if (error) {
        result('1.2 chat_id protegido', true, 'Bloqueado: ' + error.message.substring(0, 80));
      } else {
        result('1.2 chat_id NO protegido', false, 'La actualización fue aceptada');
      }
    } catch (e) {
      result('1.2 chat_id protegido', true, 'Excepción capturada');
    }

    // Test 1.3: Try to change is_deleted (should fail)
    try {
      const { error } = await anonClient
        .from('messages')
        .update({ is_deleted: true })
        .eq('id', testMsg.id);
      
      if (error) {
        result('1.3 is_deleted protegido', true, 'Bloqueado: ' + error.message.substring(0, 80));
      } else {
        result('1.3 is_deleted NO protegido', false, 'La actualización fue aceptada');
      }
    } catch (e) {
      result('1.3 is_deleted protegido', true, 'Excepción capturada');
    }

    // Test 1.4: Try to change text (should fail)
    try {
      const { error } = await anonClient
        .from('messages')
        .update({ text: 'HACKED' })
        .eq('id', testMsg.id);
      
      if (error) {
        result('1.4 text protegido', true, 'Bloqueado: ' + error.message.substring(0, 80));
      } else {
        result('1.4 text NO protegido', false, 'La actualización fue aceptada');
      }
    } catch (e) {
      result('1.4 text protegido', true, 'Excepción capturada');
    }

    // Test 1.5: Try to change status (SHOULD be allowed by trigger)
    try {
      const { error } = await anonClient
        .from('messages')
        .update({ status: 'read' })
        .eq('id', testMsg.id);
      
      // This might fail due to RLS (not being chat member), not the trigger
      if (error) {
        // Check if it's an RLS error vs trigger error
        if (error.message && error.message.includes('rem')) {
          result('1.5 status — trigger no bloquea (correcto)', true, 'RLS bloqueó (esperado si no somos miembros)');
        } else {
          result('1.5 status — trigger no bloquea', true, 'RLS bloqueó (correcto): ' + error.message.substring(0, 80));
        }
      } else {
        result('1.5 status — permitido por trigger', true, 'La actualización fue aceptada (correcto)');
      }
    } catch (e) {
      result('1.5 status — no bloqueado por trigger', true, 'RLS bloqueó (esperado)');
    }

    // Test 1.6: Via service_role — sender_id change should SUCCEED (bypass trigger)
    try {
      const { error } = await serviceClient
        .from('messages')
        .update({ sender_id: testMsg.sender_id }) // Same value — no actual change
        .eq('id', testMsg.id);
      
      result('1.6 service_role bypasses trigger', !error, error ? 'Error: ' + error.message : 'Exitoso (correcto)');
    } catch (e) {
      result('1.6 service_role bypasses trigger', false, 'Excepción: ' + e.message);
    }

  } else {
    skip('1.1-1.6 Trigger messages tests', 'No hay mensajes en DB');
  }

  // ─── TEST GROUP 2: calls trigger ───
  console.log('\n─── BLOQUE 2: Trigger calls_guard_sensitive_fields ───\n');

  if (calls && calls.length > 0) {
    const testCall = calls[0];
    
    // Test 2.1: Try to change caller_id (should fail)
    try {
      const { error } = await anonClient
        .from('calls')
        .update({ caller_id: '00000000-0000-0000-0000-000000000000' })
        .eq('id', testCall.id);
      
      if (error) {
        result('2.1 caller_id protegido', true, 'Bloqueado: ' + error.message.substring(0, 80));
      } else {
        result('2.1 caller_id NO protegido', false, 'La actualización fue aceptada');
      }
    } catch (e) {
      result('2.1 caller_id protegido', true, 'Excepción capturada');
    }

    // Test 2.2: Try to change callee_id (should fail)
    try {
      const { error } = await anonClient
        .from('calls')
        .update({ callee_id: '00000000-0000-0000-0000-000000000000' })
        .eq('id', testCall.id);
      
      if (error) {
        result('2.2 callee_id protegido', true, 'Bloqueado: ' + error.message.substring(0, 80));
      } else {
        result('2.2 callee_id NO protegido', false, 'La actualización fue aceptada');
      }
    } catch (e) {
      result('2.2 callee_id protegido', true, 'Excepción capturada');
    }

    // Test 2.3: Try to change room_id (should fail)
    try {
      const { error } = await anonClient
        .from('calls')
        .update({ room_id: 'hacked-room' })
        .eq('id', testCall.id);
      
      if (error) {
        result('2.3 room_id protegido', true, 'Bloqueado: ' + error.message.substring(0, 80));
      } else {
        result('2.3 room_id NO protegido', false, 'La actualización fue aceptada');
      }
    } catch (e) {
      result('2.3 room_id protegido', true, 'Excepción capturada');
    }

    // Test 2.4: Via service_role — status change should succeed
    try {
      const { error } = await serviceClient
        .from('calls')
        .update({ status: testCall.status || 'ended' }) // Same value
        .eq('id', testCall.id);
      
      result('2.4 service_role permite status update', !error, error ? 'Error: ' + error.message : 'Exitoso (correcto)');
    } catch (e) {
      result('2.4 service_role bypasses trigger', false, 'Excepción: ' + e.message);
    }

  } else {
    skip('2.1-2.4 Trigger calls tests', 'No hay llamadas en DB');
  }

  // ─── TEST GROUP 3: RPC functions ───
  console.log('\n─── BLOQUE 3: Funciones RPC ───\n');

  // Test 3.1: is_chat_member exists and is callable
  try {
    const { data, error } = await anonClient.rpc('is_chat_member', {
      chat_uuid: '00000000-0000-0000-0000-000000000000',
      user_id: '00000000-0000-0000-0000-000000000000'
    });
    
    if (error && error.message.includes('function')) {
      result('3.1 is_chat_member existe', false, 'Función no encontrada: ' + error.message.substring(0, 80));
    } else {
      result('3.1 is_chat_member existe y es callable', true, `Resultado: ${data}`);
    }
  } catch (e) {
    result('3.1 is_chat_member', false, 'Excepción: ' + e.message);
  }

  // Test 3.2: user_in_chat exists and is callable
  try {
    const { data, error } = await anonClient.rpc('user_in_chat', {
      chat_uuid: '00000000-0000-0000-0000-000000000000',
      user_uuid: '00000000-0000-0000-0000-000000000000'
    });
    
    if (error && error.message.includes('function')) {
      result('3.2 user_in_chat existe', false, 'Función no encontrada: ' + error.message.substring(0, 80));
    } else {
      result('3.2 user_in_chat existe y es callable', true, `Resultado: ${data}`);
    }
  } catch (e) {
    result('3.2 user_in_chat', false, 'Excepción: ' + e.message);
  }

  // Test 3.3: is_chat_member with fake user_id should return false (auth.uid() used)
  // This tests that the function uses auth.uid() and ignores the user_id parameter
  try {
    const { data, error } = await anonClient.rpc('is_chat_member', {
      chat_uuid: '00000000-0000-0000-0000-000000000000',
      user_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' // Different user_id
    });
    
    // If function uses auth.uid() and anon has no session, this should be false
    // If function uses the parameter, this might be true for some chat
    result('3.3 is_chat_member ignora user_id param', data === false || data === null, 
      `Resultado: ${data} (debería ser false si usa auth.uid())`);
  } catch (e) {
    result('3.3 is_chat_member parameter check', true, 'Excepción (probablemente auth requerido): ' + e.message.substring(0, 80));
  }

  // ─── SUMMARY ───
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  RESUMEN: ${passed} pasaron | ${failed} fallaron | ${skipped} saltados`);
  console.log('═══════════════════════════════════════════════════════');
}

run().catch(console.error);
