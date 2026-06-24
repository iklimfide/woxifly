/**
 * İstanbul'u Avrupa / Anadolu olarak ikiye böler; eski İstanbul kaydını kaldırır.
 * Kullanım: node scripts/split-istanbul.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(__dirname, '../.env.local'), 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim();

const supabase = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const ISTANBUL_ANADOLU = 'İstanbul Anadolu';
const ISTANBUL_AVRUPA = 'İstanbul Avrupa';
const ISTANBUL_LEGACY = 'İstanbul';

const HALVES = [
    {
        district: ISTANBUL_ANADOLU,
        city: 'İstanbul',
        latitude: 40.981857142857145,
        longitude: 29.186857142857146
    },
    {
        district: ISTANBUL_AVRUPA,
        city: 'İstanbul',
        latitude: 41.05616,
        longitude: 28.820040000000002
    }
];

async function upsertHalves() {
    const { error } = await supabase.from('district_coordinates').upsert(HALVES, { onConflict: 'district' });
    if (error) throw new Error(`İstanbul yarım kayıtları yazılamadı: ${error.message}`);
}

async function migrateProfiles() {
    const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id,district,current_district');
    if (error) throw new Error(error.message);

    let updated = 0;
    for (const profile of profiles || []) {
        const current = profile.current_district || profile.district;
        let next = current;

        if (current === 'İstanbul · Beşiktaş' || current === 'Beşiktaş') {
            next = ISTANBUL_AVRUPA;
        } else if (
            current === ISTANBUL_LEGACY
            || current?.startsWith('İstanbul · ')
            || current === 'Kadıköy'
        ) {
            next = ISTANBUL_ANADOLU;
        }

        if (next === current) continue;
        const { error: upErr } = await supabase.from('profiles').update({
            district: next,
            current_district: next
        }).eq('id', profile.id);
        if (upErr) throw new Error(upErr.message);
        console.log(`  profil ${profile.id.slice(0, 8)}: ${current} → ${next}`);
        updated += 1;
    }
    console.log(`Profiller güncellendi: ${updated}`);
}

async function cleanupGroupConversations() {
    const { data: convs, error } = await supabase
        .from('conversations')
        .select('id,district')
        .eq('type', 'group')
        .in('district', [ISTANBUL_LEGACY, ISTANBUL_ANADOLU, ISTANBUL_AVRUPA]);
    if (error) throw new Error(error.message);

    for (const conv of convs || []) {
        const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conv.id);
        if ((count || 0) > 0) continue;
        const { error: delErr } = await supabase.from('conversations').delete().eq('id', conv.id);
        if (delErr) throw new Error(delErr.message);
        console.log(`  boş sohbet silindi: ${conv.district} (${conv.id.slice(0, 8)})`);
    }
}

async function removeLegacyIstanbul() {
    const { error } = await supabase
        .from('district_coordinates')
        .delete()
        .eq('district', ISTANBUL_LEGACY);
    if (error) throw new Error(`Eski İstanbul kaydı silinemedi: ${error.message}`);
}

async function verify() {
    const { count: total } = await supabase
        .from('district_coordinates')
        .select('*', { count: 'exact', head: true });
    const { data: halves } = await supabase
        .from('district_coordinates')
        .select('district')
        .in('district', [ISTANBUL_ANADOLU, ISTANBUL_AVRUPA]);
    const { data: legacy } = await supabase
        .from('district_coordinates')
        .select('district')
        .eq('district', ISTANBUL_LEGACY);
    const { data: profiles } = await supabase.from('profiles').select('district,current_district');
    const { data: convs } = await supabase
        .from('conversations')
        .select('district')
        .eq('type', 'group')
        .in('district', [ISTANBUL_ANADOLU, ISTANBUL_AVRUPA, ISTANBUL_LEGACY]);

    console.log('\n--- Sonuç ---');
    console.log('district_coordinates toplam:', total);
    console.log('İstanbul yarımları:', halves?.map((row) => row.district));
    console.log('Eski İstanbul kaydı:', legacy?.length ? legacy : 'yok');
    console.log('profil konumları:', [...new Set(profiles?.map((p) => p.district))]);
    console.log('grup odaları:', convs?.map((c) => c.district));
}

async function main() {
    await upsertHalves();
    await migrateProfiles();
    await cleanupGroupConversations();
    await removeLegacyIstanbul();
    await verify();
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
