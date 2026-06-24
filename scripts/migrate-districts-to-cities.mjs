/**
 * İlçe kayıtlarını kaldırır; district_coordinates içinde yalnızca il (81 şehir) kalır.
 * Profiller ve grup sohbetleri il adına taşınır.
 *
 * Kullanım: node scripts/migrate-districts-to-cities.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
const env = readFileSync(envPath, 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim();

const supabase = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

function extractCity(name) {
    if (!name) return null;
    const i = name.indexOf(' · ');
    return i >= 0 ? name.slice(0, i) : name;
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function fetchAllDistrictRows() {
    const rows = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('district_coordinates')
            .select('city,district,latitude,longitude')
            .range(from, from + pageSize - 1);
        if (error) throw new Error(`district_coordinates okuma: ${error.message}`);
        if (!data?.length) break;
        rows.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return rows;
}

function buildCityRows(districtRows) {
    const byCity = new Map();
    for (const row of districtRows) {
        const city = row.city || extractCity(row.district);
        if (!city) continue;
        const bucket = byCity.get(city) || { latSum: 0, lonSum: 0, count: 0 };
        bucket.latSum += row.latitude;
        bucket.lonSum += row.longitude;
        bucket.count += 1;
        byCity.set(city, bucket);
    }
    return [...byCity.entries()]
        .map(([city, { latSum, lonSum, count }]) => ({
            city,
            district: city,
            latitude: latSum / count,
            longitude: lonSum / count
        }))
        .sort((a, b) => a.city.localeCompare(b.city, 'tr'));
}

async function upsertCities(cityRows) {
    for (const batch of chunk(cityRows, 100)) {
        const { error } = await supabase
            .from('district_coordinates')
            .upsert(batch, { onConflict: 'district' });
        if (error) throw new Error(`İl koordinatları yazılamadı: ${error.message}`);
    }
    console.log(`İl koordinatları hazır: ${cityRows.length}`);
}

async function migrateProfiles(cityRows) {
    const citySet = new Set(cityRows.map((r) => r.city));
    const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id,district,current_district');
    if (error) throw new Error(`Profiller okunamadı: ${error.message}`);

    let updated = 0;
    for (const p of profiles || []) {
        const city =
            extractCity(p.current_district) ||
            extractCity(p.district) ||
            p.district;
        if (!citySet.has(city)) {
            throw new Error(`Profil için il bulunamadı: ${p.id} → ${city}`);
        }
        const { error: upErr } = await supabase
            .from('profiles')
            .update({ district: city, current_district: city })
            .eq('id', p.id);
        if (upErr) throw new Error(`Profil güncellenemedi (${p.id}): ${upErr.message}`);
        if (city !== p.district || city !== p.current_district) {
            console.log(`  profil ${p.id.slice(0, 8)}: ${p.district} → ${city}`);
            updated += 1;
        }
    }
    console.log(`Profiller güncellendi: ${updated}`);
}

async function migrateConversations(cityRows) {
    const citySet = new Set(cityRows.map((r) => r.city));
    const { data: convs, error } = await supabase
        .from('conversations')
        .select('id,district')
        .eq('type', 'group');
    if (error) throw new Error(`Sohbetler okunamadı: ${error.message}`);

    let updated = 0;
    for (const c of convs || []) {
        const city = extractCity(c.district) || c.district;
        if (!citySet.has(city)) {
            throw new Error(`Sohbet için il bulunamadı: ${c.id} → ${city}`);
        }
        if (city === c.district) continue;
        const { error: upErr } = await supabase
            .from('conversations')
            .update({ district: city })
            .eq('id', c.id);
        if (upErr) throw new Error(`Sohbet güncellenemedi (${c.id}): ${upErr.message}`);
        console.log(`  sohbet: ${c.district} → ${city}`);
        updated += 1;
    }
    console.log(`Grup sohbetleri güncellendi: ${updated}`);
}

async function deleteDistrictRows() {
    const { data: toDelete, error } = await supabase
        .from('district_coordinates')
        .select('district')
        .like('district', '% · %');
    if (error) throw new Error(`Silinecek ilçeler okunamadı: ${error.message}`);

    const districts = (toDelete || []).map((r) => r.district);
    console.log(`Silinecek ilçe kaydı: ${districts.length}`);

    for (const batch of chunk(districts, 100)) {
        const { error: delErr } = await supabase
            .from('district_coordinates')
            .delete()
            .in('district', batch);
        if (delErr) throw new Error(`İlçe silinemedi: ${delErr.message}`);
    }
}

async function verify() {
    const { count: total } = await supabase
        .from('district_coordinates')
        .select('*', { count: 'exact', head: true });
    const { count: ilceLeft } = await supabase
        .from('district_coordinates')
        .select('*', { count: 'exact', head: true })
        .like('district', '% · %');
    const { data: sample } = await supabase
        .from('district_coordinates')
        .select('city,district')
        .limit(5);
    const { data: profiles } = await supabase.from('profiles').select('district,current_district');
    const { data: convs } = await supabase
        .from('conversations')
        .select('district')
        .eq('type', 'group');

    console.log('\n--- Sonuç ---');
    console.log('district_coordinates toplam:', total);
    console.log('kalan ilçe formatı:', ilceLeft);
    console.log('örnek kayıtlar:', sample);
    console.log('profil illeri:', [...new Set(profiles?.map((p) => p.district))]);
    console.log('grup odaları:', convs?.map((c) => c.district));
}

async function main() {
    const districtRows = await fetchAllDistrictRows();
    console.log(`Okunan ilçe kaydı: ${districtRows.length}`);

    const cityRows = buildCityRows(districtRows);
    await upsertCities(cityRows);
    await migrateProfiles(cityRows);
    await migrateConversations(cityRows);
    await deleteDistrictRows();
    await verify();
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
